import { z } from 'zod';
import { IsoDateSchema, toEpochDay } from './dates.js';
import { SECTIONS } from './types.js';
import type { FieldError, IsoDate, Section, ValidationResult } from './types.js';

// `SECTIONS` and `Section` are defined in types.ts; re-exported here so callers can
// import everything Section-related from one module.
export { SECTIONS };
export type { Section };

const SECTION_SET: ReadonlySet<string> = new Set(SECTIONS);

/** Returns the Section when `s` is exactly one of the 8 valid names, else undefined (Req 5.5). */
export function parseSection(s: string): Section | undefined {
  return SECTION_SET.has(s) ? (s as Section) : undefined;
}

/** Trip data needed by the context rules (Req 7.2, 8.3). */
export interface ValidationContext {
  trip: { startDate: IsoDate; endDate: IsoDate };
  memberIds: ReadonlySet<string>;
}

/**
 * Keys the server sets from the verified token or its own logic. Schemas are strict,
 * so these are rejected like any unknown key, but with a clearer message (Req 4.4).
 */
export const SERVER_CONTROLLED_KEYS: ReadonlySet<string> = new Set([
  'userId',
  'lastModifiedBy',
  'lastModifiedAt',
  'hostId',
  'claimedBy',
]);

// ---------- field primitives ----------

const nonEmpty = z.string().trim().min(1, { error: 'Must not be empty' });
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TimeSchema = z.string().regex(TIME_RE, { error: 'Must be a time in HH:mm format' });
const HttpsUrlSchema = z.string().refine(
  (s) => {
    try {
      return new URL(s).protocol === 'https:';
    } catch {
      return false;
    }
  },
  { error: 'Must be an https URL' },
);
const CentsSchema = z
  .number()
  .int({ error: 'Must be a whole number of cents' })
  .nonnegative({ error: 'Must not be negative' })
  .refine(Number.isSafeInteger, { error: 'Is too large' });

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/** Converts a validated dollar string ("12", "12.5", "12.34") to integer cents, or undefined if unsafe. */
function dollarsToCents(s: string): number | undefined {
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

const AmountSchema = z
  .string()
  .regex(AMOUNT_RE, { error: 'Must be a dollar amount with at most 2 decimal places' })
  .superRefine((s, rc) => {
    if (!AMOUNT_RE.test(s)) return; // already reported by the regex
    const cents = dollarsToCents(s);
    if (cents === undefined) rc.addIssue({ code: 'custom', message: 'Is too large' });
    else if (cents <= 0) rc.addIssue({ code: 'custom', message: 'Must be greater than 0' });
  });

// ---------- per-Section schemas (all strict) ----------

export const LodgingSchema = z
  .strictObject({
    name: nonEmpty.optional(),
    listingUrl: HttpsUrlSchema.optional(),
    address: z.string().optional(),
    checkIn: IsoDateSchema,
    checkOut: IsoDateSchema,
    confirmationNumber: z.string().optional(),
    sleeps: z
      .number()
      .int({ error: 'Must be a whole number' })
      .min(1, { error: 'Must be at least 1' }),
    nightlyPriceCents: CentsSchema,
    checkInDetails: z
      .strictObject({ doorCode: z.string().optional(), notes: z.string().optional() })
      .optional(),
    catalogStayId: z.string().optional(),
    features: z.array(z.string()).optional(),
    selected: z.boolean().optional(),
  });

export const ItinerarySchema = z
  .strictObject({
    day: IsoDateSchema,
    startTime: TimeSchema,
    endTime: TimeSchema.optional(),
    stopName: nonEmpty,
    notes: z.string().optional(),
  });

export const GroceriesSchema = z
  .strictObject({
    name: nonEmpty,
    quantity: z
      // zod 4 numbers reject Infinity and NaN as invalid_type, so `.finite()` is implicit; keep its message.
      .number({ error: (iss) => (typeof iss.input === 'number' ? 'Must be a finite number' : undefined) })
      .positive({ error: 'Must be greater than 0' }),
    responsibleMemberId: nonEmpty,
    purchased: z.boolean().default(false),
  });

/** `claimedBy` is server-controlled (set only by the claim route), so it is not accepted here. */
export const ChecklistSchema = z
  .strictObject({
    task: nonEmpty,
    done: z.boolean().default(false),
  });

/** Accepts `amount` as a dollar string and stores it as integer `amountCents` (Req 10.2). */
export const ExpensesSchema = z
  .strictObject({
    payerMemberId: nonEmpty,
    amount: AmountSchema,
    purpose: nonEmpty,
  })
  .transform(({ payerMemberId, amount, purpose }) => ({
    payerMemberId,
    amountCents: dollarsToCents(amount) as number,
    purpose,
  }));

/** Transportation, Reservations, ScratchPad. */
export const GenericSchema = z
  .strictObject({
    title: nonEmpty,
    notes: z.string().optional(),
    date: IsoDateSchema.optional(),
    link: HttpsUrlSchema.optional(),
    costCents: CentsSchema.optional(),
  });

export type LodgingFields = z.output<typeof LodgingSchema>;
export type ItineraryFields = z.output<typeof ItinerarySchema>;
export type GroceriesFields = z.output<typeof GroceriesSchema>;
export type ChecklistFields = z.output<typeof ChecklistSchema>;
export type ExpensesFields = z.output<typeof ExpensesSchema>;
export type GenericFields = z.output<typeof GenericSchema>;

export interface SectionFieldsMap {
  Lodging: LodgingFields;
  Itinerary: ItineraryFields;
  Transportation: GenericFields;
  Groceries: GroceriesFields;
  Checklist: ChecklistFields;
  Reservations: GenericFields;
  Expenses: ExpensesFields;
  ScratchPad: GenericFields;
}
export type SectionFields = SectionFieldsMap[Section];

export const SECTION_SCHEMAS: { readonly [S in Section]: z.ZodType<SectionFieldsMap[S], unknown> } = {
  Lodging: LodgingSchema,
  Itinerary: ItinerarySchema,
  Transportation: GenericSchema,
  Groceries: GroceriesSchema,
  Checklist: ChecklistSchema,
  Reservations: GenericSchema,
  Expenses: ExpensesSchema,
  ScratchPad: GenericSchema,
};

// ---------- context and cross-field rules ----------

type Raw = Record<string, unknown>;

const isDate = (v: unknown): v is IsoDate => IsoDateSchema.safeParse(v).success;
const isTime = (v: unknown): v is string => TimeSchema.safeParse(v).success;
const isId = (v: unknown): v is string => nonEmpty.safeParse(v).success;

/**
 * Rules that span fields or need trip context. Each rule runs only when the fields it reads
 * are individually well-formed, so a field is never reported twice for the same root cause
 * and these errors are reported even when unrelated fields fail the schema.
 */
function contextErrors(section: Section, raw: Raw, ctx: ValidationContext): FieldError[] {
  const errors: FieldError[] = [];
  switch (section) {
    case 'Lodging':
      if (isDate(raw.checkIn) && isDate(raw.checkOut) && toEpochDay(raw.checkOut) <= toEpochDay(raw.checkIn)) {
        errors.push({ field: 'checkOut', message: 'Check-out date must be later than check-in date' });
      }
      break;
    case 'Itinerary':
      if (
        isDate(raw.day) &&
        (toEpochDay(raw.day) < toEpochDay(ctx.trip.startDate) || toEpochDay(raw.day) > toEpochDay(ctx.trip.endDate))
      ) {
        errors.push({
          field: 'day',
          message: `Day must be between ${ctx.trip.startDate} and ${ctx.trip.endDate}`,
        });
      }
      if (isTime(raw.startTime) && isTime(raw.endTime) && raw.endTime < raw.startTime) {
        errors.push({ field: 'endTime', message: 'End time must not be earlier than start time' });
      }
      break;
    case 'Groceries':
      if (isId(raw.responsibleMemberId) && !ctx.memberIds.has(raw.responsibleMemberId.trim())) {
        errors.push({ field: 'responsibleMemberId', message: 'Must be a Member of the Trip' });
      }
      break;
    case 'Expenses':
      if (isId(raw.payerMemberId) && !ctx.memberIds.has(raw.payerMemberId.trim())) {
        errors.push({ field: 'payerMemberId', message: 'Must be a Member of the Trip' });
      }
      break;
    default:
      break;
  }
  return errors;
}

function issueToErrors(issue: z.core.$ZodIssue): FieldError[] {
  const prefix = issue.path.map(String).join('.');
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      field: prefix ? `${prefix}.${key}` : key,
      message: SERVER_CONTROLLED_KEYS.has(key)
        ? 'Is set by the server and must not be supplied'
        : 'Is not a recognized field',
    }));
  }
  return [{ field: prefix || 'fields', message: issue.message }];
}

/**
 * Validates submitted Plan_Item fields for a Section (Req 5.6). Collects every schema issue
 * and every context-rule violation, mapped to `{ field, message }`.
 */
export function validatePlanItem<S extends Section>(
  section: S,
  fields: unknown,
  ctx: ValidationContext,
): ValidationResult<SectionFieldsMap[S]> {
  const schema = SECTION_SCHEMAS[section] as z.ZodType<SectionFieldsMap[S], unknown>;
  const parsed = schema.safeParse(fields);
  const errors: FieldError[] = parsed.success ? [] : parsed.error.issues.flatMap(issueToErrors);
  if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) {
    errors.push(...contextErrors(section, fields as Raw, ctx));
  }
  if (errors.length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, value: parsed.data };
}
