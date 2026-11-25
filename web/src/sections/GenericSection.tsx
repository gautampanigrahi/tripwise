import { useId, useState, type FormEvent } from "react";
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
import { Badge, Card, Checkbox, ConfirmDialog, EmptyState, TextArea, TextInput, useToast } from "../ui";
import {
  centsToDollars,
  describeError,
  dollarsToCents,
  errorsFor,
  formatUsd,
  FormDrawer,
  ItemActions,
  SectionHeader,
  usePendingDelete,
  type Editing,
  type MemberOption,
} from "./planSectionHelpers";
import { ScratchPadDrafts } from "./ScratchPadDrafts";
import "./lists.css";

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
  /** ScratchPad only: Trip dates used to re-validate edited Itinerary drafts. */
  trip?: { startDate: string; endDate: string };
  /** ScratchPad only: the signed-in Member, so Checklist drafts suggested for them are claimed on accept. */
  currentUserId?: string;
}

// Generic rules do not read trip context; validatePlanItem still requires one.
const GENERIC_CTX: ValidationContext = {
  trip: { startDate: "1970-01-01", endDate: "1970-01-01" },
  memberIds: new Set(),
};

const EMPTY_COPY: Record<GenericSectionName, string> = {
  Transportation: "Add flights, rental cars, or rides so everyone knows how they are getting there.",
  Reservations: "Add restaurant bookings, tickets, and other reservations.",
  ScratchPad: "Jot down ideas, links, and notes for the group.",
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
export function GenericSection({
  tripId,
  section,
  heading,
  items,
  members,
  onChanged,
  trip,
  currentUserId,
}: GenericSectionProps) {
  const client = useApiClient();
  const toast = useToast();
  const formId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<GenericForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<GenericItem | null>(null);
  const pendingDelete = usePendingDelete<GenericItem>();
  const drafting = section === "ScratchPad";
  // "Use for drafting" selection; IDs of deleted items are dropped when sent.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selectedIds = items.filter((i) => selected.has(i.itemId)).map((i) => i.itemId);

  function toggleSelected(itemId: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }
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
          toast.error("Someone else changed this item. Your changes were not saved.");
          return;
        }
      }
      toast.success(editing.mode === "create" ? `Added ${result.value.title}.` : `Saved ${result.value.title}.`);
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
    try {
      await deleteItem(client, tripId, section, item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      toast.success(`Deleted ${item.fields.title}.`);
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby={headingId} className="list-section">
      <SectionHeader id={headingId} title={heading} addLabel="Add item" onAdd={startCreate} />
      {drafting && (
        <ScratchPadDrafts
          tripId={tripId}
          selectedIds={selectedIds}
          members={members}
          trip={trip}
          currentUserId={currentUserId}
          onChanged={onChanged}
        />
      )}
      {items.length === 0 ? (
        <EmptyState title="Nothing here yet" description={EMPTY_COPY[section]} />
      ) : (
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
                    <h3 className="item-card__title">{f.title}</h3>
                    {(f.date || f.costCents !== undefined || f.link) && (
                      <div className="item-card__meta">
                        {f.date && <Badge tone="accent">{f.date}</Badge>}
                        {f.costCents !== undefined && <Badge>{formatUsd(f.costCents)}</Badge>}
                        {f.link && (
                          <a href={f.link} target="_blank" rel="noopener noreferrer">
                            Open link
                          </a>
                        )}
                      </div>
                    )}
                    {f.notes && <p className="item-card__notes">{f.notes}</p>}
                    {drafting && (
                      <Checkbox
                        fieldClassName="item-card__select"
                        label={
                          <>
                            Use for drafting<span className="visually-hidden">: {f.title}</span>
                          </>
                        }
                        checked={selected.has(item.itemId)}
                        onChange={(e) => toggleSelected(item.itemId, e.target.checked)}
                      />
                    )}
                  </div>
                  <div className="item-card__actions">
                    <ItemActions
                      itemLabel={f.title}
                      onEdit={() => startEdit(item)}
                      onDelete={() => pendingDelete.request(item)}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <FormDrawer
        open={editing !== null}
        title={editing?.mode === "edit" ? "Edit item" : "Add item"}
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
        <TextInput
          label="Title"
          required
          data-autofocus
          value={form.title}
          error={errorFor("title")}
          onChange={(e) => set("title", e.target.value)}
        />
        <TextInput
          label="Date"
          type="date"
          value={form.date}
          error={errorFor("date")}
          onChange={(e) => set("date", e.target.value)}
        />
        <TextInput
          label="Link (https)"
          type="url"
          value={form.link}
          error={errorFor("link")}
          onChange={(e) => set("link", e.target.value)}
        />
        <TextInput
          label="Cost (USD)"
          hint="Optional, up to 2 decimals"
          inputMode="decimal"
          value={form.cost}
          error={errorFor("costCents")}
          onChange={(e) => set("cost", e.target.value)}
        />
        <TextArea label="Notes" value={form.notes} error={errorFor("notes")} onChange={(e) => set("notes", e.target.value)} />
      </FormDrawer>

      <ConfirmDialog
        open={pendingDelete.target !== null}
        title={`Delete ${pendingDelete.target?.fields.title ?? "item"}?`}
        message="This removes the item for everyone on the trip."
        busy={pendingDelete.busy}
        onCancel={pendingDelete.cancel}
        onConfirm={() => void pendingDelete.confirm(remove)}
      />
    </section>
  );
}
