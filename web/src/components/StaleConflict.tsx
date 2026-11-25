import type { ReactNode } from "react";
import type { Membership, PlanItem } from "@tripwise/shared";
import { AlertCircleIcon, Button } from "../ui";
import { LastModified } from "./LastModified";
export interface StaleConflictProps<F> {
  /** The stored item returned with `409 { error: 'STALE', current }` (Req 23.3). */
  current: PlanItem<F>;
  members?: readonly Pick<Membership, "userId" | "displayName">[];
  /** Custom rendering of the stored fields; defaults to a key/value list. */
  renderFields?: (fields: F) => ReactNode;
  /** Discards local edits and continues from the stored item. */
  onUseCurrent: (current: PlanItem<F>) => void;
  onDismiss?: () => void;
}
function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function DefaultFields({ fields }: { fields: unknown }) {
  const entries = fields && typeof fields === "object" ? Object.entries(fields as Record<string, unknown>) : [];
  return (
    <dl>
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{display(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
/** Tells the Member their edit was rejected because someone else saved first, and shows the stored item. */
export function StaleConflict<F>({ current, members, renderFields, onUseCurrent, onDismiss }: StaleConflictProps<F>) {
  return (
    <div role="alert" className="stale-conflict">
      <div className="stale-conflict__header">
        <span className="stale-conflict__icon" aria-hidden="true">
          <AlertCircleIcon size={18} />
        </span>
        <div>
          <p className="stale-conflict__title">Someone else saved first</p>
          <p className="stale-conflict__text">
            This item was changed by someone else since you opened it. Your changes were not saved. The stored version
            is:
          </p>
        </div>
      </div>
      <div className="stale-conflict__stored">
        {renderFields ? renderFields(current.fields) : <DefaultFields fields={current.fields} />}
      </div>
      <LastModified
        lastModifiedBy={current.lastModifiedBy}
        lastModifiedAt={current.lastModifiedAt}
        members={members}
      />
      <div className="stale-conflict__actions">
        <Button variant="primary" size="sm" onClick={() => onUseCurrent(current)}>
          Use stored version
        </Button>
        {onDismiss && (
          <Button variant="secondary" size="sm" onClick={onDismiss}>
            Keep editing
          </Button>
        )}
      </div>
    </div>
  );
}
