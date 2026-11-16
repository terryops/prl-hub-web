import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { costPools, parsePoolCostRoute, poolCostDetailHref, poolCostHref } from "../src/pool-cost-route.ts";
import { auditTable, costCopy, costSchemes, costStory, type AuditColumn } from "../src/real-cost-content.ts";

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
after(() => server.close());
const { default: PoolCostDetail } = await server.ssrLoadModule("/src/PoolCostDetail.tsx");

const DAY = 86400, end = 1794182400, start = end - 7 * DAY;
const period = { start, end };
const hero = JSON.parse(readFileSync(new URL("./fixtures/herominers-rolling.json", import.meta.url), "utf8"));
const orphans = (o: number, blocks: number) => ({ start, end, blocks, orphans: o, source: "chain" });
// What /v1/pools sends for each kind of figure (alerts/src/realfees.js).
const data = { ok: true, ts: end + 3600, source: "test", network: null, partial: false, rows: [
  { id: "https://pearlhash.xyz/", name: "PearlHash", solo: false, orphans: orphans(4, 592),
    payouts: [{ scheme: "PROP", fee: 1, grossPerPH: 12, solo: false, estimated: true, realFeePercent: 100 - 99 * .982,
      realFeeEstimated: true, realFeePeriod: period, shareYield: .982 }] },
  { id: "https://pearl.luckypool.io/", name: "Lucky Pool", solo: false, orphans: orphans(0, 234),
    payouts: [{ scheme: "PROP", fee: 1, grossPerPH: 12, solo: false, estimated: true, realFeePercent: 9.9, realFeeEstimated: true, realFeePeriod: period }] },
  { id: "https://pearl.herominers.com/", name: "HeroMiners", solo: false, payouts: [hero] },
  { id: "https://pearlfortune.org/", name: "Pearl Fortune", solo: false, orphans: orphans(1, 343),
    realFeeMeasurement: { pool: "Pearl Fortune", scheme: "PPS", netPRL: 95.99, expectedPRL: 100, start, end, measuredAt: end, estimated: true, sampleCount: 5, theoryBasis: "hashrate_chain" },
    payouts: [{ scheme: "PPS", fee: 4, grossPerPH: 12, solo: false, estimated: true, realFeePercent: 4.01, realFeeEstimated: true, realFeePeriod: period },
      { scheme: "PPLNS", fee: 2, grossPerPH: 12, solo: false, estimated: true, realFeePercent: 2.41, realFeeEstimated: true, realFeePeriod: period }] },
  { id: "https://peryn.ai/", name: "Peryn", solo: false,
    realFeeMeasurement: { pool: "Peryn", scheme: "PPS+", tier: "founding", netPRL: 97.89, expectedPRL: 100, start, end, measuredAt: end, estimated: true, sampleCount: 5, theoryBasis: "hashrate_chain" },
    payouts: [{ scheme: "PPLNS", fee: 1, grossPerPH: 12, solo: false, estimated: false, realFeePercent: null },
      { scheme: "PPS+", fee: 1, grossPerPH: 12, solo: false, estimated: true, realFeePercent: 2.11, realFeeEstimated: true, realFeePeriod: period,
        realFeeTier: "founding", realFeeTiers: { founding: 2.11, standard: -0.06 } }] },
] };
const render = (slug: string, scheme: string | null = null, tier: "founding" | "standard" | null = null, lang = "zh-Hans", d: unknown = data) =>
  renderToStaticMarkup(React.createElement(PoolCostDetail, { route: { slug, scheme, tier }, data: d, lang }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

test("every pool with a page has a plain explanation in both languages for each scheme it pays", () => {
  const methods: Record<string, string> = { "pearl-fortune:PPS": "pps", "pearl-fortune:PPLNS": "effort", "lucky:PROP": "effort",
    "kryptex:PPS+": "pps", "f2pool:PPS": "pps", "peryn:PPS+": "pps", "pearlhash:PROP": "display", "herominers:PROP": "rolling" };
  for (const pool of costPools) for (const scheme of costSchemes(pool.slug)) for (const lang of ["zh", "en"] as const) {
    const s = costStory(pool.slug, scheme, lang)!;
    assert.equal(s.method, methods[`${pool.slug}:${scheme}`], `${pool.slug}:${scheme}`);
    assert.ok(s.summary && s.steps.length >= 2 && s.verify.length >= 2 && s.sources.length >= 1);
    assert.ok(s.sources.every(([, url]) => new URL(url).protocol === "https:"));
    // Standard terms (孤块率, effort, 置信区间) are fine; the first version's coinages are not.
    const all = [s.summary, ...s.steps, ...s.checked, ...s.verify, ...s.unsure].join(" ");
    for (const word of lang === "zh" ? ["同窗", "证据覆盖", "条件统计", "分项合计", "Byar"] : ["Byar", "cohort", "telemetry"])
      assert.ok(!all.includes(word), `${pool.slug}:${scheme}:${lang} uses "${word}"`);
    // English, like the app's English strings: no "miner", "mining" or "rig" (App Store review).
    if (lang === "en") assert.doesNotMatch(all, /\b(miner|mining|rig)s?\b/i, `${pool.slug}:${scheme}`);
  }
  assert.deepEqual(Object.keys(methods).length, costPools.flatMap((p) => costSchemes(p.slug)).length);
  assert.equal(costStory("unknown", "PROP", "zh"), null);
  assert.doesNotMatch(Object.values(costCopy.en).join(" "), /\b(miner|mining|rig)s?\b/i);
});

test("audit record: one table of dated periods per pool but Peryn, the same figures for both languages", () => {
  const iso = /^2026-\d{2}-\d{2}$/;
  for (const [slug, scheme, n] of [["pearl-fortune", "PPS", 3], ["pearl-fortune", "PPLNS", 2], ["lucky", "PROP", 2], ["kryptex", "PPS+", 3],
    ["f2pool", "PPS", 3], ["pearlhash", "PROP", 2], ["herominers", "PROP", 2]] as const) {
    const t = auditTable(slug, scheme)!;
    assert.equal(t.rows.filter((r) => !r.total).length, n, `${slug}:${scheme}`);
    let last = "";
    for (const r of t.rows) {
      assert.match(r.from, iso); assert.match(r.to, iso); assert.ok(r.from <= r.to);
      if (r.measured) assert.ok(r.from <= r.measured[0] && r.measured[0] <= r.measured[1] && r.measured[1] <= r.to);
      // Periods in order and apart; a combined row spans them.
      if (!r.total) { assert.ok(r.from > last, `${slug}:${scheme} ${r.from}`); last = r.to; }
      for (const k of Object.keys(r.values)) assert.ok(t.columns.includes(k as AuditColumn), `${slug}:${scheme} ${k}`);
    }
    for (const k of ["period", "cost", "total", ...t.columns] as const) for (const lang of ["zh", "en"] as const) assert.ok(costCopy[lang].audit[k], k);
    // Once a period is in the table it is not repeated as a sentence.
    assert.ok(!costStory(slug, scheme, "zh")!.checked.some((l) => /：真实费用 \d/.test(l)), `${slug}:${scheme}`);
    assert.ok(!costStory(slug, scheme, "en")!.checked.some((l) => /: Real Cost \d/.test(l)), `${slug}:${scheme}`);
  }
  // Peryn's pages keep 7 days of hashrate and older readings do not reproduce, so it has no table.
  assert.equal(auditTable("peryn", "PPS+"), null);
  assert.equal(auditTable("pearl-fortune", "pps")?.rows.map((r) => r.cost).join(), "5.01,3.01,4.01");
});

test("audit table: headers, dates and figures as the page shows them", () => {
  const ph = text(render("pearlhash"));
  assert.match(ph, /核查记录 时期（UTC） 真实费用 换算系数 实际出块 按显示算力应出 按 share 应出 10-20 至 11-02 9\.41% 0\.915 1,358 1,363 1,489 11-04 至 11-09 2\.77% 0\.982 427 421 430 每小时分账/);
  assert.match(text(render("pearlhash", null, null, "en")), /Period \(UTC\) Real Cost Conversion factor .* Oct 20 – Nov 2 9\.41% 0\.915 1,358 1,363 1,489 Nov 4 – Nov 9 2\.77%/);
  assert.match(text(render("pearl-fortune", "PPLNS")), /10-26 至 11-01 2\.98% 2% 3 \/ 301 11-02 至 11-08 2\.29% 2% 1 \/ 340/);
  assert.match(text(render("herominers")), /10-27 至 11-09 3\.10% −8\.0% ～ 13\.3% 328 0 338\.5 合计 10-13 至 11-09 4\.28% −3\.2% ～ 11\.4% 675 4 705\.2/);
  const f2 = text(render("f2pool", null, null, "en"));
  assert.match(f2, /Sep 30 – Oct 8 5\.72% Sep 30 – Oct 4 ≈5\.0% 1% Oct 9 – Nov 2 3\.45% – 3\.51% Oct 15 – Nov 1 ≈2\.9% 1% Nov 3 – Nov 10 — ≈4\.0% 1%/);
  const html = render("lucky");
  assert.match(html, /<th scope="col">share ÷ 显示算力<\/th>/); assert.match(html, /<th scope="row">10-13 至 10-30<\/th>/);
  assert.match(text(render("peryn")), /核查记录 仅采用/); assert.ok(!render("peryn").includes("cost-audit"));
});

test("deep links round-trip pool, scheme and tier, including the plus sign", () => {
  for (const pool of costPools) for (const scheme of ["PPS+", "PPS", "PPLNS", "PROP"]) {
    assert.deepEqual(parsePoolCostRoute(poolCostHref(pool.slug, scheme, "standard")), { slug: pool.slug, scheme, tier: "standard" });
  }
  for (const hash of ["#pools", "#pools/real-cost/", "#pools/real-cost/../x", "#pools/real-cost/%3Cscript%3E"])
    assert.equal(parsePoolCostRoute(hash), null);
  assert.deepEqual(parsePoolCostRoute("#pools/real-cost/lucky?scheme=%3Cscript%3E&tier=x"), { slug: "lucky", scheme: null, tier: null });
});

test("the overview's arrow appears only for a pool with a page and a figure to explain", () => {
  const [pf, lucky, , , , ph] = costPools;
  const p = (scheme: string | null, realFeePercent: number | null, solo = false) => ({ scheme, realFeePercent, solo });
  assert.equal(poolCostDetailHref({ ...pf, scheme: "PPLNS", solo: false }, [p("PPS", 4), p("PPLNS", 2.4)]), poolCostHref("pearl-fortune", "PPLNS"));
  assert.equal(poolCostDetailHref({ ...pf, scheme: "PPLNS", solo: false }, [p("PPS", 4), p("PPLNS", null)]), poolCostHref("pearl-fortune", "PPS"));
  assert.equal(poolCostDetailHref({ ...lucky, scheme: "PROP", solo: false }, [p("PROP", null)]), null);
  assert.equal(poolCostDetailHref({ ...lucky, scheme: "PROP", solo: true }, [p("PROP", 9.9)]), null);
  assert.equal(poolCostDetailHref({ ...ph, scheme: null, solo: false }, [p(null, 2.8)]), poolCostHref("pearlhash", "PROP"));
  assert.equal(poolCostDetailHref({ ...ph, scheme: null, solo: false }, [p("SOLO", 2.8, true)]), null);
  assert.equal(poolCostDetailHref({ id: "https://alpha.example/", scheme: "PPLNS", solo: false }, [p("PPLNS", 3)]), null);
});

test("PearlHash: the live figure, its share ratio and the formula with its numbers", () => {
  const html = render("pearlhash"), t = text(html);
  assert.match(t, /PearlHash 真实费用计算说明/);
  assert.match(t, /≈2\.78%/);
  assert.match(t, /0\.9820/);
  assert.match(t, /1 − \(1 − 1%\) × 0\.9820 = 2\.78%/);
  assert.match(t, /高于公示费率 1\.78 个百分点/);
  assert.match(t, /矿池数据/); assert.match(t, /孤块率（7 天） 0\.68% · 4 \/ 592 块 链上统计/); assert.match(t, /术语/);
  // Addresses: linked without the sentence's punctuation; nothing to link inside a placeholder.
  assert.match(html, /<a href="https:\/\/pearlhash\.xyz\/api\/stats"/);
  assert.ok(!html.includes('href="https://pearlhash.xyz/api/stats，'));
  const en = render("pearlhash", null, null, "en");
  assert.match(text(en), /PearlHash: How Real Cost Is Calculated/); assert.match(text(en), /Shares not converted to blocks/);
});

test("PROP / PPLNS with effort: fee, orphans and the rest add up to the figure", () => {
  const t = text(render("lucky"));
  assert.match(t, /≈9\.90%/); assert.match(t, /矿池费率 1\.00%/); assert.match(t, /孤块率 0 \/ 234 块 0\.00%/);
  assert.match(t, /其他损耗 8\.90%/); assert.match(t, /合计 ≈9\.90%/);
  const pf = text(render("pearl-fortune", "PPLNS"));
  assert.match(pf, /≈2\.41%/); assert.match(pf, /矿池费率 2\.00%/); assert.match(pf, /1 \/ 343 块/);
});

test("HeroMiners: blocks found against blocks expected, with the 95% range", () => {
  const t = text(render("herominers"));
  assert.match(t, /≈4\.33%/); assert.match(t, /652 块（另有 4 个孤块）/); assert.match(t, /95% 置信区间 −3\.31% ～ 11\.53%/);
  assert.match(t, /出块率（含孤块） 96\.26%（/);
  assert.match(text(render("herominers", null, null, "en")), /95% confidence interval −3\.31% – 11\.53%/);
});

test("PPS: paid out against theory; Peryn leads with founding members, then everyone else's figure", () => {
  const pf = text(render("pearl-fortune", "PPS"));
  assert.match(pf, /实际入账 95\.99 PRL/); assert.match(pf, /理论收益 100 PRL/); assert.match(pf, /样本天数 5/); assert.match(pf, /1 − 95\.99 ÷ 100 = 4\.01%/);
  const founding = text(render("peryn"));
  assert.match(founding, /创始矿工地址/); assert.match(founding, /≈2\.11%/); assert.match(founding, /普通地址 ≈−0\.06%/);
  assert.match(founding, /1 − 97\.89 ÷ 100 = 2\.11%/);
  // No note about VIP bonuses beside either figure (removed 2026-11-10).
  assert.ok(!/VIP/.test(render("peryn")));
  const standard = text(render("peryn", "PPS+", "standard"));
  assert.match(standard, /≈−0\.06%/); assert.ok(!/VIP/.test(render("peryn", "PPS+", "standard")));
  assert.ok(!/实际入账 97\.89/.test(standard)); // the paid-out rows belong to the founding tier's measurement
});

test("no figure: a dash and one plain sentence, and the explanation still there", () => {
  const t = text(render("pearlhash", null, null, "zh-Hans", { ...data, rows: [] }));
  assert.match(t, /— 该结算方式暂无真实费用数据。/);
  assert.match(t, /计算方法/);
  const loading = renderToStaticMarkup(React.createElement(PoolCostDetail, { route: { slug: "pearlhash", scheme: null, tier: null }, data: undefined, lang: "zh-Hans" }));
  assert.match(text(loading), /— 该结算方式暂无/);
});
