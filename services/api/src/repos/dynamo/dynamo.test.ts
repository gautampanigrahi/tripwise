import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { CheckResult, PlanItem, Trip } from '@tripwise/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDocumentClient, type DynamoContext } from './client.js';
import { createDynamoRepos } from './index.js';

// Mock the document client so no request can reach AWS.
const ddb = mockClient(DynamoDBDocumentClient);
let doc: DynamoDBDocumentClient;
let repos: ReturnType<typeof createDynamoRepos>;

const ctx = (): DynamoContext => ({ doc, tableName: 'tbl', gsi1Name: 'GSI1' });

const conditionFailed = () => Object.assign(new Error('failed'), { name: 'ConditionalCheckFailedException' });
const txCanceled = (codes: string[]) =>
  Object.assign(new Error('canceled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

const trip: Trip = {
  tripId: 't1',
  name: 'SD',
  destination: 'San Diego',
  startDate: '2025-06-12',
  endDate: '2025-06-16',
  hostId: 'u1',
  createdAt: '2025-01-01T00:00:00.000Z',
};

const item = (itemId: string, fields: Record<string, unknown> = {}): PlanItem => ({
  tripId: 't1',
  itemId,
  section: 'Checklist',
  fields,
  lastModifiedBy: 'u1',
  lastModifiedAt: '2025-01-02T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
});

beforeEach(() => {
  ddb.reset();
  doc = createDocumentClient(new DynamoDBClient({ region: 'us-east-1' }));
  repos = createDynamoRepos(ctx());
});

describe('dynamo trips', () => {
  it('creates META and host MEMBER in one transaction', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repos.trips.create(trip, { displayName: 'Ana', email: 'ana@x.com' });
    const [call] = ddb.commandCalls(TransactWriteCommand);
    const items = call!.args[0].input.TransactItems!;
    expect(items.map((i) => [i.Put!.Item!.PK, i.Put!.Item!.SK])).toEqual([
      ['TRIP#t1', 'META'],
      ['TRIP#t1', 'MEMBER#u1'],
    ]);
    expect(items[1]!.Put!.Item).toMatchObject({ GSI1PK: 'USER#u1', GSI1SK: 'TRIP#t1', role: 'host', tripName: 'SD' });
  });

  it('gets with ConsistentRead and lists via GSI1 across pages', async () => {
    ddb.on(GetCommand).resolves({ Item: { PK: 'TRIP#t1', SK: 'META', ...trip } });
    expect(await repos.trips.get('t1')).toEqual(trip);
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input).toMatchObject({
      Key: { PK: 'TRIP#t1', SK: 'META' },
      ConsistentRead: true,
    });

    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ tripId: 't1', tripName: 'A', role: 'host' }], LastEvaluatedKey: { PK: 'x' } })
      .resolvesOnce({ Items: [{ tripId: 't2', tripName: 'B', role: 'member' }] });
    expect(await repos.trips.listForUser('u1')).toEqual([
      { tripId: 't1', tripName: 'A', role: 'host' },
      { tripId: 't2', tripName: 'B', role: 'member' },
    ]);
    const queries = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(queries[0]).toMatchObject({ IndexName: 'GSI1', ExpressionAttributeValues: { ':pk': 'USER#u1' } });
    expect(queries[1]!.ExclusiveStartKey).toEqual({ PK: 'x' });
  });
});

describe('dynamo invitations', () => {
  const input = {
    tripId: 't1',
    inviteId: 'i1',
    tripName: 'SD',
    member: { userId: 'u2', displayName: 'Bo', email: 'bo@x.com' },
    acceptedAt: '2025-01-03T00:00:00.000Z',
  };

  it('accepts with Put MEMBER + conditional Update INVITE in one transaction', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const res = await repos.invitations.accept(input);
    expect(res).toEqual({ ok: true, membership: expect.objectContaining({ userId: 'u2', role: 'member' }) });
    const [put, update] = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(put!.Put!.Item).toMatchObject({ PK: 'TRIP#t1', SK: 'MEMBER#u2' });
    expect(update!.Update).toMatchObject({
      Key: { PK: 'TRIP#t1', SK: 'INVITE#i1' },
      ConditionExpression: '#status = :pending',
    });
  });

  it('maps cancellation reasons', async () => {
    ddb
      .on(TransactWriteCommand)
      .rejectsOnce(txCanceled(['None', 'ConditionalCheckFailed']))
      .rejectsOnce(txCanceled(['ConditionalCheckFailed', 'None']));
    expect(await repos.invitations.accept(input)).toEqual({ ok: false, reason: 'NOT_PENDING' });
    expect(await repos.invitations.accept(input)).toEqual({ ok: false, reason: 'ALREADY_MEMBER' });
  });
});

describe('dynamo planItems', () => {
  it('lists a section by SK prefix with ConsistentRead, reading every page', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [item('a')], LastEvaluatedKey: { PK: 'TRIP#t1', SK: 'ITEM#Checklist#a' } })
      .resolvesOnce({ Items: [item('b')] });
    const items = await repos.planItems.list('t1', 'Checklist');
    expect(items.map((i) => i.itemId)).toEqual(['a', 'b']);
    const [first] = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(first).toMatchObject({
      ConsistentRead: true,
      ExpressionAttributeValues: { ':pk': 'TRIP#t1', ':prefix': 'ITEM#Checklist#' },
    });
  });

  it('updates conditionally on lastModifiedAt, keeping server-owned fields out of the SET', async () => {
    const next = { ...item('a', { text: 'new', claimedBy: 'evil' }), lastModifiedAt: '2025-01-05T00:00:00.000Z' };
    ddb.on(UpdateCommand).resolves({ Attributes: { ...next, fields: { text: 'new' }, claimedBy: 'u3' } });
    const res = await repos.planItems.update(next, '2025-01-02T00:00:00.000Z');
    expect(res).toEqual({ ok: true, item: { ...next, fields: { text: 'new', claimedBy: 'u3' } } });
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe('attribute_exists(PK) AND lastModifiedAt = :expected');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':expected': '2025-01-02T00:00:00.000Z',
      ':fields': { text: 'new' },
    });
  });

  it('returns STALE with the stored item when the condition fails', async () => {
    const stored = item('a', { text: 'old' });
    ddb.on(UpdateCommand).rejects(conditionFailed());
    ddb.on(GetCommand).resolves({ Item: { PK: 'TRIP#t1', SK: 'ITEM#Checklist#a', ...stored } });
    expect(await repos.planItems.update(item('a', { text: 'x' }), 'old-ts')).toEqual({
      ok: false,
      reason: 'STALE',
      current: stored,
    });
    ddb.on(GetCommand).resolves({});
    expect(await repos.planItems.update(item('a'), 'old-ts')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('claims with the claimedBy condition and reports the current claimer', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    ddb.on(GetCommand).resolves({ Item: { ...item('c', { text: 'x' }), claimedBy: 'u9' } });
    const meta = { lastModifiedBy: 'u2', lastModifiedAt: '2025-01-05T00:00:00.000Z' };
    expect(await repos.planItems.claim('t1', 'c', meta)).toEqual({
      ok: false,
      reason: 'ALREADY_CLAIMED',
      claimedBy: 'u9',
    });
    expect(ddb.commandCalls(UpdateCommand)[0]!.args[0].input).toMatchObject({
      Key: { PK: 'TRIP#t1', SK: 'ITEM#Checklist#c' },
      ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(claimedBy) OR claimedBy = :caller)',
      ExpressionAttributeValues: { ':caller': 'u2' },
    });
  });
});

describe('dynamo checkResults', () => {
  const result = (checkId: string, runAt: string, kind: CheckResult['kind'] = 'standard'): CheckResult => ({
    tripId: 't1',
    checkId,
    runAt,
    kind,
    evaluatedStay: { name: 'Stay' },
    catalogVersion: 'v1',
    outcomes: [],
    score: 100,
    label: 'Feasible',
    tripNights: 4,
  });

  it('puts under CHECK#{runAt}#{checkId} and reads history newest first', async () => {
    ddb.on(PutCommand).resolves({});
    await repos.checkResults.put(result('c1', '2025-01-01T00:00:00.000Z'));
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({
      PK: 'TRIP#t1',
      SK: 'CHECK#2025-01-01T00:00:00.000Z#c1',
    });

    ddb.on(QueryCommand).resolves({ Items: [result('c2', '2025-01-02T00:00:00.000Z')] });
    await repos.checkResults.history('t1');
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      ScanIndexForward: false,
      ConsistentRead: true,
      ExpressionAttributeValues: { ':prefix': 'CHECK#' },
    });
  });

  it('latest by kind keeps paging until a match', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: { PK: 'p' } })
      .resolvesOnce({ Items: [result('c3', '2025-01-03T00:00:00.000Z', 'alternative')] });
    expect((await repos.checkResults.latest('t1', 'alternative'))?.checkId).toBe('c3');
    const inputs = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ ScanIndexForward: false, ExpressionAttributeValues: { ':kind': 'alternative' } });
  });
});
