import { toEpochDay, tripNights, type CheckOutcome } from '@tripwise/shared';
import type { EngineInput } from '../types.js';

/**
 * Dates check (Req 16): how many Trip_Nights fall in the lodging range [checkIn, checkOut).
 * Passes only when every Trip_Night is covered.
 */
export function datesCheck(i: EngineInput): CheckOutcome {
  const nights = tripNights(i.constraints.startDate, i.constraints.endDate);
  const checkIn = toEpochDay(i.stay.checkIn);
  const checkOut = toEpochDay(i.stay.checkOut);
  const measured = nights.filter((n) => checkIn <= n && n < checkOut).length;
  const limit = nights.length;
  return { check: 'Dates', measured, limit, unit: 'NIGHTS', passed: measured === limit };
}
