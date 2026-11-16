// 买卖深度图 (Pro), the iOS TradeDepthChart.swift: cumulative bids piling up leftwards from the best bid,
// asks rightwards from the best ask, in the K-line's green / red, with a press-to-read level. Everyone
// else sees a blurred illustrative book and the unlock button. SVG only: the app allows no inline styles.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./trade-icons.tsx";
import { askTotal, bidShare, bidTotal, depthCurve, levelNear, BASE_TICKER, type Depth, type DepthCurve, type DepthPoint, type Tr } from "./safetrade.ts";
import type { Lang } from "./types.ts";

const HEIGHT = 220, AXIS = 22, RIGHT = 44;

/** An illustrative book, NOT market data, for the locked card. */
const SAMPLE = (() => {
  const side = (start: number, step: number, amounts: number[]) => amounts.map((amount, i) => ({ price: start + i * step, amount }));
  return depthCurve({
    asks: side(1.01, 0.01, [9, 14, 6, 22, 11, 30, 8, 16, 41, 12, 19, 26, 9, 34, 15]),
    bids: side(0.99, -0.01, [12, 8, 25, 17, 33, 10, 21, 44, 14, 28, 9, 37, 18, 23, 30]),
  })!;
})();

export function DepthSection({ depth, stale, pro, tr, lang, onVisible, onUnlock }: {
  depth: Depth | null; stale: boolean; pro: boolean; tr: Tr; lang: Lang; onVisible: (visible: boolean) => void; onUnlock: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  // Polls only while the card is actually scrolled into view (iOS onScrollVisibilityChange).
  useEffect(() => {
    const el = card.current;
    if (!el || typeof IntersectionObserver === "undefined") { onVisible(true); return () => onVisible(false); }
    const observer = new IntersectionObserver(([e]) => onVisible(e.isIntersecting), { threshold: 0.1 });
    observer.observe(el);
    return () => { observer.disconnect(); onVisible(false); };
  }, [onVisible]);
  // The store keeps the same book object while it's unchanged, so the curve (and a pressed level) stays too.
  const curve = useMemo(() => depth ? depthCurve(depth) : null, [depth]);
  return <section className="card trade-card" ref={card}>
    <div className="trade-title-row">
      <strong>{tr("买卖深度")}</strong>
      {!pro && <span className="badge trade-pro-badge"><Icon name="sparkles" />{tr("高级版")}</span>}
      <span className="trade-spacer" />
      {pro && stale && <small className="trade-warn-text">{tr("未能更新")}</small>}
    </div>
    {pro
      ? curve ? <><DepthSummary curve={curve} tr={tr} lang={lang} /><DepthChart curve={curve} tr={tr} lang={lang} /></>
        : <p className="chart-empty trade-depth-empty">{depth ? tr("暂无挂单") : tr("加载深度…")}</p>
      : <div className="trade-depth-locked">
        <div className="trade-depth-sample" aria-hidden="true"><DepthChart curve={SAMPLE} tr={tr} lang={lang} interactive={false} /></div>
        <div className="trade-depth-unlock">
          <Icon name="lock" />
          <strong>{tr("看清各价位的挂单量，以及买盘和卖盘谁更强")}</strong>
          <button type="button" className="primary" onClick={onUnlock}>{tr("解锁高级版")}</button>
        </div>
      </div>}
  </section>;
}

const priceText = (v: number, lang: Lang) => v.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const compact = (v: number, lang: Lang) => v.toLocaleString(lang, { notation: "compact", maximumSignificantDigits: 3 });

/** 买一 / 卖一 / 价差, and a bar weighing the drawn bids against the asks. */
function DepthSummary({ curve, tr, lang }: { curve: DepthCurve; tr: Tr; lang: Lang }) {
  const share = bidShare(curve), spread = curve.bestBid != null && curve.bestAsk != null ? curve.bestAsk - curve.bestBid : null;
  return <div className="trade-depth-summary">
    <div className="trade-depth-cells">
      <span><small>{tr("买一")}</small><b className="trade-up">{curve.bestBid != null ? priceText(curve.bestBid, lang) : "—"}</b></span>
      <span><small>{tr("卖一")}</small><b className="trade-down">{curve.bestAsk != null ? priceText(curve.bestAsk, lang) : "—"}</b></span>
      <span className="trade-spacer" />
      {spread != null && <span><small>{tr("价差")}</small><b>{priceText(spread, lang)} ({(spread / curve.mid * 100).toFixed(2)}%)</b></span>}
    </div>
    {share != null && <>
      <svg className="trade-share" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true">
        <rect className="trade-share-bid" x="0" y="0" height="5" width={Math.max(1, share * 100 - 0.5)} rx="2.5" />
        <rect className="trade-share-ask" x={Math.max(1, share * 100 - 0.5) + 1} y="0" height="5" width={Math.max(0, 100 - Math.max(1, share * 100 - 0.5) - 1)} rx="2.5" />
      </svg>
      <div className="trade-share-labels">
        <span className="trade-up">{tr("买盘 {0}", `${compact(bidTotal(curve), lang)} ${BASE_TICKER}`)}</span>
        <span className="muted">{tr("中间价 ±{0} 以内", `${Math.round((curve.hi / curve.mid - 1) * 100)}%`)}</span>
        <span className="trade-down">{tr("卖盘 {0}", `${compact(askTotal(curve), lang)} ${BASE_TICKER}`)}</span>
      </div>
    </>}
  </div>;
}

export function DepthChart({ curve, tr, lang, interactive = true }: { curve: DepthCurve; tr: Tr; lang: Lang; interactive?: boolean }) {
  const box = useRef<HTMLDivElement>(null), [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<{ side: "bid" | "ask"; point: DepthPoint } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(([e]) => setWidth(Math.max(120, e.contentRect.width)));
    o.observe(el);
    return () => o.disconnect();
  }, []);
  useEffect(() => setSelected(null), [curve]);
  const plotW = width - RIGHT, plotH = HEIGHT - AXIS;
  const maxY = Math.max(Math.max(bidTotal(curve), askTotal(curve)) * 1.1, 1);
  const x = (p: number) => (p - curve.lo) / (curve.hi - curve.lo) * plotW;
  const y = (v: number) => plotH - v / maxY * (plotH - 6);
  // Bids: from the window's left edge holding the in-window total, stepping down at each level's price.
  const bidLine = (() => {
    const pts = [...curve.bids].reverse();
    if (!pts.length) return null;
    const out: [number, number][] = [[0, y(pts[0].cumulative)]];
    pts.forEach((p, i) => { out.push([x(p.price), y(p.cumulative)]); const next = pts[i + 1]; if (next) out.push([x(p.price), y(next.cumulative)]); });
    return out;
  })();
  // Asks: from the best ask, each level's total held until the next level's price, out to the right edge.
  const askLine = (() => {
    const pts = curve.asks;
    if (!pts.length) return null;
    const out: [number, number][] = [];
    pts.forEach((p, i) => { out.push([x(p.price), y(p.cumulative)]); const next = pts[i + 1]; out.push([next ? x(next.price) : plotW, y(p.cumulative)]); });
    return out;
  })();
  const path = (pts: [number, number][] | null) => pts ? pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ") : "";
  const area = (pts: [number, number][] | null) => pts ? `M${pts[0][0].toFixed(1)} ${plotH} ${path(pts).replace(/^M/, "L")} L${pts.at(-1)![0].toFixed(1)} ${plotH} Z` : "";
  const digits = Math.min(6, Math.max(2, Math.ceil(-Math.log10(Math.max(curve.hi - curve.lo, 1e-4) / 4))));
  const xTicks = [0.125, 0.375, 0.625, 0.875].map((f) => curve.lo + (curve.hi - curve.lo) * f);
  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => maxY / 1.1 * f);
  const pick = (clientX: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect(), px = clientX - r.left;
    if (px < 0 || px > plotW) { setSelected(null); return; }
    const hit = levelNear(curve, curve.lo + px / plotW * (curve.hi - curve.lo));
    setSelected((s) => s && hit && s.side === hit.side && s.point.price === hit.point.price ? s : hit);
  };
  const tip = selected && (() => {
    const lines = [selected.side === "bid" ? tr("买盘") : tr("卖盘"),
      `${tr("价格")} ${selected.point.price.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT`,
      `${tr("累计数量")} ${selected.point.cumulative.toLocaleString(lang, { maximumFractionDigits: 2 })} ${BASE_TICKER}`,
      `${tr("累计金额")} ${selected.point.cumulativeValue.toLocaleString(lang, { maximumFractionDigits: 2 })} USDT`];
    const w = Math.min(plotW, Math.max(...lines.map((l) => l.length)) * 6.6 + 20), h = 70;
    const tx = Math.min(Math.max(x(selected.point.price) - w / 2, 0), plotW - w);
    return { lines, w, h, tx };
  })();
  return <div className="trade-depth-chart" ref={box}
    onPointerDown={interactive ? (e) => { pick(e.clientX); e.currentTarget.setPointerCapture(e.pointerId); } : undefined}
    onPointerMove={interactive ? (e) => { if (e.buttons || e.pointerType !== "mouse") pick(e.clientX); } : undefined}
    onPointerUp={interactive ? () => setSelected(null) : undefined}
    onPointerCancel={interactive ? () => setSelected(null) : undefined}
    role="img" aria-label={`${tr("买卖深度")}: ${tr("买盘 {0}", `${Math.round(bidTotal(curve))} ${BASE_TICKER}`)}, ${tr("卖盘 {0}", `${Math.round(askTotal(curve))} ${BASE_TICKER}`)}`}>
    <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
      <defs>
        <linearGradient id="trade-bid-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="trade-fill-up-top" /><stop offset="1" className="trade-fill-up-bottom" /></linearGradient>
        <linearGradient id="trade-ask-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="trade-fill-down-top" /><stop offset="1" className="trade-fill-down-bottom" /></linearGradient>
      </defs>
      {yTicks.map((v) => <line key={v} x1="0" x2={plotW} y1={y(v)} y2={y(v)} className="gridline" />)}
      <path d={area(bidLine)} fill="url(#trade-bid-fill)" />
      <path d={area(askLine)} fill="url(#trade-ask-fill)" />
      <path d={path(bidLine)} className="trade-depth-line trade-up" fill="none" />
      <path d={path(askLine)} className="trade-depth-line trade-down" fill="none" />
      <line x1={x(curve.mid)} x2={x(curve.mid)} y1="0" y2={plotH} className="trade-depth-mid" />
      {xTicks.map((p) => <g key={p}><line x1={x(p)} x2={x(p)} y1={plotH} y2={plotH + 3} className="trade-depth-tick" /><text x={x(p)} y={HEIGHT - 6} textAnchor="middle" className="trade-axis-text">{p.toFixed(digits)}</text></g>)}
      {yTicks.map((v) => <text key={v} x={plotW + 4} y={y(v) + 4} className="trade-axis-text">{compact(v, lang)}</text>)}
      {selected && tip && <g>
        <line x1={x(selected.point.price)} x2={x(selected.point.price)} y1="0" y2={plotH} className="trade-depth-cursor" />
        <circle cx={x(selected.point.price)} cy={y(selected.point.cumulative)} r="4" className={selected.side === "bid" ? "trade-up" : "trade-down"} />
        <rect x={tip.tx} y="2" width={tip.w} height={tip.h} rx="8" className="trade-tooltip-box" />
        {tip.lines.map((l, i) => <text key={i} x={tip.tx + 10} y={18 + i * 15} className={i === 0 ? `trade-tooltip-title ${selected.side === "bid" ? "trade-up" : "trade-down"}` : "trade-tooltip-text"}>{l}</text>)}
      </g>}
    </svg>
  </div>;
}
