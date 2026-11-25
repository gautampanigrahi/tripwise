import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ItineraryItem } from "@tripwise/shared";
import { ApiClientProvider } from "../api/ApiClientContext";
import { createApiClient } from "../api/client";
import { Itinerary, formatDayParts, tripDayNumber } from "./Itinerary";

// Never called: static rendering runs no effects or handlers.
const client = createApiClient({ baseUrl: "http://localhost", getIdToken: async () => null });
const trip = { startDate: "2026-06-12", endDate: "2026-06-15" };

function stop(itemId: string, day: string, startTime: string, stopName: string): ItineraryItem {
  return {
    tripId: "t1",
    itemId,
    section: "Itinerary",
    fields: { day, startTime, stopName },
    lastModifiedBy: "u1",
    lastModifiedAt: "2026-05-01T10:00:00.000Z",
    createdAt: "2026-05-01T10:00:00.000Z",
  };
}

function render(items: ItineraryItem[]) {
  return renderToStaticMarkup(
    <ApiClientProvider client={client}>
      <Itinerary tripId="t1" trip={trip} items={items} onChanged={() => {}} />
    </ApiClientProvider>,
  );
}

describe("Itinerary helpers", () => {
  it("numbers trip days from the start date", () => {
    expect(tripDayNumber("2026-06-12", trip.startDate)).toBe(1);
    expect(tripDayNumber("2026-06-14", trip.startDate)).toBe(3);
    expect(tripDayNumber("bad", trip.startDate)).toBeUndefined();
  });

  it("splits a day into weekday and date, falling back to the raw value", () => {
    expect(formatDayParts("2026-06-12").weekday).not.toBe("");
    expect(formatDayParts("not-a-date")).toEqual({ weekday: "", date: "not-a-date" });
  });
});

describe("Itinerary timeline", () => {
  it("shows an EmptyState when there are no stops", () => {
    const html = render([]);
    expect(html).toContain("No itinerary stops yet");
    expect(html).toContain("Add stop");
  });

  it("groups stops by day in date order and orders each day by start time", () => {
    const html = render([
      stop("a", "2026-06-13", "14:00", "Zoo"),
      stop("b", "2026-06-12", "18:30", "Dinner"),
      stop("c", "2026-06-13", "09:00", "Breakfast"),
    ]);
    const day12 = html.search(/datetime="2026-06-12"/i);
    expect(day12).toBeGreaterThan(-1);
    expect(day12).toBeLessThan(html.search(/datetime="2026-06-13"/i));
    expect(html.indexOf("Dinner")).toBeLessThan(html.indexOf("Breakfast"));
    expect(html.indexOf("Breakfast")).toBeLessThan(html.indexOf("Zoo"));
    expect(html).toContain("Day 1");
    expect(html).toContain("Day 2");
    expect(html).toContain("2 stops");
  });
});
