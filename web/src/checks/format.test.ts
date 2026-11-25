import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CheckName, CheckOutcome, Unit } from "@tripwise/shared";
import {
  CHECK_ORDER,
  explanationSourceShort,
  measuredVsLimitText,
  outcomeBar,
  outcomeTone,
  sortFailedFirst,
} from "./format";

const o = (check: CheckName, unit: Unit, measured: number, limit: number, passed: boolean): CheckOutcome => ({
  check,
  unit,
  measured,
  limit,
  passed,
});

describe("checks format helpers", () => {
  it("formats measured vs limit per unit", () => {
    expect(measuredVsLimitText(o("Cost", "USD_CENTS", 180000, 250000, true))).toBe("$1,800.00 of $2,500.00");
    expect(measuredVsLimitText(o("Capacity", "BEDS", 2, 4, false))).toBe("2 of 4 beds");
    expect(measuredVsLimitText(o("Dates", "NIGHTS", 4, 4, true))).toBe("4 of 4 nights");
    expect(measuredVsLimitText(o("Schedule", "MINUTES", 95, 120, true))).toBe("95 of 120 min");
    expect(measuredVsLimitText(o("Preferences", "FEATURES", 1, 2, false))).toBe("1 of 2 features");
  });

  it("uses warning tone near an at-most limit and full bar for a zero limit", () => {
    expect(outcomeTone(o("Cost", "USD_CENTS", 240000, 250000, true))).toBe("warning");
    expect(outcomeTone(o("Cost", "USD_CENTS", 100000, 250000, true))).toBe("pass");
    expect(outcomeTone(o("Capacity", "BEDS", 2, 4, false))).toBe("fail");
    expect(outcomeBar(o("Preferences", "FEATURES", 0, 0, true))).toEqual({ value: 1, max: 1 });
  });

  it("labels the explanation source", () => {
    expect(explanationSourceShort("bedrock")).toBe("Amazon Bedrock");
    expect(explanationSourceShort("template")).toBe("Template");
  });

  it("sortFailedFirst puts every failed outcome before every passed one, in check order", () => {
    const arb = fc.shuffledSubarray(
      CHECK_ORDER.map((c) => c),
      { minLength: 0 },
    ).chain((checks) => fc.tuple(...checks.map((c) => fc.record({ check: fc.constant(c), passed: fc.boolean() }))));
    fc.assert(
      fc.property(arb, (input) => {
        const out = sortFailedFirst(input);
        expect(out).toHaveLength(input.length);
        const firstPass = out.findIndex((x) => x.passed);
        if (firstPass !== -1) expect(out.slice(firstPass).every((x) => x.passed)).toBe(true);
        for (const group of [out.filter((x) => !x.passed), out.filter((x) => x.passed)]) {
          const idx = group.map((x) => CHECK_ORDER.indexOf(x.check));
          expect(idx).toEqual([...idx].sort((a, b) => a - b));
        }
      }),
    );
  });
});
