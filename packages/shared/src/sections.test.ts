import { describe, expect, it } from 'vitest';
import { SECTIONS, parseSection, validatePlanItem, type ValidationContext } from './sections.js';
import type { Section } from './types.js';

const ctx: ValidationContext = {
  trip: { startDate: '2025-07-10', endDate: '2025-07-14' },
  memberIds: new Set(['u-host', 'u-ana']),
};

const fieldsOf = (section: Section, input: unknown): string[] => {
  const r = validatePlanItem(section, input, ctx);
  return r.ok ? [] : r.errors.map((e) => e.field).sort();
};

const lodging = { checkIn: '2025-07-10', checkOut: '2025-07-14', sleeps: 4, nightlyPriceCents: 18000 };
const itinerary = { day: '2025-07-11', startTime: '09:00', endTime: '10:30', stopName: 'Balboa Park' };
const groceries = { name: 'Eggs', quantity: 12, responsibleMemberId: 'u-ana', purchased: false };
const checklist = { task: 'Book parking', done: false };
const expense = { payerMemberId: 'u-host', amount: '42.50', purpose: 'Dinner' };
const generic = { title: 'Rental car', costCents: 25000, date: '2025-07-10', link: 'https://example.com' };

describe('parseSection', () => {
  it('accepts every valid Section name', () => {
    for (const s of SECTIONS) expect(parseSection(s)).toBe(s);
  });
  it.each(['', 'lodging', 'Lodging ', 'Scratch pad', 'Hotels', 'toString', '__proto__'])(
    'rejects %j',
    (s) => expect(parseSection(s)).toBeUndefined(),
  );
});

describe('validatePlanItem: valid items', () => {
  it.each<[Section, unknown]>([
    ['Lodging', { ...lodging, checkInDetails: { doorCode: '1234' }, listingUrl: 'https://x.test/a' }],
    ['Itinerary', itinerary],
    ['Itinerary', { day: '2025-07-14', startTime: '09:00', stopName: 'Airport' }],
    ['Groceries', groceries],
    ['Checklist', checklist],
    ['Expenses', expense],
    ['Transportation', generic],
    ['Reservations', { title: 'Zoo tickets' }],
    ['ScratchPad', { title: 'Ideas', notes: 'beach day?' }],
  ])('%s accepts valid fields', (section, input) => {
    expect(validatePlanItem(section, input, ctx).ok).toBe(true);
  });

  it('converts Expenses amount to integer cents', () => {
    const r = validatePlanItem('Expenses', { ...expense, amount: '2850.5' }, ctx);
    expect(r).toEqual({ ok: true, value: { payerMemberId: 'u-host', amountCents: 285050, purpose: 'Dinner' } });
  });

  it('defaults Checklist done and Groceries purchased to false', () => {
    expect(validatePlanItem('Checklist', { task: 'Pack' }, ctx)).toEqual({ ok: true, value: { task: 'Pack', done: false } });
    const g = validatePlanItem('Groceries', { name: 'Milk', quantity: 1, responsibleMemberId: 'u-ana' }, ctx);
    expect(g.ok && g.value.purchased).toBe(false);
  });
});

describe('validatePlanItem: rule violations', () => {
  it('Lodging: check-out not after check-in (6.2)', () => {
    expect(fieldsOf('Lodging', { ...lodging, checkOut: '2025-07-10' })).toEqual(['checkOut']);
    expect(fieldsOf('Lodging', { ...lodging, checkOut: '2025-07-09' })).toEqual(['checkOut']);
  });

  it.each([0, -1, 2.5, '4'])('Lodging: sleeps %j is rejected (6.3)', (sleeps) => {
    expect(fieldsOf('Lodging', { ...lodging, sleeps })).toEqual(['sleeps']);
  });

  it('Lodging: rejects non-https listing URL and unknown nested keys', () => {
    expect(
      fieldsOf('Lodging', { ...lodging, listingUrl: 'http://x.test', checkInDetails: { doorCode: '1', wifi: 'x' } }),
    ).toEqual(['checkInDetails.wifi', 'listingUrl']);
  });

  it('Itinerary: day outside the trip range (7.2)', () => {
    expect(fieldsOf('Itinerary', { ...itinerary, day: '2025-07-09' })).toEqual(['day']);
    expect(fieldsOf('Itinerary', { ...itinerary, day: '2025-07-15' })).toEqual(['day']);
  });

  it('Itinerary: stores a map pin and requires both coordinates', () => {
    const r = validatePlanItem('Itinerary', { ...itinerary, lat: 32.73, lng: -117.14 }, ctx);
    expect(r.ok && r.value).toMatchObject({ lat: 32.73, lng: -117.14, stopName: 'Balboa Park' });
    expect(fieldsOf('Itinerary', { ...itinerary, lat: 32.73 })).toEqual(['lng']);
    expect(fieldsOf('Itinerary', { ...itinerary, lat: 91, lng: 0 })).toEqual(['lat']);
  });

  it('Itinerary: end time before start time (7.3), equal is allowed', () => {
    expect(fieldsOf('Itinerary', { ...itinerary, endTime: '08:59' })).toEqual(['endTime']);
    expect(fieldsOf('Itinerary', { ...itinerary, endTime: '09:00' })).toEqual([]);
  });

  it('Itinerary: malformed times and empty stop name', () => {
    expect(fieldsOf('Itinerary', { ...itinerary, startTime: '9:00', endTime: '24:00', stopName: '  ' })).toEqual([
      'endTime',
      'startTime',
      'stopName',
    ]);
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])('Groceries: quantity %j is rejected (8.4)', (quantity) => {
    expect(fieldsOf('Groceries', { ...groceries, quantity })).toEqual(['quantity']);
  });

  it('Groceries: responsible person must be a Member (8.3)', () => {
    expect(fieldsOf('Groceries', { ...groceries, responsibleMemberId: 'u-stranger' })).toEqual(['responsibleMemberId']);
  });

  it.each(['0', '0.00', '-5', '1.234', '12.', '.5', 'abc', '1e3', ''])('Expenses: amount %j is rejected (10.2)', (amount) => {
    expect(fieldsOf('Expenses', { ...expense, amount })).toEqual(['amount']);
  });

  it('Expenses: payer must be a Member', () => {
    expect(fieldsOf('Expenses', { ...expense, payerMemberId: 'u-stranger' })).toEqual(['payerMemberId']);
  });

  it('Expenses: stores each share in cents when the shares add up', () => {
    const r = validatePlanItem(
      'Expenses',
      {
        ...expense,
        amount: '10.00',
        splits: [
          { memberId: 'u-host', amount: '4.00' },
          { memberId: 'u-ana', amount: '6.00' },
        ],
      },
      ctx,
    );
    expect(r).toEqual({
      ok: true,
      value: {
        payerMemberId: 'u-host',
        amountCents: 1000,
        purpose: 'Dinner',
        splits: [
          { memberId: 'u-host', amountCents: 400 },
          { memberId: 'u-ana', amountCents: 600 },
        ],
      },
    });
  });

  it('Expenses: shares must add up, name Members, and list each person once', () => {
    expect(
      fieldsOf('Expenses', {
        ...expense,
        amount: '10.00',
        splits: [
          { memberId: 'u-host', amount: '4.00' },
          { memberId: 'u-ana', amount: '5.00' },
        ],
      }),
    ).toEqual(['splits']);
    expect(
      fieldsOf('Expenses', {
        ...expense,
        splits: [{ memberId: 'u-stranger', amount: '42.50' }],
      }),
    ).toEqual(['splits.0.memberId']);
    expect(
      fieldsOf('Expenses', {
        ...expense,
        splits: [
          { memberId: 'u-ana', amount: '20.00' },
          { memberId: 'u-ana', amount: '20.00' },
        ],
      }),
    ).toEqual(['splits', 'splits.1.memberId']);
  });

  it('reports every invalid field together, including context rules (5.6)', () => {
    expect(
      fieldsOf('Groceries', { name: '', quantity: 0, responsibleMemberId: 'u-stranger', purchased: 'yes' }),
    ).toEqual(['name', 'purchased', 'quantity', 'responsibleMemberId']);
    expect(fieldsOf('Lodging', { checkIn: '2025-07-12', checkOut: '2025-07-11', sleeps: 0 })).toEqual([
      'checkOut',
      'nightlyPriceCents',
      'sleeps',
    ]);
  });

  it('rejects non-object input', () => {
    for (const input of [null, 'x', 3, []]) expect(fieldsOf('Checklist', input)).toEqual(['fields']);
  });
});

describe('validatePlanItem: server-controlled and unknown keys (4.4)', () => {
  it.each(['claimedBy', 'lastModifiedBy', 'userId'])('rejects client-supplied %s', (key) => {
    const r = validatePlanItem('Checklist', { ...checklist, [key]: 'u-ana' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([{ field: key, message: 'Is set by the server and must not be supplied' }]);
    }
  });

  it('rejects server-controlled keys in every Section', () => {
    for (const s of SECTIONS) {
      const errs = fieldsOf(s, { lastModifiedBy: 'x', userId: 'y' });
      expect(errs).toContain('lastModifiedBy');
      expect(errs).toContain('userId');
    }
  });

  it('rejects unknown keys', () => {
    expect(fieldsOf('ScratchPad', { title: 'x', color: 'red' })).toEqual(['color']);
  });
});
