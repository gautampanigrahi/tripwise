import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEstimate, type Catalog, type CheckName, type CheckOutcome, type CheckResult } from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { getCatalog } from "../api/catalog";
import { runAlternative, runChecks } from "../api/checks";
import { describeApiError, latestStandardResult, listCheckResults } from "../api/trips";
import {
  AlertCircleIcon,
  Badge,
  Button,
  Card,
  CheckCircleIcon,
  ChevronRightIcon,
  EmptyState,
  ErrorState,
  LoadingState,
  ScoreRing,
  cx,
  useToast,
} from "../ui";
import { AlternativeView, ExplanationBox, OutcomeBar } from "./AlternativeView";
import { CHECK_ORDER, formatRunAt, scoreText, sortFailedFirst, unitLabel } from "./format";
import "./checks.css";

export interface ChecksPanelProps {
  tripId: string;
  /** Called after a check or alternative is saved so the page can refetch. */
  onChanged?: () => void | Promise<void>;
  /** Check_Result history, newest first, from the page load. Fetched from `GET /trips/{tripId}/checks` when omitted. */
  results?: readonly CheckResult[];
  /** Optional preloaded Catalog; fetched from `GET /catalog` when omitted. */
  catalog?: Catalog;
  /**
   * Opens the trip tab that fixes a 422 error ("Go to Lodging"). When omitted, the panel
   * looks for a page tab with that name and otherwise shows a text hint.
   */
  onNavigate?: (tab: FixTab) => void;
}

/** Label and failed list derived from the outcomes (Req 19.2, 19.3). */
function labelOf(outcomes: readonly CheckOutcome[]): { label: "Feasible" | "Not feasible"; failed: CheckOutcome[] } {
  const failed = outcomes.filter((o) => !o.passed);
  return { label: failed.length === 0 ? "Feasible" : "Not feasible", failed };
}

function sortNewestFirst(results: readonly CheckResult[]): CheckResult[] {
  return [...results].sort((a, b) => (a.runAt < b.runAt ? 1 : a.runAt > b.runAt ? -1 : 0));
}

/** Trip tab that can fix a check error. */
export type FixTab = "Lodging" | "Constraints";

interface CheckError {
  message: string;
  tab?: FixTab;
}

/** Readable text for 422 responses from the checks routes (Req 13.5, 20.1), with the tab that fixes it. */
function describeCheckError(err: unknown): CheckError {
  if (err instanceof ApiError && err.status === 422) {
    const body = (err.body ?? {}) as { error?: string; missing?: string; activityId?: string; id?: string };
    if (body.error === "MISSING_INPUT") {
      if (body.missing === "Lodging") return { message: "Add a Lodging stay before running checks.", tab: "Lodging" };
      if (body.missing === "TripConstraints")
        return { message: "Save the trip constraints before running checks.", tab: "Constraints" };
      return { message: `Missing input${body.missing ? `: ${body.missing}` : ""}.` };
    }
    if (body.error === "UNKNOWN_ACTIVITY") {
      const id = body.activityId ?? body.id;
      return {
        message: `A planned activity is not in the Catalog${id ? ` (${id})` : ""}. Update the trip constraints.`,
        tab: "Constraints",
      };
    }
    if (body.error === "NO_BASE_RESULT") return { message: "Run a standard check before trying an alternative stay." };
  }
  return { message: describeApiError(err) };
}

/** Fallback when no `onNavigate` is given: the page's tab element whose visible text is `name`. */
function findTab(name: string): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.trim() === name);
}

const NOT_RUN_REASON: Partial<Record<CheckName, string>> = {
  Schedule: "no daily travel-time cap is set",
};

export function ChecksPanel({
  tripId,
  onChanged,
  results: resultsProp,
  catalog: catalogProp,
  onNavigate,
}: ChecksPanelProps) {
  const client = useApiClient();
  const toast = useToast();
  const [history, setHistory] = useState<CheckResult[] | undefined>(
    resultsProp ? sortNewestFirst(resultsProp) : undefined,
  );
  const [catalog, setCatalog] = useState<Catalog | undefined>(catalogProp);
  const [catalogError, setCatalogError] = useState<string>();
  const [historyError, setHistoryError] = useState<string>();
  // Bumped by Retry to run the history or Catalog fetch again.
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [stayId, setStayId] = useState("");
  const [busy, setBusy] = useState<"check" | "alternative" | null>(null);
  const [error, setError] = useState<CheckError>();

  const refresh = useCallback(async () => {
    setHistory(await listCheckResults(client, tripId));
  }, [client, tripId]);

  useEffect(() => {
    if (resultsProp) {
      setHistory(sortNewestFirst(resultsProp));
      return;
    }
    let cancelled = false;
    setHistoryError(undefined);
    listCheckResults(client, tripId)
      .then((r) => {
        if (!cancelled) setHistory(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setHistoryError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, tripId, resultsProp, historyAttempt]);

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
      const result = await runChecks(client, tripId);
      await afterSave(result);
      toast.success(`Check complete: ${labelOf(result.outcomes).label}.`);
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
      const result = await runAlternative(client, tripId, stayId);
      await afterSave(result);
      toast.success(`Comparison ready for ${result.evaluatedStay.name}.`);
    } catch (err) {
      setError(describeCheckError(err));
    } finally {
      setBusy(null);
    }
  }

  const stays = catalog?.stays ?? [];
  const currentStayId = latestStandard?.evaluatedStay.stayId;
  const fixTab = error?.tab;
  const fallbackTab = fixTab && !onNavigate ? findTab(fixTab) : undefined;
  const goToFix = fixTab
    ? onNavigate
      ? () => onNavigate(fixTab)
      : fallbackTab
        ? () => fallbackTab.click()
        : undefined
    : undefined;

  const runButton = (
    <Button variant="primary" size="lg" loading={busy === "check"} disabled={busy !== null} onClick={() => void run()}>
      {busy === "check" ? "Running checks…" : "Run feasibility check"}
    </Button>
  );

  return (
    <section className="checks" aria-labelledby="checks-heading">
      <header className="checks__header">
        <div>
          <h2 id="checks-heading">Feasibility checks</h2>
          <p className="checks-muted">Cost, Capacity, Dates, Schedule, and Preferences against your constraints.</p>
        </div>
        {runButton}
      </header>

      {error && (
        <div className="alert alert--danger checks-alert" role="alert">
          <AlertCircleIcon size={18} aria-hidden="true" />
          <div className="checks-alert__body">
            <p>{error.message}</p>
            {fixTab &&
              (goToFix ? (
                <Button variant="secondary" size="sm" onClick={goToFix} icon={<ChevronRightIcon size={14} />}>
                  Go to {fixTab}
                </Button>
              ) : (
                <p>Open the {fixTab} tab to fix this.</p>
              ))}
          </div>
        </div>
      )}

      {historyError && history === undefined && (
        <ErrorState
          title="Could not load the check history"
          message={historyError}
          onRetry={() => setHistoryAttempt((n) => n + 1)}
        />
      )}

      {history === undefined && !historyError && <LoadingState label="Loading check history…" />}

      {history !== undefined && !selected && (
        <Card>
          <EmptyState
            icon={<CheckCircleIcon size={22} />}
            title="No checks have been run yet."
            description="Run a check to see whether your stay, budget, dates, schedule, and preferences fit together."
            action={runButton}
          />
        </Card>
      )}

      {selected &&
        (selected.kind === "alternative" ? (
          <AlternativeView alternative={selected} base={latestStandard} />
        ) : (
          <ResultView result={selected} isLatest={selected.checkId === latestStandard?.checkId} />
        ))}

      <Card
        as="section"
        title="Try an alternative stay"
        headingLevel={3}
        subtitle="Runs the same checks with a Catalog stay in place of your current lodging. Your plan is not changed."
        footer={
          catalog && stays.length > 0 ? (
            <div className="alt-picker__footer">
              {!latestStandard && history !== undefined && (
                <span className="checks-muted">Run a standard check first.</span>
              )}
              <Button
                variant="secondary"
                loading={busy === "alternative"}
                disabled={!stayId || busy !== null || !latestStandard}
                onClick={() => void tryAlternative()}
              >
                {busy === "alternative" ? "Comparing…" : "Compare"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {catalogError ? (
          <ErrorState
            compact
            headingLevel={4}
            title="Could not load the Catalog"
            message={catalogError}
            onRetry={() => setCatalogAttempt((n) => n + 1)}
          />
        ) : !catalog ? (
          <LoadingState label="Loading Catalog…" cards={1} />
        ) : stays.length === 0 ? (
          <p className="checks-muted">The Catalog has no stays.</p>
        ) : (
          <div className="alt-picker" role="radiogroup" aria-label="Catalog stay">
            {stays.map((s) => {
              const checked = stayId === s.id;
              return (
                <label key={s.id} className={cx("alt-picker__option", checked && "alt-picker__option--selected")}>
                  <input
                    type="radio"
                    name={`alt-stay-${tripId}`}
                    value={s.id}
                    checked={checked}
                    onChange={() => setStayId(s.id)}
                    className="alt-picker__radio"
                  />
                  <span className="alt-picker__name">{s.name}</span>
                  <span className="alt-picker__meta">Sleeps {s.sleeps}</span>
                  <span className="alt-picker__meta">{formatEstimate(s.nightlyPrice, "night")}</span>
                  {s.id === currentStayId && <Badge tone="accent">Current stay</Badge>}
                </label>
              );
            })}
          </div>
        )}
      </Card>

      <Card as="section" title="History" headingLevel={3} subtitle="Newest first. Select a run to view it.">
        {history && history.length > 0 ? (
          <ol className="checks-history">
            {history.map((r) => {
              const { label } = labelOf(r.outcomes);
              const active = selected?.checkId === r.checkId;
              return (
                <li key={r.checkId}>
                  <button
                    type="button"
                    className={cx("checks-history__item", active && "checks-history__item--active")}
                    aria-pressed={active}
                    onClick={() => setSelectedId(r.checkId)}
                  >
                    <span className="checks-history__time">{formatRunAt(r.runAt)}</span>
                    <Badge tone={r.kind === "alternative" ? "accent" : "neutral"}>
                      {r.kind === "alternative" ? "Alternative" : "Check"}
                    </Badge>
                    <span className="checks-history__stay">{r.evaluatedStay.name}</span>
                    <span className="checks-history__score">{scoreText(r)}</span>
                    <Badge tone={label === "Feasible" ? "pass" : "fail"} dot>
                      {label}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="checks-muted">No history yet.</p>
        )}
      </Card>
    </section>
  );
}

function ResultView({ result, isLatest }: { result: CheckResult; isLatest: boolean }) {
  const { label, failed } = labelOf(result.outcomes);
  const feasible = label === "Feasible";
  const ordered = sortFailedFirst(result.outcomes);
  const ran = new Set(result.outcomes.map((o) => o.check));
  const notRun = CHECK_ORDER.filter((c) => !ran.has(c));

  return (
    <section className="checks-result" aria-labelledby={`result-${result.checkId}`}>
      <div className={cx("checks-banner", feasible ? "checks-banner--pass" : "checks-banner--fail")}>
        <ScoreRing value={result.score} size={104} tone={feasible ? "success" : undefined} />
        <div className="checks-banner__body">
          <p className="checks-banner__eyebrow" id={`result-${result.checkId}`}>
            {isLatest ? "Latest result" : "Result"} for {result.evaluatedStay.name}
          </p>
          <p className="checks-banner__label">
            {feasible ? <CheckCircleIcon size={26} aria-hidden="true" /> : <AlertCircleIcon size={26} aria-hidden="true" />}
            <strong>{label}</strong>
          </p>
          <p className="checks-banner__score">{scoreText(result)}</p>
          {failed.length > 0 && (
            <p className="checks-banner__failed">Failed: {failed.map((o) => o.check).join(", ")}</p>
          )}
          <p className="checks-muted checks-banner__meta">
            Run {formatRunAt(result.runAt)} · Catalog {result.catalogVersion} · {result.tripNights} trip nights
          </p>
        </div>
      </div>

      <ul className="checks-grid" aria-label="Check outcomes">
        {ordered.map((o) => (
          <Card
            as="li"
            key={o.check}
            compact
            title={o.check}
            headingLevel={4}
            subtitle={unitLabel(o.unit)}
            className={cx("check-card", o.passed ? "check-card--pass" : "check-card--fail")}
          >
            <OutcomeBar o={o} />
          </Card>
        ))}
      </ul>
      {notRun.length > 0 && (
        <p className="checks-muted">
          Not run:{" "}
          {notRun.map((c) => (NOT_RUN_REASON[c] ? `${c} (${NOT_RUN_REASON[c]})` : c)).join(", ")}.
        </p>
      )}

      <ExplanationBox result={result} />
    </section>
  );
}
