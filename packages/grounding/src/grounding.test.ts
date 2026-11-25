import { describe, expect, it } from 'vitest';
import type { CheckResult } from '@tripwise/shared';
import {
  allowedNumbers,
  buildPrompt,
  chooseExplanation,
  extractNumbers,
  templateExplanation,
  toFacts,
  verifyGrounding,
} from './index.js';

// Seed-like result: Cost fails at $2850.00 vs $2500.00, Capacity fails 2/4, Dates passes 4/4.
function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    tripId: 'trip-1',
    checkId: 'check-1',
    runAt: '2025-06-01T10:00:00.000Z',
    kind: 'standard',
    evaluatedStay: { stayId: 'sd-gaslamp-studio', name: 'Gaslamp Studio' },
    catalogVersion: 'san-diego-v1',
    outcomes: [
      { check: 'Cost', measured: 285000, limit: 250000, unit: 'USD_CENTS', passed: false },
      { check: 'Capacity', measured: 2, limit: 4, unit: 'BEDS', passed: false },
      { check: 'Dates', measured: 4, limit: 4, unit: 'NIGHTS', passed: true },
    ],
    score: 33,
    label: 'Not feasible',
    tripNights: 4,
    explanation: 'old text 999',
    explanationSource: 'template',
    ...overrides,
  };
}

describe('toFacts', () => {
  it('copies only whitelisted fields', () => {
    const r = result() as CheckResult & { doorCode: string };
    r.doorCode = 'SECRET-7777';
    (r.outcomes[0] as unknown as Record<string, unknown>).confirmationNumber = 'CONF-1';
    const f = toFacts(r);
    expect(Object.keys(f).sort()).toEqual(['label', 'outcomes', 'score', 'stayName', 'tripNights']);
    expect(Object.keys(f.outcomes[0]!).sort()).toEqual(['check', 'limit', 'measured', 'passed', 'unit']);
    expect(JSON.stringify(f)).not.toMatch(/SECRET|CONF-1|old text|trip-1|san-diego/);
    expect(f.stayName).toBe('Gaslamp Studio');
  });

  it('copies details without sharing references', () => {
    const r = result({
      outcomes: [
        {
          check: 'Preferences', measured: 1, limit: 2, unit: 'FEATURES', passed: false,
          details: { unmetFeatures: ['pool'] },
        },
      ],
    });
    const f = toFacts(r);
    expect(f.outcomes[0]!.details).toEqual({ unmetFeatures: ['pool'] });
    expect(f.outcomes[0]!.details!.unmetFeatures).not.toBe(r.outcomes[0]!.details!.unmetFeatures);
  });
});

describe('buildPrompt', () => {
  it('instructs the model to use only FACTS numbers and shows cents as dollars', () => {
    const { system, user } = buildPrompt(toFacts(result()));
    expect(system).toContain('Use only the numbers that appear in FACTS');
    expect(system).not.toMatch(/\d/);
    expect(user).toContain('2850.00');
    expect(user).toContain('2500.00');
    expect(user).not.toContain('285000');
    expect(user).toContain('Gaslamp Studio');
  });

  it('contains only allowed numbers, masking digits in free text', () => {
    const f = toFacts(
      result({
        evaluatedStay: { name: 'Suite 1234 at 5th Ave' },
        outcomes: [
          {
            check: 'Schedule', measured: 45, limit: 60, unit: 'MINUTES', passed: false,
            details: { missingPairs: [['Pier 39', 'Gate 7']] },
          },
          {
            check: 'Preferences', measured: 0, limit: 1, unit: 'FEATURES', passed: false,
            details: { unmetFeatures: ['wifi6'] },
          },
        ],
      }),
    );
    const { system, user } = buildPrompt(f);
    expect(verifyGrounding(system + '\n' + user, f)).toEqual({ ok: true });
    expect(user).not.toContain('1234');
  });
});

describe('extractNumbers', () => {
  it('reads dollar, comma, decimal, and percent forms', () => {
    expect(extractNumbers('$2,850.00 and 2850 and 75% of 4 nights')).toEqual([2850, 2850, 75, 4]);
    expect(extractNumbers('no digits here')).toEqual([]);
  });
});

describe('allowedNumbers', () => {
  it('includes score, nights, measured, limit, and cents as dollars', () => {
    const s = allowedNumbers(toFacts(result()));
    for (const n of [33, 4, 285000, 250000, 2850, 2500, 2]) expect(s.has(n)).toBe(true);
    expect(s.has(350)).toBe(false);
  });
});

describe('verifyGrounding', () => {
  const f = toFacts(result());

  it('accepts text that uses only supplied numbers in any formatting', () => {
    expect(verifyGrounding('The cost is $2,850.00, over the $2500 limit. Score 33%. Sleeps 2 of 4.', f)).toEqual({
      ok: true,
    });
  });

  it('rejects computed differences and reports them', () => {
    expect(verifyGrounding('You are $350 over budget across 4 nights.', f)).toEqual({ ok: false, ungrounded: [350] });
  });

  it('matches non-round cents exactly', () => {
    const g = toFacts(
      result({ outcomes: [{ check: 'Cost', measured: 12345, limit: 99999, unit: 'USD_CENTS', passed: true }] }),
    );
    expect(verifyGrounding('$123.45 within $999.99', g)).toEqual({ ok: true });
    expect(verifyGrounding('$123.46', g)).toEqual({ ok: false, ungrounded: [123.46] });
  });
});

describe('templateExplanation', () => {
  it('describes each outcome with dollars and passes grounding', () => {
    const f = toFacts(result());
    const text = templateExplanation(f);
    expect(text).toContain('Cost: $2850.00 against a limit of $2500.00 (failed).');
    expect(text).toContain('Not feasible');
    expect(text).not.toContain('Gaslamp');
    expect(verifyGrounding(text, f)).toEqual({ ok: true });
  });

  it('omits place names and masks digits in feature names', () => {
    const f = toFacts(
      result({
        evaluatedStay: { name: 'Loft 42' },
        outcomes: [
          {
            check: 'Schedule', measured: 30, limit: 20, unit: 'MINUTES', passed: false,
            details: { missingPairs: [['Pier 39', 'Zoo']] },
          },
          {
            check: 'Preferences', measured: 1, limit: 2, unit: 'FEATURES', passed: false,
            details: { unmetFeatures: ['wifi6'] },
          },
        ],
      }),
    );
    const text = templateExplanation(f);
    expect(text).not.toMatch(/Loft|Pier|39|42/);
    expect(verifyGrounding(text, f)).toEqual({ ok: true });
  });
});

describe('chooseExplanation', () => {
  const f = toFacts(result());

  it('keeps grounded Bedrock text', () => {
    const text = 'The plan is not feasible: it costs $2,850.00 against $2,500.00 and sleeps 2 of 4.';
    expect(chooseExplanation({ ok: true, text }, f)).toEqual({ text, source: 'bedrock' });
  });

  it('falls back to the template for ungrounded text or a failed call', () => {
    const template = { text: templateExplanation(f), source: 'template' };
    expect(chooseExplanation({ ok: true, text: 'You are $350 over.' }, f)).toEqual(template);
    expect(chooseExplanation({ ok: false, reason: 'timeout' }, f)).toEqual(template);
  });
});
