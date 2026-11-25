import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { redact } from '@tripwise/shared';
import type { Context } from 'aws-lambda';
import { toErrorResponse, type HttpResult } from './http.js';

const SERVICE = 'tripwise-api';

const logger = new Logger({ serviceName: SERVICE });

/** CloudWatch EMF metrics (Req 26.2, 26.3). Published once per request by `withRequestLogging`. */
export const metrics = new Metrics({ namespace: 'TripWise', serviceName: SERVICE });
export { MetricUnit };

type Payload = Record<string, unknown>;

/**
 * The only logging API for handlers. Every payload goes through `redact`, so door codes,
 * confirmation numbers, and tokens never reach CloudWatch (Req 25.6). The raw logger is not exported.
 */
export const log = {
  info: (message: string, payload: Payload = {}) => logger.info(message, redact(payload)),
  warn: (message: string, payload: Payload = {}) => logger.warn(message, redact(payload)),
  error: (message: string, payload: Payload = {}) => logger.error(message, redact(payload)),
};

/** The parts of an HTTP API v2 event the wrapper reads. */
export interface RequestEvent {
  routeKey?: string;
  requestContext?: { requestId?: string };
}

export type HttpHandler<E extends RequestEvent> = (event: E, context: Context) => Promise<HttpResult>;

/**
 * Wraps a Lambda handler so each request writes exactly one JSON log line
 * `{ requestId, route, status, durationMs }` (Req 26.1). A thrown `HttpError` becomes its mapped
 * response; any other error becomes `500 { error: 'INTERNAL', requestId }` and its redacted
 * name, message, and stack are added to that same line. Stored metrics are flushed afterwards.
 */
export function withRequestLogging<E extends RequestEvent>(handler: HttpHandler<E>): HttpHandler<E> {
  return async (event, context) => {
    const start = performance.now();
    const requestId = event.requestContext?.requestId ?? context.awsRequestId;
    const route = event.routeKey ?? 'unknown';
    let result: HttpResult;
    let unexpected: unknown;
    let failed = false;
    try {
      result = await handler(event, context);
    } catch (err) {
      result = toErrorResponse(err, requestId);
      if (result.statusCode >= 500) {
        failed = true;
        unexpected = err;
      }
    }
    const line: Payload = {
      requestId,
      route,
      status: result.statusCode,
      durationMs: Math.round(performance.now() - start),
    };
    if (failed) log.error('request', { ...line, error: unexpected });
    else log.info('request', line);
    if (metrics.hasStoredMetrics()) metrics.publishStoredMetrics();
    return result;
  };
}
