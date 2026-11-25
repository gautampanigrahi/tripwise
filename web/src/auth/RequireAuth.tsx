import { useEffect, useState, type ReactNode } from "react";
import { Hub } from "aws-amplify/utils";
import { getIdToken as defaultGetIdToken, signIn as defaultSignIn } from "./amplify";
import { Button, LogoMark, SpinnerIcon } from "../ui";

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

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <p role="status" className="row text-muted">
          <SpinnerIcon /> Loading…
        </p>
      </div>
    );
  }
  if (status === "signedOut") {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1>
            <LogoMark size={32} className="topbar__logo" />
            TripWise
          </h1>
          <p>Plan group trips together and check that the plan works before you book.</p>
          <p>Sign in to see your trips.</p>
          <Button size="lg" block onClick={() => void onSignIn()}>
            Sign in
          </Button>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
