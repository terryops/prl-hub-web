import type { PoolOverview, PoolPayout } from "./types.ts";

export type PoolSortKey = "name" | "hashrate" | "earnings" | "blocks" | "fee" | "realFee" | "lastBlock";
export function relativePoolBlock(ts: number, lang: string, now = Date.now() / 1000): string {
  const seconds = ts - now, magnitude = Math.abs(seconds);
  const unit = magnitude >= 86400 ? "day" : magnitude >= 3600 ? "hour" : magnitude >= 60 ? "minute" : "second";
  const scale = unit === "day" ? 86400 : unit === "hour" ? 3600 : unit === "minute" ? 60 : 1;
  return new Intl.RelativeTimeFormat(lang, { style: "short", numeric: "auto" }).format(Math.round(seconds / scale), unit);
}
export function poolPayouts(pool: PoolOverview): PoolPayout[] {
  return pool.payouts?.length ? pool.payouts : [{
    scheme: pool.scheme, fee: pool.fee, grossPerPH: pool.earningsPerPH,
    realFeePercent: null, estimated: pool.pps || (pool.blocksSample ?? 0) < 20, solo: pool.solo,
  }];
}
export function sortPools(rows: PoolOverview[], key: PoolSortKey, ascending: boolean): PoolOverview[] {
  const value = (p: PoolOverview) => ({
    hashrate: p.hashrate, earnings: p.solo ? null : p.earningsPerPH, blocks: p.blocksPerDay,
    fee: p.fee, realFee: poolPayouts(p).find((c) => /^(PPS|FPPS)/i.test(c.scheme || ""))?.realFeePercent, lastBlock: p.lastBlockTime,
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
