import { test } from "node:test";
import assert from "node:assert/strict";
import { widgetPoolSnapshot } from "../src/android-widget-snapshot.ts";
import { targetKey } from "../src/monitors.ts";
import type { Monitor, Stats } from "../src/types.ts";

const monitor = (id: string, addr: string): Monitor => ({ id, addr, pool: "AlphaPool", label: "AlphaPool", alert: false, after: 600, updated: 1 });
const data = (hashrate: number): Stats => ({ ok: true, windows: ["live"], rates: { live: hashrate },
  pending: 0, paid: 0, pendingKind: "pending", workers: [], partial: false });

test("widget pools: failed retries retain the successful source time", () => {
  const a = monitor("a", "prl1addressa"), b = monitor("b", "prl1addressb");
  const result = widgetPoolSnapshot([a, b], {
    a: { data: data(8e9), at: 1_000, target: targetKey(a), failed: true },
    b: { data: data(9e9), at: 500_000, target: targetKey(b) },
  });
  assert.equal(result.poolsAt, 1);
  assert.deepEqual(result.pools.map((p) => p.hashrate), [8e9, 9e9]);
});

test("widget pools: absent or retargeted figures never claim a fresh complete snapshot", () => {
  const a = monitor("a", "prl1addressa"), b = monitor("b", "prl1addressb");
  const stats = { a: { data: data(8e9), at: 500_000, target: targetKey(a) } };
  assert.equal(widgetPoolSnapshot([a, b], stats).poolsAt, 0);
  assert.equal(widgetPoolSnapshot([a, b], stats).pools.length, 1);
  assert.deepEqual(widgetPoolSnapshot([{ ...a, addr: "prl1newaddress" }], stats), { pools: [], poolsAt: 0 });
});

test("widget pools: a confirmed missing account is a successful read, while no monitors has no pool time", () => {
  const a = monitor("a", "prl1addressa");
  assert.deepEqual(widgetPoolSnapshot([a], { a: { data: { ...data(0), missing: true }, at: 10_000, target: targetKey(a) } }), { pools: [], poolsAt: 10 });
  assert.deepEqual(widgetPoolSnapshot([], {}), { pools: [], poolsAt: 0 });
});

test("widget pools: native cache identities distinguish equal labels and match normalized monitor fields", () => {
  const a = monitor("a", "prl1addressa"), b = { ...monitor("b", "prl1addressb"), acct: " account " };
  const result = widgetPoolSnapshot([a, b], {
    a: { data: data(8e9), at: 50_000, target: targetKey(a) },
    b: { data: data(9e9), at: 40_000, target: targetKey(b) },
  });
  assert.equal(result.poolsAt, 40);
  assert.deepEqual(result.pools.map((p) => p.monitorKey), ["AlphaPool|prl1addressa|", "AlphaPool|prl1addressb|account"]);
});

test("widget pools: a cached server response keeps its original snapshot time", () => {
  const a = monitor("a", "prl1addressa"), b = monitor("b", "prl1addressb");
  const result = widgetPoolSnapshot([a, b], {
    a: { data: { ...data(8e9), ts: 100 }, at: 700_000, target: targetKey(a) },
    b: { data: { ...data(9e9), ts: 600 }, at: 700_000, target: targetKey(b) },
  });
  assert.equal(result.poolsAt, 100);
});

test("widget pools: malformed server timestamps cannot renew old figures", () => {
  const a = monitor("a", "prl1addressa");
  for (const ts of [0, -1, 10.5, 800, Number.NaN, "100", null]) {
    assert.equal(widgetPoolSnapshot([a], {
      a: { data: { ...data(8e9), ts } as Stats, at: 700_000, target: targetKey(a) },
    }).poolsAt, 0);
  }
});
