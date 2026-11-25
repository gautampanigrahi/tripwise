import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import type { FieldError, Membership } from "@tripwise/shared";
import { ApiError } from "../api/client";
import { memberName } from "../components/LastModified";
import { Avatar, Button, Drawer, PlusIcon } from "../ui";

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

/** Formats integer cents as US dollars with grouping ("$1,234.50"). */
export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Sums expense amounts per payer, largest first (ties by payer ID). Records only; no settlement maths. */
export function totalsByPayer(
  expenses: readonly { payerMemberId: string; amountCents: number }[],
): { payerMemberId: string; cents: number }[] {
  const totals = new Map<string, number>();
  for (const e of expenses) totals.set(e.payerMemberId, (totals.get(e.payerMemberId) ?? 0) + e.amountCents);
  return [...totals.entries()]
    .map(([payerMemberId, cents]) => ({ payerMemberId, cents }))
    .sort((a, b) => b.cents - a.cents || a.payerMemberId.localeCompare(b.payerMemberId));
}

/** `<select>` options for the trip's Members, plus the current value when it is not a Member. */
export function memberSelectOptions(
  members: readonly MemberOption[],
  current: string,
): { value: string; label: string }[] {
  const options = members.map((m) => ({ value: m.userId, label: memberName(m.userId, members) }));
  if (current !== "" && !members.some((m) => m.userId === current)) {
    options.push({ value: current, label: `${current} (not a Member)` });
  }
  return options;
}

/** Avatar plus display name for a Member ID (falls back to the ID when unknown). */
export function MemberChip({
  userId,
  members,
  prefix,
}: {
  userId: string;
  members?: readonly MemberOption[];
  /** Text before the name, e.g. "Paid by". */
  prefix?: ReactNode;
}) {
  const name = memberName(userId, members);
  return (
    <span className="member-chip">
      {prefix && <span className="member-chip__prefix">{prefix}</span>}
      <Avatar name={name} colorKey={userId} size="sm" decorative />
      <span className="member-chip__name">{name}</span>
    </span>
  );
}

/** Section title row with an optional description and a primary "Add" button. */
export function SectionHeader({
  id,
  title,
  description,
  addLabel,
  onAdd,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  addLabel?: string;
  onAdd?: () => void;
}) {
  return (
    <header className="list-section__header">
      <div>
        <h2 id={id} className="list-section__title">
          {title}
        </h2>
        {description && <p className="list-section__description">{description}</p>}
      </div>
      {addLabel && onAdd && (
        <Button icon={<PlusIcon />} onClick={onAdd}>
          {addLabel}
        </Button>
      )}
    </header>
  );
}

/** Small Edit and Delete buttons for an item card; labels name the item for screen readers. */
export function ItemActions({
  itemLabel,
  onEdit,
  onDelete,
  disabled,
}: {
  itemLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onEdit} disabled={disabled} aria-label={`Edit ${itemLabel}`}>
        Edit
      </Button>
      <Button variant="ghost" size="sm" onClick={onDelete} disabled={disabled} aria-label={`Delete ${itemLabel}`}>
        Delete
      </Button>
    </>
  );
}

/**
 * Drawer holding an add/edit form. The Save button sits in the Drawer footer and submits
 * the form through its `form` attribute. Closing is blocked while saving.
 */
export function FormDrawer({
  open,
  title,
  formId,
  busy,
  error,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: ReactNode;
  formId: string;
  busy: boolean;
  /** Form-level error shown above the footer. */
  error?: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Drawer
      open={open}
      onClose={close}
      title={title}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id={formId} className="list-form" onSubmit={onSubmit} noValidate>
        {children}
        {error && (
          <p role="alert" className="alert alert--danger">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}

/** State for a delete that waits on a ConfirmDialog. */
export function usePendingDelete<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useCallback(() => {
    if (!busy) setTarget(null);
  }, [busy]);
  /** Runs `action` on the pending target, then clears it. Errors propagate to the caller's handler. */
  const confirm = useCallback(
    async (action: (item: T) => Promise<void>) => {
      if (target === null) return;
      setBusy(true);
      try {
        await action(target);
      } finally {
        setBusy(false);
        setTarget(null);
      }
    },
    [target],
  );
  return { target, busy, request: setTarget, cancel, confirm };
}
