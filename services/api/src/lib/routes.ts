import type { Membership } from '@tripwise/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { getCaller, type Caller } from './caller.js';
import { withTripGuard, type Action, type GuardDeps } from './guard.js';
import { errorResponse, type HttpResult } from './http.js';
import { withRequestLogging } from './logging.js';

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

/** What a route's `run` receives. `tripId` and `membership` are set only for guarded routes. */
export interface RouteRequest<D> {
  caller: Caller;
  event: ApiEvent;
  context: Context;
  deps: D;
  tripId?: string;
  membership?: Membership;
}

/** One API route. `guard` is the Membership_Guard action for `/trips/{tripId}/*` routes, else null. */
export interface RouteDef<D = unknown> {
  routeKey: string;
  guard: Action | null;
  run: (req: RouteRequest<D>) => Promise<HttpResult>;
}

/**
 * Builds a Lambda handler that dispatches on `event.routeKey`, applies `withTripGuard` to guarded
 * routes, and is wrapped in `withRequestLogging`. `getDeps` is called per request so deps can be
 * created lazily (and swapped for in-memory fakes in tests).
 */
export function dispatch<D extends GuardDeps>(routes: RouteDef<D>[], getDeps: () => D) {
  return withRequestLogging<ApiEvent>(async (event, context) => {
    const route = routes.find((r) => r.routeKey === event.routeKey);
    if (!route) return errorResponse('NOT_FOUND');
    const deps = getDeps();
    if (route.guard === null) return route.run({ caller: getCaller(event), event, context, deps });
    const guarded = withTripGuard<D, ApiEvent>(route.guard, (req) => route.run(req), deps);
    return guarded(event, context);
  });
}
