import { toEpochDay } from "@tripwise/shared";

/** Query sent to the geocoder: the place name, narrowed by the trip's city. */
export function placeQuery(name: string, destination: string): string {
  const place = name.trim();
  const dest = destination.trim();
  return dest ? `${place}, ${dest}` : place;
}

/** Lodging is the start of the drive when it has an address or a name. */
export function stayQuery(lodging: { name?: string; address?: string }, destination: string): string | null {
  const where = lodging.address?.trim() || lodging.name?.trim();
  if (!where) return null;
  return placeQuery(where, destination);
}

/** A place we can drop on the map. Coordinates come from a geocoder, not from the trip record. */
export interface MapPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Set when this pin came from an itinerary item, so saving updates that item instead of adding one. */
  itemId?: string;
  notes?: string;
  /** Expected concurrency token for that item. */
  lastModifiedAt?: string;
  endTime?: string;
  /** A stay used only as the start of the drive, never written as a stop. */
  kind: "stop" | "stay";
}

export interface TravelLeg {
  from: string;
  to: string;
  minutes: number;
  km: number;
}

const EARTH_KM = 6371;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** City-driving guess used only when the road router is unavailable. */
export function driveMinutes(km: number): number {
  if (km <= 0) return 1;
  return Math.max(1, Math.round((km / 40) * 60));
}

/**
 * Visit order that always starts at `startIndex` and then picks the nearest remaining place.
 * Returns indexes into `places`.
 */
export function orderByNearest(places: { lat: number; lng: number }[], startIndex = 0): number[] {
  if (places.length === 0) return [];
  const start = Math.min(Math.max(0, startIndex), places.length - 1);
  const left = new Set(places.map((_, i) => i));
  const order = [start];
  left.delete(start);
  while (left.size > 0) {
    const here = places[order[order.length - 1]!]!;
    let best = -1;
    let bestKm = Infinity;
    for (const i of left) {
      const km = haversineKm(here, places[i]!);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
  }
  return order;
}

export function legsBetween(order: MapPlace[], km: number[], minutes: number[]): TravelLeg[] {
  const legs: TravelLeg[] = [];
  for (let i = 0; i < order.length - 1; i++) {
    legs.push({
      from: order[i]!.name,
      to: order[i + 1]!.name,
      km: round1(km[i] ?? 0),
      minutes: Math.max(1, Math.round(minutes[i] ?? 1)),
    });
  }
  return legs;
}

/** Inclusive YYYY-MM-DD list, capped so a bad range cannot build a huge select. */
export function datesInclusive(start: string, end: string): string[] {
  const a = toEpochDay(start);
  const b = toEpochDay(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 60) return [start];
  const out: string[] = [];
  for (let n = a; n <= b; n++) {
    const dt = new Date(n * 86_400_000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
  }
  return out;
}

/** Adds minutes to an HH:mm clock, stopping at 23:59 so the value stays a valid start time. */
export function addMinutes(time: string, minutes: number): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return "09:00";
  const total = Math.min(23 * 60 + 59, Number(match[1]) * 60 + Number(match[2]) + Math.max(0, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const DRIVE_NOTE = /\d+\s+min drive,.*$/gm;
const PIN_NOTE = /Map pin: (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/;

/** A line stored on the itinerary item so every member plots the same point. */
export function pinNote(lat: number, lng: number): string {
  return `Map pin: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Reads a saved pin. Missing or out-of-range text returns null so the name can be geocoded instead. */
export function readPin(notes: string | undefined): { lat: number; lng: number } | null {
  const match = notes?.match(PIN_NOTE);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Next start time on a day, half an hour after the latest stop, or 09:00 when the day is empty. */
export function nextStartTime(times: readonly string[]): string {
  const latest = times.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)).sort().at(-1);
  return latest ? addMinutes(latest, 30) : "09:00";
}

/** Keeps a person's note and the saved pin, and replaces an older drive sentence. */
export function mergeNotes(existing: string | undefined, drive: string | undefined): string | undefined {
  const pin = existing?.match(PIN_NOTE)?.[0];
  const kept = (existing ?? "").replace(PIN_NOTE, "").replace(DRIVE_NOTE, "").trim();
  const body = [kept, drive].filter(Boolean).join(" ").trim();
  if (pin && body) return `${body}\n${pin}`;
  return pin || body || undefined;
}

export function driveNote(leg: TravelLeg | undefined, fromStay: boolean): string | undefined {
  if (!leg) return undefined;
  const how = fromStay ? "from the stay" : `from ${leg.from}`;
  return `${leg.minutes} min drive, ${leg.km} km, ${how}.`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
