import { useMemo, useState, type FormEvent } from "react";
import {
  validatePlanItem,
  type ExpensesFields,
  type FieldError,
  type PlanItem,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createItem, deleteItem, updateItem } from "../api/items";
import { LastModified, memberName } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import {
  centsToDollars,
  describeError,
  errorsFor,
  Field,
  type Editing,
  type MemberOption,
} from "./planSectionHelpers";

/** Stored shape: the API converts the submitted `amount` dollar string to `amountCents` (Req 10.2). */
export type ExpensesItem = PlanItem<ExpensesFields>;

export interface ExpensesProps {
  tripId: string;
  items: readonly ExpensesItem[];
  /** Trip Members; the payer is chosen from these (Req 10.1). */
  members?: readonly MemberOption[];
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void | Promise<void>;
}

interface ExpensesForm {
  payerMemberId: string;
  amount: string;
  purpose: string;
}

const EMPTY_FORM: ExpensesForm = { payerMemberId: "", amount: "", purpose: "" };

function formFromFields(f: ExpensesFields): ExpensesForm {
  return { payerMemberId: f.payerMemberId, amount: centsToDollars(f.amountCents), purpose: f.purpose };
}

/** Request body uses the schema input shape: `amount` as a dollar string. */
function fieldsFromForm(form: ExpensesForm): { payerMemberId: string; amount: string; purpose: string } {
  return { payerMemberId: form.payerMemberId, amount: form.amount.trim(), purpose: form.purpose.trim() };
}

/** Expenses are records only: no payment, transfer, or settlement actions (Req 10.3). */
export function Expenses({ tripId, items, members, onChanged }: ExpensesProps) {
  const client = useApiClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ExpensesForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<ExpensesItem | null>(null);
  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members]);
  const totalCents = items.reduce((sum, item) => sum + item.fields.amountCents, 0);
  const errorFor = (field: string) => errorsFor(fieldErrors, field);

  function set<K extends keyof ExpensesForm>(key: K, value: ExpensesForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function resetForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors([]);
    setError(undefined);
    setStale(null);
  }
  function startCreate() {
    resetForm();
    setEditing({ mode: "create" });
  }
  function startEdit(item: ExpensesItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(formFromFields(item.fields));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const fields = fieldsFromForm(form);
    // Without a member list the server alone checks membership.
    const ctx: ValidationContext = {
      trip: { startDate: "1970-01-01", endDate: "1970-01-01" },
      memberIds: members ? memberIds : new Set([form.payerMemberId.trim()]),
    };
    const result = validatePlanItem("Expenses", fields, ctx);
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    setFieldErrors([]);
    setError(undefined);
    try {
      // Send the input shape (`amount`); the server validates and stores `amountCents`.
      if (editing.mode === "create") {
        await createItem(client, tripId, "Expenses", fields);
      } else {
        const res = await updateItem(client, tripId, "Expenses", editing.itemId, fields, editing.expectedLastModifiedAt);
        if (!res.ok) {
          setStale(res.current as unknown as ExpensesItem);
          return;
        }
      }
      resetForm();
      await onChanged();
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFieldErrors(d.fields);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: ExpensesItem) {
    if (!window.confirm(`Delete expense "${item.fields.purpose}"?`)) return;
    setError(undefined);
    try {
      await deleteItem(client, tripId, "Expenses", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="expenses-heading">
      <h2 id="expenses-heading">Expenses</h2>
      <p>Expenses are a shared record of who paid for what. TripWise does not send or settle payments.</p>
      {items.length === 0 ? (
        <p>No expenses yet.</p>
      ) : (
        <>
          <ul>
            {items.map((item) => {
              const f = item.fields;
              return (
                <li key={item.itemId} className="card">
                  <strong>${centsToDollars(f.amountCents)}</strong> · {f.purpose} · paid by{" "}
                  {memberName(f.payerMemberId, members)}
                  <div>
                    <LastModified
                      lastModifiedBy={item.lastModifiedBy}
                      lastModifiedAt={item.lastModifiedAt}
                      members={members}
                    />
                  </div>
                  <div>
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void remove(item)}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p>Total: ${centsToDollars(totalCents)}</p>
        </>
      )}
      {!editing && error && <p role="alert">{error}</p>}
      {!editing ? (
        <button type="button" onClick={startCreate}>
          Add expense
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h3>{editing.mode === "create" ? "Add expense" : "Edit expense"}</h3>
          {stale && (
            <StaleConflict
              current={stale}
              members={members}
              onUseCurrent={(current) => {
                setEditing({ mode: "edit", itemId: current.itemId, expectedLastModifiedAt: current.lastModifiedAt });
                setForm(formFromFields(current.fields));
                setStale(null);
              }}
              onDismiss={() => {
                setEditing({ mode: "edit", itemId: stale.itemId, expectedLastModifiedAt: stale.lastModifiedAt });
                setStale(null);
              }}
            />
          )}
          <Field label="Paid by" error={errorFor("payerMemberId")}>
            {members ? (
              <select value={form.payerMemberId} onChange={(e) => set("payerMemberId", e.target.value)}>
                <option value="">Select a Member…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m.userId, members)}
                  </option>
                ))}
                {form.payerMemberId !== "" && !memberIds.has(form.payerMemberId) && (
                  <option value={form.payerMemberId}>{form.payerMemberId} (not a Member)</option>
                )}
              </select>
            ) : (
              <input value={form.payerMemberId} onChange={(e) => set("payerMemberId", e.target.value)} />
            )}
          </Field>
          <Field label="Amount (USD)" error={errorFor("amount")}>
            <input inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
          <Field label="Purpose" error={errorFor("purpose")}>
            <input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} />
          </Field>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={resetForm} disabled={busy}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
