import { describe, expect, it } from 'vitest';
import type { CatalogStay, LodgingItem, PlanItem } from '@tripwise/shared';
import { buildAlternativeInput } from './alternatives.js';
import { selectCurrentLodging, stayFromLodging } from './lodging.js';
import { OPTIONAL_CHECKS, runChecks } from './runChecks.js';
import type { EngineInput } from './types.js';

const price = (cents: number) => ({ cents, estimatedAsOf: '2025-01-15' });

// Seed scenario: 2025-06-12..16 (4 nights), 4 travelers, $2,500 total budget.
const base: EngineInput = {
  stay: {
    stayId: 'sd-gaslamp-studio',
    name: 'Gaslamp Studio',
    sleeps: 2,
    nightlyPriceCents: 18_000,
    features: { wifi: true },
    checkIn: '2025-06-12',
    checkOut: '2025-06-16',
  },
  transportCostsCents: [10_000, 2_500, 5_000],
  itinerary: [
    { itemId: 'b', day: '2025-06-13', startTime: '10:00', stopName: 'Zoo' },
    { itemId: 'a', day: '2025-06-12', startTime: '15:00', stopName: 'Beach' },
    { itemId: 'c', day: '2025-06-12', startTime: '09:00', stopName: 'Park' },
  ],
  constraints: {
    destination: 'San Diego',
    startDate: '2025-06-12',
    endDate: '2025-06-16',
    travelerCount: 4,
    budgetCents: 250_000,
    budgetType: 'total',
    requiredFeatures: [],
    plannedActivityIds: ['zoo'],
    accessibilityNeeds: [],
  },
  catalog: { version: 'v1', activities: [{ id: 'zoo', name: 'Zoo', pricePerPerson: price(7_000) }], travelTimes: [] },
  enabledChecks: ['Cost', 'Capacity', 'Dates'],
};

const northPark: CatalogStay = {
  id: 'sd-northpark-house',
  name: 'North Park House',
  address: '1 North Park Way',
  sleeps: 6,
  nightlyPrice: price(45_000),
  features: { wifi: true, parking: true },
};

describe('runChecks', () => {
  it('emits Cost, Capacity, Dates in fixed order with score and tripNights', () => {
    const out = runChecks(base);
    expect(out.outcomes.map((o) => o.check)).toEqual(['Cost', 'Capacity', 'Dates']);
    expect(out.tripNights).toBe(4);
    // 18000×4 + 17500 + 7000×4 = 117500
    expect(out.outcomes[0]).toMatchObject({ measured: 117_500, limit: 250_000, passed: true });
    expect(out.outcomes[1]).toMatchObject({ measured: 2, limit: 4, passed: false });
    expect(out.outcomes[2]).toMatchObject({ measured: 4, limit: 4, passed: true });
    expect(out.score).toBe(67);
  });

  it('runs required checks even when enabledChecks omits them', () => {
    const out = runChecks({ ...base, enabledChecks: [] });
    expect(out.outcomes.map((o) => o.check)).toEqual(['Cost', 'Capacity', 'Dates']);
  });

  it('is unaffected by input order and does not mutate the input', () => {
    const snapshot = structuredClone(base);
    const permuted: EngineInput = {
      ...base,
      transportCostsCents: [...base.transportCostsCents].reverse(),
      itinerary: [...base.itinerary].reverse(),
      enabledChecks: ['Dates', 'Cost', 'Capacity'],
    };
    expect(runChecks(permuted)).toEqual(runChecks(base));
    expect(base).toEqual(snapshot);
  });

  it('runs registered optional checks in fixed order, on normalized input, only when enabled', () => {
    const seen: string[][] = [];
    const saved = { ...OPTIONAL_CHECKS };
    OPTIONAL_CHECKS.Schedule = (i) => {
      seen.push(i.itinerary.map((s) => s.itemId));
      return { check: 'Schedule', measured: 0, limit: 60, unit: 'MINUTES', passed: true };
    };
    OPTIONAL_CHECKS.Preferences = () => null; // preconditions not met
    try {
      expect(runChecks(base).outcomes.map((o) => o.check)).toEqual(['Cost', 'Capacity', 'Dates']);
      const out = runChecks({ ...base, enabledChecks: ['Preferences', 'Schedule', 'Cost', 'Capacity', 'Dates'] });
      expect(out.outcomes.map((o) => o.check)).toEqual(['Cost', 'Capacity', 'Dates', 'Schedule']);
      expect(out.score).toBe(75);
      expect(seen).toEqual([['c', 'a', 'b']]);
    } finally {
      delete OPTIONAL_CHECKS.Schedule;
      delete OPTIONAL_CHECKS.Preferences;
      Object.assign(OPTIONAL_CHECKS, saved);
    }
  });
});

function lodging(itemId: string, lastModifiedAt: string, selected?: boolean): LodgingItem {
  return {
    tripId: 't1',
    itemId,
    section: 'Lodging',
    fields: { checkIn: '2025-06-12', checkOut: '2025-06-16', sleeps: 2, nightlyPriceCents: 18_000, selected },
    lastModifiedBy: 'u1',
    lastModifiedAt,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('selectCurrentLodging', () => {
  const other: PlanItem = { ...lodging('z', '2099-01-01T00:00:00.000Z'), section: 'Itinerary', fields: {} };

  it('returns undefined when there is no Lodging item', () => {
    expect(selectCurrentLodging([])).toBeUndefined();
    expect(selectCurrentLodging([other])).toBeUndefined();
  });

  it('prefers the selected item over a newer one', () => {
    const items = [lodging('a', '2025-02-01T00:00:00.000Z'), lodging('b', '2025-01-01T00:00:00.000Z', true)];
    expect(selectCurrentLodging(items as PlanItem[])?.itemId).toBe('b');
  });

  it('falls back to the most recently modified, ties broken by itemId, ignoring other sections', () => {
    const items = [
      lodging('b', '2025-02-01T00:00:00.000Z'),
      other,
      lodging('a', '2025-02-01T00:00:00.000Z'),
      lodging('c', '2025-01-01T00:00:00.000Z', false),
    ];
    expect(selectCurrentLodging(items as PlanItem[])?.itemId).toBe('a');
    expect(selectCurrentLodging([...items].reverse() as PlanItem[])?.itemId).toBe('a');
  });
});

describe('stayFromLodging', () => {
  it('maps Lodging fields to a stay input', () => {
    const item = lodging('a', '2025-02-01T00:00:00.000Z');
    item.fields = { ...item.fields, name: 'Studio', features: ['wifi'], catalogStayId: 'sd-gaslamp-studio' };
    expect(stayFromLodging(item)).toEqual({
      stayId: 'sd-gaslamp-studio',
      name: 'Studio',
      sleeps: 2,
      nightlyPriceCents: 18_000,
      features: { wifi: true },
      checkIn: '2025-06-12',
      checkOut: '2025-06-16',
    });
  });
});

describe('buildAlternativeInput', () => {
  it('substitutes only the stay, keeps check-in/out, and uses the latest check list', () => {
    const snapshot = structuredClone(base);
    const alt = buildAlternativeInput(base, northPark, ['Cost', 'Capacity', 'Dates']);
    expect(alt.stay).toEqual({
      stayId: 'sd-northpark-house',
      name: 'North Park House',
      sleeps: 6,
      nightlyPriceCents: 45_000,
      features: { wifi: true, parking: true },
      checkIn: '2025-06-12',
      checkOut: '2025-06-16',
    });
    expect({ ...alt, stay: base.stay }).toEqual(base);
    expect(base).toEqual(snapshot);
    // 45000×4 + 17500 + 28000 = 225500 ≤ 250000
    const out = runChecks(alt);
    expect(out.outcomes.every((o) => o.passed)).toBe(true);
    expect(out.score).toBe(100);
  });
});
