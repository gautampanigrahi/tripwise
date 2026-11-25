import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fc from "fast-check";
import type { CheckResult, ItineraryItem, PlanItem, Section, Trip } from "@tripwise/shared";
import { SECTIONS } from "@tripwise/shared";
import {
  budgetTone,
  countdownText,
  daysBetween,
  latestStandardResult,
  nextStops,
  tripCountdown,
  TripOverview,
} from "./TripOverview";

const trip: Trip = {
  tripId: "t1",
  name: "SD weekend",
  destination: "San Diego",
  startDate: "2025-06-12",
  endDate: "2025-06-16",
  hostId: "u1",
  createdAt: "2025-01-01T00:00:00.000Z",
};

function result(kind: CheckResult["kind"], runAt: string, cost?: { measured: number; limit: number }): CheckResult {
  return {
    tripId: "t1",
    checkId: runAt,
    runAt,
    kind,
    evaluatedStay: { name: "Gaslamp Studio" },
    catalogVersion: "v1",
    outcomes: cost ? [{ check: "Cost", unit: "USD_CENTS", passed: cost.measured <= cost.limit, ...cost }] : [],
    score: 80,
    label: "Not feasible",
    tripNights: 4,
  };
}

function stop(itemId: string, day: string, startTime: string): ItineraryItem {
  return {
    tripId: "t1",
    itemId,
    section: "Itinerary",
    fields: { day, startTime, stopName: itemId },
    lastModifiedBy: "u1",
    lastModifiedAt: "",
    createdAt: "",
  };
}

const emptySections = () => Object.fromEntries(SECTIONS.map((s) => [s, [] as PlanItem[]])) as Record<Section, PlanItem[]>;

describe("tripCountdown", () => {
  it("covers before, on, during, and after the trip", () => {
    expect(tripCountdown(trip.startDate, trip.endDate, "2025-06-01")).toEqual({ kind: "upcoming", days: 11 });
    expect(countdownText(tripCountdown(trip.startDate, trip.endDate, "2025-06-11"))).toBe("Starts tomorrow");
    expect(tripCountdown(trip.startDate, trip.endDate, "2025-06-12")).toEqual({ kind: "today" });
    expect(tripCountdown(trip.startDate, trip.endDate, "2025-06-14")).toEqual({ kind: "ongoing", day: 3, totalDays: 5 });
    expect(tripCountdown(trip.startDate, trip.endDate, "2025-06-17")).toEqual({ kind: "ended" });
  });

  it("daysBetween matches day offsets across months and DST changes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20000 }), fc.integer({ min: -400, max: 400 }), (base, offset) => {
        const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
        expect(daysBetween(iso(base), iso(base + offset))).toBe(offset);
      }),
    );
  });
});

describe("overview helpers", () => {
  it("latestStandardResult skips alternative results", () => {
    const alt = result("alternative", "2025-03-02");
    const std = result("standard", "2025-03-01");
    expect(latestStandardResult([alt, std])).toBe(std);
    expect(latestStandardResult([alt])).toBeUndefined();
  });

  it("budgetTone flags over-budget and near-limit spend", () => {
    expect(budgetTone(1000, 2000)).toBe("pass");
    expect(budgetTone(1900, 2000)).toBe("warning");
    expect(budgetTone(2100, 2000)).toBe("fail");
  });

  it("nextStops returns upcoming stops ordered by day then time", () => {
    const items = [stop("c", "2025-06-13", "09:00"), stop("a", "2025-06-11", "10:00"), stop("b", "2025-06-12", "18:00"), stop("d", "2025-06-12", "08:30")];
    expect(nextStops(items, "2025-06-12").map((s) => s.itemId)).toEqual(["d", "b", "c"]);
  });
});

describe("TripOverview", () => {
  const noop = () => undefined;

  it("prompts to run a check when there is no standard result", () => {
    const html = renderToStaticMarkup(
      <TripOverview
        trip={trip}
        members={[]}
        itemsBySection={emptySections()}
        constraints={null}
        checkResults={[result("alternative", "2025-03-02", { measured: 1, limit: 2 })]}
        onNavigate={noop}
        onInvite={noop}
        today="2025-06-01"
      />,
    );
    expect(html).toContain("Run a check");
    expect(html).not.toContain("role=\"progressbar\"");
  });

  it("shows budget used vs limit from the latest standard Cost outcome", () => {
    const html = renderToStaticMarkup(
      <TripOverview
        trip={trip}
        members={[]}
        itemsBySection={emptySections()}
        constraints={null}
        checkResults={[result("standard", "2025-03-02", { measured: 180000, limit: 250000 })]}
        onNavigate={noop}
        onInvite={noop}
        today="2025-06-01"
      />,
    );
    expect(html).toContain("$1,800.00 of $2,500.00");
    expect(html).toContain("$700.00 left");
  });
});
