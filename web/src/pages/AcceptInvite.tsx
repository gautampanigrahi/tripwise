import { useState } from "react";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { acceptInvitation, describeApiError } from "../api/trips";
import { Link, navigate, tripPath } from "../router";

/** Accepts an invitation for the signed-in User (Req 3.3); shows the 403 mismatch case (Req 3.5). */
export function AcceptInvite({ inviteId }: { inviteId: string }) {
  const client = useApiClient();
  const [status, setStatus] = useState<"idle" | "accepting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setStatus("accepting");
    setError(null);
    try {
      const { tripId } = await acceptInvitation(client, inviteId);
      navigate(tripPath(tripId), { replace: true });
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.status === 403) {
        setError("This invitation was sent to a different email address than the one you signed in with.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("This invitation has already been accepted.");
      } else {
        setError(describeApiError(err));
      }
    }
  };

  return (
    <section>
      <h2>Trip invitation</h2>
      <p>You have been invited to join a trip on TripWise.</p>
      <button type="button" onClick={() => void accept()} disabled={status === "accepting"}>
        {status === "accepting" ? "Accepting…" : "Accept invitation"}
      </button>
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to="/">Back to your trips</Link>
      </p>
    </section>
  );
}
