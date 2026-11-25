import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  const [stored, setStored] = useState<TripConstraints | null | undefined>(constraintsProp);
  const [loadError, setLoadError] = useState<string>();
  const [catalog, setCatalog] = useState<Catalog | undefined>(catalogProp);
  const [catalogError, setCatalogError] = useState<string>();
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
  }, [client, tripId, constraintsProp]);

  useEffect(() => {
    if (catalogProp) {
      setCatalog(catalogProp);
      return;
    }
    let cancelled = false;
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
  }, [client, catalogProp]);

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
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const travelers = Number(form.travelerCount);
  const budgetNote =
    form.budgetType === "perPerson" && Number.isInteger(travelers) && travelers > 0 && form.budget.trim() !== ""
      ? `Total budget limit: $${form.budget.trim()} × ${travelers} travelers.`
      : undefined;

  return (
    <section aria-labelledby="constraints-heading">
      <h2 id="constraints-heading">Trip constraints</h2>
      {loadError && <p role="alert">Could not load the saved constraints: {loadError}</p>}
      {stored === undefined && !loadError && <p>Loading constraints…</p>}
      {stored === null && <p>No constraints saved yet.</p>}

      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Destination" error={errorFor("destination")}>
          <input value={form.destination} onChange={(e) => set("destination", e.target.value)} />
        </Field>
        <Field label="Start date" error={errorFor("startDate")}>
          <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        <Field label="End date" error={errorFor("endDate")}>
          <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
        <Field label="Travelers" error={errorFor("travelerCount")}>
          <input
            type="number"
            min={1}
            step={1}
            value={form.travelerCount}
            onChange={(e) => set("travelerCount", e.target.value)}
          />
        </Field>
        <Field label="Budget (USD)" error={errorFor("budget")}>
          <input
            inputMode="decimal"
            placeholder="2500.00"
            value={form.budget}
            onChange={(e) => set("budget", e.target.value)}
          />
        </Field>
        <fieldset>
          <legend>Budget type</legend>
          <label>
            <input
              type="radio"
              name="budgetType"
              checked={form.budgetType === "total"}
              onChange={() => set("budgetType", "total")}
            />{" "}
            Total for the group
          </label>
          <label>
            <input
              type="radio"
              name="budgetType"
              checked={form.budgetType === "perPerson"}
              onChange={() => set("budgetType", "perPerson")}
            />{" "}
            Per person
          </label>
          {budgetNote && <p>{budgetNote}</p>}
          {errorFor("budgetType") && <span role="alert" className="field-error"> {errorFor("budgetType")}</span>}
        </fieldset>

        <fieldset>
          <legend>Required features</legend>
          {featureOptions.length === 0 ? (
            <p>{catalogError ? `Could not load the Catalog: ${catalogError}` : "Loading features…"}</p>
          ) : (
            featureOptions.map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={form.requiredFeatures.includes(f)}
                  onChange={(e) => set("requiredFeatures", toggle(form.requiredFeatures, f, e.target.checked))}
                />{" "}
                {f}
              </label>
            ))
          )}
          {errorFor("requiredFeatures") && <span role="alert" className="field-error"> {errorFor("requiredFeatures")}</span>}
        </fieldset>

        <fieldset>
          <legend>Planned activities</legend>
          {catalogError ? (
            <p role="alert">Could not load the Catalog: {catalogError}</p>
          ) : !catalog ? (
            <p>Loading activities…</p>
          ) : (
            activities.map((a) => (
              <label key={a.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={form.plannedActivityIds.includes(a.id)}
                  onChange={(e) => set("plannedActivityIds", toggle(form.plannedActivityIds, a.id, e.target.checked))}
                />{" "}
                {a.name} · {formatEstimate(a.pricePerPerson, "person")}
              </label>
            ))
          )}
          {unknownActivityIds.length > 0 && (
            <p role="alert">
              Not in the Catalog: {unknownActivityIds.join(", ")}{" "}
              <button
                type="button"
                onClick={() =>
                  set(
                    "plannedActivityIds",
                    form.plannedActivityIds.filter((id) => !unknownActivityIds.includes(id)),
                  )
                }
              >
                Remove
              </button>
            </p>
          )}
          {errorFor("plannedActivityIds") && <span role="alert" className="field-error"> {errorFor("plannedActivityIds")}</span>}
        </fieldset>

        <Field label="Accessibility needs (comma separated)" error={errorFor("accessibilityNeeds")}>
          <input value={form.accessibilityNeeds} onChange={(e) => set("accessibilityNeeds", e.target.value)} />
        </Field>
        <Field label="Walking-distance limit (meters, optional)" error={errorFor("walkingDistanceLimitMeters")}>
          <input
            type="number"
            min={1}
            value={form.walkingDistanceLimitMeters}
            onChange={(e) => set("walkingDistanceLimitMeters", e.target.value)}
          />
        </Field>
        <Field label="Daily travel-time cap (minutes, optional)" error={errorFor("travelTimeCapMinutes")}>
          <input
            type="number"
            min={1}
            step={1}
            value={form.travelTimeCapMinutes}
            onChange={(e) => set("travelTimeCapMinutes", e.target.value)}
          />
        </Field>

        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">Constraints saved.</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save constraints"}
        </button>
        {stored && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setForm(formFromConstraints(stored));
              setFieldErrors([]);
              setError(undefined);
              setSaved(false);
            }}
          >
            Reset
          </button>
        )}
      </form>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error: string; children: ReactNode }) {
  return (
    <div>
      <label>
        {label} {children}
      </label>
      {error && <span role="alert" className="field-error"> {error}</span>}
    </div>
  );
}
