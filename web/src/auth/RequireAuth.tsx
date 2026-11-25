import { useEffect, useState, type ReactNode } from "react";
import { Hub } from "aws-amplify/utils";
import { getIdToken as defaultGetIdToken, signIn as defaultSignIn } from "./amplify";

export interface RequireAuthProps {
  children: ReactNode;
  /** Injectable for tests; defaults to the Amplify session lookup. */
  getIdToken?: () => Promise<string | null>;
  /** Injectable for tests; defaults to the Hosted UI redirect. */
  onSignIn?: () => void | Promise<void>;
}

type Status = "loading" | "signedOut" | "signedIn";

/**
 * Renders the sign-in screen until a session exists (Req 1.1).
 * Children (and therefore any Trip data) are never rendered without a session.
 */
export function RequireAuth({
  children,
  getIdToken = defaultGetIdToken,
  onSignIn = defaultSignIn,
}: RequireAuthProps) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let active = true;
    const check = async () => {
      const token = await getIdToken();
      if (active) setStatus(token ? "signedIn" : "signedOut");
    };
    void check();
    const stop = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn" || payload.event === "signInWithRedirect") void check();
      if (payload.event === "signedOut") setStatus("signedOut");
    });
    return () => {
      active = false;
      stop();
    };
  }, [getIdToken]);

  if (status === "loading") return <p role="status">Loading…</p>;
  if (status === "signedOut") {
    return (
      <main>
        <h1>TripWise</h1>
        <p>Sign in to see your trips.</p>
        <button type="button" onClick={() => void onSignIn()}>
          Sign in
        </button>
      </main>
    );
  }
  return <>{children}</>;
}
