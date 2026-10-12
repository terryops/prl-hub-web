import { test } from "node:test";
import assert from "node:assert/strict";
import { sortPools, poolSparkline, poolPayouts } from "../src/pool-comparison.ts";
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
