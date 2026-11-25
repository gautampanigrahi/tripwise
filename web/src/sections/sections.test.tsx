import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChecklistItem } from "@tripwise/shared";
import { ApiClientProvider } from "../api/ApiClientContext";
import type { ApiClient } from "../api/client";
import { Checklist } from "./Checklist";
import { Expenses, type ExpensesItem } from "./Expenses";
import { GenericSection } from "./GenericSection";
import { Groceries, type GroceriesItem } from "./Groceries";
import { formatUsd, memberSelectOptions, totalsByPayer } from "./planSectionHelpers";

// Rendering never calls the client; requests happen only on user actions.
const client = {} as ApiClient;
const render = (el: ReactElement) => renderToStaticMarkup(<ApiClientProvider client={client}>{el}</ApiClientProvider>);

const members = [
  { userId: "u-ana", displayName: "Ana Ruiz" },
  { userId: "u-ben", displayName: "Ben Okafor" },
];
const stamp = { tripId: "t1", lastModifiedBy: "u-ana", lastModifiedAt: "2025-06-01T10:00:00.000Z", createdAt: "2025-06-01T10:00:00.000Z" };
const noop = () => undefined;

describe("totalsByPayer", () => {
  it("sums per payer, largest first, ties by ID", () => {
    expect(
      totalsByPayer([
        { payerMemberId: "b", amountCents: 500 },
        { payerMemberId: "a", amountCents: 200 },
        { payerMemberId: "a", amountCents: 300 },
        { payerMemberId: "c", amountCents: 900 },
      ]),
    ).toEqual([
      { payerMemberId: "c", cents: 900 },
      { payerMemberId: "a", cents: 500 },
      { payerMemberId: "b", cents: 500 },
    ]);
    expect(totalsByPayer([])).toEqual([]);
  });
});

describe("memberSelectOptions", () => {
  it("lists Members by name and keeps a non-Member current value", () => {
    expect(memberSelectOptions(members, "u-ben").map((o) => o.label)).toEqual(["Ana Ruiz", "Ben Okafor"]);
    expect(memberSelectOptions(members, "u-gone").at(-1)).toEqual({ value: "u-gone", label: "u-gone (not a Member)" });
  });
});

it("formatUsd groups thousands", () => {
  expect(formatUsd(123450)).toBe("$1,234.50");
});

describe("Groceries", () => {
  const items: GroceriesItem[] = [
    { ...stamp, itemId: "g1", section: "Groceries", fields: { name: "Eggs", quantity: 12, responsibleMemberId: "u-ben", purchased: true } },
    { ...stamp, itemId: "g2", section: "Groceries", fields: { name: "Milk", quantity: 2, responsibleMemberId: "u-ana", purchased: false } },
  ];

  it("shows purchased progress, member names, and lastModified", () => {
    const html = render(<Groceries tripId="t1" items={items} members={members} onChanged={noop} />);
    expect(html).toContain("1 of 2 purchased");
    expect(html).toContain("Ben Okafor");
    expect(html).not.toContain(">u-ben<");
    expect(html).toContain("Last modified by Ana Ruiz");
    expect(html).toContain('type="checkbox"');
  });

  it("shows an EmptyState with no items", () => {
    const html = render(<Groceries tripId="t1" items={[]} members={members} onChanged={noop} />);
    expect(html).toContain("No groceries yet");
  });
});

describe("Checklist", () => {
  it("shows done and claimed counts and a Claim button for unclaimed tasks", () => {
    const items: ChecklistItem[] = [
      { ...stamp, itemId: "c1", section: "Checklist", fields: { task: "Book car", done: true, claimedBy: "u-ana" } },
      { ...stamp, itemId: "c2", section: "Checklist", fields: { task: "Pack snacks", done: false } },
    ];
    const html = render(<Checklist tripId="t1" items={items} members={members} onChanged={noop} />);
    expect(html).toContain("1 of 2 done");
    expect(html).toContain("1 claimed");
    expect(html).toContain("1 unclaimed");
    expect(html).toContain("Claimed by");
    expect(html).toContain("Claim Pack snacks");
  });
});

describe("Expenses", () => {
  const items: ExpensesItem[] = [
    { ...stamp, itemId: "e1", section: "Expenses", fields: { payerMemberId: "u-ana", amountCents: 12000, purpose: "Groceries" } },
    { ...stamp, itemId: "e2", section: "Expenses", fields: { payerMemberId: "u-ben", amountCents: 4550, purpose: "Gas" } },
    { ...stamp, itemId: "e3", section: "Expenses", fields: { payerMemberId: "u-ana", amountCents: 1000, purpose: "Ice" } },
  ];

  it("shows the total and per-payer breakdown without payment controls", () => {
    const html = render(<Expenses tripId="t1" items={items} members={members} onChanged={noop} />);
    expect(html).toContain("Total: $175.50");
    expect(html).toContain("$130.00");
    expect(html).toContain("$45.50");
    expect(html).toContain("Share paid by Ben Okafor");
    expect(html).not.toMatch(/>\s*(Pay|Settle|Send|Request)[^<]*</i);
  });
});

describe("GenericSection", () => {
  it("shows an EmptyState with section-specific copy", () => {
    const html = render(
      <GenericSection tripId="t1" section="Reservations" heading="Reservations" items={[]} members={members} onChanged={noop} />,
    );
    expect(html).toContain("Nothing here yet");
    expect(html).toContain("restaurant bookings");
  });
});
