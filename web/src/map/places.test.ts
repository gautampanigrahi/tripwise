import { describe, expect, it } from "vitest";
import {
  addMinutes,
  datesInclusive,
  driveNote,
  mergeNotes,
  nextStartTime,
  orderByNearest,
  pinNote,
  placeQuery,
  readPin,
  stayQuery,
} from "./places";
import { parseNominatim, parseOsrmTrip } from "./geo";

describe("place queries", () => {
  it("looks up an itinerary stop in the trip city", () => {
    expect(placeQuery("Balboa Park", "San Diego")).toBe("Balboa Park, San Diego");
  });

  it("prefers a lodging address over the listing name", () => {
    expect(stayQuery({ name: "The house", address: "123 Coast Blvd" }, "San Diego")).toBe("123 Coast Blvd, San Diego");
    expect(stayQuery({ name: "The house" }, "San Diego")).toBe("The house, San Diego");
    expect(stayQuery({}, "San Diego")).toBeNull();
  });
});

describe("orderByNearest", () => {
  it("starts where asked and then walks to the closest remaining point", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    expect(orderByNearest(points, 0)).toEqual([0, 1, 2]);
    expect(orderByNearest(points, 2)).toEqual([2, 1, 0]);
  });
});

describe("clock and dates", () => {
  it("adds minutes and stops at the end of the day", () => {
    expect(addMinutes("09:00", 90)).toBe("10:30");
    expect(addMinutes("23:30", 120)).toBe("23:59");
  });

  it("lists every day of the trip, including the last", () => {
    expect(datesInclusive("2026-07-04", "2026-07-06")).toEqual(["2026-07-04", "2026-07-05", "2026-07-06"]);
  });
});

describe("notes", () => {
  it("replaces an older drive sentence and keeps the rest", () => {
    expect(mergeNotes("Meet at the gate 20 min drive, 8 km, from the hotel.", "12 min drive, 6 km, from Balboa Park.")).toBe(
      "Meet at the gate 12 min drive, 6 km, from Balboa Park.",
    );
  });

  it("keeps a saved pin so every member plots the same point", () => {
    expect(pinNote(32.73, -117.14)).toBe("Map pin: 32.73000, -117.14000");
    expect(readPin("Meet at the gate\nMap pin: 32.73000, -117.14000")).toEqual({ lat: 32.73, lng: -117.14 });
    expect(readPin("no pin here")).toBeNull();
    expect(mergeNotes("Meet at the gate\nMap pin: 32.73000, -117.14000", "12 min drive, 6 km, from the zoo.")).toBe(
      "Meet at the gate 12 min drive, 6 km, from the zoo.\nMap pin: 32.73000, -117.14000",
    );
  });

  it("places a new stop after the latest one that day", () => {
    expect(nextStartTime([])).toBe("09:00");
    expect(nextStartTime(["09:00", "14:00"])).toBe("14:30");
  });

  it("describes the first hop as leaving the stay", () => {
    expect(driveNote({ from: "The house", to: "Zoo", minutes: 18, km: 9.2 }, true)).toBe(
      "18 min drive, 9.2 km, from the stay.",
    );
  });
});

describe("geocoder and router payloads", () => {
  it("reads a nominatim hit", () => {
    expect(parseNominatim([{ display_name: "Balboa Park, San Diego, California", lat: "32.73", lon: "-117.14" }])).toEqual([
      { name: "Balboa Park", lat: 32.73, lng: -117.14 },
    ]);
  });

  it("orders waypoints by the router's visit index", () => {
    const route = parseOsrmTrip(
      {
        code: "Ok",
        waypoints: [{ waypoint_index: 1 }, { waypoint_index: 0 }],
        trips: [
          {
            legs: [{ duration: 600, distance: 5000 }],
            geometry: { coordinates: [[-117.2, 32.7], [-117.1, 32.8]] },
          },
        ],
      },
      2,
    );
    expect(route?.order).toEqual([1, 0]);
    expect(route?.minutes).toEqual([10]);
    expect(route?.km).toEqual([5]);
    expect(route?.line).toEqual([
      [32.7, -117.2],
      [32.8, -117.1],
    ]);
  });
});
