import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { CloseIcon } from "./icons";
import { IconButton } from "./Button";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Focusable descendants in tab order (skips hidden ones). */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  );
}

/** Number of open modals; body scroll is locked while > 0. */
let openModals = 0;

/**
 * Focus handling shared by Dialog and Drawer: saves the opener, moves focus inside,
 * locks body scroll, and on close returns focus to the opener.
 */
function useModalFocus(open: boolean, panelRef: RefObject<HTMLElement>, initialFocusRef?: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const target = initialFocusRef?.current ?? panel.querySelector<HTMLElement>("[data-autofocus]") ?? null;
      const first = target ?? focusableWithin(panel).find((el) => !el.dataset.overlayClose) ?? panel;
      first.focus();
    }
    openModals += 1;
    document.body.classList.add("has-modal");
    return () => {
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.body.classList.remove("has-modal");
      if (opener && opener.isConnected) opener.focus();
    };
    // Run only when `open` toggles; refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Keeps Tab/Shift+Tab inside `panel`; returns true when it handled the event. */
export function trapTab(e: KeyboardEvent<HTMLElement>, panel: HTMLElement): boolean {
  if (e.key !== "Tab") return false;
  const items = focusableWithin(panel);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons in the footer. */
  footer?: ReactNode;
  /** Element to focus on open; defaults to the first `[data-autofocus]`, then the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Close when the backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  /** Hide the header close (X) button. Escape still closes. */
  hideCloseButton?: boolean;
  className?: string;
}

interface OverlayFrameProps extends OverlayProps {
  kind: "dialog" | "drawer";
  panelClassName: string;
  role?: "dialog" | "alertdialog";
}

/** Portal, backdrop, focus trap, Escape, and labelled header shared by Dialog and Drawer. */
export function OverlayFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  closeOnBackdrop = true,
  hideCloseButton = false,
  className,
  kind,
  panelClassName,
  role = "dialog",
}: OverlayFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Only close on a click that both started and ended on the backdrop (not a drag out of an input).
  const pressedOnBackdrop = useRef(false);
  useModalFocus(open, panelRef, initialFocusRef);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Stop propagation so a nested overlay does not also close its parent
    // (React bubbles portal events through the component tree).
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (panelRef.current && trapTab(e, panelRef.current)) e.stopPropagation();
  };

  const onBackdropDown = (e: MouseEvent<HTMLDivElement>) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
    pressedOnBackdrop.current = false;
  };

  return createPortal(
    <div
      className={cx("overlay", `overlay--${kind}`)}
      onMouseDown={onBackdropDown}
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        className={cx(panelClassName, className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="overlay__header">
          <div>
            <h2 id={titleId} className="overlay__title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="overlay__description">
                {description}
              </p>
            )}
          </div>
          {!hideCloseButton && (
            <IconButton aria-label="Close" icon={<CloseIcon />} size="sm" onClick={onClose} data-overlay-close="true" />
          )}
        </div>
        {children !== undefined && children !== null && <div className="overlay__body">{children}</div>}
        {footer && <div className="overlay__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
