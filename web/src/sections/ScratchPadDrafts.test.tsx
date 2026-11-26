import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientProvider } from "../api/ApiClientContext";
import { ApiError, createApiClient, type ApiClient } from "../api/client";
import { createDrafts, type DraftItem } from "../api/drafts";
import { GenericSection, type GenericItem } from "./GenericSection";
import {
  acceptDraft,
  describeDraftError,
  DRAFT_ERROR_MESSAGE,
  DraftList,
  draftValidationContext,
  fieldsFromDraftForm,
  formFromDraft,
  groupDrafts,
  revalidateDraft,
} from "./ScratchPadDrafts";

const members = [
  { userId: "u-ana", displayName: "Ana Ruiz" },
  { userId: "u-ben", displayName: "Ben Okafor" },
];
const trip = { startDate: "2025-06-12", endDate: "2025-06-15" };
const ctx = draftValidationContext(trip, members);
const noop = () => undefined;

const draft = (over: Partial<DraftItem> & Pick<DraftItem, "section" | "fields">): DraftItem => ({
  draftId: `d-${Math.random().toString(36).slice(2)}`,
  valid: true,
  errors: [],
  ...over,
});

/** Real API client over a scripted fetch; records each request. */
function scriptedClient(responses: Record<string, { status: number; body?: unknown }>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const client = createApiClient({
    baseUrl: "https://api.test",
    getIdToken: async () => "tok",
    fetchImpl: async (input, init) => {
      const path = String(input).replace("https://api.test", "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = responses[`${method} ${path}`];
      if (!r) throw new TypeError("Failed to fetch");
      return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
    },
  });
  return { client, calls };
}

const stamp = { tripId: "t1", lastModifiedBy: "u-ana", lastModifiedAt: "2025-06-01T10:00:00.000Z", createdAt: "2025-06-01T10:00:00.000Z" };
const render = (el: ReactElement) =>
  renderToStaticMarkup(<ApiClientProvider client={{} as ApiClient}>{el}</ApiClientProvider>);

describe("acceptDraft", () => {
  const fields = { day: "2025-06-14", startTime: "09:00", stopName: "Balboa Park" };
  const before = { stopName: "Balboa Park", day: "2025-06-13", startTime: "09:00" };

  it("updates the matched stop when a move is accepted", async () => {
    const { client, calls } = scriptedClient({
      "PUT /trips/t1/sections/Itinerary/items/stop1": { status: 200, body: { itemId: "stop1", section: "Itinerary", fields, ...stamp } },
    });
    const outcome = await acceptDraft(
      client,
      "t1",
      draft({ section: "Itinerary", action: "update", fields, targetItemId: "stop1", expectedLastModifiedAt: stamp.lastModifiedAt, before }),
      "u-ana",
    );
    expect(outcome).toEqual({ ok: true, claimed: false, claimFailed: false });
    expect(calls).toEqual([
      { method: "PUT", path: "/trips/t1/sections/Itinerary/items/stop1", body: { fields, expectedLastModifiedAt: stamp.lastModifiedAt } },
    ]);
  });

  it("deletes the matched stop when a removal is accepted", async () => {
    const { client, calls } = scriptedClient({
      "DELETE /trips/t1/sections/Itinerary/items/stop1": { status: 200, body: {} },
    });
    const outcome = await acceptDraft(
      client,
      "t1",
      draft({ section: "Itinerary", action: "delete", fields, targetItemId: "stop1", before }),
      "u-ana",
    );
    expect(outcome).toEqual({ ok: true, claimed: false, claimFailed: false });
    expect(calls.map((c) => [c.method, c.path])).toEqual([["DELETE", "/trips/t1/sections/Itinerary/items/stop1"]]);
  });
});

describe("createDrafts", () => {
  it("posts selected item IDs and notes, leaving out empty values", async () => {
    const drafts = [draft({ section: "Checklist", fields: { task: "Pack sunscreen" } })];
    const { client, calls } = scriptedClient({ "POST /trips/t1/drafts": { status: 200, body: { drafts } } });
    expect(await createDrafts(client, "t1", { itemIds: ["s1"], notes: "  " })).toEqual(drafts);
    await createDrafts(client, "t1", { itemIds: [], notes: "Buy eggs" });
    expect(calls.map((c) => c.body)).toEqual([{ itemIds: ["s1"] }, { notes: "Buy eggs" }]);
  });
});

describe("describeDraftError", () => {
  it("uses the generic message for 502 and network errors, and the returned message for 400", () => {
    expect(describeDraftError(new ApiError(502, { error: "DRAFT_FAILED", reason: "TIMEOUT" }))).toEqual({
      message: DRAFT_ERROR_MESSAGE,
      validation: false,
    });
    expect(describeDraftError(new TypeError("Failed to fetch")).message).toBe(DRAFT_ERROR_MESSAGE);
    const bad = new ApiError(400, {
      error: "VALIDATION",
      fields: [{ field: "notes", message: "Draft notes must be 1 to 4,000 characters" }],
    });
    expect(describeDraftError(bad)).toEqual({ message: "Draft notes must be 1 to 4,000 characters", validation: true });
  });
});

describe("draft editing", () => {
  it("round-trips fields through the form and re-validates with the Trip day range", () => {
    const d = draft({ section: "Itinerary", fields: { day: "2025-06-13", startTime: "10:00", stopName: "Balboa Park" } });
    const form = formFromDraft("Itinerary", d.fields);
    expect(fieldsFromDraftForm("Itinerary", form)).toEqual(d.fields);
    const outOfRange = revalidateDraft(d, { ...d.fields, day: "2025-07-01" }, ctx);
    expect(outOfRange.valid).toBe(false);
    expect(outOfRange.errors.some((e) => e.field === "day")).toBe(true);
    expect(revalidateDraft(outOfRange, d.fields, ctx)).toMatchObject({ valid: true, errors: [] });
  });

  it("converts dollars to cents and flags a missing Groceries Member", () => {
    const fields = fieldsFromDraftForm("Reservations", { title: "Zoo", costCents: "12.50", notes: "", date: "", link: "" });
    expect(fields).toEqual({ title: "Zoo", costCents: 1250 });
    const g = revalidateDraft(draft({ section: "Groceries", fields: {} }), { name: "Eggs", quantity: 12, purchased: false }, ctx);
    expect(g.valid).toBe(false);
    expect(g.errors.map((e) => e.field)).toContain("responsibleMemberId");
  });
});

describe("groupDrafts", () => {
  it("groups by Section in Drafting_Section order", () => {
    const ds = [
      draft({ section: "Transportation", fields: { title: "Car" } }),
      draft({ section: "Itinerary", fields: { day: "2025-06-13", startTime: "10:00", stopName: "Zoo" } }),
      draft({ section: "Transportation", fields: { title: "Train" } }),
    ];
    expect(groupDrafts(ds).map((g) => [g.section, g.drafts.length])).toEqual([
      ["Itinerary", 1],
      ["Transportation", 2],
    ]);
  });
});

describe("acceptDraft", () => {
  const created = { ...stamp, itemId: "c1", section: "Checklist", fields: { task: "Pack", done: false } };

  it("claims a Checklist item only when the suggestion is the accepting Member", async () => {
    const d = draft({ section: "Checklist", fields: { task: "Pack" }, suggestedClaimedBy: "u-ana" });
    const routes = {
      "POST /trips/t1/sections/Checklist/items": { status: 201, body: created },
      "POST /trips/t1/sections/Checklist/items/c1/claim": { status: 200, body: created },
    };
    const mine = scriptedClient(routes);
    expect(await acceptDraft(mine.client, "t1", d, "u-ana")).toEqual({ ok: true, claimed: true, claimFailed: false });
    expect(mine.calls.map((c) => c.path)).toEqual([
      "/trips/t1/sections/Checklist/items",
      "/trips/t1/sections/Checklist/items/c1/claim",
    ]);
    expect(mine.calls[0]?.body).toEqual({ fields: { task: "Pack" } });

    const other = scriptedClient(routes);
    expect(await acceptDraft(other.client, "t1", d, "u-ben")).toMatchObject({ ok: true, claimed: false });
    expect(other.calls).toHaveLength(1);
  });

  it("returns the field errors from a 400 so the card stays", async () => {
    const d = draft({ section: "Checklist", fields: { task: "" } });
    const { client } = scriptedClient({
      "POST /trips/t1/sections/Checklist/items": {
        status: 400,
        body: { error: "VALIDATION", fields: [{ field: "task", message: "Must not be empty" }] },
      },
    });
    expect(await acceptDraft(client, "t1", d, "u-ana")).toMatchObject({
      ok: false,
      rejected: true,
      errors: [{ field: "task", message: "Must not be empty" }],
    });
  });
});

describe("Scratch pad drafting UI", () => {
  const scratch: GenericItem[] = [
    { ...stamp, itemId: "s1", section: "ScratchPad", fields: { title: "Zoo day", notes: "Sam buys eggs" } },
  ];

  it("shows the Draft with AI card and per-item checkbox only on the Scratch pad", () => {
    const html = render(
      <GenericSection tripId="t1" section="ScratchPad" heading="Scratch pad" items={scratch} members={members} onChanged={noop} />,
    );
    expect(html).toContain("Draft with AI");
    expect(html).toContain("Draft from notes");
    expect(html).toContain("0 / 4,000 characters");
    expect(html).toContain("Use for drafting");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Create drafts/);

    const transport = render(
      <GenericSection
        tripId="t1"
        section="Transportation"
        heading="Transportation"
        items={scratch.map((i) => ({ ...i, section: "Transportation" }))}
        members={members}
        onChanged={noop}
      />,
    );
    expect(transport).not.toContain("Draft with AI");
    expect(transport).not.toContain("Use for drafting");
  });

  it("renders draft cards with Section, names, suggestion, errors, and controls", () => {
    const html = render(
      <DraftList
        members={members}
        groups={groupDrafts([
          draft({ section: "Groceries", fields: { name: "Eggs", quantity: 12, responsibleMemberId: "u-ben" } }),
          draft({
            section: "Checklist",
            fields: { task: "" },
            suggestedClaimedBy: "u-ana",
            valid: false,
            errors: [{ field: "task", message: "Must not be empty" }],
          }),
        ])}
      />,
    );
    expect(html).toContain("Ben Okafor");
    expect(html).not.toContain("u-ben");
    expect(html).toContain("Suggested: Ana Ruiz");
    expect(html).toContain("Invalid");
    expect(html).toContain("Must not be empty");
    for (const label of ["Edit draft Eggs", "Accept draft Eggs", "Discard draft Eggs"]) expect(html).toContain(label);
  });
});
