import type { CheckName, CheckOutcome, CheckResult } from "@tripwise/shared";
import { Badge, Card, ProgressBar, ScoreRing } from "../ui";
import {
  CHECK_ORDER,
  explanationSourceShort,
  explanationSourceText,
  measuredVsLimitText,
  outcomeBar,
  outcomeDetails,
  outcomeSummary,
  outcomeTone,
  scoreText,
  statusText,
  unitLabel,
} from "./format";
import "./checks.css";

export interface AlternativeViewProps {
  /** A `kind: 'alternative'` Check_Result. */
  alternative: CheckResult;
  /** The latest non-alternative Check_Result (Req 20.3); undefined if none exists. */
  base: CheckResult | undefined;
}

/** Measured-vs-limit bar with status badge, summary sentence, and details for one Check_Outcome. */
export function OutcomeBar({ o, label }: { o: CheckOutcome; label?: string }) {
  const tone = outcomeTone(o);
  const bar = outcomeBar(o);
  const details = outcomeDetails(o);
  return (
    <div className={`outcome outcome--${o.passed ? "pass" : "fail"}`}>
      <div className="outcome__status">
        <Badge tone={o.passed ? "pass" : "fail"} dot>
          {statusText(o)}
        </Badge>
        <span className="outcome__value">{measuredVsLimitText(o)}</span>
      </div>
      <ProgressBar
        value={bar.value}
        max={bar.max}
        tone={tone}
        label={label ?? `${o.check}: measured against limit`}
        hideLabel
      />
      <p className="outcome__summary">{outcomeSummary(o)}</p>
      {details && <p className="outcome__details">{details}</p>}
    </div>
  );
}

/** Explanation text in a highlighted box with a source Badge (Req 21.6). */
export function ExplanationBox({ result, heading = "Explanation" }: { result: CheckResult; heading?: string }) {
  if (!result.explanation) {
    return <p className="checks-muted">No explanation is stored for this result.</p>;
  }
  return (
    <div className="checks-explanation">
      <div className="checks-explanation__header">
        <h4 className="checks-explanation__title">{heading}</h4>
        <Badge
          tone={result.explanationSource === "bedrock" ? "accent" : "neutral"}
          title={`Source: ${explanationSourceText(result.explanationSource)}`}
        >
          {explanationSourceShort(result.explanationSource)}
        </Badge>
      </div>
      <p className="checks-explanation__text">{result.explanation}</p>
    </div>
  );
}

function changeBadge(base: CheckOutcome | undefined, alt: CheckOutcome | undefined) {
  if (!base || !alt || base.passed === alt.passed) return null;
  return alt.passed ? (
    <Badge tone="pass">Now passes</Badge>
  ) : (
    <Badge tone="fail">Now fails</Badge>
  );
}

function Side({ o, who }: { o: CheckOutcome | undefined; who: string }) {
  return (
    <div className="alt-compare__side">
      <span className="alt-compare__who">{who}</span>
      {o ? <OutcomeBar o={o} label={`${o.check}, ${who}`} /> : <p className="checks-muted">Not run</p>}
    </div>
  );
}

/** Shows the Alternative's Check_Outcomes next to the latest standard result's (Req 20.3). */
export function AlternativeView({ alternative, base }: AlternativeViewProps) {
  const present = new Set<CheckName>([
    ...alternative.outcomes.map((o) => o.check),
    ...(base?.outcomes ?? []).map((o) => o.check),
  ]);
  const checks = CHECK_ORDER.filter((c) => present.has(c));
  const find = (r: CheckResult | undefined, c: CheckName) => r?.outcomes.find((o) => o.check === c);
  const unitFor = (c: CheckName) => (find(alternative, c) ?? find(base, c))?.unit;
  const currentName = base ? `Current: ${base.evaluatedStay.name}` : "Current plan";
  const altName = `Alternative: ${alternative.evaluatedStay.name}`;

  return (
    <section className="alt-view" aria-labelledby={`alt-${alternative.checkId}`}>
      <div className="alt-view__intro">
        <h3 id={`alt-${alternative.checkId}`}>Alternative: {alternative.evaluatedStay.name}</h3>
        <p className="checks-muted">This comparison does not change your plan.</p>
        {!base && <p className="checks-muted">No standard check has been run yet, so there is nothing to compare against.</p>}
      </div>

      <div className="alt-compare__scores">
        <Card className="alt-score" compact>
          <span className="alt-compare__who">{currentName}</span>
          {base ? (
            <div className="alt-score__body">
              <ScoreRing value={base.score} size={64} />
              <div>
                <Badge tone={base.label === "Feasible" ? "pass" : "fail"}>{base.label}</Badge>
                <p className="alt-score__text">{scoreText(base)}</p>
              </div>
            </div>
          ) : (
            <p className="checks-muted">—</p>
          )}
        </Card>
        <Card className="alt-score alt-score--alternative" compact>
          <span className="alt-compare__who">{altName}</span>
          <div className="alt-score__body">
            <ScoreRing value={alternative.score} size={64} />
            <div>
              <Badge tone={alternative.label === "Feasible" ? "pass" : "fail"}>{alternative.label}</Badge>
              <p className="alt-score__text">{scoreText(alternative)}</p>
            </div>
          </div>
        </Card>
      </div>

      <ul className="alt-compare" aria-label="Check-by-check comparison">
        {checks.map((c) => {
          const unit = unitFor(c);
          const b = find(base, c);
          const a = find(alternative, c);
          return (
            <Card
              as="li"
              key={c}
              compact
              title={c}
              headingLevel={4}
              subtitle={unit ? unitLabel(unit) : undefined}
              actions={changeBadge(b, a) ?? undefined}
            >
              <div className="alt-compare__row">
                <Side o={b} who={currentName} />
                <Side o={a} who={altName} />
              </div>
            </Card>
          );
        })}
      </ul>

      {alternative.explanation && <ExplanationBox result={alternative} heading="Explanation for the alternative" />}
    </section>
  );
}
