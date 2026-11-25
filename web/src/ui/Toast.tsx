import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { AlertCircleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "./icons";
import { IconButton } from "./Button";

export type ToastKind = "success" | "error" | "info";

export interface ToastOptions {
  kind?: ToastKind;
  message: ReactNode;
  /** Auto-dismiss delay in ms. Defaults: 4000 (success/info), 7000 (error). 0 keeps it until dismissed. */
  duration?: number;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => number;
  success: (message: ReactNode, duration?: number) => number;
  error: (message: ReactNode, duration?: number) => number;
  info: (message: ReactNode, duration?: number) => number;
  dismiss: (id: number) => void;
}

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: ReactNode;
  duration: number;
}

export const DEFAULT_TOAST_DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, error: 7000 };

/** Most toasts kept on screen; older ones are dropped first. */
const MAX_TOASTS = 4;

const noop: ToastApi = {
  show: () => -1,
  success: () => -1,
  error: () => -1,
  info: () => -1,
  dismiss: () => undefined,
};

// Default is a no-op so components still render (e.g. in isolated tests) without the provider.
const ToastContext = createContext<ToastApi>(noop);

/** Toast API from the nearest `ToastProvider` (no-op when there is none). */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/**
 * Holds toast state and renders the toast region. Mount once near the root.
 * The region is `aria-live="polite"`; error toasts also carry `role="alert"`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(({ kind = "info", message, duration }: ToastOptions) => {
    const id = nextId.current++;
    const entry: ToastEntry = { id, kind, message, duration: duration ?? DEFAULT_TOAST_DURATION[kind] };
    setToasts((list) => [...list, entry].slice(-MAX_TOASTS));
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (message, duration) => show({ kind: "success", message, duration }),
      error: (message, duration) => show({ kind: "error", message, duration }),
      info: (message, duration) => show({ kind: "info", message, duration }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite" aria-relevant="additions text" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircleIcon size={18} />,
  error: <AlertCircleIcon size={18} />,
  info: <InfoIcon size={18} />,
};

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.duration <= 0 || paused) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, paused, onDismiss]);

  return (
    <div
      className={cx("toast", `toast--${toast.kind}`)}
      role={toast.kind === "error" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        {ICONS[toast.kind]}
      </span>
      <div className="toast__message">{toast.message}</div>
      <IconButton aria-label="Dismiss notification" icon={<CloseIcon size={14} />} size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}
