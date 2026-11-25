import { useState, type FormEvent } from "react";
import {
  validatePlanItem,
  type ChecklistFields,
  type ChecklistItem,
  type FieldError,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { claimItem, createItem, deleteItem, updateItem } from "../api/items";
import { LastModified, memberName } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import { describeError, errorsFor, Field, type Editing, type MemberOption } from "./planSectionHelpers";

export interface ChecklistProps {
  tripId: string;
  items: readonly ChecklistItem[];
  members?: readonly MemberOption[];
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void | Promise<void>;
}

// Checklist rules do not read trip context; validatePlanItem still requires one.
const CHECKLIST_CTX: ValidationContext = {
  trip: { startDate: "1970-01-01", endDate: "1970-01-01" },
  memberIds: new Set(),
};

interface ChecklistForm {
  task: string;
  done: boolean;
}

const EMPTY_FORM: ChecklistForm = { task: "", done: false };

/** Only the client-editable keys; `claimedBy` is server-owned and rejected in request bodies. */
function editableFields(item: ChecklistItem): ChecklistFields {
  return { task: item.fields.task, done: item.fields.done };
}

/** Returns `claimedBy` from a `409 { error: 'ALREADY_CLAIMED', claimedBy }` body (Req 9.4). */
function alreadyClaimedBy(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const body = err.body as { error?: unknown; claimedBy?: unknown } | undefined;
  if (body?.error !== "ALREADY_CLAIMED") return undefined;
  return typeof body.claimedBy === "string" ? body.claimedBy : "";
}

export function Checklist({ tripId, items, members, onChanged }: ChecklistProps) {
  const client = useApiClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ChecklistForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<ChecklistItem | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ itemId: string; text: string } | null>(null);
  const [rowStale, setRowStale] = useState<ChecklistItem | null>(null);

  const errorFor = (field: string) => errorsFor(fieldErrors, field);

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

  function startEdit(item: ChecklistItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(editableFields(item));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const result = validatePlanItem("Checklist", { task: form.task.trim(), done: form.done }, CHECKLIST_CTX);
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
        await createItem(client, tripId, "Checklist", result.value);
      } else {
        const res = await updateItem(
          client,
          tripId,
          "Checklist",
          editing.itemId,
          result.value,
          editing.expectedLastModifiedAt,
        );
        if (!res.ok) {
          setStale(res.current as ChecklistItem);
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

  /** Req 9.2, 9.4: the server sets claimedBy to the caller or answers 409 ALREADY_CLAIMED. */
  async function claim(item: ChecklistItem) {
    setRowBusy(item.itemId);
    setRowMessage(null);
    setRowStale(null);
    try {
      await claimItem(client, tripId, item.itemId);
      await onChanged();
    } catch (err) {
      const by = alreadyClaimedBy(err);
      if (by !== undefined) {
        setRowMessage({
          itemId: item.itemId,
          text: by ? `Already claimed by ${memberName(by, members)}.` : "Already claimed by another Member.",
        });
        await onChanged();
      } else {
        setRowMessage({ itemId: item.itemId, text: describeError(err).message });
      }
    } finally {
      setRowBusy(null);
    }
  }

  /** Req 9.3: marking done is a normal update, so the server stamps lastModifiedBy/At. */
  async function setDone(item: ChecklistItem, done: boolean) {
    setRowBusy(item.itemId);
    setRowMessage(null);
    setRowStale(null);
    try {
      const res = await updateItem(
        client,
        tripId,
        "Checklist",
        item.itemId,
        { ...editableFields(item), done },
        item.lastModifiedAt,
      );
      if (!res.ok) {
        setRowStale(res.current as ChecklistItem);
        return;
      }
      await onChanged();
    } catch (err) {
      setRowMessage({ itemId: item.itemId, text: describeError(err).message });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(item: ChecklistItem) {
    if (!window.confirm(`Delete "${item.fields.task}"?`)) return;
    setError(undefined);
    try {
      await deleteItem(client, tripId, "Checklist", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="checklist-heading">
      <h2 id="checklist-heading">Checklist</h2>
      {items.length === 0 ? (
        <p>No checklist tasks yet.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const f = item.fields;
            const busyRow = rowBusy === item.itemId;
            return (
              <li key={item.itemId} className="card">
                <label>
                  <input
                    type="checkbox"
                    checked={f.done}
                    disabled={busyRow}
                    onChange={(e) => void setDone(item, e.target.checked)}
                  />{" "}
                  {f.task}
                </label>{" "}
                {f.claimedBy ? (
                  <span>· Claimed by {memberName(f.claimedBy, members)}</span>
                ) : (
                  <button type="button" disabled={busyRow} onClick={() => void claim(item)}>
                    Claim
                  </button>
                )}
                {rowMessage?.itemId === item.itemId && <p role="alert">{rowMessage.text}</p>}
                {rowStale?.itemId === item.itemId && (
                  <StaleConflict
                    current={rowStale}
                    members={members}
                    onUseCurrent={() => {
                      setRowStale(null);
                      void onChanged();
                    }}
                  />
                )}
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
      )}
      {!editing && error && <p role="alert">{error}</p>}
      {!editing ? (
        <button type="button" onClick={startCreate}>
          Add task
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h3>{editing.mode === "create" ? "Add task" : "Edit task"}</h3>
          {stale && (
            <StaleConflict
              current={stale}
              members={members}
              onUseCurrent={(current) => {
                setEditing({ mode: "edit", itemId: current.itemId, expectedLastModifiedAt: current.lastModifiedAt });
                setForm(editableFields(current));
                setStale(null);
              }}
              onDismiss={() => {
                // Keep local edits; the next save overwrites the stored version the Member has now seen.
                setEditing({ mode: "edit", itemId: stale.itemId, expectedLastModifiedAt: stale.lastModifiedAt });
                setStale(null);
              }}
            />
          )}
          <Field label="Task" error={errorFor("task")}>
            <input value={form.task} onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))} />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={form.done}
              onChange={(e) => setForm((f) => ({ ...f, done: e.target.checked }))}
            />{" "}
            Done
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
