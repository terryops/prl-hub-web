import type { Network, PoolOverview } from "./types.ts";
export type NetworkPoint = { height: number; ts: number; difficulty: number; hashrate: number | null; blockTime: number | null };
/// `hashrate` and `blockTime` cover the `window` blocks behind each point (alerts/src/network.js).
export type NetworkHistory = { ok: boolean; source: string; span: string; window?: number; points: NetworkPoint[]; avgBlockTime: number | null; firstHeight: number | null; lastHeight: number | null };
export const diffChange = (current?: number | null, ref?: number | null, inverse = false) => current && ref ? ((inverse ? ref / current : current / ref) - 1) * 100 : null;
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
