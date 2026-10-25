import type { Network, PoolOverview } from "./types.ts";
export type NetworkPoint = { height: number; ts: number; difficulty: number; hashrate: number | null; blockTime: number | null };
/// `hashrate` and `blockTime` cover the `window` blocks behind each point (alerts/src/network.js).
export type NetworkHistory = { ok: boolean; source: string; span: string; window?: number; points: NetworkPoint[]; avgBlockTime: number | null; firstHeight: number | null; lastHeight: number | null };
export const diffChange = (current?: number | null, ref?: number | null, inverse = false) => current && ref ? ((inverse ? ref / current : current / ref) - 1) * 100 : null;
export const DIFF_WINDOWS = { "24h": 86400, "3d": 3 * 86400, "7d": 7 * 86400 } as const;
export type DiffWindow = keyof typeof DIFF_WINDOWS;
const MEAN_KEY = { "24h": "difficulty24h", "3d": "difficulty3d", "7d": "difficulty7d" } as const;
/// The difficulty `w` before the overview. The Worker's difficulty24h/3d/7d are time-weighted means over
/// each window (alerts/src/overview.js averageDifficulty), not the difficulty that long ago: while it
/// climbs the mean sits near the window's midpoint, so reading it as the start halves every change.
/// Prefer the /v1/network/history sample nearest that time (within a twentieth of the window, as
/// changeSince); without one, the start of a steady trend with that mean, 2 × mean − now.
export function difficultyAgo(n: Network | undefined | null, w: DiffWindow, points?: readonly NetworkPoint[]): number | null {
  if (!n?.difficulty) return null;
  const seconds = DIFF_WINDOWS[w], target = n.ts - seconds;
  const near = (points || []).filter((p) => p.difficulty > 0 && p.ts < n.ts).reduce<NetworkPoint | null>((a, b) => !a || Math.abs(b.ts - target) < Math.abs(a.ts - target) ? b : a, null);
  if (near && Math.abs(near.ts - target) <= seconds / 20) return near.difficulty;
  const mean = n[MEAN_KEY[w]];
  return mean && mean > 0 && 2 * mean > n.difficulty ? 2 * mean - n.difficulty : null;
}
/// The difficulty (or, inverse, output per TH) chart: the history's samples over the last 7 days and
/// the overview's current value; without history, the window starts difficultyAgo estimates.
export function difficultyPoints(n?: Network, inverse = false, points?: readonly NetworkPoint[]): number[][] {
  if (!n?.difficulty || (inverse && !n.prlPerTHDay)) return [];
  const v = (diff: number) => inverse ? n.prlPerTHDay! * 1000 * n.difficulty! / diff : diff;
  const from = n.ts - DIFF_WINDOWS["7d"], samples = (points || []).filter((p) => p.difficulty > 0 && p.ts >= from && p.ts < n.ts).map((p) => [p.ts, p.difficulty] as [number, number]);
  const past = samples.length ? samples : (["7d", "3d", "24h"] as const).map((w) => [n.ts - DIFF_WINDOWS[w], difficultyAgo(n, w)] as [number, number | null]);
  return [...past, [n.ts, n.difficulty] as [number, number]]
    .filter((p): p is [number, number] => p[1] != null && p[1] > 0).sort((a, b) => a[0] - b[0]).map(([t, diff]) => [t, v(diff)]);
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
