import { useMemo, useState, type FormEvent } from "react";
import {
  groupItinerary,
  validatePlanItem,
  type FieldError,
  type ItineraryFields,
  type ItineraryItem,
  type IsoDate,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createItem, deleteItem, updateItem } from "../api/items";
import { LastModified } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import { describeError, errorsFor, Field, type Editing, type MemberOption } from "./planSectionHelpers";

export interface ItineraryProps {
  tripId: string;
  /** Trip dates; an Itinerary day must fall within them (Req 7.2). */
  trip: { startDate: IsoDate; endDate: IsoDate };
  items: readonly ItineraryItem[];
  members?: readonly MemberOption[];
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void | Promise<void>;
}

interface ItineraryForm {
  day: string;
  startTime: string;
  endTime: string;
  stopName: string;
  notes: string;
}

const EMPTY_FORM: ItineraryForm = { day: "", startTime: "", endTime: "", stopName: "", notes: "" };

function formFromFields(f: ItineraryFields): ItineraryForm {
  return {
    day: f.day,
    startTime: f.startTime,
    endTime: f.endTime ?? "",
    stopName: f.stopName,
    notes: f.notes ?? "",
  };
}

/** Builds the submitted fields, omitting empty optional values. */
function fieldsFromForm(form: ItineraryForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    day: form.day,
    startTime: form.startTime,
    stopName: form.stopName.trim(),
  };
  if (form.endTime !== "") out.endTime = form.endTime;
  if (form.notes.trim() !== "") out.notes = form.notes.trim();
  return out;
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

export function Itinerary({ tripId, trip, items, members, onChanged }: ItineraryProps) {
  const client = useApiClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ItineraryForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<ItineraryItem | null>(null);

  const ctx: ValidationContext = useMemo(
    () => ({ trip: { startDate: trip.startDate, endDate: trip.endDate }, memberIds: new Set() }),
    [trip.startDate, trip.endDate],
  );
  // Req 7.4: grouped by day, ordered by start time within each day.
  const days = useMemo(() => groupItinerary(items), [items]);
  const errorFor = (field: string) => errorsFor(fieldErrors, field);

  function set<K extends keyof ItineraryForm>(key: K, value: ItineraryForm[K]) {
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
    setForm({ ...EMPTY_FORM, day: trip.startDate });
  }

  function startEdit(item: ItineraryItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(formFromFields(item.fields));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const result = validatePlanItem("Itinerary", fieldsFromForm(form), ctx);
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
        await createItem(client, tripId, "Itinerary", result.value);
      } else {
        const res = await updateItem(
          client,
          tripId,
          "Itinerary",
          editing.itemId,
          result.value,
          editing.expectedLastModifiedAt,
        );
        if (!res.ok) {
          setStale(res.current as ItineraryItem);
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

  async function remove(item: ItineraryItem) {
    if (!window.confirm(`Delete ${item.fields.stopName}?`)) return;
    setError(undefined);
    try {
      await deleteItem(client, tripId, "Itinerary", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="itinerary-heading">
      <h2 id="itinerary-heading">Itinerary</h2>
      {days.length === 0 ? (
        <p>No itinerary stops yet.</p>
      ) : (
        days.map((group) => (
          <div key={group.day}>
            <h3>
              <time dateTime={group.day}>{formatDay(group.day)}</time>
            </h3>
            <ul>
              {group.items.map((item) => {
                const f = item.fields;
                return (
                  <li key={item.itemId} className="card">
                    <strong>
                      {f.startTime}
                      {f.endTime ? `–${f.endTime}` : ""} {f.stopName}
                    </strong>
                    {f.notes && <p>{f.notes}</p>}
                    <LastModified
                      lastModifiedBy={item.lastModifiedBy}
                      lastModifiedAt={item.lastModifiedAt}
                      members={members}
                    />
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
          </div>
        ))
      )}
      {!editing && error && <p role="alert">{error}</p>}
      {!editing ? (
        <button type="button" onClick={startCreate}>
          Add stop
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h3>{editing.mode === "create" ? "Add stop" : "Edit stop"}</h3>
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
          <Field label="Day" error={errorFor("day")}>
            <input
              type="date"
              min={trip.startDate}
              max={trip.endDate}
              value={form.day}
              onChange={(e) => set("day", e.target.value)}
            />
          </Field>
          <Field label="Start time" error={errorFor("startTime")}>
            <input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </Field>
          <Field label="End time (optional)" error={errorFor("endTime")}>
            <input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </Field>
          <Field label="Stop name" error={errorFor("stopName")}>
            <input value={form.stopName} onChange={(e) => set("stopName", e.target.value)} />
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
