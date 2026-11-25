import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogSchema, type LodgingItem } from "@tripwise/shared";
import { ApiClientProvider } from "../api/ApiClientContext";
import { createApiClient } from "../api/client";
import { Lodging, nightsBetween, priceLabel } from "./Lodging";

const catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(new URL("../../../catalog/san-diego-v1.json", import.meta.url), "utf8")),
);
const stay = catalog.stays[0]!;
// Never called: static rendering runs no effects or handlers.
const client = createApiClient({ baseUrl: "http://localhost", getIdToken: async () => null });

function item(fields: Partial<LodgingItem["fields"]>, itemId = "l1"): LodgingItem {
  return {
    tripId: "t1",
    itemId,
    section: "Lodging",
    fields: { checkIn: "2026-06-12", checkOut: "2026-06-15", sleeps: 6, nightlyPriceCents: 25000, ...fields },
    lastModifiedBy: "u1",
    lastModifiedAt: "2026-05-01T10:00:00.000Z",
    createdAt: "2026-05-01T10:00:00.000Z",
  };
}

function render(items: LodgingItem[]) {
  return renderToStaticMarkup(
    <ApiClientProvider client={client}>
      <Lodging tripId="t1" items={items} members={[{ userId: "u1", displayName: "Ana" }]} onChanged={() => {}} catalog={catalog} />
    </ApiClientProvider>,
  );
}

describe("Lodging helpers", () => {
  it("counts nights between check-in and check-out", () => {
    expect(nightsBetween("2026-06-12", "2026-06-15")).toBe(3);
    expect(nightsBetween("2026-06-12", "")).toBeUndefined();
  });

  it("labels a Catalog-matched price as an estimate with its date and others as plain dollars", () => {
    const linked = item({ catalogStayId: stay.id, nightlyPriceCents: stay.nightlyPrice.cents }).fields;
    expect(priceLabel(linked, catalog.stays)).toContain(`as of ${stay.nightlyPrice.estimatedAsOf}`);
    expect(priceLabel(item({ nightlyPriceCents: 12550 }).fields, catalog.stays)).toBe("$125.50/night");
  });
});

describe("Lodging section", () => {
  it("shows an EmptyState with an Add action when there are no stays", () => {
    const html = render([]);
    expect(html).toContain("No lodging yet");
    expect(html).toContain("Add lodging");
  });

  it("renders a stay card with dates, nights, sleeps, price, features, and a Selected badge", () => {
    const html = render([
      item({ name: "Beach House", address: "1 Ocean Way", selected: true, features: ["parking", "kitchen"] }),
    ]);
    expect(html).toContain("Beach House");
    expect(html).toContain("1 Ocean Way");
    expect(html).toContain("Selected");
    expect(html).toContain("$250/night");
    expect(html).toMatch(/Nights<\/dt><dd>3</);
    expect(html).toMatch(/Sleeps<\/dt><dd>6</);
    expect(html).toContain("parking");
    expect(html).toContain("Upload confirmation file");
  });

  it("keeps the door code and confirmation number hidden until the details toggle is used", () => {
    const html = render([
      item({ name: "Loft", confirmationNumber: "CONF-998", checkInDetails: { doorCode: "4321" }, confirmationKey: "k" }),
    ]);
    expect(html).toContain("Show check-in details");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("4321");
    expect(html).not.toContain("CONF-998");
    expect(html).toContain("Download confirmation");
    expect(html).toContain("Replace confirmation file");
  });
});
