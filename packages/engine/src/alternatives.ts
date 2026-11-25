import type { CatalogStay, CheckName } from '@tripwise/shared';
import type { EngineInput } from './types.js';

/**
 * Input for an Alternative run (Req 20.1): the base input with only the stay replaced by a
 * Catalog stay (keeping the current Lodging item's check-in/check-out) and the check list
 * set to the checks of the latest non-alternative Check_Result. Does not mutate `base`.
 */
export function buildAlternativeInput(
  base: EngineInput,
  stay: CatalogStay,
  latestChecks: readonly CheckName[],
): EngineInput {
  return {
    ...base,
    stay: {
      stayId: stay.id,
      name: stay.name,
      sleeps: stay.sleeps,
      nightlyPriceCents: stay.nightlyPrice.cents,
      features: { ...stay.features },
      checkIn: base.stay.checkIn,
      checkOut: base.stay.checkOut,
    },
    enabledChecks: [...latestChecks],
  };
}
