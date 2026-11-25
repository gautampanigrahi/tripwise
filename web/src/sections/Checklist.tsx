import { useId, useState, type FormEvent } from "react";
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
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ProgressBar, TextInput, useToast } from "../ui";
import {
  describeError,
  errorsFor,
  FormDrawer,
  ItemActions,
  MemberChip,
  SectionHeader,
  usePendingDelete,
  type Editing,
  type MemberOption,
} from "./planSectionHelpers";
import "./lists.css";

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
  const toast = useToast();
  const formId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ChecklistForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<ChecklistItem | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ itemId: string; text: string } | null>(null);
  const [rowStale, setRowStale] = useState<ChecklistItem | null>(null);
  const pendingDelete = usePendingDelete<ChecklistItem>();

  const doneCount = items.filter((i) => i.fields.done).length;
  const claimedCount = items.filter((i) => i.fields.claimedBy).length;
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
          toast.error("Someone else changed this task. Your changes were not saved.");
          return;
        }
      }
      toast.success(editing.mode === "create" ? "Task added." : "Task saved.");
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
      toast.success(`You claimed "${item.fields.task}".`);
      await onChanged();
    } catch (err) {
      const by = alreadyClaimedBy(err);
      if (by !== undefined) {
        const text = by ? `Already claimed by ${memberName(by, members)}.` : "Already claimed by another Member.";
        setRowMessage({ itemId: item.itemId, text });
        toast.error(text);
        await onChanged();
      } else {
        const text = describeError(err).message;
        setRowMessage({ itemId: item.itemId, text });
        toast.error(text);
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
        toast.error(`"${item.fields.task}" was changed by someone else. Review the stored version.`);
        return;
      }
      await onChanged();
    } catch (err) {
      const text = describeError(err).message;
      setRowMessage({ itemId: item.itemId, text });
      toast.error(text);
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(item: ChecklistItem) {
    try {
      await deleteItem(client, tripId, "Checklist", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      toast.success("Task deleted.");
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    }
  }

  return (
    <section aria-labelledby="checklist-heading" className="list-section">
      <SectionHeader
        id="checklist-heading"
        title="Checklist"
        description="Claim a task to let everyone know you are on it."
        addLabel="Add task"
        onAdd={startCreate}
      />
      {items.length === 0 ? (
        <EmptyState title="No checklist tasks yet" description="Add the things that need doing before the trip." />
      ) : (
        <>
          <Card className="list-summary">
            <ProgressBar
              label="Checklist tasks done"
              value={doneCount}
              max={items.length}
              tone={doneCount === items.length ? "success" : "accent"}
              valueText={`${doneCount} of ${items.length} done`}
            />
            <div className="list-summary__stats">
              <Badge tone="accent">{claimedCount} claimed</Badge>
              <Badge tone={items.length - claimedCount > 0 ? "warning" : "neutral"}>
                {items.length - claimedCount} unclaimed
              </Badge>
            </div>
          </Card>
          <ul className="item-list">
            {items.map((item) => {
              const f = item.fields;
              const busyRow = rowBusy === item.itemId;
              return (
                <Card
                  as="li"
                  compact
                  key={item.itemId}
                  className={f.done ? "item-card item-card--done" : "item-card"}
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
                        label={f.task}
                        checked={f.done}
                        disabled={busyRow}
                        onChange={(e) => void setDone(item, e.target.checked)}
                      />
                      <div className="item-card__meta">
                        {f.claimedBy ? (
                          <MemberChip userId={f.claimedBy} members={members} prefix="Claimed by" />
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busyRow}
                            onClick={() => void claim(item)}
                            aria-label={`Claim ${f.task}`}
                          >
                            Claim
                          </Button>
                        )}
                        {f.done && <Badge tone="success">Done</Badge>}
                      </div>
                      {rowMessage?.itemId === item.itemId && (
                        <p role="alert" className="field-error">
                          {rowMessage.text}
                        </p>
                      )}
                    </div>
                    <div className="item-card__actions">
                      <ItemActions
                        itemLabel={f.task}
                        onEdit={() => startEdit(item)}
                        onDelete={() => pendingDelete.request(item)}
                      />
                    </div>
                  </div>
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
                </Card>
              );
            })}
          </ul>
        </>
      )}

      <FormDrawer
        open={editing !== null}
        title={editing?.mode === "edit" ? "Edit task" : "Add task"}
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
        <TextInput
          label="Task"
          required
          data-autofocus
          value={form.task}
          error={errorFor("task")}
          onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
        />
        <Checkbox
          label="Done"
          checked={form.done}
          onChange={(e) => setForm((f) => ({ ...f, done: e.target.checked }))}
        />
      </FormDrawer>

      <ConfirmDialog
        open={pendingDelete.target !== null}
        title={`Delete "${pendingDelete.target?.fields.task ?? "task"}"?`}
        message="This removes the task for everyone on the trip."
        busy={pendingDelete.busy}
        onCancel={pendingDelete.cancel}
        onConfirm={() => void pendingDelete.confirm(remove)}
      />
    </section>
  );
}
