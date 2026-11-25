import { z } from 'zod';
import { IsoDateSchema, toEpochDay } from './dates.js';
import type { IsoDate, ValidationResult } from './types.js';

export type BudgetType = 'total' | 'perPerson';

/** Stored Trip_Constraints (Req 11.1). Money is integer US cents. */
export interface TripConstraints {
  destination: string;
  startDate: IsoDate;
  endDate: IsoDate;
  travelerCount: number; // integer >= 1 (11.2)
  budgetCents: number; // integer > 0 (11.3)
  budgetType: BudgetType;
  requiredFeatures: string[];
  plannedActivityIds: string[];
  accessibilityNeeds: string[];
  walkingDistanceLimitMeters?: number;
  travelTimeCapMinutes?: number;
}

const DOLLARS_RE = /^\d+(\.\d{1,2})?$/;

/** Converts a validated dollar string (e.g. `"2500"`, `"12.5"`, `"0.99"`) to integer cents without floats. */
export function dollarsToCents(s: string): number {
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const BudgetSchema = z
  .string()
  .regex(DOLLARS_RE, { error: 'budget must be a dollar amount like 2500 or 2500.00' })
  .transform(dollarsToCents)
  .refine((c) => c > 0, { error: 'budget must be a positive amount' })
  .refine(Number.isSafeInteger, { error: 'budget is too large' });

const StringList = z.array(z.string().trim().min(1)).default([]);

/**
 * Strict schema for a Trip_Constraints submission (Req 11.1–11.3). Takes `budget` as a
 * dollar string and outputs `TripConstraints` with `budgetCents`. Unknown keys are rejected.
 */
export const ConstraintsSchema = z
  .strictObject({
    destination: z.string().trim().min(1, { error: 'destination must not be empty' }),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    travelerCount: z
      // v3's `invalid_type_error` applied only to present, wrongly typed values; missing keeps the default.
      .number({ error: (iss) => (iss.input === undefined ? undefined : 'travelerCount must be a number') })
      .int({ error: 'travelerCount must be a whole number' })
      .positive({ error: 'travelerCount must be positive' }),
    budget: BudgetSchema,
    budgetType: z.enum(['total', 'perPerson']),
    requiredFeatures: StringList,
    plannedActivityIds: StringList,
    accessibilityNeeds: StringList,
    // zod 4 numbers reject Infinity and NaN, so `.finite()` is implicit.
    walkingDistanceLimitMeters: z.number().positive().optional(),
    travelTimeCapMinutes: z.number().int().positive().optional(),
  })
  .superRefine((c, ctx) => {
    if (toEpochDay(c.endDate) <= toEpochDay(c.startDate)) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be later than startDate' });
    }
  })
  .transform(({ budget, ...rest }): TripConstraints => {
    const out: TripConstraints = { ...rest, budgetCents: budget };
    if (out.walkingDistanceLimitMeters === undefined) delete out.walkingDistanceLimitMeters;
    if (out.travelTimeCapMinutes === undefined) delete out.travelTimeCapMinutes;
    return out;
  });

export type ConstraintsInput = z.input<typeof ConstraintsSchema>;

/** Runs `ConstraintsSchema`, reporting every issue as `{ field, message }`. Unknown keys are reported by name. */
export function validateConstraints(input: unknown): ValidationResult<TripConstraints> {
  const r = ConstraintsSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const errors = r.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((k) => ({ field: k, message: 'Unknown field' }))
      : [{ field: issue.path.map(String).join('.'), message: issue.message }],
  );
  return { ok: false, errors };
}

/** Total budget limit in cents: per person × travelers, or the total as-is (Req 11.4, 11.5). */
export function totalBudgetLimitCents(
  c: Pick<TripConstraints, 'budgetCents' | 'budgetType' | 'travelerCount'>,
): number {
  return c.budgetType === 'perPerson' ? c.budgetCents * c.travelerCount : c.budgetCents;
}
