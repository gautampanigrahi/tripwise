import type { CheckOutcome } from '@tripwise/shared';

/** Passed / executed as a whole percent, rounded to nearest (Req 19.1). Callers pass at least one outcome. */
export function feasibilityScore(outcomes: readonly CheckOutcome[]): number {
  if (outcomes.length === 0) throw new RangeError('feasibilityScore requires at least one outcome');
  const passed = outcomes.filter((o) => o.passed).length;
  return Math.round((100 * passed) / outcomes.length);
}

/** "Feasible" iff every outcome passed; `failed` lists the failed outcomes in input order (Req 19.2, 19.3). */
export function scoreLabel(outcomes: readonly CheckOutcome[]): {
  label: 'Feasible' | 'Not feasible';
  failed: CheckOutcome[];
} {
  const failed = outcomes.filter((o) => !o.passed);
  return { label: failed.length === 0 ? 'Feasible' : 'Not feasible', failed };
}
