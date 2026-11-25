import type { ExplanationFacts } from './facts.js';

/** Number tokens such as `2850`, `2,850.00`, or `75` (from `75%`). Signs are not captured. */
const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

/** Every number written with digits in `text`, with thousands separators removed (Req 21.3). */
export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER_TOKEN) ?? []).map((s) => Number(s.replace(/,/g, '')));
}

/**
 * Numbers an explanation may mention: the score, the Trip_Night count, and each outcome's
 * measured and limit values. Cents values are also allowed in dollars. Absolute values are
 * included because `extractNumbers` never yields a sign.
 */
export function allowedNumbers(f: ExplanationFacts): Set<number> {
  const s = new Set<number>();
  const add = (n: number): void => {
    s.add(n);
    s.add(Math.abs(n));
  };
  add(f.score);
  add(f.tripNights);
  for (const o of f.outcomes) {
    add(o.measured);
    add(o.limit);
    if (o.unit === 'USD_CENTS') {
      add(o.measured / 100);
      add(o.limit / 100);
    }
  }
  return s;
}

export type GroundingResult = { ok: true } | { ok: false; ungrounded: number[] };

/** Passes only if every number in `text` is an allowed number (Req 21.3). */
export function verifyGrounding(text: string, f: ExplanationFacts): GroundingResult {
  const allowed = allowedNumbers(f);
  const bad = extractNumbers(text).filter((n) => !allowed.has(n));
  return bad.length ? { ok: false, ungrounded: bad } : { ok: true };
}
