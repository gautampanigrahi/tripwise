import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem<Id extends string = string> {
  id: Id;
  label: ReactNode;
  disabled?: boolean;
}

/** DOM ids shared by a tab and its panel. */
export function tabIds(idPrefix: string, tabId: string): { tab: string; panel: string } {
  const safe = tabId.replace(/[^A-Za-z0-9_-]/g, "_");
  return { tab: `${idPrefix}-tab-${safe}`, panel: `${idPrefix}-panel-${safe}` };
}

/**
 * Index to move to for a navigation key, skipping disabled tabs and wrapping around.
 * Returns `current` for keys it does not handle or when no other tab is enabled.
 */
export function nextTabIndex(current: number, key: string, disabled: readonly boolean[]): number {
  const count = disabled.length;
  if (count === 0) return current;
  const enabled = (i: number) => !disabled[i];
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= count; n++) {
      const i = (((from + dir * n) % count) + count) % count;
      if (enabled(i)) return i;
    }
    return current;
  };
  switch (key) {
    case "ArrowRight":
      return step(current, 1);
    case "ArrowLeft":
      return step(current, -1);
    case "Home":
      return step(-1, 1);
    case "End":
      return step(count, -1);
    default:
      return current;
  }
}

const NAV_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export interface TabsProps<Id extends string = string> {
  tabs: readonly TabItem<Id>[];
  /** Selected tab id. */
  value: Id;
  onChange: (id: Id) => void;
  /** Accessible name for the tab list, e.g. "Trip sections". */
  label: string;
  /** Prefix for the tab and panel ids; must match the `TabPanel`s (default "tabs"). */
  idPrefix?: string;
  className?: string;
}

/**
 * Tab list with roving tabindex: only the selected tab is in the tab order; Left/Right
 * arrows, Home, and End move focus and select (automatic activation).
 */
export function Tabs<Id extends string = string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix = "tabs",
  className,
}: TabsProps<Id>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const next = nextTabIndex(
      index,
      e.key,
      tabs.map((t) => Boolean(t.disabled)),
    );
    const tab = tabs[next];
    if (!tab || next === index) return;
    refs.current[next]?.focus();
    onChange(tab.id);
  };

  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal" className={cx("tabs", className)}>
      {tabs.map((t, i) => {
        const ids = tabIds(idPrefix, t.id);
        const selected = i === selectedIndex;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={ids.tab}
            className="tabs__tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Same prefix passed to `Tabs`. */
  idPrefix?: string;
  /** Id of the tab this panel belongs to. */
  tabId: string;
  /** When false the panel is rendered `hidden` (keeps its state). Omit when rendering only the active panel. */
  active?: boolean;
}

/** `role="tabpanel"` labelled by its tab. Focusable so keyboard users can move into it. */
export function TabPanel({ idPrefix = "tabs", tabId, active = true, className, children, ...rest }: TabPanelProps) {
  const ids = tabIds(idPrefix, tabId);
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={0}
      hidden={!active}
      className={cx("tab-panel", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
