import { PublishCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import type { NotificationMessage } from '@tripwise/shared';
import { log } from '../lib/logging.js';

/** Which alert is being sent; logged on failure so CloudWatch shows what was lost. */
export type NotificationKind = 'INVITE' | 'CHECK_RESULT' | 'REMINDER';

/** The SNS message attribute that subscription filter policies match on (design §9). */
export const RECIPIENT_ATTRIBUTE = 'recipient';

export interface NotifyDeps {
  sns?: Pick<SNSClient, 'send'>;
  /** Defaults to `process.env.TOPIC_ARN`. */
  topicArn?: string;
}

let defaultClient: SNSClient | undefined;
function resolve(deps: NotifyDeps): { sns: Pick<SNSClient, 'send'>; topicArn: string | undefined } {
  const sns = deps.sns ?? (defaultClient ??= new SNSClient({}));
  return { sns, topicArn: deps.topicArn ?? process.env.TOPIC_ARN };
}

export interface PublishInput {
  tripId: string;
  kind: NotificationKind;
  /** Email address of the single recipient; matched by that recipient's filter policy. */
  recipient: string;
  message: NotificationMessage;
}

/**
 * Publishes one message to one recipient on the shared topic. Never throws: on any error it logs
 * `{ event: 'SNS_PUBLISH_FAILED', tripId, kind }` and returns `false`, so the originating Trip
 * operation still succeeds (Req 3.2, 24.4). The recipient address is not logged.
 */
export async function safePublish(input: PublishInput, deps: NotifyDeps = {}): Promise<boolean> {
  const { tripId, kind, recipient, message } = input;
  try {
    const { sns, topicArn } = resolve(deps);
    if (!topicArn) throw new Error('TOPIC_ARN is not configured');
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: message.subject,
        Message: message.body,
        MessageAttributes: {
          [RECIPIENT_ATTRIBUTE]: { DataType: 'String', StringValue: recipient },
        },
      }),
    );
    return true;
  } catch (err) {
    log.error('SNS publish failed', { event: 'SNS_PUBLISH_FAILED', tripId, kind, error: errorName(err) });
    return false;
  }
}

export interface SubscribeInput {
  tripId: string;
  email: string;
}

/**
 * Subscribes an email address to the topic with filter policy `{ "recipient": ["<email>"] }` on
 * message attributes, so it receives only messages published for it. SNS returns the existing
 * subscription when called again with the same endpoint and attributes, so this is idempotent.
 * Best effort like `safePublish`: on error it logs `{ event: 'SNS_SUBSCRIBE_FAILED', tripId }` and
 * returns `false` instead of throwing, so the invitation is still stored.
 */
export async function subscribeRecipient(input: SubscribeInput, deps: NotifyDeps = {}): Promise<boolean> {
  const { tripId, email } = input;
  try {
    const { sns, topicArn } = resolve(deps);
    if (!topicArn) throw new Error('TOPIC_ARN is not configured');
    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'email',
        Endpoint: email,
        Attributes: {
          FilterPolicyScope: 'MessageAttributes',
          FilterPolicy: JSON.stringify({ [RECIPIENT_ATTRIBUTE]: [email] }),
        },
      }),
    );
    return true;
  } catch (err) {
    log.error('SNS subscribe failed', { event: 'SNS_SUBSCRIBE_FAILED', tripId, error: errorName(err) });
    return false;
  }
}

/** Error name and message only; SDK errors can carry request metadata we do not need in logs. */
function errorName(err: unknown): { name: string; message: string } {
  return err instanceof Error ? { name: err.name, message: err.message } : { name: 'Unknown', message: String(err) };
}
