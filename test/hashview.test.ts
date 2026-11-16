process.env.TZ = "UTC"; // calendar ticks are local time; pin it so the expectations hold anywhere
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLLING_BLOCKS, SPAN_SECONDS, alignedAxis, averageBlockTime, axisDigits, changeSince, duration, historySeries, labelWidth, niceAxis, placeTicks, timeTicks } from "../src/hashview.ts";
import { hashUnit, hashrate } from "../src/format.ts";
import type { NetworkPoint } from "../src/market.ts";

const WORK = 2 ** 48;
/// Points every `every` blocks as the Worker replies: hashrate and block time over the 200 blocks
/// behind each (alerts/src/network.js), null until there are 200.
const chain = (to: number, every: number, blockTime: (h: number) => number, difficulty = 4e7, t0 = 1_790_000_000): NetworkPoint[] => {
  const ts = [0, t0];
  for (let h = 2; h <= to; h++) ts.push(ts[h - 1] + blockTime(h));
  const points: NetworkPoint[] = [];
  for (let h = 1; h <= to; h += every) {
    const bt = h > 200 ? (ts[h] - ts[h - 200]) / 200 : null;
    points.push({ height: h, ts: ts[h], difficulty, hashrate: bt ? difficulty * WORK / bt : null, blockTime: bt });
  }
  return points;
};
const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a / b - 1) < tolerance, `${a} ≈ ${b}`);

test("hash view: the series is the Worker's estimates, from the first point with a full window", () => {
  const points = chain(1000, 10, () => 180), series = historySeries({ ok: true, source: "blockbook", span: "7d", window: 200, points, avgBlockTime: 180, firstHeight: 1, lastHeight: 991 });
  assert.equal(series[0][0], points.find((p) => p.height === 201)!.ts);
  for (const [, v, bt] of series) { close(v, 4e7 * WORK / 180); assert.equal(bt, 180); }
  assert.deepEqual(historySeries(undefined), []);
  assert.deepEqual(historySeries({ ok: true, source: "blockbook", span: "24h", points: [{ height: 1, ts: 1, difficulty: 1, hashrate: 0, blockTime: 0 }], avgBlockTime: null, firstHeight: 1, lastHeight: 1 }), []);
  assert.equal(ROLLING_BLOCKS, 200);
});

test("hash view: the span's mean block time, shown as minutes and seconds", () => {
  assert.equal(averageBlockTime(chain(1001, 10, () => 171)), 171);
  assert.equal(averageBlockTime(chain(1, 1, () => 171)), null);
  assert.equal(averageBlockTime([]), null);
  assert.equal(duration(171.4), "2m 51s");
  assert.equal(duration(179.6), "3m 0s");
  assert.equal(duration(45), "45s");
});

test("hash view: changes compare the latest estimate with the one that long before, if there is one", () => {
  const day = 86400, series = [[0, 50], [2 * day, 40], [6 * day, 60], [7 * day, 75]];
  assert.equal(changeSince(series, 7 * day), 50);
  assert.equal(changeSince(series, 5 * day), 87.5);
  assert.equal(changeSince(series, day), 25);
  // Nothing within a twentieth of the distance: 3 days back is a day from any estimate.
  assert.equal(changeSince(series, 3 * day), null);
  // A span's own length, as the chart and the card both use; all has none.
  assert.equal(changeSince(series, SPAN_SECONDS["7d"]), 50);
  assert.equal(changeSince(series, SPAN_SECONDS.all), null);
  assert.equal(changeSince([[0, 80]], day), null);
  assert.equal(changeSince([[0, 0], [day, 60]], day), null);
});

test("hash view: round gridlines, and difficulty on the same lines with its own round steps", () => {
  // The live 30-day view: 38–74 EH/s and 23.6–39.6M difficulty, as in the design.
  assert.deepEqual(niceAxis(38.1, 74.0), [20, 40, 60, 80]);
  assert.deepEqual(alignedAxis(23.58, 39.63, 3), [20, 30, 40, 50]);
  assert.deepEqual(niceAxis(49.5, 74.1), [40, 50, 60, 70, 80]);
  assert.deepEqual(alignedAxis(34.74, 39.63, 4), [34, 36, 38, 40, 42]);
  assert.deepEqual(niceAxis(61.8, 74.5), [60, 65, 70, 75]);
  assert.deepEqual(alignedAxis(38.81, 39.63, 3), [38.5, 39, 39.5, 40]);
  assert.deepEqual(niceAxis(0, 81.4), [0, 25, 50, 75, 100]);
  assert.deepEqual(alignedAxis(0, 39.63, 4), [0, 10, 20, 30, 40]);
  assert.deepEqual(niceAxis(0.8, 1.21), [0.8, 1, 1.2, 1.4]);
  // A flat series still gets an axis around its value.
  const flat = niceAxis(50, 50);
  assert.ok(flat[0] < 50 && flat.at(-1)! > 50 && flat.length <= 5);
  assert.equal(axisDigits([60, 65, 70, 75]), 0);
  assert.equal(axisDigits([0, 2.5, 5, 7.5]), 1);
  assert.equal(axisDigits([38.5, 39, 39.5, 40]), 1);
});

test("hash view: hash units follow the largest value, and the formatter is unchanged", () => {
  assert.deepEqual(hashUnit(68e18), ["EH/s", 1e18]);
  assert.deepEqual(hashUnit(999e15), ["PH/s", 1e15]);
  assert.deepEqual(hashUnit(12), ["H/s", 1]);
  assert.equal(hashrate(68.32e18), "68.32 EH/s");
  assert.equal(hashrate(1.5e12, "de"), "1,50 TH/s");
  assert.equal(hashrate(12.4), "12 H/s");
  assert.equal(hashrate(undefined), "—");
});

const iso = (s: string) => Date.parse(s) / 1000, at = (ticks: { ts: number }[]) => ticks.map((t) => new Date(t.ts * 1000).toISOString().slice(0, 16));
test("hash view: time ticks fall on whole hours, midnights or months", () => {
  const day = timeTicks(iso("2026-10-19T02:36:38Z"), iso("2026-10-20T02:15:50Z"), 6);
  assert.deepEqual(at(day), ["2026-10-19T04:00", "2026-10-19T08:00", "2026-10-19T12:00", "2026-10-19T16:00", "2026-10-19T20:00", "2026-10-20T00:00"]);
  assert.deepEqual(day.map((t) => t.kind), ["hour", "hour", "hour", "hour", "hour", "day"]);
  // Days count back from the latest midnight, so the newest day is always labelled.
  assert.deepEqual(at(timeTicks(iso("2026-09-20T02:35:51Z"), iso("2026-10-20T02:15:50Z"), 7)), ["2026-09-22T00:00", "2026-09-29T00:00", "2026-10-06T00:00", "2026-10-13T00:00", "2026-10-20T00:00"]);
  assert.equal(timeTicks(iso("2026-10-13T02:41:42Z"), iso("2026-10-20T02:15:50Z"), 7).length, 7);
  const all = timeTicks(iso("2026-04-27T09:00:01Z"), iso("2026-10-20T02:15:50Z"), 7);
  assert.deepEqual(at(all), ["2026-05-01T00:00", "2026-06-01T00:00", "2026-07-01T00:00", "2026-08-01T00:00", "2026-09-01T00:00", "2026-10-01T00:00"]);
  const years = timeTicks(iso("2026-11-10T00:00:00Z"), iso("2027-03-10T00:00:00Z"), 7);
  assert.deepEqual(years.map((t) => t.kind), ["month", "year", "month", "month"]);
  for (const most of [2, 3, 4, 5, 6, 7]) assert.ok(timeTicks(iso("2026-09-20T02:35:51Z"), iso("2026-10-20T02:15:50Z"), most).length <= most);
  assert.deepEqual(timeTicks(10, 10, 5), []);
});

test("hash view: tick labels never touch, wider scripts get fewer ticks", () => {
  const start = iso("2026-10-13T02:41:42Z"), end = iso("2026-10-20T02:15:50Z");
  const english = (t: { ts: number }) => new Date(t.ts * 1000).toLocaleString("en", { month: "short", day: "numeric" });
  const chinese = (t: { ts: number }) => new Date(t.ts * 1000).toLocaleString("zh-Hans", { month: "short", day: "numeric" });
  for (const [label, width] of [[english, 270], [chinese, 270], [english, 1100], [chinese, 1100]] as const) {
    const placed = placeTicks(start, end, width, label);
    assert.ok(placed.length >= 1, `${width}`);
    const extent = (p: typeof placed[number]) => { const w = labelWidth(p.text); return p.anchor === "start" ? [p.x, p.x + w] : p.anchor === "end" ? [p.x - w, p.x] : [p.x - w / 2, p.x + w / 2]; };
    placed.forEach((p, i) => { const [l, r] = extent(p); assert.ok(l >= 0 && r <= width, `${p.text} inside`); if (i) assert.ok(extent(placed[i - 1])[1] + 12 <= l, `${p.text} clear of its neighbour`); });
  }
  assert.ok(placeTicks(start, end, 270, chinese).length < placeTicks(start, end, 270, english).length);
  assert.equal(placeTicks(start, end, 1100, english).length, 7);
  assert.equal(labelWidth("10月14日"), 7 * 4 + 12 * 2);
  assert.equal(placeTicks(start, end, 270, chinese).length, 3);
});

test("hash view: renders in every language with its caption, both axes and no invalid numbers", async () => {
  const { createServer } = await import("vite");
  const React = (await import("react")).default, { renderToStaticMarkup } = await import("react-dom/server");
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "silent" });
  try {
    const { HashChart } = await server.ssrLoadModule("/src/HashChart.tsx");
    const { dictionaries } = await server.ssrLoadModule("/src/i18n/index.ts");
    const samples = chain(3000, 10, (h) => h > 2000 ? 150 : 180, 3.9e7, iso("2026-10-13T00:00:00Z")), points = samples.filter((p) => p.height > 1500);
    const series = (p: NetworkPoint[]) => historySeries({ ok: true, source: "blockbook", span: "24h", window: 200, points: p, avgBlockTime: null, firstHeight: null, lastHeight: null });
    for (const lang of Object.keys(dictionaries)) {
      const t = (k: string) => { assert.ok(dictionaries[lang][k], `${lang}: ${k}`); return dictionaries[lang][k]; };
      const html = renderToStaticMarkup(React.createElement(HashChart, { points, series: series(points), blocks: 200, span: "24h", loading: false, t, lang }));
      assert.doesNotMatch(html, /NaN|Infinity|undefined/, lang);
      assert.ok(html.includes(t("hashRollingEstimate").replace("%@", (200).toLocaleString(lang))), lang);
      assert.match(html, /class="hash-value"><strong>[^<]+<\/strong><span>EH\/s<\/span>/, lang);
      assert.match(html, /class="hash-change"><svg[^]*<span>[+−]\d+\.\d%<\/span><span class="hash-change-span">24h<\/span>/, lang);
      assert.ok(html.includes(`class="hash-axis-title-difficulty">${t("difficulty")}<`), lang);
      assert.match(html, /class="hash-line"/);
      assert.match(html, /class="hash-difficulty"/);
      assert.match(html, /class="hash-block-line"/);
      assert.ok(html.includes(`class="hash-block-title">${t("blockTime")}<span> · ${t("spanAverage").replace("%@", duration(averageBlockTime(points)!))}</span>`), lang);
      assert.doesNotMatch(html, /style=/, "the site's CSP allows no inline styles");
    }
    const en = (k: string) => dictionaries.en[k];
    const all = renderToStaticMarkup(React.createElement(HashChart, { points: samples, series: series(samples), blocks: 200, span: "all", loading: false, t: en, lang: "en" }));
    assert.doesNotMatch(all, /hash-change/, "no change from the first block");
    assert.match(renderToStaticMarkup(React.createElement(HashChart, { points: [], series: [], blocks: 200, span: "24h", loading: true, t: en, lang: "en" })), /skeleton/);
    assert.ok(renderToStaticMarkup(React.createElement(HashChart, { points: samples.slice(0, 21), series: series(samples.slice(0, 21)), blocks: 200, span: "24h", loading: false, t: en, lang: "en" })).includes(en("samplingHistory")));
  } finally { await server.close(); }
});
