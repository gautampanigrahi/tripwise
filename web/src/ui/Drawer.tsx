import { OverlayFrame, type OverlayProps } from "./overlay";

export interface DrawerProps extends OverlayProps {
  /** Width: md 480px (default) or lg 640px. Always full width below 600px. */
  size?: "md" | "lg";
}

/**
 * Right-side panel for add and edit forms. Same accessibility as Dialog:
 * `role="dialog"`, `aria-modal`, labelled title, focus trap, Escape and backdrop close, focus restore.
 */
export function Drawer({ size = "md", ...props }: DrawerProps) {
  return <OverlayFrame {...props} kind="drawer" panelClassName={`drawer drawer--${size}`} />;
}
