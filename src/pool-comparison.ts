import type { PoolOverview, PoolPayout } from "./types.ts";

export type PoolSortKey = "name" | "hashrate" | "earnings" | "blocks" | "fee" | "realFee" | "orphans" | "lastBlock";
export function realCostPeriods(rows: PoolOverview[]) {
  const periods = new Map<string, { start: number; end: number; names: string[] }>();
  for (const row of rows) {
    for (const payout of poolPayouts(row)) {
      if (payout.realFeePercent == null || !Number.isFinite(payout.realFeePercent)) continue;
      const sample = payout.realFeePeriod ?? (payout.scheme == null || payout.scheme === row.realFeeMeasurement?.scheme ? row.realFeeMeasurement : null);
      if (!sample || !Number.isFinite(sample.start) || !Number.isFinite(sample.end) || sample.start <= 0 || sample.end <= sample.start || sample.end * 1000 > 8.64e15) continue;
      const name = payout.scheme ? `${row.name} (${payout.scheme})` : row.name;
      const key = `${sample.start}:${sample.end}`, period = periods.get(key);
      if (period) { if (!period.names.includes(name)) period.names.push(name); }
      else periods.set(key, { start: sample.start, end: sample.end, names: [name] });
    }
  }
  return [...periods.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
/** Whether any shown Real Cost is a PPS-family measurement. Those windows end at 00:00 UTC and
 * only move forward after the pool settles the day, so they lag by a few hours each morning. */
export function hasPpsRealCost(rows: PoolOverview[]) {
  return rows.some((row) => poolPayouts(row).some((p) => p.realFeePercent != null && Number.isFinite(p.realFeePercent) &&
    ppsScheme(p.scheme ?? row.realFeeMeasurement?.scheme)));
}
/** 00:00 UTC of the current UTC day, when PPS Real Cost windows end. */
export const ppsWindowEnd = (now = Date.now()) => Math.floor(now / 86400000) * 86400000;
export function relativePoolBlock(ts: number, lang: string, now = Date.now() / 1000): string {
  const seconds = ts - now, magnitude = Math.abs(seconds);
  const unit = magnitude >= 86400 ? "day" : magnitude >= 3600 ? "hour" : magnitude >= 60 ? "minute" : "second";
  const scale = unit === "day" ? 86400 : unit === "hour" ? 3600 : unit === "minute" ? 60 : 1;
  return new Intl.RelativeTimeFormat(lang, { style: "short", numeric: "auto" }).format(Math.round(seconds / scale), unit);
}
export const ppsScheme = (scheme: string | null | undefined) => /^(PPS|FPPS)/i.test(scheme?.trim() || "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** The pool's 7-day block luck, when the service has a week of samples for a shared-reward row. */
export function weekLuck(pool: PoolOverview) {
  const week = pool.luck?.["7d"], theory = pool.theoreticalEarningsPerPH;
  if (pool.pps || pool.solo || !week || !finite(week.ratio) || week.ratio < 0 || week.ratio >= 100 ||
      !finite(week.expectedBlocks) || week.expectedBlocks <= 0 || !finite(theory) || theory <= 0) return null;
  return { ratio: week.ratio, expectedBlocks: week.expectedBlocks, estimate: week.ratio * theory };
}
/** 预估收益 per PH·day, gross of fee. With a week of samples: today's theoretical yield × the
 *  pool's 7-day luck — the luck reaches a PPLNS miner, the price is today's difficulty, the one
 *  PPS rows are quoted at. One day of ~20 blocks swings ±20% on luck alone. Otherwise 24h. */
export function estimatedYield(pool: PoolOverview): number | null {
  return weekLuck(pool)?.estimate ?? pool.earningsPerPH;
}
/** A week's sample is the blocks the pool's work should have found, not the ones it got. */
export function yieldTrustworthy(pool: PoolOverview): boolean {
  const week = weekLuck(pool);
  return week ? week.expectedBlocks >= 20 : pool.trustworthy;
}
export function poolPayouts(pool: PoolOverview): PoolPayout[] {
  const payouts: PoolPayout[] = pool.payouts?.length ? pool.payouts : [{
    scheme: pool.scheme, fee: pool.fee, grossPerPH: pool.earningsPerPH,
    realFeePercent: null, estimated: pool.pps || (pool.blocksSample ?? 0) < 20, solo: pool.solo,
  }];
  const week = weekLuck(pool);
  if (!week) return payouts;
  return payouts.map((p) => p.solo || ppsScheme(p.scheme) ? p
    : { ...p, grossPerPH: week.estimate, estimated: week.expectedBlocks < 20, weekly: true });
}
/** The percentage the pool keeps from a payout. PPS-family: the measured Real Cost, or the tariff
 *  until one is measured; every PPS pool is quoted at the same network figure, so this is all that
 *  tells them apart. Shared-reward: the fee only — the gross figure is what the pool's blocks paid,
 *  so its luck and lost work are already in it (their Real Cost estimate takes luck out to measure the
 *  rest, and would count that rest twice here). A payout without a scheme follows the row's PPS flag. */
export function payoutCost(p: PoolPayout, pool?: PoolOverview): number | null {
  const pps = p.scheme?.trim() ? ppsScheme(p.scheme) : !!pool?.pps;
  const cost = pps && finite(p.realFeePercent) ? p.realFeePercent : p.fee;
  return finite(cost) ? cost : null;
}
/** 预估收益 a miner keeps, PRL per PH·day: the gross figure less `payoutCost`. Unknown when the
 *  gross figure or the cost is missing, or for SOLO. */
export function netPerPH(p: PoolPayout, pool?: PoolOverview): number | null {
  const cost = payoutCost(p, pool);
  return p.solo || pool?.solo || !finite(p.grossPerPH) || cost == null ? null : p.grossPerPH * (1 - cost / 100);
}
/** A row's best take-home yield across its payout schemes, for sorting. */
export function netYield(pool: PoolOverview): number | null {
  const values = poolPayouts(pool).map((p) => netPerPH(p, pool)).filter(finite);
  return values.length ? Math.max(...values) : null;
}
/** The green mark: the highest take-home yield among trustworthy shared-reward payouts. PPS
 *  (a network figure) and SOLO (a lottery) are never ranked. */
export const rankedYield = (pool: PoolOverview, p: PoolPayout) =>
  yieldTrustworthy(pool) && !pool.pps && !pool.solo && !p.solo && !ppsScheme(p.scheme) ? netPerPH(p, pool) : null;
export function bestYield(rows: PoolOverview[]): number | null {
  const values = rows.flatMap((r) => poolPayouts(r).map((p) => rankedYield(r, p))).filter(finite);
  return values.length ? Math.max(...values) : null;
}
/** The share of a pool's blocks over the last week that were orphaned, in percent, or null when no
 *  source has it: the pool's own block list or the orphans an explorer's node saw (`source`). */
export function orphanRate(pool: PoolOverview) {
  const o = pool.orphans;
  if (!o || !Number.isSafeInteger(o.blocks) || o.blocks <= 0 || !Number.isSafeInteger(o.orphans) || o.orphans < 0 ||
      o.orphans > o.blocks || !finite(o.start) || !finite(o.end) || o.end <= o.start) return null;
  return { percent: o.orphans / o.blocks * 100, orphans: o.orphans, blocks: o.blocks, start: o.start, end: o.end,
    source: o.source === "chain" ? "chain" as const : "pool" as const };
}
/** The payout families the scheme guide explains. PPS+ and FPPS are PPS variants. */
export const schemeFamilies = ["PPS", "PROP", "PPLNS", "SOLO"] as const;
export type SchemeFamily = typeof schemeFamilies[number];
export function schemeFamily(scheme: string | null | undefined, solo = false): SchemeFamily | null {
  const name = scheme?.trim().toUpperCase() || "";
  if (solo || name === "SOLO") return "SOLO";
  if (ppsScheme(name)) return "PPS";
  return name === "PROP" || name === "PPLNS" ? name : null;
}
/** The pools on the page under each family, largest first, with the scheme each one names (a pool
 *  with two contracts, like Pearl Fortune's PPS and PPLNS, is under both). Unnamed schemes are left out. */
export function poolsByScheme(rows: PoolOverview[]) {
  const out = Object.fromEntries(schemeFamilies.map((f) => [f, [] as { pool: PoolOverview; scheme: string }[]])) as
    Record<SchemeFamily, { pool: PoolOverview; scheme: string }[]>;
  const size = (r: PoolOverview) => finite(r.hashrate) ? r.hashrate : -1;
  for (const pool of [...rows].sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name))) {
    const seen = new Set<SchemeFamily>();
    for (const p of poolPayouts(pool)) {
      const family = schemeFamily(p.scheme, pool.solo || p.solo);
      if (!family || seen.has(family)) continue;
      seen.add(family);
      out[family].push({ pool, scheme: p.scheme?.trim().toUpperCase() || family });
    }
  }
  return out;
}
const OWN_API_POOLS = ["Kryptex", "HeroMiners", "Pearl Fortune"];
/** True when this snapshot could not read the pool's own API, so the row shows other sources' figures. */
export const ownApiMissing = (r: Pick<PoolOverview, "name" | "solo" | "feeFromPoolAPI">, partial: boolean | undefined) =>
  !!partial && !r.solo && OWN_API_POOLS.includes(r.name) && !r.feeFromPoolAPI;
export function sortPools(rows: PoolOverview[], key: PoolSortKey, ascending: boolean): PoolOverview[] {
  const value = (p: PoolOverview) => ({
    hashrate: p.hashrate, earnings: p.solo ? null : netYield(p), blocks: p.blocksPerDay,
    fee: p.fee, realFee: poolPayouts(p).find((c) => c.realFeePercent != null && Number.isFinite(c.realFeePercent))?.realFeePercent,
    orphans: orphanRate(p)?.percent, lastBlock: p.lastBlockTime,
  })[key as Exclude<PoolSortKey, "name">];
  return [...rows].sort((a, b) => {
    const tie = a.name.localeCompare(b.name);
    if (key === "name") return ascending ? tie : -tie;
    const av = value(a), bv = value(b);
    if (av == null || !Number.isFinite(av)) return bv == null || !Number.isFinite(bv) ? tie : 1;
    if (bv == null || !Number.isFinite(bv)) return -1;
    return av === bv ? tie : ascending ? av - bv : bv - av;
  });
}

export function poolSparkline(points: NonNullable<PoolOverview["history"]>) {
  const ordered = points.filter((p) => Number.isFinite(p.ts)).sort((a, b) => a.ts - b.ts);
  const valid = ordered.filter((p) => p.hashrate != null && Number.isFinite(p.hashrate) && p.hashrate >= 0);
  if (valid.length < 2 || ordered.at(-1)!.ts <= ordered[0].ts) return null;
  const low = Math.min(...valid.map((p) => p.hashrate!)), high = Math.max(...valid.map((p) => p.hashrate!));
  const span = ordered.at(-1)!.ts - ordered[0].ts, range = Math.max(high - low, high * .02, 1);
  let connected = false, path = "", end: [number, number] | null = null;
  for (const point of ordered) {
    if (point.hashrate == null || !Number.isFinite(point.hashrate) || point.hashrate < 0) { connected = false; end = null; continue; }
    const x = 2 + 136 * (point.ts - ordered[0].ts) / span;
    const y = high === low ? 20 : 3 + 34 * (1 - (point.hashrate - low) / range);
    path += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    connected = true; end = [x, y];
  }
  return { path, end };
}
