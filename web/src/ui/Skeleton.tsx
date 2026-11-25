import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface SkeletonProps {
  /** "text" lines (default), a "rect" block, or a "circle". */
  variant?: "text" | "rect" | "circle";
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  /** For "text": number of lines (the last one is shorter). */
  lines?: number;
  className?: string;
}

/**
 * Loading placeholder. Hidden from screen readers; put a `role="status"` label
 * (e.g. "Loading trips…") on the surrounding container.
 */
export function Skeleton({ variant = "text", width, height, lines = 1, className }: SkeletonProps) {
  if (variant === "text" && lines > 1) {
    return (
      <span className={cx("skeleton-lines", className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skeleton skeleton--text" style={{ width }} />
        ))}
      </span>
    );
  }
  const size = variant === "circle" ? (width ?? height ?? 32) : undefined;
  const style: CSSProperties =
    variant === "circle"
      ? { width: size, height: size }
      : { width: width ?? "100%", height: height ?? (variant === "rect" ? 80 : undefined) };
  return <span className={cx("skeleton", `skeleton--${variant}`, className)} style={style} aria-hidden="true" />;
}

export interface SkeletonCardProps {
  /** Number of text lines under the title (default 3). */
  lines?: number;
  className?: string;
}

/** Card-shaped placeholder: a title bar plus a few text lines. */
export function SkeletonCard({ lines = 3, className }: SkeletonCardProps) {
  return (
    <div className={cx("ui-card", "skeleton-card", className)} aria-hidden="true">
      <Skeleton variant="rect" height={18} width="55%" />
      <Skeleton lines={lines} />
    </div>
  );
}
