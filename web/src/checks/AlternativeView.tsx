import type { CheckName, CheckOutcome, CheckResult } from "@tripwise/shared";
import { explanationSourceText, formatValue, outcomeDetails, scoreText, statusText, unitLabel } from "./format";

export interface AlternativeViewProps {
  /** A `kind: 'alternative'` Check_Result. */
  alternative: CheckResult;
  /** The latest non-alternative Check_Result (Req 20.3); undefined if none exists. */
  base: CheckResult | undefined;
}

const ORDER: CheckName[] = ["Cost", "Capacity", "Dates", "Schedule", "Preferences"];

function Cell({ o }: { o: CheckOutcome | undefined }) {
  if (!o) return <td>Not run</td>;
  const details = outcomeDetails(o);
  return (
    <td className={o.passed ? "pass" : "fail"}>
      {formatValue(o.measured, o.unit)} of {formatValue(o.limit, o.unit)} · <strong>{statusText(o)}</strong>
      {details && (
        <>
          <br />
          <small>{details}</small>
        </>
      )}
    </td>
  );
}

/** Shows the Alternative's Check_Outcomes next to the latest standard result's (Req 20.3). */
export function AlternativeView({ alternative, base }: AlternativeViewProps) {
  const present = new Set<CheckName>([
    ...alternative.outcomes.map((o) => o.check),
    ...(base?.outcomes ?? []).map((o) => o.check),
  ]);
  const checks = ORDER.filter((c) => present.has(c));
  const find = (r: CheckResult | undefined, c: CheckName) => r?.outcomes.find((o) => o.check === c);
  const unitFor = (c: CheckName) => (find(alternative, c) ?? find(base, c))?.unit;

  return (
    <section aria-labelledby={`alt-${alternative.checkId}`}>
      <h3 id={`alt-${alternative.checkId}`}>Alternative: {alternative.evaluatedStay.name}</h3>
      <p>This comparison does not change your plan.</p>
      {!base && <p>No standard check has been run yet, so there is nothing to compare against.</p>}
      <table className="side-by-side">
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Unit</th>
            <th scope="col">Current plan{base ? `: ${base.evaluatedStay.name}` : ""}</th>
            <th scope="col">Alternative: {alternative.evaluatedStay.name}</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => {
            const unit = unitFor(c);
            return (
              <tr key={c}>
                <th scope="row">{c}</th>
                <td>{unit ? unitLabel(unit) : ""}</td>
                <Cell o={find(base, c)} />
                <Cell o={find(alternative, c)} />
              </tr>
            );
          })}
          <tr>
            <th scope="row">Score</th>
            <td />
            <td>{base ? `${scoreText(base)} · ${base.label}` : "—"}</td>
            <td>
              {scoreText(alternative)} · {alternative.label}
            </td>
          </tr>
        </tbody>
      </table>
      {alternative.explanation && (
        <div>
          <h4>Explanation for the alternative</h4>
          <p>{alternative.explanation}</p>
          <p>
            <small>Source: {explanationSourceText(alternative.explanationSource)}</small>
          </p>
        </div>
      )}
    </section>
  );
}
