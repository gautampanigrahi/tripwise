import { describe, expect, it } from 'vitest';
import { tripNights, validatePlanItem } from '@tripwise/shared';
import { addDays, buildSeedData, defaultStartDate, loadCatalog } from './seed.js';

const members = [1, 2, 3, 4].map((n) => ({ userId: `user-${n}`, email: `demo${n}@example.com` }));
const build = (startDate = '2026-03-10') =>
  buildSeedData({ startDate, members, catalog: loadCatalog(), now: '2026-01-01T00:00:00.000Z' });

describe('buildSeedData (Req 27.1)', () => {
  it('spans 4 nights from the start date', () => {
    const { trip, constraints } = build('2026-02-26');
    expect(trip.endDate).toBe('2026-03-02');
    expect(tripNights(trip.startDate, trip.endDate)).toHaveLength(4);
    expect(constraints.startDate).toBe(trip.startDate);
    expect(constraints.endDate).toBe(trip.endDate);
  });

  it('sets 4 travelers, 4 members and a $2,500 total budget', () => {
    const { trip, members: m, constraints } = build();
    expect(m).toHaveLength(4);
    expect(trip.hostId).toBe('user-1');
    expect(constraints).toMatchObject({ travelerCount: 4, budgetCents: 250000, budgetType: 'total' });
  });

  it('selects the Gaslamp studio, which sleeps 2', () => {
    const lodging = build().planItems.filter((i) => i.section === 'Lodging');
    expect(lodging).toHaveLength(1);
    expect(lodging[0]!.fields).toMatchObject({ catalogStayId: 'sd-gaslamp-studio', sleeps: 2, selected: true });
  });

  it('produces Plan_Items that pass the API section validation', () => {
    const { trip, planItems } = build();
    const ctx = { trip, memberIds: new Set(members.map((m) => m.userId)) };
    expect(planItems.some((i) => i.section === 'Itinerary')).toBe(true);
    expect(planItems.some((i) => i.section === 'Groceries')).toBe(true);
    for (const item of planItems) {
      expect(validatePlanItem(item.section, item.fields, ctx)).toMatchObject({ ok: true });
    }
  });

  it('defaults the start to 30 days after today (UTC)', () => {
    expect(defaultStartDate(Date.parse('2026-01-15T23:30:00Z'))).toBe('2026-02-14');
    expect(addDays('2024-02-27', 4)).toBe('2024-03-02');
  });
});
