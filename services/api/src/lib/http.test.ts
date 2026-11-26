import { describe, expect, it } from 'vitest';
import { ERROR_STATUS, HttpError, errorResponse, json, parseTripId, toErrorResponse } from './http.js';

describe('json', () => {
  it('serializes the body with a JSON content type', () => {
    expect(json(201, { a: 1 })).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });
});

describe('error mapping', () => {
  it('maps the design error codes to their statuses', () => {
    expect(ERROR_STATUS).toMatchObject({
      VALIDATION: 400,
      UNKNOWN_SECTION: 400,
      FORBIDDEN: 403,
      INVITE_EMAIL_MISMATCH: 403,
      ALREADY_CLAIMED: 409,
      STALE: 409,
      MISSING_INPUT: 422,
      UNKNOWN_ACTIVITY: 422,
      NO_BASE_RESULT: 422,
      SUMMARY_UNGROUNDED: 422,
      LISTING_UNREADABLE: 422,
      CATALOG_INVALID: 500,
      INTERNAL: 500,
    });
  });

  it('errorResponse puts the code in `error` next to the details, and details cannot override it', () => {
    const r = errorResponse('STALE', { current: { itemId: 'i1' }, error: 'OTHER' });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ error: 'STALE', current: { itemId: 'i1' } });
  });

  it('toErrorResponse keeps HttpError code and details', () => {
    const r = toErrorResponse(new HttpError('ALREADY_CLAIMED', { claimedBy: 'u2' }), 'req-1');
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ error: 'ALREADY_CLAIMED', claimedBy: 'u2' });
  });

  it('toErrorResponse turns other errors into 500 INTERNAL without the message', () => {
    const r = toErrorResponse(new Error('db password is hunter2'), 'req-1');
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: 'INTERNAL', requestId: 'req-1' });
    expect(toErrorResponse('thrown string', 'req-2').statusCode).toBe(500);
  });
});

describe('parseTripId', () => {
  it.each(['abc', 'b3c1f0e2-9a4d-4f7e-8c21-0d5e6f7a8b9c', 'A_b-9', 'x'.repeat(128)])('accepts %s', (id) => {
    expect(parseTripId(id)).toBe(id);
  });

  it.each([undefined, '', 'a#b', '../etc', 'a/b', 'a b', 'x'.repeat(129)])('rejects %j with 400 VALIDATION', (id) => {
    let caught: unknown;
    try {
      parseTripId(id);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    const r = toErrorResponse(caught, 'req');
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'VALIDATION', fields: [{ field: 'tripId' }] });
  });
});
