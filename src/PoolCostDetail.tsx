import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Lang, Overview, PoolOverview, PoolPayout } from "./types.ts";
import { Icon } from "./Icons.tsx";
import { HelpTip, InfoMark, WarnMark } from "./InfoTip.tsx";
import { costPools, poolCostHref, poolCostSlug, type PoolCostRoute } from "./pool-cost-route.ts";
import { auditTable, costCopy, costSchemes, costStory, type AuditColumn, type CostLanguage, type CostStory } from "./real-cost-content.ts";
import { netPerPH, orphanRate, poolPayouts, realCostParts, realFeeTiers, rollingRealCost, shareYield } from "./pool-comparison.ts";
import { hashrate } from "./format.ts";
import "./pool-cost-detail.css";

type Copy = typeof costCopy.zh;
type Row = { label: ReactNode; value: string; total?: boolean };

/** The payout the page is about: the live row's payout with this scheme (an unnamed one on a single-scheme pool). */
function livePayout(row: PoolOverview | undefined, scheme: string): PoolPayout | null {
  if (!row || row.solo) return null;
  const payouts = poolPayouts(row).filter((p) => !p.solo);
  return payouts.find((p) => p.scheme?.trim().toUpperCase() === scheme) ||
    (payouts.length === 1 && !payouts[0].scheme?.trim() ? payouts[0] : null);
}

export default function PoolCostDetail({ route, data, lang }: { route: PoolCostRoute; data?: Overview; lang: Lang }) {
  const [chosenLanguage, setChosenLanguage] = useState<CostLanguage | null>(null);
  const language = chosenLanguage ?? (lang.startsWith("zh") ? "zh" : "en"), c: Copy = costCopy[language];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const catalog = costPools.find((p) => p.slug === route.slug);
  const row = data?.rows.find((p) => !p.solo && poolCostSlug(p) === route.slug);
  const name = catalog?.name || row?.name || route.slug;
  const schemes = costSchemes(route.slug);
  const scheme = route.scheme && schemes.includes(route.scheme) ? route.scheme : schemes[0] || route.scheme || "";
  const story = costStory(route.slug, scheme, language);
  const tier = route.tier || "standard";
  const payout = livePayout(row, scheme);
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const num = (v: number, digits = 2, min = 0) => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: digits }).format(v);
  const pct = (v: number) => num(v, 2, 2).replace(/^-/, "−") + "%";
  const between = (a: number, b: number) => `${pct(a)}${language === "zh" ? " ～ " : " – "}${pct(b)}`;
  const day = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const title = c.title.replace("{pool}", name);

  useEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [route.slug, route.scheme, route.tier]);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | Pearl Hub`;
    return () => { document.title = previous; };
  }, [title]);

  // Peryn's PPS+ is measured per fee tier; the page shows the chosen one (other addresses' by default).
  const tiered = route.slug === "peryn" && scheme === "PPS+";
  const tiers = tiered && payout ? realFeeTiers(payout) : null;
  const value = tiered ? tiers?.find((x) => x.tier === tier)?.percent ?? null : payout?.realFeePercent ?? null;
  const period = payout?.realFeePeriod;
  const approx = payout?.realFeeEstimated ? "≈" : "";

  // What the figure is made of, by method, from the same live data the table shows.
  const rows: Row[] = [];
  let formula: string | null = null, range: [number, number] | null = null;
  if (payout && value != null && story) {
    const m = row?.realFeeMeasurement;
    if (story.method === "pps" && m && m.scheme === scheme && (!tiers || (m as { tier?: string }).tier === tier) && m.expectedPRL > 0) {
      rows.push({ label: c.credited, value: num(m.netPRL, 2) + " PRL" }, { label: c.theory, value: num(m.expectedPRL, 2) + " PRL" },
        ...(Number.isSafeInteger(m.sampleCount) ? [{ label: c.sampleDays, value: num(m.sampleCount, 0) }] : []),
        { label: c.shortfall, value: pct(value), total: true });
      formula = `1 − ${num(m.netPRL, 2)} ÷ ${num(m.expectedPRL, 2)} = ${pct(value)}`;
    }
    const parts = story.method === "effort" && row ? realCostParts(row, payout) : null;
    if (parts) {
      rows.push({ label: c.fee, value: pct(parts.fee) });
      if (parts.orphans) rows.push({ label: <>{c.orphans}<small>{c.orphanBlocks.replace("{orphans}", num(parts.orphans.orphans, 0)).replace("{blocks}", num(parts.orphans.blocks, 0))}</small></>, value: pct(parts.orphans.percent) });
      rows.push({ label: c.other, value: pct(parts.other) }, { label: c.total, value: "≈" + pct(parts.total), total: true });
    }
    const y = story.method === "display" ? shareYield(payout) : null;
    if (y != null && payout.fee != null) {
      rows.push({ label: c.fee, value: pct(payout.fee) }, { label: c.shareRatio, value: num(y, 4, 4) },
        { label: c.unusedShares, value: pct((1 - y) * 100) }, { label: c.total, value: "≈" + pct(value), total: true });
      formula = `1 − (1 − ${num(payout.fee, 2)}%) × ${num(y, 4, 4)} = ${pct(value)}`;
    }
    const r = story.method === "rolling" ? rollingRealCost(payout) : null;
    if (r) {
      const yieldLabel = r.theoryBasis === "accepted_share_work" ? c.shareRatio : c.foundYield;
      rows.push({ label: c.found, value: r.orphans ? c.foundOrphans.replace("{n}", num(r.blocksSample, 0)).replace("{o}", num(r.orphans, 0)) : c.blocksUnit.replace("{n}", num(r.blocksSample, 0)) },
        { label: c.expected, value: c.blocksUnit.replace("{n}", num(r.work, 1)) },
        { label: yieldLabel, value: language === "zh" ? `${pct(r.foundYield * 100)}（${between(r.foundYield95[0] * 100, r.foundYield95[1] * 100)}）`
          : `${pct(r.foundYield * 100)} (${between(r.foundYield95[0] * 100, r.foundYield95[1] * 100)})` },
        { label: c.fee, value: pct(r.feePercent) },
        { label: c.total, value: "≈" + pct(value), total: true });
      formula = `1 − (1 − ${num(r.feePercent, 2)}%) × ${num(r.blocksSample, 0)} ÷ ${num(r.work, 1)} = ${pct(value)}`;
      range = r.cost95;
    }
  }
  const otherTier = tiers?.find((x) => x.tier !== tier);
  // Against the fee the pool states: how much of the cost the fee alone explains.
  const fee = tiered && tier === "founding"
    ? (payout?.founding?.fee ?? payout?.foundingClosed?.fee ?? payout?.fee)
    : payout?.fee;
  const gap = value != null && fee != null && Number.isFinite(fee) ? Math.round((value - fee) * 100) / 100 : null;
  const feeNote = gap == null ? null : gap === 0 ? c.atFee : (gap > 0 ? c.vsFee : c.belowFee).replace("{gap}", num(Math.abs(gap), 2, 2));
  const updated = data?.ts ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(data.ts * 1000) + " UTC" : null;
  // The pool's live figures, as the overview has them.
  const week = row?.luck?.["7d"], orphan = row ? orphanRate(row) : null, net = payout && row ? netPerPH(payout, row) : null;
  const stats: [string, string, string?][] = row ? [
    [c.scheme, scheme || "—"],
    [c.fee, fee != null && Number.isFinite(fee) ? pct(fee) : "—"],
    [c.poolHashrate, hashrate(row.hashrate ?? undefined, lang)],
    [c.average7d, hashrate(row.averageHashrate7d ?? undefined, lang)],
    [c.blocks24h, row.blocksPerDay != null ? c.blocksUnit.replace("{n}", num(row.blocksPerDay, 0)) : "—"],
    [c.luck7d, week && week.expectedBlocks > 0 ? c.luckValue.replace("{blocks}", num(week.blocks, 0)).replace("{expected}", num(week.expectedBlocks, 1)).replace("{ratio}", pct(week.ratio * 100)) : "—"],
    [c.orphanRate, orphan ? `${pct(orphan.percent)} · ${c.orphanBlocks.replace("{orphans}", num(orphan.orphans, 0)).replace("{blocks}", num(orphan.blocks, 0))}` : "—",
      orphan ? c.orphanSource[orphan.source] : undefined],
    [c.earnings, net != null ? `${num(net, 4)} ${c.perPHDay}` : "—"],
  ] : [];
  // The audit record's periods: dates as the texts write them (10-20 至 11-02 / Oct 20 – Nov 2).
  const audit = auditTable(route.slug, scheme), a = c.audit;
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const date = (iso: string) => language === "zh" ? iso.slice(5) : monthDay.format(new Date(iso + "T00:00:00Z"));
  const span = (from: string, to: string) => `${date(from)}${language === "zh" ? " 至 " : " – "}${date(to)}`;
  const pct1 = (v: number) => num(v, 1, 1).replace(/^-/, "−") + "%";
  const cell = (k: AuditColumn, v: number | [number, number] | undefined) => v == null ? "—"
    : Array.isArray(v) ? k === "orphans" ? `${num(v[0], 0)} / ${num(v[1], 0)}` : `${pct1(v[0])}${language === "zh" ? " ～ " : " – "}${pct1(v[1])}`
    : k === "fee" ? num(v, 2) + "%" : k === "factor" || k === "workRatio" ? num(v, 3, 3) : k === "published" ? "≈" + pct1(v) : num(v, 1);
  const auditView = audit && <div className="cost-audit-scroll" role="region" aria-label={c.checked} tabIndex={0}>
    <table className="cost-audit">
      <thead><tr><th scope="col">{a.period}</th><th scope="col">{a.cost}</th>{audit.columns.map((k) => <th scope="col" key={k}>{a[k]}</th>)}</tr></thead>
      <tbody>{audit.rows.map((r) => <tr key={`${r.from}:${r.to}:${r.total ? 1 : 0}`} className={r.total ? "total" : undefined}>
        <th scope="row">{r.total && <small>{a.total}</small>}{span(r.from, r.to)}</th>
        <td className="cost-audit-cost">{r.cost == null ? "—" : Array.isArray(r.cost) ? between(r.cost[0], r.cost[1]) : pct(r.cost)}
          {r.measured && <small>{span(r.measured[0], r.measured[1])}</small>}</td>
        {audit.columns.map((k) => <td key={k}>{cell(k, r.values[k])}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;

  return <article className="cost-explainer" lang={language === "zh" ? "zh-CN" : "en"}>
    <header className="cost-heading">
      <div>
        <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
        <p>{c.definition}</p>
      </div>
      <div className="cost-language" role="group" aria-label={c.language}>
        <button type="button" aria-pressed={language === "zh"} onClick={() => setChosenLanguage("zh")}>简体中文</button>
        <button type="button" aria-pressed={language === "en"} onClick={() => setChosenLanguage("en")}>English</button>
      </div>
    </header>

    <div className="cost-pool-bar">
      <select aria-label={c.choosePool} value={catalog?.slug || ""} onChange={(e) => { if (e.target.value) location.hash = poolCostHref(e.target.value); }}>
        {!catalog && <option value="">{name}</option>}
        {costPools.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
      </select>
      {schemes.length > 1 && <div className="cost-schemes" role="group" aria-label={c.scheme}>
        {schemes.map((s) => <a key={s} href={poolCostHref(route.slug, s)} aria-current={scheme === s ? "page" : undefined}>{s}</a>)}
      </div>}
      {tiered && <div className="cost-schemes" role="group" aria-label={c.tier}>
        {(["standard", "founding"] as const).map((t) => <a key={t} href={poolCostHref(route.slug, scheme, t)} aria-current={tier === t ? "page" : undefined}>{c[t]}</a>)}
      </div>}
    </div>

    <section className="card cost-result" aria-label={c.realCost}>
      <div className="cost-result-main">
        <span>{c.realCost} · {scheme}{tiered ? ` · ${c[tier]}` : ""}</span>
        {value != null ? (() => {
          const warnText = value < 0 ? c.negativeWarn
            : route.slug === "pearlhash" ? c.closedWarn
            : route.slug === "peryn" ? c.perynWarn
            : route.slug === "f2pool" ? c.f2poolWarn : null;
          return warnText
            ? <div className="cost-result-figure"><strong>{approx}{pct(value)}</strong><HelpTip className="info-tip cost-result-warn" bubbleClassName="pool-cost-tooltip info-tip-bubble" label={c.warnLabel} mark={<WarnMark />}><p className="pool-cost-warn">{warnText}</p></HelpTip></div>
            : <strong>{approx}{pct(value)}</strong>;
        })() : <strong className="cost-result-none">—</strong>}
        {value != null && period ? <small>{c.period} {day.format(period.start * 1000)} – {day.format(period.end * 1000)} (UTC)</small>
          : value == null && <small>{c.noData}</small>}
        {value != null && feeNote && <small>{feeNote}</small>}
        {otherTier && otherTier.percent != null && <small className="cost-result-other">{c[otherTier.tier]} {approx}{pct(otherTier.percent)}</small>}
        {(() => { const df = payout ? rollingRealCost(payout)?.displayFactor : null; return df && <small className="cost-result-other">{c.byDisplayRatio.replace("{factor}", num(df.factor, 4, 4))} ≈{pct(df.percent)}</small>; })()}
      </div>
      {rows.length > 0 && <dl className="cost-result-rows">{rows.map((r, i) => <div key={i} className={r.total ? "total" : undefined}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>}
      {range && <p className="cost-result-range"><span>{c.range}</span><strong>{between(range[0], range[1])}</strong><HelpTip className="info-tip" bubbleClassName="pool-cost-tooltip info-tip-bubble" label={c.range} mark={<InfoMark />}>{c.rangeNote}</HelpTip></p>}
      {story && <p className="cost-result-summary">{story.summary}</p>}
      {updated && <p className="cost-result-updated">{c.updated} {updated}</p>}
    </section>

    {stats.length > 0 && <section className="card cost-section" aria-labelledby="cost-pool-data">
      <h2 id="cost-pool-data">{c.poolData}</h2>
      <dl className="cost-stats">{stats.map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd>{value}{note && <small>{note}</small>}</dd></div>)}</dl>
    </section>}

    {story && <Explainer story={story} c={c} formula={formula} audit={auditView || null} />}
  </article>;
}

function Explainer({ story, c, formula, audit }: { story: CostStory; c: Copy; formula: string | null; audit: ReactNode }) {
  // Addresses in the texts are shown as code, and linked unless they hold a placeholder ("<your address>", 你的地址).
  // Punctuation right after one is the sentence's, not the address's.
  const linked = (text: string) => text.split(/(https:\/\/[^\s，。、；：）)]+)/g).flatMap((part, i) => {
    if (!/^https:\/\//.test(part)) return [part];
    const [, url, tail] = /^(.*?)([.,;:]*)$/.exec(part)!;
    const placeholder = /[<>]|你的地址|区块高度/.test(url);
    return [placeholder ? <code key={i}>{url}</code> : <a key={i} href={url} target="_blank" rel="noopener noreferrer"><code>{url}</code></a>, tail];
  });
  return <div className="cost-sections">
    <section className="card cost-section">
      <h2>{c.how}</h2>
      <ol className="cost-steps">{story.steps.map((s) => <li key={s}>{linked(s)}</li>)}</ol>
      {formula && <pre className="cost-formula"><code>{c.formula}{formula}</code></pre>}
    </section>
    {(audit || story.checked.length > 0) && <section className="card cost-section">
      <h2>{c.checked}</h2>
      {audit}
      {story.checked.length > 0 && <ul className="cost-list">{story.checked.map((s) => <li key={s}>{s}</li>)}</ul>}
    </section>}
    <section className="card cost-section">
      <h2>{c.verify}</h2>
      <ol className="cost-steps">{story.verify.map((s) => <li key={s}>{linked(s)}</li>)}</ol>
    </section>
    {story.unsure.length > 0 && <section className="card cost-section">
      <h2>{c.unsure}</h2>
      <ul className="cost-list">{story.unsure.map((s) => <li key={s}>{s}</li>)}</ul>
    </section>}
    <section className="card cost-section">
      <h2>{c.glossary}</h2>
      <dl className="cost-terms">{c.terms.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
    </section>
    <section className="card cost-section">
      <h2>{c.sources}</h2>
      <ul className="cost-source-list">{story.sources.map(([label, url]) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">
        <span>{label}<small>{new URL(url).host}</small></span><Icon name="external" /></a></li>)}</ul>
    </section>
  </div>;
}
