import { readFileSync } from 'node:fs';
import { parseCatalog, type Catalog } from '@tripwise/shared';
import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import type { PublishInput } from '../adapters/notify.js';
import type { ApiEvent } from '../lib/routes.js';
import type { CheckRef } from '../repos/interfaces.js';
import { createMemoryRepos } from '../repos/memory/index.js';
import { createChecksHandler, parseEnabledChecks, routes, type ChecksDeps } from './checks.js';

const ctx = { awsRequestId: 'req' } as Context;
const parsed = parseCatalog(
  JSON.parse(readFileSync(new URL('../../../../catalog/san-diego-v1.json', import.meta.url), 'utf8')),
  'san-diego-v1',
);
if (!parsed.ok) throw new Error('test catalog invalid');
const catalog: Catalog = parsed.catalog;

const meta = { lastModifiedBy: 'host', lastModifiedAt: '2030-01-01T00:00:00.000Z' };

async function setup(opts: { explainFails?: boolean } = {}) {
  const published: PublishInput[] = [];
  const explained: CheckRef[] = [];
  let tick = 0;
  const repos = createMemoryRepos();
  const deps: ChecksDeps = {
    ...repos,
    now: () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick)).toISOString(),
    newId: () => `id-${++tick}`,
    enabledChecks: [],
    loadCatalog: async () => catalog,
    explain: async (ref) => {
      explained.push(ref);
      if (opts.explainFails) throw new Error('boom');
      await repos.checkResults.setExplanation(ref, 'Bedrock text', 'bedrock');
      return { text: 'Bedrock text', source: 'bedrock' };
    },
    publish: async (i) => (published.push(i), true),
  };
  await repos.trips.create(
    { tripId: 't1', name: 'SD Trip', destination: 'San Diego', startDate: '2030-06-01', endDate: '2030-06-05', hostId: 'host', createdAt: meta.lastModifiedAt },
    { displayName: 'Host', email: 'host@example.com' },
  );
  const handler = createChecksHandler(() => deps);
  const call = async (routeKey: string, body?: unknown, sub = 'host') => {
    const event = {
      routeKey,
      pathParameters: { tripId: 't1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      requestContext: {
        requestId: 'r',
        authorizer: { jwt: { claims: { sub, email: `${sub}@example.com`, email_verified: 'true' }, scopes: [] } },
      },
    } as unknown as ApiEvent;
    const res = await handler(event, ctx);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const addLodging = () =>
    repos.planItems.create({
      tripId: 't1', itemId: 'lodge', section: 'Lodging', createdAt: meta.lastModifiedAt, ...meta,
      fields: { name: 'Gaslamp Studio', catalogStayId: 'sd-gaslamp-studio', sleeps: 2, nightlyPriceCents: 18000, checkIn: '2030-06-01', checkOut: '2030-06-05' },
    });
  const addConstraints = () =>
    repos.constraints.put(
      't1',
      {
        destination: 'San Diego', startDate: '2030-06-01', endDate: '2030-06-05', travelerCount: 4,
        budgetCents: 250000, budgetType: 'total', requiredFeatures: [], plannedActivityIds: [], accessibilityNeeds: [],
      },
      meta,
    );
  return { deps, repos, call, published, explained, addLodging, addConstraints };
}

describe('checks handler', () => {
  it('exports its routes with guards', () => {
    expect(routes.map((r) => [r.routeKey, r.guard])).toEqual([
      ['POST /trips/{tripId}/checks', 'runCheck'],
      ['GET /trips/{tripId}/checks', 'read'],
      ['POST /trips/{tripId}/checks/alternatives', 'runCheck'],
    ]);
  });

  it('parses ENABLED_CHECKS', () => {
    expect(parseEnabledChecks('Cost, Schedule,Bogus')).toEqual(['Cost', 'Schedule']);
    expect(parseEnabledChecks(undefined)).toEqual([]);
  });

  it('returns 422 MISSING_INPUT naming the missing input', async () => {
    const s = await setup();
    expect((await s.call('POST /trips/{tripId}/checks')).body).toEqual({ error: 'MISSING_INPUT', missing: 'Lodging' });
    await s.addLodging();
    const res = await s.call('POST /trips/{tripId}/checks');
    expect(res).toEqual({ status: 422, body: { error: 'MISSING_INPUT', missing: 'TripConstraints' } });
  });

  it('returns 422 UNKNOWN_ACTIVITY for a planned activity missing from the Catalog', async () => {
    const s = await setup();
    await s.addLodging();
    await s.repos.constraints.put('t1', { ...(await s.addConstraints()), plannedActivityIds: ['nope'] }, meta);
    const res = await s.call('POST /trips/{tripId}/checks');
    expect(res).toEqual({ status: 422, body: { error: 'UNKNOWN_ACTIVITY', activityId: 'nope' } });
  });

  it('runs checks, saves the result with its explanation, and alerts every Member', async () => {
    const s = await setup();
    await s.addLodging();
    await s.addConstraints();
    const res = await s.call('POST /trips/{tripId}/checks');
    expect(res.status).toBe(201);
    const result = res.body.result;
    expect(result).toMatchObject({
      kind: 'standard',
      evaluatedStay: { stayId: 'sd-gaslamp-studio', name: 'Gaslamp Studio' },
      catalogVersion: 'san-diego-v1',
      tripNights: 4,
      label: 'Not feasible', // sleeps 2 < 4 travelers
      explanation: 'Bedrock text',
      explanationSource: 'bedrock',
    });
    expect(result.outcomes.map((o: { check: string }) => o.check)).toEqual(['Cost', 'Capacity', 'Dates']);
    expect(s.explained).toEqual([{ tripId: 't1', runAt: result.runAt, checkId: result.checkId }]);
    expect(await s.repos.checkResults.history('t1')).toEqual([result]);
    expect(s.published).toEqual([
      expect.objectContaining({ tripId: 't1', kind: 'CHECK_RESULT', recipient: 'host@example.com' }),
    ]);
    expect(s.published[0]!.message.subject).toContain('67%');
  });

  it('stores the template explanation when explain-fn fails', async () => {
    const s = await setup({ explainFails: true });
    await s.addLodging();
    await s.addConstraints();
    const { body } = await s.call('POST /trips/{tripId}/checks');
    expect(body.result.explanationSource).toBe('template');
    const [stored] = await s.repos.checkResults.history('t1');
    expect(stored).toMatchObject({ explanationSource: 'template', explanation: body.result.explanation });
    expect(stored!.explanation).toContain('feasibility score of 67');
  });

  it('evaluates an alternative stay without touching Plan_Items, and lists history newest first', async () => {
    const s = await setup();
    await s.addLodging();
    await s.addConstraints();
    expect((await s.call('POST /trips/{tripId}/checks/alternatives', { stayId: 'sd-northpark-house' })).body).toEqual({
      error: 'NO_BASE_RESULT',
    });
    const base = (await s.call('POST /trips/{tripId}/checks')).body.result;
    const before = await s.repos.planItems.list('t1', 'Lodging');
    const alt = await s.call('POST /trips/{tripId}/checks/alternatives', { stayId: 'sd-northpark-house' });
    expect(alt.status).toBe(201);
    expect(alt.body.result).toMatchObject({ kind: 'alternative', evaluatedStay: { stayId: 'sd-northpark-house' } });
    expect(await s.repos.planItems.list('t1', 'Lodging')).toEqual(before);
    const history = await s.call('GET /trips/{tripId}/checks');
    expect(history.body.results.map((r: { checkId: string }) => r.checkId)).toEqual([alt.body.result.checkId, base.checkId]);
  });
});
