import { z } from 'zod';
import { IsoDateSchema } from './dates.js';
import type { FieldError } from './types.js';

/** A USD price in integer cents with the date it was estimated (Req 12.2, 12.3). */
export const PriceEstimateSchema = z.object({
  cents: z.number().int().nonnegative(),
  estimatedAsOf: IsoDateSchema,
});

export const CatalogStaySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  sleeps: z.number().int().positive(),
  nightlyPrice: PriceEstimateSchema,
  features: z.record(z.string(), z.boolean()),
});

export const CatalogActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  pricePerPerson: PriceEstimateSchema,
});

export const TravelTimeSchema = z.object({
  from: z.string(),
  to: z.string(),
  minutes: z.number().int().nonnegative(),
});

/** Versioned San Diego demo Catalog (Req 12.1). */
export const CatalogSchema = z.object({
  version: z.string().min(1),
  city: z.literal('San Diego'),
  stays: z.array(CatalogStaySchema).min(3),
  activities: z.array(CatalogActivitySchema).min(5),
  travelTimes: z.array(TravelTimeSchema),
});

export type PriceEstimate = z.infer<typeof PriceEstimateSchema>;
export type CatalogStay = z.infer<typeof CatalogStaySchema>;
export type CatalogActivity = z.infer<typeof CatalogActivitySchema>;
export type TravelTime = z.infer<typeof TravelTimeSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

export type ParseCatalogResult =
  | { ok: true; catalog: Catalog }
  | { ok: false; version: string; errors: FieldError[] };

/**
 * Validates a raw Catalog document. On failure returns the supplied version
 * and one FieldError per schema issue (Req 12.5).
 */
export function parseCatalog(raw: unknown, version: string): ParseCatalogResult {
  const result = CatalogSchema.safeParse(raw);
  if (result.success) return { ok: true, catalog: result.data };
  const errors: FieldError[] = result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
  }));
  return { ok: false, version, errors };
}

/** Formats integer cents as US dollars, dropping `.00` for whole-dollar amounts. */
function formatUsd(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  const whole = dollars.toLocaleString('en-US');
  return rem === 0 ? `$${whole}` : `$${whole}.${String(rem).padStart(2, '0')}`;
}

/**
 * Labels a Catalog price as an estimate with its "estimated as of" date (Req 12.4),
 * e.g. `"Est. $189/night (as of 2025-01-15)"`. `per` adds an optional unit suffix.
 */
export function formatEstimate(price: PriceEstimate, per?: 'night' | 'person'): string {
  const suffix = per ? `/${per}` : '';
  return `Est. ${formatUsd(price.cents)}${suffix} (as of ${price.estimatedAsOf})`;
}
