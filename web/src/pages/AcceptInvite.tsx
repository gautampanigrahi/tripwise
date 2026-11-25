import { useEffect, useRef, useState } from "react";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { acceptInvitation, describeApiError } from "../api/trips";
import { Link, navigate, tripPath } from "../router";
import { Button, CheckCircleIcon, EmptyState, ErrorState, useBreadcrumbs } from "../ui";
import "./TripsPage.css";

/** Delay before moving on to the Trip after a successful accept, so the success state is seen. */
const REDIRECT_DELAY_MS = 1500;

type Status = "idle" | "accepting" | "accepted" | "error";

/** Accepts an invitation for the signed-in User (Req 3.3); shows the 403 mismatch case (Req 3.5). */
export function AcceptInvite({ inviteId }: { inviteId: string }) {
  const client = useApiClient();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
  useBreadcrumbs([{ label: "Invitation" }]);

  useEffect(() => {
    if (status !== "accepted" || !tripId) return;
    successRef.current?.focus();
    const timer = window.setTimeout(() => navigate(tripPath(tripId), { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [status, tripId]);

  const accept = async () => {
    setStatus("accepting");
    setError(null);
    try {
      const result = await acceptInvitation(client, inviteId);
      setTripId(result.tripId);
      setStatus("accepted");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.status === 403) {
        setError({
          title: "This invitation is for someone else",
          message:
            "This invitation was sent to a different email address than the one you signed in with. Sign in with the invited email, or ask the Host to invite this address.",
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
  };

  const backLink = (
    <Link to="/" className="accept-invite__back">
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
        description="You have been invited to join a trip on TripWise. Accept to see the plan and start collaborating."
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
