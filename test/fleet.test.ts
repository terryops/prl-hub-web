import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculatorDefaults } from "../src/calculator.ts";
import { fleetDefaults, fleet, gpuEconomics, deviceWatts, syncDevices, projection, effectiveGrowth, normalizeDevice, normalizeFleet, type EconomicsContext } from "../src/fleet.ts";
import { configOf, defaults, normalizeConfig, mergeConfig } from "../src/store.ts";
import type { Device, Monitor, Stats, Network } from "../src/types.ts";
// Fixed figures, so the fleet math below doesn't move whenever src/gpus.json is revised.
const catalog = [{ name: "RTX 4090", th: 250, watts: 450, price: 1600, rentDefault: 60 }];
const gpu = catalog.find((g: { name: string }) => g.name === "RTX 4090");
const ctx = (): EconomicsContext => ({ input: { ...calculatorDefaults(), fee: 0 }, settings: fleetDefaults(), price: 2, unit: .01, networkHash: 1e15, code: "CNY", rate: 10, rates: { CNY: 10, JPY: 100 } });
const device = (id: string, patch: Partial<Device> = {}): Device => ({ id, updated: 1, name: id, gpu: gpu.name, count: 1, rented: false, hoursPerDay: 24, ...patch });
const addr = "prl1" + "a".repeat(38);
const monitor = (id = "watch", patch: Partial<Monitor> = {}): Monitor => ({ id, updated: 1, pool: "AlphaPool", addr, label: id, alert: false, after: 600, ...patch });
const stats = (names: string[] = ["rig"], hash = 500e12): Stats => ({ ok: true, windows: ["live", "day"], rates: { day: hash }, pending: 0, paid: 0, pendingKind: "pending", partial: false, workers: names.map((name) => ({ name, online: true, last: null, rates: { live: 1e12, day: hash } })) });
const close = (v: number | null, expected: number) => assert.ok(v != null && Math.abs(v - expected) < 1e-8, `${v} != ${expected}`);

test("A6: owned and all-inclusive rented fleet duty, quantity, cabinet and costs are independently calculated", () => {
  const r = fleet([device("owned", { count: 2, hoursPerDay: 12 }), device("rent", { rented: true, hoursPerDay: 6, rentDaily: 80, rentCurrency: "CNY" })], catalog, ctx(), 0);
  assert.equal(r.count, 2); assert.equal(r.cards, 3); assert.equal(r.owned, 2); assert.equal(r.rented, 1);
  assert.equal(r.hash, 750); assert.equal(r.watts, 900); assert.equal(r.hardware, 3200);
  close(r.prl, 3.125); close(r.rev, 6.25); close(r.power, 1.08); close(r.rent, 2); close(r.net, 3.17); close(r.net30, 95.1);
  const c = ctx(); c.input.rentCoversPower = false;
  close(fleet([device("r", { rented: true })], catalog, c, 0).power, 0);
});
test("A6: synced rigs floor power at one chip, scale larger rigs, and estimate unknown chips", () => {
  const c = ctx();
  close(deviceWatts(device("small", { customPearl: 80 }), c, gpu), 450);
  const rig = fleet([device("large", { customPearl: 2000 })], catalog, c, 0);
  assert.equal(rig.watts, 3600); assert.equal(rig.hardware, 12800); close(rig.power, 8.64);
  const unset = device("unset", { gpu: "", customPearl: 100 });
  close(deviceWatts(unset, c), 180); close(fleet([unset], catalog, c, 0).hardware, 0);
  c.settings.syncWPerTH = 0; close(deviceWatts(unset, c), 0);
});
test("A6: self dilution affects fleet only; absent market values stay null; deleted devices do not contribute", () => {
  const c = ctx(); c.settings.selfDilution = true;
  const r = fleet([device("a"), device("gone", { deleted: true })], catalog, c, 0);
  close(r.dilution, .8); close(r.prl, 2); close(gpuEconomics(gpu, c, 0).daily, 2.5);
  c.price = null; assert.equal(fleet([device("a")], catalog, c, 0).net, null);
  c.unit = null; assert.equal(fleet([device("a")], catalog, c, 0).prl, null);
});
test("A6: rent currency survives a different secondary currency and unavailable-rate fallback", () => {
  const c = ctx(); c.settings.rents[gpu.name] = { daily: 400, currency: "JPY", fx: 100 };
  close(fleet([device("r", { rented: true })], catalog, c, 0).rent, 4);
  close(fleet([device("r", { rented: true, rentDaily: 40, rentCurrency: "HKD", rentFX: 8 })], catalog, c, 0).rent, 5);
  c.settings.fxManual = true; c.rate = 20;
  close(fleet([device("r", { rented: true, rentDaily: 80, rentCurrency: "CNY" })], catalog, c, 0).rent, 4);
});
test("A6: GPU rent ROI and break-even price/hash match hand calculation with and without power", () => {
  const c = ctx(); c.settings.rents[gpu.name] = { daily: 30, currency: "CNY" };
  const e = gpuEconomics(gpu, c, 0);
  close(e.rev, 5); close(e.ownNet, 3.92); close(e.rentNet, 2); close(e.roi, 200 / 3);
  close(e.breakEvenPrice, 1.2); close(e.breakEvenNetwork, 1e15 * 5 / 3); close(e.breakEvenRent, 5 / 24);
  c.input.rentCoversPower = false;
  const withPower = gpuEconomics(gpu, c, 0);
  close(withPower.rentNet, .92); close(withPower.breakEvenRent, 3.92 / 24); close(withPower.breakEvenPrice, 4.08 / 2.5);
});
test("A6: thirty/ninety day projections match independent daily summation and native growth bounds", () => {
  for (const growth of [-20, 0, 200]) for (const days of [30, 90]) {
    let expected = 0; for (let day = 0; day < days; day++) expected += 5 * (1 + growth / 100) ** (-day / 30) - 2;
    close(projection(5, 2, growth, days), expected);
  }
  const c = ctx(), n = { difficulty: 2, difficulty7d: 1 } as Network;
  assert.equal(effectiveGrowth(c.settings, c.input, n), 200);
  c.settings.growthMode = "manual"; c.input.growth = -20;
  assert.equal(effectiveGrowth(c.settings, c.input, n), -20);
});
test("A6: syncing retains manual devices and edited name/GPU/count/hours/rent by stable key", () => {
  const first = syncDevices([device("manual")], [{ monitor: monitor(), stats: stats() }]);
  const old = first.find((d) => d.customPearl != null)!;
  const edited = { ...old, name: "edited", gpu: "RTX 5080", count: 2, hoursPerDay: 12, rented: true, rentDaily: 96, future: "kept" };
  const second = syncDevices([first[0], edited], [{ monitor: monitor(), stats: stats(["rig"], 700e12) }]);
  assert.equal(second.find((d) => d.id === "manual")!.customPearl, undefined);
  const now = second.find((d) => d.id === edited.id)!;
  for (const key of ["name", "gpu", "count", "hoursPerDay", "rented", "rentDaily", "future"] as const) assert.equal(now[key], edited[key]);
  assert.equal(now.customPearl, 700); assert.ok(now.updated > edited.updated);
});
test("A6: failed sync keeps samples, pause/orphans create tombstones; duplicate workers and name collisions retain unique ids", () => {
  const first = syncDevices([], [{ monitor: monitor(), stats: stats(["rig", "rig"]) }]);
  assert.equal(first.length, 1);
  assert.deepEqual(syncDevices(first, [{ monitor: monitor(), failed: true }]), first);
  assert.deepEqual(syncDevices(first, [{ monitor: monitor(), stats: { ...stats(), missing: true } }]), first);
  assert.equal(syncDevices(first, [{ monitor: monitor("watch", { paused: true }), stats: stats() }])[0].deleted, true);
  const other = monitor("other", { addr: "prl1" + "b".repeat(38) });
  const collision = syncDevices(first, [{ monitor: monitor(), stats: stats() }, { monitor: other, stats: stats() }]);
  assert.equal(collision.length, 2); assert.equal(new Set(collision.map((d) => d.id)).size, 2);
  const f2 = syncDevices([], [{ monitor: monitor("f2", { pool: "F2Pool", addr: "a".repeat(32), acct: "name" }), stats: stats([]) }]);
  assert.equal(f2[0].customPearl, 500); assert.match(f2[0].sourceKey!, /f2pool/);
});
test("A6: old configs get device/parameter defaults, device tombstones merge and unknown data round trips", () => {
  const a = normalizeConfig({ ...configOf(defaults()), devices: undefined, fleetSettings: undefined });
  assert.deepEqual(a.devices, []); assert.equal(a.fleetSettings!.powerBudgetW, 3000);
  const b = normalizeConfig({ ...a, devices: [device("UUID-ABC", { future: { keep: true } })] });
  const c = mergeConfig(b, { ...a, devices: [device("UUID-ABC", { updated: 2, deleted: true })] });
  assert.equal(c.devices![0].deleted, true); assert.deepEqual(c.devices![0].future, { keep: true });
  for (const count of [0, 257]) assert.throws(() => normalizeDevice(device("bad", { count })));
  for (const powerBudgetW of [499, 30001]) assert.throws(() => normalizeFleet({ powerBudgetW }));
});

test("cabinet power defaults off for new and existing calculators and preserves explicit choices", () => {
  assert.equal(fleetDefaults().powerBudgetEnabled, false);
  assert.equal(normalizeFleet({ powerBudgetW: 6500 }).powerBudgetEnabled, false);
  for (const enabled of [true, false]) {
    const state = defaults();
    state.fleetSettings = normalizeFleet({ powerBudgetW: 6500, powerBudgetEnabled: enabled });
    const restored = normalizeConfig(JSON.parse(JSON.stringify(configOf(state))));
    assert.equal(restored.fleetSettings!.powerBudgetEnabled, enabled);
    assert.equal(restored.fleetSettings!.powerBudgetW, 6500);
  }
  for (const powerBudgetEnabled of [1, "true", null]) assert.throws(() => normalizeFleet({ powerBudgetEnabled }), /invalid_config/);
});
