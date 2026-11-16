// 我的监控 → 一览 (MonitorCompact.tsx), against the app's PoolCompactList.swift.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { KEY, defaults, readStore, writeStore, configOf } from "../src/store.ts";

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
after(() => server.close());
const { compactMonitor, badgeText, detailText, compactTotal, compactIncome, rigsTone, monitorLayout, poolSlug, MonitorCompactList, LayoutSwitch } = await server.ssrLoadModule("/src/MonitorCompact.tsx");
const { dictionaries } = await server.ssrLoadModule("/src/i18n/index.ts");
const { pools } = await server.ssrLoadModule("/src/store.ts");
const en = (k: string) => dictionaries.en[k];

const addr = (c: string) => "prl1" + c.repeat(38);
const monitor = (id: string, extra: Record<string, unknown> = {}) => ({ id, updated: 1, label: id, pool: "AlphaPool", addr: addr("a"), alert: false, after: 600, ...extra });
const worker = (online: boolean, day = 1e12) => ({ name: "w", online, last: null, rates: { day, live: day * 2 } });
const stats = (workers: ReturnType<typeof worker>[], extra: Record<string, unknown> = {}) => ({ ok: true, windows: ["live", "day"], rates: {}, pending: 0, paid: 0, pendingKind: "pending", workers, partial: false, ...extra });

test("一览: each monitor's pill — rigs online, quiet / gold / rose, and words where no rigs are listed", () => {
  const all = compactMonitor(monitor("a"), { data: stats([worker(true), worker(true)]) }, "day");
  assert.deepEqual([all.found, all.up, all.total, all.rate, all.tone, badgeText(all, en)], [true, 2, 2, 2e12, "ok", "2/2"]);
  assert.equal(detailText(all, en), "2/2 online");
  const some = compactMonitor(monitor("b"), { data: stats([worker(true), worker(false, 0)]) }, "live");
  assert.deepEqual([some.tone, badgeText(some, en), some.rate], ["partial", "1/2", 2e12]);
  const none = compactMonitor(monitor("c"), { data: stats([worker(false, 0)]) }, "day");
  assert.deepEqual([none.tone, badgeText(none, en)], ["down", "0/1"]);
  // A pool that lists no rigs is judged on its hashrate alone.
  const pooled = compactMonitor(monitor("d"), { data: stats([], { rates: { day: 5e12 } }) }, "day");
  assert.deepEqual([pooled.tone, badgeText(pooled, en), pooled.rate], ["ok", "Online", 5e12]);
  const idle = compactMonitor(monitor("e"), { data: stats([]) }, "day");
  assert.deepEqual([idle.tone, badgeText(idle, en)], ["idle", "Offline"]);
  // Not mining at this pool; a read that failed with nothing older; still loading.
  const missing = compactMonitor(monitor("f"), { data: stats([], { missing: true }) }, "day");
  assert.deepEqual([missing.found, missing.tone, badgeText(missing, en), detailText(missing, en)], [false, "idle", "Offline", en("missing")]);
  const failed = compactMonitor(monitor("g"), { failed: true }, "day");
  assert.deepEqual([failed.failed, failed.tone, badgeText(failed, en)], [true, "down", "Failed"]);
  const loading = compactMonitor(monitor("h"), undefined, "day");
  assert.deepEqual([loading.loading, loading.tone, badgeText(loading, en)], [true, "idle", ""]);
  // A failed refresh with older data keeps showing it.
  const stale = compactMonitor(monitor("i"), { data: stats([worker(true)]), failed: true }, "day");
  assert.deepEqual([stale.found, stale.failed, stale.tone], [true, false, "ok"]);
  // The window is the shared choice, or its nearest published one.
  assert.equal(compactMonitor(monitor("j"), { data: stats([worker(true)]) }, "hour").rate, 2e12);
});

test("一览: the total counts reporting monitors, and 24h income once per payout address without F2Pool", () => {
  const items = [
    compactMonitor(monitor("a"), { data: stats([worker(true), worker(false, 0)]) }, "day"),
    compactMonitor(monitor("b"), { data: stats([worker(true)]) }, "day"),
    compactMonitor(monitor("c"), { failed: true }, "day"),
  ];
  assert.deepEqual(compactTotal(items), { rate: 2e12, up: 2, rigs: 3 });
  assert.deepEqual([rigsTone(3, 3), rigsTone(0, 3), rigsTone(2, 3)], ["ok", "down", "partial"]);
  const f2 = monitor("f2", { pool: "F2Pool", addr: "0123456789abcdef" });
  const ms = [monitor("a"), monitor("b"), monitor("c", { addr: addr("c") }), f2];
  const h24 = (values: Record<string, number | null | undefined>) => (a: string) => values[a];
  // Two monitors on one address share its income.
  assert.deepEqual(compactIncome(ms, h24({ [addr("a")]: 2, [addr("c")]: 0.5 })), { sum: 2.5, uncounted: ["F2Pool"] });
  // Nothing until every address has answered; a failed address is left out.
  assert.equal(compactIncome(ms, h24({ [addr("a")]: 2 })), null);
  assert.deepEqual(compactIncome(ms, h24({ [addr("a")]: 2, [addr("c")]: null })), { sum: 2, uncounted: ["F2Pool"] });
  assert.equal(compactIncome(ms, h24({ [addr("a")]: null, [addr("c")]: null })), null);
  assert.equal(compactIncome([f2], h24({})), null);
  assert.deepEqual(compactIncome([monitor("a")], h24({ [addr("a")]: 0 })), { sum: 0, uncounted: [] });
});

test("一览: the layout is this browser's choice — cards by default, kept locally, never synced", () => {
  assert.deepEqual([monitorLayout(undefined), monitorLayout("compact"), monitorLayout("tiles")], ["cards", "compact", "cards"]);
  const memory = new Map<string, string>();
  globalThis.localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) } as Storage;
  writeStore({ ...defaults(), monitorLayout: "compact" });
  assert.equal(readStore().monitorLayout, "compact");
  assert.equal(configOf(readStore()).monitorLayout, undefined);
  memory.set(KEY, JSON.stringify({ ...JSON.parse(memory.get(KEY)!), monitorLayout: "<b>" }));
  assert.equal(readStore().monitorLayout, undefined);
});

test("一览: every pool has a logo in public/pools, light and, where the app has one, dark", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  for (const pool of pools) {
    const slug = poolSlug(pool);
    assert.ok(existsSync(new URL(`../public/pools/${slug}.png`, import.meta.url)), pool);
    assert.ok(css.includes(`.pool-icon-${slug} { background-image: url(/pools/${slug}.png); }`), pool);
    const dark = new URL(`../public/pools/${slug}-dark.png`, import.meta.url);
    assert.equal(css.includes(`url(/pools/${slug}-dark.png)`), existsSync(dark), pool);
  }
});

test("一览: renders the total only for two or more running monitors, tiles in order and paused ones folded", () => {
  const ms = [monitor("One"), monitor("Two", { addr: addr("b"), pool: "Kryptex" }), monitor("Rest", { paused: true, addr: addr("c") }), monitor("Link", { pool: "F2Pool", addr: "0123456789abcdef" })];
  const snaps: Record<string, unknown> = { One: { data: stats([worker(true), worker(false, 0)]) }, Two: { data: stats([worker(true)]) }, Link: { failed: true } };
  const props = (monitors: typeof ms) => ({ monitors, snapshot: (m: { id: string }) => snaps[m.id], selected: "day", h24: (a: string) => ({ [addr("a")]: 1.5, [addr("b")]: 0.5 })[a], usd: 2, money: (v: number) => `$${v.toFixed(2)}`, lang: "en", t: en,
    onOpen() {}, onPause() {}, onEdit() {}, onDelete() {}, onMove() {} });
  const html = renderToStaticMarkup(React.createElement(MonitorCompactList, props(ms)));
  assert.equal((html.match(/class="card compact-total"/g) || []).length, 1);
  assert.ok(html.includes(">Total hashrate</h2>") && html.includes("2/3 online"));
  assert.ok(html.includes("2.00<span class=\"compact-unit\"> TH/s</span>"));
  assert.ok(html.includes("24h +2.00 PRL ≈ ") && html.includes("$4.00") && html.includes(">Excl. F2Pool</span>"));
  // Tiles in the user's order, the pill tones, the failed F2Pool link; the paused one is folded away.
  assert.deepEqual([...html.matchAll(/class="tile-name">([^<]+)</g)].map((m) => m[1]), ["One", "Two", "Link"]);
  assert.deepEqual([...html.matchAll(/rigs-pill rigs-pill-(\w+)">([^<]+)</g)].map((m) => [m[1], m[2]]), [["partial", "2/3 online"], ["partial", "1/2"], ["ok", "1/1"], ["down", "Failed"]]);
  assert.ok(html.includes("pool-icon-alphapool") && html.includes("pool-icon-kryptex") && html.includes("pool-icon-f2pool"));
  assert.ok(html.includes(`aria-expanded="false"><span>Paused · 1</span>`) && !html.includes("paused-line"));
  assert.ok(html.includes(`aria-label="One, 1.00 TH/s, 1/2 online"`));
  // With one running monitor the total would only repeat its tile.
  const single = renderToStaticMarkup(React.createElement(MonitorCompactList, props([ms[0], ms[2]])));
  assert.ok(!single.includes("compact-total") && single.includes("tile-name"));
  // Every language has the six new strings, with the number where its word order puts it.
  for (const d of Object.values(dictionaries) as Record<string, string>[]) {
    for (const k of ["layout", "cardView", "compactView", "excluding", "onlineOf", "failedShort"]) assert.ok(d[k]?.trim(), k);
    assert.ok(d.excluding.includes("%@") && d.onlineOf.includes("%@"));
  }
  const sw = renderToStaticMarkup(React.createElement(LayoutSwitch, { layout: "compact", onChange() {}, t: en }));
  assert.ok(sw.includes(`role="radiogroup" aria-label="Layout"`) && sw.includes(`aria-checked="false" aria-label="Card view"`) && sw.includes(`aria-checked="true" aria-label="Compact view"`));
});
