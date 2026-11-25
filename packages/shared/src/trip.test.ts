import { describe, expect, it } from 'vitest';
import { validateTripInput } from './trip.js';

const valid = { name: '  SD Weekend ', destination: 'San Diego', startDate: '2025-06-12', endDate: '2025-06-16' };
const fields = (r: ReturnType<typeof validateTripInput>) => (r.ok ? [] : r.errors.map((e) => e.field).sort());

describe('validateTripInput', () => {
  it('accepts a valid trip and trims text fields', () => {
    expect(validateTripInput(valid)).toEqual({
      ok: true,
      value: { name: 'SD Weekend', destination: 'San Diego', startDate: '2025-06-12', endDate: '2025-06-16' },
    });
  });

  it('rejects whitespace-only name and empty destination, naming both (Req 2.3)', () => {
    expect(fields(validateTripInput({ ...valid, name: '   ', destination: '' }))).toEqual(['destination', 'name']);
  });

  it('rejects end date equal to or before start, naming endDate (Req 2.2)', () => {
    expect(fields(validateTripInput({ ...valid, endDate: '2025-06-12' }))).toEqual(['endDate']);
    expect(fields(validateTripInput({ ...valid, endDate: '2025-06-01' }))).toEqual(['endDate']);
  });

  it('names a malformed date field without also flagging the other date', () => {
    expect(fields(validateTripInput({ ...valid, startDate: '2025-02-30' }))).toEqual(['startDate']);
  });

  it('reports every field for a non-object body', () => {
    expect(fields(validateTripInput(null))).toEqual(['destination', 'endDate', 'name', 'startDate']);
  });
});
