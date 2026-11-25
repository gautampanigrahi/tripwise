import { describe, expect, it } from 'vitest';
import type { CatalogStay } from './catalog.js';
import {
  applyUpdate,
  claim,
  confirmationKey,
  groupItinerary,
  lodgingFromCatalogStay,
  sanitizeFileName,
  stamp,
  type ChecklistItem,
  type ItineraryItem,
  type LodgingItem,
} from './planItems.js';
import { validatePlanItem } from './sections.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

function lodging(overrides: Partial<LodgingItem> = {}): LodgingItem {
  return {
    tripId: 't1',
    itemId: 'i1',
    section: 'Lodging',
    fields: { checkIn: '2025-07-01', checkOut: '2025-07-03', sleeps: 4, nightlyPriceCents: 20000 },
    lastModifiedBy: 'u1',
    lastModifiedAt: '2025-06-01T10:00:00.000Z',
    createdAt: '2025-06-01T09:00:00.000Z',
    ...overrides,
  };
}

function checklist(claimedBy?: string): ChecklistItem {
  return {
    tripId: 't1',
    itemId: 'c1',
    section: 'Checklist',
    fields: { task: 'Pack sunscreen', done: false, ...(claimedBy ? { claimedBy } : {}) },
    lastModifiedBy: 'u1',
    lastModifiedAt: '2025-06-01T10:00:00.000Z',
    createdAt: '2025-06-01T10:00:00.000Z',
  };
}

describe('stamp', () => {
  it('keeps the fields and sets caller and clock', () => {
    const out = stamp({ name: 'Milk', purchased: true }, 'u2', () => '2025-06-02T00:00:00.000Z');
    expect(out).toEqual({
      name: 'Milk',
      purchased: true,
      lastModifiedBy: 'u2',
      lastModifiedAt: '2025-06-02T00:00:00.000Z',
    });
  });

  it('overrides any client-supplied metadata', () => {
    const out = stamp({ lastModifiedBy: 'evil', lastModifiedAt: 'x' }, 'u2', () => 'now');
    expect(out.lastModifiedBy).toBe('u2');
    expect(out.lastModifiedAt).toBe('now');
  });
});

describe('applyUpdate', () => {
  it('rejects a stale expected value with 409 and the stored item', () => {
    const stored = lodging();
    const res = applyUpdate(stored, '2025-05-31T00:00:00.000Z', lodging({ lastModifiedBy: 'u2' }));
    expect(res).toEqual({ ok: false, status: 409, current: stored });
  });

  it('applies new fields and metadata when expected matches', () => {
    const stored = lodging();
    const next = lodging({
      fields: { ...stored.fields, sleeps: 6 },
      lastModifiedBy: 'u2',
      lastModifiedAt: '2025-06-02T00:00:00.000Z',
    });
    const res = applyUpdate(stored, stored.lastModifiedAt, next);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.item.fields.sleeps).toBe(6);
      expect(res.item.lastModifiedBy).toBe('u2');
      expect(res.item.lastModifiedAt).toBe('2025-06-02T00:00:00.000Z');
    }
  });

  it('preserves identity and server-owned fields', () => {
    const stored = lodging({
      fields: { ...lodging().fields, confirmationKey: 'private/trips/t1/confirmations/i1/x-a.pdf' },
    });
    const next = lodging({
      tripId: 'other',
      itemId: 'other',
      createdAt: 'other',
      fields: { ...lodging().fields, sleeps: 2 },
    });
    const res = applyUpdate(stored, stored.lastModifiedAt, next);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.item.tripId).toBe('t1');
      expect(res.item.itemId).toBe('i1');
      expect(res.item.createdAt).toBe(stored.createdAt);
      expect(res.item.fields.confirmationKey).toBe(stored.fields.confirmationKey);
      expect(res.item.fields.sleeps).toBe(2);
    }
  });

  it('does not let an update introduce a server-owned field', () => {
    const stored = checklist();
    const next = checklist('u9');
    const res = applyUpdate(stored, stored.lastModifiedAt, next);
    expect(res.ok && 'claimedBy' in res.item.fields).toBe(false);
  });
});

describe('claim', () => {
  it('claims an unclaimed item for the caller', () => {
    const res = claim(checklist(), 'u2');
    expect(res.ok && res.item.fields.claimedBy).toBe('u2');
  });

  it('is idempotent for the current claimer', () => {
    const res = claim(checklist('u2'), 'u2');
    expect(res.ok && res.item.fields.claimedBy).toBe('u2');
  });

  it('rejects with 409 when claimed by someone else and leaves the item unchanged', () => {
    const item = checklist('u1');
    const before = structuredClone(item);
    expect(claim(item, 'u2')).toEqual({ ok: false, status: 409, claimedBy: 'u1' });
    expect(item).toEqual(before);
  });
});

describe('confirmationKey', () => {
  it('builds a key under the trip private prefix', () => {
    expect(confirmationKey('t1', 'i1', 'booking.pdf', UUID)).toBe(
      `private/trips/t1/confirmations/i1/${UUID}-booking.pdf`,
    );
  });

  it('sanitizes traversal, slashes, and unicode', () => {
    const key = confirmationKey('t1', 'i1', '../../etc/pässwd..txt', UUID);
    expect(key.startsWith('private/trips/t1/confirmations/i1/')).toBe(true);
    expect(key.split('/')).not.toContain('..');
    expect(key).not.toContain('..');
    expect(key).toBe(`private/trips/t1/confirmations/i1/${UUID}-etcpsswdtxt`);
  });

  it('generates a uuid when none is given', () => {
    const a = confirmationKey('t1', 'i1', 'a.pdf');
    const b = confirmationKey('t1', 'i1', 'a.pdf');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^private\/trips\/t1\/confirmations\/i1\/[0-9a-f-]{36}-a\.pdf$/);
  });

  it('rejects unsafe trip or item IDs', () => {
    expect(() => confirmationKey('..', 'i1', 'a.pdf', UUID)).toThrow();
    expect(() => confirmationKey('t1', 'a/b', 'a.pdf', UUID)).toThrow();
  });

  it('sanitizeFileName truncates to 100 chars and never returns empty', () => {
    expect(sanitizeFileName('a'.repeat(300))).toHaveLength(100);
    expect(sanitizeFileName('....')).toBe('file');
    expect(sanitizeFileName('日本語')).toBe('file');
    expect(sanitizeFileName('a...b')).toBe('ab');
  });
});

describe('lodgingFromCatalogStay', () => {
  const stay: CatalogStay = {
    id: 'sd-1',
    name: 'Mission Beach House',
    address: '123 Ocean Front Walk, San Diego, CA',
    sleeps: 8,
    nightlyPrice: { cents: 45000, estimatedAsOf: '2025-01-15' },
    features: { parking: true, pool: false, kitchen: true },
  };

  it('copies name, address, sleeps, price, id, and true features', () => {
    expect(lodgingFromCatalogStay(stay)).toEqual({
      name: 'Mission Beach House',
      address: '123 Ocean Front Walk, San Diego, CA',
      sleeps: 8,
      nightlyPriceCents: 45000,
      features: ['kitchen', 'parking'],
      catalogStayId: 'sd-1',
    });
  });

  it('passes Lodging validation once dates are added', () => {
    const res = validatePlanItem(
      'Lodging',
      { ...lodgingFromCatalogStay(stay), checkIn: '2025-07-01', checkOut: '2025-07-04' },
      { trip: { startDate: '2025-07-01', endDate: '2025-07-04' }, memberIds: new Set() },
    );
    expect(res.ok).toBe(true);
  });
});

describe('groupItinerary', () => {
  const it_ = (itemId: string, day: string, startTime: string): ItineraryItem => ({
    tripId: 't1',
    itemId,
    section: 'Itinerary',
    fields: { day, startTime, stopName: itemId },
    lastModifiedBy: 'u1',
    lastModifiedAt: 'x',
    createdAt: 'x',
  });

  it('returns an empty list for no items', () => {
    expect(groupItinerary([])).toEqual([]);
  });

  it('groups by ascending day and sorts by start time then itemId', () => {
    const items = [
      it_('d', '2025-07-02', '09:00'),
      it_('b', '2025-07-01', '12:00'),
      it_('c', '2025-07-01', '08:00'),
      it_('a', '2025-07-01', '12:00'),
    ];
    const snapshot = items.map((i) => i.itemId);
    const groups = groupItinerary(items);
    expect(groups.map((g) => [g.day, g.items.map((i) => i.itemId)])).toEqual([
      ['2025-07-01', ['c', 'a', 'b']],
      ['2025-07-02', ['d']],
    ]);
    expect(items.map((i) => i.itemId)).toEqual(snapshot);
  });
});
