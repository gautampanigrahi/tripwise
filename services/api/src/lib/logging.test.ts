import type { Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, json } from './http.js';
import { MetricUnit, log, metrics, withRequestLogging, type RequestEvent } from './logging.js';

const context = { awsRequestId: 'aws-req' } as Context;
const event: RequestEvent = { routeKey: 'GET /trips/{tripId}', requestContext: { requestId: 'req-1' } };

/** Captures every line Powertools writes to stdout/stderr. */
let lines: string[];
beforeEach(() => {
  lines = [];
  const capture = (chunk: unknown) => {
    lines.push(...String(chunk).split('\n').filter((l) => l.trim() !== ''));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});
afterEach(() => vi.restoreAllMocks());

/** Parses captured lines that are JSON objects; skips others such as Node `(node:NNNN) Warning: ...` lines. */
const parsed = () =>
  lines.flatMap((l) => {
    if (!l.trimStart().startsWith('{')) return [];
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
const requestLines = () => parsed().filter((l) => l.message === 'request');

describe('withRequestLogging', () => {
  it('writes one JSON line with requestId, route, status, and durationMs (Req 26.1)', async () => {
    const res = await withRequestLogging(async () => json(201, { ok: true }))(event, context);
    expect(res.statusCode).toBe(201);
    expect(parsed()).toHaveLength(1);
    const [line] = requestLines();
    expect(line).toMatchObject({ level: 'INFO', requestId: 'req-1', route: 'GET /trips/{tripId}', status: 201 });
    expect(typeof line?.durationMs).toBe('number');
    expect(line?.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the Lambda request ID when the event has none', async () => {
    await withRequestLogging(async () => json(200, {}))({}, context);
    expect(requestLines()[0]).toMatchObject({ requestId: 'aws-req', route: 'unknown', status: 200 });
  });

  it('maps a thrown HttpError to its response and logs its status', async () => {
    const res = await withRequestLogging(async () => {
      throw new HttpError('FORBIDDEN');
    })(event, context);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'FORBIDDEN' });
    expect(parsed()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ level: 'INFO', status: 403 });
  });

  it('maps an unexpected error to 500 INTERNAL and logs the redacted error on the same line', async () => {
    const err = Object.assign(new Error('boom'), { doorCode: '4321' });
    const res = await withRequestLogging(async () => {
      throw err;
    })(event, context);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'INTERNAL', requestId: 'req-1' });
    expect(parsed()).toHaveLength(1);
    const [line] = requestLines();
    expect(line).toMatchObject({ level: 'ERROR', status: 500, error: { message: 'boom', doorCode: '[REDACTED]' } });
    expect(lines.join('\n')).not.toContain('4321');
  });

  it('publishes stored metrics in the TripWise namespace after the request', async () => {
    await withRequestLogging(async () => {
      metrics.addMetric('FailedCheckCount', MetricUnit.Count, 2);
      return json(201, {});
    })(event, context);
    const emf = parsed().find((l) => '_aws' in l) as { _aws: { CloudWatchMetrics: { Namespace: string }[] } };
    expect(emf._aws.CloudWatchMetrics[0]?.Namespace).toBe('TripWise');
    expect(emf).toMatchObject({ FailedCheckCount: 2 });
    expect(requestLines()).toHaveLength(1);
  });
});

describe('log', () => {
  it('redacts secrets in every payload (Req 25.6)', () => {
    log.info('saved', {
      item: { confirmationNumber: 'CONF-99', checkInDetails: { doorCode: '1234' }, name: 'Gaslamp' },
      headers: { Authorization: 'Bearer eyJsecret' },
    });
    log.warn('w', { idToken: 'tok-1' });
    log.error('e', { accessToken: 'tok-2' });
    const out = lines.join('\n');
    for (const secret of ['CONF-99', '1234', 'eyJsecret', 'tok-1', 'tok-2']) expect(out).not.toContain(secret);
    expect(parsed()[0]).toMatchObject({ message: 'saved', item: { name: 'Gaslamp', confirmationNumber: '[REDACTED]' } });
  });
});
