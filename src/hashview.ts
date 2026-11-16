// The Network hashrate card and chart (HashChart.tsx). The Worker's /v1/network/history gives each
// sampled point the hashrate and block time of the 200 blocks behind it (alerts/src/network.js); this
// turns them into series, changes, axes and time ticks.
import type { NetworkHistory, NetworkPoint } from "./market.ts";

export const HASH_SPANS = ["24h", "7d", "30d", "all"] as const;
export type HashSpan = typeof HASH_SPANS[number];
export const SPAN_SECONDS: Record<HashSpan, number | null> = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, all: null };
/// The Worker's window, for its caption when a reply does not name one.
export const ROLLING_BLOCKS = 200;

/// [ts, H/s, seconds per block] for the points that have a full window behind them.
export function historySeries(history?: NetworkHistory): number[][] {
  return (history?.points || []).filter((p): p is NetworkPoint & { hashrate: number; blockTime: number } => p.hashrate != null && p.hashrate > 0 && p.blockTime != null && p.blockTime > 0)
    .map((p) => [p.ts, p.hashrate, p.blockTime]);
}

/// Percent change of the latest estimate over `seconds`: against the estimate nearest that long
/// before it, when one lies within a twentieth of the distance (null otherwise, or without seconds).
/// Each reply holds the samples nearest 24h, 3d, 7d and 30d back, so every span finds the same one.
export function changeSince(series: readonly number[][], seconds: number | null): number | null {
  const last = series.at(-1);
  if (!seconds || !last || series.length < 2) return null;
  const target = last[0] - seconds, from = series.reduce((a, b) => Math.abs(b[0] - target) < Math.abs(a[0] - target) ? b : a);
  return from !== last && Math.abs(from[0] - target) <= seconds / 20 && from[1] > 0 ? (last[1] / from[1] - 1) * 100 : null;
}

/// Mean seconds per block across the span's samples.
export function averageBlockTime(points: readonly NetworkPoint[]): number | null {
  const first = points[0], last = points.at(-1);
  return first && last && last.height > first.height && last.ts > first.ts ? (last.ts - first.ts) / (last.height - first.height) : null;
}
/// 171 → "2m 51s", 45 → "45s".
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const NICE = [1, 2, 2.5, 5];
const clean = (v: number) => Number(v.toPrecision(12));
const widen = (lo: number, hi: number): [number, number] => hi > lo ? [lo, hi] : [lo - (Math.abs(lo) * .05 || 1), hi + (Math.abs(hi) * .05 || 1)];

/// Round gridline values covering lo…hi: the smallest round step that needs at most `most` intervals.
export function niceAxis(low: number, high: number, most = 4): number[] {
  const [lo, hi] = widen(low, high), from = Math.floor(Math.log10((hi - lo) / most));
  for (let exp = from; exp < from + 4; exp++) for (const m of NICE) {
    const step = m * 10 ** exp, first = Math.floor(lo / step + 1e-9), n = Math.ceil(hi / step - 1e-9) - first;
    if (n <= most) return Array.from({ length: Math.max(1, n) + 1 }, (_, k) => clean((first + k) * step));
  }
  return [lo, hi];
}

/// Gridlines for a second series on the same lines: exactly `intervals` round steps covering lo…hi.
export function alignedAxis(low: number, high: number, intervals: number): number[] {
  const [lo, hi] = widen(low, high), from = Math.floor(Math.log10((hi - lo) / intervals));
  for (let exp = from; exp < from + 4; exp++) for (const m of NICE) {
    const step = m * 10 ** exp, first = Math.floor(lo / step + 1e-9);
    if ((first + intervals) * step >= hi - step * 1e-9) return Array.from({ length: intervals + 1 }, (_, k) => clean((first + k) * step));
  }
  return Array.from({ length: intervals + 1 }, (_, k) => lo + (hi - lo) * k / intervals);
}

/// Decimals that tell the ticks of an axis apart (2.5 steps need one).
export const axisDigits = (ticks: readonly number[]) => ticks.length < 2 ? 0 : Math.max(0, ...ticks.map((v) => (String(clean(v)).split(".")[1] || "").length));

export type TimeTick = { ts: number; kind: "hour" | "day" | "month" | "year" };
const HOUR_STEPS = [1, 2, 3, 4, 6, 12], DAY_STEPS = [1, 2, 3, 7, 14], MONTH_STEPS = [1, 2, 3, 6, 12];
const local = (ts: number) => new Date(ts * 1000), seconds = (d: Date) => d.getTime() / 1000;

/// Calendar ticks in local time between start and end, at most `most` of them: whole hours from
/// midnight (a midnight is labelled with its date), local midnights counted back from the latest
/// one so the newest day is always marked, or the first of the month (January shows the year).
export function timeTicks(start: number, end: number, most: number): TimeTick[] {
  if (!(end > start)) return [];
  const within = (ts: number) => ts >= start && ts <= end;
  for (const h of HOUR_STEPS) {
    if ((end - start) / (h * 3600) > most + 1) continue;
    const d = local(start); d.setHours(0, 0, 0, 0);
    const ticks: TimeTick[] = [];
    for (let i = 0; i < 1000 && seconds(d) <= end; i++) {
      if (within(seconds(d)) && d.getHours() % h === 0) ticks.push({ ts: seconds(d), kind: d.getHours() === 0 ? "day" : "hour" });
      d.setHours(d.getHours() + 1, 0, 0, 0);
    }
    if (ticks.length <= most) return ticks;
  }
  for (const n of DAY_STEPS) {
    if ((end - start) / (n * 86400) > most + 1) continue;
    const d = local(end); d.setHours(0, 0, 0, 0);
    const ticks: TimeTick[] = [];
    for (let i = 0; i < 1000 && seconds(d) >= start; i++) { if (within(seconds(d))) ticks.unshift({ ts: seconds(d), kind: "day" }); d.setDate(d.getDate() - n); }
    if (ticks.length <= most) return ticks;
  }
  for (const n of MONTH_STEPS) {
    const d = local(start); d.setHours(0, 0, 0, 0); d.setDate(1);
    const ticks: TimeTick[] = [];
    for (let i = 0; i < 2000 && seconds(d) <= end; i++) {
      if (within(seconds(d)) && d.getMonth() % n === 0) ticks.push({ ts: seconds(d), kind: d.getMonth() === 0 ? "year" : "month" });
      d.setMonth(d.getMonth() + 1);
    }
    if (ticks.length <= most) return ticks;
  }
  return [];
}
export const TICK_FORMAT: Record<TimeTick["kind"], Intl.DateTimeFormatOptions> = {
  hour: { hour: "2-digit", minute: "2-digit" }, day: { month: "short", day: "numeric" }, month: { month: "short" }, year: { year: "numeric" },
};

/// Rough width of a 12 px label: CJK and Hangul glyphs are about twice as wide as Latin ones.
export const labelWidth = (text: string) => [...text].reduce((w, c) => w + (c.codePointAt(0)! >= 0x2e80 ? 12 : 7), 0);
export type PlacedTick = { ts: number; text: string; x: number; anchor: "start" | "middle" | "end" };

/// The most time ticks whose labels fit across `width` px without touching. Labels near an edge
/// are anchored to it so they stay inside the plot.
export function placeTicks(start: number, end: number, width: number, label: (tick: TimeTick) => string, gap = 12): PlacedTick[] {
  for (let most = Math.max(2, Math.min(7, Math.floor(width / 56))); most >= 1; most--) {
    const placed = timeTicks(start, end, most).map((tick): PlacedTick & { w: number } => {
      const text = label(tick), w = labelWidth(text), x = (tick.ts - start) / (end - start) * width;
      return { ts: tick.ts, text, x, w, anchor: x < w / 2 ? "start" : x > width - w / 2 ? "end" : "middle" };
    });
    const span = (p: PlacedTick & { w: number }) => p.anchor === "start" ? [p.x, p.x + p.w] : p.anchor === "end" ? [p.x - p.w, p.x] : [p.x - p.w / 2, p.x + p.w / 2];
    if (placed.every((p, i) => i === 0 || span(placed[i - 1])[1] + gap <= span(p)[0])) return placed.map(({ w: _, ...p }) => p);
  }
  return [];
}
