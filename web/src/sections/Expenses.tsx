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
import { Button, Card, Checkbox, ConfirmDialog, EmptyState, ProgressBar, Select, TextInput, useToast } from "../ui";
import {
  centsToDollars,
  describeError,
  dollarsToCents,
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
import { balances, equalShares } from "./split";
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

interface SplitRow {
  memberId: string;
  included: boolean;
  amount: string;
}

interface ExpensesForm {
  payerMemberId: string;
  amount: string;
  purpose: string;
  /** True while share boxes follow an even split. Editing a box turns this off. */
  equal: boolean;
  splits: SplitRow[];
}

const EMPTY_FORM: ExpensesForm = { payerMemberId: "", amount: "", purpose: "", equal: true, splits: [] };

function peopleFor(fields: ExpensesFields, members: readonly MemberOption[] | undefined): MemberOption[] {
  const list = [...(members ?? [])];
  for (const share of fields.splits ?? []) {
    if (!list.some((member) => member.userId === share.memberId)) {
      list.push({ userId: share.memberId, displayName: share.memberId });
    }
  }
  return list;
}

function applyEqual(amount: string, splits: readonly SplitRow[]): SplitRow[] {
  const cents = dollarsToCents(amount);
  const included = splits.filter((row) => row.included).map((row) => row.memberId);
  const shares = Number.isFinite(cents) && cents > 0 ? equalShares(cents, included) : [];
  const byId = new Map(shares.map((share) => [share.memberId, centsToDollars(share.amountCents)]));
  return splits.map((row) => ({ ...row, amount: row.included ? (byId.get(row.memberId) ?? "") : "" }));
}

function createForm(members: readonly MemberOption[] | undefined): ExpensesForm {
  return {
    ...EMPTY_FORM,
    splits: (members ?? []).map((member) => ({ memberId: member.userId, included: true, amount: "" })),
  };
}

function formFromFields(fields: ExpensesFields, members: readonly MemberOption[] | undefined): ExpensesForm {
  const stored = new Map((fields.splits ?? []).map((share) => [share.memberId, centsToDollars(share.amountCents)]));
  const hasSplits = stored.size > 0;
  let splits: SplitRow[] = peopleFor(fields, members).map((member) => ({
    memberId: member.userId,
    included: hasSplits ? stored.has(member.userId) : member.userId === fields.payerMemberId,
    amount: stored.get(member.userId) ?? "",
  }));
  if (!hasSplits) splits = applyEqual(centsToDollars(fields.amountCents), splits);
  return {
    payerMemberId: fields.payerMemberId,
    amount: centsToDollars(fields.amountCents),
    purpose: fields.purpose,
    equal: !hasSplits,
    splits,
  };
}

/** Request body uses the schema input shape: dollar strings for the total and each share. */
function fieldsFromForm(form: ExpensesForm, includeSplits: boolean): {
  payerMemberId: string;
  amount: string;
  purpose: string;
  splits?: { memberId: string; amount: string }[];
} {
  const fields: {
    payerMemberId: string;
    amount: string;
    purpose: string;
    splits?: { memberId: string; amount: string }[];
  } = {
    payerMemberId: form.payerMemberId,
    amount: form.amount.trim(),
    purpose: form.purpose.trim(),
  };
  if (includeSplits) {
    fields.splits = form.splits
      .filter((row) => row.included)
      .map((row) => ({ memberId: row.memberId, amount: row.amount.trim() }));
  }
  return fields;
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
  const owed = useMemo(() => balances(items.map((item) => item.fields)), [items]);
  const hasSplits = items.some((item) => (item.fields.splits?.length ?? 0) > 0);
  const errorFor = (field: string) => errorsFor(fieldErrors, field);
  const assignedCents = form.splits.reduce((sum, row) => {
    if (!row.included) return sum;
    const cents = dollarsToCents(row.amount);
    return sum + (Number.isFinite(cents) ? cents : 0);
  }, 0);

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
    setForm(createForm(members));
    setEditing({ mode: "create" });
  }
  function startEdit(item: ExpensesItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(formFromFields(item.fields, members));
  }
  function setAmount(amount: string) {
    setForm((current) => ({
      ...current,
      amount,
      splits: current.equal ? applyEqual(amount, current.splits) : current.splits,
    }));
  }
  function togglePerson(memberId: string, included: boolean) {
    setForm((current) => {
      const splits = current.splits.map((row) => (row.memberId === memberId ? { ...row, included } : row));
      return { ...current, equal: true, splits: applyEqual(current.amount, splits) };
    });
  }
  function setShare(memberId: string, amount: string) {
    setForm((current) => ({
      ...current,
      equal: false,
      splits: current.splits.map((row) => (row.memberId === memberId ? { ...row, amount } : row)),
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (members && form.splits.every((row) => !row.included)) {
      setFieldErrors([{ field: "splits", message: "Choose at least one person." }]);
      setError("Choose who to split this with.");
      return;
    }
    const fields = fieldsFromForm(form, Boolean(members));
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
        description="Record who paid and how the cost is split. TripWise does not send or settle payments."
        addLabel="Add expense"
        onAdd={startCreate}
      />
      {items.length === 0 ? (
        <EmptyState title="No expenses yet" description="Add an expense, choose who is splitting it, and see what each person owes." />
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
            {hasSplits && (
              <>
                <p className="list-summary__caption">Who owes whom</p>
                {owed.length === 0 ? (
                  <p className="list-summary__caption">No one owes anyone else.</p>
                ) : (
                  <ul className="owe-list" aria-label="Who owes whom">
                    {owed.map((balance) => (
                      <li key={`${balance.fromMemberId}-${balance.toMemberId}`}>
                        {memberName(balance.fromMemberId, members)} owes {memberName(balance.toMemberId, members)}{" "}
                        {formatUsd(balance.cents)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
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
                      {f.splits && f.splits.length > 0 && (
                        <ul className="split-shares">
                          {f.splits.map((share) => (
                            <li key={share.memberId}>
                              {share.memberId === f.payerMemberId
                                ? `${memberName(share.memberId, members)}'s share ${formatUsd(share.amountCents)}`
                                : `${memberName(share.memberId, members)} owes ${formatUsd(share.amountCents)}`}
                            </li>
                          ))}
                        </ul>
                      )}
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
              setForm(formFromFields(current.fields, members));
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
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextInput
          label="Purpose"
          required
          value={form.purpose}
          error={errorFor("purpose")}
          onChange={(e) => set("purpose", e.target.value)}
        />
        {form.splits.length > 0 && (
          <fieldset className="split-list">
            <legend className="list-section__description">Split with</legend>
            {form.splits.map((row, index) => {
              const name = memberName(row.memberId, members);
              return (
                <div key={row.memberId} className="split-list__row">
                  <Checkbox
                    label={name}
                    checked={row.included}
                    onChange={(event) => togglePerson(row.memberId, event.target.checked)}
                  />
                  <input
                    className="field__control split-list__amount"
                    aria-label={`${name} owes`}
                    inputMode="decimal"
                    disabled={!row.included}
                    value={row.included ? row.amount : ""}
                    onChange={(event) => setShare(row.memberId, event.target.value)}
                  />
                  {errorFor(`splits.${index}.amount`) && (
                    <span role="alert" className="field-error">
                      {errorFor(`splits.${index}.amount`)}
                    </span>
                  )}
                  {errorFor(`splits.${index}.memberId`) && (
                    <span role="alert" className="field-error">
                      {errorFor(`splits.${index}.memberId`)}
                    </span>
                  )}
                </div>
              );
            })}
            {Number.isFinite(dollarsToCents(form.amount)) && (
              <p className="split-list__sum">
                Shares add up to {formatUsd(assignedCents)} of {formatUsd(dollarsToCents(form.amount))}.
              </p>
            )}
            {errorFor("splits") && (
              <span role="alert" className="field-error">
                {errorFor("splits")}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => setForm((current) => ({ ...current, equal: true, splits: applyEqual(current.amount, current.splits) }))}>
              Split equally
            </Button>
          </fieldset>
        )}
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
