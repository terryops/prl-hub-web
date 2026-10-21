import { test } from "node:test";
import assert from "node:assert/strict";
import { KLINE_PERIODS, candleScale, intraday, klinePeriodLabel, klineURL, parseCandles, priceDigits, shownCount, wheelScale, zoomBounds, zoomed } from "../src/kline.ts";

test("k-line: the latest window is requested explicitly, with the native periods", () => {
  assert.deepEqual(KLINE_PERIODS.map(klinePeriodLabel), ["5m", "15m", "1h", "4h", "1d"]);
  const url = new URL(klineURL(60, 1_800_000_000.7));
  assert.equal(url.origin + url.pathname, "https://safetrade.com/api/v2/trade/public/markets/pearlusdt/k-line");
  assert.deepEqual(Object.fromEntries(url.searchParams), { period: "60", time_from: String(1_800_000_000 - 300 * 3600), time_to: "1800000000", limit: "300" });
});

test("k-line: string rows parse to sorted, deduplicated candles; unusable rows are dropped", () => {
  const candles = parseCandles([
    [1792044000, "1.71", "1.75", "1.69", "1.69", "149254.4701"],
    [1792040400, "1.71", "1.73", "1.71", "1.71", "20009.8173"],
    [1792044000, "1.71", "1.76", "1.69", "1.70", "150000"],
    [1792047600, "1.69", "1.60", "1.70", "1.65", "1"],
    [1792051200, "x", "1", "1", "1", "1"], [1792054800, "0", "1", "1", "1", "1"], [1792058400, "1", "1", "1", "1", "-1"], [1792062000, "1", "1"], "junk", null,
  ]);
  assert.deepEqual(candles, [
    { t: 1792040400, o: 1.71, h: 1.73, l: 1.71, c: 1.71, v: 20009.8173 },
    { t: 1792044000, o: 1.71, h: 1.76, l: 1.69, c: 1.7, v: 150000 },
    // A wick reported inside the body is widened to cover it.
    { t: 1792047600, o: 1.69, h: 1.69, l: 1.65, c: 1.65, v: 1 },
  ]);
  assert.deepEqual(parseCandles([]), []);
  assert.throws(() => parseCandles({ error: "blocked" }), /unexpected response/);
});

test("k-line: before any zoom about one candle per 10 px; zoom stays between 40 px and 3 px a candle", () => {
  assert.deepEqual(zoomBounds(1000, 300), { min: 25, max: 300 });
  assert.deepEqual(zoomBounds(204, 300), { min: 8, max: 68 });
  assert.deepEqual(zoomBounds(1000, 5), { min: 5, max: 5 });
  assert.equal(shownCount(null, 1000, 300), 100);
  assert.equal(shownCount(null, 204, 300), 20);
  assert.equal(shownCount(null, 1000, 7), 7);
  assert.equal(shownCount(66.6, 1000, 300), 67);
  assert.equal(shownCount(1000, 1000, 300), 300);
  assert.equal(shownCount(3, 1000, 300), 25);
  // A narrower window (or a shorter series) clamps an earlier zoom without forgetting it.
  assert.equal(shownCount(200, 204, 300), 68);
});

test("k-line: zoom steps, wheel notches and pinches scale the count, within bounds", () => {
  const bounds = { min: 25, max: 300 };
  assert.equal(zoomed(100, 1.5, bounds), 100 / 1.5);
  assert.equal(zoomed(100, 1 / 1.5, bounds), 150);
  assert.equal(zoomed(30, 2, bounds), 25);
  assert.equal(zoomed(250, .5, bounds), 300);
  assert.equal(zoomed(100, 0, bounds), 100);
  assert.equal(zoomed(100, NaN, bounds), 100);
  // A mouse notch is 15% (Chrome: 100 px; Firefox: 3 lines); rolling away zooms in.
  assert.ok(Math.abs(wheelScale(-100, 0, false) - 1.15) < 1e-12);
  assert.ok(Math.abs(wheelScale(100, 0, false) - 1 / 1.15) < 1e-12);
  assert.ok(Math.abs(wheelScale(-3, 1, false) - 1.15) < 1e-12);
  // At most three notches per event; trackpad deltas add up smoothly.
  assert.ok(Math.abs(wheelScale(-5000, 0, false) - 1.15 ** 3) < 1e-12);
  let count = 100; for (let i = 0; i < 20; i++) count = zoomed(count, wheelScale(-5, 0, false), bounds);
  assert.ok(Math.abs(count - 100 / 1.15) < 1e-9);
  // A pinch (ctrlKey wheel) is stronger per pixel: spreading by 10 px is about 10%.
  assert.ok(Math.abs(wheelScale(-10, 0, true) - Math.exp(.1)) < 1e-12);
  assert.equal(wheelScale(0, 0, false), 1);
  assert.equal(wheelScale(NaN, 0, false), 1);
});

test("k-line: the volume band is the bottom fifth and its tallest bar 72% of it, as on native", () => {
  const s = candleScale([{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 50 }, { t: 2, o: 2, h: 2, l: 1.5, c: 1.5, v: 100 }]);
  assert.equal(s.top, 2.08); assert.equal(s.ceiling, .92);
  assert.ok(Math.abs((s.ceiling - s.floor) / (s.top - s.floor) - .2) < 1e-12);
  assert.equal(s.volumeTop(0), s.floor);
  assert.ok(Math.abs(s.volumeTop(100) - (s.floor + (s.ceiling - s.floor) * .72)) < 1e-12);
  assert.ok(Math.abs(s.volumeTop(50) - (s.floor + (s.ceiling - s.floor) * .36)) < 1e-12);
  // A flat, volumeless series still has a range to draw in.
  const flat = candleScale([{ t: 1, o: 1.7, h: 1.7, l: 1.7, c: 1.7, v: 0 }]);
  assert.ok(flat.top > flat.ceiling && flat.ceiling > flat.floor);
  assert.equal(flat.volumeTop(0), flat.floor);
});

test("k-line: price decimals keep neighbouring ticks distinct; intraday spans show times", () => {
  assert.equal(priceDigits(1.65, 1.77), 2);
  assert.equal(priceDigits(1.701, 1.709), 3);
  assert.equal(priceDigits(1.7, 1.7), 5);
  assert.equal(priceDigits(10, 90), 2);
  const at = (t: number) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
  assert.equal(intraday([at(0), at(35 * 3600)]), true);
  assert.equal(intraday([at(0), at(36 * 3600)]), false);
  assert.equal(intraday([at(0)]), false);
});
