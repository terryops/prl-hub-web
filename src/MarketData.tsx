import { useEffect, useRef, useState } from "react";
import type { Lang, Overview, Price } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { Money } from "./Money.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { chartRange, nearestPoint } from "./chart.ts";
import { api } from "./api.ts";
import { change, hashrate, difficulty, unitYield, prlNumber } from "./format.ts";
import { difficultyPoints, diffChange, measuredHashPoints, hashChange, poolShares, type NetworkHistory } from "./market.ts";

export function LineChart({ points, second, label, lang, format = (v) => v.toLocaleString(lang, { maximumFractionDigits: 2 }), secondFormat = format, axisFormat = format, empty, mini = false, loading = false, timeDomain, help, alignAxes = false }: {
  points: number[][]; second?: number[][]; label: string; lang: Lang; format?: (v: number) => string; secondFormat?: (v: number) => string; axisFormat?: (v: number) => string; empty: string; mini?: boolean; loading?: boolean; timeDomain?: [number, number]; help?: string; alignAxes?: boolean;
}) {
  const plot = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 600, height: mini ? 90 : 220 }), [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!plot.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: entry.contentRect.height }));
    observer.observe(plot.current); return () => observer.disconnect();
  }, [loading, points.length < 2, mini]);
  if (loading) return <Skeleton label={empty} kind={mini ? "mini" : "chart"} />;
  if (points.length < 2) return <p className={`chart-empty ${mini ? "chart-mini" : ""}`}>{empty}</p>;
  const [min, max] = chartRange(points), [dmin, dmax] = chartRange(second || []);
  const [start, end] = timeDomain || [points[0][0], points.at(-1)![0]], bottom = size.height - 8, top = 8;
  const x = (t: number) => (t - start) / (end - start || 1) * size.width;
  const y = (v: number) => bottom - (v - min) / (max - min) * (bottom - top);
  const dy = (v: number) => bottom - (v - dmin) / (dmax - dmin) * (bottom - top);
  const line = points.map(([t, v]) => `${x(t)},${y(v)}`).join(" ");
  const current = active == null ? null : points[Math.min(active, points.length - 1)];
  const currentSecond = current && second?.length ? second[nearestPoint(second, current[0])] : null;
  const tick = (t: number) => new Date(t * 1000).toLocaleString(lang, end - start <= 86400 ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" });
  const inspect = (clientX: number) => { const box = plot.current!.getBoundingClientRect(); setActive(nearestPoint(points, start + Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * (end - start))); };
  return <div className={`chart-frame ${second ? "chart-dual" : ""} ${alignAxes ? "chart-aligned" : ""} ${mini ? "chart-mini" : ""}`}>
    <div className="chart-axis chart-axis-left" aria-hidden="true">{[1, .5, 0].map((f) => <span key={f}>{axisFormat(min + f * (max - min))}</span>)}</div>
    <div className="chart-plot" ref={plot} tabIndex={0} role="group" aria-label={label} aria-description={help}
      onPointerDown={(e) => { inspect(e.clientX); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => inspect(e.clientX)} onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}
      onBlur={() => setActive(null)} onFocus={() => setActive(points.length - 1)}
      onKeyDown={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); setActive(e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (active ?? points.length - 1) + (e.key === "ArrowLeft" ? -1 : 1)))); } }}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label={label} className="chart">
        {[0, .5, 1].map((f) => <line key={f} x1="0" x2={size.width} y1={bottom - f * (bottom - top)} y2={bottom - f * (bottom - top)} className="gridline" vectorEffect="non-scaling-stroke" />)}
        <polygon points={`0,${bottom} ${line} ${size.width},${bottom}`} className="chart-fill" />
        <polyline points={line} className="chart-line" vectorEffect="non-scaling-stroke" />
        {second && <polyline points={second.map(([t, v]) => `${x(t)},${dy(v)}`).join(" ")} className="difficulty-line" vectorEffect="non-scaling-stroke" />}
        {current && <><line x1={x(current[0])} x2={x(current[0])} y1={top} y2={bottom} className="chart-cursor" vectorEffect="non-scaling-stroke" /><circle cx={x(current[0])} cy={y(current[1])} r="4" className="chart-dot" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      {current && <output className="chart-tooltip" aria-live="polite"><time>{new Date(current[0] * 1000).toLocaleString(lang)}</time><strong><Money amount={format(current[1])} /></strong>{currentSecond && <span>{secondFormat(currentSecond[1])}</span>}</output>}
    </div>
    {(second || alignAxes) && <div className="chart-axis chart-axis-right" aria-hidden="true">{second && [1, .5, 0].map((f) => <span key={f}>{secondFormat(dmin + f * (dmax - dmin))}</span>)}</div>}
    <div className="chart-ticks" aria-hidden="true">{(size.width < 250 ? [0, .5, 1] : [0, 1 / 3, 2 / 3, 1]).map((f) => <span key={f}>{tick(start + f * (end - start))}</span>)}</div>
    <div className="sr-only">{points.map(([t, v], i) => <span key={i}>{new Date(t * 1000).toLocaleString(lang)} · {format(v)}; </span>)}</div>
  </div>;
}

export function MarketData({ price, overview, history, failed, t, lang, money, refresh }: {
  price?: Price; overview?: Overview; history?: { source: string; points: number[][] }; failed?: boolean; t: (k: TextKey) => string; lang: Lang; money: (v: number) => string; refresh: number;
}) {
  const [metric, setMetric] = useState<"price" | "hash" | "unit" | "diff">("price"), [span, setSpan] = useState("7d"), [priceSpan, setPriceSpan] = useState("24h");
  const [network, setNetwork] = useState<Record<string, { data?: NetworkHistory; failed?: boolean }>>({});
  const [prices, setPrices] = useState<Record<string, { data?: { source: string; quote: string; ts: number; points: number[][]; stale?: boolean }; failed?: boolean }>>({});
  useEffect(() => {
    let disposed = false;
    for (const range of new Set([span, "7d"])) void api<NetworkHistory>(`/v1/network/history?span=${range}`).then((data) => { if (!disposed) setNetwork((s) => ({ ...s, [range]: { data } })); }).catch(() => { if (!disposed) setNetwork((s) => ({ ...s, [range]: { ...s[range], failed: true } })); });
    return () => { disposed = true; };
  }, [span, refresh]);
  useEffect(() => {
    if (priceSpan === "24h") return;
    let disposed = false;
    void api<{ source: string; quote: string; ts: number; points: number[][]; stale?: boolean }>(`/v1/price/history?span=${priceSpan}`).then((data) => { if (!disposed) setPrices((s) => ({ ...s, [priceSpan]: { data } })); }).catch(() => { if (!disposed) setPrices((s) => ({ ...s, [priceSpan]: { ...s[priceSpan], failed: true } })); });
    return () => { disposed = true; };
  }, [priceSpan, refresh]);
  const n = overview?.network, series = network[span], points = series?.data?.points || [];
  const hashPoints = measuredHashPoints(n || undefined, network["7d"]?.data?.points || []);
  const cards = [
    ["price", t("prlPrice"), price ? <Money amount={money(price.usd)} block /> : "—", price?.change24h],
    ["hash", t("network"), n?.hashrate ? hashrate(n.hashrate) : "—", hashChange(hashPoints, 7)],
    ["unit", t("unitDaily"), n?.prlPerTHDay ? unitYield(n.prlPerTHDay, lang, t("perDay")) : "—", diffChange(n?.difficulty, n?.difficulty7d, true)],
    ["diff", t("difficulty"), n?.difficulty ? difficulty(n.difficulty, lang) : "—", diffChange(n?.difficulty, n?.difficulty7d)],
  ] as const;
  const priceData = priceSpan === "24h" ? (history?.source === price?.source ? history?.points || [] : []) : prices[priceSpan]?.data?.points || [];
  const priceUpdated = priceSpan === "24h" ? price?.ts : prices[priceSpan]?.data?.ts;
  const trendPoints = metric === "price" ? priceData : metric === "hash" ? hashPoints : difficultyPoints(n || undefined, metric === "unit");
  const priceLoading = priceSpan === "24h" ? !history && !failed : !prices[priceSpan]?.data && !prices[priceSpan]?.failed;
  const networkLoading = !series?.data && !series?.failed;
  const domain: [number, number] | undefined = points.length ? [points[0].ts, points.at(-1)!.ts] : undefined;
  const ranges = metric === "price" ? ["24h", "7d", "30d", "90d"] : [];
  return <>
    <section className="network-grid market-metrics">{cards.map(([id, title, value, delta]) => <button key={id} className={`card network-stat ${metric === id ? "metric-selected" : ""}`} aria-expanded={metric === id} onClick={() => setMetric(id)}>
      <small>{title}</small>{(id === "price" ? !price : !overview) && !failed ? <Skeleton label={t("loading")} kind="balance" /> : <strong title={id === "unit" && n?.prlPerTHDay != null ? prlNumber(n.prlPerTHDay * 1000, lang, 8, 8) + ` PRL/PH·${t("perDay")}` : undefined}>{value}</strong>}
      <small className={delta == null ? "" : delta >= 0 ? "positive" : "negative"}>{id === "price" ? "24h" : "7d"} · {change(delta)}</small>
      <div className="metric-secondary">{id !== "price" ? <><small>24h {change(id === "hash" ? hashChange(hashPoints, 1) : diffChange(n?.difficulty, n?.difficulty24h, id === "unit"))}</small><small>3d {change(id === "hash" ? hashChange(hashPoints, 3) : diffChange(n?.difficulty, n?.difficulty3d, id === "unit"))}</small></> : <><small>5m {change(price?.change5m)}</small><small>1h {change(price?.change1h)}</small></>}</div>
    </button>)}</section>
    {(failed || price?.stale || overview?.stale) && <p className="status warn">{t("stale")}</p>}
    <section className="card market-chart"><div className="card-heading"><h2>{cards.find((c) => c[0] === metric)![1]}</h2>{ranges.length > 0 && <div className="segments">{ranges.map((s) => <button key={s} className={priceSpan === s ? "selected" : ""} onClick={() => setPriceSpan(s)}>{s}</button>)}</div>}</div>
      <LineChart lang={lang} points={trendPoints} label={cards.find((c) => c[0] === metric)![1]} help={t("chartHelp")} loading={metric === "price" ? priceLoading : metric === "hash" ? !network["7d"]?.data && !network["7d"]?.failed : !overview && !failed} empty={t(metric === "price" ? "emptyChart" : "samplingHistory")} axisFormat={metric === "price" ? (v) => money(v).split(" · ")[0] : undefined} format={metric === "hash" ? hashrate : metric === "price" ? money : metric === "diff" ? (v) => difficulty(v, lang) : (v) => v.toLocaleString(lang, { maximumFractionDigits: 2 })} />
      {metric === "price" && <><p className="chart-source">{t("source")} · {priceSpan === "24h" ? price?.source || "—" : "BigONE · PRL/USDT · " + t("dailyClose")} · {t("updated")} · {priceUpdated ? new Date(priceUpdated * 1000).toLocaleString(lang) : "—"}</p>{priceSpan !== "24h" && <p className="help">{t("dailyQuote")}</p>}{(prices[priceSpan]?.failed || prices[priceSpan]?.data?.stale) && <p className="status warn">{t("stale")}</p>}<div className="changes">{[["5m", price?.change5m], ["1h", price?.change1h], ["24h", price?.change24h]].map(([label, v]) => <div key={label}><small>{label}</small><strong className={v == null ? "" : Number(v) >= 0 ? "positive" : "negative"}>{change(v as number | null)}</strong></div>)}</div></>}
    </section>
    <section className="card network-history"><div className="card-heading"><h2>{t("networkTrend")}</h2><span className="badge">Blockbook</span></div>
      <div className="chart-legend"><span><i className="legend-hash" />{t("network")}</span><span><i className="legend-difficulty" />{t("difficulty")}</span></div><div className="segments">{["24h", "7d", "30d", "all"].map((s) => <button key={s} className={span === s ? "selected" : ""} onClick={() => setSpan(s)}>{s === "all" ? t("all") : s}</button>)}</div>
      <div className="network-chart-stack"><LineChart lang={lang} loading={networkLoading} timeDomain={domain} points={points.filter((p) => p.hashrate != null).map((p) => [p.ts, p.hashrate!])} second={points.map((p) => [p.ts, p.difficulty])} label={t("network") + " / " + t("difficulty")} help={t("chartHelp")} format={hashrate} secondFormat={(v) => difficulty(v, lang)} empty={t("samplingHistory")} />
      <h3 className="block-chart-title">{t("blockTime")} · {series?.data?.avgBlockTime ? Math.floor(series.data.avgBlockTime / 60) + "m " + Math.floor(series.data.avgBlockTime % 60) + "s" : "—"}</h3>
      <LineChart lang={lang} loading={networkLoading} timeDomain={domain} points={points.filter((p) => p.blockTime != null).map((p) => [p.ts, p.blockTime!])} label={t("blockTime")} help={t("chartHelp")} format={(v) => v.toFixed(0) + "s"} empty={t("samplingHistory")} mini alignAxes /></div>
      {series?.failed && <p className="status warn">{t("stale")}</p>}<footer className="data-footer"><span>Block {series?.data?.firstHeight?.toLocaleString(lang) || "—"}</span><span>Block {series?.data?.lastHeight?.toLocaleString(lang) || "—"}</span></footer>
    </section>
  </>;
}

export function PoolDonut({ data, lang, t }: { data?: Overview; lang: Lang; t: (k: TextKey) => string }) {
  const { total, slices } = poolShares(data?.rows || [], data?.network?.hashrate);
  if (!slices.length) return null;
  const colors = Array.from({ length: 9 }, (_, i) => `var(--slice-${i})`);
  let offset = 0;
  return <section className="card pool-shares"><h2>{t("share")}</h2><div className="donut-layout"><svg viewBox="0 0 240 240" role="img" aria-label={t("share")}>
    {slices.map((s, i) => { const start = offset; offset += s.share; return <circle key={s.id} cx="120" cy="120" r="88" fill="none" stroke={colors[i % colors.length]} strokeWidth="38" pathLength="1" strokeDasharray={`${Math.max(0, s.share - .003)} ${1 - Math.max(0, s.share - .003)}`} strokeDashoffset={-start} transform="rotate(-90 120 120)"><title>{`${s.id === "_tail" ? t("smallPools") : s.id === "_other" ? t("unknownPool") : s.name} · ${(s.share * 100).toFixed(1)}%`}</title></circle>; })}
    <text x="120" y="113" textAnchor="middle">{t("network")}</text><text x="120" y="135" textAnchor="middle">{hashrate(total)}</text>
  </svg><div className="donut-legend">{slices.map((s, i) => <div key={s.id}><span className={`slice-dot slice-${i % colors.length}`} /> <span title={s.id === "_tail" ? t("smallPools") : s.id === "_other" ? t("unknownPool") : s.name}>{s.id === "_tail" ? t("smallPools") : s.id === "_other" ? t("unknownPool") : s.name}</span><strong>{(s.share * 100).toFixed(1)}%</strong><small>{hashrate(s.hps)}</small></div>)}</div></div></section>;
}
