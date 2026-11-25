import { describe, expect, it } from 'vitest';
import { runChecks } from '../runChecks.js';
import type { EngineInput } from '../types.js';
import { preferencesCheck } from './preferences.js';

function input(requiredFeatures: string[], features: Record<string, boolean>): EngineInput {
  return {
    stay: { name: 'House', sleeps: 2, nightlyPriceCents: 10_000, features, checkIn: '2025-06-01', checkOut: '2025-06-04' },
    transportCostsCents: [],
    itinerary: [],
    constraints: {
      destination: 'San Diego',
      startDate: '2025-06-01',
      endDate: '2025-06-04',
      travelerCount: 2,
      budgetCents: 500_000,
      budgetType: 'total',
      requiredFeatures,
      plannedActivityIds: [],
      accessibilityNeeds: [],
    },
    catalog: { version: 'v1', activities: [], travelTimes: [] },
    enabledChecks: ['Cost', 'Capacity', 'Dates', 'Preferences'],
  };
}

describe('preferencesCheck', () => {
  it('passes when every required feature is true (Req 18.1, 18.2)', () => {
    expect(preferencesCheck(input(['wifi', 'parking'], { wifi: true, parking: true, pool: false }))).toEqual({
      check: 'Preferences',
      measured: 2,
      limit: 2,
      unit: 'FEATURES',
      passed: true,
    });
  });

  it('fails and lists sorted unmet features when one is false or absent, de-duplicating (Req 18.3)', () => {
    expect(preferencesCheck(input(['wifi', 'step-free entry', 'parking', 'wifi'], { wifi: true, parking: false }))).toEqual({
      check: 'Preferences',
      measured: 1,
      limit: 3,
      unit: 'FEATURES',
      passed: false,
      details: { unmetFeatures: ['parking', 'step-free entry'] },
    });
  });

  it('returns null when no features are required', () => {
    expect(preferencesCheck(input([], { wifi: true }))).toBeNull();
  });

  it('is emitted by runChecks only when enabled', () => {
    const i = input(['pool'], {});
    expect(runChecks(i).outcomes.map((o) => o.check)).toEqual(['Cost', 'Capacity', 'Dates', 'Preferences']);
    expect(runChecks({ ...i, enabledChecks: [] }).outcomes.map((o) => o.check)).toEqual(['Cost', 'Capacity', 'Dates']);
  });
});
