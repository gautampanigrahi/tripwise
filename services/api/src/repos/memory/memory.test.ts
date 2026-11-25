import type { CheckResult, PlanItem, Trip } from '@tripwise/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryRepos } from './index.js';

const trip: Trip = {
  tripId: 't1',
  name: 'SD',
  destination: 'San Diego',
  startDate: '2025-06-12',
  endDate: '2025-06-16',
  hostId: 'u1',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const host = { displayName: 'Ana', email: 'ana@x.com' };

const item = (itemId: string, fields: Record<string, unknown> = {}): PlanItem => ({
  tripId: 't1',
  itemId,
  section: 'Checklist',
  fields,
  lastModifiedBy: 'u1',
  lastModifiedAt: '2025-01-02T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
});

describe('memory repos', () => {
  it('creates a trip with its host Membership and lists it only for Members', async () => {
    const repos = createMemoryRepos();
    await repos.trips.create(trip, host);
    expect(await repos.trips.get('t1')).toEqual(trip);
    expect(await repos.memberships.get('t1', 'u1')).toEqual({ tripId: 't1', userId: 'u1', role: 'host', ...host });
    expect(await repos.trips.listForUser('u1')).toEqual([{ tripId: 't1', tripName: 'SD', role: 'host' }]);
    expect(await repos.trips.listForUser('u2')).toEqual([]);
    await expect(repos.trips.create(trip, host)).rejects.toThrow();
    expect(repos.table.callsTo('trips').map((c) => c.method)).toEqual([
      'create',
      'get',
      'listForUser',
      'listForUser',
      'create',
    ]);
  });

  it('accepts a pending invitation once', async () => {
    const repos = createMemoryRepos();
    await repos.trips.create(trip, host);
    const inv = await repos.invitations.create({
      tripId: 't1',
      inviteId: 'i1',
      email: ' Bo@X.com ',
      invitedBy: 'u1',
      createdAt: 'now',
    });
    expect(inv).toMatchObject({ email: 'bo@x.com', status: 'pending' });
    const input = {
      tripId: 't1',
      inviteId: 'i1',
      tripName: 'SD',
      member: { userId: 'u2', displayName: 'Bo', email: 'bo@x.com' },
      acceptedAt: 'later',
    };
    expect((await repos.invitations.accept(input)).ok).toBe(true);
    expect(await repos.invitations.get('i1')).toMatchObject({ status: 'accepted', acceptedBy: 'u2' });
    expect(await repos.invitations.accept(input)).toEqual({ ok: false, reason: 'NOT_PENDING' });
    expect((await repos.memberships.listByTrip('t1')).map((m) => m.userId)).toEqual(['u1', 'u2']);
  });

  it('applies optimistic concurrency and keeps server-owned fields', async () => {
    const repos = createMemoryRepos();
    await repos.planItems.create(item('a', { text: 'old', claimedBy: 'u3' }));
    const next = { ...item('a', { text: 'new', claimedBy: 'evil' }), lastModifiedAt: '2025-01-05T00:00:00.000Z' };
    expect(await repos.planItems.update(next, 'wrong')).toEqual({
      ok: false,
      reason: 'STALE',
      current: item('a', { text: 'old', claimedBy: 'u3' }),
    });
    const ok = await repos.planItems.update(next, '2025-01-02T00:00:00.000Z');
    expect(ok).toEqual({ ok: true, item: { ...next, fields: { text: 'new', claimedBy: 'u3' } } });
    expect(await repos.planItems.update(item('missing'), 'x')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('claims unclaimed items and rejects claims by another Member', async () => {
    const repos = createMemoryRepos();
    await repos.planItems.create(item('c', { text: 'x' }));
    const meta = (by: string) => ({ lastModifiedBy: by, lastModifiedAt: '2025-01-05T00:00:00.000Z' });
    const first = await repos.planItems.claim('t1', 'c', meta('u2'));
    expect(first.ok && first.item).toMatchObject({ fields: { claimedBy: 'u2' }, lastModifiedBy: 'u2' });
    expect(await repos.planItems.claim('t1', 'c', meta('u3'))).toEqual({
      ok: false,
      reason: 'ALREADY_CLAIMED',
      claimedBy: 'u2',
    });
    expect((await repos.planItems.claim('t1', 'c', meta('u2'))).ok).toBe(true);
  });

  it('returns check history newest first and latest by kind', async () => {
    const repos = createMemoryRepos();
    const result = (checkId: string, runAt: string, kind: CheckResult['kind']): CheckResult => ({
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
    await repos.checkResults.put(result('c1', '2025-01-01T00:00:00.000Z', 'standard'));
    await repos.checkResults.put(result('c3', '2025-01-03T00:00:00.000Z', 'alternative'));
    await repos.checkResults.put(result('c2', '2025-01-02T00:00:00.000Z', 'standard'));
    expect((await repos.checkResults.history('t1')).map((r) => r.checkId)).toEqual(['c3', 'c2', 'c1']);
    expect((await repos.checkResults.latest('t1', 'standard'))?.checkId).toBe('c2');
    expect((await repos.checkResults.latest('t1'))?.checkId).toBe('c3');
  });
});
