import { IsoDateSchema, toEpochDay } from './dates.js';
import type { FieldError, IsoDate, ValidationResult } from './types.js';

/** Validated trip submission. `name` and `destination` are trimmed. */
export interface TripInput {
  name: string;
  destination: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates a trip submission (Req 2.2, 2.3).
 * Accepts iff name and destination are non-empty after trimming, both dates are
 * valid `YYYY-MM-DD` dates, and endDate is later than startDate. On rejection the
 * error list names exactly the invalid fields, each at most once.
 */
export function validateTripInput(input: unknown): ValidationResult<TripInput> {
  const body = isRecord(input) ? input : {};
  const errors: FieldError[] = [];

  const text = (field: 'name' | 'destination'): string => {
    const raw = body[field];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v === '') errors.push({ field, message: `${field} must not be empty` });
    return v;
  };
  const date = (field: 'startDate' | 'endDate'): IsoDate | undefined => {
    const parsed = IsoDateSchema.safeParse(body[field]);
    if (!parsed.success) {
      errors.push({ field, message: `${field} must be a valid date in YYYY-MM-DD format` });
      return undefined;
    }
    return parsed.data;
  };

  const name = text('name');
  const destination = text('destination');
  const startDate = date('startDate');
  const endDate = date('endDate');

  if (startDate !== undefined && endDate !== undefined && toEpochDay(endDate) <= toEpochDay(startDate)) {
    errors.push({ field: 'endDate', message: 'endDate must be later than startDate' });
  }

  if (errors.length > 0 || startDate === undefined || endDate === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, destination, startDate, endDate } };
}
