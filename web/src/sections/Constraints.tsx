import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  formatEstimate,
  validateConstraints,
  type BudgetType,
  type Catalog,
  type ConstraintsInput,
  type FieldError,
  type TripConstraints,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { getCatalog } from "../api/catalog";
import { putConstraints } from "../api/checks";
import { describeApiError, getConstraints } from "../api/trips";
import { Button, Card, Checkbox, ErrorState, LoadingState, Skeleton, TextInput, cx, useToast } from "../ui";
import "./Constraints.css";

export interface ConstraintsProps {
  tripId: string;
  /** Called after a successful save so the page can refetch. */
  onChanged: () => void | Promise<void>;
  /**
   * Stored Trip_Constraints from the page load (`null` when none are saved).
   * Fetched from `GET /trips/{tripId}/constraints` when omitted.
   */
  constraints?: TripConstraints | null;
  /** Optional preloaded Catalog; fetched from `GET /catalog` when omitted. */
  catalog?: Catalog;
}

/** Form state; inputs stay as strings until submit. */
interface ConstraintsForm {
  destination: string;
  startDate: string;
  endDate: string;
  travelerCount: string;
  budget: string;
  budgetType: BudgetType;
  requiredFeatures: string[];
  plannedActivityIds: string[];
  accessibilityNeeds: string;
  walkingDistanceLimitMeters: string;
  travelTimeCapMinutes: string;
}

const EMPTY_FORM: ConstraintsForm = {
  destination: "San Diego",
  startDate: "",
  endDate: "",
  travelerCount: "",
  budget: "",
  budgetType: "total",
  requiredFeatures: [],
  plannedActivityIds: [],
  accessibilityNeeds: "",
  walkingDistanceLimitMeters: "",
  travelTimeCapMinutes: "",
};

function centsToDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function formFromConstraints(c: TripConstraints): ConstraintsForm {
  return {
    destination: c.destination,
    startDate: c.startDate,
    endDate: c.endDate,
    travelerCount: String(c.travelerCount),
    budget: centsToDollars(c.budgetCents),
    budgetType: c.budgetType,
    requiredFeatures: [...c.requiredFeatures],
    plannedActivityIds: [...c.plannedActivityIds],
    accessibilityNeeds: c.accessibilityNeeds.join(", "),
    walkingDistanceLimitMeters:
      c.walkingDistanceLimitMeters === undefined ? "" : String(c.walkingDistanceLimitMeters),
    travelTimeCapMinutes: c.travelTimeCapMinutes === undefined ? "" : String(c.travelTimeCapMinutes),
  };
}

/** Empty -> undefined (so "required" errors read naturally); non-numeric -> NaN (rejected by the schema). */
function toNumber(s: string): number | undefined {
  const t = s.trim();
  return t === "" ? undefined : Number(t);
}

/** Builds a `ConstraintsSchema` input. `budget` stays a dollar string; the schema converts it to cents. */
function inputFromForm(form: ConstraintsForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    destination: form.destination,
    startDate: form.startDate,
    endDate: form.endDate,
    travelerCount: toNumber(form.travelerCount),
    budget: form.budget.trim(),
    budgetType: form.budgetType,
    requiredFeatures: form.requiredFeatures,
    plannedActivityIds: form.plannedActivityIds,
    accessibilityNeeds: form.accessibilityNeeds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  };
  const walk = toNumber(form.walkingDistanceLimitMeters);
  if (walk !== undefined) out.walkingDistanceLimitMeters = walk;
  const cap = toNumber(form.travelTimeCapMinutes);
  if (cap !== undefined) out.travelTimeCapMinutes = cap;
  return out;
}

function toggle(list: readonly string[], value: string, on: boolean): string[] {
  return on ? (list.includes(value) ? [...list] : [...list, value]) : list.filter((v) => v !== value);
}

export function Constraints({ tripId, onChanged, constraints: constraintsProp, catalog: catalogProp }: ConstraintsProps) {
  const client = useApiClient();
  const toast = useToast();
  const [stored, setStored] = useState<TripConstraints | null | undefined>(constraintsProp);
  const [loadError, setLoadError] = useState<string>();
  const [catalog, setCatalog] = useState<Catalog | undefined>(catalogProp);
  const [catalogError, setCatalogError] = useState<string>();
  // Bumped by Retry to run the constraints or Catalog fetch again.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [form, setForm] = useState<ConstraintsForm>(constraintsProp ? formFromConstraints(constraintsProp) : EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Stored constraints: use the prop when given, otherwise fetch.
  useEffect(() => {
    if (constraintsProp !== undefined) {
      setStored(constraintsProp);
      setForm(constraintsProp ? formFromConstraints(constraintsProp) : EMPTY_FORM);
      return;
    }
    let cancelled = false;
    setLoadError(undefined);
    getConstraints(client, tripId)
      .then((c) => {
        if (cancelled) return;
        setStored(c);
        setForm(c ? formFromConstraints(c) : EMPTY_FORM);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, tripId, constraintsProp, loadAttempt]);

  useEffect(() => {
    if (catalogProp) {
      setCatalog(catalogProp);
      return;
    }
    let cancelled = false;
    setCatalogError(undefined);
    getCatalog(client)
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCatalogError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, catalogProp, catalogAttempt]);

  /** Features offered by any Catalog stay, plus any already required that the Catalog no longer lists. */
  const featureOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of catalog?.stays ?? []) for (const f of Object.keys(s.features)) set.add(f);
    for (const f of form.requiredFeatures) set.add(f);
    return [...set].sort();
  }, [catalog, form.requiredFeatures]);

  const activities = catalog?.activities ?? [];
  const unknownActivityIds = form.plannedActivityIds.filter((id) => catalog && !activities.some((a) => a.id === id));

  const errorFor = (field: string) =>
    fieldErrors
      .filter((e) => e.field === field || e.field.startsWith(`${field}.`))
      .map((e) => e.message)
      .join("; ");

  function set<K extends keyof ConstraintsForm>(key: K, value: ConstraintsForm[K]) {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = inputFromForm(form);
    const result = validateConstraints(input);
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError("Please fix the highlighted fields.");
      setSaved(false);
      toast.error("Some fields need attention.");
      return;
    }
    setBusy(true);
    setFieldErrors([]);
    setError(undefined);
    try {
      // Send the schema input (budget in dollars); the server re-validates and stores cents.
      const next = await putConstraints(client, tripId, input as ConstraintsInput);
      setStored(next && typeof next === "object" && "budgetCents" in next ? next : result.value);
      setSaved(true);
      toast.success("Constraints saved.");
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const fields = (err.body as { fields?: FieldError[] } | undefined)?.fields;
        if (Array.isArray(fields)) {
          setFieldErrors(fields);
          setError("Please fix the highlighted fields.");
          return;
        }
      }
      const message = describeApiError(err);
      setError(message);
      toast.error(`Could not save the constraints: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  const travelers = Number(form.travelerCount);
  const budgetNote =
    form.budgetType === "perPerson" && Number.isInteger(travelers) && travelers > 0 && form.budget.trim() !== ""
      ? `Total budget limit: $${form.budget.trim()} × ${travelers} travelers.`
      : undefined;

  const loading = stored === undefined && !loadError;
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(stored ? formFromConstraints(stored) : EMPTY_FORM),
    [form, stored],
  );

  return (
    <section className="constraints" aria-labelledby="constraints-heading">
      <header className="constraints__header">
        <h2 id="constraints-heading">Trip constraints</h2>
        <p className="constraints__muted">
          The feasibility checks compare your stay, activities, and schedule against these limits.
        </p>
      </header>
      {loadError && (
        <ErrorState
          title="Could not load the saved constraints"
          message={loadError}
          onRetry={() => setLoadAttempt((n) => n + 1)}
        />
      )}
      {loading && <LoadingState label="Loading constraints…" cards={3} />}
      {stored === null && (
        <p className="alert alert--warning">No constraints saved yet. Fill in the form and save to enable checks.</p>
      )}

      {!loading && (
      <form className="constraints__form" onSubmit={(e) => void submit(e)} noValidate>
        <Card as="section" title="Trip basics" headingLevel={3} className="constraints__card">
          <div className="constraints__grid">
            <TextInput
              label="Destination"
              value={form.destination}
              onChange={(e) => set("destination", e.target.value)}
              error={errorFor("destination")}
            />
            <TextInput
              label="Travelers"
              type="number"
              min={1}
              step={1}
              value={form.travelerCount}
              onChange={(e) => set("travelerCount", e.target.value)}
              error={errorFor("travelerCount")}
            />
            <TextInput
              label="Start date"
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              error={errorFor("startDate")}
            />
            <TextInput
              label="End date"
              type="date"
              value={form.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              error={errorFor("endDate")}
            />
          </div>
        </Card>

        <Card as="section" title="Budget" headingLevel={3} className="constraints__card">
          <div className="constraints__grid">
            <TextInput
              label="Budget (USD)"
              inputMode="decimal"
              placeholder="2500.00"
              value={form.budget}
              onChange={(e) => set("budget", e.target.value)}
              error={errorFor("budget")}
            />
            <fieldset className="constraints__segmented" aria-invalid={errorFor("budgetType") ? true : undefined}>
              <legend className="field__label">Budget type</legend>
              <div className="constraints__segments">
                <label className={cx("constraints__segment", form.budgetType === "total" && "constraints__segment--on")}>
                  <input
                    type="radio"
                    name="budgetType"
                    checked={form.budgetType === "total"}
                    onChange={() => set("budgetType", "total")}
                  />
                  Total for the group
                </label>
                <label
                  className={cx("constraints__segment", form.budgetType === "perPerson" && "constraints__segment--on")}
                >
                  <input
                    type="radio"
                    name="budgetType"
                    checked={form.budgetType === "perPerson"}
                    onChange={() => set("budgetType", "perPerson")}
                  />
                  Per person
                </label>
              </div>
              {errorFor("budgetType") && (
                <span role="alert" className="field-error">
                  {errorFor("budgetType")}
                </span>
              )}
            </fieldset>
          </div>
          {budgetNote && <p className="constraints__note">{budgetNote}</p>}
        </Card>

        <Card
          as="section"
          title="Stay requirements"
          subtitle="The Preferences check fails when the stay lacks any of these features."
          headingLevel={3}
          className="constraints__card"
        >
          <fieldset className="constraints__fieldset">
            <legend className="field__label">Required features</legend>
            {featureOptions.length === 0 ? (
              catalogError ? (
                <p className="field-error">Could not load the Catalog, so no features are listed.</p>
              ) : !catalog ? (
                <div role="status" aria-busy="true">
                  <span className="visually-hidden">Loading features…</span>
                  <Skeleton lines={2} width="60%" />
                </div>
              ) : (
                <p className="constraints__muted">The Catalog lists no stay features.</p>
              )
            ) : (
              <div className="constraints__features">
                {featureOptions.map((f) => (
                  <Checkbox
                    key={f}
                    label={f}
                    checked={form.requiredFeatures.includes(f)}
                    onChange={(e) => set("requiredFeatures", toggle(form.requiredFeatures, f, e.target.checked))}
                    fieldClassName={cx(
                      "constraints__chip",
                      form.requiredFeatures.includes(f) && "constraints__chip--on",
                    )}
                  />
                ))}
              </div>
            )}
            {errorFor("requiredFeatures") && (
              <span role="alert" className="field-error">
                {errorFor("requiredFeatures")}
              </span>
            )}
          </fieldset>
          <TextInput
            label="Accessibility needs"
            hint="Comma separated, e.g. step-free entry, ground floor"
            value={form.accessibilityNeeds}
            onChange={(e) => set("accessibilityNeeds", e.target.value)}
            error={errorFor("accessibilityNeeds")}
          />
        </Card>

        <Card
          as="section"
          title="Activities"
          subtitle={
            form.plannedActivityIds.length > 0
              ? `${form.plannedActivityIds.length} selected. Activity prices count toward the Cost check per traveler.`
              : "Activity prices count toward the Cost check per traveler."
          }
          headingLevel={3}
          className="constraints__card"
        >
          <fieldset className="constraints__fieldset">
            <legend className="visually-hidden">Planned activities</legend>
            {catalogError ? (
              <ErrorState
                compact
                headingLevel={4}
                title="Could not load the Catalog"
                message={catalogError}
                onRetry={() => setCatalogAttempt((n) => n + 1)}
              />
            ) : !catalog ? (
              <div role="status" aria-busy="true" className="constraints__activities">
                <span className="visually-hidden">Loading activities…</span>
                <Skeleton variant="rect" height={64} />
                <Skeleton variant="rect" height={64} />
              </div>
            ) : (
              <div className="constraints__activities">
                {activities.map((a) => {
                  const on = form.plannedActivityIds.includes(a.id);
                  return (
                    <label key={a.id} className={cx("constraints__activity", on && "constraints__activity--on")}>
                      <input
                        type="checkbox"
                        className="constraints__activity-input"
                        checked={on}
                        onChange={(e) =>
                          set("plannedActivityIds", toggle(form.plannedActivityIds, a.id, e.target.checked))
                        }
                      />
                      <span className="constraints__activity-name">{a.name}</span>
                      <span className="constraints__activity-price">{formatEstimate(a.pricePerPerson, "person")}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {unknownActivityIds.length > 0 && (
              <div role="alert" className="alert alert--danger constraints__unknown">
                <span>Not in the Catalog: {unknownActivityIds.join(", ")}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    set(
                      "plannedActivityIds",
                      form.plannedActivityIds.filter((id) => !unknownActivityIds.includes(id)),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            )}
            {errorFor("plannedActivityIds") && (
              <span role="alert" className="field-error">
                {errorFor("plannedActivityIds")}
              </span>
            )}
          </fieldset>
        </Card>

        <Card
          as="section"
          title="Limits"
          subtitle="Optional. Leave blank for no limit. The Schedule check runs only when a travel-time cap is set."
          headingLevel={3}
          className="constraints__card"
        >
          <div className="constraints__grid">
            <TextInput
              label="Walking-distance limit (meters)"
              type="number"
              min={1}
              value={form.walkingDistanceLimitMeters}
              onChange={(e) => set("walkingDistanceLimitMeters", e.target.value)}
              error={errorFor("walkingDistanceLimitMeters")}
            />
            <TextInput
              label="Daily travel-time cap (minutes)"
              type="number"
              min={1}
              step={1}
              value={form.travelTimeCapMinutes}
              onChange={(e) => set("travelTimeCapMinutes", e.target.value)}
              error={errorFor("travelTimeCapMinutes")}
            />
          </div>
        </Card>

        <div className="constraints__savebar">
          <div className="constraints__savebar-status" aria-live="polite">
            {error ? (
              <span role="alert" className="field-error">
                {error}
              </span>
            ) : saved ? (
              <span role="status" className="constraints__saved">
                Constraints saved.
              </span>
            ) : dirty ? (
              <span className="constraints__muted">Unsaved changes</span>
            ) : null}
          </div>
          <div className="constraints__savebar-actions">
            {stored && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setForm(formFromConstraints(stored));
                  setFieldErrors([]);
                  setError(undefined);
                  setSaved(false);
                }}
              >
                Reset
              </Button>
            )}
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save constraints"}
            </Button>
          </div>
        </div>
      </form>
      )}
    </section>
  );
}
