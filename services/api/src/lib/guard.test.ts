import type { Membership } from '@tripwise/shared';
import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../repos/memory/index.js';
import { HttpError, json } from './http.js';
import { ACTIONS, decide, withTripGuard, type TripEvent } from './guard.js';

const ctx = {} as Context;

function event(sub: string, tripId: string | undefined): TripEvent {
  return {
    pathParameters: tripId === undefined ? {} : { tripId },
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: `${sub}@example.com`, email_verified: 'true' }, scopes: [] } },
    },
  } as unknown as TripEvent;
}

const membership = (role: Membership['role']): Membership => ({
  tripId: 't1',
  userId: 'u1',
  role,
  displayName: 'U',
  email: 'u1@example.com',
});

/** A trip `t1` hosted by `host` with `member` as a Member; returns the repos with the call log cleared. */
async function seeded() {
  const repos = createMemoryRepos();
  await repos.trips.create(
    {
      tripId: 't1',
      name: 'SD',
      destination: 'San Diego',
      startDate: '2025-06-01',
      endDate: '2025-06-05',
      hostId: 'host',
      createdAt: '2025-01-01T00:00:00Z',
    },
    { displayName: 'Host', email: 'host@example.com' },
  );
  await repos.invitations.create({
    tripId: 't1',
    inviteId: 'i1',
    email: 'member@example.com',
    invitedBy: 'host',
    createdAt: '2025-01-01T00:00:00Z',
  });
  await repos.invitations.accept({
    tripId: 't1',
    inviteId: 'i1',
    tripName: 'SD',
    member: { userId: 'member', displayName: 'M', email: 'member@example.com' },
    acceptedAt: '2025-01-01T00:00:00Z',
  });
  repos.table.calls.length = 0;
  return repos;
}

describe('decide', () => {
  it('denies non-Members for every action', () => {
    for (const a of ACTIONS) expect(decide(undefined, a)).toEqual({ allow: false, status: 403 });
  });

  it('lets only the Host invite', () => {
    expect(decide(membership('host'), 'invite')).toEqual({ allow: true });
    expect(decide(membership('member'), 'invite')).toEqual({ allow: false, status: 403 });
  });

  it('lets any Member read, write, and run checks', () => {
    for (const a of ['read', 'write', 'runCheck'] as const) {
      expect(decide(membership('member'), a)).toEqual({ allow: true });
      expect(decide(membership('host'), a)).toEqual({ allow: true });
    }
  });
});

describe('withTripGuard', () => {
  it('passes the caller, tripId, and Membership to the handler when allowed', async () => {
    const repos = await seeded();
    const guarded = withTripGuard(
      'read',
      async ({ caller, tripId, membership: m, deps }) => {
        const trip = await deps.trips.get(tripId);
        return json(200, { caller: caller.userId, tripId, role: m.role, name: trip?.name });
      },
      repos,
    );
    const res = await guarded(event('member', 't1'), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ caller: 'member', tripId: 't1', role: 'member', name: 'SD' });
    expect(repos.table.calls.map((c) => `${c.repo}.${c.method}`)).toEqual(['memberships.get', 'trips.get']);
    expect(repos.table.calls[0]!.args).toEqual(['t1', 'member']);
  });

  it('returns 403 FORBIDDEN to a Member who is not the Host for invite', async () => {
    const repos = await seeded();
    let ran = false;
    const guarded = withTripGuard('invite', async () => ((ran = true), json(201, {})), repos);
    const res = await guarded(event('member', 't1'), ctx);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'FORBIDDEN' });
    expect(ran).toBe(false);
    expect((await guarded(event('host', 't1'), ctx)).statusCode).toBe(201);
  });

  it('rejects a malformed tripId with 400 before any repository access', async () => {
    const repos = await seeded();
    const guarded = withTripGuard('read', async () => json(200, {}), repos);
    for (const bad of [undefined, 'a#b', 'a/b', '']) {
      await expect(guarded(event('member', bad), ctx)).rejects.toMatchObject({
        constructor: HttpError,
        status: 400,
        code: 'VALIDATION',
      });
    }
    expect(repos.table.calls).toEqual([]);
  });

  it('denies non-Members with 403 and no trip data; only the Membership lookup happens', async () => {
    const repos = await seeded();
    for (const action of ACTIONS) {
      for (const [userId, tripId] of [['stranger', 't1'], ['member', 'other-trip']] as const) {
        repos.table.calls.length = 0;
        let ran = false;
        const guarded = withTripGuard(
          action,
          async ({ deps }) => ((ran = true), json(200, { trip: await deps.trips.get(tripId) })),
          repos,
        );
        const res = await guarded(event(userId, tripId), ctx);
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ error: 'FORBIDDEN' });
        expect(ran).toBe(false);
        expect(repos.table.calls).toEqual([{ repo: 'memberships', method: 'get', args: [tripId, userId] }]);
      }
    }
  });
});
