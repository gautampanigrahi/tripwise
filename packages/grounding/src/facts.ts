import type { CheckOutcome, CheckResult, Unit } from '@tripwise/shared';

export type FactOutcome = Pick<CheckOutcome, 'check' | 'measured' | 'limit' | 'unit' | 'passed' | 'details'>;

/** The only Check_Result data that may reach the model (Req 21.1). */
export interface ExplanationFacts {
  stayName: string;
  score: number;
  label: string;
  tripNights: number;
  outcomes: FactOutcome[];
}

/**
 * Whitelisting projection of a Check_Result. Fields are copied one by one, so anything else
 * on the record (or smuggled onto it) never reaches the prompt.
 */
export function toFacts(r: CheckResult): ExplanationFacts {
  return {
    stayName: r.evaluatedStay.name,
    score: r.score,
    label: r.label,
    tripNights: r.tripNights,
    outcomes: r.outcomes.map((o) => {
      const out: FactOutcome = {
        check: o.check,
        measured: o.measured,
        limit: o.limit,
        unit: o.unit,
        passed: o.passed,
      };
      if (o.details) {
        const details: NonNullable<CheckOutcome['details']> = {};
        if (o.details.missingPairs) {
          details.missingPairs = o.details.missingPairs.map(([a, b]) => [a, b] as [string, string]);
        }
        if (o.details.unmetFeatures) details.unmetFeatures = [...o.details.unmetFeatures];
        out.details = details;
      }
      return out;
    }),
  };
}

/**
 * Free text (stay names, feature names, stop names) may contain digits that are not grounded
 * facts. Digits are masked so that only checked values appear as numbers.
 */
export function maskDigits(text: string): string {
  return text.replace(/\d+/g, '#');
}

/** Formats a number so that `extractNumbers` reads back the same value. */
export function formatNumber(n: number): string {
  const s = String(n);
  return /e/i.test(s) ? 'unavailable' : s;
}

/** Cents as dollars with two decimals, e.g. 285000 -> `2850.00`. */
export function formatDollars(cents: number): string {
  const s = (cents / 100).toFixed(2);
  return /e/i.test(s) ? 'unavailable' : s;
}

export function formatValue(n: number, unit: Unit): string {
  return unit === 'USD_CENTS' ? formatDollars(n) : formatNumber(n);
}

const UNIT_LABEL: Record<Unit, string> = {
  USD_CENTS: 'US dollars',
  BEDS: 'beds',
  NIGHTS: 'nights',
  MINUTES: 'minutes',
  FEATURES: 'features',
};

// Contains no digits, so the system prompt adds no numbers of its own (Req 21.2).
const SYSTEM_PROMPT = [
  'You explain the result of a group trip feasibility check in plain language.',
  'Use only the numbers that appear in FACTS. Do not compute differences, totals, or percentages.',
  'Do not mention prices, dates, or counts not in FACTS.',
  'Money values in FACTS are already in US dollars.',
  'Write a short paragraph of two to four sentences. Say which checks passed and which failed.',
].join(' ');

/** Prompt built only from the facts projection, with cents shown as dollars (Req 21.1, 21.2). */
export function buildPrompt(f: ExplanationFacts): { system: string; user: string } {
  const lines = [
    'FACTS',
    `Stay: ${maskDigits(f.stayName)}`,
    `Feasibility score (percent of checks passed): ${formatNumber(f.score)}`,
    `Result: ${maskDigits(f.label)}`,
    `Trip nights: ${formatNumber(f.tripNights)}`,
    'Checks:',
  ];
  for (const o of f.outcomes) {
    let line =
      `- ${o.check}: measured ${formatValue(o.measured, o.unit)}, limit ${formatValue(o.limit, o.unit)} ` +
      `(${UNIT_LABEL[o.unit]}), ${o.passed ? 'passed' : 'failed'}`;
    const pairs = o.details?.missingPairs;
    if (pairs?.length) {
      line += `; missing travel times: ${pairs.map(([a, b]) => `${maskDigits(a)} to ${maskDigits(b)}`).join('; ')}`;
    }
    const unmet = o.details?.unmetFeatures;
    if (unmet?.length) line += `; unmet features: ${unmet.map(maskDigits).join(', ')}`;
    lines.push(line);
  }
  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}
