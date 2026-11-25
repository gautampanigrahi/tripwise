import type { CheckResult, ConstraintsInput, TripConstraints } from "@tripwise/shared";
import type { ApiClient } from "./client";

const enc = encodeURIComponent;

/** Accepts either the bare value or `{ [key]: value }` from the API. */
function unwrap<T>(body: unknown, key: string): T {
  if (body && typeof body === "object" && key in body) return (body as Record<string, T>)[key] as T;
  return body as T;
}

/**
 * `PUT /trips/{tripId}/constraints` (Req 11.1). The body is a `ConstraintsSchema` input:
 * `budget` is a dollar string; the server stores `budgetCents`. 400 `VALIDATION` on bad input.
 */
export async function putConstraints(
  client: ApiClient,
  tripId: string,
  input: ConstraintsInput,
): Promise<TripConstraints> {
  return unwrap<TripConstraints>(await client.put<unknown>(`/trips/${enc(tripId)}/constraints`, input), "constraints");
}

/** `POST /trips/{tripId}/checks` runs every enabled Check and returns the saved Check_Result (Req 13.x). */
export async function runChecks(client: ApiClient, tripId: string): Promise<CheckResult> {
  return unwrap<CheckResult>(await client.post<unknown>(`/trips/${enc(tripId)}/checks`), "result");
}

/**
 * `POST /trips/{tripId}/checks/alternatives` evaluates a Catalog stay in place of the current
 * Lodging without changing any Plan_Item (Req 20.1, 20.2). Returns the `kind: 'alternative'` result.
 */
export async function runAlternative(client: ApiClient, tripId: string, stayId: string): Promise<CheckResult> {
  return unwrap<CheckResult>(
    await client.post<unknown>(`/trips/${enc(tripId)}/checks/alternatives`, { stayId }),
    "result",
  );
}
