import type { CheckResult, LodgingFields, PlanItem } from '@tripwise/shared';
import { lodgingFromCatalogStay } from '@tripwise/shared';
import { toFacts, verifyGrounding } from '@tripwise/grounding';
import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createChecksHandler, type ChecksDeps } from '../services/api/src/handlers/checks.js';
import { routes as itemRoutes, type ItemsDeps } from '../services/api/src/handlers/items.js';
import { dispatch, type ApiEvent } from '../services/api/src/lib/routes.js';
import { createMemoryRepos } from '../services/api/src/repos/memory/index.js';
import { buildSeedData, loadCatalog } from './seed.js';

/**
 * Demo scenario (Req 27.2-27.4) through the real checks and items handlers over in-memory repos:
 * seeded Gaslamp studio fails Capacity (2 vs 4); the North Park house alternative passes every
 * check; switching the selected Lodging to it and rerunning passes every check.
 */
describe('demo scenario', () => {
  it('fails Capacity on the seed, then passes after the alternative and the switch', async () => {
    const catalog = loadCatalog();
    const now = '2030-01-01T00:00:00.000Z';
    const seedMembers = [1, 2, 3, 4].map((n) => ({ userId: `user-${n}`, email: `demo${n}@example.com` }));
    const seed = buildSeedData({ startDate: '2030-06-12', members: seedMembers, catalog, now });
    const { trip } = seed;
    const [host, ...guests] = seed.members;

    // Same writes as scripts/seed.ts main(), against the in-memory repos.
    const repos = createMemoryRepos();
    await repos.trips.create(trip, { displayName: host!.displayName, email: host!.email });
    for (const m of guests) {
      const inviteId = `seed-${m.userId}`;
      await repos.invitations.create({ tripId: trip.tripId, inviteId, email: m.email, invitedBy: host!.userId, createdAt: now });
      const res = await repos.invitations.accept({
        tripId: trip.tripId, inviteId, tripName: trip.name, member: m, acceptedAt: now,
      });
      expect(res.ok).toBe(true);
    }
    await repos.constraints.put(trip.tripId, seed.constraints, { lastModifiedBy: host!.userId, lastModifiedAt: now });
    for (const item of seed.planItems) await repos.planItems.create(item);

    let tick = 0;
    const clock = () => new Date(Date.UTC(2030, 0, 2, 0, 0, ++tick)).toISOString();
    const published: string[] = [];
    const checksDeps: ChecksDeps = {
      ...repos,
      now: clock,
      newId: () => `check-${tick}`,
      enabledChecks: [],
      loadCatalog: async () => catalog,
      // No Bedrock locally: explain-fn "fails", so checks-fn stores the template explanation.
      explain: async () => {
        throw new Error('no bedrock in tests');
      },
      publish: async (i) => (published.push(i.recipient), true),
    };
    const itemsDeps: ItemsDeps = {
      ...repos,
      now: clock,
      newId: () => `item-${tick}`,
      files: {
        uploadTarget: async () => ({ url: 'unused', fields: {} }),
        downloadUrl: async () => 'unused',
      },
    };
    const checks = createChecksHandler(() => checksDeps);
    const items = dispatch(itemRoutes, () => itemsDeps);
    const event = (routeKey: string, pathParameters: Record<string, string>, body?: unknown) =>
      ({
        routeKey,
        pathParameters: { tripId: trip.tripId, ...pathParameters },
        body: body === undefined ? undefined : JSON.stringify(body),
        requestContext: {
          requestId: 'r',
          authorizer: { jwt: { claims: { sub: host!.userId, email: host!.email, email_verified: 'true' }, scopes: [] } },
        },
      }) as unknown as ApiEvent;
    const ctx = { awsRequestId: 'r' } as Context;
    const call = async (h: typeof checks, routeKey: string, path: Record<string, string> = {}, body?: unknown) => {
      const res = await h(event(routeKey, path, body), ctx);
      return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
    };
    const statuses = (r: CheckResult) => Object.fromEntries(r.outcomes.map((o) => [o.check, o.passed]));
    const expectGrounded = (r: CheckResult) => {
      expect(r.explanation).toBeTruthy();
      expect(verifyGrounding(r.explanation!, toFacts(r))).toEqual({ ok: true });
    };

    // 1. Seeded plan: Capacity fails, 2 vs 4.
    const first = await call(checks, 'POST /trips/{tripId}/checks');
    expect(first.status).toBe(201);
    const base = first.body.result as CheckResult;
    const capacity = base.outcomes.find((o) => o.check === 'Capacity')!;
    expect(capacity).toMatchObject({ passed: false, measured: 2, limit: 4 });
    expect(base.label).toBe('Not feasible');
    expect(base.evaluatedStay.stayId).toBe('sd-gaslamp-studio');
    expectGrounded(base);
    expect(published).toHaveLength(4);

    // 2. Alternative with the North Park house: every check passes, no Plan_Item changes.
    const lodgingBefore = await repos.planItems.list(trip.tripId, 'Lodging');
    const alt = await call(checks, 'POST /trips/{tripId}/checks/alternatives', {}, { stayId: 'sd-northpark-house' });
    expect(alt.status).toBe(201);
    const altResult = alt.body.result as CheckResult;
    expect(altResult).toMatchObject({ kind: 'alternative', evaluatedStay: { stayId: 'sd-northpark-house' } });
    expect(Object.values(statuses(altResult)).every(Boolean)).toBe(true);
    expectGrounded(altResult);
    expect(await repos.planItems.list(trip.tripId, 'Lodging')).toEqual(lodgingBefore);

    // 3. Switch the selected Lodging through the items API, then rerun.
    const gaslamp = lodgingBefore[0] as PlanItem<LodgingFields>;
    const ITEMS = '/trips/{tripId}/sections/{section}/items';
    const unselect = await call(items, `PUT ${ITEMS}/{itemId}`, { section: 'Lodging', itemId: gaslamp.itemId }, {
      fields: { ...gaslamp.fields, selected: false },
      expectedLastModifiedAt: gaslamp.lastModifiedAt,
    });
    expect(unselect.status).toBe(200);
    const house = catalog.stays.find((s) => s.id === 'sd-northpark-house')!;
    const created = await call(items, `POST ${ITEMS}`, { section: 'Lodging' }, {
      fields: { ...lodgingFromCatalogStay(house), checkIn: trip.startDate, checkOut: trip.endDate, selected: true },
    });
    expect(created.status).toBe(201);

    const rerun = await call(checks, 'POST /trips/{tripId}/checks');
    expect(rerun.status).toBe(201);
    const after = rerun.body.result as CheckResult;
    expect(after).toMatchObject({ kind: 'standard', label: 'Feasible', evaluatedStay: { stayId: 'sd-northpark-house' } });
    expect(Object.values(statuses(after)).every(Boolean)).toBe(true);
    expectGrounded(after);

    // History: newest first, all three runs.
    const history = await call(checks, 'GET /trips/{tripId}/checks');
    expect((history.body.results as CheckResult[]).map((r) => r.checkId)).toEqual(
      [after, altResult, base].map((r) => r.checkId),
    );
  });
});
