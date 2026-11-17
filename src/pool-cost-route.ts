import type { PoolOverview, PoolPayout } from "./types.ts";
import { costSchemes } from "./real-cost-content.ts";
import { delistedSlug } from "./delisted-pools.ts";

/** The pools with a Real Cost explainer (real-cost-content.ts), by the id the overview gives them. */
export const costPools = [
  { slug: "pearl-fortune", name: "Pearl Fortune", id: "https://pearlfortune.org/" },
  { slug: "lucky", name: "Lucky Pool", id: "https://pearl.luckypool.io/" },
  { slug: "kryptex", name: "Kryptex", id: "https://prl.kryptex.network/" },
  { slug: "f2pool", name: "F2Pool", id: "https://www.f2pool.com/" },
  { slug: "peryn", name: "Peryn", id: "https://peryn.ai/" },
  { slug: "herominers", name: "HeroMiners", id: "https://pearl.herominers.com/" },
] as const;

export type PoolCostRoute = { slug: string; scheme: string | null; tier: "founding" | "standard" | null };
const schemeValue = (value: string | null | undefined) => value && /^[A-Z0-9+_-]{1,16}$/i.test(value) ? value.toUpperCase() : null;
export function poolCostSlug(pool: Pick<PoolOverview, "id" | "name">) {
  const known = costPools.find((p) => p.id === pool.id);
  if (known) return known.slug;
  try {
    const u = new URL(pool.id);
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "unknown";
  } catch {
    return pool.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "unknown";
  }
}
export function poolCostHref(pool: Pick<PoolOverview, "id" | "name"> | string, scheme?: string | null, tier?: string | null) {
  const slug = typeof pool === "string" ? pool : poolCostSlug(pool);
  const q = new URLSearchParams();
  const s = schemeValue(scheme);
  if (s) q.set("scheme", s);
  if (tier === "founding" || tier === "standard") q.set("tier", tier);
  return `#pools/real-cost/${encodeURIComponent(slug)}${q.size ? "?" + q : ""}`;
}
/** The overview's arrow beside a Real Cost: only for a pool with an explainer and a figure to explain, to the
 *  scheme that has one (the row's own scheme first). A payout without a scheme on a single-scheme pool counts. */
export function poolCostDetailHref(pool: Pick<PoolOverview, "id" | "scheme" | "solo">, payouts: readonly Pick<PoolPayout, "scheme" | "solo" | "realFeePercent">[]) {
  const catalog = costPools.find((p) => p.id === pool.id);
  if (!catalog || pool.solo) return null;
  const explained = costSchemes(catalog.slug);
  const shared = payouts.filter((p) => !p.solo);
  const schemeOf = (p: Pick<PoolPayout, "scheme">) => p.scheme?.trim().toUpperCase() || (shared.length === 1 && explained.length === 1 ? explained[0] : "");
  const measured = shared.filter((p) => p.realFeePercent != null && Number.isFinite(p.realFeePercent) && explained.includes(schemeOf(p)));
  const own = pool.scheme?.trim().toUpperCase();
  const chosen = measured.find((p) => schemeOf(p) === own) || measured[0];
  return chosen ? poolCostHref(catalog.slug, schemeOf(chosen)) : null;
}
export function parsePoolCostRoute(hash: string): PoolCostRoute | null {
  const [path, query = ""] = hash.split("?", 2);
  const match = /^#pools\/real-cost\/([a-z0-9-]{1,100})$/.exec(path);
  // A delisted pool's page is gone; its old links land on the pool list.
  if (!match || delistedSlug(match[1])) return null;
  const q = new URLSearchParams(query), tier = q.get("tier");
  return { slug: match[1], scheme: schemeValue(q.get("scheme")), tier: tier === "founding" || tier === "standard" ? tier : null };
}
