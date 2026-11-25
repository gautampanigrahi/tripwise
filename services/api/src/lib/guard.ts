import type { Membership } from '@tripwise/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import type { MembershipsRepo } from '../repos/interfaces.js';
import { getCaller, type Caller } from './caller.js';
import { errorResponse, parseTripId, type HttpResult } from './http.js';

/** What a `/trips/{tripId}/*` route does, as listed in the design route table. */
export type Action = 'read' | 'write' | 'invite' | 'runCheck';
export const ACTIONS: readonly Action[] = ['read', 'write', 'invite', 'runCheck'];

export type Decision = { allow: true } | { allow: false; status: 403 };

/**
 * The access decision (Req 3.4, 4.2, 4.3). Any Member may read, write, and run checks;
 * only the Host may invite. Non-Members are always denied.
 */
export function decide(membership: Membership | undefined, action: Action): Decision {
  if (!membership) return { allow: false, status: 403 };
  if (action === 'invite' && membership.role !== 'host') return { allow: false, status: 403 };
  return { allow: true };
}

/** The HTTP API event a guarded route receives. */
export type TripEvent = Pick<APIGatewayProxyEventV2WithJWTAuthorizer, 'requestContext' | 'pathParameters'> &
  Partial<APIGatewayProxyEventV2WithJWTAuthorizer>;

/** The guard needs only the Membership lookup; handlers usually get the full `Repos`. */
export interface GuardDeps {
  memberships: Pick<MembershipsRepo, 'get'>;
}

export interface TripRequest<D extends GuardDeps, E extends TripEvent = TripEvent> {
  caller: Caller;
  tripId: string;
  /** The caller's Membership, confirmed by the guard. */
  membership: Membership;
  event: E;
  context: Context;
  deps: D;
}

export type TripHandler<D extends GuardDeps, E extends TripEvent = TripEvent> = (
  req: TripRequest<D, E>,
) => Promise<HttpResult>;

export type GuardedHandler<E extends TripEvent = TripEvent> = (event: E, context: Context) => Promise<HttpResult>;

/**
 * Wraps a `/trips/{tripId}/*` route (Req 4.1). The caller comes from the token, the tripId from the
 * path (400 if malformed, before any read), and the Membership lookup is the only repository access
 * before the decision. A denial returns `403 { error: 'FORBIDDEN' }` with no trip data and the
 * wrapped handler never runs.
 *
 * `deps` is injected so tests can pass the in-memory fakes and assert on the recorded calls.
 */
export function withTripGuard<D extends GuardDeps, E extends TripEvent = TripEvent>(
  action: Action,
  handler: TripHandler<D, E>,
  deps: D,
): GuardedHandler<E> {
  return async (event, context) => {
    const caller = getCaller(event);
    const tripId = parseTripId(event.pathParameters?.tripId);
    const membership = await deps.memberships.get(tripId, caller.userId);
    const decision = decide(membership, action);
    if (!decision.allow || !membership) return errorResponse('FORBIDDEN');
    return handler({ caller, tripId, membership, event, context, deps });
  };
}
