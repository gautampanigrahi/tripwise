import type { CheckName, CheckOutcome, CheckResult, Unit } from "@tripwise/shared";

/** Integer cents as dollars with two decimals, e.g. 285000 -> "$2,850.00". */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const UNIT_LABELS: Record<Unit, string> = {
  USD_CENTS: "US dollars",
  BEDS: "beds",
  NIGHTS: "nights",
  MINUTES: "minutes",
  FEATURES: "features",
};

/** Display name of a unit; money is always shown in dollars, never cents. */
export function unitLabel(unit: Unit): string {
  return UNIT_LABELS[unit] ?? unit;
}

/** A measured value or limit in its unit's display form (money in dollars). */
export function formatValue(value: number, unit: Unit): string {
  return unit === "USD_CENTS" ? formatDollars(value) : String(value);
}

/** Req 19.4 wording: the score is the share of executed Checks that passed. */
export function scoreText(result: Pick<CheckResult, "score">): string {
  return `${result.score}% of checks passed`;
}

export function statusText(o: Pick<CheckOutcome, "passed">): string {
  return o.passed ? "Passed" : "Failed";
}

export function explanationSourceText(source: CheckResult["explanationSource"]): string {
  if (source === "bedrock") return "Amazon Bedrock";
  if (source === "template") return "Template (built from the check outcomes)";
  return "Unknown";
}

/** Extra detail for a failed Schedule or Preferences outcome, or undefined. */
export function outcomeDetails(o: CheckOutcome): string | undefined {
  const parts: string[] = [];
  if (o.details?.missingPairs?.length) {
    parts.push(`Missing travel times: ${o.details.missingPairs.map(([a, b]) => `${a} → ${b}`).join(", ")}`);
  }
  if (o.details?.unmetFeatures?.length) {
    parts.push(`Unmet features: ${o.details.unmetFeatures.join(", ")}`);
  }
  return parts.length ? parts.join("; ") : undefined;
}

export function formatRunAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Display order of the five checks. */
export const CHECK_ORDER: readonly CheckName[] = ["Cost", "Capacity", "Dates", "Schedule", "Preferences"];

/** Short source name for the explanation Badge. */
export function explanationSourceShort(source: CheckResult["explanationSource"]): string {
  if (source === "bedrock") return "Amazon Bedrock";
  if (source === "template") return "Template";
  return "Unknown source";
}

/**
 * Whether the measured value must stay at or under the limit (Cost, Schedule) or
 * reach it (Capacity, Dates, Preferences), matching the engine's pass rules.
 */
export function limitDirection(unit: Unit): "atMost" | "atLeast" {
  return unit === "USD_CENTS" || unit === "MINUTES" ? "atMost" : "atLeast";
}

/** Compact measured-vs-limit text: "$1,800.00 of $2,500.00", "2 of 4 beds", "95 of 120 min". */
export function measuredVsLimitText(o: Pick<CheckOutcome, "measured" | "limit" | "unit">): string {
  switch (o.unit) {
    case "USD_CENTS":
      return `${formatDollars(o.measured)} of ${formatDollars(o.limit)}`;
    case "MINUTES":
      return `${o.measured} of ${o.limit} min`;
    default:
      return `${o.measured} of ${o.limit} ${unitLabel(o.unit)}`;
  }
}

/** One-sentence description of what was measured against what. */
export function outcomeSummary(o: Pick<CheckOutcome, "check" | "measured" | "limit" | "unit">): string {
  switch (o.unit) {
    case "USD_CENTS":
      return `Estimated cost ${formatDollars(o.measured)} against a ${formatDollars(o.limit)} budget.`;
    case "BEDS":
      return `The stay sleeps ${o.measured} of ${o.limit} travelers.`;
    case "NIGHTS":
      return `The stay covers ${o.measured} of ${o.limit} trip nights.`;
    case "MINUTES":
      return `Busiest day has ${o.measured} minutes of travel against a ${o.limit}-minute cap.`;
    case "FEATURES":
      return `The stay has ${o.measured} of ${o.limit} required features.`;
    default:
      return `Measured ${formatValue(o.measured, o.unit)} against a limit of ${formatValue(o.limit, o.unit)}.`;
  }
}

/** Bar tone: fail when failed; warning when passing at 90 % or more of an "at most" limit; otherwise pass. */
export function outcomeTone(o: Pick<CheckOutcome, "passed" | "measured" | "limit" | "unit">): "pass" | "warning" | "fail" {
  if (!o.passed) return "fail";
  if (limitDirection(o.unit) === "atMost" && o.limit > 0 && o.measured / o.limit >= 0.9) return "warning";
  return "pass";
}

/** Bar fill: measured against the limit. For a zero limit (e.g. no required features) the bar is full. */
export function outcomeBar(o: Pick<CheckOutcome, "measured" | "limit">): { value: number; max: number } {
  if (o.limit <= 0) return { value: 1, max: 1 };
  return { value: o.measured, max: o.limit };
}

/** Failed outcomes first, then passed, each in CHECK_ORDER. Does not mutate the input. */
export function sortFailedFirst<T extends Pick<CheckOutcome, "check" | "passed">>(outcomes: readonly T[]): T[] {
  const rank = (c: CheckName) => {
    const i = CHECK_ORDER.indexOf(c);
    return i === -1 ? CHECK_ORDER.length : i;
  };
  return [...outcomes].sort((a, b) => Number(a.passed) - Number(b.passed) || rank(a.check) - rank(b.check));
}
