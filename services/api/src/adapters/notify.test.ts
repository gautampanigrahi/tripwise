import { PublishCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { inviteMessage } from '@tripwise/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../lib/logging.js';
import { safePublish, subscribeRecipient } from './notify.js';

const TOPIC = 'arn:aws:sns:us-west-2:123456789012:tripwise-notifications';
const snsMock = mockClient(SNSClient);
const sns = new SNSClient({ region: 'us-west-2' });
const deps = { sns, topicArn: TOPIC };
const message = inviteMessage('Beach Week', 'https://app.example/invites/abc');

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  snsMock.reset();
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('safePublish', () => {
  it('publishes once with the recipient message attribute (Req 3.2)', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'm-1' });
    const ok = await safePublish({ tripId: 't1', kind: 'INVITE', recipient: 'ana@example.com', message }, deps);
    expect(ok).toBe(true);
    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({
      TopicArn: TOPIC,
      Subject: message.subject,
      Message: message.body,
      MessageAttributes: { recipient: { DataType: 'String', StringValue: 'ana@example.com' } },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs SNS_PUBLISH_FAILED and returns normally when SNS fails (Req 24.4)', async () => {
    snsMock.on(PublishCommand).rejects(new Error('throttled'));
    const ok = await safePublish({ tripId: 't1', kind: 'CHECK_RESULT', recipient: 'ana@example.com', message }, deps);
    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = errorSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).toMatchObject({ event: 'SNS_PUBLISH_FAILED', tripId: 't1', kind: 'CHECK_RESULT' });
    expect(JSON.stringify(payload)).not.toContain('ana@example.com');
  });

  it('does not throw when the topic is not configured', async () => {
    const ok = await safePublish({ tripId: 't1', kind: 'REMINDER', recipient: 'a@b.c', message }, { sns, topicArn: '' });
    expect(ok).toBe(false);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    expect(errorSpy.mock.calls[0]![1]).toMatchObject({ event: 'SNS_PUBLISH_FAILED' });
  });
});

describe('subscribeRecipient', () => {
  it('subscribes the email with a recipient filter policy on message attributes', async () => {
    snsMock.on(SubscribeCommand).resolves({ SubscriptionArn: 'pending confirmation' });
    const ok = await subscribeRecipient({ tripId: 't1', email: 'ana@example.com' }, deps);
    expect(ok).toBe(true);
    const input = snsMock.commandCalls(SubscribeCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ TopicArn: TOPIC, Protocol: 'email', Endpoint: 'ana@example.com' });
    expect(input.Attributes?.FilterPolicyScope).toBe('MessageAttributes');
    expect(JSON.parse(input.Attributes!.FilterPolicy!)).toEqual({ recipient: ['ana@example.com'] });
  });

  it('logs and returns false instead of throwing on failure', async () => {
    snsMock.on(SubscribeCommand).rejects(new Error('denied'));
    await expect(subscribeRecipient({ tripId: 't1', email: 'ana@example.com' }, deps)).resolves.toBe(false);
    expect(errorSpy.mock.calls[0]![1]).toMatchObject({ event: 'SNS_SUBSCRIBE_FAILED', tripId: 't1' });
  });
});
