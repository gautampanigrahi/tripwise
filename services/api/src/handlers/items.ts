import { confirmationKey, parseSection, stamp, validatePlanItem, type PlanItem, type Section } from '@tripwise/shared';
import { locatePlace, type PlaceLookup, type PlacePoint } from '../adapters/placeLocate.js';
import { createS3ConfirmationStore, type ConfirmationStore } from '../adapters/s3.js';
import { HttpError, json, type HttpResult } from '../lib/http.js';
import { dispatch, type ApiEvent, type RouteDef, type RouteRequest } from '../lib/routes.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';
import type { Repos } from '../repos/interfaces.js';

/**
 * items-fn: Plan_Item CRUD and Checklist claim (Req 5.1-5.6, 8.2, 9.2-9.4, 23.2, 23.3).
 * Also Lodging confirmation upload/download via presigned S3 URLs (Req 6.4, 6.5).
 */
export type ItemsDeps = Repos & {
  now: () => string;
  newId: () => string;
  files: ConfirmationStore;
  /** Fills a missing itinerary pin. Defaults to the model-assisted map search. */
  locatePlace?: (input: PlaceLookup) => Promise<PlacePoint | null>;
};

type Req = RouteRequest<ItemsDeps>;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function validationError(field: string, message: string): HttpError {
  return new HttpError('VALIDATION', { fields: [{ field, message }] });
}

function sectionOf(event: ApiEvent): Section {
  const raw = event.pathParameters?.section ?? '';
  const section = parseSection(raw);
  if (!section) throw new HttpError('UNKNOWN_SECTION', { section: raw });
  return section;
}

function itemIdOf(event: ApiEvent): string {
  const raw = event.pathParameters?.itemId;
  if (raw === undefined || !ID_RE.test(raw)) throw validationError('itemId', 'Must be 1-128 letters, digits, "-" or "_"');
  return raw;
}

function bodyOf(event: ApiEvent): Record<string, unknown> {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw validationError('body', 'Must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validationError('body', 'Must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Validates `fields` against the Section schema and the Trip's dates and member set (Req 5.6, 7.2, 8.3). */
async function validFields(req: Req, tripId: string, section: Section, fields: unknown): Promise<Record<string, unknown>> {
  const [trip, members] = await Promise.all([
    req.deps.trips.get(tripId),
    req.deps.memberships.listByTrip(tripId),
  ]);
  if (!trip) throw new HttpError('NOT_FOUND');
  const result = validatePlanItem(section, fields, {
    trip: { startDate: trip.startDate, endDate: trip.endDate },
    memberIds: new Set(members.map((m) => m.userId)),
  });
  if (!result.ok) throw new HttpError('VALIDATION', { fields: result.errors });
  return result.value as Record<string, unknown>;
}

/** When a new stop has no pin, look one up and store it so the map is the same for every member. */
async function withPin(req: Req, tripId: string, section: Section, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (section !== 'Itinerary') return fields;
  const lat = fields.lat;
  const lng = fields.lng;
  if (typeof lat === 'number' && typeof lng === 'number') return fields;
  const stopName = typeof fields.stopName === 'string' ? fields.stopName : '';
  if (!stopName.trim()) return fields;
  const trip = await req.deps.trips.get(tripId);
  if (!trip) return fields;
  const locate = req.deps.locatePlace ?? locatePlace;
  try {
    const hit = await locate({
      stopName,
      notes: typeof fields.notes === 'string' ? fields.notes : undefined,
      destination: trip.destination,
    });
    if (!hit) return fields;
    return { ...fields, lat: hit.lat, lng: hit.lng };
  } catch {
    return fields;
  }
}

async function listItems(req: Req): Promise<HttpResult> {
  const items = await req.deps.planItems.list(req.tripId!, sectionOf(req.event));
  return json(200, { items });
}

async function createItem(req: Req): Promise<HttpResult> {
  const tripId = req.tripId!;
  const section = sectionOf(req.event);
  const fields = await withPin(req, tripId, section, await validFields(req, tripId, section, bodyOf(req.event).fields));
  const now = req.deps.now();
  const item: PlanItem = stamp(
    { tripId, itemId: req.deps.newId(), section, fields, createdAt: now },
    req.caller.userId,
    () => now,
  );
  await req.deps.planItems.create(item);
  return json(201, item);
}

async function updateItem(req: Req): Promise<HttpResult> {
  const tripId = req.tripId!;
  const section = sectionOf(req.event);
  const itemId = itemIdOf(req.event);
  const body = bodyOf(req.event);
  const expected = body.expectedLastModifiedAt;
  if (typeof expected !== 'string' || expected === '') {
    throw validationError('expectedLastModifiedAt', 'Is required');
  }
  const fields = await withPin(req, tripId, section, await validFields(req, tripId, section, body.fields));
  const now = req.deps.now();
  // createdAt and server-owned fields are kept from the stored item by the repo (applyUpdate).
  const next: PlanItem = stamp({ tripId, itemId, section, fields, createdAt: now }, req.caller.userId, () => now);
  const result = await req.deps.planItems.update(next, expected);
  if (result.ok) return json(200, result.item);
  if (result.reason === 'STALE') throw new HttpError('STALE', { current: result.current });
  throw new HttpError('NOT_FOUND');
}

async function deleteItem(req: Req): Promise<HttpResult> {
  const deleted = await req.deps.planItems.delete(req.tripId!, sectionOf(req.event), itemIdOf(req.event));
  if (!deleted) throw new HttpError('NOT_FOUND');
  return { statusCode: 204, body: '' };
}

async function claimItem(req: Req): Promise<HttpResult> {
  const result = await req.deps.planItems.claim(req.tripId!, itemIdOf(req.event), {
    lastModifiedBy: req.caller.userId,
    lastModifiedAt: req.deps.now(),
  });
  if (result.ok) return json(200, result.item);
  if (result.reason === 'ALREADY_CLAIMED') throw new HttpError('ALREADY_CLAIMED', { claimedBy: result.claimedBy });
  throw new HttpError('NOT_FOUND');
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > 255) {
    throw validationError(field, 'Must be a non-empty string of at most 255 characters');
  }
  return value;
}
/** Records the key on the Lodging item and returns a 5-minute presigned POST for it (Req 6.4). */
async function confirmationUpload(req: Req): Promise<HttpResult> {
  const tripId = req.tripId!;
  const itemId = itemIdOf(req.event);
  const body = bodyOf(req.event);
  const fileName = requiredString(body, 'fileName');
  const contentType = requiredString(body, 'contentType');
  const key = confirmationKey(tripId, itemId, fileName);
  const item = await req.deps.planItems.setConfirmationKey(tripId, itemId, key);
  if (!item) throw new HttpError('NOT_FOUND');
  const { url, fields } = await req.deps.files.uploadTarget(key, contentType);
  return json(200, { url, fields, key });
}
/** Presigned GET (15 minutes) for the item's recorded confirmation (Req 6.5). */
async function confirmationDownload(req: Req): Promise<HttpResult> {
  const item = await req.deps.planItems.get(req.tripId!, 'Lodging', itemIdOf(req.event));
  const key = (item?.fields as { confirmationKey?: unknown } | undefined)?.confirmationKey;
  if (typeof key !== 'string') throw new HttpError('NOT_FOUND');
  return json(200, { url: await req.deps.files.downloadUrl(key) });
}
const ITEMS = '/trips/{tripId}/sections/{section}/items';

export const routes: RouteDef<ItemsDeps>[] = [
  { routeKey: `GET ${ITEMS}`, guard: 'read', run: listItems },
  { routeKey: `POST ${ITEMS}`, guard: 'write', run: createItem },
  { routeKey: `PUT ${ITEMS}/{itemId}`, guard: 'write', run: updateItem },
  { routeKey: `DELETE ${ITEMS}/{itemId}`, guard: 'write', run: deleteItem },
  { routeKey: 'POST /trips/{tripId}/sections/Checklist/items/{itemId}/claim', guard: 'write', run: claimItem },
  { routeKey: 'POST /trips/{tripId}/items/{itemId}/confirmation-upload', guard: 'write', run: confirmationUpload },
  { routeKey: 'GET /trips/{tripId}/items/{itemId}/confirmation', guard: 'read', run: confirmationDownload },
];

let deps: ItemsDeps | undefined;

export const handler = dispatch(routes, () => {
  deps ??= {
    ...createDynamoRepos(),
    now: () => new Date().toISOString(),
    newId: () => globalThis.crypto.randomUUID(),
    files: createS3ConfirmationStore(),
    locatePlace,
  };
  return deps;
});
