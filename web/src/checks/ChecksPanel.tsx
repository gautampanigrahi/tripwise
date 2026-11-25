import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEstimate, type Catalog, type CheckOutcome, type CheckResult } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { getCatalog } from "../api/catalog";
import { runAlternative, runChecks } from "../api/checks";
import { describeApiError, latestStandardResult, listCheckResults } from "../api/trips";
import { AlternativeView } from "./AlternativeView";
import {
  explanationSourceText,
  formatRunAt,
  formatValue,
  outcomeDetails,
  scoreText,
  statusText,
  unitLabel,
} from "./format";

export interface ChecksPanelProps {
  tripId: string;
  /** Called after a check or alternative is saved so the page can refetch. */
  onChanged?: () => void | Promise<void>;
  /** Check_Result history, newest first, from the page load. Fetched from `GET /trips/{tripId}/checks` when omitted. */
  results?: readonly CheckResult[];
  /** Optional preloaded Catalog; fetched from `GET /catalog` when omitted. */
  catalog?: Catalog;
}

/** Label and failed list derived from the outcomes (Req 19.2, 19.3). */
function labelOf(outcomes: readonly CheckOutcome[]): { label: "Feasible" | "Not feasible"; failed: CheckOutcome[] } {
  const failed = outcomes.filter((o) => !o.passed);
  return { label: failed.length === 0 ? "Feasible" : "Not feasible", failed };
}

function sortNewestFirst(results: readonly CheckResult[]): CheckResult[] {
  return [...results].sort((a, b) => (a.runAt < b.runAt ? 1 : a.runAt > b.runAt ? -1 : 0));
}

/** Readable text for 422 responses from the checks routes (Req 13.5, 20.1). */
function describeCheckError(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) {
    const body = (err.body ?? {}) as { error?: string; missing?: string; activityId?: string; id?: string };
    if (body.error === "MISSING_INPUT") {
      if (body.missing === "Lodging") return "Add a Lodging stay before running checks.";
      if (body.missing === "TripConstraints") return "Save the trip constraints before running checks.";
      return `Missing input${body.missing ? `: ${body.missing}` : ""}.`;
    }
    if (body.error === "UNKNOWN_ACTIVITY") {
      const id = body.activityId ?? body.id;
      return `A planned activity is not in the Catalog${id ? ` (${id})` : ""}. Update the trip constraints.`;
    }
    if (body.error === "NO_BASE_RESULT") return "Run a standard check before trying an alternative stay.";
  }
  return describeApiError(err);
}

export function ChecksPanel({ tripId, onChanged, results: resultsProp, catalog: catalogProp }: ChecksPanelProps) {
  const client = useApiClient();
  const [history, setHistory] = useState<CheckResult[] | undefined>(
    resultsProp ? sortNewestFirst(resultsProp) : undefined,
  );
  const [catalog, setCatalog] = useState<Catalog | undefined>(catalogProp);
  const [catalogError, setCatalogError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [stayId, setStayId] = useState("");
  const [busy, setBusy] = useState<"check" | "alternative" | null>(null);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setHistory(await listCheckResults(client, tripId));
  }, [client, tripId]);

  useEffect(() => {
    if (resultsProp) {
      setHistory(sortNewestFirst(resultsProp));
      return;
    }
    let cancelled = false;
    listCheckResults(client, tripId)
      .then((r) => {
        if (!cancelled) setHistory(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, tripId, resultsProp]);

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

  const latestStandard = useMemo(() => latestStandardResult(history ?? []), [history]);
  const selected = useMemo(
    () => (selectedId ? history?.find((r) => r.checkId === selectedId) : undefined) ?? latestStandard,
    [history, selectedId, latestStandard],
  );

  /** Adds a fresh result to the local history, then lets the page refetch. */
  async function afterSave(result: CheckResult) {
    setHistory((h) => sortNewestFirst([result, ...(h ?? []).filter((r) => r.checkId !== result.checkId)]));
    setSelectedId(result.checkId);
    try {
      if (onChanged) await onChanged();
      else await refresh();
    } catch {
      // The saved result is already shown; a failed refetch is not fatal.
    }
  }

  async function run() {
    setBusy("check");
    setError(undefined);
    try {
      await afterSave(await runChecks(client, tripId));
    } catch (err) {
      setError(describeCheckError(err));
    } finally {
      setBusy(null);
    }
  }

  async function tryAlternative() {
    if (!stayId) return;
    setBusy("alternative");
    setError(undefined);
    try {
      await afterSave(await runAlternative(client, tripId, stayId));
    } catch (err) {
      setError(describeCheckError(err));
    } finally {
      setBusy(null);
    }
  }

  const stays = catalog?.stays ?? [];

  return (
    <section aria-labelledby="checks-heading">
      <h2 id="checks-heading">Feasibility checks</h2>

      <button type="button" onClick={() => void run()} disabled={busy !== null}>
        {busy === "check" ? "Running checks…" : "Run feasibility check"}
      </button>
      {error && <p role="alert">{error}</p>}

      {history === undefined && !error && <p>Loading check history…</p>}
      {history !== undefined && !selected && <p>No checks have been run yet.</p>}

      {selected &&
        (selected.kind === "alternative" ? (
          <AlternativeView alternative={selected} base={latestStandard} />
        ) : (
          <ResultView result={selected} isLatest={selected.checkId === latestStandard?.checkId} />
        ))}

      <div>
        <h3>Try an alternative stay</h3>
        <p>Runs the same checks with a Catalog stay in place of your current lodging. Your plan is not changed.</p>
        {catalogError ? (
          <p role="alert">Could not load the Catalog: {catalogError}</p>
        ) : !catalog ? (
          <p>Loading Catalog…</p>
        ) : (
          <>
            <label>
              Catalog stay{" "}
              <select value={stayId} onChange={(e) => setStayId(e.target.value)}>
                <option value="">Select a stay…</option>
                {stays.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · sleeps {s.sleeps} · {formatEstimate(s.nightlyPrice, "night")}
                  </option>
                ))}
              </select>
            </label>{" "}
            <button
              type="button"
              disabled={!stayId || busy !== null || !latestStandard}
              onClick={() => void tryAlternative()}
            >
              {busy === "alternative" ? "Comparing…" : "Compare"}
            </button>
            {!latestStandard && history !== undefined && <p>Run a standard check first.</p>}
          </>
        )}
      </div>

      <div>
        <h3>History</h3>
        {history && history.length > 0 ? (
          <ol>
            {history.map((r) => (
              <li key={r.checkId}>
                <button
                  type="button"
                  aria-pressed={selected?.checkId === r.checkId}
                  onClick={() => setSelectedId(r.checkId)}
                >
                  {formatRunAt(r.runAt)}
                </button>{" "}
                {r.kind === "alternative" ? "Alternative" : "Check"} · {r.evaluatedStay.name} · {scoreText(r)} ·{" "}
                {labelOf(r.outcomes).label}
              </li>
            ))}
          </ol>
        ) : (
          <p>No history yet.</p>
        )}
      </div>
    </section>
  );
}

function ResultView({ result, isLatest }: { result: CheckResult; isLatest: boolean }) {
  const { label, failed } = labelOf(result.outcomes);
  return (
    <section aria-labelledby={`result-${result.checkId}`}>
      <h3 id={`result-${result.checkId}`}>
        {isLatest ? "Latest result" : "Result"} for {result.evaluatedStay.name}
      </h3>
      <p>
        <small>
          Run {formatRunAt(result.runAt)} · Catalog {result.catalogVersion} · {result.tripNights} trip nights
        </small>
      </p>
      <p>
        <strong>{label}</strong> · {scoreText(result)}
      </p>

      {failed.length > 0 && (
        <div>
          <h4>Failed checks</h4>
          <ul>
            {failed.map((o) => (
              <li key={o.check}>
                {o.check}: measured {formatValue(o.measured, o.unit)} against a limit of{" "}
                {formatValue(o.limit, o.unit)} ({unitLabel(o.unit)})
                {outcomeDetails(o) ? `. ${outcomeDetails(o)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Measured</th>
            <th scope="col">Limit</th>
            <th scope="col">Unit</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {result.outcomes.map((o) => (
            <tr key={o.check} className={o.passed ? "pass" : "fail"}>
              <th scope="row">{o.check}</th>
              <td>{formatValue(o.measured, o.unit)}</td>
              <td>{formatValue(o.limit, o.unit)}</td>
              <td>{unitLabel(o.unit)}</td>
              <td>
                {statusText(o)}
                {outcomeDetails(o) && (
                  <>
                    <br />
                    <small>{outcomeDetails(o)}</small>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <h4>Explanation</h4>
        {result.explanation ? (
          <>
            <p>{result.explanation}</p>
            <p>
              <small>Source: {explanationSourceText(result.explanationSource)}</small>
            </p>
          </>
        ) : (
          <p>No explanation is stored for this result.</p>
        )}
      </div>
    </section>
  );
}
