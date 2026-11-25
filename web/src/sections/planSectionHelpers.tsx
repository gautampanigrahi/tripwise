import type { ReactNode } from "react";
import type { FieldError, Membership } from "@tripwise/shared";
import { ApiError } from "../api/client";

/** Shared by the Itinerary, Groceries, and Checklist sections. */

export type MemberOption = Pick<Membership, "userId" | "displayName">;

export type Editing = { mode: "create" } | { mode: "edit"; itemId: string; expectedLastModifiedAt: string };

/** Maps API errors to readable text; 400 VALIDATION bodies become field errors. */
export function describeError(err: unknown): { message: string; fields: FieldError[] } {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; fields?: FieldError[] } | undefined;
    if (err.status === 400 && body?.error === "VALIDATION" && Array.isArray(body.fields)) {
      return { message: "Please fix the highlighted fields.", fields: body.fields };
    }
    if (err.status === 403) return { message: "You are not a Member of this trip.", fields: [] };
    return { message: `Request failed (${err.status}${body?.error ? ` ${body.error}` : ""}).`, fields: [] };
  }
  return { message: err instanceof Error ? err.message : "Something went wrong.", fields: [] };
}

/** Joins the messages for a field and its nested paths. */
export function errorsFor(fieldErrors: readonly FieldError[], field: string): string {
  return fieldErrors
    .filter((e) => e.field === field || e.field.startsWith(`${field}.`))
    .map((e) => e.message)
    .join("; ");
}

export function Field({ label, error, children }: { label: string; error: string; children: ReactNode }) {
  return (
    <div>
      <label>
        {label} {children}
      </label>
      {error && <span role="alert" className="field-error"> {error}</span>}
    </div>
  );
}
/** Formats integer cents as a dollar string without a currency sign ("12", "12.50"). */
export function centsToDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
/** Parses a dollar string with at most 2 decimals to integer cents; NaN when malformed. */
export function dollarsToCents(s: string): number {
  const t = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  const [whole = "0", frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
