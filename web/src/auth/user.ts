import { useEffect, useState } from "react";
import { Hub } from "aws-amplify/utils";
import { getIdToken as defaultGetIdToken } from "./amplify";

export interface CurrentUser {
  /** Cognito `sub`. */
  userId: string | null;
  email: string | null;
  /** `name`, else `given_name family_name`, else null. */
  name: string | null;
}

/**
 * Decodes a JWT payload (base64url JSON) without verifying it. Display use only:
 * the API Gateway authorizer verifies tokens. Returns null for malformed input.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Display fields from an ID token's claims. */
export function userFromIdToken(token: string): CurrentUser | null {
  const claims = decodeJwtPayload(token);
  if (!claims) return null;
  const given = [str(claims.given_name), str(claims.family_name)].filter(Boolean).join(" ");
  return {
    userId: str(claims.sub),
    email: str(claims.email),
    name: str(claims.name) ?? (given || null),
  };
}

/** The signed-in user's display fields, read from the current ID token (null until loaded). */
export function useCurrentUser(getIdToken: () => Promise<string | null> = defaultGetIdToken): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const token = await getIdToken();
      if (active) setUser(token ? userFromIdToken(token) : null);
    };
    void load();
    const stop = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn" || payload.event === "tokenRefresh") void load();
      if (payload.event === "signedOut") setUser(null);
    });
    return () => {
      active = false;
      stop();
    };
  }, [getIdToken]);
  return user;
}
