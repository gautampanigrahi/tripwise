import { afterEach, describe, expect, it } from "vitest";
import { clearDeepLink, invitePathFromOAuthState, rememberDeepLink, rememberOAuthReturn, restoreDeepLink } from "./router";

/**
 * Minimal `window` so the deep-link helpers can run under the node test environment.
 * `navigate` writes the path through `history.replaceState`.
 */
function installWindow(href: string): { path: () => string; stored: () => string | null } {
  const url = new URL(href);
  const store = new Map<string, string>();
  const win = {
    location: {
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
    history: {
      replaceState: (_data: unknown, _title: string, path: string) => {
        const next = new URL(path, url.origin);
        url.pathname = next.pathname;
        url.search = next.search;
      },
      pushState: (_data: unknown, _title: string, path: string) => {
        const next = new URL(path, url.origin);
        url.pathname = next.pathname;
        url.search = next.search;
      },
    },
    dispatchEvent: () => true,
  };
  Object.assign(globalThis, { window: win });
  return {
    path: () => url.pathname,
    stored: () => store.get("tripwise.returnTo") ?? null,
  };
}

describe("invite deep link", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("keeps the accept path while that page is open, including across the Hosted UI return", () => {
    const accept = "/invitations/eb4c024a-c2e4-4076-ac31-596ac3466ddc/accept";
    const page = installWindow(`https://d1546nh5ptic1n.cloudfront.net${accept}`);
    rememberDeepLink();
    restoreDeepLink();
    expect(page.stored()).toBe(accept);
    expect(page.path()).toBe(accept);

    const callback = installWindow("https://d1546nh5ptic1n.cloudfront.net/?code=abc&state=xyz");
    window.sessionStorage.setItem("tripwise.returnTo", accept);
    rememberDeepLink();
    restoreDeepLink();
    expect(window.sessionStorage.getItem("tripwise.returnTo")).toBe(accept);
    expect(callback.path()).toBe("/");
  });

  it("returns to the accept path once the code is gone, and stays there until the invite is cleared", () => {
    const accept = "/invitations/invite-1/accept";
    const home = installWindow("https://d1546nh5ptic1n.cloudfront.net/");
    window.sessionStorage.setItem("tripwise.returnTo", accept);
    restoreDeepLink();
    expect(home.path()).toBe(accept);
    expect(home.stored()).toBe(accept);

    clearDeepLink();
    expect(home.stored()).toBeNull();
  });

  it("reads the invite path back from the Hosted UI state, including the hex form", () => {
    const accept = "/invitations/invite-1/accept";
    const hex = accept
      .split("")
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
    expect(invitePathFromOAuthState(accept)).toBe(accept);
    expect(invitePathFromOAuthState(hex)).toBe(accept);
    expect(invitePathFromOAuthState("/trips")).toBeUndefined();

    const home = installWindow("https://d1546nh5ptic1n.cloudfront.net/");
    rememberOAuthReturn(hex);
    restoreDeepLink();
    expect(home.path()).toBe(accept);
  });

  it("drops a remembered path the app cannot route", () => {
    installWindow("https://d1546nh5ptic1n.cloudfront.net/");
    window.sessionStorage.setItem("tripwise.returnTo", "/nope");
    restoreDeepLink();
    expect(window.sessionStorage.getItem("tripwise.returnTo")).toBeNull();
  });
});
