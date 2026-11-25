import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  DraftRequestSchema,
  MAX_DRAFT_ITEMS,
  MAX_DRAFT_NOTES,
  buildDraftPrompt,
  draftIsAboutNotes,
  filterDraftSections,
  groundDraftCosts,
  parseDraftResponse,
  resolveMemberName,
  type DraftItem,
  type DraftPromptInput,
  type DraftResponse,
  type DraftingSection,
} from '@tripwise/grounding';
import { validatePlanItem, type FieldError, type Membership } from '@tripwise/shared';
import { HttpError, json, type HttpResult } from '../lib/http.js';
import { log, metrics, MetricUnit } from '../lib/logging.js';
import { dispatch, type ApiEvent, type RouteDef, type RouteRequest } from '../lib/routes.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';
import type { Repos } from '../repos/interfaces.js';

/**
 * drafts-fn: turns Scratch pad notes into unsaved Draft_Items with Bedrock (Req 22.3-22.17,
 * 22.24, 22.26-22.29). Reads only; never writes a Plan_Item.
 */
export interface DraftsDeps extends Repos {
  newId: () => string;
  bedrock: BedrockRuntimeClient;
}
type Req = RouteRequest<DraftsDeps>;

export type DraftFailureReason = 'MODEL_ACCESS_DENIED' | 'TIMEOUT' | 'BEDROCK_ERROR' | 'UNPARSEABLE';

/** The Lambda timeout is 10 s; stop waiting at 8 s so there is time to log and return the 502. */
export const DRAFT_TIMEOUT_MS = 8_000;

class DraftFailure extends Error {
  constructor(readonly reason: DraftFailureReason) {
    super(reason);
    this.name = 'DraftFailure';
  }
}

function validationError(fields: FieldError[]): HttpError {
  return new HttpError('VALIDATION', { fields });
}

function bodyOf(event: ApiEvent): unknown {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw validationError([{ field: 'body', message: 'Must be valid JSON' }]);
  }
}

function parseRequest(event: ApiEvent) {
  const parsed = DraftRequestSchema.safeParse(bodyOf(event));
  if (parsed.success) return parsed.data;
  throw validationError(
    parsed.error.issues.flatMap((issue): FieldError[] => {
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((k) => ({ field: k, message: 'Unknown field' }));
      }
      return [{ field: issue.path.join('.') || 'body', message: issue.message }];
    }),
  );
}

/** Selected ScratchPad text (title, then notes; one item per paragraph, in itemIds order) plus the typed notes. */
async function draftNotesOf(deps: DraftsDeps, tripId: string, itemIds: string[], typed: string | undefined) {
  const parts: string[] = [];
  if (itemIds.length > 0) {
    const pad = new Map((await deps.planItems.list(tripId, 'ScratchPad')).map((i) => [i.itemId, i]));
    for (const id of itemIds) {
      const item = pad.get(id);
      if (!item) throw validationError([{ field: 'itemIds', message: 'Unknown Scratch pad item' }]);
      const { title, notes } = item.fields as { title?: unknown; notes?: unknown };
      parts.push([title, notes].filter((v): v is string => typeof v === 'string' && v !== '').join('\n'));
    }
  }
  const trimmed = typed?.trim();
  if (trimmed) parts.push(trimmed);
  const text = parts.join('\n\n').trim();
  if (text.length === 0 || text.length > MAX_DRAFT_NOTES) {
    throw validationError([{ field: 'notes', message: 'Draft notes must be 1 to 4,000 characters' }]);
  }
  return text;
}

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');

/** Calls Converse and returns the reply text; throws `DraftFailure` with the mapped reason (Req 22.24). */
async function converse(bedrock: BedrockRuntimeClient, prompt: { system: string; user: string }): Promise<string> {
  // A global-timer controller (rather than AbortSignal.timeout) so the 8 s limit also applies when the
  // send ignores the signal, and so tests can drive it with fake timers.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Bedrock draft call timed out');
      err.name = 'TimeoutError';
      controller.abort(err);
      reject(err);
    }, DRAFT_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([
      bedrock.send(
        new ConverseCommand({
          modelId: process.env.MODEL_ID,
          system: [{ text: prompt.system }],
          messages: [{ role: 'user', content: [{ text: prompt.user }] }],
          inferenceConfig: { temperature: 0, maxTokens: 1500 },
        }),
        { abortSignal: controller.signal },
      ),
      timedOut,
    ]);
    return res.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  } catch (err) {
    if (controller.signal.aborted || isAbort(err)) throw new DraftFailure('TIMEOUT');
    if (err instanceof Error && err.name === 'AccessDeniedException') throw new DraftFailure('MODEL_ACCESS_DENIED');
    throw new DraftFailure('BEDROCK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

/** Maps person display names to user IDs (Req 22.11, 22.12). Returns a copy. */
function resolvePeople(
  section: DraftingSection,
  fields: Record<string, unknown>,
  members: Membership[],
): { fields: Record<string, unknown>; suggestedClaimedBy?: string } {
  const out = { ...fields };
  if (section === 'Groceries' && 'responsibleMember' in out) {
    const id = resolveMemberName(out.responsibleMember, members);
    delete out.responsibleMember;
    if (id) out.responsibleMemberId = id;
  }
  if (section === 'Checklist' && 'claimedBy' in out) {
    const id = resolveMemberName(out.claimedBy, members);
    delete out.claimedBy;
    return id ? { fields: out, suggestedClaimedBy: id } : { fields: out };
  }
  return { fields: out };
}

async function createDrafts(req: Req): Promise<HttpResult> {
  const { deps } = req;
  const tripId = req.tripId!;
  metrics.addMetric('DraftRequestCount', MetricUnit.Count, 1);

  const body = parseRequest(req.event);
  const [trip, constraints, members] = await Promise.all([
    deps.trips.get(tripId),
    deps.constraints.get(tripId),
    deps.memberships.listByTrip(tripId),
  ]);
  if (!trip) throw new HttpError('NOT_FOUND');
  const notes = await draftNotesOf(deps, tripId, body.itemIds ?? [], body.notes);

  const input: DraftPromptInput = {
    notes,
    trip: { startDate: trip.startDate, endDate: trip.endDate, destination: trip.destination },
    memberNames: members.map((m) => m.displayName),
  };
  if (constraints) input.travelerCount = constraints.travelerCount;

  try {
    const text = await converse(deps.bedrock, buildDraftPrompt(input));
    const parsed = parseDraftResponse(text);
    if (!parsed.ok) throw new DraftFailure('UNPARSEABLE');

    const ctx = {
      trip: { startDate: trip.startDate, endDate: trip.endDate },
      memberIds: new Set(members.map((m) => m.userId)),
    };
    const drafts: DraftItem[] = filterDraftSections(parsed.items)
      .filter((entry) => draftIsAboutNotes(entry.fields, notes))
      .slice(0, MAX_DRAFT_ITEMS)
      .map((entry) => {
        const people = resolvePeople(entry.section, entry.fields, members);
        const { fields } = groundDraftCosts({ fields: people.fields }, notes);
        const result = validatePlanItem(entry.section, fields, ctx);
        const draft: DraftItem = {
          draftId: deps.newId(),
          section: entry.section,
          fields,
          valid: result.ok,
          errors: result.ok ? [] : result.errors,
        };
        if (people.suggestedClaimedBy) draft.suggestedClaimedBy = people.suggestedClaimedBy;
        return draft;
      });

    metrics.addMetric('DraftItemCount', MetricUnit.Count, drafts.length);
    const response: DraftResponse = { drafts };
    return json(200, response);
  } catch (err) {
    if (!(err instanceof DraftFailure)) throw err;
    // Only the reason is logged; never the notes, prompt, or model output (Req 22.26, 22.27).
    log.warn('draft', { event: 'DRAFT_FAILED', tripId, reason: err.reason });
    return json(502, { error: 'DRAFT_FAILED', reason: err.reason });
  }
}

export const routes: RouteDef<DraftsDeps>[] = [
  { routeKey: 'POST /trips/{tripId}/drafts', guard: 'write', run: createDrafts },
];

let deps: DraftsDeps | undefined;

/** Builds the drafts-fn handler over the given deps (tests pass in-memory repos). */
export const createDraftsHandler = (getDeps: () => DraftsDeps) => dispatch(routes, getDeps);

export const handler = createDraftsHandler(
  () =>
    (deps ??= {
      ...createDynamoRepos(),
      newId: () => globalThis.crypto.randomUUID(),
      bedrock: new BedrockRuntimeClient({}),
    }),
);
