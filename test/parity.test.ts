import { test } from "node:test";
import assert from "node:assert/strict";
import { configOf, defaults, normalizeConfig, mergeConfig, orderedMonitors, deepLink } from "../src/store.ts";
import { duplicateMonitor, enabledMonitors, alertMonitors, cleanAddress, moveIds, ownAddresses, hashrate24h, dailyAverage, nearestWindow } from "../src/monitors.ts";
import type { Stats } from "../src/types.ts";
import { applyingEdit, reconcileRule, relativeTime } from "../src/alertRules.ts";
import { currencies, dual, secondaryCode } from "../src/currency.ts";
import { measuredHashPoints, hashChange } from "../src/market.ts";
import { diffChange, difficultyPoints, poolShares } from "../src/market.ts";
import type { PoolOverview } from "../src/types.ts";
const addr = "prl1" + "a".repeat(38);
const monitor = (id: string) => ({ id, updated: 1, addr, pool: "AlphaPool", label: id, alert: true, after: 600 });
test("14.0: unknown fields survive normalize, encrypted config extraction and both merge directions", () => {
  const a = normalizeConfig({ ...configOf(defaults()), future: { foo: 1 }, monitors: [{ ...monitor("UUID-ABC"), nativeExtra: "kept" }] });
  const b = { ...configOf(defaults()), settingsUpdated: 2, monitors: [{ ...monitor("UUID-ABC"), updated: 2, paused: true }] };
  for (const c of [mergeConfig(a, b), mergeConfig(b, a)]) { assert.deepEqual(c.future, { foo: 1 }); assert.equal(c.monitors[0].nativeExtra, "kept"); assert.equal(c.monitors[0].paused, true); }
  assert.equal(configOf({ ...defaults(), ...a, onlineOnly: true, hashWindow: "day", palette: "mono" }).future, undefined);
  assert.equal(configOf({ ...defaults(), onlineOnly: true }).onlineOnly, undefined);
});
test("14.0: monitor ordering is its own LWW value; unseen monitors follow; deep links prefill valid addresses only", () => {
  const base = { ...configOf(defaults()), monitors: [monitor("a"), monitor("b"), monitor("c")] };
  const c = mergeConfig({ ...base, settingsUpdated: 99, monitorOrder: { ids: ["a", "b"], updated: 1 } }, { ...base, monitorOrder: { ids: ["b", "a"], updated: 2 } });
  assert.deepEqual(orderedMonitors(c).map((m) => m.id), ["b", "a", "c"]);
  assert.deepEqual(deepLink(`#wallet?addr=${addr}`), { page: "wallet", addr });
  assert.equal(deepLink("#workers?addr=invalid"), null); assert.equal(deepLink(`#market?addr=${addr}`), null);
});
test("14.0: opaque settings converge at equal timestamps and malformed new ordering is rejected", () => {
  const base = configOf(defaults()), a = { ...base, future: { value: 1 } }, b = { ...base, future: { value: 2 } };
  assert.deepEqual(mergeConfig(a, b), mergeConfig(b, a));
  assert.throws(() => normalizeConfig({ ...base, monitorOrder: { ids: "bad" as unknown as string[], updated: 1 } }), /invalid_config/);
});
test("A2: pause, duplicates, smoothest hashrate and resumed-address daily average match Swift", () => {
  assert.equal(enabledMonitors([{ ...monitor("a"), paused: true }]).length, 0);
  assert.equal(duplicateMonitor([monitor("a")], "AlphaPool", addr), true);
  assert.equal(duplicateMonitor([monitor("a")], "Lucky Pool", addr), false);
  assert.equal(duplicateMonitor([monitor("a")], "AlphaPool", addr, "a"), false);
  const s = { windows: ["live", "hour", "day"], rates: { live: 10, hour: 6, day: 0 }, workers: [] } as unknown as Stats;
  assert.equal(hashrate24h(s), 6); assert.equal(dailyAverage(2, 4), 2); assert.equal(dailyAverage(0, 14), 2); assert.equal(dailyAverage(3, 0), 3);
  assert.equal(nearestWindow("day", ["live", "hour"]), "hour");
  assert.equal(nearestWindow("hour", ["m30", "h3"]), "m30");
});
test("A2: paused/deleted watches never register alerts; worker sums, shared addresses and reorder bounds", () => {
  const items = [monitor("A"), { ...monitor("B"), pool: "Lucky Pool" }, { ...monitor("C"), paused: true }, { ...monitor("D"), deleted: true }, { ...monitor("F"), pool: "F2Pool", addr: "a".repeat(32) }];
  assert.deepEqual(alertMonitors(items).map((m) => m.id), ["A", "B", "F"]);
  assert.deepEqual(ownAddresses(items), [addr]);
  assert.equal(cleanAddress(`  ${addr.toUpperCase()}\n${addr} `), addr);
  assert.deepEqual(moveIds(["A", "B", "C"], "C", 0), ["C", "A", "B"]);
  assert.deepEqual(moveIds(["A", "B"], "A", 2), ["A", "B"]);
  const s = { windows: ["live", "hour", "day"], rates: { day: 100 }, workers: [{ rates: { day: 2 } }, { rates: { day: 3 } }] } as Stats;
  assert.equal(hashrate24h(s), 5);
});
test("A3: changing the condition reopens a fired rule; identical edits preserve its state", () => {
  const r = { id: "ABC", updated: Date.now() + 10000, kind: "above" as const, value: 1, window: 0, enabled: false, seen_fired: 123, nativeExtra: "kept" };
  assert.equal(applyingEdit(r, r), r);
  const edited = applyingEdit(r, { kind: "below", value: 2, window: 0 });
  assert.equal(edited.id, r.id); assert.equal(edited.enabled, true); assert.equal(edited.seen_fired, 0);
  assert.equal(edited.nativeExtra, "kept"); assert.ok(edited.updated > r.updated);
  assert.equal(relativeTime(3600, "en", 7200), "1 hour ago");
});
test("A3: an old-condition or older firing reply cannot disable a new rule", () => {
  const r = { id: "UUID-ABC", updated: 100, kind: "above" as const, value: 1, window: 0, enabled: false, seen_fired: 123 };
  const edited = applyingEdit(r, { kind: "move", value: 5, window: 3600 });
  assert.equal(reconcileRule(edited, { ...r, last_fired: 200 }), edited);
  assert.equal(reconcileRule(r, { ...r, last_fired: 122 }), r);
  const fired = reconcileRule(edited, { ...edited, enabled: false, last_fired: 300 });
  assert.equal(fired.enabled, false); assert.equal(fired.seen_fired, 300);
  assert.ok(fired.updated > edited.updated);
});
test("A4: language currency defaults, precision, missing FX and settings sync", () => {
  const fx = { ok: true, ts: 1, base: "USD" as const, rates: { CNY: 7.1, TWD: 32.1 } };
  assert.equal(secondaryCode("__auto__", "zh-Hant"), "TWD"); assert.equal(secondaryCode("__auto__", "en"), "");
  assert.equal(dual(2, "__auto__", "zh-Hans", fx), "$2.00 · ¥14.20");
  assert.equal(dual(2, "TWD", "en", fx), "$2.00 · NT$64");
  assert.equal(dual(2, "CNY", "en"), "$2.00"); assert.equal(dual(2, "", "en", fx), "$2.00");
  const base = configOf(defaults()), c = mergeConfig(base, { ...base, theme: "dark", secondary: "JPY", settingsUpdated: 10 });
  assert.equal(c.theme, "dark"); assert.equal(c.secondary, "JPY");
});
test("A4: all seventeen currencies retain native symbols/decimals; palette stays local after sync", () => {
  assert.equal(currencies.length, 17);
  const fx = { ok: true, ts: 1, base: "USD" as const, rates: Object.fromEntries(currencies.map(([code]) => [code, 3])) };
  for (const [code, symbol, decimals] of currencies) assert.equal(dual(-2, code, "en", fx), `−$2.00 · −${symbol}${decimals === 0 ? "6" : "6.00"}`);
  assert.equal(dual(2, "JPY", "en", { ...fx, rates: { JPY: Infinity } }), "$2.00");
  const c = configOf({ ...defaults(), theme: "light", secondary: "HKD", palette: "mono" });
  assert.equal(c.palette, undefined); assert.equal(c.theme, "light");
});
test("A5: hashrate movement is measured independently of difficulty and omits distant samples", () => {
  const n = { ts: 1000000, hashrate: 10, difficulty: 200 } as Network;
  const points = [7, 3, 1].map((d) => ({ height: 100 - d, ts: n.ts - d * 86400, difficulty: 100, hashrate: 20, blockTime: 100 }));
  const measured = measuredHashPoints(n, points);
  assert.equal(hashChange(measured, 7), -50);
  assert.equal(hashChange(measured, 1), -50);
  assert.equal(hashChange(measuredHashPoints(n, points.filter((p) => p.height !== 93)), 7), null);
});
test("A5: difficulty/output change directions and native donut thresholds", () => {
  assert.equal(diffChange(20, 10), 100); assert.equal(diffChange(20, 10, true), -50);
  const n = { ts: 1000000, difficulty: 20, difficulty7d: 10, difficulty3d: null, difficulty24h: 15, prlPerTHDay: .02 } as Network;
  assert.equal(difficultyPoints(n, true)[0][1], 40);
  const rows = [80, .5, .5].map((hashrate, i) => ({ id: String(i), name: String(i), hashrate })) as PoolOverview[];
  const { total, slices } = poolShares(rows, 100);
  assert.equal(total, 100); assert.deepEqual(slices.map((s) => s.id), ["0", "_tail", "_other"]);
  assert.equal(slices.at(-1)!.share, .19);
});
test("contacts merge independently of language/settings, including deletes and unknown fields", () => {
  const base = configOf(defaults()), c = { id: "contact-1", updated: 1, name: "Friend", address: addr, note: "", extra: "preserved" };
  const a = { ...base, contacts: [c], settingsUpdated: 100, autoRefresh: false };
  const b = { ...base, contacts: [{ ...c, updated: 2, deleted: true }], settingsUpdated: 1 };
  for (const merged of [mergeConfig(a, b), mergeConfig(b, a)]) { assert.equal(merged.contacts![0].deleted, true); assert.equal(merged.contacts![0].extra, "preserved"); assert.equal(merged.autoRefresh, false); }
});


test("complete fleet preferences survive account config serialization, merge and older clients", () => {
  const state = defaults();
  state.devices = [{ id: "11111111-1111-4111-8111-111111111111", updated: 1, name: "Rental rig", gpu: "RTX 4090", count: 2,
    rented: true, hoursPerDay: 12, customPearl: 310, rentDaily: 24, rentCurrency: "USD", rentFX: 1, sourceKey: "Kryptex|address|worker" }];
  state.fleetSettings = { ...state.fleetSettings!, sortKey: "efficiency", selectedGPU: "RTX 5090", powerBudgetW: 6000, powerBudgetEnabled: true,
    syncWPerTH: 2.2, selfDilution: true, fxManual: true, manualFX: 150, rentEnabled: false, growthMode: "manual",
    rents: { "RTX 4090": { daily: 12, currency: "USD", fx: 1 } } };
  state.calculator = { ...state.calculator, electricity: 0.2, fee: 2, price: 1.5, yield: 0.04, networkHash: 2e19, growth: 15 };
  state.settingsUpdated = 100;
  const config = configOf(state), old = configOf(defaults());
  for (const merged of [mergeConfig(config, old), mergeConfig(old, config)]) {
    assert.deepEqual(merged.fleetSettings, state.fleetSettings);
    assert.deepEqual(merged.devices, state.devices);
    assert.deepEqual(merged.calculator, state.calculator);
    assert.deepEqual(configOf({ ...defaults(), ...merged }).fleetSettings, state.fleetSettings);
  }
  assert.equal(normalizeConfig(old).fleetSettings?.sortKey, undefined);
  assert.throws(() => normalizeConfig({ ...config, fleetSettings: { ...state.fleetSettings, sortKey: "invalid" as never } }), /invalid_config/);
  assert.throws(() => normalizeConfig({ ...config, fleetSettings: { ...state.fleetSettings, selectedGPU: "x".repeat(65) } }), /invalid_config/);
});
