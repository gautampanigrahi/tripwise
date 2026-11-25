import { cx } from "./cx";

export type ScoreTone = "accent" | "success" | "warning" | "danger";

/** Default tone for a 0–100 score: >= 80 success, >= 50 warning, otherwise danger. */
export function scoreTone(score: number): ScoreTone {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

export interface ScoreRingProps {
  /** Feasibility_Score, 0–100 (clamped). */
  value: number;
  /** Text under the number, e.g. "Feasible". */
  label?: string;
  /** Diameter in px (default 96). */
  size?: number;
  /** Ring thickness in px (default size / 10). */
  strokeWidth?: number;
  /** Defaults to `scoreTone(value)`. */
  tone?: ScoreTone;
  className?: string;
}

/** Circular score with the number and label in the center. Exposed as one image to screen readers. */
export function ScoreRing({ value, label, size = 96, strokeWidth, tone, className }: ScoreRingProps) {
  const score = Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : 0;
  const stroke = strokeWidth ?? Math.max(4, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const ariaLabel = `Feasibility score ${score} out of 100${label ? `, ${label}` : ""}`;
  return (
    <div
      className={cx("score-ring", `score-ring--${tone ?? scoreTone(score)}`, className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="score-ring__track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="score-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-ring__center" aria-hidden="true">
        <span className="score-ring__number" style={{ fontSize: Math.round(size * 0.28) }}>
          {score}
        </span>
        {label && <span className="score-ring__label">{label}</span>}
      </div>
    </div>
  );
}
