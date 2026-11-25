import type { ExplanationFacts, FactOutcome } from './facts.js';
import { formatDollars, formatNumber, maskDigits } from './facts.js';

function outcomeLine(o: FactOutcome): string {
  const status = o.passed ? 'passed' : 'failed';
  let line: string;
  switch (o.unit) {
    case 'USD_CENTS':
      line = `${o.check}: $${formatDollars(o.measured)} against a limit of $${formatDollars(o.limit)} (${status}).`;
      break;
    case 'BEDS':
      line = `${o.check}: the stay sleeps ${formatNumber(o.measured)} for ${formatNumber(o.limit)} travelers (${status}).`;
      break;
    case 'NIGHTS':
      line = `${o.check}: the stay covers ${formatNumber(o.measured)} of ${formatNumber(o.limit)} trip nights (${status}).`;
      break;
    case 'MINUTES':
      line = `${o.check}: the busiest day has ${formatNumber(o.measured)} minutes of travel against a cap of ${formatNumber(o.limit)} minutes (${status}).`;
      break;
    case 'FEATURES':
      line = `${o.check}: ${formatNumber(o.measured)} of ${formatNumber(o.limit)} required features are available (${status}).`;
      break;
  }
  // Place names are left out because they can contain digits; feature names are masked.
  if (o.details?.missingPairs?.length) line += ' Some travel times between stops are missing.';
  const unmet = o.details?.unmetFeatures;
  if (unmet?.length) line += ` Unmet features: ${unmet.map(maskDigits).join(', ')}.`;
  return line;
}

/**
 * Deterministic explanation built from the facts. It uses only allowed numbers and never
 * includes the stay name, so it always passes `verifyGrounding` (Req 21.4).
 */
export function templateExplanation(f: ExplanationFacts): string {
  const label = f.label === 'Feasible' ? 'Feasible' : 'Not feasible';
  return [
    `Result: ${label}, with a feasibility score of ${formatNumber(f.score)} for a trip of ${formatNumber(f.tripNights)} nights.`,
    ...f.outcomes.map(outcomeLine),
  ].join('\n');
}
