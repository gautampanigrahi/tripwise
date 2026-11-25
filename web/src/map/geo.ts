import type { MapPlace, TravelLeg } from "./places";
import { driveMinutes, haversineKm, legsBetween, orderByNearest } from "./places";

export interface GeoHit {
  name: string;
  lat: number;
  lng: number;
}

export interface RoadRoute {
  /** Indexes into the input array, in visit order. */
  order: number[];
  km: number[];
  minutes: number[];
  /** [lat, lng] pairs along the road. */
  line: [number, number][];
}

const cache = new Map<string, GeoHit | null>();
const inflight = new Map<string, Promise<GeoHit | null>>();
let lastRequestAt = 0;

/** Nominatim asks for at most one request a second. Cached hits skip the wait. */
async function pace(): Promise<void> {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

export function nominatimUrl(query: string, limit: number): string {
  const q = new URLSearchParams({ format: "jsonv2", limit: String(limit), q: query });
  return `https://nominatim.openstreetmap.org/search?${q.toString()}`;
}

export function parseNominatim(body: unknown): GeoHit[] {
  if (!Array.isArray(body)) return [];
  const hits: GeoHit[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { display_name?: unknown; lat?: unknown; lon?: unknown };
    const lat = Number(rec.lat);
    const lng = Number(rec.lon);
    if (typeof rec.display_name !== "string" || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    hits.push({ name: shortName(rec.display_name), lat, lng });
  }
  return hits;
}

/** First comma-separated chunk, which is usually the place name rather than the full address. */
function shortName(display: string): string {
  const head = display.split(",")[0]?.trim();
  return head || display;
}

export async function searchPlaces(query: string, limit = 5): Promise<GeoHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  await pace();
  const res = await fetch(nominatimUrl(trimmed, limit), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  return parseNominatim(await res.json());
}

export async function geocode(query: string): Promise<GeoHit | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = searchPlaces(query, 1)
    .then((hits) => {
      const hit = hits[0] ?? null;
      cache.set(key, hit);
      return hit;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export function osrmTripUrl(points: { lat: number; lng: number }[], fixStart: boolean): string {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const q = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    roundtrip: "false",
    source: fixStart ? "first" : "any",
  });
  return `https://router.project-osrm.org/trip/v1/driving/${coords}?${q.toString()}`;
}

export function parseOsrmTrip(body: unknown, count: number): RoadRoute | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as {
    code?: unknown;
    waypoints?: { waypoint_index?: unknown }[];
    trips?: { legs?: { duration?: unknown; distance?: unknown }[]; geometry?: { coordinates?: unknown } }[];
  };
  if (rec.code !== "Ok" || !Array.isArray(rec.waypoints) || rec.waypoints.length !== count) return null;
  const trip = rec.trips?.[0];
  if (!trip || !Array.isArray(trip.legs)) return null;
  const order = rec.waypoints.map((w, inputIndex) => ({
    inputIndex,
    visit: Number(w.waypoint_index),
  }));
  if (order.some((w) => !Number.isInteger(w.visit))) return null;
  order.sort((a, b) => a.visit - b.visit);
  const km: number[] = [];
  const minutes: number[] = [];
  for (const leg of trip.legs) {
    const meters = Number(leg.distance);
    const seconds = Number(leg.duration);
    if (!Number.isFinite(meters) || !Number.isFinite(seconds)) return null;
    km.push(meters / 1000);
    minutes.push(seconds / 60);
  }
  const line: [number, number][] = [];
  const coords = trip.geometry?.coordinates;
  if (Array.isArray(coords)) {
    for (const pair of coords) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const lng = Number(pair[0]);
      const lat = Number(pair[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) line.push([lat, lng]);
    }
  }
  return { order: order.map((w) => w.inputIndex), km, minutes, line };
}

export async function routePlaces(places: MapPlace[], fixStart: boolean): Promise<{
  order: MapPlace[];
  legs: TravelLeg[];
  line: [number, number][];
  approximate: boolean;
}> {
  if (places.length < 2) {
    return { order: places, legs: [], line: places.map((p) => [p.lat, p.lng]), approximate: false };
  }
  try {
    const res = await fetch(osrmTripUrl(places, fixStart));
    if (res.ok) {
      const parsed = parseOsrmTrip(await res.json(), places.length);
      if (parsed && parsed.km.length >= places.length - 1) {
        const order = parsed.order.map((i) => places[i]!);
        return {
          order,
          legs: legsBetween(order, parsed.km, parsed.minutes),
          line: parsed.line,
          approximate: false,
        };
      }
    }
  } catch {
    // Fall through to the straight-line order. The map still works offline of the router.
  }
  const indexes = orderByNearest(places, 0);
  const order = indexes.map((i) => places[i]!);
  const km = order.slice(0, -1).map((p, i) => haversineKm(p, order[i + 1]!));
  return {
    order,
    legs: legsBetween(order, km, km.map(driveMinutes)),
    line: order.map((p) => [p.lat, p.lng]),
    approximate: true,
  };
}
