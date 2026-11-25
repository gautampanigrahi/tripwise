import { loadCatalog } from '../adapters/catalog.js';
import { json } from '../lib/http.js';
import { withRequestLogging } from '../lib/logging.js';

/**
 * `GET /catalog`: returns the current Catalog (Req 12.1). Authenticated by the API Gateway JWT
 * authorizer; not trip-scoped. A schema failure becomes `500 { error: 'CATALOG_INVALID', version }`.
 */
export const handler = withRequestLogging(async () => json(200, await loadCatalog()));
