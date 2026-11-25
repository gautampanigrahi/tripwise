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

/** The only values that may reach the draft prompt (Req 22.5, 22.6). */
export interface DraftPromptInput {
  notes: string;
  trip: { startDate: IsoDate; endDate: IsoDate; destination: string };
  travelerCount?: number;
  /** Display names only, never IDs or emails. */
  memberNames: string[];
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
    'Use YYYY-MM-DD dates within the trip dates and HH:mm 24-hour times.',
    'When a field names a person, use a Member display name from the list exactly as written.',
    'Give costCents (integer cents) only when the notes state a price. Do not invent prices.',
    `Return at most ${MAX_DRAFT_ITEMS} items.`,
    `Example: ${SCHEMA_EXAMPLE}`,
  ].join('\n');

  const facts = [
    `Destination: ${input.trip.destination}`,
    `Trip start date: ${input.trip.startDate}`,
    `Trip end date: ${input.trip.endDate}`,
  ];
  if (input.travelerCount !== undefined) facts.push(`Traveler count: ${input.travelerCount}`);
  facts.push(`Member display names: ${input.memberNames.join(', ')}`);

  const user = [
    facts.join('\n'),
    `Sections and fields:\n${sectionList}`,
    `<notes>\n${input.notes}\n</notes>`,
  ].join('\n\n');
  return { system, user };
}

type ParsedEntry = { section: string; fields: Record<string, unknown> };

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
): { ok: true; items: ParsedEntry[] } | { ok: false } {
  const unfenced = text.replace(/```[a-zA-Z]*/g, '');
  const json = firstJson(unfenced);
  if (json === undefined) return { ok: false };

  let entries: unknown[];
  if (Array.isArray(json)) entries = json;
  else if (isPlainObject(json) && Array.isArray(json.items)) entries = json.items;
  else if (isPlainObject(json) && Array.isArray(json.drafts)) entries = json.drafts;
  else entries = [json];

  const items: ParsedEntry[] = [];
  for (const e of entries) {
    if (isPlainObject(e) && typeof e.section === 'string' && isPlainObject(e.fields)) {
      items.push({ section: e.section, fields: { ...e.fields } });
    }
  }
  return { ok: true, items };
}

const DRAFTING_SET: ReadonlySet<string> = new Set(DRAFTING_SECTIONS);

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
