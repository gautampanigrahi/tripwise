import { describe, expect, it } from 'vitest';
import { formatEstimate, parseCatalog, type Catalog } from './catalog.js';

const price = (cents: number) => ({ cents, estimatedAsOf: '2025-01-15' });
const stay = (id: string, sleeps: number, cents: number) => ({
  id,
  name: id,
  address: '1 Main St, San Diego, CA',
  sleeps,
  nightlyPrice: price(cents),
  features: { wifi: true },
});
const activity = (id: string, cents: number) => ({ id, name: id, pricePerPerson: price(cents) });

const validCatalog = (): Catalog => ({
  version: 'san-diego-v1',
  city: 'San Diego',
  stays: [stay('a', 2, 18000), stay('b', 6, 45000), stay('c', 4, 30000)],
  activities: ['1', '2', '3', '4', '5'].map((id) => activity(id, 1000)),
  travelTimes: [{ from: 'A', to: 'B', minutes: 10 }],
});

describe('parseCatalog', () => {
  it('accepts a valid catalog', () => {
    const r = parseCatalog(validCatalog(), 'v1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.catalog.stays).toHaveLength(3);
  });

  it('rejects too few stays and names the version', () => {
    const c = validCatalog();
    c.stays = c.stays.slice(0, 2);
    const r = parseCatalog(c, 'v7');
    expect(r).toMatchObject({ ok: false, version: 'v7' });
    if (!r.ok) expect(r.errors.some((e) => e.field === 'stays')).toBe(true);
  });

  it('rejects a negative price and a missing estimatedAsOf with field paths', () => {
    const c = validCatalog() as unknown as {
      stays: Array<{ nightlyPrice: { cents: number } }>;
      activities: Array<{ pricePerPerson: Record<string, unknown> }>;
    };
    c.stays[0]!.nightlyPrice.cents = -1;
    delete c.activities[2]!.pricePerPerson.estimatedAsOf;
    const r = parseCatalog(c, 'v1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field);
      expect(fields).toContain('stays.0.nightlyPrice.cents');
      expect(fields).toContain('activities.2.pricePerPerson.estimatedAsOf');
    }
  });

  it('rejects non-object input with a root error', () => {
    const r = parseCatalog('nope', 'v1');
    expect(r).toMatchObject({ ok: false, version: 'v1' });
    if (!r.ok) expect(r.errors[0]?.field).toBe('(root)');
  });
});

describe('formatEstimate', () => {
  it('labels whole-dollar prices with unit and date', () => {
    expect(formatEstimate({ cents: 18900, estimatedAsOf: '2025-01-15' }, 'night')).toBe(
      'Est. $189/night (as of 2025-01-15)',
    );
  });

  it('shows cents when present and omits the unit when not given', () => {
    expect(formatEstimate({ cents: 123456, estimatedAsOf: '2025-02-01' })).toBe(
      'Est. $1,234.56 (as of 2025-02-01)',
    );
    expect(formatEstimate({ cents: 5, estimatedAsOf: '2025-02-01' }, 'person')).toBe(
      'Est. $0.05/person (as of 2025-02-01)',
    );
  });
});
