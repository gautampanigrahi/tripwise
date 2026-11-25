/** Calendar date in `YYYY-MM-DD` form, validated by `IsoDateSchema`. */
export type IsoDate = string;

export interface Trip {
  tripId: string;
  name: string;
  destination: string;
  startDate: IsoDate;
  endDate: IsoDate;
  hostId: string;
  createdAt: string;
}

export interface Membership {
  tripId: string;
  userId: string;
  role: 'host' | 'member';
  displayName: string;
  email: string;
}

/** The 8 Plan_Item sections, in display order. */
export const SECTIONS = [
  'Lodging',
  'Itinerary',
  'Transportation',
  'Groceries',
  'Checklist',
  'Reservations',
  'Expenses',
  'ScratchPad',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface PlanItem<F = Record<string, unknown>> {
  tripId: string;
  itemId: string;
  section: Section;
  fields: F;
  lastModifiedBy: string;
  lastModifiedAt: string;
  createdAt: string;
}

export type CheckName = 'Cost' | 'Capacity' | 'Dates' | 'Schedule' | 'Preferences';
export type Unit = 'USD_CENTS' | 'BEDS' | 'NIGHTS' | 'MINUTES' | 'FEATURES';

/** One Check's result: name, measured value, limit, unit, and pass/fail (Req 13.4). */
export interface CheckOutcome {
  check: CheckName;
  measured: number;
  limit: number;
  unit: Unit;
  passed: boolean;
  details?: { missingPairs?: Array<[string, string]>; unmetFeatures?: string[] };
}

export interface CheckResult {
  tripId: string;
  checkId: string;
  runAt: string;
  kind: 'standard' | 'alternative';
  evaluatedStay: { stayId?: string; name: string };
  catalogVersion: string;
  outcomes: CheckOutcome[];
  score: number;
  label: 'Feasible' | 'Not feasible';
  tripNights: number;
  explanation?: string;
  explanationSource?: 'bedrock' | 'template';
}

export type FieldError = { field: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };
