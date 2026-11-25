import type { DraftItem, DraftResponse } from "@tripwise/grounding";
import type { ApiClient } from "./client";

export type { DraftItem, DraftResponse, DraftingSection } from "@tripwise/grounding";

export interface CreateDraftsInput {
  /** Selected ScratchPad item IDs (Req 22.1). */
  itemIds?: readonly string[];
  /** "Draft from notes" text (Req 22.2). */
  notes?: string;
}

/**
 * `POST /trips/{tripId}/drafts` (design.md §8a). Returns unsaved Draft_Items; nothing is stored.
 * Errors (400 VALIDATION, 502 DRAFT_FAILED, network) surface as thrown `ApiError`/`Error` from `client.ts`.
 * Empty selections and blank notes are left out of the body.
 */
export async function createDrafts(client: ApiClient, tripId: string, input: CreateDraftsInput): Promise<DraftItem[]> {
  const body: { itemIds?: string[]; notes?: string } = {};
  if (input.itemIds && input.itemIds.length > 0) body.itemIds = [...input.itemIds];
  if (input.notes !== undefined && input.notes.trim() !== "") body.notes = input.notes;
  const res = await client.post<DraftResponse | undefined>(`/trips/${encodeURIComponent(tripId)}/drafts`, body);
  return Array.isArray(res?.drafts) ? res.drafts : [];
}
