import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Catalog, ChecklistItem, ItineraryItem, LodgingItem } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { getCatalog } from "../api/catalog";
import { ApiError } from "../api/client";
import { describeApiError, inviteMember, loadTripPage, type TripPageData } from "../api/trips";
import { ChecksPanel } from "../checks/ChecksPanel";
import { Link, tripPath } from "../router";
import {
  AvatarStack,
  Button,
  Dialog,
  ErrorState,
  LoadingState,
  PlusIcon,
  Skeleton,
  TabPanel,
  Tabs,
  tabIds,
  TextInput,
  useBreadcrumbs,
  useToast,
} from "../ui";
import { Checklist } from "../sections/Checklist";
import { Constraints } from "../sections/Constraints";
import { Expenses, type ExpensesItem } from "../sections/Expenses";
import { GenericSection, type GenericItem } from "../sections/GenericSection";
import { Groceries, type GroceriesItem } from "../sections/Groceries";
import { Itinerary } from "../sections/Itinerary";
import { Lodging } from "../sections/Lodging";
import { countdownText, localToday, shortDate, tripCountdown, TripOverview } from "./TripOverview";
import "./TripPage.css";

const TABS = [
  "Overview",
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
const TAB_ITEMS = TABS.map((t) => ({ id: t, label: TAB_LABELS[t] ?? t }));
const TAB_ID_PREFIX = "trip";
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
  const [tab, setTab] = useState<Tab>("Overview");
  const [inviteOpen, setInviteOpen] = useState(false);
  // undefined: still loading; null: failed (tabs then fetch it themselves and show their own error).
  const [catalog, setCatalog] = useState<Catalog | null | undefined>(undefined);

  useBreadcrumbs(
    data
      ? [{ label: data.trip.name, to: tripPath(tripId) }, { label: TAB_LABELS[tab] ?? tab }]
      : [{ label: error ? "Trip" : "Loading…" }],
  );

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

  /**
   * Selects a tab from inside a panel (Overview quick actions, Checks "Go to …") and moves
   * focus to that tab, so keyboard focus is not lost with the panel that held the button.
   */
  const goToTab = useCallback((next: Tab) => {
    setTab(next);
    window.requestAnimationFrame(() => document.getElementById(tabIds(TAB_ID_PREFIX, next).tab)?.focus());
  }, []);
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

  if (loading && !data) {
    return (
      <article className="trip-page" aria-busy="true">
        <div className="trip-page__header trip-page__header--loading" aria-hidden="true">
          <Skeleton width="40%" height={28} />
          <Skeleton width="60%" />
        </div>
        <LoadingState label="Loading trip…" cards={3} lines={3} layout="grid" />
      </article>
    );
  }
  if (error || !data) {
    return (
      <article className="trip-page">
        <ErrorState
          headingLevel={2}
          title="We couldn't load this trip"
          message={error ?? "Trip not available."}
          onRetry={() => void load()}
          actions={<Link to="/">Back to your trips</Link>}
        />
      </article>
    );
  }

  const { trip, members, itemsBySection, constraints, checkResults } = data;
  const onChanged = load;
  const sharedCatalog = catalog ?? undefined;
  const countdown = tripCountdown(trip.startDate, trip.endDate, localToday());

  const renderTab = () => {
    if (NEEDS_CATALOG.has(tab) && catalog === undefined) return <LoadingState label="Loading Catalog…" />;
    switch (tab) {
      case "Overview":
        return (
          <TripOverview
            trip={trip}
            members={members}
            itemsBySection={itemsBySection}
            constraints={constraints}
            checkResults={checkResults}
            catalog={sharedCatalog}
            onNavigate={goToTab}
            onInvite={() => setInviteOpen(true)}
          />
        );
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
        return (
          <ChecksPanel
            tripId={tripId}
            onChanged={onChanged}
            results={checkResults}
            catalog={sharedCatalog}
            onNavigate={goToTab}
          />
        );
    }
  };

  return (
    <article className="trip-page">
      <header className="trip-page__header">
        <div className="trip-page__heading">
          <h2 className="trip-page__title">{trip.name}</h2>
          <p className="trip-page__meta">
            <span>{trip.destination}</span>
            <span aria-hidden="true">·</span>
            <span>
              <time dateTime={trip.startDate}>{shortDate(trip.startDate)}</time> to{" "}
              <time dateTime={trip.endDate}>{shortDate(trip.endDate)}</time>
            </span>
            <span className={`trip-page__countdown trip-page__countdown--${countdown.kind}`}>
              {countdownText(countdown)}
            </span>
          </p>
        </div>
        <div className="trip-page__header-actions">
          {members.length > 0 && (
            <AvatarStack
              people={members.map((m) => ({ id: m.userId, name: m.displayName || m.email }))}
              max={5}
              size="md"
              label={`Members: ${members
                .map((m) => `${m.displayName || m.email}${m.role === "host" ? " (Host)" : ""}`)
                .join(", ")}`}
            />
          )}
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
          <Button variant="ghost" onClick={() => void load()} loading={loading} disabled={loading}>
            {loading ? "Reloading…" : "Reload"}
          </Button>
        </div>
      </header>

      <InviteDialog tripId={trip.tripId} open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <Tabs
        tabs={TAB_ITEMS}
        value={tab}
        onChange={setTab}
        label="Trip sections"
        idPrefix={TAB_ID_PREFIX}
        className="trip-page__tabs"
      />
      <TabPanel idPrefix={TAB_ID_PREFIX} tabId={tab} className="trip-page__panel">
        {renderTab()}
      </TabPanel>
    </article>
  );
}

function InviteDialog({ tripId, open, onClose }: { tripId: string; open: boolean; onClose: () => void }) {
  const client = useApiClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setMessage(null);
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setMessage({ text: "Enter a valid email address.", ok: false });
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      await inviteMember(client, tripId, trimmed);
      setEmail("");
      const text = `Invitation sent to ${trimmed.toLowerCase()}.`;
      setMessage({ text, ok: true });
      toast.success(text);
    } catch (err) {
      setMessage({
        text:
          err instanceof ApiError && err.status === 403
            ? "Only the Host can invite people to this trip."
            : describeApiError(err),
        ok: false,
      });
    } finally {
      setSending(false);
    }
  };

  const formId = "trip-invite-form";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite a friend"
      description="They'll get an email with a link to join this trip."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form={formId} loading={sending}>
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} noValidate className="trip-page__invite-form">
        <TextInput
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={message && !message.ok ? message.text : undefined}
          data-autofocus
        />
        <p role="status" className={message?.ok ? "alert alert--success" : "visually-hidden"}>
          {message?.ok ? message.text : ""}
        </p>
      </form>
    </Dialog>
  );
}
