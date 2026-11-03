// SafeTrade PEARL/USDT candles for the Market page (SafeTrade renamed PRL → PEARL
// on 2026-10-18; the old prlusdt market now 404s). The browser reads SafeTrade's public
// k-line itself: the Worker can't (SafeTrade's WAF blocks Workers' fetch), and the
// native app reads the same endpoint (prl-hub Sources/Trade/SafeTradeClient.kline).
// web/public/_headers allows https://safetrade.com in connect-src for this alone.
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

/// Minutes per candle, as the native CandlePeriodPicker offers them.
export const KLINE_PERIODS = [5, 15, 60, 240, 1440] as const;
export type KlinePeriod = typeof KLINE_PERIODS[number];
/// Enough candles to zoom well out from the default view (~16 KB); SafeTrade serves up to 1000.
export const KLINE_LIMIT = 300;
export const klinePeriodLabel = (p: number) => p < 60 ? `${p}m` : p < 1440 ? `${p / 60}h` : `${p / 1440}d`;

/// Without a time range the API returns the OLDEST candles, so ask for the latest window.
export function klineURL(period: number, now: number, limit = KLINE_LIMIT) {
  const to = Math.floor(now), from = to - period * 60 * limit;
  return `https://safetrade.com/api/v2/trade/public/markets/pearlusdt/k-line?period=${period}&time_from=${from}&time_to=${to}&limit=${limit}`;
}

/// Rows are [ts, open, high, low, close, volume] with prices as strings. Unusable rows
/// are dropped; the wick always spans the body.
export function parseCandles(body: unknown): Candle[] {
  if (!Array.isArray(body)) throw new Error("SafeTrade k-line: unexpected response");
  const byTime = new Map<number, Candle>();
  for (const row of body) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.slice(0, 6).map(Number);
    if (![t, o, h, l, c, v].every(Number.isFinite) || t <= 0 || Math.min(o, h, l, c) <= 0 || v < 0) continue;
    byTime.set(t, { t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export type ZoomBounds = { min: number; max: number };
/// How far a plot `plotWidth` px wide zooms: in to candles 40 px apart (at least 8 on screen),
/// out to 3 px apart, and never past what is loaded.
export function zoomBounds(plotWidth: number, loaded: number): ZoomBounds {
  const max = Math.min(loaded, Math.max(8, Math.floor(plotWidth / 3)));
  return { min: Math.min(max, Math.max(8, Math.ceil(plotWidth / 40))), max };
}
const within = (count: number, { min, max }: ZoomBounds) => Math.min(max, Math.max(min, count));
/// Candles on screen, ending at the latest: the zoomed count, else about one per 10 px.
export const shownCount = (zoom: number | null, plotWidth: number, loaded: number) =>
  Math.round(within(zoom ?? plotWidth / 10, zoomBounds(plotWidth, loaded)));
/// `count` candles seen `scale` times larger (above 1 zooms in: fewer, wider candles). Kept
/// fractional, so a trackpad's many small steps add up instead of each rounding away.
export const zoomed = (count: number, scale: number, bounds: ZoomBounds) =>
  within(Number.isFinite(scale) && scale > 0 ? count / scale : count, bounds);
/// Candles a drag can hide past the right edge: back to the oldest loaded, no further (the native
/// chart doesn't page in older history either).
const panLimit = (shown: number, loaded: number) => Math.max(0, loaded - shown);
const clampHidden = (hidden: number, shown: number, loaded: number) => Math.min(Math.max(Math.round(hidden) || 0, 0), panLimit(shown, loaded));
/// The candles on screen as [start, end) of those loaded: `shown` of them, ending `hidden` short
/// of the latest (native CandleChart.window). 0 hidden ends the chart at the latest candle.
export function visibleRange(loaded: number, shown: number, hidden: number): [number, number] {
  const end = loaded - clampHidden(hidden, shown, loaded);
  return [Math.max(0, end - shown), end];
}
/// `from` candles hidden after a drag of `dx` px to the right, a candle's width at a time (native
/// CandleChart.pannedOffset): the chart follows the finger, so older candles come in from the left.
export function panned(from: number, dx: number, plotWidth: number, shown: number, loaded: number) {
  if (!Number.isFinite(dx) || !(plotWidth > 0) || !(shown > 0)) return clampHidden(from, shown, loaded);
  return clampHidden(from + Math.round(dx / (plotWidth / shown)), shown, loaded);
}
/// `hidden` moved just far enough that candle `index` (of those loaded) is on screen.
export function revealing(hidden: number, index: number, shown: number, loaded: number) {
  const [start, end] = visibleRange(loaded, shown, hidden);
  if (index < start) return clampHidden(loaded - index - shown, shown, loaded);
  if (index >= end) return clampHidden(loaded - 1 - index, shown, loaded);
  return clampHidden(hidden, shown, loaded);
}
/// A touch that has moved (dx, dy) since it went down: undecided within `slop`, then a pan when it
/// set off more sideways than up or down; otherwise it is the page's to scroll (native HoldToScrub).
export function dragIntent(dx: number, dy: number, slop: number): "pan" | "scroll" | null {
  if (!(Math.hypot(dx, dy) >= slop)) return null;
  return Math.abs(dx) > Math.abs(dy) ? "pan" : "scroll";
}
/// Seconds between candles, from the data itself (native candleMinutes): another period is another series.
export function candleSpacing(candles: Candle[]) {
  let gap = 0;
  for (let i = 1; i < candles.length; i++) { const d = candles[i].t - candles[i - 1].t; if (d > 0 && (!gap || d < gap)) gap = d; }
  return gap;
}
/// One wheel event as a zoom scale. A mouse notch (100 px, or 3 lines in Firefox) is 15%, as on
/// the native Mac chart, and rolling away from you (deltaY < 0) zooms in; one event counts for
/// at most three notches. A trackpad pinch arrives as a ctrlKey wheel with small deltas, so it
/// is scaled up to feel like the pinch itself.
export function wheelScale(deltaY: number, deltaMode: number, pinch: boolean) {
  const px = deltaY * (deltaMode === 1 ? 100 / 3 : deltaMode === 2 ? 800 : 1);
  if (!Number.isFinite(px)) return 1;
  return Math.exp(-Math.max(-300, Math.min(300, px)) * (pinch ? .01 : Math.log(1.15) / 100));
}

/// Native CandleVolumeBand: price above `ceiling`, volume bars in the bottom fifth, the
/// tallest at 72% of the band so its caption fits above it.
export function candleScale(candles: Candle[]) {
  const lo = Math.min(...candles.map((c) => c.l)), hi = Math.max(...candles.map((c) => c.h));
  const pad = Math.max((hi - lo) * .08, .0001), top = hi + pad, ceiling = lo - pad;
  const floor = ceiling - (top - ceiling) * .2 / .8, maxVolume = Math.max(0, ...candles.map((c) => c.v));
  const volumeTop = (v: number) => maxVolume > 0 ? floor + (ceiling - floor) * .72 * Math.min(Math.max(v, 0) / maxVolume, 1) : floor;
  return { lo, hi, top, ceiling, floor, maxVolume, volumeTop };
}

/// Enough decimals that neighbouring price ticks (~¼ of the range apart) never print alike.
export const priceDigits = (lo: number, hi: number) => Math.min(6, Math.max(2, Math.ceil(-Math.log10(Math.max(hi - lo, .0001) / 4))));

/// Under a day and a half on screen the axis shows times, otherwise dates.
export const intraday = (candles: Candle[]) => candles.length > 1 && candles.at(-1)!.t - candles[0].t < 36 * 3600;
