import { readFileSync } from 'node:fs';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCatalogCache } from '../adapters/catalog.js';
import { log } from '../lib/logging.js';
import { handler } from './catalog.js';

const shipped = readFileSync(new URL('../../../../catalog/san-diego-v1.json', import.meta.url), 'utf8');
const s3Mock = mockClient(S3Client);
// Minimal stand-in for the SDK stream body; only `transformToString` is read.
const body = (text: string) => ({ Body: { transformToString: async () => text } }) as never;
const event = { routeKey: 'GET /catalog', requestContext: { requestId: 'r1' } };
const ctx = { awsRequestId: 'r1' } as Context;

beforeEach(() => {
  s3Mock.reset();
  clearCatalogCache();
  process.env.DATA_BUCKET = 'data-bucket';
  process.env.CATALOG_VERSION = 'san-diego-v1';
  vi.spyOn(log, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /catalog', () => {
  it('returns the shipped Catalog read from catalog/{version}.json (Req 12.1)', async () => {
    s3Mock.on(GetObjectCommand).resolves(body(shipped));
    const res = await handler(event, ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(JSON.parse(shipped));
    expect(s3Mock.commandCalls(GetObjectCommand)[0]!.args[0].input).toEqual({
      Bucket: 'data-bucket',
      Key: 'catalog/san-diego-v1.json',
    });
  });

  it('caches the parsed Catalog across warm invocations', async () => {
    s3Mock.on(GetObjectCommand).resolves(body(shipped));
    await handler(event, ctx);
    await handler(event, ctx);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(1);
  });

  it('returns 500 CATALOG_INVALID with the version and logs the errors (Req 12.5)', async () => {
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    s3Mock.on(GetObjectCommand).resolves(body(JSON.stringify({ version: 'san-diego-v1', stays: [] })));
    const res = await handler(event, ctx);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'CATALOG_INVALID', version: 'san-diego-v1' });
    expect(errorSpy).toHaveBeenCalledWith(
      'Catalog invalid',
      expect.objectContaining({ event: 'CATALOG_INVALID', version: 'san-diego-v1', errors: expect.any(Array) }),
    );
  });
});
