import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Element to render; use "li" inside lists and "article" for standalone items. */
  as?: "div" | "section" | "article" | "li";
  title?: ReactNode;
  /** Heading level for `title` (default 3). */
  headingLevel?: 2 | 3 | 4;
  subtitle?: ReactNode;
  /** Buttons or badges at the top right. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Tighter padding for list items. */
  compact?: boolean;
  /** Hover elevation for clickable cards. */
  interactive?: boolean;
}

/** Surface with optional header (title, subtitle, actions), body, and footer. */
export function Card({
  as: Tag = "div",
  title,
  headingLevel = 3,
  subtitle,
  actions,
  footer,
  compact = false,
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  const Heading = `h${headingLevel}` as const;
  const hasHeader = title !== undefined || subtitle !== undefined || actions !== undefined;
  return (
    <Tag
      className={cx("ui-card", compact && "ui-card--compact", interactive && "ui-card--interactive", className)}
      {...rest}
    >
      {hasHeader && (
        <div className="ui-card__header">
          <div className="ui-card__heading">
            {title !== undefined && <Heading className="ui-card__title">{title}</Heading>}
            {subtitle !== undefined && <p className="ui-card__subtitle">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      {children !== undefined && children !== null && <div className="ui-card__body">{children}</div>}
      {footer !== undefined && <div className="ui-card__footer">{footer}</div>}
    </Tag>
  );
}
