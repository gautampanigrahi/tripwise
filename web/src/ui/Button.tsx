import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { SpinnerIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy`, and disables the button. */
  loading?: boolean;
  /** Icon shown before the label (replaced by the spinner while loading). */
  icon?: ReactNode;
  /** Stretches to the container width. */
  block?: boolean;
}

/** Button with variants and a loading state. Defaults to `type="button"`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, block = false, className, disabled, type, children, ...rest },
  ref,
) {
  const iconSize = size === "lg" ? 18 : 16;
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cx("btn", `btn--${variant}`, `btn--${size}`, block && "btn--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <SpinnerIcon size={iconSize} />
      ) : (
        icon && <span className="btn__icon">{icon}</span>
      )}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Required accessible name, since the button has no visible text. */
  "aria-label": string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/** Square icon-only button. `aria-label` is required. Also used as the tooltip (`title`). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = "ghost", size = "md", loading = false, className, disabled, type, title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cx("btn", "btn--icon", `btn--${variant}`, `btn--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={title ?? rest["aria-label"]}
      {...rest}
    >
      {loading ? <SpinnerIcon size={size === "lg" ? 18 : 16} /> : icon}
    </button>
  );
});
