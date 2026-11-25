import { describe, expect, it } from 'vitest';
import type { TripConstraints } from '@tripwise/shared';
import { runChecks } from '../runChecks.js';
import type { EngineInput, ItineraryStop } from '../types.js';
import { scheduleCheck } from './schedule.js';

const constraints: TripConstraints = {
  destination: 'San Diego',
  startDate: '2025-06-01',
  endDate: '2025-06-04',
  travelerCount: 2,
  budgetCents: 500_000,
  budgetType: 'total',
  requiredFeatures: [],
  plannedActivityIds: [],
  accessibilityNeeds: [],
  travelTimeCapMinutes: 30,
};

const stop = (itemId: string, day: string, startTime: string, stopName: string): ItineraryStop => ({
  itemId,
  day,
  startTime,
  stopName,
});

function input(itinerary: ItineraryStop[], cap: number | null = 30): EngineInput {
  const c = { ...constraints };
  if (cap === null) delete c.travelTimeCapMinutes;
  else c.travelTimeCapMinutes = cap;
  return {
    stay: { name: 'House', sleeps: 2, nightlyPriceCents: 10_000, features: {}, checkIn: '2025-06-01', checkOut: '2025-06-04' },
    transportCostsCents: [],
    itinerary,
    constraints: c,
    catalog: {
      version: 'v1',
      activities: [],
      travelTimes: [
        { from: 'Balboa Park', to: 'Gaslamp', minutes: 10 },
        { from: 'Gaslamp', to: 'La Jolla', minutes: 25 },
      ],
    },
    enabledChecks: ['Cost', 'Capacity', 'Dates', 'Schedule'],
  };
}

describe('scheduleCheck', () => {
  it('returns null when no travel-time cap is set', () => {
    expect(scheduleCheck(input([], null))).toBeNull();
  });

  it('measures the largest daily total, ordering by start time and looking up either direction', () => {
    const out = scheduleCheck(
      input([
        // Day 1, given out of order: Gaslamp 09:00 -> Balboa 11:00 (reverse lookup, 10) -> Balboa 14:00 (same, 0)
        stop('b', '2025-06-02', '11:00', 'Balboa Park'),
        stop('a', '2025-06-02', '09:00', 'Gaslamp'),
        stop('c', '2025-06-02', '14:00', 'Balboa Park'),
        // Day 2: Gaslamp -> La Jolla = 25
        stop('d', '2025-06-03', '09:00', 'Gaslamp'),
        stop('e', '2025-06-03', '12:00', 'La Jolla'),
      ]),
    );
    expect(out).toEqual({ check: 'Schedule', measured: 25, limit: 30, unit: 'MINUTES', passed: true });
  });

  it('passes at exactly the cap and fails one minute over', () => {
    const stops = [stop('a', '2025-06-02', '09:00', 'Gaslamp'), stop('b', '2025-06-02', '12:00', 'La Jolla')];
    expect(scheduleCheck(input(stops, 25))!.passed).toBe(true);
    expect(scheduleCheck(input(stops, 24))!.passed).toBe(false);
  });

  it('fails and names missing pairs in sorted order', () => {
    const out = scheduleCheck(
      input([
        stop('a', '2025-06-02', '09:00', 'Zoo'),
        stop('b', '2025-06-02', '10:00', 'Gaslamp'),
        stop('c', '2025-06-02', '11:00', 'Balboa Park'),
        stop('d', '2025-06-02', '12:00', 'Midway'),
      ]),
    )!;
    expect(out.passed).toBe(false);
    expect(out.measured).toBe(10);
    expect(out.details).toEqual({
      missingPairs: [
        ['Balboa Park', 'Midway'],
        ['Zoo', 'Gaslamp'],
      ],
    });
  });

  it('is emitted by runChecks only when enabled and a cap is set', () => {
    const stops = [stop('a', '2025-06-02', '09:00', 'Gaslamp'), stop('b', '2025-06-02', '12:00', 'La Jolla')];
    const names = (i: EngineInput) => runChecks(i).outcomes.map((o) => o.check);
    expect(names(input(stops))).toEqual(['Cost', 'Capacity', 'Dates', 'Schedule']);
    expect(names(input(stops, null))).toEqual(['Cost', 'Capacity', 'Dates']);
    expect(names({ ...input(stops), enabledChecks: ['Cost', 'Capacity', 'Dates'] })).toEqual(['Cost', 'Capacity', 'Dates']);
  });
});
