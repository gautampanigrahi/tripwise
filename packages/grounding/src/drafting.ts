import { z } from 'zod';
import type { FieldError, IsoDate, Membership } from '@tripwise/shared';
import { extractNumbers } from './verify.js';

/** Sections that drafting may produce (Req 22.9). */
export const DRAFTING_SECTIONS = ['Itinerary', 'Groceries', 'Checklist', 'Reservations', 'Transportation'] as const;
export type DraftingSection = (typeof DRAFTING_SECTIONS)[number];
export const MAX_DRAFT_NOTES = 4000;
export const MAX_DRAFT_ITEMS = 20;

/**
 * Field names the model may use per Drafting_Section. They match the strict Section schemas
 * in `@tripwise/shared`, except the person fields (`responsibleMember`, `claimedBy`), which
 * the model fills with display names and the handler maps to user IDs (Req 22.11).
 */
export const DRAFT_FIELDS: Record<DraftingSection, readonly string[]> = {
  Itinerary: ['day', 'startTime', 'endTime', 'stopName', 'notes'],
  Groceries: ['name', 'quantity', 'responsibleMember', 'purchased'],
  Checklist: ['task', 'done', 'claimedBy'],
  Reservations: ['title', 'notes', 'date', 'link', 'costCents'],
  Transportation: ['title', 'notes', 'date', 'link', 'costCents'],
};

/** Request body for `POST /trips/{tripId}/drafts`; strict, so unknown keys are rejected (Req 4.4). */
export const DraftRequestSchema = z.strictObject({
  itemIds: z.array(z.string().min(1)).max(50).optional(),
  notes: z.string().optional(),
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** One existing itinerary stop the model may move or remove. Names and times only, never an item id. */
export interface ItineraryStopLine {
  stopName: string;
  day: string;
  startTime: string;
}

/** The only values that may reach the draft prompt (Req 22.5, 22.6), plus the current itinerary stops so a note can move or remove one. */
export interface DraftPromptInput {
  notes: string;
  trip: { startDate: IsoDate; endDate: IsoDate; destination: string };
  travelerCount?: number;
  /** Display names only, never IDs or emails. */
  memberNames: string[];
  /** Current itinerary stops. Omitted when the trip has none. */
  itinerary?: readonly ItineraryStopLine[];
}

export interface DraftItem {
  /** Random UUID, not persisted. */
  draftId: string;
  section: DraftingSection;
  /** Raw fields, in the shape the create-item route accepts. */
  fields: Record<string, unknown>;
  /** Equals `validatePlanItem(section, fields, ctx).ok`. */
  valid: boolean;
  /** Empty when valid (Req 22.16). */
  errors: FieldError[];
  /** Checklist only: the resolved claimer, kept out of `fields` because `claimedBy` is server-controlled. */
  suggestedClaimedBy?: string;
  /** Present when the note changes an existing itinerary stop. Omitted for a new item. */
  action?: 'update' | 'delete';
  /** The itinerary Plan_Item this draft will change. */
  targetItemId?: string;
  /** Stored lastModifiedAt, sent back with an update so a stale stop is not overwritten. */
  expectedLastModifiedAt?: string;
  /** The stop as it is now, so the card can say what moves or gets removed. */
  before?: { stopName: string; day: string; startTime: string };
}

export interface DraftResponse {
  drafts: DraftItem[];
}

const SCHEMA_EXAMPLE =
  '[{"section":"Groceries","fields":{"name":"Eggs","quantity":12,"responsibleMember":"Sam"}},' +
  '{"section":"Itinerary","fields":{"day":"2025-06-13","startTime":"10:00","stopName":"Balboa Park"}}]';

/** Builds the Bedrock prompt from whitelisted values only (Req 22.5, 22.6, 22.8). */
export function buildDraftPrompt(input: DraftPromptInput): { system: string; user: string } {
  const sectionList = DRAFTING_SECTIONS.map((s) => `- ${s}: ${DRAFT_FIELDS[s].join(', ')}`).join('\n');
  const system = [
    'You turn rough trip-planning notes into draft plan items.',
    'Return only JSON: an array of objects {"section": <one of the listed sections>, "fields": { ... }}. No prose and no Markdown.',
    'Use only the listed sections and only the listed field names for each section.',
    'Create an item only when the notes explicitly mention that thing. One mentioned thing is one item.',
    'Do not fill sections the notes do not mention, and do not invent extra stops, groceries, tasks, reservations, or rides.',
    'Do not plan the flight, the landing, the hotel, meals, or the rest of the day unless the notes say so.',
    'The destination and trip dates are only for filling in a date the notes already imply.',
    'If the notes do not name a plan item, return [].',
    'When the notes move, reschedule, or remove an existing itinerary stop, return that change instead of a new item.',
    'To move a stop, return {"action":"update","section":"Itinerary","match":"<stop name>","fields":{"day":"YYYY-MM-DD"}} with only the fields that change.',
    'To remove a stop, return {"action":"delete","section":"Itinerary","match":"<stop name>","fields":{}}.',
    'When more than one stop has the same name, set "fromDay" to the current YYYY-MM-DD of the one the notes mean.',
    'Do not update or delete a stop unless the notes ask for that change.',
    'Use YYYY-MM-DD dates within the trip dates and HH:mm 24-hour times.',
    'When a field names a person, use a Member display name from the list exactly as written.',
    'Give costCents (integer cents) only when the notes state a price. Do not invent prices.',
    `Return at most ${MAX_DRAFT_ITEMS} items.`,
    `Example of the shape only. Do not copy these places or items unless the notes say them: ${SCHEMA_EXAMPLE}`,
  ].join('\n');

  const facts = [
    `Destination: ${input.trip.destination}`,
    `Trip start date: ${input.trip.startDate}`,
    `Trip end date: ${input.trip.endDate}`,
  ];
  if (input.travelerCount !== undefined) facts.push(`Traveler count: ${input.travelerCount}`);
  facts.push(`Member display names: ${input.memberNames.join(', ')}`);
  if (input.itinerary && input.itinerary.length > 0) {
    const lines = input.itinerary.map((stop) => `- ${stop.stopName} | ${stop.day} | ${stop.startTime}`);
    facts.push(`Existing itinerary stops:\n${lines.join('\n')}`);
  }

  const user = [
    facts.join('\n'),
    `Sections and fields:\n${sectionList}`,
    `<notes>\n${input.notes}\n</notes>`,
  ].join('\n\n');
  return { system, user };
}

export interface ParsedDraftEntry {
  section: string;
  fields: Record<string, unknown>;
  /** Set only for a move or a removal. A new item leaves this unset. */
  action?: 'update' | 'delete';
  /** Stop name the notes refer to, for update and delete. */
  match?: string;
  /** Current day, when the notes pick one of several stops with the same name. */
  fromDay?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Index of the bracket that closes the one at `start`, skipping brackets inside strings; -1 if none. */
function matchingBracket(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') stack.push(c === '[' ? ']' : '}');
    else if (c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The first JSON array or object in `text` that parses, or undefined. */
function firstJson(text: string): unknown {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' && text[i] !== '{') continue;
    const end = matchingBracket(text, i);
    if (end === -1) continue;
    try {
      return JSON.parse(text.slice(i, end + 1));
    } catch {
      // try the next opening bracket
    }
  }
  return undefined;
}

/**
 * Tolerant parse of the model output (Req 22.8). Strips code fences, takes the first JSON
 * array or object, accepts `{ items: [...] }` or `{ drafts: [...] }`, and skips malformed
 * entries. Returns `ok: false` only when no JSON array or object can be parsed.
 */
export function parseDraftResponse(
  text: string,
): { ok: true; items: ParsedDraftEntry[] } | { ok: false } {
  const unfenced = text.replace(/```[a-zA-Z]*/g, '');
  const json = firstJson(unfenced);
  if (json === undefined) return { ok: false };

  let entries: unknown[];
  if (Array.isArray(json)) entries = json;
  else if (isPlainObject(json) && Array.isArray(json.items)) entries = json.items;
  else if (isPlainObject(json) && Array.isArray(json.drafts)) entries = json.drafts;
  else entries = [json];

  const items: ParsedDraftEntry[] = [];
  for (const e of entries) {
    if (!isPlainObject(e) || typeof e.section !== 'string') continue;
    const fields = isPlainObject(e.fields) ? { ...e.fields } : e.action === 'delete' ? {} : undefined;
    if (!fields) continue;
    const item: ParsedDraftEntry = { section: e.section, fields };
    if (e.action === 'update' || e.action === 'delete') item.action = e.action;
    if (typeof e.match === 'string' && e.match.trim() !== '') item.match = e.match.trim();
    if (typeof e.fromDay === 'string' && e.fromDay.trim() !== '') item.fromDay = e.fromDay.trim();
    items.push(item);
  }
  return { ok: true, items };
}

const DRAFTING_SET: ReadonlySet<string> = new Set(DRAFTING_SECTIONS);

const NOTE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'want', 'going', 'gonna', 'wanna',
  'have', 'just', 'some', 'into', 'onto', 'then', 'than', 'them', 'they', 'their', 'your', 'you',
  'our', 'are', 'was', 'were', 'will', 'can', 'could', 'would', 'should', 'please', 'lets', 'let',
  'also', 'really', 'very', 'like', 'there', 'here', 'out', 'get', 'got', 'but', 'not',
]);

function noteWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 2 && !NOTE_STOPWORDS.has(word));
}

/**
 * True when a draft repeats something the notes actually said.
 * "I want to go to the beach" keeps a beach stop and drops an invented landing plan.
 */
export function draftIsAboutNotes(fields: Record<string, unknown>, notes: string, also?: string): boolean {
  const noted = noteWords(notes);
  if (noted.length === 0) return false;
  const said = noteWords(
    [also ?? '', ...Object.values(fields).filter((value): value is string => typeof value === 'string')].join(' '),
  );
  return said.some((word) =>
    noted.some((note) => word === note || (word.length >= 4 && note.length >= 4 && (word.startsWith(note) || note.startsWith(word)))),
  );
}

/**
 * The one stop `match` names, or 'none' / 'many'.
 * `fromDay` narrows the search when two stops share a name.
 * A single partial name matches ("balboa" matches "Balboa Park") when exactly one stop fits.
 */
export function matchItineraryStop<T extends { stopName: string; day: string }>(
  stops: readonly T[],
  match: string,
  fromDay?: string,
): T | 'none' | 'many' {
  const wanted = match.trim().toLowerCase();
  if (!wanted) return 'none';
  const pool = fromDay ? stops.filter((stop) => stop.day === fromDay) : stops;
  const named = (stop: T) => stop.stopName.trim().toLowerCase();
  const exact = pool.filter((stop) => named(stop) === wanted);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return 'many';
  const partial = pool.filter((stop) => {
    const name = named(stop);
    return name.includes(wanted) || wanted.includes(name);
  });
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) return 'many';
  return 'none';
}

/** Keeps only items in a Drafting_Section, in order (Req 22.9). Apply before the 20-item cap. */
export function filterDraftSections<T extends { section: string }>(items: T[]): Array<T & { section: DraftingSection }> {
  return items.filter((i): i is T & { section: DraftingSection } => DRAFTING_SET.has(i.section));
}

/**
 * The userId of the one Member whose display name matches `name` (trimmed, case-insensitive),
 * or undefined when zero or several Members match (Req 22.11, 22.12).
 */
export function resolveMemberName(
  name: unknown,
  members: Array<Pick<Membership, 'userId' | 'displayName'>>,
): string | undefined {
  if (typeof name !== 'string') return undefined;
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  const matches = members.filter((m) => m.displayName.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0]?.userId : undefined;
}

/**
 * Removes `costCents` and `amount` unless the value appears among the numbers in the notes
 * (Req 22.13, 22.14). `costCents` matches as cents or as dollars (cents / 100). Returns a copy.
 */
export function groundDraftCosts<T extends { fields: Record<string, unknown> }>(draft: T, notes: string): T {
  const found = new Set(extractNumbers(notes));
  const fields = { ...draft.fields };
  // Only numbers or numeric strings can be grounded; Number(null) or Number(true) must not match.
  const num = (v: unknown): number =>
    typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
  if ('costCents' in fields) {
    const c = num(fields.costCents);
    if (!(found.has(c) || found.has(c / 100))) delete fields.costCents;
  }
  if ('amount' in fields) {
    if (!found.has(num(fields.amount))) delete fields.amount;
  }
  return { ...draft, fields };
}
