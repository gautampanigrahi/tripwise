import type { ReactNode } from "react";
import type { Membership, PlanItem } from "@tripwise/shared";
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
      <p>
        This item was changed by someone else since you opened it. Your changes were not saved. The stored version
        is:
      </p>
      {renderFields ? renderFields(current.fields) : <DefaultFields fields={current.fields} />}
      <LastModified
        lastModifiedBy={current.lastModifiedBy}
        lastModifiedAt={current.lastModifiedAt}
        members={members}
      />
      <div>
        <button type="button" onClick={() => onUseCurrent(current)}>
          Use stored version
        </button>
        {onDismiss && (
          <button type="button" onClick={onDismiss}>
            Keep editing
          </button>
        )}
      </div>
    </div>
  );
}
