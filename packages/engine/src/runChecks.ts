import { tripNights, type CheckName, type CheckOutcome } from '@tripwise/shared';
import { capacityCheck } from './checks/capacity.js';
import { costCheck } from './checks/cost.js';
import { datesCheck } from './checks/dates.js';
import { preferencesCheck } from './checks/preferences.js';
import { scheduleCheck } from './checks/schedule.js';
import { feasibilityScore } from './score.js';
import type { EngineInput, EngineOutput, ItineraryStop } from './types.js';

export type { EngineInput, EngineOutput } from './types.js';

/** Fixed emission order for outcomes (Req 13.1). */
export const CHECK_ORDER: readonly CheckName[] = ['Cost', 'Capacity', 'Dates', 'Schedule', 'Preferences'];

/** Checks that run on every request, whatever `enabledChecks` says (Req 13.1). */
export const REQUIRED_CHECKS: readonly CheckName[] = ['Cost', 'Capacity', 'Dates'];

/** Values computed once per run and shared by checks. */
export interface CheckContext {
  /** Number of Trip_Nights in `[startDate, endDate)`. */
  nights: number;
}

/**
 * An optional check. Returns `null` when its preconditions do not hold
 * (e.g. Schedule without `travelTimeCapMinutes`), in which case no outcome is emitted.
 */
export type OptionalCheck = (input: EngineInput, ctx: CheckContext) => CheckOutcome | null;

const REQUIRED: Record<'Cost' | 'Capacity' | 'Dates', (i: EngineInput, ctx: CheckContext) => CheckOutcome> = {
  Cost: (i, ctx) => costCheck(i, ctx.nights),
  Capacity: (i) => capacityCheck(i),
  Dates: (i) => datesCheck(i),
};

/**
 * Extension point for optional checks (Req 17, 18). An enabled but unregistered check
 * emits no outcome.
 */
export const OPTIONAL_CHECKS: Partial<Record<CheckName, OptionalCheck>> = {
  Schedule: (i) => scheduleCheck(i),
  Preferences: (i) => preferencesCheck(i),
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byStop = (a: ItineraryStop, b: ItineraryStop): number =>
  cmp(a.day, b.day) || cmp(a.startTime, b.startTime) || cmp(a.itemId, b.itemId);

/** Sorts unordered inputs so that input order never changes the result (Req 13.2). Does not mutate. */
export function normalizeInput(input: EngineInput): EngineInput {
  return {
    ...input,
    transportCostsCents: [...input.transportCostsCents].sort((a, b) => a - b),
    itinerary: [...input.itinerary].sort(byStop),
  };
}

/**
 * Runs the Cost, Capacity, and Dates checks plus each enabled optional check whose
 * preconditions hold, emitting outcomes in `CHECK_ORDER` (Req 13.1, 13.4).
 * Pure: no clock, randomness, or I/O (Req 13.2).
 */
export function runChecks(input: EngineInput): EngineOutput {
  const i = normalizeInput(input);
  const nights = tripNights(i.constraints.startDate, i.constraints.endDate).length;
  const ctx: CheckContext = { nights };
  const enabled = new Set<CheckName>(i.enabledChecks);

  const outcomes: CheckOutcome[] = [];
  for (const name of CHECK_ORDER) {
    if (name === 'Cost' || name === 'Capacity' || name === 'Dates') {
      outcomes.push(REQUIRED[name](i, ctx));
      continue;
    }
    if (!enabled.has(name)) continue;
    const outcome = OPTIONAL_CHECKS[name]?.(i, ctx);
    if (outcome) outcomes.push(outcome);
  }

  return { outcomes, score: feasibilityScore(outcomes), tripNights: nights };
}
