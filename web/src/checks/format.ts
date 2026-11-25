import type { CheckOutcome, CheckResult, Unit } from "@tripwise/shared";

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
