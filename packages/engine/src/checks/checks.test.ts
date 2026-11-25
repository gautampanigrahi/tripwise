import { describe, expect, it } from 'vitest';
import type { TripConstraints } from '@tripwise/shared';
import { EngineInputError } from '../errors.js';
import type { EngineInput } from '../types.js';
import { capacityCheck } from './capacity.js';
import { costCheck } from './cost.js';
import { datesCheck } from './dates.js';

const constraints: TripConstraints = {
  destination: 'San Diego',
  startDate: '2025-06-01',
  endDate: '2025-06-04', // 3 nights
  travelerCount: 4,
  budgetCents: 200_000,
  budgetType: 'total',
  requiredFeatures: [],
  plannedActivityIds: ['zoo', 'kayak'],
  accessibilityNeeds: [],
};

const price = (cents: number) => ({ cents, estimatedAsOf: '2025-01-15' });

function input(overrides: Partial<EngineInput> = {}, c: Partial<TripConstraints> = {}): EngineInput {
  return {
    stay: {
      name: 'Beach House',
      sleeps: 4,
      nightlyPriceCents: 30_000,
      features: {},
      checkIn: '2025-06-01',
      checkOut: '2025-06-04',
    },
    transportCostsCents: [5_000, 2_500],
    itinerary: [],
    constraints: { ...constraints, ...c },
    catalog: {
      version: 'v1',
      activities: [
        { id: 'zoo', name: 'Zoo', pricePerPerson: price(7_000) },
        { id: 'kayak', name: 'Kayak', pricePerPerson: price(4_550) },
      ],
      travelTimes: [],
    },
    enabledChecks: ['Cost', 'Capacity', 'Dates'],
    ...overrides,
  };
}

describe('costCheck', () => {
  it('sums lodging, transport, and activities × travelers in cents', () => {
    // 30000×3 + 7500 + (7000+4550)×4 = 90000 + 7500 + 46200
    expect(costCheck(input(), 3)).toEqual({
      check: 'Cost',
      measured: 143_700,
      limit: 200_000,
      unit: 'USD_CENTS',
      passed: true,
    });
  });

  it('passes at exactly the limit and fails one cent over', () => {
    expect(costCheck(input({}, { budgetCents: 143_700 }), 3).passed).toBe(true);
    expect(costCheck(input({}, { budgetCents: 143_699 }), 3).passed).toBe(false);
  });

  it('multiplies a per-person budget by traveler count', () => {
    const o = costCheck(input({}, { budgetType: 'perPerson', budgetCents: 30_000 }), 3);
    expect(o.limit).toBe(120_000);
    expect(o.passed).toBe(false);
  });

  it('throws UNKNOWN_ACTIVITY for an activity missing from the catalog', () => {
    const run = () => costCheck(input({}, { plannedActivityIds: ['zoo', 'ghost'] }), 3);
    expect(run).toThrow(EngineInputError);
    try {
      run();
    } catch (e) {
      expect((e as EngineInputError).code).toBe('UNKNOWN_ACTIVITY');
      expect((e as EngineInputError).ref).toBe('ghost');
    }
  });
});

describe('capacityCheck', () => {
  it('passes when sleeps >= travelers and fails below', () => {
    expect(capacityCheck(input())).toEqual({ check: 'Capacity', measured: 4, limit: 4, unit: 'BEDS', passed: true });
    expect(capacityCheck(input({}, { travelerCount: 5 })).passed).toBe(false);
  });
});

describe('datesCheck', () => {
  it('passes when lodging covers every trip night', () => {
    expect(datesCheck(input())).toEqual({ check: 'Dates', measured: 3, limit: 3, unit: 'NIGHTS', passed: true });
  });

  it('counts only covered nights when lodging is short (checkout day is not a night)', () => {
    const base = input();
    const o = datesCheck({ ...base, stay: { ...base.stay, checkIn: '2025-06-02', checkOut: '2025-06-03' } });
    expect(o).toMatchObject({ measured: 1, limit: 3, passed: false });
  });

  it('handles lodging wider than the trip and across a month boundary', () => {
    const base = input({}, { startDate: '2025-06-29', endDate: '2025-07-02' });
    const o = datesCheck({ ...base, stay: { ...base.stay, checkIn: '2025-06-20', checkOut: '2025-07-10' } });
    expect(o).toMatchObject({ measured: 3, limit: 3, passed: true });
  });
});
