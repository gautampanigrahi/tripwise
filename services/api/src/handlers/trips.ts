import { randomUUID } from 'node:crypto';
import { validateConstraints, validateTripInput, type Trip, type ValidationResult } from '@tripwise/shared';
import { upsertReminder } from '../adapters/scheduler.js';
import { HttpError, errorResponse, json } from '../lib/http.js';
import { dispatch, type ApiEvent, type RouteDef } from '../lib/routes.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';
import type { Repos } from '../repos/interfaces.js';

/** trips-fn dependencies. `upsertReminder` is injectable so tests can record reminder calls. */
export type TripsDeps = Repos & {
  upsertReminder: (input: { tripId: string; startDate: string }) => Promise<unknown>;
};

function parseBody(event: ApiEvent): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError('VALIDATION', { fields: [{ field: 'body', message: 'Body must be valid JSON' }] });
  }
}

function valid<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new HttpError('VALIDATION', { fields: result.errors });
  return result.value;
}

export const routes: RouteDef<TripsDeps>[] = [
  {
    // Req 2.1–2.3, 24.2
    routeKey: 'POST /trips',
    guard: null,
    run: async ({ caller, event, deps }) => {
      const input = valid(validateTripInput(parseBody(event)));
      const trip: Trip = {
        tripId: randomUUID(),
        ...input,
        hostId: caller.userId,
        createdAt: new Date().toISOString(),
      };
      const displayName = caller.email.split('@')[0] || 'Host';
      await deps.trips.create(trip, { displayName, email: caller.email });
      await deps.upsertReminder({ tripId: trip.tripId, startDate: trip.startDate });
      return json(201, trip);
    },
  },
  {
    // Req 2.4: only Trips the caller is a Member of.
    routeKey: 'GET /trips',
    guard: null,
    run: async ({ caller, deps }) => {
      const entries = await deps.trips.listForUser(caller.userId);
      return json(200, { trips: entries.map((e) => ({ tripId: e.tripId, name: e.tripName, role: e.role })) });
    },
  },
  {
    // Req 23.1
    routeKey: 'GET /trips/{tripId}',
    guard: 'read',
    run: async ({ tripId, deps }) => {
      const [trip, members] = await Promise.all([deps.trips.get(tripId!), deps.memberships.listByTrip(tripId!)]);
      if (!trip) return errorResponse('NOT_FOUND');
      return json(200, { trip, members });
    },
  },
  {
    // Req 11.1
    routeKey: 'GET /trips/{tripId}/constraints',
    guard: 'read',
    run: async ({ tripId, deps }) => {
      const constraints = await deps.constraints.get(tripId!);
      return constraints ? json(200, constraints) : errorResponse('NOT_FOUND');
    },
  },
  {
    // Req 11.1–11.3; a start-date change moves the reminder (Req 24.2).
    routeKey: 'PUT /trips/{tripId}/constraints',
    guard: 'write',
    run: async ({ caller, event, tripId, deps }) => {
      const constraints = valid(validateConstraints(parseBody(event)));
      const before = await deps.trips.get(tripId!);
      if (!before) return errorResponse('NOT_FOUND');
      const stored = await deps.constraints.put(tripId!, constraints, {
        lastModifiedBy: caller.userId,
        lastModifiedAt: new Date().toISOString(),
      });
      if (before.startDate !== constraints.startDate) {
        await deps.upsertReminder({ tripId: tripId!, startDate: constraints.startDate });
      }
      return json(200, stored);
    },
  },
];

let deps: TripsDeps | undefined;

/** Builds the trips-fn handler over the given deps (tests pass the in-memory repos). */
export const createTripsHandler = (getDeps: () => TripsDeps) => dispatch(routes, getDeps);

export const handler = createTripsHandler(() => (deps ??= { ...createDynamoRepos(), upsertReminder: (i) => upsertReminder(i) }));
