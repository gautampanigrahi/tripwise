import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allRoutes } from './routes.js';

describe('allRoutes', () => {
  it('guards every trip route, has unique keys, and matches the Terraform route table', () => {
    for (const r of allRoutes) {
      if (r.routeKey.includes('/trips/{tripId}')) expect(r.guard, r.routeKey).not.toBeNull();
    }
    const keys = allRoutes.map((r) => `${r.routeKey} -> ${r.fn}`);
    expect(new Set(allRoutes.map((r) => r.routeKey)).size).toBe(allRoutes.length);

    // Parse the `routes = { "GET /trips" = "trips", ... }` map in terraform/api.tf.
    const tf = readFileSync(new URL('../../../terraform/api.tf', import.meta.url), 'utf8');
    const block = tf.match(/^\s*routes\s*=\s*\{([\s\S]*?)^\s*\}/m)?.[1] ?? '';
    const infraKeys = [...block.matchAll(/"([A-Z]+ [^"]+)"\s*=\s*"(\w+)"/g)].map(([, rk, fn]) => `${rk} -> ${fn}`);
    expect(infraKeys.length).toBeGreaterThan(0);
    expect(infraKeys.sort()).toEqual(keys.sort());
  });
});
