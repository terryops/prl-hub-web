import type { Overview, PoolOverview } from "./types.ts";

/** Pools taken down at their owner's request: no row in the pool overview, no Real Cost page, no monitoring.
 *  Matched by domain as well as name, so a pool can't come back through another directory under its domain. */
export const DELISTED_POOLS = [{ name: "PearlHash", host: "pearlhash.xyz" }] as const;

const hostOf = (url: string | null | undefined) => {
  try { return url ? new URL(url).hostname.toLowerCase() : ""; } catch { return ""; }
};
const onHost = (url: string | null | undefined, host: string) => {
  const h = hostOf(url);
  return h === host || h.endsWith("." + host);
};
/** The delisting a monitor's pool name falls under, if any. */
export const delistedPool = (name: string) => DELISTED_POOLS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
export const delistedRow = (row: Pick<PoolOverview, "id" | "name"> & { url?: string | null }) =>
  DELISTED_POOLS.some((p) => p.name.toLowerCase() === row.name.trim().toLowerCase() || onHost(row.id, p.host) || onHost(row.url, p.host));
const slugOf = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A Real Cost page address (pool-cost-route.ts) that belonged to a delisted pool: by its old slug or its domain's. */
export const delistedSlug = (slug: string) => DELISTED_POOLS.some((p) => slug === slugOf(p.name) || slug === slugOf(p.host) || slug.startsWith(slugOf(p.host) + "-"));
/** The overview as every page reads it: delisted pools' rows dropped (their hashrate falls into the network's rest). */
export const withoutDelisted = (o: Overview): Overview => Array.isArray(o?.rows) && o.rows.some(delistedRow) ? { ...o, rows: o.rows.filter((r) => !delistedRow(r)) } : o;
