import { describe, expect, it } from "vitest";
import { balances, equalShares } from "./split";

describe("equalShares", () => {
  it("gives leftover cents to the first people", () => {
    expect(equalShares(1000, ["a", "b", "c"])).toEqual([
      { memberId: "a", amountCents: 334 },
      { memberId: "b", amountCents: 333 },
      { memberId: "c", amountCents: 333 },
    ]);
  });

  it("returns nothing when there is nobody to split with", () => {
    expect(equalShares(1000, [])).toEqual([]);
  });
});

describe("balances", () => {
  it("nets debts between the same pair and ignores a payer's own share", () => {
    expect(
      balances([
        {
          payerMemberId: "ana",
          splits: [
            { memberId: "ana", amountCents: 2000 },
            { memberId: "ben", amountCents: 2000 },
            { memberId: "cam", amountCents: 2000 },
          ],
        },
        {
          payerMemberId: "ben",
          splits: [
            { memberId: "ana", amountCents: 500 },
            { memberId: "ben", amountCents: 500 },
          ],
        },
      ]),
    ).toEqual([
      { fromMemberId: "cam", toMemberId: "ana", cents: 2000 },
      { fromMemberId: "ben", toMemberId: "ana", cents: 1500 },
    ]);
  });

  it("leaves an unsplit expense out of the balance", () => {
    expect(balances([{ payerMemberId: "ana" }])).toEqual([]);
  });
});
