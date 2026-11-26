import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { acceptInvitation, describeApiError } from "../api/trips";
import { useCurrentUser } from "../auth/user";
import { clearDeepLink, Link, navigate, tripPath } from "../router";
import { Button, CheckCircleIcon, EmptyState, ErrorState, useBreadcrumbs } from "../ui";
import "./TripsPage.css";

/** Delay before moving on to the Trip after a successful accept, so the success state is seen. */
const REDIRECT_DELAY_MS = 1500;

type Status = "idle" | "accepting" | "accepted" | "error";

/** Accepts an invitation for the signed-in User (Req 3.3); shows the 403 mismatch case (Req 3.5). */
export function AcceptInvite({ inviteId }: { inviteId: string }) {
  const client = useApiClient();
  const user = useCurrentUser();
  const [status, setStatus] = useState<Status>("accepting");
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
  useBreadcrumbs([{ label: "Invitation" }]);
  const signedInAs = user?.email ?? "this account";
  const signedInAsRef = useRef(signedInAs);
  signedInAsRef.current = signedInAs;

  useEffect(() => {
    if (status !== "accepted" || !tripId) return;
    successRef.current?.focus();
    const timer = window.setTimeout(() => navigate(tripPath(tripId), { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [status, tripId]);

  const accept = useCallback(async () => {
    setStatus("accepting");
    setError(null);
    try {
      const result = await acceptInvitation(client, inviteId);
      clearDeepLink();
      setTripId(result.tripId);
      setStatus("accepted");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.status === 403) {
        setError({
          title: "This invitation is for someone else",
          message: `This invitation was sent to a different email than ${signedInAsRef.current}. Sign out, then sign in with the invited email.`,
        });
      } else if (err instanceof ApiError && err.status === 409) {
        setError({
          title: "Invitation already used",
          message: "This invitation has already been accepted.",
        });
      } else {
        setError({ title: "We couldn't accept the invitation", message: describeApiError(err) });
      }
    }
  }, [client, inviteId]);

  // Joining happens as soon as this page is shown signed-in. The button used to wait for a
  // second click, and that click never happened: sign-in returned to the trip list instead.
  useEffect(() => {
    void accept();
  }, [accept]);

  const backLink = (
    <Link to="/" className="accept-invite__back" onClick={() => clearDeepLink()}>
      Back to your trips
    </Link>
  );

  let content;
  if (status === "accepted" && tripId) {
    content = (
      <div ref={successRef} tabIndex={-1} role="status" className="accept-invite__state">
        <EmptyState
          icon={<CheckCircleIcon size={22} />}
          className="accept-invite__success"
          headingLevel={2}
          title="You're in!"
          description="You've joined the trip. Taking you there now…"
          action={
            <Link to={tripPath(tripId)} className="btn btn--primary btn--md">
              Go to the trip
            </Link>
          }
        />
      </div>
    );
  } else if (status === "error" && error) {
    content = (
      <ErrorState
        className="accept-invite__state"
        headingLevel={2}
        title={error.title}
        message={error.message}
        onRetry={() => void accept()}
        retryLabel="Try again"
        actions={backLink}
      />
    );
  } else {
    content = (
      <EmptyState
        headingLevel={2}
        title="Trip invitation"
        description={`You're signed in as ${signedInAs}. Joining this trip uses that account.`}
        action={
          <div className="accept-invite__actions">
            <Button onClick={() => void accept()} loading={status === "accepting"}>
              {status === "accepting" ? "Accepting…" : "Accept invitation"}
            </Button>
            {backLink}
          </div>
        }
      />
    );
  }

  return <section className="accept-invite">{content}</section>;
}
