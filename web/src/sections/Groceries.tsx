import { useId, useMemo, useState, type FormEvent } from "react";
import {
  validatePlanItem,
  type FieldError,
  type GroceriesFields,
  type PlanItem,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createItem, deleteItem, updateItem } from "../api/items";
import { LastModified } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import {
  Badge,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ProgressBar,
  Select,
  TextInput,
  useToast,
} from "../ui";
import {
  describeError,
  errorsFor,
  FormDrawer,
  ItemActions,
  MemberChip,
  memberSelectOptions,
  SectionHeader,
  usePendingDelete,
  type Editing,
  type MemberOption,
} from "./planSectionHelpers";
import "./lists.css";

export type GroceriesItem = PlanItem<GroceriesFields>;

export interface GroceriesProps {
  tripId: string;
  items: readonly GroceriesItem[];
  /** Trip Members; the responsible person is chosen from these (Req 8.1, 8.3). */
  members?: readonly MemberOption[];
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void | Promise<void>;
}

interface GroceriesForm {
  name: string;
  quantity: string;
  responsibleMemberId: string;
  purchased: boolean;
}

const EMPTY_FORM: GroceriesForm = { name: "", quantity: "", responsibleMemberId: "", purchased: false };

function formFromFields(f: GroceriesFields): GroceriesForm {
  return {
    name: f.name,
    quantity: String(f.quantity),
    responsibleMemberId: f.responsibleMemberId,
    purchased: f.purchased,
  };
}

function fieldsFromForm(form: GroceriesForm): Record<string, unknown> {
  return {
    name: form.name.trim(),
    quantity: form.quantity.trim() === "" ? Number.NaN : Number(form.quantity),
    responsibleMemberId: form.responsibleMemberId,
    purchased: form.purchased,
  };
}

export function Groceries({ tripId, items, members, onChanged }: GroceriesProps) {
  const client = useApiClient();
  const toast = useToast();
  const formId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<GroceriesForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<GroceriesItem | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toggleStale, setToggleStale] = useState<GroceriesItem | null>(null);
  const pendingDelete = usePendingDelete<GroceriesItem>();

  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members]);
  const purchasedCount = items.filter((i) => i.fields.purchased).length;
  const errorFor = (field: string) => errorsFor(fieldErrors, field);

  function set<K extends keyof GroceriesForm>(key: K, value: GroceriesForm[K]) {
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

  function startEdit(item: GroceriesItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(formFromFields(item.fields));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const fields = fieldsFromForm(form);
    // Without a member list the server alone checks membership (Req 8.3).
    const ctx: ValidationContext = {
      trip: { startDate: "1970-01-01", endDate: "1970-01-01" },
      memberIds: members ? memberIds : new Set([form.responsibleMemberId.trim()]),
    };
    const result = validatePlanItem("Groceries", fields, ctx);
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    setFieldErrors([]);
    setError(undefined);
    try {
      if (editing.mode === "create") {
        await createItem(client, tripId, "Groceries", result.value);
      } else {
        const res = await updateItem(
          client,
          tripId,
          "Groceries",
          editing.itemId,
          result.value,
          editing.expectedLastModifiedAt,
        );
        if (!res.ok) {
          setStale(res.current as GroceriesItem);
          toast.error("Someone else changed this item. Your changes were not saved.");
          return;
        }
      }
      toast.success(editing.mode === "create" ? `Added ${result.value.name}.` : `Saved ${result.value.name}.`);
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

  /** Req 8.2: toggling purchased is a normal update, so the server stamps lastModifiedBy/At. */
  async function togglePurchased(item: GroceriesItem, purchased: boolean) {
    setToggling(item.itemId);
    setToggleStale(null);
    try {
      const res = await updateItem(
        client,
        tripId,
        "Groceries",
        item.itemId,
        { ...item.fields, purchased },
        item.lastModifiedAt,
      );
      if (!res.ok) {
        setToggleStale(res.current as GroceriesItem);
        toast.error(`${item.fields.name} was changed by someone else. Review the stored version.`);
        return;
      }
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    } finally {
      setToggling(null);
    }
  }

  async function remove(item: GroceriesItem) {
    try {
      await deleteItem(client, tripId, "Groceries", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      toast.success(`Deleted ${item.fields.name}.`);
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="groceries-heading" className="list-section">
      <SectionHeader
        id="groceries-heading"
        title="Groceries"
        description="Who is buying what for the trip."
        addLabel="Add grocery item"
        onAdd={startCreate}
      />
      {items.length === 0 ? (
        <EmptyState
          title="No groceries yet"
          description="Add items and assign who is buying each one."
          headingLevel={3}
        />
      ) : (
        <>
          <Card className="list-summary">
            <ProgressBar
              label="Groceries purchased"
              value={purchasedCount}
              max={items.length}
              tone={purchasedCount === items.length ? "success" : "accent"}
              valueText={`${purchasedCount} of ${items.length} purchased`}
            />
          </Card>
          <ul className="item-list">
            {items.map((item) => {
              const f = item.fields;
              return (
                <Card
                  as="li"
                  compact
                  key={item.itemId}
                  className={f.purchased ? "item-card item-card--done" : "item-card"}
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
                      <Checkbox
                        fieldClassName="item-card__check"
                        label={`${f.name} × ${f.quantity}`}
                        checked={f.purchased}
                        disabled={toggling === item.itemId}
                        onChange={(e) => void togglePurchased(item, e.target.checked)}
                      />
                      <div className="item-card__meta">
                        <MemberChip userId={f.responsibleMemberId} members={members} prefix="Buying:" />
                        {f.purchased && <Badge tone="success">Purchased</Badge>}
                      </div>
                    </div>
                    <div className="item-card__actions">
                      <ItemActions
                        itemLabel={f.name}
                        onEdit={() => startEdit(item)}
                        onDelete={() => pendingDelete.request(item)}
                      />
                    </div>
                  </div>
                  {toggleStale?.itemId === item.itemId && (
                    <StaleConflict
                      current={toggleStale}
                      members={members}
                      onUseCurrent={() => {
                        setToggleStale(null);
                        void onChanged();
                      }}
                    />
                  )}
                </Card>
              );
            })}
          </ul>
        </>
      )}

      <FormDrawer
        open={editing !== null}
        title={editing?.mode === "edit" ? "Edit grocery item" : "Add grocery item"}
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
              // Keep local edits; the next save overwrites the stored version the Member has now seen.
              setEditing({ mode: "edit", itemId: stale.itemId, expectedLastModifiedAt: stale.lastModifiedAt });
              setStale(null);
            }}
          />
        )}
        <TextInput
          label="Item"
          required
          data-autofocus
          value={form.name}
          error={errorFor("name")}
          onChange={(e) => set("name", e.target.value)}
        />
        <TextInput
          label="Quantity"
          type="number"
          required
          min={0}
          step="any"
          value={form.quantity}
          error={errorFor("quantity")}
          onChange={(e) => set("quantity", e.target.value)}
        />
        {members ? (
          <Select
            label="Responsible Member"
            required
            placeholder="Select a Member…"
            options={memberSelectOptions(members, form.responsibleMemberId)}
            value={form.responsibleMemberId}
            error={errorFor("responsibleMemberId")}
            onChange={(e) => set("responsibleMemberId", e.target.value)}
          />
        ) : (
          <TextInput
            label="Responsible Member"
            required
            value={form.responsibleMemberId}
            error={errorFor("responsibleMemberId")}
            onChange={(e) => set("responsibleMemberId", e.target.value)}
          />
        )}
        <Checkbox label="Purchased" checked={form.purchased} onChange={(e) => set("purchased", e.target.checked)} />
      </FormDrawer>

      <ConfirmDialog
        open={pendingDelete.target !== null}
        title={`Delete ${pendingDelete.target?.fields.name ?? "item"}?`}
        message="This removes the grocery item for everyone on the trip."
        busy={pendingDelete.busy}
        onCancel={pendingDelete.cancel}
        onConfirm={() => void pendingDelete.confirm(remove)}
      />
    </section>
  );
}
