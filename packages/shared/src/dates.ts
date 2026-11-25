import { z } from 'zod';
import type { IsoDate } from './types.js';

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `s` is `YYYY-MM-DD` and names a real calendar date (rejects e.g. 2025-02-30). */
function isRealDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC maps years 0–99 to 1900–1999, so set the full year explicitly.
  dt.setUTCFullYear(y);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const IsoDateSchema = z
  .string()
  .refine(isRealDate, { error: 'Must be a valid date in YYYY-MM-DD format' });

/** Whole days since 1970-01-01 UTC. Timezone-independent. */
export const toEpochDay = (d: IsoDate): number => {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  dt.setUTCFullYear(+d.slice(0, 4));
  return dt.getTime() / MS_PER_DAY;
};

/** Integers in `[start, end)`; empty when `end <= start`. */
export const range = (start: number, end: number): number[] => {
  const out: number[] = [];
  for (let n = start; n < end; n++) out.push(n);
  return out;
};

/** Trip_Night list as epoch days: each night from start up to, but not including, end. */
export const tripNights = (start: IsoDate, end: IsoDate): number[] =>
  range(toEpochDay(start), toEpochDay(end));
