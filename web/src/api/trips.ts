import {
  SECTIONS,
  type CheckResult,
  type Membership,
  type PlanItem,
  type Section,
  type Trip,
  type TripConstraints,
  type TripInput,
} from "@tripwise/shared";
import { ApiError, type ApiClient } from "./client";
import { listItems } from "./items";

/** One row of `GET /trips`: a Trip the caller is a Member of (Req 2.4). */
export interface TripSummary {
  tripId: string;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  role?: Membership["role"];
}

export interface Invitation {
  inviteId: string;
  tripId: string;
  email: string;
  status: "pending" | "accepted";
}

export interface AcceptInvitationResult {
  tripId: string;
}

/** Everything the Trip page shows, fetched fresh on every load or reload (Req 23.1). */
export interface TripPageData {
  trip: Trip;
  members: Membership[];
  itemsBySection: Record<Section, PlanItem[]>;
  constraints: TripConstraints | null;
  /** Newest first (Req 13.6). */
  checkResults: CheckResult[];
  latestCheckResult: CheckResult | undefined;
}

const enc = encodeURIComponent;

/** Accepts either a bare array or `{ [key]: array }` from the API. */
function asArray<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const inner = (body as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

export async function listTrips(client: ApiClient): Promise<TripSummary[]> {
  return asArray<TripSummary>(await client.get<unknown>("/trips"), "trips");
}

/** `POST /trips` (Req 2.1). Callers should run `validateTripInput` first. */
export function createTrip(client: ApiClient, input: TripInput): Promise<Trip> {
  return client.post<Trip>("/trips", input);
}

/** `GET /trips/{tripId}` returns the Trip, optionally wrapped as `{ trip, members }`. */
export async function getTrip(
  client: ApiClient,
  tripId: string,
): Promise<{ trip: Trip; members: Membership[] }> {
  const body = await client.get<unknown>(`/trips/${enc(tripId)}`);
  if (body && typeof body === "object" && "trip" in body) {
    const b = body as { trip: Trip; members?: unknown };
    return { trip: b.trip, members: asArray<Membership>(b.members, "members") };
  }
  const trip = body as Trip & { members?: unknown };
  return { trip, members: asArray<Membership>(trip.members, "members") };
}

/** `GET /trips/{tripId}/constraints`; `null` when none are saved yet (404). */
export async function getConstraints(client: ApiClient, tripId: string): Promise<TripConstraints | null> {
  try {
    const body = await client.get<unknown>(`/trips/${enc(tripId)}/constraints`);
    if (body && typeof body === "object" && "constraints" in body) {
      return (body as { constraints: TripConstraints | null }).constraints;
    }
    return (body as TripConstraints | undefined) ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** `GET /trips/{tripId}/checks`, sorted newest first. */
export async function listCheckResults(client: ApiClient, tripId: string): Promise<CheckResult[]> {
  const results = asArray<CheckResult>(await client.get<unknown>(`/trips/${enc(tripId)}/checks`), "results");
  return [...results].sort((a, b) => (a.runAt < b.runAt ? 1 : a.runAt > b.runAt ? -1 : 0));
}

/** The newest standard (non-alternative) Check_Result, if any. Input must be newest first. */
export function latestStandardResult(newestFirst: readonly CheckResult[]): CheckResult | undefined {
  return newestFirst.find((r) => r.kind !== "alternative");
}

/** `POST /trips/{tripId}/invitations` (Req 3.1). Host only; others get 403. */
export function inviteMember(client: ApiClient, tripId: string, email: string): Promise<Invitation> {
  return client.post<Invitation>(`/trips/${enc(tripId)}/invitations`, { email: email.trim().toLowerCase() });
}

/** `POST /invitations/{inviteId}/accept` (Req 3.3). 403 when the email does not match (Req 3.5). */
export function acceptInvitation(client: ApiClient, inviteId: string): Promise<AcceptInvitationResult> {
  return client.post<AcceptInvitationResult>(`/invitations/${enc(inviteId)}/accept`);
}

/**
 * Fetches the Trip, every Section's Plan_Items, the Trip_Constraints, and the Check_Result
 * history in parallel. Called on every Trip page load or reload (Req 23.1); nothing is cached.
 */
export async function loadTripPage(client: ApiClient, tripId: string): Promise<TripPageData> {
  const [tripAndMembers, sectionItems, constraints, checkResults] = await Promise.all([
    getTrip(client, tripId),
    Promise.all(SECTIONS.map((s) => listItems(client, tripId, s))),
    getConstraints(client, tripId),
    listCheckResults(client, tripId),
  ]);
  const itemsBySection = Object.fromEntries(
    SECTIONS.map((s, i) => [s, sectionItems[i] ?? []]),
  ) as Record<Section, PlanItem[]>;
  return {
    ...tripAndMembers,
    itemsBySection,
    constraints,
    checkResults,
    latestCheckResult: latestStandardResult(checkResults),
  };
}

/** Short, user-facing message for an API failure. */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "You don't have access to this.";
    if (err.status === 404) return "Not found.";
    const body = err.body as { error?: unknown } | undefined;
    if (body && typeof body.error === "string") return `Request failed (${err.status}): ${body.error}`;
    return `Request failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Field errors from a 400 `{ error: 'VALIDATION', fields }` response, keyed by field. */
export function validationErrors(err: unknown): Record<string, string> | undefined {
  if (!(err instanceof ApiError) || err.status !== 400) return undefined;
  const fields = (err.body as { fields?: unknown } | undefined)?.fields;
  if (!Array.isArray(fields)) return undefined;
  const out: Record<string, string> = {};
  for (const f of fields as Array<{ field?: unknown; message?: unknown }>) {
    if (typeof f.field === "string" && typeof f.message === "string") out[f.field] ??= f.message;
  }
  return out;
}
