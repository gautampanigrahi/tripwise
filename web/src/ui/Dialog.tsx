import { useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { OverlayFrame, type OverlayProps } from "./overlay";

export interface DialogProps extends OverlayProps {
  /** Max width: sm 420px, md 560px (default), lg 760px. */
  size?: "sm" | "md" | "lg";
}

/**
 * Modal dialog rendered in a portal: `role="dialog"`, `aria-modal`, labelled by its title,
 * focus trapped inside, Escape and backdrop click call `onClose`, focus returns to the opener.
 */
export function Dialog({ size = "md", ...props }: DialogProps) {
  return <OverlayFrame {...props} kind="dialog" panelClassName={`dialog dialog--${size}`} />;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Explanation of what will happen, e.g. "This deletes the item for everyone on the trip." */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling for destructive actions (default true). */
  destructive?: boolean;
  /** Shows a spinner on the confirm button and disables both buttons. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before a destructive action. Focus starts on Cancel. Uses `role="alertdialog"`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <OverlayFrame
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={title}
      description={message}
      initialFocusRef={cancelRef}
      kind="dialog"
      panelClassName="dialog dialog--sm"
      role="alertdialog"
      hideCloseButton
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
