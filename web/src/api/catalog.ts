import type { Catalog } from "@tripwise/shared";
import type { ApiClient } from "./client";

/** GET /catalog. Accepts either the bare Catalog or `{ catalog }`. */
export async function getCatalog(client: ApiClient): Promise<Catalog> {
  const body = await client.get<unknown>("/catalog");
  if (body && typeof body === "object" && "catalog" in body) return (body as { catalog: Catalog }).catalog;
  return body as Catalog;
}
