import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import type { ApiEvent } from '../lib/routes.js';
import { createMemoryRepos } from '../repos/memory/index.js';
import { createTripsHandler, routes, type TripsDeps } from './trips.js';

const ctx = { awsRequestId: 'req' } as Context;

function setup() {
  const reminders: { tripId: string; startDate: string }[] = [];
  const deps: TripsDeps = {
    ...createMemoryRepos(),
    upsertReminder: async (i) => void reminders.push(i),
  };
  const handler = createTripsHandler(() => deps);
  const call = async (sub: string, routeKey: string, opts: { tripId?: string; body?: unknown } = {}) => {
    const event = {
      routeKey,
      pathParameters: opts.tripId ? { tripId: opts.tripId } : undefined,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      requestContext: {
        requestId: 'r',
        authorizer: { jwt: { claims: { sub, email: `${sub}@example.com`, email_verified: 'true' }, scopes: [] } },
      },
    } as unknown as ApiEvent;
    const res = await handler(event, ctx);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  return { deps, reminders, call };
}

const tripInput = { name: 'SD', destination: 'San Diego', startDate: '2030-06-01', endDate: '2030-06-05' };
const constraints = {
  destination: 'San Diego',
  startDate: '2030-06-01',
  endDate: '2030-06-05',
  travelerCount: 4,
  budget: '2500',
  budgetType: 'total',
};

describe('trips handler', () => {
  it('exports every trips-fn route with its guard', () => {
    expect(routes.map((r) => [r.routeKey, r.guard])).toEqual([
      ['POST /trips', null],
      ['GET /trips', null],
      ['GET /trips/{tripId}', 'read'],
      ['GET /trips/{tripId}/constraints', 'read'],
      ['PUT /trips/{tripId}/constraints', 'write'],
    ]);
  });

  it('creates a trip with the caller as Host, schedules the reminder, and lists it only for Members', async () => {
    const { call, reminders } = setup();
    const created = await call('host', 'POST /trips', { body: tripInput });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...tripInput, hostId: 'host' });
    const tripId = created.body.tripId as string;
    expect(reminders).toEqual([{ tripId, startDate: '2030-06-01' }]);

    expect((await call('host', 'GET /trips')).body).toEqual({ trips: [{ tripId, name: 'SD', role: 'host' }] });
    expect((await call('stranger', 'GET /trips')).body).toEqual({ trips: [] });

    const got = await call('host', 'GET /trips/{tripId}', { tripId });
    expect(got.status).toBe(200);
    expect(got.body.trip).toMatchObject(tripInput);
    expect(got.body.members).toEqual([expect.objectContaining({ userId: 'host', role: 'host' })]);
    expect((await call('stranger', 'GET /trips/{tripId}', { tripId })).status).toBe(403);
  });

  it('rejects invalid trip input with 400 naming the fields', async () => {
    const { call, reminders } = setup();
    const res = await call('host', 'POST /trips', { body: { ...tripInput, name: ' ', endDate: '2030-06-01' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
    expect(res.body.fields.map((f: { field: string }) => f.field).sort()).toEqual(['endDate', 'name']);
    expect(reminders).toEqual([]);
  });

  it('saves and reads constraints, moving the reminder only when the start date changes', async () => {
    const { call, reminders } = setup();
    const tripId = (await call('host', 'POST /trips', { body: tripInput })).body.tripId as string;
    expect((await call('host', 'GET /trips/{tripId}/constraints', { tripId })).status).toBe(404);

    const saved = await call('host', 'PUT /trips/{tripId}/constraints', { tripId, body: constraints });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ travelerCount: 4, budgetCents: 250000, lastModifiedBy: 'host' });
    expect(reminders).toHaveLength(1);

    const read = await call('host', 'GET /trips/{tripId}/constraints', { tripId });
    expect(read.body).toEqual(saved.body);

    await call('host', 'PUT /trips/{tripId}/constraints', { tripId, body: { ...constraints, startDate: '2030-06-02' } });
    expect(reminders).toEqual([
      { tripId, startDate: '2030-06-01' },
      { tripId, startDate: '2030-06-02' },
    ]);
    expect((await call('host', 'GET /trips/{tripId}', { tripId })).body.trip.startDate).toBe('2030-06-02');
  });

  it('rejects bad traveler count and budget with 400', async () => {
    const { call } = setup();
    const tripId = (await call('host', 'POST /trips', { body: tripInput })).body.tripId as string;
    for (const bad of [{ travelerCount: 0 }, { travelerCount: 1.5 }, { budget: '0' }, { budget: '-5' }]) {
      const res = await call('host', 'PUT /trips/{tripId}/constraints', { tripId, body: { ...constraints, ...bad } });
      expect(res.status).toBe(400);
    }
    expect((await call('stranger', 'PUT /trips/{tripId}/constraints', { tripId, body: constraints })).status).toBe(403);
  });
});
