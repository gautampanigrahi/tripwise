import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parseCatalog, type Catalog } from '@tripwise/shared';
import { HttpError } from '../lib/http.js';
import { log } from '../lib/logging.js';

export interface CatalogDeps {
  s3?: Pick<S3Client, 'send'>;
  /** Defaults to `process.env.DATA_BUCKET`. */
  bucket?: string;
  /** Defaults to `process.env.CATALOG_VERSION`. */
  version?: string;
}

let defaultClient: S3Client | undefined;
/** Parsed Catalogs kept for the life of a warm Lambda, keyed by version. */
const cache = new Map<string, Catalog>();

/**
 * Loads `catalog/{version}.json` from the data bucket and validates it with `parseCatalog`.
 * On schema failure, logs `{ event: 'CATALOG_INVALID', version, errors }` and throws
 * `HttpError('CATALOG_INVALID', { version })` (Req 12.5).
 */
export async function loadCatalog(deps: CatalogDeps = {}): Promise<Catalog> {
  const version = deps.version ?? process.env.CATALOG_VERSION;
  const bucket = deps.bucket ?? process.env.DATA_BUCKET;
  if (!version || !bucket) throw new Error('CATALOG_VERSION or DATA_BUCKET is not configured');

  const cached = cache.get(version);
  if (cached) return cached;

  const s3 = deps.s3 ?? (defaultClient ??= new S3Client({}));
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `catalog/${version}.json` }));
  const text = (await res.Body?.transformToString()) ?? '';

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = parseCatalog(raw, version);
  if (!parsed.ok) {
    log.error('Catalog invalid', { event: 'CATALOG_INVALID', version, errors: parsed.errors });
    throw new HttpError('CATALOG_INVALID', { version });
  }
  cache.set(version, parsed.catalog);
  return parsed.catalog;
}

/** Test helper: empties the warm cache. */
export function clearCatalogCache(): void {
  cache.clear();
}
