import { describe, expect, it } from 'vitest';
import { ConstraintsSchema, dollarsToCents, totalBudgetLimitCents, validateConstraints } from './constraints.js';

const valid = {
  destination: 'San Diego',
  startDate: '2025-06-12',
  endDate: '2025-06-16',
  travelerCount: 4,
  budget: '2500.00',
  budgetType: 'total' as const,
  requiredFeatures: ['wifi'],
  plannedActivityIds: ['sd-zoo'],
  accessibilityNeeds: [],
};
const fields = (input: unknown) => {
  const r = validateConstraints(input);
  return r.ok ? [] : r.errors.map((e) => e.field);
};

describe('dollarsToCents', () => {
  it('converts without floating-point error', () => {
    expect(dollarsToCents('2500')).toBe(250000);
    expect(dollarsToCents('12.5')).toBe(1250);
    expect(dollarsToCents('0.29')).toBe(29);
  });
});

describe('ConstraintsSchema', () => {
  it('accepts valid input and stores budget as cents (Req 11.1)', () => {
    const r = validateConstraints(valid);
    expect(r).toEqual({
      ok: true,
      value: {
        destination: 'San Diego',
        startDate: '2025-06-12',
        endDate: '2025-06-16',
        travelerCount: 4,
        budgetCents: 250000,
        budgetType: 'total',
        requiredFeatures: ['wifi'],
        plannedActivityIds: ['sd-zoo'],
        accessibilityNeeds: [],
      },
    });
  });

  it('keeps optional walking and travel limits when supplied', () => {
    const out = ConstraintsSchema.parse({ ...valid, walkingDistanceLimitMeters: 800, travelTimeCapMinutes: 30 });
    expect(out.walkingDistanceLimitMeters).toBe(800);
    expect(out.travelTimeCapMinutes).toBe(30);
  });

  it.each([0, -1, 2.5, '4'])('rejects travelerCount %p (Req 11.2)', (travelerCount) => {
    expect(fields({ ...valid, travelerCount })).toEqual(['travelerCount']);
  });

  it.each(['0', '0.00', '-5', 'abc', '10.999', ''])('rejects budget %p (Req 11.3)', (budget) => {
    expect(fields({ ...valid, budget })).toEqual(['budget']);
  });

  it('rejects unknown keys, including a client-supplied budgetCents', () => {
    expect(fields({ ...valid, budgetCents: 1 })).toEqual(['budgetCents']);
  });

  it('rejects endDate not after startDate', () => {
    expect(fields({ ...valid, endDate: '2025-06-12' })).toEqual(['endDate']);
  });
});

describe('totalBudgetLimitCents', () => {
  it('uses the amount as-is for total budgets (Req 11.5)', () => {
    expect(totalBudgetLimitCents({ budgetCents: 250000, budgetType: 'total', travelerCount: 4 })).toBe(250000);
  });
  it('multiplies by traveler count for per-person budgets (Req 11.4)', () => {
    expect(totalBudgetLimitCents({ budgetCents: 50000, budgetType: 'perPerson', travelerCount: 4 })).toBe(200000);
  });
});
