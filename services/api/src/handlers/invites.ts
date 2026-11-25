import { randomUUID } from 'node:crypto';
import { inviteMessage } from '@tripwise/shared';
import { safePublish, subscribeRecipient, type NotifyDeps } from '../adapters/notify.js';
import { errorResponse, HttpError, json } from '../lib/http.js';
import { dispatch, type RouteDef } from '../lib/routes.js';
import type { Repos } from '../repos/interfaces.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';

export interface InvitesDeps extends Repos {
  notify: NotifyDeps;
  /** Base URL of the web app; the accept link is `${appUrl}/invitations/{inviteId}/accept`. */
  appUrl: string;
  now: () => string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmail(body: string | undefined): string {
  let email: unknown;
  try {
    email = (JSON.parse(body ?? '{}') as { email?: unknown }).email;
  } catch {
    email = undefined;
  }
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(normalized)) {
    throw new HttpError('VALIDATION', { fields: [{ field: 'email', message: 'Must be an email address' }] });
  }
  return normalized;
}

export const routes: RouteDef<InvitesDeps>[] = [
  {
    // Req 3.1, 3.2, 3.4: Host-only (guard), store pending invite, subscribe and alert the invitee.
    routeKey: 'POST /trips/{tripId}/invitations',
    guard: 'invite',
    async run({ caller, tripId, event, deps }) {
      const email = parseEmail(event.body);
      const trip = await deps.trips.get(tripId!);
      if (!trip) return errorResponse('NOT_FOUND');
      const inv = await deps.invitations.create({
        tripId: trip.tripId,
        inviteId: randomUUID(),
        email,
        invitedBy: caller.userId,
        createdAt: deps.now(),
      });
      const acceptUrl = `${deps.appUrl}/invitations/${encodeURIComponent(inv.inviteId)}/accept`;
      await subscribeRecipient({ tripId: trip.tripId, email }, deps.notify);
      await safePublish(
        { tripId: trip.tripId, kind: 'INVITE', recipient: email, message: inviteMessage(trip.name, acceptUrl) },
        deps.notify,
      );
      return json(201, { inviteId: inv.inviteId, tripId: inv.tripId, email: inv.email, status: inv.status });
    },
  },
  {
    // Req 3.3, 3.5: only a verified, matching email may accept; otherwise 403 with no writes.
    routeKey: 'POST /invitations/{inviteId}/accept',
    guard: null,
    async run({ caller, event, deps }) {
      const inv = await deps.invitations.get(event.pathParameters?.inviteId ?? '');
      if (!inv) return errorResponse('NOT_FOUND');
      if (!caller.emailVerified || caller.email !== inv.email.toLowerCase()) {
        return errorResponse('INVITE_EMAIL_MISMATCH');
      }
      if (inv.status !== 'pending') {
        return inv.acceptedBy === caller.userId ? json(200, { tripId: inv.tripId }) : errorResponse('NOT_FOUND');
      }
      const trip = await deps.trips.get(inv.tripId);
      if (!trip) return errorResponse('NOT_FOUND');
      const result = await deps.invitations.accept({
        tripId: inv.tripId,
        inviteId: inv.inviteId,
        tripName: trip.name,
        member: { userId: caller.userId, displayName: caller.email.split('@')[0] ?? caller.email, email: caller.email },
        acceptedAt: deps.now(),
      });
      if (!result.ok && result.reason === 'NOT_PENDING') return errorResponse('NOT_FOUND');
      // ALREADY_MEMBER: the caller can already open the trip, so treat it as success.
      return json(200, { tripId: inv.tripId });
    },
  },
];

let defaultDeps: InvitesDeps | undefined;
const getDefaultDeps = (): InvitesDeps =>
  (defaultDeps ??= {
    ...createDynamoRepos(),
    notify: {},
    appUrl: (process.env.APP_URL ?? '').replace(/\/+$/, ''),
    now: () => new Date().toISOString(),
  });

/** Creates the invites-fn handler; tests pass in-memory deps. */
export const createHandler = (getDeps: () => InvitesDeps) => dispatch(routes, getDeps);

export const handler = createHandler(getDefaultDeps);
