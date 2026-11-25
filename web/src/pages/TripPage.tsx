import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Catalog, ChecklistItem, ItineraryItem, LodgingItem } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { getCatalog } from "../api/catalog";
import { ApiError } from "../api/client";
import { describeApiError, inviteMember, loadTripPage, type TripPageData } from "../api/trips";
import { ChecksPanel } from "../checks/ChecksPanel";
import { Link } from "../router";
import { Checklist } from "../sections/Checklist";
import { Constraints } from "../sections/Constraints";
import { Expenses, type ExpensesItem } from "../sections/Expenses";
import { GenericSection, type GenericItem } from "../sections/GenericSection";
import { Groceries, type GroceriesItem } from "../sections/Groceries";
import { Itinerary } from "../sections/Itinerary";
import { Lodging } from "../sections/Lodging";

const TABS = [
  "Lodging",
  "Itinerary",
  "Transportation",
  "Groceries",
  "Checklist",
  "Reservations",
  "Expenses",
  "ScratchPad",
  "Constraints",
  "Checks",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Partial<Record<Tab, string>> = { ScratchPad: "Scratch pad" };

/** Tabs whose components read the Catalog; they wait for the single page-level fetch. */
const NEEDS_CATALOG: ReadonlySet<Tab> = new Set<Tab>(["Lodging", "Constraints", "Checks"]);

/**
 * Trip page. Plan_Items, Trip_Constraints, and the Check_Result history are fetched from the
 * API on every mount (page load or browser reload), on "Reload", and after any successful
 * write in a tab (Req 23.1). The Catalog is fetched once and shared by the tabs that need it.
 */
export function TripPage({ tripId }: { tripId: string }) {
  const client = useApiClient();
  const [data, setData] = useState<TripPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("Lodging");
  // undefined: still loading; null: failed (tabs then fetch it themselves and show their own error).
  const [catalog, setCatalog] = useState<Catalog | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadTripPage(client, tripId));
    } catch (err) {
      setData(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [client, tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    getCatalog(client)
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (loading && !data) return <p role="status">Loading trip…</p>;
  if (error || !data) {
    return (
      <section>
        <p role="alert">{error ?? "Trip not available."}</p>
        <Link to="/">Back to your trips</Link>
      </section>
    );
  }

  const { trip, members, itemsBySection, constraints, checkResults } = data;
  const onChanged = load;
  const sharedCatalog = catalog ?? undefined;

  const renderTab = () => {
    if (NEEDS_CATALOG.has(tab) && catalog === undefined) return <p role="status">Loading catalog…</p>;
    switch (tab) {
      case "Lodging":
        return (
          <Lodging
            tripId={tripId}
            items={itemsBySection.Lodging as unknown as LodgingItem[]}
            members={members}
            onChanged={onChanged}
            catalog={sharedCatalog}
          />
        );
      case "Itinerary":
        return (
          <Itinerary
            tripId={tripId}
            trip={{ startDate: trip.startDate, endDate: trip.endDate }}
            items={itemsBySection.Itinerary as unknown as ItineraryItem[]}
            members={members}
            onChanged={onChanged}
          />
        );
      case "Groceries":
        return (
          <Groceries
            tripId={tripId}
            items={itemsBySection.Groceries as unknown as GroceriesItem[]}
            members={members}
            onChanged={onChanged}
          />
        );
      case "Checklist":
        return (
          <Checklist
            tripId={tripId}
            items={itemsBySection.Checklist as unknown as ChecklistItem[]}
            members={members}
            onChanged={onChanged}
          />
        );
      case "Expenses":
        return (
          <Expenses
            tripId={tripId}
            items={itemsBySection.Expenses as unknown as ExpensesItem[]}
            members={members}
            onChanged={onChanged}
          />
        );
      case "Transportation":
      case "Reservations":
      case "ScratchPad":
        return (
          <GenericSection
            key={tab}
            tripId={tripId}
            section={tab}
            heading={TAB_LABELS[tab] ?? tab}
            items={itemsBySection[tab] as unknown as GenericItem[]}
            members={members}
            onChanged={onChanged}
          />
        );
      case "Constraints":
        return <Constraints tripId={tripId} onChanged={onChanged} constraints={constraints} catalog={sharedCatalog} />;
      case "Checks":
        return <ChecksPanel tripId={tripId} onChanged={onChanged} results={checkResults} catalog={sharedCatalog} />;
    }
  };

  return (
    <article>
      <p>
        <Link to="/">← Your trips</Link>
      </p>
      <header>
        <h2>{trip.name}</h2>
        <p>
          {trip.destination} · {trip.startDate} to {trip.endDate}
        </p>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Reloading…" : "Reload"}
        </button>
      </header>

      {members.length > 0 && (
        <section>
          <h3>Members</h3>
          <ul>
            {members.map((m) => (
              <li key={m.userId}>
                {m.displayName || m.email}
                {m.role === "host" && " (Host)"}
              </li>
            ))}
          </ul>
        </section>
      )}
      <InviteForm tripId={trip.tripId} />

      <nav role="tablist" aria-label="Trip sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="trip-tabpanel"
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t] ?? t}
          </button>
        ))}
      </nav>
      <section role="tabpanel" id="trip-tabpanel" aria-labelledby={`tab-${tab}`}>
        {renderTab()}
      </section>
    </article>
  );
}

function InviteForm({ tripId }: { tripId: string }) {
  const client = useApiClient();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setMessage("Enter a valid email address.");
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      await inviteMember(client, tripId, trimmed);
      setEmail("");
      setMessage(`Invitation sent to ${trimmed.toLowerCase()}.`);
    } catch (err) {
      setMessage(
        err instanceof ApiError && err.status === 403
          ? "Only the Host can invite people to this trip."
          : describeApiError(err),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <h3>Invite a friend</h3>
      <label>
        Email{" "}
        <input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>{" "}
      <button type="submit" disabled={sending}>
        {sending ? "Sending…" : "Send invite"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
