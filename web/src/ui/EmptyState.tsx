import type { ReactNode } from "react";
import { cx } from "./cx";
import { InboxIcon } from "./icons";

export interface EmptyStateProps {
  /** Icon in the circle; defaults to an inbox. Pass `null` for none. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually a primary Button. */
  action?: ReactNode;
  /** Less padding, for use inside cards. */
  compact?: boolean;
  /** Heading level for the title (default 3). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** Friendly placeholder for an empty list, with an optional call to action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  const shownIcon = icon === undefined ? <InboxIcon size={22} /> : icon;
  return (
    <div className={cx("empty-state", compact && "empty-state--compact", className)}>
      {shownIcon !== null && (
        <span className="empty-state__icon" aria-hidden="true">
          {shownIcon}
        </span>
      )}
      <Heading className="empty-state__title">{title}</Heading>
      {description && <p className="empty-state__description">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
