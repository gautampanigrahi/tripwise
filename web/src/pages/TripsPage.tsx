import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { validateTripInput } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createTrip, describeApiError, listTrips, validationErrors, type TripSummary } from "../api/trips";
import { Link, navigate, tripPath } from "../router";
import {
  AvatarStack,
  Badge,
  Button,
  ChevronRightIcon,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PlusIcon,
  TextInput,
  type AvatarStackPerson,
} from "../ui";
import "./TripsPage.css";

type Field = "name" | "destination" | "startDate" | "endDate";
const EMPTY: Record<Field, string> = { name: "", destination: "", startDate: "", endDate: "" };

/**
 * `GET /trips` returns only tripId, name, and role today. These extra fields are read
 * when the API includes them, and the card hides each one when it is absent.
 */
type TripCardData = TripSummary & {
  members?: Array<{ userId?: string; displayName?: string; email?: string }>;
  latestCheckResult?: { label?: string; score?: number };
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const DATE_FMT_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Jun 1 – Jun 5, 2025"; falls back to the raw ISO strings if they don't parse. */
export function formatTripDates(startDate: string, endDate: string): string {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) return `${startDate} – ${endDate}`;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return `${(sameYear ? DATE_FMT : DATE_FMT_YEAR).format(start)} – ${DATE_FMT_YEAR.format(end)}`;
}

/** Lists the caller's Trips (Req 2.4) and creates new ones (Req 2.1–2.3). */
export function TripsPage() {
  const client = useApiClient();
  const [trips, setTrips] = useState<TripCardData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setTrips(await listTrips(client));
    } catch (err) {
      setLoadError(describeApiError(err));
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const newTripButton = (
    <Button icon={<PlusIcon />} onClick={() => setCreating(true)}>
      New trip
    </Button>
  );

  return (
    <section className="trips-page" aria-labelledby="trips-heading">
      <header className="trips-page__header">
        <div>
          <h2 id="trips-heading" className="trips-page__title">
            Your trips
          </h2>
          <p className="trips-page__subtitle">Plan together, check feasibility, and keep everyone in sync.</p>
        </div>
        {trips !== null && trips.length > 0 && newTripButton}
      </header>

      {loadError && (
        <ErrorState
          title="We couldn't load your trips"
          message={loadError}
          onRetry={() => {
            setTrips(null);
            void load();
          }}
        />
      )}

      {trips === null && !loadError && <LoadingState label="Loading trips…" cards={3} layout="grid" />}

      {trips?.length === 0 && (
        <div className="trips-page__empty">
          <EmptyState
            title="No trips yet"
            description="You are not a member of any trips yet. Create one, or open an invitation link from a Host."
            action={newTripButton}
          />
        </div>
      )}

      {trips && trips.length > 0 && (
        <ul className="trips-grid" aria-label="Trips">
          {trips.map((t) => (
            <TripCard key={t.tripId} trip={t} />
          ))}
        </ul>
      )}

      <CreateTripDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}

function TripCard({ trip }: { trip: TripCardData }) {
  const people: AvatarStackPerson[] = (trip.members ?? [])
    .map((m) => ({ id: m.userId, name: m.displayName || m.email || "" }))
    .filter((p) => p.name);
  const label = trip.latestCheckResult?.label;
  return (
    <li className="trip-card">
      <Link to={tripPath(trip.tripId)} className="trip-card__link">
        <div className="trip-card__top">
          <h3 className="trip-card__name">{trip.name}</h3>
          {trip.role && (
            <Badge tone={trip.role === "host" ? "accent" : "neutral"}>
              {trip.role === "host" ? "Host" : "Member"}
            </Badge>
          )}
        </div>
        {trip.destination && <p className="trip-card__destination">{trip.destination}</p>}
        {trip.startDate && trip.endDate && (
          <p className="trip-card__dates">{formatTripDates(trip.startDate, trip.endDate)}</p>
        )}
        <div className="trip-card__bottom">
          {people.length > 0 ? <AvatarStack people={people} /> : <span />}
          <span className="trip-card__meta">
            {label && (
              <Badge tone={label === "Feasible" ? "pass" : "fail"} dot>
                {label}
              </Badge>
            )}
            <ChevronRightIcon className="trip-card__chevron" />
          </span>
        </div>
      </Link>
    </li>
  );
}

function CreateTripDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useApiClient();
  const formId = useId();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (saving) return;
    setValues(EMPTY);
    setErrors({});
    setSubmitError(null);
    onClose();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const result = validateTripInput(values);
    if (!result.ok) {
      setErrors(Object.fromEntries(result.errors.map((er) => [er.field, er.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const trip = await createTrip(client, result.value);
      navigate(tripPath(trip.tripId));
    } catch (err) {
      const fieldErrors = validationErrors(err);
      if (fieldErrors) setErrors(fieldErrors);
      else setSubmitError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const input = (field: Field, label: string, type = "text") => (
    <TextInput
      label={label}
      type={type}
      name={field}
      required
      value={values[field]}
      error={errors[field]}
      data-autofocus={field === "name" ? true : undefined}
      onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
    />
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create a trip"
      description="You'll be the Host. You can invite Members once the trip exists."
      closeOnBackdrop={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {saving ? "Creating…" : "Create trip"}
          </Button>
        </>
      }
    >
      <form id={formId} className="trip-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {input("name", "Trip name")}
        {input("destination", "Destination")}
        <div className="trip-form__dates">
          {input("startDate", "Start date", "date")}
          {input("endDate", "End date", "date")}
        </div>
        {submitError && (
          <p role="alert" className="alert alert--danger">
            {submitError}
          </p>
        )}
      </form>
    </Dialog>
  );
}
