import type { Network, PoolOverview } from "./types.ts";
export type NetworkPoint = { height: number; ts: number; difficulty: number; hashrate: number | null; blockTime: number | null };
export type NetworkHistory = { ok: boolean; source: string; span: string; points: NetworkPoint[]; avgBlockTime: number | null; firstHeight: number | null; lastHeight: number | null };
export const diffChange = (current?: number | null, ref?: number | null, inverse = false) => current && ref ? ((inverse ? ref / current : current / ref) - 1) * 100 : null;
/// PRLDashboard.measuredHashPoints: nearest measured sample, within half a day.
export function measuredHashPoints(n: Network | undefined, samples: NetworkPoint[]): number[][] {
  if (!n?.hashrate || samples.length < 2) return [];
  const points: number[][] = [];
  for (const day of [7, 3, 1]) {
    const target = n.ts - day * 86400;
    const nearest = samples.reduce((a, b) => Math.abs(a.ts - target) <= Math.abs(b.ts - target) ? a : b);
    if (Math.abs(nearest.ts - target) < 43200 && nearest.hashrate != null && nearest.hashrate > 0) points.push([target, nearest.hashrate]);
  }
  points.push([n.ts, n.hashrate]);
  return points;
}
export const hashChange = (points: number[][], days: number) => {
  const last = points.at(-1), first = last && points.find(([ts]) => ts === last[0] - days * 86400);
  return last && first ? diffChange(last[1], first[1]) : null;
};
export function difficultyPoints(n?: Network, inverse = false): number[][] {
  if (!n?.difficulty || (inverse && !n.prlPerTHDay)) return [];
  const v = (diff: number) => inverse ? n.prlPerTHDay! * 1000 * n.difficulty! / diff : diff;
  return [[n.ts - 7 * 86400, n.difficulty7d], [n.ts - 3 * 86400, n.difficulty3d], [n.ts - 86400, n.difficulty24h], [n.ts, n.difficulty]]
    .filter((p): p is [number, number] => p[1] != null && p[1] > 0).map(([t, diff]) => [t, v(diff)]);
}
/// Native PoolsOverview uses max(network, known sum) and hides tiny legend entries.
export function poolShares(rows: PoolOverview[], network: number | null | undefined) {
  const known = rows.filter((r) => r.hashrate != null && r.hashrate > 0).sort((a, b) => b.hashrate! - a.hashrate!);
  const sum = known.reduce((n, r) => n + r.hashrate!, 0), total = Math.max(network || 0, sum);
  if (!total) return { total: 0, slices: [] };
  const slices: { id: string; name: string; hps: number; share: number }[] = [], tail = known.filter((r) => r.hashrate! / total < 0.01).reduce((n, r) => n + r.hashrate!, 0);
  for (const r of known) if (r.hashrate! / total >= 0.01) slices.push({ id: r.id, name: r.name, hps: r.hashrate!, share: r.hashrate! / total });
  if (tail / total > 0.002) slices.push({ id: "_tail", name: "", hps: tail, share: tail / total });
  const rest = total - sum;
  if (rest / total > 0.005) slices.push({ id: "_other", name: "", hps: rest, share: rest / total });
  return { total, slices };
}
