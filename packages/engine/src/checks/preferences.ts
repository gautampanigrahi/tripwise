import type { CheckOutcome } from '@tripwise/shared';
import type { EngineInput } from '../types.js';

/**
 * Preferences check (Req 18): number of distinct Required_Features that are true for the stay
 * vs. the number of distinct Required_Features. Returns `null` when no features are required
 * (no outcome emitted). A feature that is false or absent is unmet.
 */
export function preferencesCheck(i: EngineInput): CheckOutcome | null {
  const required = [...new Set(i.constraints.requiredFeatures)].sort();
  if (required.length === 0) return null;

  const unmetFeatures = required.filter((f) => i.stay.features[f] !== true);
  const measured = required.length - unmetFeatures.length;
  const outcome: CheckOutcome = {
    check: 'Preferences',
    measured,
    limit: required.length,
    unit: 'FEATURES',
    passed: unmetFeatures.length === 0,
  };
  if (unmetFeatures.length > 0) outcome.details = { unmetFeatures };
  return outcome;
}
