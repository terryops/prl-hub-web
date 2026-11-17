import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { rollingOutputObservation, rollingRealCost, poolPayouts, settlementCost, verifiedMinerCost } from "../src/pool-comparison.ts";
import type { PoolPayout, PoolOverview, RollingOutputObservation } from "../src/types.ts";

const golden: PoolPayout = JSON.parse(readFileSync(new URL("./fixtures/herominers-rolling.json", import.meta.url), "utf8"));
const raw = golden.realFeeEstimate!;
const output: RollingOutputObservation = {
  id: raw.id, pool: raw.pool, theoryBasis: raw.theoryBasis, start: raw.start, end: raw.end,
  measuredAt: raw.measuredAt, targetDays: raw.targetDays, poolBlocks: raw.poolBlocks,
  blocksSample: raw.blocksSample, orphans: raw.orphans, work: raw.work,
  foundYield: raw.foundYield, foundYield95: raw.foundYield95, confidence: raw.confidence,
  confidenceMethod: raw.confidenceMethod, sourceVersion: 2, luckExcluded: false,
};
const observation = { ...golden, realFeePercent: null, realFeeEstimate: undefined, outputObservation: output };

test("real 27-day output is a diagnostic and never becomes a full cost", () => {
  const result = rollingOutputObservation(observation)!;
  assert.equal(result.days, 27); assert.equal(result.poolBlocks, 656);
  assert.equal(result.orphans, 4); assert.equal(result.blocksSample, 652);
  assert.equal(result.luckExcluded, false); assert.equal(observation.realFeePercent, null);
  const row = { name: "HeroMiners", solo: false, payouts: [observation] } as PoolOverview;
  assert.equal(poolPayouts(row)[0].realFeePercent, null);
  assert.deepEqual(poolPayouts(row)[0].outputObservation, output);
});

test("malformed or wrong-basis block observations are rejected", () => {
  assert.equal(rollingOutputObservation(golden), null);
  for (const change of [{ foundYield95: [1, 1] }, { work: 0 }, { end: Infinity },
    { measuredAt: NaN }, { orphans: 668 }, { poolBlocks: 99 }, { targetDays: 7 }, { sourceVersion: 1 }, { luckExcluded: true }])
    assert.equal(rollingOutputObservation({ ...observation, outputObservation: { ...output, ...change } as RollingOutputObservation }), null, JSON.stringify(change));
  assert.equal(rollingOutputObservation({ ...observation, solo: true }), null);
});

test("the service's Real Cost reaches the table as sent; it is not relabelled a miner-reported measurement", () => {
  for (const scheme of ["PPS", "PPS+", "PPLNS", "PROP"]) {
    const row = { name: "Pool", solo: false, payouts: [{ ...golden, scheme, shareYield: .982 }] } as PoolOverview;
    const result = poolPayouts(row)[0];
    assert.equal(result.realFeePercent, golden.realFeePercent, scheme); assert.equal(result.shareYield, .982);
    assert.equal(verifiedMinerCost(result), false);
  }
});

test("HeroMiners' rolling estimate: its figure, period and count interval, checked against each other", () => {
  const r = rollingRealCost(golden)!;
  assert.equal(r.days, 27); assert.equal(r.poolBlocks, 656); assert.equal(r.blocksSample, 652);
  assert.ok(Math.abs(golden.realFeePercent! - 4.327139899798215) < 1e-9);
  assert.ok(r.cost95[0] < 0 && r.cost95[1] > 11); assert.equal(r.lossUnconfirmed, true);
  for (const change of [{ ratio: .9 }, { cost95: [5, 6] }, { start: raw.start + 1 }, { sourceVersion: 1 }, { id: "x" }, { poolBlocks: 99 }])
    assert.equal(rollingRealCost({ ...golden, realFeeEstimate: { ...raw, ...change } as typeof raw }), null, JSON.stringify(change));
  assert.equal(rollingRealCost({ ...golden, realFeePercent: 9 }), null);
  assert.equal(rollingRealCost({ ...golden, realFeePeriod: { start: raw.start, end: raw.end + 86400 } }), null);
  assert.equal(rollingRealCost({ ...golden, scheme: "PPS" }), null);
});

test("only HeroMiners' rolling estimate is shown: PearlHash's accepted_share_work record is refused since its delisting", () => {
  const work = 2466.3, blocks = 2343, foundYield = blocks / work, ratio = 0.99 * foundYield, percent = (1 - ratio) * 100;
  const ph: PoolPayout = {
    scheme: "PROP", fee: 1, grossPerPH: 12, solo: false, estimated: true,
    realFeePercent: percent, realFeeEstimated: true, realFeePeriod: { start: raw.start, end: raw.start + 26 * 86400 },
    realFeeEstimate: {
      ...raw, id: "https://pearlhash.xyz/", pool: "PearlHash", scheme: "PROP", theoryBasis: "accepted_share_work",
      end: raw.start + 26 * 86400, poolBlocks: blocks, blocksSample: blocks, orphans: 0, work, feePercent: 1,
      foundYield, foundYield95: [foundYield - 0.039, foundYield + 0.04], ratio, cost95: [2.06, 9.72],
    },
  };
  assert.equal(rollingRealCost(ph), null);
});

test("a verified wire record requires explicit luck exclusion, a common basis and at least six hours", () => {
  const good: PoolPayout = { ...golden, realFeeStatus: "verified", realFeeBasis: "miner_reported_work", realFeeLuckExcluded: true };
  assert.equal(verifiedMinerCost(good), true);
  for (const p of [{ ...good, realFeeStatus: "partial" }, { ...good, realFeeBasis: undefined },
    { ...good, realFeeLuckExcluded: false }, { ...good, realFeeLuckExcluded: undefined },
    { ...good, realFeePeriod: { start: 1, end: 100 } }, { ...good, solo: true }])
    assert.equal(verifiedMinerCost(p as PoolPayout), false);
});

test("a settlement component stays separate from the complete-cost field", () => {
  const p: PoolPayout = { ...golden, realFeePercent: null, settlementCost: {
    percent: 4, start: raw.start, end: raw.end, basis: "pool_recorded_work", luckExcluded: true, estimated: false,
    verified: true, component: "allocation_deduction",
  } };
  assert.equal(settlementCost(p)?.percent, 4); assert.equal(verifiedMinerCost(p), false);
  assert.equal(settlementCost({ ...p, settlementCost: { ...p.settlementCost!, percent: NaN } }), null);
  for (const o of [{ ...p.settlementCost!, estimated: true }, { ...p.settlementCost!, verified: undefined },
    { ...p.settlementCost!, component: undefined }]) assert.equal(settlementCost({ ...p, settlementCost: o }), null);
});

test("all 16 locales retain the rolling estimate's data placeholders", () => {
  const localePath = new URL("../src/i18n/", import.meta.url);
  const dictionaries: Record<string, Record<string, string>> = Object.fromEntries(readdirSync(localePath)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(new URL(name, localePath), "utf8"))]));
  assert.equal(Object.keys(dictionaries).length, 16);
  const keys = ["poolRollingTitle", "poolRollingSample", "poolRollingYield", "poolRollingCostRange",
    "poolRollingUnconfirmed", "poolRollingBasis", "poolRollingPending", "poolRollingPeriodIntro",
    "poolNegativeCostWarn", "poolDelisted"] as const;
  const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
  for (const [lang, dictionary] of Object.entries(dictionaries)) for (const key of keys) {
    assert.ok(dictionary[key].trim(), `${lang}:${key}`);
    assert.deepEqual(placeholders(dictionary[key]), placeholders(dictionaries.en[key]), `${lang}:${key}`);
  }
});
