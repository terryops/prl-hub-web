import { useState } from "react";
import type { Lang, Overview, PoolOverview as PoolRow } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { difficulty, hashrate, unitYield, prlNumber } from "./format.ts";
import { poolPayouts, poolSparkline, sortPools, relativePoolBlock, type PoolSortKey } from "./pool-comparison.ts";
import { Icon } from "./Icons.tsx";
import { Skeleton } from "./Skeleton.tsx";
export type Translate = (key: TextKey) => string;
export const numeric = (v: number | null | undefined, digits = 2, lang: Lang = "en") => v != null && Number.isFinite(v) ? v.toLocaleString(lang, { maximumFractionDigits: digits }).replace(/-/g, "−") : "—";
export function NetworkSummary({ data, t, lang, failed }: { data?: Overview; lang: Lang; t: Translate; failed?: boolean }) {
  const n = data?.network;
  return <section className="network-grid" aria-label={t("network")}>{[
    [t("network"), n?.hashrate != null ? hashrate(n.hashrate) : "—"],
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
export function PoolComparison({ data, failed, t, lang, onUse }: { data?: Overview; failed?: boolean; lang: Lang; t: Translate; onUse: (r: PoolRow) => void }) {
  const [sort, setSort] = useState<{ key: PoolSortKey; ascending: boolean }>({ key: "hashrate", ascending: false });
  const rows = sortPools(data?.rows || [], sort.key, sort.ascending);
  const best = Math.max(-1, ...rows.filter((r) => r.trustworthy && !r.pps && !r.solo).map((r) => r.earningsPerPH ?? -1));
  const columns: { key: PoolSortKey | "trend"; label: TextKey }[] = [
    { key: "name", label: "pool" }, { key: "hashrate", label: "hashrate" }, { key: "trend", label: "poolHashrate7d" },
    { key: "earnings", label: "poolEstYield" }, { key: "blocks", label: data?.source === "miningpoolstats" ? "blocksDay" : "poolBlocks24h" },
    { key: "fee", label: "poolFee" }, { key: "realFee", label: "poolRealCost" }, { key: "lastBlock", label: "poolLastBlock" },
  ];
  const choose = (key: PoolSortKey) => setSort((old) => ({ key, ascending: old.key === key ? !old.ascending : ["name", "fee", "realFee"].includes(key) }));
  const calculate = (r: PoolRow) => <button className="pool-calculate" onClick={() => onUse(r)} aria-label={`${t("useFee")} · ${r.name}`} title={t("useFee")}><Icon name="calculator" /><span>{t("useFee")}</span></button>;
  const name = (r: PoolRow) => <div className="pool-identity">
    <div className="pool-name-line">{r.url?.startsWith("https://") ? <a href={r.url} target="_blank" rel="noreferrer"><span>{r.name}</span><Icon name="external" /></a> : <strong>{r.name}</strong>}{calculate(r)}</div>
    <small>{r.share == null ? "—" : t("poolNetworkShare").replace("%@", numeric(r.share * 100, 1, lang) + "%")}</small>
    {r.solo && <small className="pool-solo">SOLO</small>}
  </div>;
  const payouts = (r: PoolRow, kind: "earnings" | "fee" | "realFee") => <div className={`pool-metric pool-${kind}${poolPayouts(r).length > 1 ? " pool-multiple" : ""}`}>
    {poolPayouts(r).map((p, i, all) => {
      const amount = kind === "fee" ? p.fee : kind === "realFee" ? p.realFeePercent : p.solo ? null : p.grossPerPH;
      const estimated = kind === "realFee" ? p.realFeeEstimated : p.estimated;
      const prefix = estimated && kind !== "fee" ? /^(PPS|FPPS)/i.test(p.scheme || "") || kind === "realFee" ? "≈" : "~" : "";
      const top = kind === "earnings" && r.trustworthy && !/^(PPS|FPPS)/i.test(p.scheme || "") && r.earningsPerPH === best;
      return <div className="pool-payout" key={i}>
        <strong className={`${amount == null ? "missing-value" : ""}${top ? " pool-top-yield" : ""}`} title={amount == null ? undefined : numeric(amount, 8, lang) + (kind === "earnings" ? " PRL/PH·" + t("perDay") : "%")}>
          {amount == null ? "—" : prefix + numeric(amount, kind === "realFee" ? 2 : 1, lang) + (kind === "earnings" ? " PRL" : "%")}
        </strong>{(all.length > 1 || kind !== "earnings") && <small>{p.scheme || "—"}</small>}
      </div>;
    })}
    {kind === "earnings" && <small>{t("poolPerPHDay")}</small>}
    {kind === "realFee" && r.realFeeMeasurement && <small>{new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).formatRange(new Date(r.realFeeMeasurement.start * 1000), new Date(r.realFeeMeasurement.end * 1000))}</small>}
  </div>;
  const hash = (r: PoolRow) => <div className="pool-metric"><strong className={r.hashrate == null ? "missing-value" : undefined}>{hashrate(r.hashrate ?? undefined)}</strong>
    {r.averageHashrate7d != null ? <small>{t("poolAverage7d").replace("%@", hashrate(r.averageHashrate7d))}</small> : r.miners != null && <small>{numeric(r.miners, 0, lang)} {t("participants")}</small>}
  </div>;
  const blocks = (r: PoolRow) => <div className="pool-metric"><strong className={r.blocksPerDay == null ? "missing-value" : undefined}>
    {r.blocksPerDay == null ? "—" : (r.source === "miningpoolstats" ? "≈" : "") + numeric(r.blocksPerDay, r.blocksPerDay === Math.round(r.blocksPerDay) ? 0 : 1, lang)}</strong>
    {r.source === "miningpoolstats" ? <small>{t("blocksDay")}</small> : r.yieldRatio != null && <small>{t("poolExpectedRatio").replace("%@", numeric(r.yieldRatio * 100, 0, lang) + "%")}</small>}
  </div>;
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
    {(failed || data?.stale) && <p className="status warn">{t("stale")}</p>}{data?.partial && <p className="comparison-notice">{t("poolDataNotice")}</p>}
    {!data && !failed ? <Skeleton label={t("loading")} kind="table" /> : !rows.length ? <p className="empty-comparison">{t(failed ? "error" : "missing")}</p> : <>
      <div className="pool-table-scroll" tabIndex={0} role="region" aria-label={t("poolComparison")}>
        <table className="pool-table"><thead><tr>{columns.map((c) => <th key={c.key} scope="col" aria-sort={c.key === "trend" ? undefined : c.key === sort.key ? sort.ascending ? "ascending" : "descending" : "none"}>
          {c.key === "trend" ? t(c.label) : <button className="pool-sort-heading" onClick={() => choose(c.key as PoolSortKey)}><span>{t(c.label)}</span>{sort.key === c.key && <Icon name={sort.ascending ? "up" : "down"} />}</button>}
        </th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.id}>
          <td className="pool-cell"><PoolShareBackground row={r} />{name(r)}</td><td>{hash(r)}</td><td className="pool-trend-cell"><PoolSparkline row={r} t={t} /></td>
          <td>{payouts(r, "earnings")}</td><td>{blocks(r)}</td><td>{payouts(r, "fee")}</td><td>{payouts(r, "realFee")}</td><td>{lastBlock(r)}</td>
        </tr>)}</tbody></table>
      </div>
      <div className="pool-mobile-list">{rows.map((r) => <article className="pool-mobile" key={r.id}>
        <PoolShareBackground row={r} /><div className="pool-mobile-heading">{name(r)}<PoolSparkline row={r} t={t} /></div>
        <div className="pool-mobile-primary"><div><small>{t("hashrate")}</small>{hash(r)}</div><div><small>{t("poolEstYield")}</small>{payouts(r, "earnings")}</div></div>
        <div className="pool-mobile-secondary"><div><small>{t(columns[4].label)}</small>{blocks(r)}</div><div><small>{t("poolFee")}</small>{payouts(r, "fee")}</div><div><small>{t("poolRealCost")}</small>{payouts(r, "realFee")}</div></div>
        <div className="pool-mobile-last"><small>{t("poolLastBlock")}</small>{lastBlock(r)}</div>
      </article>)}</div>
    </>}
    <details className="card pool-data-notes"><summary>{t("comparisonMethod")}</summary>
      {(["poolYieldBasis", "comparisonExplanation", "ppsExplanation", "sampleExplanation", "heroExplanation", "mixedSources", "poolContractNotes", "poolHistoryNotes", "poolMissing"] as const).map((k) => <p key={k}>{t(k)}</p>)}
      <footer className="data-footer"><span>{t("source")} · {data?.source || "—"}</span></footer>
    </details>
    <details className="card pool-network-reference"><summary>{t("poolNetworkReference")}</summary><NetworkSummary data={data} t={t} lang={lang} failed={failed} /></details>
  </section>;
}
