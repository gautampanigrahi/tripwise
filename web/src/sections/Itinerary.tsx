import { useId, useMemo, useState, type FormEvent } from "react";
import {
  groupItinerary,
  toEpochDay,
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
import { Button, Card, ConfirmDialog, Drawer, EmptyState, PlusIcon, TextArea, TextInput, useToast } from "../ui";
import { describeError, errorsFor, type Editing, type MemberOption } from "./planSectionHelpers";
import "./Itinerary.css";

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Weekday and date parts for a day header; falls back to the raw value when it does not parse. */
export function formatDayParts(day: string): { weekday: string; date: string } {
  const d = ISO_DATE.test(day) ? new Date(`${day}T00:00:00`) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) return { weekday: "", date: day };
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
  };
}

/** 1-based day number within the trip ("Day 1" is the start date); undefined outside a valid date. */
export function tripDayNumber(day: string, startDate: string): number | undefined {
  if (!ISO_DATE.test(day) || !ISO_DATE.test(startDate)) return undefined;
  const n = toEpochDay(day) - toEpochDay(startDate) + 1;
  return Number.isFinite(n) ? n : undefined;
}

/** "9:05 AM" style label for an HH:MM time; the raw value when it does not parse. */
export function formatTime(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const d = new Date(1970, 0, 1, Number(m[1]), Number(m[2]));
  return Number.isNaN(d.getTime()) ? time : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function Itinerary({ tripId, trip, items, members, onChanged }: ItineraryProps) {
  const client = useApiClient();
  const toast = useToast();
  const formId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ItineraryForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<ItineraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ItineraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ctx: ValidationContext = useMemo(
    () => ({ trip: { startDate: trip.startDate, endDate: trip.endDate }, memberIds: new Set() }),
    [trip.startDate, trip.endDate],
  );
  // Req 7.4: grouped by day, ordered by start time within each day.
  const days = useMemo(() => groupItinerary(items), [items]);
  const errorFor = (field: string) => errorsFor(fieldErrors, field) || undefined;

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

  /** Opens the add form; `day` preselects a timeline day (defaults to the trip start). */
  function startCreate(day?: string) {
    resetForm();
    setEditing({ mode: "create" });
    setForm({ ...EMPTY_FORM, day: day ?? trip.startDate });
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
          toast.error("Someone else changed this stop. Review their version before saving.");
          return;
        }
      }
      toast.success(editing.mode === "create" ? `Added ${result.value.stopName}.` : `Saved ${result.value.stopName}.`);
      resetForm();
      await onChanged();
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFieldErrors(d.fields);
      toast.error(`Could not save: ${d.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const item = pendingDelete;
    if (!item) return;
    setDeleting(true);
    try {
      await deleteItem(client, tripId, "Itinerary", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      toast.success(`Deleted ${item.fields.stopName}.`);
      setPendingDelete(null);
      await onChanged();
    } catch (err) {
      toast.error(`Could not delete: ${describeError(err).message}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section aria-labelledby="itinerary-heading" className="itinerary">
      <div className="itinerary__header">
        <h2 id="itinerary-heading">Itinerary</h2>
        {days.length > 0 && (
          <Button icon={<PlusIcon size={16} />} onClick={() => startCreate()}>
            Add stop
          </Button>
        )}
      </div>

      {days.length === 0 ? (
        <EmptyState
          title="No itinerary stops yet"
          description="Plan each day of the trip. Stops are grouped by day and ordered by start time."
          action={
            <Button icon={<PlusIcon size={16} />} onClick={() => startCreate()}>
              Add stop
            </Button>
          }
        />
      ) : (
        <ol className="itin-timeline">
          {days.map((group) => {
            const { weekday, date } = formatDayParts(group.day);
            const dayNo = tripDayNumber(group.day, trip.startDate);
            const headingId = `itin-day-${group.day}`;
            return (
              <li key={group.day} className="itin-day" aria-labelledby={headingId}>
                <div className="itin-day__header">
                  <h3 id={headingId} className="itin-day__title">
                    <time dateTime={group.day}>
                      {weekday && <span className="itin-day__weekday">{weekday}</span>}
                      <span className="itin-day__date">{date}</span>
                    </time>
                  </h3>
                  {dayNo !== undefined && dayNo >= 1 && <span className="itin-day__badge">Day {dayNo}</span>}
                  <span className="itin-day__count">
                    {group.items.length} {group.items.length === 1 ? "stop" : "stops"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<PlusIcon size={14} />}
                    className="itin-day__add"
                    aria-label={`Add stop on ${weekday ? `${weekday}, ` : ""}${date}`}
                    onClick={() => startCreate(group.day)}
                  >
                    Add
                  </Button>
                </div>
                <ol className="itin-stops">
                  {group.items.map((item) => {
                    const f = item.fields;
                    return (
                      <li key={item.itemId} className="itin-stop">
                        <div className="itin-stop__time">
                          <time dateTime={f.startTime}>{formatTime(f.startTime)}</time>
                          {f.endTime && (
                            <>
                              <span className="visually-hidden"> to </span>
                              <time dateTime={f.endTime} className="itin-stop__end">
                                {formatTime(f.endTime)}
                              </time>
                            </>
                          )}
                        </div>
                        <span className="itin-stop__marker" aria-hidden="true" />
                        <Card
                          compact
                          className="itin-stop__card"
                          title={f.stopName}
                          headingLevel={4}
                          actions={
                            <>
                              <Button size="sm" variant="ghost" onClick={() => startEdit(item)} aria-label={`Edit ${f.stopName}`}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPendingDelete(item)}
                                aria-label={`Delete ${f.stopName}`}
                              >
                                Delete
                              </Button>
                            </>
                          }
                        >
                          {f.notes && <p className="itin-stop__notes">{f.notes}</p>}
                          <LastModified
                            lastModifiedBy={item.lastModifiedBy}
                            lastModifiedAt={item.lastModifiedAt}
                            members={members}
                          />
                        </Card>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => {
          if (!busy) resetForm();
        }}
        title={editing?.mode === "edit" ? "Edit stop" : "Add stop"}
        footer={
          <>
            <Button variant="secondary" onClick={resetForm} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id={formId} className="itinerary-form" onSubmit={(e) => void submit(e)} noValidate>
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
            label="Stop name"
            required
            value={form.stopName}
            error={errorFor("stopName")}
            onChange={(e) => set("stopName", e.target.value)}
          />
          <TextInput
            label="Day"
            type="date"
            required
            min={trip.startDate}
            max={trip.endDate}
            hint={`Between ${trip.startDate} and ${trip.endDate}`}
            value={form.day}
            error={errorFor("day")}
            onChange={(e) => set("day", e.target.value)}
          />
          <div className="itinerary-form__row">
            <TextInput
              label="Start time"
              type="time"
              required
              value={form.startTime}
              error={errorFor("startTime")}
              onChange={(e) => set("startTime", e.target.value)}
            />
            <TextInput
              label="End time (optional)"
              type="time"
              value={form.endTime}
              error={errorFor("endTime")}
              onChange={(e) => set("endTime", e.target.value)}
            />
          </div>
          <TextArea label="Notes" value={form.notes} error={errorFor("notes")} onChange={(e) => set("notes", e.target.value)} />
          {error && (
            <p role="alert" className="alert alert--danger">
              {error}
            </p>
          )}
        </form>
      </Drawer>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.fields.stopName ?? "this stop"}?`}
        message="This removes the stop from the itinerary for everyone on the trip."
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
