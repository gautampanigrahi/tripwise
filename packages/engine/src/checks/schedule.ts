import type { CheckOutcome } from '@tripwise/shared';
import type { EngineInput, ItineraryStop } from '../types.js';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Schedule check (Req 17): largest daily travel total between consecutive Itinerary stops
 * vs. `travelTimeCapMinutes`. Returns `null` when no cap is set (no outcome emitted).
 * Legs between stops with the same name are 0 minutes; pairs are looked up in either direction.
 */
export function scheduleCheck(i: EngineInput): CheckOutcome | null {
  const limit = i.constraints.travelTimeCapMinutes;
  if (limit === undefined) return null;

  const minutes = new Map<string, number>();
  for (const t of i.catalog.travelTimes) minutes.set(`${t.from}\u0000${t.to}`, t.minutes);
  const lookup = (a: string, b: string): number | undefined =>
    a === b ? 0 : minutes.get(`${a}\u0000${b}`) ?? minutes.get(`${b}\u0000${a}`);

  const byDay = new Map<string, ItineraryStop[]>();
  for (const s of i.itinerary) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);

  let measured = 0;
  const missing = new Map<string, [string, string]>();
  for (const stops of byDay.values()) {
    stops.sort((a, b) => cmp(a.startTime, b.startTime) || cmp(a.itemId, b.itemId));
    let total = 0;
    for (let k = 1; k < stops.length; k++) {
      const a = stops[k - 1]!.stopName;
      const b = stops[k]!.stopName;
      const m = lookup(a, b);
      if (m === undefined) missing.set(`${a}\u0000${b}`, [a, b]);
      else total += m;
    }
    measured = Math.max(measured, total);
  }

  const missingPairs = [...missing.values()].sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]));
  const outcome: CheckOutcome = {
    check: 'Schedule',
    measured,
    limit,
    unit: 'MINUTES',
    passed: missingPairs.length === 0 && measured <= limit,
  };
  if (missingPairs.length > 0) outcome.details = { missingPairs };
  return outcome;
}
