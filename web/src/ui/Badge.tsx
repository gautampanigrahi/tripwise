import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** `pass`/`fail` are aliases of `success`/`danger` (design doc wording). */
export type BadgeTone = "neutral" | "accent" | "success" | "danger" | "warning" | "pass" | "fail";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "neutral",
  accent: "accent",
  success: "success",
  pass: "success",
  danger: "danger",
  fail: "danger",
  warning: "warning",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Shows a small colored dot before the text. */
  dot?: boolean;
  icon?: ReactNode;
}

/** Status or label pill. */
export function Badge({ tone = "neutral", dot = false, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("badge", `badge--${TONE_CLASS[tone]}`, className)} {...rest}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}
