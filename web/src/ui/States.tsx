import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { EmptyState } from "./EmptyState";
import { AlertCircleIcon } from "./icons";
import { SkeletonCard } from "./Skeleton";

export interface ErrorStateProps {
  /** Short headline, e.g. "We couldn't load your trips". */
  title: ReactNode;
  /** The error text (usually from `describeApiError`). */
  message?: ReactNode;
  /** Shows a Retry button that calls this. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Spinner on the Retry button while a retry is in flight. */
  retrying?: boolean;
  /** Extra actions next to Retry, e.g. a "Back to your trips" link. */
  actions?: ReactNode;
  /** Less padding, for use inside cards and forms. */
  compact?: boolean;
  /** Heading level for the title (default 3). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** Friendly error with a Retry action. The wrapper is `role="alert"` so the failure is announced. */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Retry",
  retrying = false,
  actions,
  compact = false,
  headingLevel = 3,
  className,
}: ErrorStateProps) {
  const hasActions = Boolean(onRetry) || Boolean(actions);
  return (
    <div role="alert" className={cx("error-state", className)}>
      <EmptyState
        icon={<AlertCircleIcon size={22} />}
        title={title}
        description={message}
        compact={compact}
        headingLevel={headingLevel}
        action={
          hasActions ? (
            <div className="error-state__actions">
              {onRetry && (
                <Button variant="secondary" onClick={onRetry} loading={retrying}>
                  {retryLabel}
                </Button>
              )}
              {actions}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

export interface LoadingStateProps {
  /** Announced to screen readers, e.g. "Loading trips…". */
  label: string;
  /** Number of skeleton cards (default 2). */
  cards?: number;
  /** Text lines per skeleton card (default 2). */
  lines?: number;
  /** "stack" (default) puts cards in a column; "grid" lays them out like a card grid. */
  layout?: "stack" | "grid";
  className?: string;
}

/** Skeleton cards with a `role="status"` label; the shared loading state for data views. */
export function LoadingState({ label, cards = 2, lines = 2, layout = "stack", className }: LoadingStateProps) {
  return (
    <div role="status" aria-busy="true" className={cx("loading-state", `loading-state--${layout}`, className)}>
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}
