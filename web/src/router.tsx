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

/** Hosted UI is mid-redirect; Amplify still needs `?code=` on this URL. */
function oauthReturnPending(): boolean {
  const { search } = window.location;
  return search.includes("code=") || search.includes("error=");
}

/**
 * The Hosted UI sign-in redirects back to `/`, which would drop a deep link such as an
 * invitation accept link. Call before auth to remember the path, and after auth to restore it.
 * The saved path stays until `clearDeepLink` (a successful accept, or leaving on purpose).
 * Opening the accept link used to save the path and then delete it on the same page, so
 * sign-in always landed on the trip list and Accept never ran.
 */
export function rememberDeepLink(): void {
  const { pathname } = window.location;
  if (pathname !== "/" && !oauthReturnPending()) {
    window.sessionStorage.setItem(RETURN_TO_KEY, pathname);
  }
}

/** Drops a remembered invite link so later visits to `/` stay on the trip list. */
export function clearDeepLink(): void {
  window.sessionStorage.removeItem(RETURN_TO_KEY);
}

/** True when this page, or the path saved across sign-in, is an invitation accept link. */
export function hasPendingInvite(): boolean {
  return currentInvitePath() !== undefined;
}

/**
 * Accept path to round-trip through the Hosted UI. Session storage alone is wiped by the
 * cross-site redirect, which is why sign-in was landing on the empty trip list.
 */
export function currentInvitePath(): string | undefined {
  const current = window.location.pathname;
  if (matchRoute(current).name === "acceptInvite") return current;
  const saved = window.sessionStorage.getItem(RETURN_TO_KEY);
  if (saved && matchRoute(saved).name === "acceptInvite") return saved;
  return undefined;
}

/** Stores an invite path that came back from the Hosted UI `state` parameter. */
export function rememberOAuthReturn(value: unknown): void {
  const path = invitePathFromOAuthState(value);
  if (path) window.sessionStorage.setItem(RETURN_TO_KEY, path);
}

/**
 * Amplify hex-encodes `customState`. Cognito sometimes hands that hex back still encoded,
 * so a plain path and one hex decoding are both accepted.
 */
export function invitePathFromOAuthState(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (matchRoute(value).name === "acceptInvite") return value;
  if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
    const decoded = value
      .match(/.{2}/g)!
      .map((byte) => String.fromCharCode(parseInt(byte, 16)))
      .join("");
    if (matchRoute(decoded).name === "acceptInvite") return decoded;
  }
  return undefined;
}

export function restoreDeepLink(): void {
  if (oauthReturnPending()) return;
  const saved = window.sessionStorage.getItem(RETURN_TO_KEY);
  if (!saved) return;
  if (matchRoute(saved).name === "notFound") {
    clearDeepLink();
    return;
  }
  if (saved === window.location.pathname) return;
  navigate(saved, { replace: true });
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
