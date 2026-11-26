import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyStructuredResultV2 & { statusCode: number; body: string };

/** JSON response with `content-type: application/json`. */
export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Error codes returned in `{ error: CODE, ... }` bodies and their HTTP status (design: Error Handling). */
export const ERROR_STATUS = {
  VALIDATION: 400,
  UNKNOWN_SECTION: 400,
  FORBIDDEN: 403,
  INVITE_EMAIL_MISMATCH: 403,
  NOT_FOUND: 404,
  ALREADY_CLAIMED: 409,
  STALE: 409,
  MISSING_INPUT: 422,
  UNKNOWN_ACTIVITY: 422,
  NO_BASE_RESULT: 422,
  SUMMARY_UNGROUNDED: 422,
  LISTING_UNREADABLE: 422,
  CATALOG_INVALID: 500,
  INTERNAL: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;

/**
 * An expected failure that handlers throw (or return via `errorResponse`). `details` are merged into
 * the body next to `error`, e.g. `{ fields }` for VALIDATION or `{ current }` for STALE.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'HttpError';
    this.status = ERROR_STATUS[code];
  }
}

/** `{ error: code, ...details }` with the mapped status. `details` cannot override `error`. */
export function errorResponse(code: ErrorCode, details: Record<string, unknown> = {}): HttpResult {
  return json(ERROR_STATUS[code], { ...details, error: code });
}

/**
 * Maps a thrown value to a response. `HttpError` keeps its code and details; anything else becomes
 * `500 { error: 'INTERNAL', requestId }` so stack traces and internal messages never reach the client.
 */
export function toErrorResponse(err: unknown, requestId: string): HttpResult {
  if (err instanceof HttpError) return errorResponse(err.code, err.details);
  return errorResponse('INTERNAL', { requestId });
}

/** Same character set as confirmation-key IDs; keeps `#` and `/` out of DynamoDB and S3 keys. */
const TRIP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Returns the path's `tripId`, or throws `400 VALIDATION` naming the `tripId` field when malformed. */
export function parseTripId(raw: string | undefined): string {
  if (raw === undefined || !TRIP_ID_RE.test(raw)) {
    throw new HttpError('VALIDATION', {
      fields: [{ field: 'tripId', message: 'Must be 1-128 letters, digits, "-" or "_"' }],
    });
  }
  return raw;
}
