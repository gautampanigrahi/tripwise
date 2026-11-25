import type { LodgingItem, PlanItem } from '@tripwise/shared';
import type { StayInput } from './types.js';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Latest `lastModifiedAt` first; ties broken by ascending `itemId` so the pick is deterministic. */
type Stamped = Pick<PlanItem, 'itemId' | 'lastModifiedAt'>;
const newestFirst = (a: Stamped, b: Stamped): number =>
  cmp(b.lastModifiedAt, a.lastModifiedAt) || cmp(a.itemId, b.itemId);

/**
 * The Trip's current Lodging Plan_Item (Req 13.1): the item marked `selected`, otherwise the
 * most recently modified one. Non-Lodging items are ignored. Returns `undefined` when there is
 * no Lodging item, which the handler maps to `422 MISSING_INPUT` (Req 13.5).
 */
export function selectCurrentLodging(items: readonly PlanItem[]): LodgingItem | undefined {
  const lodging = items.filter((it) => it.section === 'Lodging') as unknown as LodgingItem[];
  if (lodging.length === 0) return undefined;
  const selected = lodging.filter((it) => it.fields.selected === true);
  const pool = selected.length > 0 ? selected : lodging;
  return [...pool].sort(newestFirst)[0];
}

/** Engine stay input from a Lodging Plan_Item. Feature list becomes a `{ feature: true }` map. */
export function stayFromLodging(item: LodgingItem): StayInput {
  const f = item.fields;
  const stay: StayInput = {
    name: f.name ?? 'Lodging',
    sleeps: f.sleeps,
    nightlyPriceCents: f.nightlyPriceCents,
    features: Object.fromEntries((f.features ?? []).map((feature) => [feature, true])),
    checkIn: f.checkIn,
    checkOut: f.checkOut,
  };
  if (f.catalogStayId !== undefined) stay.stayId = f.catalogStayId;
  return stay;
}
