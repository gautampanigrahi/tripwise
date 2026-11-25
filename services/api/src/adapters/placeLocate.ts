import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

/** A point worth storing. Coordinates come from a map search, not from the model. */
export interface PlacePoint {
  lat: number;
  lng: number;
}

export interface PlaceLookup {
  stopName: string;
  notes?: string;
  destination: string;
}

export interface PlaceLocateDeps {
  converse?: (system: string, user: string) => Promise<string | null>;
  fetch?: typeof fetch;
}

const LOOKUP_TIMEOUT_MS = 4_000;

const SYSTEM = [
  'You turn a trip stop into a map search.',
  'Reply with JSON only: {"query":"<search string>"}.',
  'The query should name the place and the destination city.',
  'Do not return coordinates. Do not switch to a different place.',
].join(' ');

/** Pulls a short search string out of a model reply. */
export function parsePlaceQuery(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as { query?: unknown };
    if (typeof value.query !== 'string') return null;
    const query = value.query.trim();
    if (query.length === 0 || query.length > 200) return null;
    return query;
  } catch {
    return null;
  }
}

/** First Nominatim hit, if it has usable coordinates. */
export function parseGeocode(body: unknown): PlacePoint | null {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== 'object') return null;
  const row = body[0] as { lat?: unknown; lon?: unknown };
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function fallbackQuery(input: PlaceLookup): string {
  const name = input.stopName.trim();
  const city = input.destination.trim();
  return city ? `${name}, ${city}` : name;
}

async function modelQuery(input: PlaceLookup, converse: PlaceLocateDeps['converse']): Promise<string | null> {
  const modelId = process.env.MODEL_ID;
  if (!modelId && !converse) return null;
  const ask =
    converse ??
    (async (system: string, user: string) => {
      const client = new BedrockRuntimeClient({});
      const res = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: system }],
          messages: [{ role: 'user', content: [{ text: user }] }],
          inferenceConfig: { maxTokens: 120, temperature: 0 },
        }),
        { abortSignal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
      );
      const text = res.output?.message?.content?.map((part) => part.text ?? '').join('') ?? '';
      return text || null;
    });
  const notes = input.notes?.trim();
  const user = [`Destination: ${input.destination}`, `Stop: ${input.stopName}`, notes ? `Notes: ${notes}` : '']
    .filter(Boolean)
    .join('\n');
  try {
    const text = await ask(SYSTEM, user);
    return text ? parsePlaceQuery(text) : null;
  } catch {
    return null;
  }
}

async function geocode(query: string, fetchImpl: typeof fetch): Promise<PlacePoint | null> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    q: query,
  }).toString()}`;
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'TripWise/1.0 (CS 218 course project)' },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return parseGeocode(await res.json());
}

/**
 * Finds a pin for a new stop. The model only chooses the search words.
 * The coordinates are the map search result, and a plain name search is used when the model is unavailable.
 */
export async function locatePlace(input: PlaceLookup, deps: PlaceLocateDeps = {}): Promise<PlacePoint | null> {
  const fetchImpl = deps.fetch ?? fetch;
  const fallback = fallbackQuery(input);
  if (!fallback.trim()) return null;
  const suggested = await modelQuery(input, deps.converse);
  const queries = suggested && suggested.toLowerCase() !== fallback.toLowerCase() ? [suggested, fallback] : [fallback];
  for (const query of queries) {
    try {
      const hit = await geocode(query, fetchImpl);
      if (hit) return hit;
    } catch {
      // Try the next query. A failed lookup still saves the stop.
    }
  }
  return null;
}
