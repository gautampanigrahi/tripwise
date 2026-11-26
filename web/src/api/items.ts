import type { PlanItem, Section } from "@tripwise/shared";
import { ApiError, type ApiClient } from "./client";

/**
 * Plan_Item routes (design.md §3):
 *   GET    /trips/{tripId}/sections/{section}/items
 *   POST   /trips/{tripId}/sections/{section}/items                 body { fields }
 *   PUT    /trips/{tripId}/sections/{section}/items/{itemId}        body { fields, expectedLastModifiedAt }
 *   DELETE /trips/{tripId}/sections/{section}/items/{itemId}
 *   POST   /trips/{tripId}/sections/Checklist/items/{itemId}/claim
 *   POST   /trips/{tripId}/items/{itemId}/confirmation-upload       body { fileName, contentType }
 *   GET    /trips/{tripId}/items/{itemId}/confirmation
 */

const enc = encodeURIComponent;

function sectionPath(tripId: string, section: Section): string {
  return `/trips/${enc(tripId)}/sections/${enc(section)}/items`;
}

function itemPath(tripId: string, section: Section, itemId: string): string {
  return `${sectionPath(tripId, section)}/${enc(itemId)}`;
}

/** Accepts either a bare array or `{ items: [...] }` from the list route. */
function unwrapItems<F>(body: unknown): PlanItem<F>[] {
  if (Array.isArray(body)) return body as PlanItem<F>[];
  if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: PlanItem<F>[] }).items;
  }
  return [];
}

/** Accepts either a bare Plan_Item or `{ item: PlanItem }`. */
function unwrapItem<F>(body: unknown): PlanItem<F> {
  if (body && typeof body === "object" && "item" in body) return (body as { item: PlanItem<F> }).item;
  return body as PlanItem<F>;
}

export async function listItems<F = Record<string, unknown>>(
  client: ApiClient,
  tripId: string,
  section: Section,
): Promise<PlanItem<F>[]> {
  return unwrapItems<F>(await client.get<unknown>(sectionPath(tripId, section)));
}

export async function createItem<F = Record<string, unknown>>(
  client: ApiClient,
  tripId: string,
  section: Section,
  fields: F,
): Promise<PlanItem<F>> {
  return unwrapItem<F>(await client.post<unknown>(sectionPath(tripId, section), { fields }));
}

export type UpdateItemResult<F> = { ok: true; item: PlanItem<F> } | { ok: false; stale: true; current: PlanItem<F> };

/** Returns the stored item from a `409 { error: 'STALE', current }` body, if that is what `err` is. */
export function staleCurrent<F = Record<string, unknown>>(err: unknown): PlanItem<F> | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const body = err.body as { error?: unknown; current?: unknown } | undefined;
  if (body?.error !== "STALE" || !body.current || typeof body.current !== "object") return undefined;
  return body.current as PlanItem<F>;
}

/**
 * Updates an item with optimistic concurrency (Req 23.3). A 409 STALE response resolves
 * to `{ ok: false, current }` with the stored item; every other error is rethrown.
 */
export async function updateItem<F = Record<string, unknown>>(
  client: ApiClient,
  tripId: string,
  section: Section,
  itemId: string,
  fields: F,
  expectedLastModifiedAt: string,
): Promise<UpdateItemResult<F>> {
  try {
    const body = await client.put<unknown>(itemPath(tripId, section, itemId), { fields, expectedLastModifiedAt });
    return { ok: true, item: unwrapItem<F>(body) };
  } catch (err) {
    const current = staleCurrent<F>(err);
    if (current) return { ok: false, stale: true, current };
    throw err;
  }
}

export async function deleteItem(client: ApiClient, tripId: string, section: Section, itemId: string): Promise<void> {
  await client.delete<unknown>(itemPath(tripId, section, itemId));
}

/** Facts read from a public listing. Missing fields were not on the page. */
export interface ListingFacts {
  name?: string;
  address?: string;
  sleeps?: number;
  nightlyPrice?: string;
  /** https pages cited by the web search. */
  sources?: string[];
}

/** Reads a listing link into lodging fields. Nothing is saved until the form is submitted. */
export async function readListingLink(client: ApiClient, tripId: string, listingUrl: string): Promise<ListingFacts> {
  const body = await client.post<ListingFacts>(`/trips/${enc(tripId)}/lodging/from-link`, { listingUrl });
  return body ?? {};
}

/** Claims a Checklist item for the caller. 409 ALREADY_CLAIMED surfaces as an ApiError. */
export async function claimItem<F = Record<string, unknown>>(
  client: ApiClient,
  tripId: string,
  itemId: string,
): Promise<PlanItem<F>> {
  return unwrapItem<F>(await client.post<unknown>(`${itemPath(tripId, "Checklist", itemId)}/claim`));
}

/** Presigned POST target returned by the upload route. */
export interface ConfirmationUploadTarget {
  url: string;
  fields: Record<string, string>;
  key?: string;
}

export async function getConfirmationUploadUrl(
  client: ApiClient,
  tripId: string,
  itemId: string,
  file: { fileName: string; contentType: string },
): Promise<ConfirmationUploadTarget> {
  return client.post<ConfirmationUploadTarget>(
    `/trips/${enc(tripId)}/items/${enc(itemId)}/confirmation-upload`,
    file,
  );
}

export async function getConfirmationDownloadUrl(
  client: ApiClient,
  tripId: string,
  itemId: string,
): Promise<{ url: string }> {
  return client.get<{ url: string }>(`/trips/${enc(tripId)}/items/${enc(itemId)}/confirmation`);
}

export class UploadError extends Error {
  constructor(readonly status: number) {
    super(`Upload failed with status ${status}`);
    this.name = "UploadError";
  }
}

/**
 * Requests a presigned POST, then posts the policy fields followed by the file directly
 * to S3 with plain fetch (no Authorization header) (Req 6.4).
 */
export async function uploadConfirmation(
  client: ApiClient,
  tripId: string,
  itemId: string,
  file: File,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<ConfirmationUploadTarget> {
  const contentType = file.type || "application/octet-stream";
  const target = await getConfirmationUploadUrl(client, tripId, itemId, { fileName: file.name, contentType });
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
  form.append("file", file);
  const res = await fetchImpl(target.url, { method: "POST", body: form });
  if (!res.ok) throw new UploadError(res.status);
  return target;
}
