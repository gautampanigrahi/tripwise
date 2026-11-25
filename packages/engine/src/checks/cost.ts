import { totalBudgetLimitCents, type CheckOutcome } from '@tripwise/shared';
import { EngineInputError } from '../errors.js';
import type { EngineInput } from '../types.js';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Per-person price in cents for a Catalog activity; unknown IDs raise `UNKNOWN_ACTIVITY`. */
function activityPriceCents(catalog: EngineInput['catalog'], id: string): number {
  const activity = catalog.activities.find((a) => a.id === id);
  if (!activity) throw new EngineInputError('UNKNOWN_ACTIVITY', id);
  return activity.pricePerPerson.cents;
}

/**
 * Cost check (Req 14). All amounts are integer US cents (14.5):
 * nightly × nights + Σ transport + Σ activity price × travelers, compared to the total budget limit (11.4, 11.5).
 */
export function costCheck(i: EngineInput, nights: number): CheckOutcome {
  const { travelerCount } = i.constraints;
  const lodging = i.stay.nightlyPriceCents * nights;
  const transport = sum(i.transportCostsCents);
  const activities = sum(
    i.constraints.plannedActivityIds.map((id) => activityPriceCents(i.catalog, id) * travelerCount),
  );
  const measured = lodging + transport + activities;
  const limit = totalBudgetLimitCents(i.constraints);
  return { check: 'Cost', measured, limit, unit: 'USD_CENTS', passed: measured <= limit };
}
