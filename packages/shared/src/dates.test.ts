import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { IsoDateSchema, range, toEpochDay, tripNights } from './dates.js';

const isoDate = fc
  .date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe('IsoDateSchema', () => {
  it('accepts real dates', () => {
    for (const s of ['2025-06-12', '2024-02-29', '1999-12-31']) {
      expect(IsoDateSchema.safeParse(s).success).toBe(true);
    }
  });
  it('rejects malformed or impossible dates', () => {
    for (const s of ['2025-6-12', '2025-02-30', '2023-02-29', '2025-13-01', '2025-06-12T00:00:00Z', '', 'abc']) {
      expect(IsoDateSchema.safeParse(s).success).toBe(false);
    }
  });
});

describe('toEpochDay', () => {
  it('maps known dates', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('1970-01-02')).toBe(1);
    expect(toEpochDay('2025-06-12')).toBe(Date.UTC(2025, 5, 12) / 86_400_000);
  });
  it('is an integer and consecutive dates differ by 1', () => {
    fc.assert(
      fc.property(isoDate, (d) => {
        const n = toEpochDay(d);
        expect(Number.isInteger(n)).toBe(true);
        const next = new Date(n * 86_400_000 + 86_400_000).toISOString().slice(0, 10);
        expect(toEpochDay(next)).toBe(n + 1);
      }),
    );
  });
});

describe('range / tripNights', () => {
  it('range is half-open', () => {
    expect(range(3, 6)).toEqual([3, 4, 5]);
    expect(range(5, 5)).toEqual([]);
    expect(range(6, 3)).toEqual([]);
  });
  it('demo trip 2025-06-12 to 2025-06-16 has 4 nights', () => {
    const nights = tripNights('2025-06-12', '2025-06-16');
    expect(nights).toHaveLength(4);
    expect(nights[0]).toBe(toEpochDay('2025-06-12'));
    expect(nights[3]).toBe(toEpochDay('2025-06-15'));
  });
  it('handles month and leap-year boundaries', () => {
    expect(tripNights('2024-02-28', '2024-03-01')).toHaveLength(2);
    expect(tripNights('2025-12-31', '2026-01-02')).toHaveLength(2);
  });
  it('night count equals end minus start in epoch days, includes start, excludes end', () => {
    fc.assert(
      fc.property(isoDate, isoDate, (a, b) => {
        const [s, e] = a <= b ? [a, b] : [b, a];
        const nights = tripNights(s, e);
        expect(nights.length).toBe(toEpochDay(e) - toEpochDay(s));
        if (s !== e) expect(nights[0]).toBe(toEpochDay(s));
        expect(nights).not.toContain(toEpochDay(e));
      }),
    );
  });
});
