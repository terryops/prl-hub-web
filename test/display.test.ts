import { test, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { dollars, usd } from "../src/format.ts";
import { dual } from "../src/currency.ts";

test("money: negative signs precede every currency symbol, with localized precision and missing-rate fallback", () => {
  const fx = { ok: true, base: "USD" as const, ts: 1, rates: { CNY: 7, JPY: 100, RUB: 90 } };
  assert.equal(dual(-584.5, "CNY", "zh-Hans", fx), "−$584.50 · −¥4,091.50");
  assert.equal(dual(-2, "JPY", "zh-Hans", fx), "−$2.00 · −¥200");
  assert.equal(usd(-584.5), "−$584.50");
  assert.equal(dollars("-100000000", 584.5, "zh-Hans"), "−$584.50");
  assert.equal(dual(-2, "CNY", "zh-Hans"), "−$2.00");
  assert.equal(dual(0, "CNY", "zh-Hans", fx), "$0.00 · ¥0.00");
  assert.equal(usd(Infinity), "—");
  assert.equal(dual(-2, "RUB", "ru", fx), `−$${(2).toLocaleString("ru", { minimumFractionDigits: 2 })} · −₽${(180).toLocaleString("ru", { minimumFractionDigits: 2 })}`);
});

// Render real components without a browser, a listening socket or upstream fetches.
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
after(() => server.close());
const { MarketData, LineChart } = await server.ssrLoadModule("/src/MarketData.tsx");
const { FleetCalculator } = await server.ssrLoadModule("/src/FleetCalculator.tsx");
const { defaults } = await server.ssrLoadModule("/src/store.ts");
const { dictionaries } = await server.ssrLoadModule("/src/i18n/index.ts");
const { Money, PRLAmount } = await server.ssrLoadModule("/src/Money.tsx");
const { WorkerList, visibleWorkers } = await server.ssrLoadModule("/src/Workers.tsx");
const { chartRange, nearestPoint } = await server.ssrLoadModule("/src/chart.ts");
const { NetworkSummary, PoolComparison } = await server.ssrLoadModule("/src/PoolOverview.tsx");
const { WatchWallet } = await server.ssrLoadModule("/src/WatchWallet.tsx");
const { PaymentAddress, PaymentHead } = await server.ssrLoadModule("/src/Payment.tsx");
test("online-only worker filtering omits offline rows and handles an empty result", () => {
  const rows = [{ name: "offline", online: false }, { name: "online", online: true }];
  assert.deepEqual(visibleWorkers(rows, "en", false, true).map((w: { name: string }) => w.name), ["online"]);
  const html = renderToStaticMarkup(React.createElement(WorkerList, { workers: [rows[0]], window: "live", lang: "en", t: (k: string) => dictionaries.en[k], onlineOnly: true }));
  assert.ok(html.includes(dictionaries.en.noOnlineWorkers)); assert.ok(!html.includes("worker-row"));
});

const ts = 1791590400;
const price = { usd: 1.3883, ts, source: "fixture", change5m: 1, change1h: 2, change24h: 3 };
const points = [[ts - 86400, 1.36], [ts, 1.3883]];

test("market: the initial view expands PRL price on SafeTrade candles, keeps short-term changes and localized chart dates", () => {
  for (const lang of Object.keys(dictionaries)) {
    const t = (key: string) => dictionaries[lang][key];
    const html = renderToStaticMarkup(React.createElement(MarketData, { price, history: { source: "fixture", points }, lang, t, refresh: 0, money: (v: number) => usd(v) }));
    assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1);
    assert.match(html, /metric-selected/);
    // The PRL Price card's title is its view switch, K-line first and selected; candles load in the browser.
    assert.ok(html.includes(`<h2 class="chart-views" aria-label="${t("prlPrice")}"><button class="selected" aria-pressed="true">${t("kline")}</button><button class="" aria-pressed="false">${t("priceView")}</button></h2>`), lang);
    for (const period of ["5m", "15m", "1h", "4h", "1d"]) assert.ok(html.includes(`>${period}</button>`), period);
    assert.ok(html.includes(`${t("source")} · SafeTrade · PEARL/USDT`));
    assert.ok(!html.includes("chart-plot") && html.includes("skeleton-chart"));
    for (const delta of ["+1.00%", "+2.00%", "+3.00%"]) assert.ok(html.includes(delta));
    const chart = renderToStaticMarkup(React.createElement(LineChart, { points, lang, label: "History", empty: "Empty" }));
    for (const [time] of points) {
      assert.ok(chart.includes(new Date(time * 1000).toLocaleString(lang, { hour: "2-digit", minute: "2-digit" })));
      assert.ok(chart.includes(new Date(time * 1000).toLocaleString(lang)));
    }
  }
});

test("calculator: default and saved hourly rents display at most four decimals without mutating stored daily rent", () => {
  const state = { ...defaults(), lang: "zh-Hans", devices: [{ id: "rent", updated: 1, name: "Rental", gpu: "RTX 5070", count: 1, rented: true, hoursPerDay: 24, rentDaily: 38 }] };
  const html = renderToStaticMarkup(React.createElement(FleetCalculator, { state, onState: () => assert.fail("render must not write configuration"), incomes: {}, t: (key: string) => dictionaries["zh-Hans"][key] }));
  assert.equal((html.match(/value="1\.5833"/g) || []).length, 2);
  assert.ok(!html.includes("1.583333333"));
  assert.equal(state.devices[0].rentDaily, 38);
});

test("calculator: device previews cap four live cards, retain order and localize totals without changing configuration", () => {
  for (const lang of Object.keys(dictionaries)) for (const count of [0, 3, 4, 5, 115]) {
    const devices = Array.from({ length: count }, (_, i) => ({ id: `rig-${i + 1}`, updated: 1, name: `Rig-${i + 1}`, gpu: "RTX 4090", count: 1, rented: false, hoursPerDay: 24 }));
    const tombstone = { id: "deleted", updated: 2, name: "Deleted rig", gpu: "RTX 4090", count: 1, rented: false, hoursPerDay: 24, deleted: true };
    devices.splice(Math.min(3, count), 0, tombstone);
    const state = { ...defaults(), lang, devices }, original = JSON.stringify(state), t = (key: string) => dictionaries[lang][key];
    const html = renderToStaticMarkup(React.createElement(FleetCalculator, { state, onState: () => assert.fail("preview must not write configuration"), incomes: {}, t }));
    const section = html.slice(html.indexOf('id="fleet-devices"'), html.indexOf('id="fleet-catalog"'));
    assert.equal((section.match(/class="card device-card"/g) || []).length, Math.min(count, 4), `${lang}/${count}`);
    assert.ok(!section.includes('value="Deleted rig"'));
    for (let i = 1; i <= Math.min(count, 4); i++) assert.ok(section.includes(`value="Rig-${i}"`));
    assert.ok(!section.includes('value="Rig-5"'));
    assert.equal(section.includes('class="device-expand"'), count > 4);
    if (count > 4) {
      const total = count.toLocaleString(lang);
      assert.ok(section.includes(`<h2>${t("myDevices")} · ${total}</h2>`));
      assert.ok(section.includes(`aria-controls="fleet-device-list" aria-expanded="false">${t("showAll")} (${total})</button>`));
    } else {
      assert.ok(section.includes(`<h2>${t("myDevices")}</h2>`));
      if (!count) assert.ok(section.includes(t("noDevices")));
    }
    assert.ok(!/\sstyle=|<style(?:\s|>)/.test(html));
    assert.equal(JSON.stringify(state), original);
  }
});

test("calculator: hidden devices still contribute to overview hashrate, output, net profit and cabinet power", () => {
  const state = { ...defaults(), lang: "en", secondary: "USD" };
  state.calculator = { ...state.calculator, price: 2, yield: .01, fee: 0, electricity: .1 };
  state.fleetSettings = { ...state.fleetSettings, syncWPerTH: 1.8, powerBudgetW: 500, powerBudgetEnabled: true, selfDilution: false };
  state.devices = Array.from({ length: 7 }, (_, i) => ({ id: `rig-${i + 1}`, updated: 1, name: `Rig-${i + 1}`, gpu: "", customPearl: i === 6 ? 100 : 1, count: 1, rented: false, hoursPerDay: 24 }));
  const html = renderToStaticMarkup(React.createElement(FleetCalculator, { state, onState: () => {}, incomes: {}, t: (key: string) => dictionaries.en[key] }));
  const overview = html.slice(html.indexOf('id="fleet-overview"'), html.indexOf('id="fleet-devices"'));
  // 106 TH/s → 1.06 PRL/day × $2 − 190.8 W × 24h × $0.1/kWh = $1.66208/day.
  assert.ok(overview.includes("106.00 TH/s"));
  assert.ok(overview.includes('title="1.06000000 PRL"'));
  assert.ok(overview.includes('class="money-primary">$1.66</span>'));
  assert.ok(html.includes("191 / 500 W"));
  assert.equal((html.match(/class="card device-card"/g) || []).length, 4);
  assert.ok(!html.includes('value="Rig-5"'));
  assert.ok(!html.includes('value="Rig-7"'));
});

test("calculator: rack card, budget input and warnings require opt-in in every language", () => {
  for (const lang of Object.keys(dictionaries)) {
    const state = { ...defaults(), lang, secondary: "USD" };
    state.calculator = { ...state.calculator, price: 2, yield: .01 };
    state.devices = [{ id: "rig", updated: 1, name: "Rig", gpu: "RTX 4090", count: 2, rented: false, hoursPerDay: 24 }];
    state.fleetSettings.powerBudgetW = 500;
    const t = (key: string) => dictionaries[lang][key];
    for (const enabled of [undefined, false, true, false]) {
      if (enabled == null) delete state.fleetSettings.powerBudgetEnabled;
      else state.fleetSettings.powerBudgetEnabled = enabled;
      const html = renderToStaticMarkup(React.createElement(FleetCalculator, { state, onState: () => {}, incomes: {}, t }));
      assert.equal(html.includes('class="card fleet-power"'), enabled === true, lang);
      assert.equal(html.includes('fleet-power-warning'), enabled === true, lang);
      assert.equal(html.includes('class="over-budget"'), enabled === true, lang);
      assert.equal(html.includes(t("powerBudget")), enabled === true, lang);
      assert.ok(html.includes(t("cabinetPower")), "calculator switch is available: " + lang);
    }
  }
});

test("polish: Money separates estimated currency, colors losses and puts compact estimates in a title", () => {
  const amount = "−$78.52 · −¥526.58";
  const full = renderToStaticMarkup(React.createElement(Money, { amount, block: true }));
  assert.match(full, /money-block.*negative/); assert.match(full, /money-secondary[^>]*>≈ −¥526.58/);
  const compact = renderToStaticMarkup(React.createElement(Money, { amount, compact: true }));
  assert.ok(compact.includes(`title="${amount}"`)); assert.ok(!compact.includes("money-secondary"));
  const secondary = renderToStaticMarkup(React.createElement(Money, { amount, secondaryOnly: true }));
  assert.ok(!secondary.includes("$78.52")); assert.ok(secondary.includes("≈ −¥526.58"));
});

test("polish: exact bigint PRL groups large balances and limits displayed precision, with eight decimals in title", () => {
  for (const lang of Object.keys(dictionaries)) {
    const html = renderToStaticMarkup(React.createElement(PRLAmount, { value: "1593684870020", lang }));
    assert.ok(html.includes((15936).toLocaleString(lang)));
    assert.ok(html.includes("84870020 PRL")); // Complete value in the title.
    assert.ok(html.includes("8487 <span")); assert.ok(!html.includes("8487002 <span"));
  }
  const exact = renderToStaticMarkup(React.createElement(PRLAmount, { value: "9007199254740993", lang: "en" }));
  assert.ok(exact.includes("90,071,992.54740993 PRL"));
});

test("polish: worker previews include every outage, naturally sort names and never mutate pool data", () => {
  const workers = Array.from({ length: 112 }, (_, i) => ({ name: `rp-${112 - i}`, online: i >= 4, last: ts - 10800, rates: { day: 1e12 } }));
  const original = JSON.stringify(workers), preview = visibleWorkers(workers, "en", false);
  assert.equal(preview.length, 12); assert.equal(preview.filter((w: { online: boolean }) => !w.online).length, 4);
  assert.deepEqual(preview.slice(4, 7).map((w: { name: string }) => w.name), ["rp-1", "rp-2", "rp-3"]);
  assert.equal(visibleWorkers(workers.map((w, i) => ({ ...w, online: i >= 20 })), "en", false).length, 20);
  assert.equal(visibleWorkers(workers, "en", true).length, 112); assert.equal(JSON.stringify(workers), original);
  const html = renderToStaticMarkup(React.createElement(WorkerList, { workers, window: "day", lang: "en", t: (k: string) => dictionaries.en[k] }));
  assert.equal((html.match(/class="worker-row/g) || []).length, 12); assert.match(html, /worker-offline/); assert.match(html, /Show all 112 workers/);
});

test("polish: chart padding follows each series range, flat/empty ranges are safe and inspection picks nearest point", () => {
  assert.deepEqual(chartRange([[0, 100], [1, 200]]), [92, 208]);
  const [min, max] = chartRange([[0, 100], [1, 100]]); assert.ok(min < 100 && max > 100);
  assert.deepEqual(chartRange([]), [0, 1]); assert.equal(nearestPoint([[0, 1], [10, 2], [20, 3]], 16), 2);
  const chart = renderToStaticMarkup(React.createElement(LineChart, { points, second: [[ts - 86400, 10], [ts, 12]], lang: "en", label: "Hash", empty: "Empty" }));
  assert.equal((chart.match(/<circle/g) || []).length, 0); assert.ok(chart.includes('aria-label="Hash"')); assert.ok(chart.includes('tabindex="0"'));
  assert.ok(chart.includes('vector-effect="non-scaling-stroke"')); assert.match(chart, /chart-axis-right/);
});

test("polish: six languages share network formats, mobile pool details and compact GPU previews", () => {
  for (const lang of Object.keys(dictionaries)) {
    const t = (k: string) => dictionaries[lang][k];
    const network = { difficulty: 34433588, prlPerTHDay: .020209, reward: 25, hashrate: 12e18 };
    const data = { network, rows: [{ id: "a", name: "AlphaPool", hashrate: 1e18, earningsPerPH: 20.12345678, trustworthy: true, blocksSample: 30, fee: 2 }], ts, source: "fixture" };
    const networkHTML = renderToStaticMarkup(React.createElement(NetworkSummary, { data, t, lang }));
    assert.ok(networkHTML.includes((34.43).toLocaleString(lang, { minimumFractionDigits: 2 }) + "M")); assert.ok(networkHTML.includes(`PRL/PH·${t("perDay")}`));
    const pools = renderToStaticMarkup(React.createElement(PoolComparison, { data, t, lang, onUse: () => {} }));
    assert.match(pools, /<article class="pool-mobile/); assert.match(pools, /pool-mobile-primary/); assert.ok(pools.includes(t("useFee")));
    assert.ok(pools.includes(t("poolHashrate7d"))); assert.ok(pools.includes('class="pool-data-notes') || pools.includes('class="card pool-data-notes'));
    assert.ok(!/\sstyle=|<style(?:\s|>)/.test(pools));
    const state = { ...defaults(), lang };
    const fleet = renderToStaticMarkup(React.createElement(FleetCalculator, { state, onState: () => {}, incomes: {}, t }));
    assert.equal((fleet.match(/class="gpu-mobile-row/g) || []).length, 8); assert.ok(fleet.includes(t("showAll"))); assert.match(fleet, /id="fleet-tab-single" role="tab" aria-selected="true"/);
  }
});

test("polish: wallet first render uses skeletons instead of missing balance or an empty transaction heading", () => {
  const addr = "prl1" + "a".repeat(38);
  const html = renderToStaticMarkup(React.createElement(WatchWallet, { wallets: [{ id: "w", label: "Watch", addr }], lang: "en", refresh: 0, t: (k: string) => dictionaries.en[k], onAdd: () => {}, onRename: () => {}, onRemove: () => {} }));
  // The transactions card keeps its place while loading: its heading always has a skeleton under it.
  assert.match(html, /skeleton-balance/); assert.match(html, /<h2>Recent transactions<\/h2><div class="skeleton skeleton-card"/); assert.ok(!html.includes("— PRL"));
  assert.ok(html.includes(`<code class="watch-address">${addr}</code>`)); assert.match(html, /aria-label="Select wallet: Watch"/);
});
test("wallet shows the selected watch address, falling back to the first", () => {
  const wallets = [{ id: "a", label: "First", addr: "prl1" + "a".repeat(38) }, { id: "b", label: "Second", addr: "prl1" + "b".repeat(38) }];
  const render = (selected?: string) => renderToStaticMarkup(React.createElement(WatchWallet, { wallets, selected, lang: "en", refresh: 0, t: (k: string) => dictionaries.en[k], onAdd: () => {}, onRename: () => {}, onRemove: () => {} }));
  assert.ok(render("b").includes(`<code class="watch-address">${wallets[1].addr}</code>`));
  for (const html of [render(), render("gone")]) assert.ok(html.includes(`<code class="watch-address">${wallets[0].addr}</code>`));
  assert.equal((render("b").match(/aria-current="true"/g) || []).length, 1);
});

test("pool comparison renders PPLNS real cost estimates and separate Fortune schemes on desktop and phones", () => {
  for (const lang of Object.keys(dictionaries)) {
    const t = (key: string) => dictionaries[lang][key];
    const data = { ts, rows: [{ id: "fortune", name: "Pearl Fortune", hashrate: 1e15,
      payouts: [{ scheme: "PPS", fee: 5, grossPerPH: 100, realFeePercent: 5, realFeeEstimated: true },
        { scheme: "PPLNS", fee: 2, grossPerPH: 80, realFeePercent: 21.6, realFeeEstimated: true }] },
      { id: "lucky", name: "Lucky", hashrate: 1e14,
        payouts: [{ scheme: "PPLNS", fee: 0, grossPerPH: 120, realFeePercent: -20, realFeeEstimated: true }] }] };
    const html = renderToStaticMarkup(React.createElement(PoolComparison, { data, t, lang, onUse: () => {} }));
    const cost = "≈" + (21.6).toLocaleString(lang, { maximumFractionDigits: 2 }) + "%";
    const negative = "≈−" + (20).toLocaleString(lang) + "%";
    for (const view of [html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")), html.slice(html.indexOf('class="pool-mobile-list"'))]) {
      assert.ok(view.includes(cost), lang);
      assert.ok(view.includes(negative), lang);
      assert.match(view, /<small>PPS<\/small>/);
      assert.match(view, /<small>PPLNS<\/small>/);
    }
    assert.ok(html.includes(t("poolContractNotes")), lang);
  }
});

test("pool comparison shows take-home yield: PPS pools quoted alike differ by Real Cost, PPLNS loses its fee", () => {
  const t = (key: string) => dictionaries.en[key];
  const pps = (id: string, scheme: string, fee: number, realFeePercent: number | null) => ({ id, name: id, hashrate: 1e15, pps: true, trustworthy: false,
    payouts: [{ scheme, fee, grossPerPH: 100, realFeePercent, realFeeEstimated: true, estimated: true, solo: false }] });
  const shared = (id: string, fee: number, grossPerPH: number) => ({ id, name: id, hashrate: 1e14, pps: false, trustworthy: true,
    payouts: [{ scheme: "PPLNS", fee, grossPerPH, realFeePercent: null, estimated: false, solo: false }] });
  const data = { ts, rows: [pps("Kryptex", "PPS+", 3, 6), pps("F2Pool", "PPS", 1, 3.5), pps("Tariff", "PPS", 4, null),
    shared("Hero", 0, 96.3), shared("Pearl", 1, 97)] };
  const html = renderToStaticMarkup(React.createElement(PoolComparison, { data, t, lang: "en", onUse: () => {} }));
  const table = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  for (const value of ["≈94 PRL", "≈96.5 PRL", "≈96 PRL", ">96.3 PRL<", ">96 PRL<"]) assert.ok(table.includes(value), value);
  assert.ok(!table.includes(">≈100 PRL<"));
  // The hover title shows how the figure was reached.
  assert.ok(table.includes('title="100 × (1 − 6%) = 94 PRL/PH·day"'));
  assert.ok(table.includes('title="97 × (1 − 1%) = 96.03 PRL/PH·day"'));
  // The green mark goes to the best measured take-home yield: Hero's 0% fee beats Pearl's higher gross.
  assert.equal((table.match(/pool-top-yield/g) || []).length, 1);
  assert.match(table, /class=" pool-top-yield" title="96.3 × \(1 − 0%\) = 96.3 PRL\/PH·day">96.3 PRL</);
  for (const k of ["poolYieldBasis", "comparisonExplanation", "ppsExplanation"]) assert.ok(html.includes(t(k).replace(/'/g, "&#x27;")), k);
});

test("review: a single-axis chart uses no right slot; only a network companion can reserve shared bounds", () => {
  const props = { points, lang: "en", label: "History", empty: "Empty" };
  const priceChart = renderToStaticMarkup(React.createElement(LineChart, props));
  assert.ok(!priceChart.includes("chart-axis-right"));
  const companion = renderToStaticMarkup(React.createElement(LineChart, { ...props, mini: true, alignAxes: true }));
  assert.match(companion, /chart-aligned/); assert.match(companion, /chart-axis-right/);
  const dual = renderToStaticMarkup(React.createElement(LineChart, { ...props, second: points }));
  assert.match(dual, /chart-dual/); assert.match(dual, /chart-axis-right/);
});

test("review: checkout displays balanced address halves without changing the accessible value, and gives the amount its own row", () => {
  for (const lang of Object.keys(dictionaries)) {
    const t = (key: string) => dictionaries[lang][key];
    for (const length of [42, 43]) {
      const address = "prl1" + "a".repeat(length - 4);
      const html = renderToStaticMarkup(React.createElement(PaymentAddress, { address, t, onCopy: () => {} }));
      const lines = [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
      assert.equal(lines.length, 2); assert.equal(lines.join(""), address);
      assert.ok(Math.abs(lines[0].length - lines[1].length) <= 1);
      assert.ok(html.includes(`aria-label="${address}"`)); assert.ok(html.includes(`title="${address}"`));
    }
    const html = renderToStaticMarkup(React.createElement(PaymentHead, { amount: "6.23750001", estimate: "$4.99", t, onCopy: () => {} }));
    assert.ok(html.includes('<strong class="payment-amount">6.23750001</strong>'));
    assert.ok(html.includes('<div class="payment-unit-row"><small>PRL</small><button'));
    assert.ok(t("noRules") && t("priceAlerts")); assert.notEqual(t("noRules"), t("addPriceAlert"));
  }
});


test("calculator: the catalog displays sort and selection received from the account", () => {
  for (const [sortKey, selectedGPU] of [["efficiency", "RTX 5090"], ["rentNet", "RTX 4090"]]) {
    const state = defaults();
    state.fleetSettings = { ...state.fleetSettings, sortKey, selectedGPU };
    const html = renderToStaticMarkup(React.createElement(FleetCalculator, {
      state, incomes: {}, t: (key: string) => dictionaries.en[key],
      onState: () => assert.fail("receiving account preferences must not edit them"),
    }));
    const catalog = html.slice(html.indexOf('id="fleet-catalog"'), html.indexOf('id="fleet-single"'));
    assert.ok(catalog.includes(`<option value="${sortKey}" selected="">`));
    assert.ok(catalog.includes(`aria-pressed="true">${selectedGPU}</button>`));
    assert.equal(state.fleetSettings.selectedGPU, selectedGPU);
  }
});
