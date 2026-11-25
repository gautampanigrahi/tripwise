import { useMemo, useState, type FormEvent } from "react";
import {
  validatePlanItem,
  type FieldError,
  type GroceriesFields,
  type PlanItem,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createItem, deleteItem, updateItem } from "../api/items";
import { LastModified, memberName } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import { describeError, errorsFor, Field, type Editing, type MemberOption } from "./planSectionHelpers";

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
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<GroceriesForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<GroceriesItem | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toggleStale, setToggleStale] = useState<GroceriesItem | null>(null);

  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members]);
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

  /** Req 8.2: toggling purchased is a normal update, so the server stamps lastModifiedBy/At. */
  async function togglePurchased(item: GroceriesItem, purchased: boolean) {
    setToggling(item.itemId);
    setError(undefined);
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
        return;
      }
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setToggling(null);
    }
  }

  async function remove(item: GroceriesItem) {
    if (!window.confirm(`Delete ${item.fields.name}?`)) return;
    setError(undefined);
    try {
      await deleteItem(client, tripId, "Groceries", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="groceries-heading">
      <h2 id="groceries-heading">Groceries</h2>
      {items.length === 0 ? (
        <p>No groceries yet.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const f = item.fields;
            return (
              <li key={item.itemId} className="card">
                <label>
                  <input
                    type="checkbox"
                    checked={f.purchased}
                    disabled={toggling === item.itemId}
                    onChange={(e) => void togglePurchased(item, e.target.checked)}
                  />{" "}
                  {f.name} × {f.quantity}
                </label>{" "}
                <span>· {memberName(f.responsibleMemberId, members)} is buying</span>
                {f.purchased && <span> · purchased</span>}
                <div>
                  <LastModified
                    lastModifiedBy={item.lastModifiedBy}
                    lastModifiedAt={item.lastModifiedAt}
                    members={members}
                  />
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
      )}
      {!editing && error && <p role="alert">{error}</p>}
      {!editing ? (
        <button type="button" onClick={startCreate}>
          Add grocery item
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h3>{editing.mode === "create" ? "Add grocery item" : "Edit grocery item"}</h3>
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
          <Field label="Item" error={errorFor("name")}>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Quantity" error={errorFor("quantity")}>
            <input
              type="number"
              min={0}
              step="any"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
            />
          </Field>
          <Field label="Responsible Member" error={errorFor("responsibleMemberId")}>
            {members ? (
              <select value={form.responsibleMemberId} onChange={(e) => set("responsibleMemberId", e.target.value)}>
                <option value="">Select a Member…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m.userId, members)}
                  </option>
                ))}
                {form.responsibleMemberId !== "" && !memberIds.has(form.responsibleMemberId) && (
                  <option value={form.responsibleMemberId}>{form.responsibleMemberId} (not a Member)</option>
                )}
              </select>
            ) : (
              <input
                value={form.responsibleMemberId}
                onChange={(e) => set("responsibleMemberId", e.target.value)}
              />
            )}
          </Field>
          <label>
            <input type="checkbox" checked={form.purchased} onChange={(e) => set("purchased", e.target.checked)} />{" "}
            Purchased
          </label>
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
