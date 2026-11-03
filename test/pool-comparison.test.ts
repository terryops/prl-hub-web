import { test } from "node:test";
import assert from "node:assert/strict";
import { sortPools, poolSparkline, poolPayouts, realCostPeriods, hasPpsRealCost, ppsWindowEnd, weekLuck, estimatedYield, yieldTrustworthy, netPerPH, payoutCost, netYield, bestYield, rankedYield, orphanRate, schemeFamily, poolsByScheme, ownApiMissing, foundingFee, mergeBonus, minerReport, realFeePending, shareYield, percentRange, realCostParts, realFeeTiers, realCostFewBlocks, REAL_COST_MIN_BLOCKS } from "../src/pool-comparison.ts";
import type { PoolPayout } from "../src/types.ts";
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

test("Real Cost help: the PPS settlement note appears only for a shown PPS-family value", () => {
  const row = (payouts: unknown[], scheme = "PPS") => ({ name: "P", realFeeMeasurement: { scheme, start: 100, end: 600 }, payouts }) as PoolOverview;
  assert.equal(hasPpsRealCost([row([{ scheme: "PPS", realFeePercent: 5 }])]), true);
  assert.equal(hasPpsRealCost([row([{ scheme: "PPS+", realFeePercent: 0 }], "PPS+")]), true);
  assert.equal(hasPpsRealCost([row([{ scheme: null, realFeePercent: 3 }])]), true); // legacy payout borrows the measurement's scheme
  assert.equal(hasPpsRealCost([row([{ scheme: "PPLNS", realFeePercent: 21.6, realFeePeriod: { start: 500, end: 600 } }])]), false);
  assert.equal(hasPpsRealCost([row([{ scheme: "PPS", realFeePercent: null }, { scheme: "PPS", realFeePercent: NaN }])]), false);
  assert.equal(hasPpsRealCost([{ name: "Legacy" } as PoolOverview]), false);
  assert.equal(ppsWindowEnd(Date.UTC(2026, 9, 18, 1, 22)), Date.UTC(2026, 9, 18));
  assert.equal(ppsWindowEnd(Date.UTC(2026, 9, 18)), Date.UTC(2026, 9, 18));
});

const fortune = (luck: unknown) => ({ id: "pf", name: "Pearl Fortune", scheme: "PPLNS", pps: false, solo: false, trustworthy: true,
  earningsPerPH: 80, theoreticalEarningsPerPH: 100, blocksSample: 25, luck,
  payouts: [{ scheme: "PPS", fee: 5, grossPerPH: 100, realFeePercent: 5, estimated: true, solo: false },
    { scheme: "PPLNS", fee: 2, grossPerPH: 80, realFeePercent: null, estimated: false, solo: false }] }) as unknown as PoolOverview;
const week = (ratio: number, expectedBlocks: number) => ({ "7d": { ratio, expectedBlocks, blocks: Math.round(ratio * expectedBlocks), grossPerPH: 0, theoreticalPerPH: 0, start: 1, end: 2, covered: 1 } });

test("7-day luck: shared-reward payouts are priced at today's theory × the week's luck; PPS keeps the network figure", () => {
  const pool = fortune({ "24h": { ratio: .8, expectedBlocks: 25 }, ...week(.98, 190) });
  assert.equal(weekLuck(pool)?.ratio, .98);
  assert.ok(Math.abs(estimatedYield(pool)! - 98) < 1e-9);
  assert.equal(pool.earningsPerPH, 80);
  const [pps, pplns] = poolPayouts(pool);
  assert.deepEqual([pps.grossPerPH, pps.weekly, pps.realFeePercent], [100, undefined, 5]);
  assert.ok(Math.abs(pplns.grossPerPH! - 98) < 1e-9);
  assert.deepEqual([pplns.weekly, pplns.estimated], [true, false]);
  assert.equal(yieldTrustworthy(pool), true);
  // Few expected blocks: a lucky small pool stays an estimate and never takes the top mark.
  const small = fortune(week(2.4, 3.2));
  assert.ok(Math.abs(estimatedYield(small)! - 240) < 1e-9);
  assert.equal(yieldTrustworthy(small), false);
  assert.equal(poolPayouts(small)[1].estimated, true);
  // Sorting by yield follows the estimate, not the day.
  const lucky = { ...fortune(week(.77, 160)), id: "lucky", name: "Lucky" };
  assert.deepEqual(sortPools([lucky, pool], "earnings", false).map((p) => p.id), ["pf", "lucky"]);
});

test("7-day luck: missing, unreadable, PPS and SOLO rows fall back to the 24h figure", () => {
  for (const luck of [undefined, null, {}, { "24h": { ratio: .8, expectedBlocks: 25 } }, week(Number.NaN, 190), week(.9, 0), week(-1, 190), { "7d": null }, { "7d": "week" }]) {
    const pool = fortune(luck);
    assert.equal(weekLuck(pool), null);
    assert.equal(estimatedYield(pool), 80);
    assert.deepEqual(poolPayouts(pool).map((p) => p.grossPerPH), [100, 80]);
  }
  assert.equal(weekLuck({ ...fortune(week(1, 190)), pps: true }), null);
  assert.equal(weekLuck({ ...fortune(week(1, 190)), solo: true }), null);
  assert.equal(weekLuck({ ...fortune(week(1, 190)), theoreticalEarningsPerPH: null }), null);
  assert.equal(yieldTrustworthy({ ...fortune(null), trustworthy: false }), false);
});

const payout = (scheme: string | null, fee: number | null, grossPerPH: number | null, realFeePercent: number | null = null, solo = false) =>
  ({ scheme, fee, grossPerPH, realFeePercent, estimated: true, solo });
const close = (actual: number | null, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("take-home yield: PPS pays the network figure less Real Cost, so PPS pools quoted alike come apart", () => {
  // 2026-10-18 live figures: all three PPS pools were quoted at the same 18.37 PRL/PH·day.
  close(netPerPH(payout("PPS+", 3, 18.36908537496546, 5.947648650779502)), 18.36908537496546 * (1 - 0.05947648650779502));
  close(netPerPH(payout("PPS", 5, 18.391774526036183, 5.003957146717564)), 18.391774526036183 * (1 - 0.05003957146717564));
  close(netPerPH(payout("PPS", 1, 18.36908537496546, 3.594200702636696)), 18.36908537496546 * (1 - 0.03594200702636696));
  close(netPerPH(payout("FPPS", 2, 100, 0)), 100); // a measured zero is kept
  close(netPerPH(payout("PPS", 2, 100, -1)), 101); // so is a pool that paid above the network figure
  // Until Real Cost is measured, the tariff stands in.
  close(netPerPH(payout("PPS", 4, 100, null)), 96);
  close(netPerPH(payout("PPS", 4, 100, Number.NaN)), 96);
  assert.equal(payoutCost(payout("PPS", 4, 100, 6)), 6);
});

test("take-home yield: shared-reward payouts lose only the fee; their Real Cost estimate already includes luck", () => {
  close(netPerPH(payout("PPLNS", 2, 80, 21.6)), 78.4);
  close(netPerPH(payout("PROP", 0, 120, -20)), 120);
  close(netPerPH(payout("PPLNS", 1, 0)), 0);
  // A payout without a scheme follows the row: a PPS row uses its Real Cost, any other row its fee.
  const row = (pps: boolean) => ({ pps, solo: false }) as PoolOverview;
  close(netPerPH(payout(null, 3, 100, 5), row(true)), 95);
  close(netPerPH(payout(null, 3, 100, 5), row(false)), 97);
  close(netPerPH(payout(null, 3, 100, 5)), 97);
  // Unknown stays unknown: no fee, no gross figure, SOLO.
  for (const p of [payout("PPLNS", null, 80), payout("PPS", null, 100), payout("PPLNS", 1, null), payout("SOLO", 1, 100, null, true)]) assert.equal(netPerPH(p), null);
  assert.equal(netPerPH(payout("PPLNS", 1, 100), { pps: false, solo: true } as PoolOverview), null);
  assert.equal(payoutCost(payout("PPLNS", Number.POSITIVE_INFINITY, 80)), null);
});

test("take-home yield: sorting and the green mark use what a miner keeps", () => {
  const row = (id: string, payouts: ReturnType<typeof payout>[], extra: Partial<PoolOverview> = {}) =>
    ({ id, name: id, pps: false, solo: false, trustworthy: true, payouts, ...extra }) as unknown as PoolOverview;
  const kryptex = row("kryptex", [payout("PPS+", 3, 100, 6)], { pps: true, trustworthy: false });
  const f2pool = row("f2pool", [payout("PPS", 1, 100, 3.5)], { pps: true, trustworthy: false });
  const fortune = row("fortune", [payout("PPS", 5, 100, 5), payout("PPLNS", 2, 98)]);
  const hero = row("hero", [payout("PPLNS", 0, 96.3)]);
  const pearl = row("pearl", [payout(null, 1, 97)]);
  const solo = row("solo", [payout("SOLO", 1, 500, null, true)], { solo: true });
  const unknown = row("unknown", [payout("PPLNS", null, 200)]);
  const rows = [kryptex, f2pool, fortune, hero, pearl, solo, unknown];
  // Fortune keeps 96.04 on PPLNS (more than its PPS 95); a 0% fee beats a higher gross figure at 1%.
  close(netYield(fortune), 96.04);
  assert.deepEqual(sortPools(rows, "earnings", false).map((r) => r.id), ["f2pool", "hero", "fortune", "pearl", "kryptex", "solo", "unknown"]);
  assert.deepEqual(sortPools(rows, "earnings", true).map((r) => r.id), ["kryptex", "pearl", "fortune", "hero", "f2pool", "solo", "unknown"]);
  // F2Pool keeps the most, but PPS is never ranked; HeroMiners is the best measured payout.
  close(bestYield(rows), 96.3);
  assert.equal(rankedYield(fortune, fortune.payouts![0]), null);
  close(rankedYield(fortune, fortune.payouts![1]), 96.04);
  assert.equal(rankedYield({ ...hero, trustworthy: false }, hero.payouts![0]), null);
  assert.equal(bestYield([kryptex, f2pool, solo, unknown]), null);
  assert.equal(bestYield([]), null);
});

test("orphan rate: the pool's own orphans ÷ blocks; unreadable or missing counts are unknown, a genuine zero is kept", () => {
  const pool = (orphans: unknown) => ({ id: "p", name: "P", orphans }) as PoolOverview;
  const week = { start: 1000, end: 1000 + 7 * 86400 };
  assert.deepEqual(orphanRate(pool({ ...week, blocks: 200, orphans: 3 })), { percent: 1.5, orphans: 3, blocks: 200, ...week, source: "pool" });
  // A count the explorer's node saw says so; anything else is the pool's own list.
  assert.equal(orphanRate(pool({ ...week, blocks: 263, orphans: 2, source: "chain" }))!.source, "chain");
  assert.equal(orphanRate(pool({ ...week, blocks: 263, orphans: 2, source: "other" }))!.source, "pool");
  assert.equal(orphanRate(pool({ ...week, blocks: 178, orphans: 0 }))!.percent, 0);
  for (const bad of [null, undefined, { ...week, blocks: 0, orphans: 0 }, { ...week, blocks: 10, orphans: 11 }, { ...week, blocks: 10, orphans: -1 },
    { ...week, blocks: 10.5, orphans: 1 }, { ...week, blocks: 10, orphans: NaN }, { start: 5, end: 5, blocks: 10, orphans: 1 }, { blocks: 10, orphans: 1 }])
    assert.equal(orphanRate(pool(bad)), null);
  // Sorting puts the lowest rate first when ascending; pools without one stay last both ways.
  const rows = [pool(null), pool({ ...week, blocks: 100, orphans: 4 }), pool({ ...week, blocks: 100, orphans: 0 })].map((r, i) => ({ ...r, id: String(i), name: String(i) }));
  assert.deepEqual(sortPools(rows, "orphans", true).map((r) => r.id), ["2", "1", "0"]);
  assert.deepEqual(sortPools(rows, "orphans", false).map((r) => r.id), ["1", "2", "0"]);
});
test("scheme guide: payouts group into PPS, PROP, PPLNS and SOLO, largest pool first, unnamed schemes left out", () => {
  for (const [scheme, family] of [["PPS", "PPS"], ["PPS+", "PPS"], ["FPPS", "PPS"], [" pps ", "PPS"], ["PROP", "PROP"], ["prop", "PROP"],
    ["PPLNS", "PPLNS"], ["SOLO", "SOLO"], [null, null], ["", null], ["PPLNT", null]] as const) assert.equal(schemeFamily(scheme), family);
  assert.equal(schemeFamily("PPLNS", true), "SOLO");
  const row = (id: string, hashrate: number | null, ...schemes: (string | null)[]) => ({ id, name: id, hashrate, solo: schemes[0] === "SOLO",
    payouts: schemes.map((scheme) => ({ scheme, fee: 1, grossPerPH: null, realFeePercent: null, estimated: true, solo: scheme === "SOLO" })) }) as PoolOverview;
  const groups = poolsByScheme([row("small", 1, "PPLNS"), row("kryptex", 30, "PPS+"), row("pf", 4, "PPS", "PPLNS"), row("hash", 14, null),
    row("hero", 3, "PROP"), row("unknown", null, "PPLNS"), row("solo", 2, "SOLO")]);
  const names = (f: keyof typeof groups) => groups[f].map((g) => `${g.pool.id}:${g.scheme}`);
  assert.deepEqual(names("PPS"), ["kryptex:PPS+", "pf:PPS"]);
  assert.deepEqual(names("PPLNS"), ["pf:PPLNS", "small:PPLNS", "unknown:PPLNS"]);
  assert.deepEqual(names("PROP"), ["hero:PROP"]);
  assert.deepEqual(names("SOLO"), ["solo:SOLO"]);
  assert.deepEqual(poolsByScheme([]), { PPS: [], PROP: [], PPLNS: [], SOLO: [] });
});
test("own API dot: only a partial snapshot's Kryptex, HeroMiners or Pearl Fortune row that kept the table's fee", () => {
  const row = (name: string, feeFromPoolAPI: boolean, solo = false) => ({ name, feeFromPoolAPI, solo });
  assert.equal(ownApiMissing(row("Pearl Fortune", false), true), true);
  assert.equal(ownApiMissing(row("Kryptex", false), true), true);
  assert.equal(ownApiMissing(row("HeroMiners", false), true), true);
  // The snapshot read the pool's API, or nothing failed at all.
  assert.equal(ownApiMissing(row("Pearl Fortune", true), true), false);
  assert.equal(ownApiMissing(row("Pearl Fortune", false), false), false);
  assert.equal(ownApiMissing(row("Pearl Fortune", false), undefined), false);
  // Pools the overview never asks directly, and SOLO rows, which keep their own terms.
  assert.equal(ownApiMissing(row("PearlHash", false), true), false);
  assert.equal(ownApiMissing(row("Kryptex", false, true), true), false);
});

test("merge bonus: F2Pool's NOCK label is read only when the service sent sane terms", () => {
  const payout = (mergeBonus: unknown) => ({ scheme: "PPS", fee: 1, grossPerPH: 16, realFeePercent: null, estimated: true, solo: false, mergeBonus } as PoolPayout);
  assert.deepEqual(mergeBonus(payout({ coin: "NOCK", minPercent: 1, maxPercent: 2 })), { coin: "NOCK", min: 1, max: 2 });
  assert.deepEqual(mergeBonus(payout({ coin: "NOCK", minPercent: 1.5, maxPercent: 1.5 })), { coin: "NOCK", min: 1.5, max: 1.5 });
  for (const bad of [undefined, null, {}, { coin: "nock", minPercent: 1, maxPercent: 2 }, { coin: "<b>", minPercent: 1, maxPercent: 2 },
    { coin: "NOCK", minPercent: 3, maxPercent: 2 }, { coin: "NOCK", minPercent: -1, maxPercent: 2 }, { coin: "NOCK", minPercent: 1, maxPercent: 200 },
    { coin: "NOCK", minPercent: "1", maxPercent: 2 }, { coin: "NOCK", minPercent: 1, maxPercent: Infinity }])
    assert.equal(mergeBonus(payout(bad)), null, JSON.stringify(bad));
});
test("miner report: PearlHash's WildRig line needs sane terms and a Real Cost of its own", () => {
  const report = { miner: "WildRig", credited: .91, realFeePercent: 9.091 };
  const payout = (minerReport: unknown, realFeePercent: number | null = .1) => ({ scheme: "PROP", fee: .1, grossPerPH: 16, realFeePercent, estimated: true, solo: false, minerReport } as PoolPayout);
  assert.deepEqual(minerReport(payout(report)), { miner: "WildRig", credited: .91, realFeePercent: 9.091 });
  assert.equal(minerReport(payout(report, null)), null);
  for (const bad of [undefined, null, {}, { ...report, realFeePercent: null }, { ...report, realFeePercent: NaN }, { ...report, realFeePercent: 101 },
    { ...report, credited: 0 }, { ...report, credited: 1.1 }, { ...report, credited: "0.91" }, { ...report, miner: "<b>" }, { ...report, miner: "" }, { ...report, miner: 7 }])
    assert.equal(minerReport(payout(bad)), null, JSON.stringify(bad));
});
test("share yield: a part between 0 and 1, and only beside a Real Cost figure", () => {
  const payout = (y: unknown, realFeePercent: number | null = 9.42) => ({ scheme: "PROP", fee: 1, grossPerPH: 16, realFeePercent, estimated: true, solo: false, shareYield: y } as PoolPayout);
  assert.equal(shareYield(payout(.915)), .915);
  assert.equal(shareYield(payout(.915, null)), null);
  assert.equal(shareYield(payout(.915, Number.NaN)), null);
  for (const bad of [undefined, null, 0, 1, 1.2, -.5, "0.915", Number.NaN]) assert.equal(shareYield(payout(bad)), null, String(bad));
});
test("Real Cost parts: fee, the week's orphans and the rest, at 2 decimals, adding up to the figure (PF on 2026-11-02)", () => {
  const week = { start: 1000, end: 1000 + 7 * 86400 };
  const row = (orphans: unknown, extra = {}) => ({ id: "p", name: "Pearl Fortune", pps: false, solo: false, orphans, ...extra }) as PoolOverview;
  const pay = (scheme: string | null, realFeePercent: unknown, fee: unknown = 2, solo = false) =>
    ({ scheme, fee, grossPerPH: 13, realFeePercent, estimated: true, solo }) as PoolPayout;
  const live = row({ ...week, blocks: 322, orphans: 4, source: "chain" });
  assert.deepEqual(realCostParts(live, pay("PPLNS", 3.470538202021678)), { fee: 2, orphans: { percent: 1.24, orphans: 4, blocks: 322 }, other: 0.23, total: 3.47 });
  // No orphan count: the rest is everything past the fee.
  assert.deepEqual(realCostParts(row(null), pay("PROP", 3.470538202021678)), { fee: 2, orphans: null, other: 1.47, total: 3.47 });
  // The rest can be negative, and an even split reads 0, never -0.
  assert.equal(realCostParts(row({ ...week, blocks: 100, orphans: 1 }), pay("PROP", .5, 1))!.other, -1.5);
  assert.ok(Object.is(realCostParts(row(null), pay("PROP", 1.001, 1))!.other, 0));
  // A PPS settlement has no parts, nor SOLO, nor a payout without a figure or a fee; an unnamed scheme follows its row.
  for (const [r, p] of [[live, pay("PPS", 3)], [live, pay("PPS+", 3)], [row(null, { pps: true }), pay(null, 3)], [live, pay("SOLO", 3, 1, true)],
    [row(null, { solo: true }), pay("PPLNS", 3)], [live, pay("PPLNS", null)], [live, pay("PPLNS", Number.NaN)], [live, pay("PPLNS", 3, null)]] as const)
    assert.equal(realCostParts(r, p), null, JSON.stringify(p));
  assert.equal(realCostParts(row(null), pay(null, 3))!.total, 3);
});
test("held-back Real Cost: a real day and no figure, read as a UTC date", () => {
  const payout = (realFeePending: unknown, realFeePercent: number | null = null) => ({ scheme: "PROP", fee: .1, grossPerPH: 16, realFeePercent, estimated: true, solo: false, realFeePending } as PoolPayout);
  assert.equal(realFeePending(payout("2026-11-02"))?.toISOString(), "2026-11-02T00:00:00.000Z");
  assert.equal(realFeePending(payout("2026-11-02", .1)), null);
  for (const bad of [undefined, null, "", "2026-11-31", "2026-13-02", "2026-11-2", "11/02/2026", "2026-11-02T00:00Z", 20261102])
    assert.equal(realFeePending(payout(bad)), null, JSON.stringify(bad));
  // The day as the cell writes it, whatever the reader's time zone.
  const day = realFeePending(payout("2026-11-02"))!;
  assert.equal(day.toLocaleDateString("zh-Hans", { month: "short", day: "numeric", timeZone: "UTC" }), "11月2日");
  assert.equal(day.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }), "Nov 2");
});
test("merge bonus: the range keeps one percent sign where each language writes it", () => {
  assert.equal(percentRange(1, 2, "en"), "1–2%");
  assert.equal(percentRange(1, 2, "zh-Hans"), "1–2%");
  assert.equal(percentRange(1, 2, "de").replace(/\s/gu, " "), "1–2 %"); // a no-break space, as Intl writes it
  assert.equal(percentRange(1, 2, "tr"), "%1–2");
  assert.equal(percentRange(1.5, 1.5, "en"), "1.5%");
  assert.equal(percentRange(1.5, 1.5, "fr").replace(/\s/gu, " "), "1,5 %");
});
test("founding fee: a sane founding fee and its months after FP8; anything else is no label", () => {
  const payout = (founding: unknown) => ({ scheme: "PPLNS", fee: 1, grossPerPH: 13, realFeePercent: null, estimated: true, solo: false, founding } as PoolPayout);
  assert.deepEqual(foundingFee(payout({ fee: 0, afterFP8Months: 6 })), { fee: 0, afterFP8Months: 6 });
  assert.deepEqual(foundingFee(payout({ fee: 0.5 })), { fee: 0.5, afterFP8Months: null });
  assert.deepEqual(foundingFee(payout({ fee: 0.5, afterFP8Months: 1.5 })), { fee: 0.5, afterFP8Months: null });
  for (const bad of [undefined, null, {}, { fee: "0" }, { fee: -1 }, { fee: 101 }, { fee: Number.NaN }]) assert.equal(foundingFee(payout(bad)), null);
});

test("Peryn's Real Cost per fee tier: the shown tier first, the other after it, missing figures as null", () => {
  const pay = (extra: Record<string, unknown>) => ({ scheme: "PPS+", fee: 1, grossPerPH: null, realFeePercent: 0.78, estimated: true, solo: false, ...extra }) as PoolPayout;
  assert.deepEqual(realFeeTiers(pay({ realFeeTier: "founding", realFeeTiers: { founding: 0.78, standard: 1.26 } })),
    [{ tier: "founding", percent: 0.78, shown: true }, { tier: "standard", percent: 1.26, shown: false }]);
  assert.deepEqual(realFeeTiers(pay({ realFeeTier: "standard", realFeeTiers: { founding: null, standard: 1.26 } })),
    [{ tier: "standard", percent: 1.26, shown: true }, { tier: "founding", percent: null, shown: false }]);
  assert.deepEqual(realFeeTiers(pay({ realFeeTier: "founding", realFeeTiers: { founding: 0.78, standard: "1.26" } }))![1].percent, null);
  for (const bad of [{}, { realFeeTier: "gold", realFeeTiers: {} }, { realFeeTier: "founding" }, { realFeeTier: "founding", realFeeTiers: {}, realFeePercent: null }])
    assert.equal(realFeeTiers(pay(bad)), null);
});
test("Real Cost too few blocks: a PPLNS / PROP dash whose week is worth under 100 blocks says how many", () => {
  const row = (expectedBlocks: unknown, extra: Partial<PoolOverview> = {}) => ({ name: "Jetski", luck: { "7d": { expectedBlocks } }, ...extra }) as PoolOverview;
  const pay = (scheme: string | null, realFeePercent: number | null = null, extra: Partial<PoolPayout> = {}) =>
    ({ scheme, fee: 1, grossPerPH: 8.8, realFeePercent, estimated: true, solo: false, ...extra }) as PoolPayout;
  // Jetski, 2026-11-03: 7-day luck window worth 47.8 blocks, no figure.
  assert.equal(realCostFewBlocks(row(47.82405635451607), pay("PPLNS")), 47.82405635451607);
  assert.equal(realCostFewBlocks(row(3.8), pay("PROP")), 3.8);
  assert.equal(REAL_COST_MIN_BLOCKS, 100);
  // A figure, a held-back date, a big enough week, no week, PPS, SOLO or an unnamed scheme: something else explains it.
  for (const [r, p] of [[row(47.8), pay("PPLNS", 1)], [row(47.8), pay("PPLNS", null, { realFeePending: "2026-11-05" })],
    [row(100), pay("PPLNS")], [row(279), pay("PROP")], [row(undefined), pay("PPLNS")], [row(0), pay("PPLNS")], [row(Number.NaN), pay("PPLNS")],
    [{ name: "Peryn" } as PoolOverview, pay("PPLNS")], [row(47.8), pay("PPS+")], [row(47.8), pay("SOLO", null, { solo: true })],
    [row(47.8, { solo: true }), pay("PPLNS")], [row(47.8), pay(null)]] as const)
    assert.equal(realCostFewBlocks(r, p), null, JSON.stringify([r, p]));
});
