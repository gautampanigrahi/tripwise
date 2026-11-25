import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  EngineInputError,
  buildAlternativeInput,
  runChecks,
  scoreLabel,
  selectCurrentLodging,
  stayFromLodging,
  type EngineInput,
} from '@tripwise/engine';
import { templateExplanation, toFacts, type ChosenExplanation } from '@tripwise/grounding';
import { checkResultMessage, type Catalog, type CheckName, type CheckResult, type ItineraryFields } from '@tripwise/shared';
import { loadCatalog } from '../adapters/catalog.js';
import { safePublish, type PublishInput } from '../adapters/notify.js';
import { HttpError, json, type HttpResult } from '../lib/http.js';
import { log, metrics, MetricUnit } from '../lib/logging.js';
import { dispatch, type ApiEvent, type RouteDef, type RouteRequest } from '../lib/routes.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';
import type { CheckRef, Repos } from '../repos/interfaces.js';
import type { ExplainEvent } from './explain.js';

/**
 * checks-fn: run Feasibility Checks, list Check_Result history, and evaluate Alternatives
 * (Req 13.1-13.3, 13.5, 13.6, 20.1, 20.2, 21.6, 24.1, 26.2).
 */
export interface ChecksDeps extends Repos {
  now: () => string;
  newId: () => string;
  /** Optional checks to run in addition to Cost, Capacity, Dates (from `ENABLED_CHECKS`). */
  enabledChecks: CheckName[];
  loadCatalog: () => Promise<Catalog>;
  /** Invokes explain-fn; throws when the invocation or the function fails. */
  explain: (ref: CheckRef) => Promise<ChosenExplanation>;
  publish: (input: PublishInput) => Promise<boolean>;
}
type Req = RouteRequest<ChecksDeps>;

const CHECK_NAMES: readonly CheckName[] = ['Cost', 'Capacity', 'Dates', 'Schedule', 'Preferences'];

/** Parses `ENABLED_CHECKS` (e.g. `Cost,Capacity,Dates,Schedule`), ignoring unknown names. */
export function parseEnabledChecks(raw: string | undefined): CheckName[] {
  const names = (raw ?? '').split(',').map((s) => s.trim());
  return CHECK_NAMES.filter((n) => names.includes(n));
}

function bodyOf(event: ApiEvent): Record<string, unknown> {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError('VALIDATION', { fields: [{ field: 'body', message: 'Must be a JSON object' }] });
}

/** Loads the current plan, constraints, and Catalog as engine input. 422 MISSING_INPUT if absent (Req 13.5). */
async function loadInput(deps: ChecksDeps, tripId: string): Promise<{ input: EngineInput; catalog: Catalog }> {
  const [lodging, transport, itinerary, constraints] = await Promise.all([
    deps.planItems.list(tripId, 'Lodging'),
    deps.planItems.list(tripId, 'Transportation'),
    deps.planItems.list(tripId, 'Itinerary'),
    deps.constraints.get(tripId),
  ]);
  const current = selectCurrentLodging(lodging);
  if (!current) throw new HttpError('MISSING_INPUT', { missing: 'Lodging' });
  if (!constraints) throw new HttpError('MISSING_INPUT', { missing: 'TripConstraints' });
  const catalog = await deps.loadCatalog();
  const { lastModifiedAt: _a, lastModifiedBy: _b, ...tripConstraints } = constraints;
  const input: EngineInput = {
    stay: stayFromLodging(current),
    transportCostsCents: transport.flatMap((t) => (typeof t.fields.costCents === 'number' ? [t.fields.costCents] : [])),
    itinerary: itinerary.map((it) => {
      const f = it.fields as unknown as ItineraryFields;
      return { itemId: it.itemId, day: f.day, startTime: f.startTime, stopName: f.stopName };
    }),
    constraints: tripConstraints,
    catalog,
    enabledChecks: deps.enabledChecks,
  };
  return { input, catalog };
}

/** Runs the engine, saves the Check_Result, adds its explanation, and alerts every Member. */
async function evaluate(req: Req, input: EngineInput, kind: CheckResult['kind']): Promise<CheckResult> {
  const { deps } = req;
  const tripId = req.tripId!;
  const started = Date.now();
  let output;
  try {
    output = runChecks(input);
  } catch (err) {
    if (err instanceof EngineInputError) throw new HttpError('UNKNOWN_ACTIVITY', { activityId: err.ref });
    throw err;
  }
  const { label, failed } = scoreLabel(output.outcomes);
  const evaluatedStay: CheckResult['evaluatedStay'] = { name: input.stay.name };
  if (input.stay.stayId !== undefined) evaluatedStay.stayId = input.stay.stayId;
  const result: CheckResult = {
    tripId,
    checkId: deps.newId(),
    runAt: deps.now(),
    kind,
    evaluatedStay,
    catalogVersion: input.catalog.version,
    outcomes: output.outcomes,
    score: output.score,
    label,
    tripNights: output.tripNights,
  };
  await deps.checkResults.put(result);
  metrics.addMetric('CheckRunDurationMs', MetricUnit.Milliseconds, Date.now() - started);
  metrics.addMetric('FailedCheckCount', MetricUnit.Count, failed.length);

  const ref: CheckRef = { tripId, runAt: result.runAt, checkId: result.checkId };
  let explained: ChosenExplanation;
  try {
    explained = await deps.explain(ref);
  } catch (err) {
    log.warn('explain-fn failed', { event: 'EXPLAIN_INVOKE_FAILED', tripId, error: (err as Error)?.message });
    explained = { text: templateExplanation(toFacts(result)), source: 'template' };
    await deps.checkResults.setExplanation(ref, explained.text, explained.source);
  }
  result.explanation = explained.text;
  result.explanationSource = explained.source;

  const [trip, members] = await Promise.all([deps.trips.get(tripId), deps.memberships.listByTrip(tripId)]);
  const message = checkResultMessage(trip?.name ?? tripId, result.score, result.label);
  await Promise.all(
    members.map((m) => deps.publish({ tripId, kind: 'CHECK_RESULT', recipient: m.email, message })),
  );
  return result;
}

async function runCheck(req: Req): Promise<HttpResult> {
  const { input } = await loadInput(req.deps, req.tripId!);
  return json(201, { result: await evaluate(req, input, 'standard') });
}

async function listResults(req: Req): Promise<HttpResult> {
  return json(200, { results: await req.deps.checkResults.history(req.tripId!) });
}

async function runAlternative(req: Req): Promise<HttpResult> {
  const stayId = bodyOf(req.event).stayId;
  if (typeof stayId !== 'string' || stayId === '') {
    throw new HttpError('VALIDATION', { fields: [{ field: 'stayId', message: 'Is required' }] });
  }
  const base = await req.deps.checkResults.latest(req.tripId!, 'standard');
  if (!base) throw new HttpError('NO_BASE_RESULT');
  const { input, catalog } = await loadInput(req.deps, req.tripId!);
  const stay = catalog.stays.find((s) => s.id === stayId);
  if (!stay) throw new HttpError('VALIDATION', { fields: [{ field: 'stayId', message: 'Not a Catalog stay' }] });
  const alt = buildAlternativeInput(input, stay, base.outcomes.map((o) => o.check));
  return json(201, { result: await evaluate(req, alt, 'alternative') });
}

export const routes: RouteDef<ChecksDeps>[] = [
  { routeKey: 'POST /trips/{tripId}/checks', guard: 'runCheck', run: runCheck },
  { routeKey: 'GET /trips/{tripId}/checks', guard: 'read', run: listResults },
  { routeKey: 'POST /trips/{tripId}/checks/alternatives', guard: 'runCheck', run: runAlternative },
];

let lambda: LambdaClient | undefined;

/** Synchronously invokes explain-fn (`EXPLAIN_FUNCTION_NAME`) and returns its `{ text, source }`. */
async function invokeExplain(ref: CheckRef): Promise<ChosenExplanation> {
  const event: ExplainEvent = ref;
  const res = await (lambda ??= new LambdaClient({})).send(
    new InvokeCommand({ FunctionName: process.env.EXPLAIN_FUNCTION_NAME, Payload: JSON.stringify(event) }),
  );
  if (res.FunctionError) throw new Error(`explain-fn ${res.FunctionError}`);
  const out = JSON.parse(new TextDecoder().decode(res.Payload)) as ChosenExplanation;
  if (typeof out?.text !== 'string' || (out.source !== 'bedrock' && out.source !== 'template')) {
    throw new Error('explain-fn returned an invalid payload');
  }
  return out;
}

let deps: ChecksDeps | undefined;

/** Builds the checks-fn handler over the given deps (tests pass in-memory repos and fakes). */
export const createChecksHandler = (getDeps: () => ChecksDeps) => dispatch(routes, getDeps);

export const handler = createChecksHandler(
  () =>
    (deps ??= {
      ...createDynamoRepos(),
      now: () => new Date().toISOString(),
      newId: () => globalThis.crypto.randomUUID(),
      enabledChecks: parseEnabledChecks(process.env.ENABLED_CHECKS),
      loadCatalog: () => loadCatalog(),
      explain: invokeExplain,
      publish: (input) => safePublish(input),
    }),
);
