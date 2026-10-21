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
