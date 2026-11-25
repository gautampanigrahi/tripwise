import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "../router";
import { ChevronRightIcon } from "./icons";

export interface Crumb {
  label: string;
  /** Path to link to; omit for the current page. */
  to?: string;
}

interface BreadcrumbsState {
  crumbs: readonly Crumb[];
  setCrumbs: (crumbs: readonly Crumb[]) => void;
}

const BreadcrumbsContext = createContext<BreadcrumbsState>({ crumbs: [], setCrumbs: () => undefined });

/** Holds the crumbs the current page sets with `useBreadcrumbs`. Mount once in the app shell. */
export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<readonly Crumb[]>([]);
  return <BreadcrumbsContext.Provider value={{ crumbs, setCrumbs }}>{children}</BreadcrumbsContext.Provider>;
}

/**
 * Sets the crumbs after the root "Trips" crumb while the calling page is mounted,
 * e.g. `useBreadcrumbs([{ label: trip.name, to: tripPath(id) }, { label: "Lodging" }])`.
 * Cleared on unmount.
 */
export function useBreadcrumbs(crumbs: readonly Crumb[]): void {
  const { setCrumbs } = useContext(BreadcrumbsContext);
  // Compare by content so callers can pass a fresh array literal every render.
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(JSON.parse(key) as Crumb[]);
  }, [key, setCrumbs]);
  useEffect(() => () => setCrumbs([]), [setCrumbs]);
}

/** Full trail: the "Trips" root followed by the page's crumbs. The last item is the current page. */
export function breadcrumbTrail(crumbs: readonly Crumb[]): Crumb[] {
  return [{ label: "Trips", to: "/" }, ...crumbs];
}

/** Breadcrumb navigation (Trips › Trip name › Tab) rendered by the app shell. */
export function Breadcrumbs() {
  const { crumbs } = useContext(BreadcrumbsContext);
  const trail = breadcrumbTrail(crumbs);
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {i > 0 && <ChevronRightIcon size={14} className="breadcrumbs__sep" />}
              {last || !c.to ? (
                <span aria-current={last ? "page" : undefined} title={c.label}>
                  {c.label}
                </span>
              ) : (
                <Link to={c.to}>{c.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
