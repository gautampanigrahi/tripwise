import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** Minimal History API router (no dependencies). */

const NAVIGATE_EVENT = "tripwise:navigate";
const RETURN_TO_KEY = "tripwise.returnTo";

export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Current `location.pathname`, updated on pushState (via `navigate`) and back/forward. */
export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return path;
}

export type Route =
  | { name: "trips" }
  | { name: "trip"; tripId: string }
  | { name: "acceptInvite"; inviteId: string }
  | { name: "notFound" };

/** Maps a pathname to a route: `/`, `/trips/:tripId`, `/invitations/:inviteId/accept`. */
export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/trips") return { name: "trips" };
  const trip = /^\/trips\/([^/]+)$/.exec(path);
  if (trip?.[1]) return { name: "trip", tripId: decodeURIComponent(trip[1]) };
  const invite = /^\/invitations\/([^/]+)\/accept$/.exec(path);
  if (invite?.[1]) return { name: "acceptInvite", inviteId: decodeURIComponent(invite[1]) };
  return { name: "notFound" };
}

export const tripPath = (tripId: string) => `/trips/${encodeURIComponent(tripId)}`;
export const acceptInvitePath = (inviteId: string) =>
  `/invitations/${encodeURIComponent(inviteId)}/accept`;

/**
 * The Hosted UI sign-in redirects back to `/`, which would drop a deep link such as an
 * invitation accept link. Call before auth to remember the path, and after auth to restore it.
 */
export function rememberDeepLink(): void {
  const { pathname, search } = window.location;
  if (pathname !== "/" && !search.includes("code=")) {
    window.sessionStorage.setItem(RETURN_TO_KEY, pathname);
  }
}

export function restoreDeepLink(): void {
  const saved = window.sessionStorage.getItem(RETURN_TO_KEY);
  if (!saved) return;
  window.sessionStorage.removeItem(RETURN_TO_KEY);
  if (saved !== window.location.pathname && matchRoute(saved).name !== "notFound") {
    navigate(saved, { replace: true });
  }
}

/** Anchor that navigates with the History API on plain left-clicks. */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
