import type { CheckOutcome } from '@tripwise/shared';
import type { EngineInput } from '../types.js';

/** Capacity check (Req 15): stay sleeps count vs. traveler count. */
export function capacityCheck(i: EngineInput): CheckOutcome {
  const measured = i.stay.sleeps;
  const limit = i.constraints.travelerCount;
  return { check: 'Capacity', measured, limit, unit: 'BEDS', passed: measured >= limit };
}
