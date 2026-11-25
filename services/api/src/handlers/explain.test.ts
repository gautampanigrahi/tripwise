import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CheckResult } from '@tripwise/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler } from './explain.js';

process.env.TABLE_NAME = 'tbl';
process.env.MODEL_ID = 'model-1';

const ddb = mockClient(DynamoDBDocumentClient);
const br = mockClient(BedrockRuntimeClient);

const result: CheckResult = {
  tripId: 't1',
  checkId: 'c1',
  runAt: '2025-01-01T00:00:00.000Z',
  kind: 'standard',
  evaluatedStay: { name: 'Beach House' },
  catalogVersion: 'v1',
  outcomes: [{ check: 'Cost', measured: 285000, limit: 250000, unit: 'USD_CENTS', passed: false }],
  score: 0,
  label: 'Not feasible',
  tripNights: 4,
};
const event = { tripId: 't1', runAt: result.runAt, checkId: 'c1' };

const reply = (text: string) => ({ output: { message: { role: 'assistant' as const, content: [{ text }] } } });
const stored = () => ddb.commandCalls(UpdateCommand)[0]!.args[0].input.ExpressionAttributeValues;

beforeEach(() => {
  ddb.reset();
  br.reset();
  ddb.on(GetCommand).resolves({ Item: { PK: 'TRIP#t1', SK: 'CHECK#x', ...result } });
  ddb.on(UpdateCommand).resolves({});
});

describe('explain handler', () => {
  it('stores a grounded Bedrock reply', async () => {
    const text = 'The plan is not feasible: cost is $2850.00 against a $2500.00 limit for 4 nights.';
    br.on(ConverseCommand).resolves(reply(text));

    expect(await handler(event)).toEqual({ text, source: 'bedrock' });
    expect(stored()).toEqual({ ':text': text, ':source': 'bedrock' });

    const input = br.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input.modelId).toBe('model-1');
    expect(input.inferenceConfig).toEqual({ maxTokens: 300, temperature: 0 });
    expect(input.system?.[0]?.text).toContain('Use only the numbers that appear in FACTS');
  });

  it('stores the template when Bedrock fails', async () => {
    br.on(ConverseCommand).rejects(new Error('throttled'));

    const out = await handler(event);
    expect(out.source).toBe('template');
    expect(out.text).toContain('$2850.00');
    expect(stored()).toEqual({ ':text': out.text, ':source': 'template' });
  });

  it('stores the template when the reply has an ungrounded number', async () => {
    br.on(ConverseCommand).resolves(reply('The plan is $350.00 over budget.'));

    const out = await handler(event);
    expect(out.source).toBe('template');
    expect(stored()).toEqual({ ':text': out.text, ':source': 'template' });
  });
});
