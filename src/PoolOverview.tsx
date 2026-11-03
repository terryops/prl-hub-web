import { useState, type ReactNode } from "react";
import type { Lang, Overview, PoolOverview as PoolRow, PoolPayout } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { difficulty, hashrate, unitYield, prlNumber } from "./format.ts";
import { bestYield, foundingFee, mergeBonus, minerReport, realCostFewBlocks, realCostParts, realFeePending, REAL_COST_MIN_BLOCKS, realFeeTiers, shareYield, netPerPH, orphanRate, ownApiMissing, payoutCost, percentRange, poolPayouts, poolSparkline, rankedYield, sortPools, relativePoolBlock, weekLuck, type PoolSortKey } from "./pool-comparison.ts";
import { Icon } from "./Icons.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { HelpTip, PoolCostHelp } from "./PoolCostHelp.tsx";
import { InfoMark } from "./InfoTip.tsx";
import { PoolSchemeGuide } from "./PoolSchemeGuide.tsx";
export type Translate = (key: TextKey) => string;
export const numeric = (v: number | null | undefined, digits = 2, lang: Lang = "en") => v != null && Number.isFinite(v) ? v.toLocaleString(lang, { maximumFractionDigits: digits }).replace(/-/g, "−") : "—";
export function NetworkSummary({ data, t, lang, failed }: { data?: Overview; lang: Lang; t: Translate; failed?: boolean }) {
  const n = data?.network;
  return <section className="network-grid" aria-label={t("network")}>{[
    [t("network"), n?.hashrate != null ? hashrate(n.hashrate, lang) : "—"],
    [t("difficulty"), difficulty(n?.difficulty, lang)],
    [t("blockReward"), n?.reward != null ? numeric(n.reward, 4, lang) + " PRL" : "—"],
    [t("unitOutput"), unitYield(n?.prlPerTHDay, lang, t("perDay"))],
  ].map(([label, value]) => <div className="card network-stat" key={label}><small>{label}</small>{!data && !failed ? <Skeleton label={t("loading")} kind="balance" /> : <strong title={label === t("unitOutput") && n?.prlPerTHDay != null ? prlNumber(n.prlPerTHDay * 1000, lang, 8, 8) + ` PRL/PH·${t("perDay")}` : label === t("blockReward") && n?.reward != null ? prlNumber(n.reward, lang, 8, 8) + " PRL" : undefined} className={value === "—" ? "missing-value" : undefined}>{value}</strong>}</div>)}</section>;
}
function PoolSparkline({ row, t }: { row: PoolRow; t: Translate }) {
  const plot = poolSparkline(row.history || []);
  return plot ? <svg className="pool-sparkline" viewBox="0 0 140 42" role="img" aria-label={`${row.name} · ${t("poolHashrate7d")}`}>
    <path className="pool-spark-baseline" d="M2 41H138" />
    <path d={plot.path} />{plot.end && <circle cx={plot.end[0]} cy={plot.end[1]} r="2.5" />}
  </svg> : <span className="pool-chart-missing" aria-label={t("missing")}>—</span>;
}
function PoolShareBackground({ row }: { row: PoolRow }) {
  return <svg className="pool-row-share" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">
    <rect width={Math.max(0, Math.min(1, row.share ?? 0)) * 100} height="1" />
  </svg>;
}
export function PoolComparison({ data, failed, t, lang, onUse, onRetry }: { data?: Overview; failed?: boolean; lang: Lang; t: Translate; onUse: (r: PoolRow) => void; onRetry?: () => void }) {
  const [sort, setSort] = useState<{ key: PoolSortKey; ascending: boolean }>({ key: "hashrate", ascending: false });
  const rows = sortPools(data?.rows || [], sort.key, sort.ascending);
  const best = bestYield(rows);
  const weekly = rows.some((r) => weekLuck(r));
  const columns: { key: PoolSortKey | "trend"; label: TextKey }[] = [
    { key: "name", label: "pool" }, { key: "hashrate", label: "hashrate" }, { key: "trend", label: "poolHashrate7d" },
    { key: "earnings", label: "poolEstYield" }, { key: "blocks", label: data?.source === "miningpoolstats" ? "blocksDay" : "poolBlocks24h" },
    { key: "fee", label: "poolFee" }, { key: "realFee", label: "poolRealCost" }, { key: "orphans", label: "poolOrphanRate" }, { key: "lastBlock", label: "poolLastBlock" },
  ];
  const choose = (key: PoolSortKey) => setSort((old) => ({ key, ascending: old.key === key ? !old.ascending : ["name", "fee", "realFee", "orphans"].includes(key) }));
  const calculate = (r: PoolRow) => <button className="pool-calculate" onClick={() => onUse(r)} aria-label={`${t("useFee")} · ${r.name}`} title={t("useFee")}><Icon name="calculator" /><span>{t("useFee")}</span></button>;
  const name = (r: PoolRow) => <div className="pool-identity">
    <div className="pool-name-line">{r.url?.startsWith("https://") ? <a href={r.url} target="_blank" rel="noreferrer"><span>{r.name}</span><Icon name="external" /></a> : <strong>{r.name}</strong>}
      {ownApiMissing(r, data?.partial) && <HelpTip label={t("poolOwnApiMissing")} className="pool-api-dot" bubbleClassName="pool-cost-tooltip pool-api-tooltip" mark={<span aria-hidden="true" />}>{t("poolOwnApiMissing")}</HelpTip>}{calculate(r)}</div>
    <small>{r.share == null ? "—" : t("poolNetworkShare").replace("%@", numeric(r.share * 100, 1, lang) + "%")}</small>
    {r.solo && <small className="pool-solo">SOLO</small>}
  </div>;
  // F2Pool's NOCK: extra income, so a quiet line under the yield (beside the fee it read as a charge); its
  // terms in a bubble. Not part of the yield figure or Real Cost.
  const bonus = (r: PoolRow, p: PoolPayout) => {
    const b = mergeBonus(p);
    if (!b) return null;
    const range = percentRange(b.min, b.max, lang), template = t("poolMergeBonus").replace("{coin}", b.coin);
    const label = template.replace("{range}", range), [before, after = ""] = template.split("{range}");
    const help = t("poolMergeBonusHelp").replace("{pool}", r.name).replaceAll("{coin}", b.coin).split("{range}");
    // Wraps between words when the cell is narrow (a long language, a small phone, larger text); the range never splits.
    return <HelpTip label={label} className="pool-merge-bonus" mark={<small>{before}<span className="pool-merge-range">{range}</span>{after}</small>}>
      {help.flatMap((part, i) => i ? [<span className="pool-merge-range" key={i}>{range}</span>, part] : [part])}
    </HelpTip>;
  };
  // PearlHash: WildRig shows more hashrate than the pool receives, so against WildRig's own figure the cost is higher.
  // A quiet line under the Real Cost with its sentence in a bubble; the main figure is against the pool's own.
  const minerCost = (r: PoolRow, p: PoolPayout) => {
    const m = minerReport(p);
    if (!m) return null;
    const value = "≈" + numeric(m.realFeePercent, 1, lang) + "%";
    const help = t("poolMinerCostHelp").replaceAll("{pool}", r.name).replaceAll("{app}", m.miner)
      .replace("{gap}", numeric((1 - m.credited) * 100, 0, lang) + "%").replace("{cost}", numeric(m.realFeePercent, 1, lang) + "%")
      .replace("{base}", numeric(p.realFeePercent, 2, lang) + "%");
    return <HelpTip label={`${t("poolRealCost")} ${m.miner} ${value}`} className="pool-miner-cost" mark={<><small>{m.miner} {value}</small><InfoMark /></>}>{help}</HelpTip>;
  };
  // A Real Cost held back while it is checked: the day it comes by in the cell, the reason in a bubble.
  const pending = (r: PoolRow, p: PoolPayout) => {
    const day = realFeePending(p);
    if (!day) return null;
    const date = day.toLocaleDateString(lang, { month: "short", day: "numeric", timeZone: "UTC" });
    const text = t("poolRealCostPending").replace("{date}", date);
    return <HelpTip label={`${t("poolRealCost")}: ${text}`} className="pool-cost-pending" mark={<><strong>{text}</strong><InfoMark /></>}>
      {t("poolRealCostPendingHelp").replaceAll("{pool}", r.name).replace("{date}", date)}
    </HelpTip>;
  };
  // A Real Cost left out because the week is worth too few blocks to take luck out (Jetski): the dash with an ⓘ, why in a bubble.
  const fewBlocks = (r: PoolRow, p: PoolPayout, value: ReactNode) => {
    const blocks = realCostFewBlocks(r, p);
    if (blocks == null) return null;
    return <HelpTip label={`${t("poolRealCost")}: —`} className="pool-cost-note" mark={<>{value}<InfoMark /></>}>
      {t("poolRealCostFewBlocksHelp").replaceAll("{pool}", r.name).replace("{blocks}", numeric(blocks, 0, lang))
        .replace("{min}", numeric(REAL_COST_MIN_BLOCKS, 0, lang))}
    </HelpTip>;
  };
  // A Real Cost that also counts the shares the pool never turns into blocks (PearlHash): the figure as usual with
  // an ⓘ beside it, why in a bubble.
  const yieldText = (r: PoolRow, p: PoolPayout, y: number) =>
    t(r.name === "PearlHash" ? "poolShareYieldHelp" : "poolShareYieldShownHelp").replaceAll("{pool}", r.name).replaceAll("{loss}", numeric((1 - y) * 100, 1, lang) + "%")
      .replace("{fee}", numeric(p.fee ?? 0, 1, lang) + "%").replace("{cost}", numeric(p.realFeePercent ?? 0, 1, lang) + "%");
  const yieldNote = (r: PoolRow, p: PoolPayout, value: ReactNode, text: string) => {
    const y = shareYield(p);
    if (y == null) return null;
    return <HelpTip label={`${t("poolRealCost")} ${text}`} className="pool-cost-note" mark={<>{value}<InfoMark /></>}>
      {yieldText(r, p, y)}
    </HelpTip>;
  };
  // PPLNS / PROP (iOS RealFeeHelpButton): the figure with an ⓘ beside it, the bubble showing what it is made of — the fee,
  // the week's orphans and the rest, adding up to the figure. A pool that turns fewer shares into blocks keeps its sentence on top.
  const costNote = (r: PoolRow, p: PoolPayout, value: ReactNode, text: string) => {
    const parts = realCostParts(r, p);
    if (!parts) return null;
    const y = shareYield(p), period = p.realFeePeriod;
    const percent = (x: number) => x.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/-/g, "−") + "%";
    const part = (label: string, amount: string, detail?: string, total = false) =>
      <div className={`pool-cost-part${total ? " total" : ""}`}><span>{label}{detail && <small>{detail}</small>}</span><span>{amount}</span></div>;
    return <HelpTip label={`${t("poolRealCost")} ${text}`} className="pool-cost-note" mark={<>{value}<InfoMark /></>}>
      {y != null && <p className="pool-cost-lead">{yieldText(r, p, y)}</p>}
      {period && <p className="pool-cost-lead">{t("poolCostLuckOut").replace("{period}", `${dates.format(period.start * 1000)} – ${dates.format(period.end * 1000)}`)}</p>}
      <div className="pool-cost-parts">
        {part(t("poolFee"), percent(parts.fee))}
        {parts.orphans && part(t("poolCostOrphans"), percent(parts.orphans.percent),
          t("poolOrphanBlocks").replace("%@", numeric(parts.orphans.orphans, 0, lang)).replace("%@", numeric(parts.orphans.blocks, 0, lang)))}
        {part(t("poolCostOther"), percent(parts.other))}
        {part(t("poolRealCost"), "≈" + percent(parts.total), undefined, true)}
      </div>
      {parts.orphans && <p>{t("poolCostOrphansHelp")}</p>}
      <p>{t("poolCostOtherHelp")}</p>
    </HelpTip>;
  };
  // Real Cost measured per fee tier (Peryn's PPS+): both tiers in a bubble, the one shown first and bold.
  const tierNote = (p: PoolPayout, value: ReactNode, text: string) => {
    const tiers = realFeeTiers(p);
    if (!tiers) return null;
    return <HelpTip label={`${t("poolRealCost")} ${text}`} className="pool-cost-note" mark={<>{value}<InfoMark /></>}>
      <div className="pool-cost-parts">{tiers.map((x) => <div className={`pool-cost-part${x.shown ? " shown" : ""}`} key={x.tier}>
        <span>{t(x.tier === "founding" ? "poolCostTierFounding" : "poolCostTierStandard")}</span>
        <span>{x.percent == null ? "—" : "≈" + numeric(x.percent, 2, lang) + "%"}</span>
      </div>)}</div>
    </HelpTip>;
  };
  // Founding members' fee (Peryn's Founding Miners) in a bubble beside the fee; the figure stays everyone's fee.
  const foundingNote = (p: PoolPayout, value: ReactNode) => {
    const f = foundingFee(p);
    if (!f) return null;
    const fee = numeric(f.fee, 1, lang) + "%";
    const help = f.afterFP8Months == null ? t("poolFoundingFee").replace("%@", fee)
      : t("poolFoundingFeeFP8").replace("%@", fee).replace("%@", numeric(f.afterFP8Months, 0, lang));
    return <HelpTip label={[t("poolFoundingFeeLabel"), p.scheme].filter(Boolean).join(" · ")} className="pool-cost-note" mark={<>{value}<InfoMark /></>}>{help}</HelpTip>;
  };
  const payouts = (r: PoolRow, kind: "earnings" | "fee" | "realFee") => <div className={`pool-metric pool-${kind}${poolPayouts(r).length > 1 ? " pool-multiple" : ""}`}>
    {poolPayouts(r).map((p, i, all) => {
      // Earnings are what a miner keeps: the gross figure less the pool's cut (see payoutCost).
      const amount = kind === "fee" ? p.fee : kind === "realFee" ? p.realFeePercent : netPerPH(p, r);
      const estimated = kind === "realFee" ? p.realFeeEstimated : p.estimated;
      const prefix = estimated && kind !== "fee" ? /^(PPS|FPPS)/i.test(p.scheme || "") || kind === "realFee" ? "≈" : "~" : "";
      const top = kind === "earnings" && best != null && rankedYield(r, p) === best;
      const formula = kind === "earnings" && amount != null ? `${numeric(p.grossPerPH, 8, lang)} × (1 − ${numeric(payoutCost(p, r), 2, lang)}%) = ` : "";
      const text = amount == null ? "—" : prefix + numeric(amount, kind === "realFee" ? 2 : 1, lang) + (kind === "earnings" ? " PRL" : "%");
      const value = <strong className={`${amount == null ? "missing-value" : ""}${top ? " pool-top-yield" : ""}`} title={amount == null ? undefined : formula + numeric(amount, 8, lang) + (kind === "earnings" ? " PRL/PH·" + t("perDay") : "%")}>
          {text}
        </strong>;
      const held = kind === "realFee" ? pending(r, p) ?? fewBlocks(r, p, value) : null;
      return <div className="pool-payout" key={i}>
        {held ?? (kind === "realFee" ? costNote(r, p, value, text) ?? yieldNote(r, p, value, text) ?? tierNote(p, value, text) : kind === "fee" ? foundingNote(p, value) : null) ?? value}{(all.length > 1 || kind !== "earnings") && <small>{p.scheme || "—"}</small>}
      </div>;
    })}
    {kind === "earnings" && <small>{t(weekLuck(r) ? "poolPerPHDay7d" : "poolPerPHDay")}</small>}
    {kind === "earnings" && !r.solo && poolPayouts(r).map((p) => bonus(r, p)).find(Boolean)}
    {kind === "realFee" && !r.solo && poolPayouts(r).map((p) => minerCost(r, p)).find(Boolean)}
  </div>;
  const hash = (r: PoolRow) => <div className="pool-metric"><strong className={r.hashrate == null ? "missing-value" : undefined}>{hashrate(r.hashrate ?? undefined, lang)}</strong>
    {r.averageHashrate7d != null ? <small>{t("poolAverage7d").replace("%@", hashrate(r.averageHashrate7d, lang))}</small> : r.miners != null && <small>{numeric(r.miners, 0, lang)} {t("participants")}</small>}
  </div>;
  const blocks = (r: PoolRow) => <div className="pool-metric"><strong className={r.blocksPerDay == null ? "missing-value" : undefined}>
    {r.blocksPerDay == null ? "—" : (r.source === "miningpoolstats" ? "≈" : "") + numeric(r.blocksPerDay, r.blocksPerDay === Math.round(r.blocksPerDay) ? 0 : 1, lang)}</strong>
    {r.source === "miningpoolstats" ? <small>{t("blocksDay")}</small> : r.yieldRatio != null && <small>{t("poolExpectedRatio").replace("%@", numeric(r.yieldRatio * 100, 0, lang) + "%")}</small>}
  </div>;
  const dates = new Intl.DateTimeFormat(lang, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const orphans = (r: PoolRow) => {
    const o = orphanRate(r);
    return <div className="pool-metric pool-orphans"><strong className={o ? undefined : "missing-value"}
      title={o ? `${dates.format(o.start * 1000)} – ${dates.format(o.end * 1000)}` : undefined}>{o ? numeric(o.percent, 2, lang) + "%" : "—"}</strong>
      {o && <small>{t("poolOrphanBlocks").replace("%@", numeric(o.orphans, 0, lang)).replace("%@", numeric(o.blocks, 0, lang))}</small>}
      {/* Where the count comes from and, for a window shorter than the week, how many days it covers. */}
      {o && <small>{[o.end - o.start < 6 * 86400 ? t("poolOrphanDays").replace("%@", numeric((o.end - o.start) / 86400, 1, lang)) : null,
        t(o.source === "chain" ? "poolOrphanChain" : "poolOrphanPool")].filter(Boolean).join(" · ")}</small>}
    </div>;
  };
  const lastBlock = (r: PoolRow) => <div className="pool-metric"><strong className={r.lastBlockTime == null ? "missing-value" : undefined} title={r.lastBlockTime ? new Date(r.lastBlockTime * 1000).toLocaleString(lang) : undefined}>
    {r.lastBlockTime == null ? "—" : relativePoolBlock(r.lastBlockTime, lang)}</strong>
    {r.lifetimeBlocks != null && <small>{t("poolLifetimeBlocks").replace("%@", numeric(r.lifetimeBlocks, 0, lang))}</small>}
  </div>;
  return <section className="pool-comparison" aria-label={t("poolComparison")}>
    <div className="pool-comparison-heading"><h2 className="sr-only">{t("poolOverview")}</h2><div className="pool-comparison-controls">
      <span className="pool-updated">{t("updated")} {data ? new Date(data.ts * 1000).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
      <span className="pool-window">{data?.source === "miningpoolstats" ? t("blocksDay") : "24h"}</span>
      <label className="sort-control"><span>{t("sort")}</span><select aria-label={t("sort")} value={sort.key} onChange={(e) => choose(e.target.value as PoolSortKey)}>
        {columns.filter((c) => c.key !== "trend").map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}
      </select></label>
    </div></div>
    {(failed || data?.stale) && <p className="status warn">{t("stale")}</p>}
    {!data && !failed ? <Skeleton label={t("loading")} kind="table" /> : !rows.length ? <div className="empty-comparison"><p>{t(failed ? "poolsUnavailable" : "missing")}</p>{failed && onRetry && <button type="button" onClick={onRetry}><Icon name="refresh" />{t("retry")}</button>}</div> : <>
      <div className="pool-table-scroll" tabIndex={0} role="region" aria-label={t("poolComparison")}>
        <table className="pool-table"><thead><tr>{columns.map((c) => <th key={c.key} scope="col" aria-sort={c.key === "trend" ? undefined : c.key === sort.key ? sort.ascending ? "ascending" : "descending" : "none"}>
          <span className="pool-column-heading">{c.key === "trend" ? t(c.label) : <button className="pool-sort-heading" onClick={() => choose(c.key as PoolSortKey)}><span>{t(c.label)}</span>{sort.key === c.key && <Icon name={sort.ascending ? "up" : "down"} />}</button>}{c.key === "realFee" && <PoolCostHelp rows={rows} lang={lang} t={t} />}</span>
        </th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.id}>
          <td className="pool-cell"><PoolShareBackground row={r} />{name(r)}</td><td>{hash(r)}</td><td className="pool-trend-cell"><PoolSparkline row={r} t={t} /></td>
          <td>{payouts(r, "earnings")}</td><td>{blocks(r)}</td><td>{payouts(r, "fee")}</td><td>{payouts(r, "realFee")}</td><td>{orphans(r)}</td><td>{lastBlock(r)}</td>
        </tr>)}</tbody></table>
      </div>
      <div className="pool-mobile-list">{rows.map((r) => <article className="pool-mobile" key={r.id}>
        <PoolShareBackground row={r} /><div className="pool-mobile-heading">{name(r)}<PoolSparkline row={r} t={t} /></div>
        <div className="pool-mobile-primary"><div><small>{t("hashrate")}</small>{hash(r)}</div><div><small>{t("poolEstYield")}</small>{payouts(r, "earnings")}</div></div>
        <div className="pool-mobile-secondary"><div><small>{t(columns[4].label)}</small>{blocks(r)}</div><div><small>{t("poolFee")}</small>{payouts(r, "fee")}</div><div><small className="pool-column-heading">{t("poolRealCost")}<PoolCostHelp rows={[r]} lang={lang} t={t} /></small>{payouts(r, "realFee")}</div></div>
        {orphanRate(r) && <div className="pool-mobile-last"><small>{t("poolOrphanRate")}</small>{orphans(r)}</div>}
        <div className="pool-mobile-last"><small>{t("poolLastBlock")}</small>{lastBlock(r)}</div>
      </article>)}</div>
    </>}
    <PoolSchemeGuide data={data} lang={lang} t={t} />
    <details className="card pool-data-notes"><summary>{t("comparisonMethod")}</summary>
      {(["poolYieldBasis", ...(weekly ? ["poolWeekLuckExplanation", ...(rows.some((r) => !weekLuck(r) && !r.pps && !r.solo && r.earningsPerPH != null) ? ["poolWeekLuckFallback"] as const : [])] as const : ["comparisonExplanation"] as const),
        "ppsExplanation", "sampleExplanation", "heroExplanation", "mixedSources", "poolContractNotes", "poolMissing"] as const).map((k) => <p key={k}>{t(k)}</p>)}
      <footer className="data-footer"><span>{t("source")} · {data?.source || "—"}</span></footer>
    </details>
  </section>;
}
