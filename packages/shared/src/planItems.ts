import type { CatalogStay } from './catalog.js';
import type { ChecklistFields, ItineraryFields, LodgingFields } from './sections.js';
import type { IsoDate, PlanItem } from './types.js';

// ---------- stored item types ----------

/**
 * Field keys inside `PlanItem.fields` that only the server sets. Section schemas reject
 * them in request bodies, so stored values must survive every field update.
 */
export const SERVER_OWNED_FIELD_KEYS = ['confirmationKey', 'claimedBy'] as const;
export type ServerOwnedFieldKey = (typeof SERVER_OWNED_FIELD_KEYS)[number];

/** Lodging fields as stored: `confirmationKey` is recorded by the upload route (Req 6.4). */
export type StoredLodgingFields = LodgingFields & { confirmationKey?: string };
/** Checklist fields as stored: `claimedBy` is set only by the claim route (Req 9.2). */
export type StoredChecklistFields = ChecklistFields & { claimedBy?: string };

export type LodgingItem = PlanItem<StoredLodgingFields>;
export type ChecklistItem = PlanItem<StoredChecklistFields>;
export type ItineraryItem = PlanItem<ItineraryFields>;

// ---------- write stamping (Req 5.1, 5.2, 8.2, 9.3) ----------

/** Adds write metadata. Create and update both go through this one function. */
export function stamp<T>(
  fields: T,
  callerId: string,
  now: () => string,
): T & { lastModifiedBy: string; lastModifiedAt: string } {
  return { ...fields, lastModifiedBy: callerId, lastModifiedAt: now() };
}

// ---------- optimistic concurrency (Req 23.3) ----------

export type ApplyUpdateResult<F> =
  | { ok: true; item: PlanItem<F> }
  | { ok: false; status: 409; current: PlanItem<F> };

/**
 * Pure model of the conditional update `lastModifiedAt = :expected`.
 * Succeeds only when `expected` equals the stored `lastModifiedAt`; otherwise returns 409
 * with the stored item unchanged.
 *
 * On success the result takes field values and write metadata from `next`, but keeps the
 * stored identity (`tripId`, `itemId`, `section`, `createdAt`) and the stored server-owned
 * fields (`confirmationKey`, `claimedBy`), so a client update can neither change nor erase them.
 */
export function applyUpdate<F extends object>(
  stored: PlanItem<F>,
  expected: string,
  next: PlanItem<F>,
): ApplyUpdateResult<F> {
  if (stored.lastModifiedAt !== expected) return { ok: false, status: 409, current: stored };

  const fields = { ...next.fields } as unknown as Record<string, unknown>;
  const storedFields = stored.fields as unknown as Record<string, unknown>;
  for (const key of SERVER_OWNED_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(storedFields, key)) fields[key] = storedFields[key];
    else delete fields[key];
  }

  return {
    ok: true,
    item: {
      ...next,
      tripId: stored.tripId,
      itemId: stored.itemId,
      section: stored.section,
      createdAt: stored.createdAt,
      fields: fields as F,
    },
  };
}

// ---------- Checklist claim (Req 9.2, 9.4) ----------

export type ClaimResult =
  | { ok: true; item: ChecklistItem }
  | { ok: false; status: 409; claimedBy: string };

/**
 * Sets `claimedBy` to the caller when the item is unclaimed or already the caller's.
 * Matches the DynamoDB condition `attribute_not_exists(claimedBy) OR claimedBy = :caller`.
 */
export function claim(item: ChecklistItem, callerId: string): ClaimResult {
  const current = item.fields.claimedBy;
  if (current && current !== callerId) return { ok: false, status: 409, claimedBy: current };
  return { ok: true, item: { ...item, fields: { ...item.fields, claimedBy: callerId } } };
}

// ---------- confirmation files (Req 6.4) ----------

const MAX_FILE_NAME = 100;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Keeps only `[A-Za-z0-9._-]`, removes every `..`, and truncates to 100 chars. */
export function sanitizeFileName(fileName: string): string {
  let s = fileName.replace(/[^A-Za-z0-9._-]/g, '');
  while (s.includes('..')) s = s.replace(/\.\.+/g, '');
  s = s.slice(0, MAX_FILE_NAME);
  return s.length > 0 ? s : 'file';
}

function assertSafeId(name: string, value: string): void {
  if (!SAFE_ID_RE.test(value)) throw new Error(`Invalid ${name} for a confirmation key`);
}

/** S3 prefix for a trip's confirmation files: `private/trips/{tripId}/confirmations/`. */
export function confirmationPrefix(tripId: string): string {
  assertSafeId('tripId', tripId);
  return `private/trips/${tripId}/confirmations/`;
}

/**
 * Object key for an uploaded Lodging confirmation:
 * `private/trips/{tripId}/confirmations/{itemId}/{uuid}-{sanitized}`.
 * `tripId` and `itemId` must be server-generated IDs (`[A-Za-z0-9_-]`, 1–128 chars);
 * anything else throws, so the key can never leave the trip's private prefix.
 */
export function confirmationKey(
  tripId: string,
  itemId: string,
  fileName: string,
  uuid: string = globalThis.crypto.randomUUID(),
): string {
  assertSafeId('itemId', itemId);
  assertSafeId('uuid', uuid);
  return `${confirmationPrefix(tripId)}${itemId}/${uuid}-${sanitizeFileName(fileName)}`;
}

// ---------- Catalog prefill (Req 6.6) ----------

export type LodgingPrefill = Pick<
  LodgingFields,
  'name' | 'address' | 'sleeps' | 'nightlyPriceCents' | 'features' | 'catalogStayId'
>;

/**
 * Lodging fields prefilled from a Catalog stay. The member adds `checkIn`/`checkOut`.
 * Catalog features are a `{ feature: boolean }` map; only `true` features are kept.
 */
export function lodgingFromCatalogStay(stay: CatalogStay): LodgingPrefill {
  return {
    name: stay.name,
    address: stay.address,
    sleeps: stay.sleeps,
    nightlyPriceCents: stay.nightlyPrice.cents,
    features: Object.entries(stay.features)
      .filter(([, has]) => has)
      .map(([feature]) => feature)
      .sort(),
    catalogStayId: stay.id,
  };
}

// ---------- Itinerary display (Req 7.4) ----------

export interface ItineraryDay<I> {
  day: IsoDate;
  items: I[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups Itinerary items by day (ascending). Within a day, items are ordered by
 * `startTime`, with ties broken by `itemId`. Does not mutate the input.
 */
export function groupItinerary<I extends { itemId: string; fields: Pick<ItineraryFields, 'day' | 'startTime'> }>(
  items: readonly I[],
): Array<ItineraryDay<I>> {
  const sorted = [...items].sort(
    (a, b) =>
      cmp(a.fields.day, b.fields.day) ||
      cmp(a.fields.startTime, b.fields.startTime) ||
      cmp(a.itemId, b.itemId),
  );
  const groups: Array<ItineraryDay<I>> = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.day === item.fields.day) last.items.push(item);
    else groups.push({ day: item.fields.day, items: [item] });
  }
  return groups;
}
