import { useId, useState, type FormEvent } from "react";
import { DRAFTING_SECTIONS, MAX_DRAFT_NOTES } from "@tripwise/grounding";
import { validatePlanItem, type FieldError, type ValidationContext } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError, type ApiClient } from "../api/client";
import { createDrafts, type DraftingSection, type DraftItem } from "../api/drafts";
import { claimItem, createItem } from "../api/items";
import { memberName } from "../components/LastModified";
import { Badge, Button, Card, Checkbox, Drawer, EmptyState, Select, TextArea, TextInput, useToast } from "../ui";
import { centsToDollars, dollarsToCents, errorsFor, formatUsd, type MemberOption } from "./planSectionHelpers";
import "./ScratchPadDrafts.css";

export const DRAFT_ERROR_MESSAGE = "Drafts could not be created. Try again in a moment.";

type FieldKind = "text" | "textarea" | "date" | "time" | "number" | "cents" | "member" | "boolean";

interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
}

const GENERIC_SPECS: readonly FieldSpec[] = [
  { key: "title", label: "Title", kind: "text" },
  { key: "date", label: "Date", kind: "date" },
  { key: "link", label: "Link (https)", kind: "text" },
  { key: "costCents", label: "Cost (USD)", kind: "cents" },
  { key: "notes", label: "Notes", kind: "textarea" },
];

/** Fields of each Drafting_Section in the create-item shape (matches the Section schemas in `@tripwise/shared`). */
export const DRAFT_FIELD_SPECS: Record<DraftingSection, readonly FieldSpec[]> = {
  Itinerary: [
    { key: "day", label: "Day", kind: "date" },
    { key: "startTime", label: "Start time", kind: "time" },
    { key: "endTime", label: "End time", kind: "time" },
    { key: "stopName", label: "Stop", kind: "text" },
    { key: "notes", label: "Notes", kind: "textarea" },
  ],
  Groceries: [
    { key: "name", label: "Name", kind: "text" },
    { key: "quantity", label: "Quantity", kind: "number" },
    { key: "responsibleMemberId", label: "Responsible", kind: "member" },
    { key: "purchased", label: "Purchased", kind: "boolean" },
  ],
  Checklist: [
    { key: "task", label: "Task", kind: "text" },
    { key: "done", label: "Done", kind: "boolean" },
  ],
  Reservations: GENERIC_SPECS,
  Transportation: GENERIC_SPECS,
};

export type DraftForm = Record<string, string | boolean>;

/** Prefills the edit form from a draft's raw fields. */
export function formFromDraft(section: DraftingSection, fields: Record<string, unknown>): DraftForm {
  const form: DraftForm = {};
  for (const spec of DRAFT_FIELD_SPECS[section]) {
    const v = fields[spec.key];
    if (spec.kind === "boolean") form[spec.key] = v === true;
    else if (spec.kind === "cents") form[spec.key] = typeof v === "number" ? centsToDollars(v) : "";
    else form[spec.key] = v === undefined || v === null ? "" : String(v);
  }
  return form;
}

/** Builds raw fields from the edit form, leaving out empty values so required ones fail validation by name. */
export function fieldsFromDraftForm(section: DraftingSection, form: DraftForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of DRAFT_FIELD_SPECS[section]) {
    const v = form[spec.key];
    if (spec.kind === "boolean") {
      out[spec.key] = v === true;
      continue;
    }
    const s = typeof v === "string" ? v.trim() : "";
    if (s === "") continue;
    if (spec.kind === "number") out[spec.key] = Number(s);
    else if (spec.kind === "cents") out[spec.key] = dollarsToCents(s);
    else out[spec.key] = s;
  }
  return out;
}

/** Validation context for drafts: the Trip dates and the current Member IDs. */
export function draftValidationContext(
  trip: { startDate: string; endDate: string } | undefined,
  members: readonly MemberOption[] | undefined,
): ValidationContext {
  return {
    trip: trip ?? { startDate: "0001-01-01", endDate: "9999-12-31" },
    memberIds: new Set((members ?? []).map((m) => m.userId)),
  };
}

/** Replaces a draft's fields and refreshes `valid` and `errors` with the shared Section validation. */
export function revalidateDraft(draft: DraftItem, fields: Record<string, unknown>, ctx: ValidationContext): DraftItem {
  const result = validatePlanItem(draft.section, fields, ctx);
  return { ...draft, fields, valid: result.ok, errors: result.ok ? [] : result.errors };
}

/** Drafts grouped by Section in Drafting_Section order; empty groups are left out. */
export function groupDrafts(drafts: readonly DraftItem[]): { section: DraftingSection; drafts: DraftItem[] }[] {
  return DRAFTING_SECTIONS.map((section) => ({ section, drafts: drafts.filter((d) => d.section === section) })).filter(
    (g) => g.drafts.length > 0,
  );
}

export function isAcceptable(draft: DraftItem): boolean {
  return draft.valid && draft.errors.length === 0;
}

/** Text for a field value: Member IDs as display names, cents as dollars, booleans as Yes/No. */
export function formatDraftValue(kind: FieldKind, value: unknown, members?: readonly MemberOption[]): string {
  if (kind === "boolean") return value === true ? "Yes" : "No";
  if (kind === "cents" && typeof value === "number" && Number.isInteger(value)) return formatUsd(value);
  if (kind === "member" && typeof value === "string") return memberName(value, members);
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Maps a draft request error to inline text: the 400 message, or the generic message for 502 and network errors. */
export function describeDraftError(err: unknown): { message: string; validation: boolean } {
  if (err instanceof ApiError && err.status === 400) {
    const body = err.body as { message?: unknown; fields?: unknown } | undefined;
    const fields = Array.isArray(body?.fields) ? (body.fields as FieldError[]) : [];
    const text = fields.map((f) => f.message).filter(Boolean).join(" ");
    if (text) return { message: text, validation: true };
    if (typeof body?.message === "string" && body.message) return { message: body.message, validation: true };
    return { message: `Draft notes must be 1 to ${MAX_DRAFT_NOTES.toLocaleString("en-US")} characters`, validation: true };
  }
  return { message: DRAFT_ERROR_MESSAGE, validation: false };
}

export type AcceptOutcome =
  | { ok: true; claimed: boolean; claimFailed: boolean }
  | { ok: false; rejected: boolean; errors: FieldError[]; message: string };

/**
 * Saves one draft with the existing create route. For a Checklist draft whose suggested claimer is the
 * accepting Member, the item is then claimed through the existing claim route (Req 22.19).
 */
export async function acceptDraft(
  client: ApiClient,
  tripId: string,
  draft: DraftItem,
  currentUserId: string | undefined,
): Promise<AcceptOutcome> {
  let itemId: string;
  try {
    const created = await createItem(client, tripId, draft.section, draft.fields);
    itemId = created.itemId;
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      const body = err.body as { fields?: unknown } | undefined;
      const errors = Array.isArray(body?.fields) ? (body.fields as FieldError[]) : [];
      return {
        ok: false,
        rejected: true,
        errors: errors.length > 0 ? errors : [{ field: "fields", message: "The draft was rejected." }],
        message: "Please fix the highlighted fields.",
      };
    }
    return {
      ok: false,
      rejected: false,
      errors: draft.errors,
      message: err instanceof ApiError ? `Could not save the draft (${err.status}).` : "Could not save the draft.",
    };
  }
  const shouldClaim =
    draft.section === "Checklist" &&
    draft.suggestedClaimedBy !== undefined &&
    currentUserId !== undefined &&
    draft.suggestedClaimedBy === currentUserId;
  if (!shouldClaim) return { ok: true, claimed: false, claimFailed: false };
  try {
    await claimItem(client, tripId, itemId);
    return { ok: true, claimed: true, claimFailed: false };
  } catch {
    return { ok: true, claimed: false, claimFailed: true };
  }
}

export interface ScratchPadDraftsProps {
  tripId: string;
  /** ScratchPad item IDs checked with "Use for drafting". */
  selectedIds: readonly string[];
  members?: readonly MemberOption[];
  /** Trip dates for the Itinerary day range when re-validating edited drafts. */
  trip?: { startDate: string; endDate: string };
  /** The signed-in Member; Checklist drafts suggested for this Member are claimed after saving. */
  currentUserId?: string;
  onChanged: () => void | Promise<void>;
}

/** "Draft with AI" card and the Drafts Drawer for the Scratch pad tab (Req 22.1, 22.2, 22.18–22.23, 22.25). */
export function ScratchPadDrafts({ tripId, selectedIds, members, trip, currentUserId, onChanged }: ScratchPadDraftsProps) {
  const client = useApiClient();
  const toast = useToast();
  const formId = useId();
  const [notes, setNotes] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [notesError, setNotesError] = useState<string>();
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DraftForm>({});

  const ctx = draftValidationContext(trip, members);
  const tooLong = notes.length > MAX_DRAFT_NOTES;
  const hasInput = selectedIds.length > 0 || notes.trim() !== "";
  const anySaving = bulkSaving || saving.size > 0;
  const limitText = MAX_DRAFT_NOTES.toLocaleString("en-US");

  function updateDraft(next: DraftItem) {
    setDrafts((ds) => ds.map((d) => (d.draftId === next.draftId ? next : d)));
  }
  function removeDraft(draftId: string) {
    setDrafts((ds) => ds.filter((d) => d.draftId !== draftId));
    setCardErrors(({ [draftId]: _removed, ...rest }) => rest);
    if (editingId === draftId) setEditingId(null);
  }
  function setSavingFor(draftId: string, on: boolean) {
    setSaving((s) => {
      const next = new Set(s);
      if (on) next.add(draftId);
      else next.delete(draftId);
      return next;
    });
  }

  async function requestDrafts() {
    if (!hasInput || tooLong) return;
    setRequesting(true);
    setRequestError(undefined);
    setNotesError(undefined);
    try {
      const result = await createDrafts(client, tripId, { itemIds: selectedIds, notes });
      setDrafts(result);
      setCardErrors({});
      setEditingId(null);
      setDrawerOpen(true);
    } catch (err) {
      // Selection and notes are left unchanged (Req 22.25).
      const d = describeDraftError(err);
      if (d.validation) {
        setNotesError(d.message);
      } else {
        setRequestError(d.message);
        toast.error(DRAFT_ERROR_MESSAGE);
      }
    } finally {
      setRequesting(false);
    }
  }

  function applyOutcome(draft: DraftItem, outcome: AcceptOutcome) {
    if (outcome.ok) {
      removeDraft(draft.draftId);
      if (outcome.claimFailed) toast.error(`Added to ${draft.section}, but it could not be claimed for you.`);
      return true;
    }
    // Only a 400 rejection changes the draft's errors (Req 22.21); other failures keep it as it was.
    if (outcome.rejected) updateDraft({ ...draft, valid: false, errors: outcome.errors });
    setCardErrors((e) => ({ ...e, [draft.draftId]: outcome.message }));
    return false;
  }

  async function accept(draft: DraftItem) {
    setSavingFor(draft.draftId, true);
    try {
      const outcome = await acceptDraft(client, tripId, draft, currentUserId);
      if (applyOutcome(draft, outcome)) {
        toast.success(`Added to ${draft.section}`);
        await onChanged();
      }
    } finally {
      setSavingFor(draft.draftId, false);
    }
  }

  async function acceptAllValid() {
    const toSave = drafts.filter(isAcceptable);
    setBulkSaving(true);
    let added = 0;
    try {
      // One at a time (Req 22.23); invalid drafts stay in the list.
      for (const draft of toSave) {
        const outcome = await acceptDraft(client, tripId, draft, currentUserId);
        if (applyOutcome(draft, outcome)) added += 1;
      }
    } finally {
      setBulkSaving(false);
    }
    const needFixes = drafts.length - added;
    toast.show({
      kind: added > 0 ? "success" : "info",
      message: `${added} added, ${needFixes} need fixes`,
    });
    if (added > 0) await onChanged();
  }

  function startEdit(draft: DraftItem) {
    setEditingId(draft.draftId);
    setEditForm(formFromDraft(draft.section, draft.fields));
  }

  function submitEdit(e: FormEvent, draft: DraftItem) {
    e.preventDefault();
    updateDraft(revalidateDraft(draft, fieldsFromDraftForm(draft.section, editForm), ctx));
    setCardErrors(({ [draft.draftId]: _removed, ...rest }) => rest);
    setEditingId(null);
  }

  const groups = groupDrafts(drafts);
  const validCount = drafts.filter(isAcceptable).length;

  return (
    <>
      <Card
        className="draft-ai"
        title="Draft with AI"
        subtitle="Turn selected Scratch pad items or your own notes into draft items you can review before saving."
      >
        <div className="draft-ai__body">
          <p className="draft-ai__selection">
            {selectedIds.length === 0
              ? "No Scratch pad items selected. Tick “Use for drafting” on an item to include it."
              : `${selectedIds.length} Scratch pad item${selectedIds.length === 1 ? "" : "s"} selected.`}
          </p>
          <TextArea
            label="Draft from notes"
            value={notes}
            rows={4}
            hint={`${notes.length.toLocaleString("en-US")} / ${limitText} characters`}
            error={tooLong ? `Draft notes must be 1 to ${limitText} characters` : notesError}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesError(undefined);
            }}
          />
          {requestError && (
            <p role="alert" className="alert alert--danger">
              {requestError}
            </p>
          )}
          <div className="draft-ai__actions">
            <Button onClick={() => void requestDrafts()} loading={requesting} disabled={!hasInput || tooLong}>
              {requesting ? "Creating drafts…" : "Create drafts"}
            </Button>
          </div>
        </div>
      </Card>
      <Drawer
        open={drawerOpen}
        onClose={() => {
          if (!anySaving) setDrawerOpen(false);
        }}
        title="Drafts"
        description="Nothing is saved until you accept a draft."
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)} disabled={anySaving}>
              Close
            </Button>
            <Button onClick={() => void acceptAllValid()} loading={bulkSaving} disabled={validCount === 0 || anySaving}>
              Accept all valid
            </Button>
          </>
        }
      >
        <DraftList
          groups={groups}
          members={members}
          editingId={editingId}
          editForm={editForm}
          formId={formId}
          saving={saving}
          disabled={bulkSaving}
          cardErrors={cardErrors}
          onEditFormChange={setEditForm}
          onEdit={startEdit}
          onCancelEdit={() => setEditingId(null)}
          onSubmitEdit={submitEdit}
          onAccept={(d) => void accept(d)}
          onDiscard={(d) => removeDraft(d.draftId)}
        />
      </Drawer>
    </>
  );
}

export interface DraftListProps {
  groups: { section: DraftingSection; drafts: DraftItem[] }[];
  members?: readonly MemberOption[];
  editingId?: string | null;
  editForm?: DraftForm;
  formId?: string;
  saving?: ReadonlySet<string>;
  disabled?: boolean;
  cardErrors?: Record<string, string>;
  onEditFormChange?: (form: DraftForm) => void;
  onEdit?: (draft: DraftItem) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (e: FormEvent, draft: DraftItem) => void;
  onAccept?: (draft: DraftItem) => void;
  onDiscard?: (draft: DraftItem) => void;
}

const noop = () => undefined;

/** Draft cards grouped by Section, each with its fields, errors, and Edit / Accept / Discard. */
export function DraftList({
  groups,
  members,
  editingId = null,
  editForm = {},
  formId = "draft-edit",
  saving = new Set(),
  disabled = false,
  cardErrors = {},
  onEditFormChange = noop,
  onEdit = noop,
  onCancelEdit = noop,
  onSubmitEdit = noop,
  onAccept = noop,
  onDiscard = noop,
}: DraftListProps) {
  if (groups.length === 0) {
    return <EmptyState title="No drafts left" description="Every draft was added or discarded." />;
  }
  return (
    <div className="draft-list">
      {groups.map((group) => (
        <section key={group.section} className="draft-list__group" aria-label={`${group.section} drafts`}>
          <h3 className="draft-list__heading">{group.section}</h3>
          <ul className="draft-list__items">
            {group.drafts.map((draft) => {
              const specs = DRAFT_FIELD_SPECS[draft.section];
              const known = new Set(specs.map((s) => s.key));
              const otherErrors = draft.errors.filter((e) => !known.has(e.field.split(".")[0] ?? ""));
              const isSaving = saving.has(draft.draftId);
              const editing = editingId === draft.draftId;
              const label = draftLabel(draft);
              return (
                <Card as="li" compact key={draft.draftId} className="draft-card">
                  <div className="draft-card__badges">
                    <Badge tone="accent">{draft.section}</Badge>
                    {!draft.valid && <Badge tone="danger">Invalid</Badge>}
                  </div>
                  {editing ? (
                    <form
                      id={`${formId}-${draft.draftId}`}
                      className="draft-card__form"
                      noValidate
                      onSubmit={(e) => onSubmitEdit(e, draft)}
                    >
                      {specs.map((spec) => (
                        <DraftFieldInput
                          key={spec.key}
                          spec={spec}
                          value={editForm[spec.key]}
                          error={errorsFor(draft.errors, spec.key)}
                          members={members}
                          onChange={(v) => onEditFormChange({ ...editForm, [spec.key]: v })}
                        />
                      ))}
                      <div className="draft-card__actions">
                        <Button variant="secondary" size="sm" onClick={onCancelEdit}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm">
                          Update draft
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <dl className="draft-card__fields">
                      {specs
                        .filter((spec) => draft.fields[spec.key] !== undefined || errorsFor(draft.errors, spec.key))
                        .map((spec) => {
                          const err = errorsFor(draft.errors, spec.key);
                          const value = draft.fields[spec.key];
                          return (
                            <div key={spec.key} className="draft-card__field">
                              <dt>{spec.label}</dt>
                              <dd>
                                {value === undefined ? <span className="draft-card__missing">Not set</span> : formatDraftValue(spec.kind, value, members)}
                                {err && (
                                  <span role="alert" className="field-error">
                                    {" "}
                                    {err}
                                  </span>
                                )}
                              </dd>
                            </div>
                          );
                        })}
                    </dl>
                  )}
                  {draft.suggestedClaimedBy && (
                    <p className="draft-card__suggested">Suggested: {memberName(draft.suggestedClaimedBy, members)}</p>
                  )}
                  {otherErrors.length > 0 && (
                    <ul className="draft-card__errors">
                      {otherErrors.map((e, i) => (
                        <li key={`${e.field}-${i}`} className="field-error">
                          {e.field}: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {cardErrors[draft.draftId] && (
                    <p role="alert" className="alert alert--danger">
                      {cardErrors[draft.draftId]}
                    </p>
                  )}
                  {!editing && (
                    <div className="draft-card__actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(draft)}
                        disabled={isSaving || disabled}
                        aria-label={`Edit draft ${label}`}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDiscard(draft)}
                        disabled={isSaving || disabled}
                        aria-label={`Discard draft ${label}`}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => onAccept(draft)}
                        loading={isSaving}
                        disabled={disabled}
                        aria-label={`Accept draft ${label}`}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Short name for a draft, used in button labels. */
function draftLabel(draft: DraftItem): string {
  const f = draft.fields;
  const name = f.title ?? f.stopName ?? f.name ?? f.task;
  return typeof name === "string" && name.trim() !== "" ? name : draft.section;
}

function DraftFieldInput({
  spec,
  value,
  error,
  members,
  onChange,
}: {
  spec: FieldSpec;
  value: string | boolean | undefined;
  error: string;
  members?: readonly MemberOption[];
  onChange: (value: string | boolean) => void;
}) {
  const text = typeof value === "string" ? value : "";
  switch (spec.kind) {
    case "boolean":
      return <Checkbox label={spec.label} checked={value === true} error={error} onChange={(e) => onChange(e.target.checked)} />;
    case "textarea":
      return <TextArea label={spec.label} value={text} error={error} onChange={(e) => onChange(e.target.value)} />;
    case "member": {
      const options = (members ?? []).map((m) => ({ value: m.userId, label: memberName(m.userId, members) }));
      if (text !== "" && !options.some((o) => o.value === text)) options.push({ value: text, label: `${text} (not a Member)` });
      return (
        <Select
          label={spec.label}
          value={text}
          placeholder="Choose a Member"
          options={options}
          error={error}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    default:
      return (
        <TextInput
          label={spec.label}
          type={spec.kind === "date" ? "date" : spec.kind === "time" ? "time" : "text"}
          inputMode={spec.kind === "number" || spec.kind === "cents" ? "decimal" : undefined}
          value={text}
          error={error}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
