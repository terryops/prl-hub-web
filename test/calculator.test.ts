import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  calculatorDefaults,
  calculate,
  normalizeCalculator,
  calculatorWithPoolFee,
} from "../src/calculator.ts";
import {
  defaults,
  configOf,
  normalizeConfig,
  mergeConfig,
} from "../src/store.ts";
import { newest, validCatalog } from "../src/gpu-catalog.ts";
const near = (a: number | null, b: number) =>
  assert.ok(
    a != null && Math.abs(a - b) < Math.max(1e-9, Math.abs(b) * 1e-12),
    `${a} != ${b}`,
  );
test("Use fee: out-of-range upstream pool/dev fees cannot corrupt calculator or rendering", () => {
  const c = calculatorDefaults();
  for (const [fee, dev] of [[-1, 0], [101, 0], [3, -1], [3, 101], [NaN, 0], [3, Infinity]]) {
    const next = calculatorWithPoolFee(c, fee, dev);
    assert.equal(next.fee, c.fee);
    assert.doesNotThrow(() => calculate(next, 1, 0.02));
  }
  near(calculatorWithPoolFee(c, 2, 1).fee, 2.98);
});
test("calculator: independently hand-calculated owned output, cost price and hardware payback", () => {
  const c = {
    ...calculatorDefaults(),
    th: 100,
    watts: 500,
    hardware: 500,
    count: 2,
    hours: 12,
    fee: 2,
    electricity: 0.1,
  };
  const r = calculate(c, 1, 0.02);
  near(r.dailyPRL, 2);
  near(r.netPRL, 1.96);
  near(r.power, 1.2);
  near(r.revenue, 1.96);
  near(r.net, 0.76);
  near(r.costPerPRL, 1.2 / 1.96);
  near(r.payback, 1000 / 0.76);
  near(r.net30, 22.8);
  near(r.net90, 68.4);
});
test("calculator: all-inclusive rent does not count electricity twice; hourly quantity and duty scale together", () => {
  const c = {
    ...calculatorDefaults(),
    rented: true,
    count: 2,
    hours: 12,
    th: 100,
    watts: 500,
    fee: 2,
    rent: 0.03,
    electricity: 0.1,
  };
  let r = calculate(c, 1, 0.02);
  near(r.power, 0);
  near(r.rent, 0.72);
  near(r.net, 1.24);
  near(r.costPerPRL, 0.72 / 1.96);
  assert.equal(r.payback, null);
  r = calculate({ ...c, rentCoversPower: false }, 1, 0.02);
  near(r.net, 0.04);
  near(r.power, 1.2);
  near(r.rentLimit, (1.96 - 1.2) / 24);
});
test("calculator: undefined live input never becomes zero revenue; zero hash, zero hours and total fee avoid infinities", () => {
  const c = calculatorDefaults();
  assert.equal(calculate(c, null, null).net, null);
  for (const patch of [{ th: 0 }, { hours: 0 }, { fee: 100 }]) {
    const r = calculate({ ...c, ...patch }, 1, 0.02);
    assert.equal(r.costPerPRL, null);
    assert.equal(r.payback, null);
    assert.ok(Object.values(r).every((v) => v === null || Number.isFinite(v)));
  }
  assert.equal(
    calculate({ ...c, watts: 1000, electricity: 5 }, 0.01, 0.02).payback,
    null,
  );
});
test("calculator: monthly difficulty growth follows independent daily summation, including falling difficulty", () => {
  for (const growth of [0, 15, -20]) {
    const c = { ...calculatorDefaults(), growth };
    const r = calculate(c, 1, 0.02);
    const decay = (1 + growth / 100) ** (-1 / 30);
    near(
      r.net30,
      Array.from(
        { length: 30 },
        (_, i) => r.revenue! * decay ** i - r.cost,
      ).reduce((a, b) => a + b, 0),
    );
    near(
      r.net90,
      Array.from(
        { length: 90 },
        (_, i) => r.revenue! * decay ** i - r.cost,
      ).reduce((a, b) => a + b, 0),
    );
  }
});
test("calculator config: old encrypted configs acquire defaults; inputs persist and merge with settings", () => {
  const old = configOf(defaults());
  delete (old as Partial<typeof old>).calculator;
  const migrated = normalizeConfig(old);
  assert.deepEqual(migrated.calculator, calculatorDefaults());
  const next = {
    ...migrated,
    calculator: { ...calculatorDefaults(), rent: 0.6, rented: true },
    settingsUpdated: 10,
  };
  assert.deepEqual(mergeConfig(migrated, next).calculator, next.calculator);
  assert.deepEqual(mergeConfig(next, migrated), mergeConfig(migrated, next));
  for (const c of [
    { hours: 25 },
    { count: 1.5 },
    { fee: 101 },
    { growth: -100 },
    { price: "3" },
    { yield: NaN },
  ])
    assert.throws(() => normalizeCalculator(c));
});
test("GPU references: the bundled copy is the app's gpus.json, and the served table wins unless older", () => {
  const copy = JSON.parse(readFileSync(new URL("../src/gpus.json", import.meta.url), "utf8"));
  const shared = JSON.parse(readFileSync(new URL("./fixtures/gpus.json", import.meta.url), "utf8"));
  assert.deepEqual(copy, shared);
  assert.equal(copy.gpus.length, 27);
  assert.ok(validCatalog(copy));
  const at = (updated: string, th: number) => ({ updated, gpus: [{ name: "RTX 5090", th, watts: 525, price: 2200, rentDefault: 120 }] });
  const fallback = at("2026-10-14", 1);
  assert.equal(newest(at("2026-10-01", 2), fallback).gpus[0].th, 1);
  assert.equal(newest(at("2026-10-14", 3), fallback).gpus[0].th, 3);
  assert.equal(newest(at("2026-11-01", 4), fallback).gpus[0].th, 4);
  for (const bad of [null, "x", { updated: "2026-11-01", gpus: [] }, at("2026-11-01", 0), at("soon", 5)])
    assert.equal(newest(bad, fallback), fallback);
});
test("push service worker: received JSON displays expected text; malformed events do not throw; click focuses existing origin", async () => {
  const handlers: Record<string, Function> = {},
    shown: unknown[] = [],
    opened: string[] = [],
    navigated: string[] = [];
  let focused = false,
    closed = false;
  const context = {
    URL,
    self: {
      location: { origin: "https://prl.test" },
      addEventListener: (name: string, fn: Function) => (handlers[name] = fn),
      registration: {
        showNotification: async (...args: unknown[]) => {
          shown.push(args);
        },
      },
      clients: {
        matchAll: async () => [
          { url: "https://other.test", focus: () => {} },
          {
            url: "https://prl.test/",
            navigate: async (url: string) => { navigated.push(url); },
            focus: () => {
              focused = true;
            },
          },
        ],
        openWindow: async (url: string) => opened.push(url),
      },
    },
  };
  vm.runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    context,
  );
  const waits: Promise<unknown>[] = [];
  handlers.push({
    data: {
      json: () => ({ title: "PRL price", body: "Above $1.20", tag: "price" }),
    },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  assert.equal((shown[0] as unknown[])[0], "PRL price");
  assert.equal(
    ((shown[0] as unknown[])[1] as { body: string }).body,
    "Above $1.20",
  );
  assert.doesNotThrow(() =>
    handlers.push({
      data: {
        json: () => {
          throw Error("bad JSON");
        },
      },
    }),
  );
  handlers.notificationclick({
    notification: { close: () => (closed = true) },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  assert.equal(focused, true);
  assert.equal(closed, true);
  assert.equal(opened.length, 0);
  assert.deepEqual(navigated, ["https://prl.test/#alerts"]);
  context.self.clients.matchAll = async () => [];
  handlers.notificationclick({
    notification: { close: () => {}, data: { url: "/#workers" } },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  assert.deepEqual(opened, ["/#workers"]);
  handlers.notificationclick({
    notification: { close: () => {}, data: { url: "https://other.test/" } },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  assert.deepEqual(opened, ["/#workers", "/#alerts"]);
});
test("network scenario scales live yield, respects explicit yield and rejects invalid overrides", async () => {
  const { scenarioUnit, calculatorDefaults, normalizeCalculator } = await import("../src/calculator.ts");
  const c = calculatorDefaults(); c.networkHash = 2e18;
  assert.equal(scenarioUnit(c, .02, 1e18), .01);
  assert.equal(scenarioUnit({ ...c, yield: .04 }, .02, 1e18), .04);
  assert.equal(scenarioUnit(c, null, 1e18), null);
  assert.throws(() => normalizeCalculator({ ...c, networkHash: 0 }), /invalid_config/);
});
