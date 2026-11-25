import { describe, expect, it } from "vitest";
import { SECTIONS, type CheckResult } from "@tripwise/shared";
import { createApiClient } from "./client";
import { latestStandardResult, loadTripPage } from "./trips";
import { matchRoute } from "../router";

const result = (checkId: string, runAt: string, kind: CheckResult["kind"]): CheckResult => ({
  tripId: "t1",
  checkId,
  runAt,
  kind,
  evaluatedStay: { name: "Stay" },
  catalogVersion: "v1",
  outcomes: [],
  score: 100,
  label: "Feasible",
  tripNights: 4,
});

describe("matchRoute", () => {
  it("maps the three app paths", () => {
    expect(matchRoute("/")).toEqual({ name: "trips" });
    expect(matchRoute("/trips/abc")).toEqual({ name: "trip", tripId: "abc" });
    expect(matchRoute("/trips/abc/")).toEqual({ name: "trip", tripId: "abc" });
    expect(matchRoute("/invitations/i%201/accept")).toEqual({ name: "acceptInvite", inviteId: "i 1" });
    expect(matchRoute("/elsewhere")).toEqual({ name: "notFound" });
  });
});

describe("latestStandardResult", () => {
  it("skips alternative results", () => {
    const list = [result("c3", "2025-01-03", "alternative"), result("c2", "2025-01-02", "standard")];
    expect(latestStandardResult(list)?.checkId).toBe("c2");
    expect(latestStandardResult([])).toBeUndefined();
  });
});

describe("loadTripPage", () => {
  it("fetches trip, every section, constraints, and checks with the bearer token", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input).replace("https://api.test", "");
      requested.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url === "/trips/t1") return json(200, { tripId: "t1", name: "SD", destination: "San Diego" });
      if (url === "/trips/t1/constraints") return json(404, { error: "NOT_FOUND" });
      if (url === "/trips/t1/checks")
        return json(200, [result("old", "2025-01-01T00:00:00Z", "standard"), result("new", "2025-01-02T00:00:00Z", "standard")]);
      if (url === "/trips/t1/sections/Lodging/items") return json(200, { items: [{ itemId: "l1", fields: { name: "A" } }] });
      return json(200, []);
    };
    const client = createApiClient({ baseUrl: "https://api.test", getIdToken: async () => "tok", fetchImpl });

    const data = await loadTripPage(client, "t1");

    expect(data.trip.name).toBe("SD");
    expect(data.constraints).toBeNull();
    expect(data.latestCheckResult?.checkId).toBe("new");
    expect(data.itemsBySection.Lodging.map((i) => i.itemId)).toEqual(["l1"]);
    for (const s of SECTIONS) expect(requested).toContain(`/trips/t1/sections/${s}/items`);
  });
});
