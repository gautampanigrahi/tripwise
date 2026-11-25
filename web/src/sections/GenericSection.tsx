import { useState, type FormEvent } from "react";
import {
  validatePlanItem,
  type FieldError,
  type GenericFields,
  type PlanItem,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createItem, deleteItem, updateItem } from "../api/items";
import { LastModified } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import {
  centsToDollars,
  describeError,
  dollarsToCents,
  errorsFor,
  Field,
  type Editing,
  type MemberOption,
} from "./planSectionHelpers";

export type GenericSectionName = "Transportation" | "Reservations" | "ScratchPad";
export type GenericItem = PlanItem<GenericFields>;

export interface GenericSectionProps {
  tripId: string;
  section: GenericSectionName;
  /** Visible heading, e.g. "Scratch pad". */
  heading: string;
  items: readonly GenericItem[];
  members?: readonly MemberOption[];
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void | Promise<void>;
}

// Generic rules do not read trip context; validatePlanItem still requires one.
const GENERIC_CTX: ValidationContext = {
  trip: { startDate: "1970-01-01", endDate: "1970-01-01" },
  memberIds: new Set(),
};

interface GenericForm {
  title: string;
  notes: string;
  date: string;
  link: string;
  cost: string;
}

const EMPTY_FORM: GenericForm = { title: "", notes: "", date: "", link: "", cost: "" };

function formFromFields(f: GenericFields): GenericForm {
  return {
    title: f.title,
    notes: f.notes ?? "",
    date: f.date ?? "",
    link: f.link ?? "",
    cost: f.costCents === undefined ? "" : centsToDollars(f.costCents),
  };
}

/** Builds the submitted fields, omitting empty optional values. */
function fieldsFromForm(form: GenericForm): Record<string, unknown> {
  const out: Record<string, unknown> = { title: form.title.trim() };
  if (form.notes.trim() !== "") out.notes = form.notes.trim();
  if (form.date !== "") out.date = form.date;
  if (form.link.trim() !== "") out.link = form.link.trim();
  if (form.cost.trim() !== "") out.costCents = dollarsToCents(form.cost);
  return out;
}

/** Create, view, edit, and delete for the Transportation, Reservations, and ScratchPad Sections (Req 5.8). */
export function GenericSection({ tripId, section, heading, items, members, onChanged }: GenericSectionProps) {
  const client = useApiClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<GenericForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<GenericItem | null>(null);
  const errorFor = (field: string) => errorsFor(fieldErrors, field);
  const headingId = `${section.toLowerCase()}-heading`;

  function set<K extends keyof GenericForm>(key: K, value: GenericForm[K]) {
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
  function startEdit(item: GenericItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(formFromFields(item.fields));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const result = validatePlanItem(section, fieldsFromForm(form), GENERIC_CTX);
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
        await createItem(client, tripId, section, result.value);
      } else {
        const res = await updateItem(
          client,
          tripId,
          section,
          editing.itemId,
          result.value,
          editing.expectedLastModifiedAt,
        );
        if (!res.ok) {
          setStale(res.current);
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

  async function remove(item: GenericItem) {
    if (!window.confirm(`Delete ${item.fields.title}?`)) return;
    setError(undefined);
    try {
      await deleteItem(client, tripId, section, item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      {items.length === 0 ? (
        <p>Nothing here yet.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const f = item.fields;
            return (
              <li key={item.itemId} className="card">
                <strong>{f.title}</strong>
                {f.date && <span> · {f.date}</span>}
                {f.costCents !== undefined && <span> · ${centsToDollars(f.costCents)}</span>}
                {f.link && (
                  <span>
                    {" "}
                    ·{" "}
                    <a href={f.link} target="_blank" rel="noopener noreferrer">
                      Link
                    </a>
                  </span>
                )}
                {f.notes && <p>{f.notes}</p>}
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
          Add item
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h3>{editing.mode === "create" ? "Add item" : "Edit item"}</h3>
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
          <Field label="Title" error={errorFor("title")}>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Date" error={errorFor("date")}>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Link (https)" error={errorFor("link")}>
            <input type="url" value={form.link} onChange={(e) => set("link", e.target.value)} />
          </Field>
          <Field label="Cost (USD)" error={errorFor("costCents")}>
            <input inputMode="decimal" value={form.cost} onChange={(e) => set("cost", e.target.value)} />
          </Field>
          <Field label="Notes" error={errorFor("notes")}>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
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
