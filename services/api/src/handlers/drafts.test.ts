import { AccessDeniedException, BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics, MetricUnit } from '../lib/logging.js';
import type { ApiEvent } from '../lib/routes.js';
import { createMemoryRepos } from '../repos/memory/index.js';
import { DRAFT_TIMEOUT_MS, createDraftsHandler, type DraftsDeps } from './drafts.js';

process.env.MODEL_ID = 'model-1';

const br = mockClient(BedrockRuntimeClient);
const reply = (text: string) => ({ output: { message: { role: 'assistant' as const, content: [{ text }] } } });
const WRITE_METHODS = new Set(['create', 'update', 'delete', 'claim', 'put', 'accept', 'setExplanation', 'setConfirmationKey']);

let lines: string[];

beforeEach(() => {
  br.reset();
  lines = [];
  const capture = (chunk: unknown) => {
    lines.push(...String(chunk).split('\n').filter((l) => l.trim() !== ''));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const repos = createMemoryRepos();
  await repos.trips.create(
    {
      tripId: 't1',
      name: 'SD',
      destination: 'San Diego',
      startDate: '2025-06-12',
      endDate: '2025-06-15',
      hostId: 'host',
      createdAt: '2025-01-01T00:00:00Z',
    },
    { displayName: 'Sam', email: 'sam@example.com' },
  );
  await repos.invitations.create({
    tripId: 't1',
    inviteId: 'i1',
    email: 'alex@example.com',
    invitedBy: 'host',
    createdAt: '2025-01-01T00:00:00Z',
  });
  await repos.invitations.accept({
    tripId: 't1',
    inviteId: 'i1',
    tripName: 'SD',
    member: { userId: 'member', displayName: 'Alex', email: 'alex@example.com' },
    acceptedAt: '2025-01-01T00:00:00Z',
  });
  await repos.planItems.create({
    tripId: 't1',
    itemId: 'pad1',
    section: 'ScratchPad',
    fields: { title: 'Boat tour', notes: 'Harbor cruise $45 each' },
    createdAt: '2025-01-01T00:00:00Z',
    lastModifiedBy: 'host',
    lastModifiedAt: '2025-01-01T00:00:00Z',
  });
  const setupCalls = repos.table.calls.length;
  let id = 0;
  const deps: DraftsDeps = {
    ...repos,
    newId: () => `d${++id}`,
    bedrock: new BedrockRuntimeClient({
      region: 'us-west-2',
      credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret' },
    }),
  };
  const handler = createDraftsHandler(() => deps);
  const call = async (body: unknown, sub = 'member') => {
    const event = {
      routeKey: 'POST /trips/{tripId}/drafts',
      pathParameters: { tripId: 't1' },
      body: JSON.stringify(body),
      requestContext: {
        requestId: 'r1',
        authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` }, scopes: [] } },
      },
    } as unknown as ApiEvent;
    const res = await handler(event, {} as Context);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const writes = () => repos.table.calls.slice(setupCalls).filter((c) => WRITE_METHODS.has(c.method));
  return { call, writes };
}

const prompt = () => br.commandCalls(ConverseCommand)[0]!.args[0].input;
const failedLines = () =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.event === 'DRAFT_FAILED');

describe('drafts handler', () => {
  it('drafts from notes and selected items without storing anything', async () => {
    const { call, writes } = await setup();
    const addMetric = vi.spyOn(metrics, 'addMetric');
    const model = [
      '```json',
      JSON.stringify([
        { section: 'Groceries', fields: { name: 'Eggs', quantity: 12, responsibleMember: ' alex ' } },
        { section: 'Checklist', fields: { task: 'Pack sunscreen', claimedBy: 'Sam' } },
        { section: 'Reservations', fields: { title: 'Boat tour', costCents: 4500 } },
        { section: 'Transportation', fields: { title: 'Taxi', costCents: 9999 } },
        { section: 'Itinerary', fields: { day: '2025-07-01', startTime: '10:00', stopName: 'Zoo' } },
        { section: 'Expenses', fields: { description: 'Dinner' } },
      ]),
      '```',
    ].join('\n');
    br.on(ConverseCommand).resolves(reply(model));

    const res = await call({ itemIds: ['pad1'], notes: '  Buy eggs for Alex  ' });
    expect(res.status).toBe(200);

    const input = prompt();
    expect(input.modelId).toBe('model-1');
    expect(input.inferenceConfig).toEqual({ temperature: 0, maxTokens: 1500 });
    expect(input.system?.[0]?.text).toContain('Return only JSON');
    const user = input.messages?.[0]?.content?.[0]?.text ?? '';
    expect(user).toContain('<notes>\nBoat tour\nHarbor cruise $45 each\n\nBuy eggs for Alex\n</notes>');
    expect(user).toContain('Member display names: Sam, Alex');
    for (const hidden of ['alex@example.com', 'sam@example.com', 'member', 'host']) {
      expect(user).not.toContain(hidden);
    }
    expect(user).not.toContain('Traveler count');

    const drafts = res.body.drafts;
    expect(drafts.map((d: { section: string }) => d.section)).toEqual([
      'Groceries',
      'Checklist',
      'Reservations',
      'Transportation',
      'Itinerary',
    ]);
    expect(drafts[0]).toEqual({
      draftId: 'd1',
      section: 'Groceries',
      fields: { name: 'Eggs', quantity: 12, responsibleMemberId: 'member' },
      valid: true,
      errors: [],
    });
    expect(drafts[1]).toMatchObject({ fields: { task: 'Pack sunscreen' }, valid: true, suggestedClaimedBy: 'host' });
    expect(drafts[2]).toMatchObject({ fields: { title: 'Boat tour', costCents: 4500 }, valid: true });
    expect(drafts[3]).toMatchObject({ fields: { title: 'Taxi' }, valid: true });
    expect(drafts[4].valid).toBe(false);
    expect(drafts[4].errors.map((e: { field: string }) => e.field)).toContain('day');

    expect(writes()).toEqual([]);
    expect(addMetric).toHaveBeenCalledWith('DraftRequestCount', MetricUnit.Count, 1);
    expect(addMetric).toHaveBeenCalledWith('DraftItemCount', MetricUnit.Count, 5);
    expect(lines.join('\n')).not.toContain('Buy eggs');
  });

  it('accepts exactly 4,000 characters of notes', async () => {
    const { call } = await setup();
    br.on(ConverseCommand).resolves(reply('[]'));
    const res = await call({ notes: 'a'.repeat(4000) });
    expect(res).toEqual({ status: 200, body: { drafts: [] } });
    expect(br.commandCalls(ConverseCommand)).toHaveLength(1);
  });

  it.each([
    ['empty notes', {}, 'notes'],
    ['blank notes', { notes: '   ' }, 'notes'],
    ['4,001 characters', { notes: 'a'.repeat(4001) }, 'notes'],
    ['an unknown itemId', { itemIds: ['nope'], notes: 'x' }, 'itemIds'],
    ['an unknown key', { notes: 'x', userId: 'host' }, 'userId'],
  ])('rejects %s with 400 without calling Bedrock', async (_name, body, field) => {
    const { call } = await setup();
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
    expect(res.body.fields.map((f: { field: string }) => f.field)).toContain(field);
    if (field === 'notes') expect(res.body.fields[0].message).toBe('Draft notes must be 1 to 4,000 characters');
    expect(br.commandCalls(ConverseCommand)).toHaveLength(0);
  });

  it('rejects a non-Member before calling Bedrock', async () => {
    const { call } = await setup();
    const res = await call({ notes: 'x' }, 'stranger');
    expect(res.status).toBe(403);
    expect(br.commandCalls(ConverseCommand)).toHaveLength(0);
  });

  const NOTES = 'Secret picnic plan at noon';

  async function expectFailure(res: { status: number; body: unknown }, reason: string, writes: () => unknown[]) {
    expect(res).toEqual({ status: 502, body: { error: 'DRAFT_FAILED', reason } });
    expect(failedLines()).toEqual([expect.objectContaining({ event: 'DRAFT_FAILED', tripId: 't1', reason })]);
    expect(lines.join('\n')).not.toContain('Secret picnic');
    expect(writes()).toEqual([]);
  }

  it('maps model access denied to MODEL_ACCESS_DENIED', async () => {
    const { call, writes } = await setup();
    br.on(ConverseCommand).rejects(new AccessDeniedException({ message: 'no access', $metadata: {} }));
    await expectFailure(await call({ notes: NOTES }), 'MODEL_ACCESS_DENIED', writes);
  });

  it('maps any other Bedrock error to BEDROCK_ERROR', async () => {
    const { call, writes } = await setup();
    br.on(ConverseCommand).rejects(new Error('throttled'));
    await expectFailure(await call({ notes: NOTES }), 'BEDROCK_ERROR', writes);
  });

  it('maps non-JSON output to UNPARSEABLE', async () => {
    const { call, writes } = await setup();
    br.on(ConverseCommand).resolves(reply(`Sure! ${NOTES}`));
    await expectFailure(await call({ notes: NOTES }), 'UNPARSEABLE', writes);
  });

  it('gives up after 8 seconds with TIMEOUT', async () => {
    vi.useFakeTimers();
    const { call, writes } = await setup();
    br.on(ConverseCommand).callsFake(() => new Promise(() => {}));
    let settled = false;
    const pending = call({ notes: NOTES }).finally(() => {
      settled = true;
    });
    for (let i = 0; i < 100 && br.commandCalls(ConverseCommand).length === 0; i++) await Promise.resolve();
    expect(br.commandCalls(ConverseCommand)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DRAFT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expectFailure(await pending, 'TIMEOUT', writes);
  });
});
