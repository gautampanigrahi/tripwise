import type { RouteDef } from './lib/routes.js';
import { routes as checksRoutes } from './handlers/checks.js';
import { routes as draftsRoutes } from './handlers/drafts.js';
import { routes as invitesRoutes } from './handlers/invites.js';
import { routes as itemsRoutes } from './handlers/items.js';
import { routes as tripsRoutes } from './handlers/trips.js';

/** One API Gateway route: its key, the Lambda (handler file) serving it, and its Membership_Guard action. */
export interface RouteEntry extends Pick<RouteDef, 'routeKey' | 'guard'> {
  fn: 'trips' | 'invites' | 'items' | 'checks' | 'drafts' | 'catalog';
}

const entries = (fn: RouteEntry['fn'], defs: Array<Pick<RouteDef, 'routeKey' | 'guard'>>): RouteEntry[] =>
  defs.map(({ routeKey, guard }) => ({ routeKey, guard, fn }));

/**
 * Every HTTP route (Req 4.1, 4.2, 26.1). Each handler's `dispatch` applies `withTripGuard` for routes
 * with a non-null guard and wraps the Lambda in `withRequestLogging`; `catalog` is wrapped directly.
 */
export const allRoutes: RouteEntry[] = [
  ...entries('trips', tripsRoutes),
  ...entries('invites', invitesRoutes),
  ...entries('items', itemsRoutes),
  ...entries('checks', checksRoutes),
  ...entries('drafts', draftsRoutes),
  { routeKey: 'GET /catalog', guard: null, fn: 'catalog' },
];
