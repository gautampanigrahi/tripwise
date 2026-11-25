import { describe, expect, it } from 'vitest';
import type { CheckName, CheckOutcome } from '@tripwise/shared';
import { feasibilityScore, scoreLabel } from './score.js';

const o = (check: CheckName, passed: boolean): CheckOutcome => ({ check, measured: 1, limit: 1, unit: 'BEDS', passed });

describe('feasibilityScore', () => {
  it('rounds passed/executed to the nearest percent', () => {
    expect(feasibilityScore([o('Cost', true), o('Capacity', true), o('Dates', true)])).toBe(100);
    expect(feasibilityScore([o('Cost', true), o('Capacity', true), o('Dates', false)])).toBe(67);
    expect(feasibilityScore([o('Cost', true), o('Capacity', false), o('Dates', false)])).toBe(33);
    expect(feasibilityScore([o('Cost', false), o('Capacity', false), o('Dates', false)])).toBe(0);
  });

  it('rejects an empty outcome list', () => {
    expect(() => feasibilityScore([])).toThrow(RangeError);
  });
});

describe('scoreLabel', () => {
  it('labels Feasible when every check passed', () => {
    expect(scoreLabel([o('Cost', true), o('Capacity', true), o('Dates', true)])).toEqual({ label: 'Feasible', failed: [] });
  });

  it('labels Not feasible and lists exactly the failed checks', () => {
    const outcomes = [o('Cost', false), o('Capacity', true), o('Dates', false)];
    const r = scoreLabel(outcomes);
    expect(r.label).toBe('Not feasible');
    expect(r.failed.map((f) => f.check)).toEqual(['Cost', 'Dates']);
  });
});
