import type { ReactNode } from "react";
import { cx } from "./cx";

/** `pass`/`fail` are aliases of `success`/`danger`. */
export type ProgressTone = "accent" | "success" | "warning" | "danger" | "pass" | "fail";

const TONE_CLASS: Record<ProgressTone, string> = {
  accent: "accent",
  success: "success",
  pass: "success",
  warning: "warning",
  danger: "danger",
  fail: "danger",
};

/** Percentage of `value` against `max`, clamped to 0..100. Returns 0 for a non-positive or invalid max. */
export function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: ProgressTone;
  /** Accessible name; also shown above the bar unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  /** Text shown on the right of the header and used as `aria-valuetext` (e.g. "$1,200 of $1,500"). */
  valueText?: ReactNode;
  className?: string;
}

/** Horizontal bar showing `value` against `max`. A `value` above `max` fills the bar. */
export function ProgressBar({
  value,
  max = 100,
  tone = "accent",
  label,
  hideLabel = false,
  valueText,
  className,
}: ProgressBarProps) {
  const pct = percentOf(value, max);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  const ariaValueText = typeof valueText === "string" ? valueText : `${Math.round(pct)}%`;
  return (
    <div className={cx("progress", `progress--${TONE_CLASS[tone]}`, className)}>
      {(!hideLabel || valueText !== undefined) && (
        <div className="progress__header">
          {!hideLabel && <span className="progress__label">{label}</span>}
          {valueText !== undefined && <span className="progress__value">{valueText}</span>}
        </div>
      )}
      <div
        className="progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        aria-valuetext={ariaValueText}
      >
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
