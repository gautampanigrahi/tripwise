import { useId, useMemo, useState, type FormEvent } from "react";
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
import { Card, ConfirmDialog, EmptyState, ProgressBar, Select, TextInput, useToast } from "../ui";
import {
  centsToDollars,
  describeError,
  errorsFor,
  formatUsd,
  FormDrawer,
  ItemActions,
  MemberChip,
  memberSelectOptions,
  SectionHeader,
  totalsByPayer,
  usePendingDelete,
  type Editing,
  type MemberOption,
} from "./planSectionHelpers";
import "./lists.css";

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
  const toast = useToast();
  const formId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ExpensesForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<ExpensesItem | null>(null);
  const pendingDelete = usePendingDelete<ExpensesItem>();
  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members]);
  const totalCents = items.reduce((sum, item) => sum + item.fields.amountCents, 0);
  const byPayer = useMemo(() => totalsByPayer(items.map((i) => i.fields)), [items]);
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
          toast.error("Someone else changed this expense. Your changes were not saved.");
          return;
        }
      }
      toast.success(editing.mode === "create" ? "Expense added." : "Expense saved.");
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
    try {
      await deleteItem(client, tripId, "Expenses", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      toast.success("Expense deleted.");
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="expenses-heading" className="list-section">
      <SectionHeader
        id="expenses-heading"
        title="Expenses"
        description="Expenses are a shared record of who paid for what. TripWise does not send or settle payments."
        addLabel="Add expense"
        onAdd={startCreate}
      />
      {items.length === 0 ? (
        <EmptyState title="No expenses yet" description="Record who paid for what so everyone can see the totals." />
      ) : (
        <>
          <Card className="list-summary" title="Summary" headingLevel={3}>
            <p className="list-summary__total">Total: {formatUsd(totalCents)}</p>
            <p className="list-summary__caption">
              {items.length} {items.length === 1 ? "expense" : "expenses"} recorded
            </p>
            <ul className="payer-list" aria-label="Paid by each Member">
              {byPayer.map((p) => {
                const name = memberName(p.payerMemberId, members);
                return (
                  <li key={p.payerMemberId} className="payer-list__row">
                    <MemberChip userId={p.payerMemberId} members={members} />
                    <span className="payer-list__amount">{formatUsd(p.cents)}</span>
                    <ProgressBar
                      label={`Share paid by ${name}`}
                      hideLabel
                      value={p.cents}
                      max={totalCents > 0 ? totalCents : 1}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
          <ul className="item-list">
            {items.map((item) => {
              const f = item.fields;
              return (
                <Card
                  as="li"
                  compact
                  key={item.itemId}
                  className="item-card"
                  footer={
                    <LastModified
                      lastModifiedBy={item.lastModifiedBy}
                      lastModifiedAt={item.lastModifiedAt}
                      members={members}
                    />
                  }
                >
                  <div className="item-card__row">
                    <div className="item-card__main">
                      <h3 className="item-card__title">{f.purpose}</h3>
                      <div className="item-card__meta">
                        <span className="item-card__amount">{formatUsd(f.amountCents)}</span>
                        <MemberChip userId={f.payerMemberId} members={members} prefix="Paid by" />
                      </div>
                    </div>
                    <div className="item-card__actions">
                      <ItemActions
                        itemLabel={f.purpose}
                        onEdit={() => startEdit(item)}
                        onDelete={() => pendingDelete.request(item)}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </ul>
        </>
      )}

      <FormDrawer
        open={editing !== null}
        title={editing?.mode === "edit" ? "Edit expense" : "Add expense"}
        formId={formId}
        busy={busy}
        error={error}
        onClose={resetForm}
        onSubmit={(e) => void submit(e)}
      >
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
        {members ? (
          <Select
            label="Paid by"
            required
            placeholder="Select a Member…"
            options={memberSelectOptions(members, form.payerMemberId)}
            value={form.payerMemberId}
            error={errorFor("payerMemberId")}
            onChange={(e) => set("payerMemberId", e.target.value)}
          />
        ) : (
          <TextInput
            label="Paid by"
            required
            value={form.payerMemberId}
            error={errorFor("payerMemberId")}
            onChange={(e) => set("payerMemberId", e.target.value)}
          />
        )}
        <TextInput
          label="Amount (USD)"
          hint="Dollars, up to 2 decimals, e.g. 42.50"
          required
          inputMode="decimal"
          value={form.amount}
          error={errorFor("amount")}
          onChange={(e) => set("amount", e.target.value)}
        />
        <TextInput
          label="Purpose"
          required
          value={form.purpose}
          error={errorFor("purpose")}
          onChange={(e) => set("purpose", e.target.value)}
        />
      </FormDrawer>

      <ConfirmDialog
        open={pendingDelete.target !== null}
        title={`Delete expense "${pendingDelete.target?.fields.purpose ?? ""}"?`}
        message="This removes the expense record for everyone on the trip."
        busy={pendingDelete.busy}
        onCancel={pendingDelete.cancel}
        onConfirm={() => void pendingDelete.confirm(remove)}
      />
    </section>
  );
}
