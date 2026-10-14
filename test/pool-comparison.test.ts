import { test } from "node:test";
import assert from "node:assert/strict";
import { sortPools, poolSparkline, poolPayouts, realCostPeriods } from "../src/pool-comparison.ts";
import type { PoolOverview } from "../src/types.ts";

test("pool sorting: genuine zero is ordered, missing values stay last in either direction", () => {
  const rows = [{ id: "unknown", name: "Unknown", hashrate: null }, { id: "zero", name: "Zero", hashrate: 0 }, { id: "live", name: "Live", hashrate: 10 }] as PoolOverview[];
  assert.deepEqual(sortPools(rows, "hashrate", true).map((p) => p.id), ["zero", "live", "unknown"]);
  assert.deepEqual(sortPools(rows, "hashrate", false).map((p) => p.id), ["live", "zero", "unknown"]);
  assert.deepEqual(rows.map((p) => p.id), ["unknown", "zero", "live"]);
});
test("pool charts: missing samples break the line and constant hashrate remains visible", () => {
  const points = [{ ts: 100, hashrate: 10 }, { ts: 200, hashrate: null }, { ts: 300, hashrate: 10 }];
  const chart = poolSparkline(points)!;
  assert.equal((chart.path.match(/M/g) || []).length, 2);
  assert.equal((chart.path.match(/L/g) || []).length, 0);
  assert.deepEqual(chart.end, [138, 20]);
  assert.equal(poolSparkline([{ ts: 100, hashrate: null }]), null);
  assert.deepEqual(points.map((p) => p.hashrate), [10, null, 10]);
});
test("old API snapshots: missing new metrics stay unknown and original payout remains usable", () => {
  const pool = { scheme: "PPS+", fee: 2, earningsPerPH: 20, pps: true, solo: false, blocksSample: 30 } as PoolOverview;
  assert.deepEqual(poolPayouts(pool), [{ scheme: "PPS+", fee: 2, grossPerPH: 20, realFeePercent: null, estimated: true, solo: false }]);
});
test("Real Cost help: groups identical periods, preserves different windows and includes a measured zero", () => {
  const pool = (name: string, start: number, end: number, value: number | null = 5) => ({ name, realFeeMeasurement: { start, end }, payouts: [{ realFeePercent: value }] }) as PoolOverview;
  const rows = [pool("A", 200, 300), pool("B", 100, 150), pool("C", 200, 300, 0), pool("A", 200, 300), pool("Unknown", 100, 150, null)];
  assert.deepEqual(realCostPeriods(rows), [{ start: 100, end: 150, names: ["B"] }, { start: 200, end: 300, names: ["A", "C"] }]);
  assert.equal(rows.length, 5);
  for (const [start, end] of [[NaN, 300], [100, Infinity], [300, 200], [200, 200], [0, 300], [100, 9e12]]) assert.deepEqual(realCostPeriods([pool("Invalid", start, end)]), []);
  assert.deepEqual(realCostPeriods([{ name: "Legacy" } as PoolOverview]), []);
});

test("Real Cost sorting includes PPLNS, preserves zero and negative values and falls back from missing PPS", () => {
  const pool = (id: string, values: (number | null)[]) => ({ id, name: id,
    payouts: values.map((realFeePercent, i) => ({ scheme: values.length > 1 && i === 0 ? "PPS" : "PPLNS", realFeePercent })) }) as PoolOverview;
  const rows = [pool("unknown", [null]), pool("zero", [0]), pool("cost", [21.6]), pool("lucky", [-20]),
    pool("Fortune", [null, 5]), pool("measured", [3, 10]), pool("invalid", [NaN, Infinity])];
  assert.deepEqual(sortPools(rows, "realFee", true).map((r) => r.id), ["lucky", "zero", "measured", "Fortune", "cost", "invalid", "unknown"]);
  assert.deepEqual(sortPools(rows, "realFee", false).map((r) => r.id), ["cost", "Fortune", "measured", "zero", "lucky", "invalid", "unknown"]);
});

test("Real Cost help distinguishes PPLNS and PPS windows without borrowing a PPS measurement", () => {
  const row = { name: "Fortune", realFeeMeasurement: { scheme: "PPS", start: 100, end: 600 },
    payouts: [{ scheme: "PPS", realFeePercent: 5 },
      { scheme: "PPLNS", realFeePercent: 21.6, realFeePeriod: { start: 500, end: 600 } }] } as PoolOverview;
  assert.deepEqual(realCostPeriods([row]), [{ start: 100, end: 600, names: ["Fortune (PPS)"] },
    { start: 500, end: 600, names: ["Fortune (PPLNS)"] }]);
  const before = structuredClone(row);
  const missing = { ...row, payouts: [{ scheme: "PPLNS", realFeePercent: 0 }] } as PoolOverview;
  assert.deepEqual(realCostPeriods([missing]), []);
  assert.deepEqual(row, before);
});
