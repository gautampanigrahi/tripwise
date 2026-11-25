import { useCallback, useEffect, useState, type FormEvent } from "react";
import { validateTripInput } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { createTrip, describeApiError, listTrips, validationErrors, type TripSummary } from "../api/trips";
import { Link, navigate, tripPath } from "../router";

type Field = "name" | "destination" | "startDate" | "endDate";
const EMPTY: Record<Field, string> = { name: "", destination: "", startDate: "", endDate: "" };

/** Lists the caller's Trips (Req 2.4) and creates new ones (Req 2.1–2.3). */
export function TripsPage() {
  const client = useApiClient();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <section>
      <h2>Your trips</h2>
      {loadError && <p role="alert">{loadError}</p>}
      {trips === null && !loadError && <p role="status">Loading trips…</p>}
      {trips?.length === 0 && <p>You are not a member of any trips yet.</p>}
      {trips && trips.length > 0 && (
        <ul>
          {trips.map((t) => (
            <li key={t.tripId}>
              <Link to={tripPath(t.tripId)}>{t.name}</Link>
              {t.destination && ` · ${t.destination}`}
              {t.startDate && t.endDate && ` · ${t.startDate} to ${t.endDate}`}
              {t.role === "host" && " · Host"}
            </li>
          ))}
        </ul>
      )}
      <CreateTripForm />
    </section>
  );
}

function CreateTripForm() {
  const client = useApiClient();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    <p>
      <label>
        {label}{" "}
        <input
          type={type}
          name={field}
          value={values[field]}
          aria-invalid={errors[field] ? true : undefined}
          onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
        />
      </label>
      {errors[field] && <span role="alert" className="field-error"> {errors[field]}</span>}
    </p>
  );

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <h3>Create a trip</h3>
      {input("name", "Trip name")}
      {input("destination", "Destination")}
      {input("startDate", "Start date", "date")}
      {input("endDate", "End date", "date")}
      {submitError && <p role="alert">{submitError}</p>}
      <button type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create trip"}
      </button>
    </form>
  );
}
