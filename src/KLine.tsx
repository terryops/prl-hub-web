import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { Skeleton } from "./Skeleton.tsx";
import { Icon } from "./Icons.tsx";
import { candleScale, intraday, klineURL, parseCandles, priceDigits, shownCount, wheelScale, zoomBounds, zoomed, type Candle, type KlinePeriod } from "./kline.ts";

type Translate = (k: TextKey) => string;
type Series = { candles: Candle[]; ts: number };

/// SafeTrade candles for `period`, read while `enabled` (the K-line view is on screen) and
/// again on each refresh. Periods already read stay on screen while the next read runs.
/// See kline.ts for why the browser asks SafeTrade directly.
export function useKline(period: KlinePeriod, refresh: number, enabled: boolean) {
  const [series, setSeries] = useState<Partial<Record<KlinePeriod, Series>>>({});
  const [failed, setFailed] = useState<Partial<Record<KlinePeriod, boolean>>>({});
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    void fetch(klineURL(period, Date.now() / 1000), { signal: abort.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`SafeTrade k-line: HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const candles = parseCandles(body);
        if (!candles.length) throw new Error("SafeTrade k-line: no candles");
        if (!disposed) { setSeries((s) => ({ ...s, [period]: { candles, ts: Date.now() / 1000 } })); setFailed((f) => ({ ...f, [period]: false })); }
      })
      .catch(() => { if (!disposed) setFailed((f) => ({ ...f, [period]: true })); })
      .finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); abort.abort(); };
  }, [period, refresh, enabled]);
  return { data: series[period], failed: !!failed[period] };
}

/// The native CandleChart's counterpart, inside the PRL Price chart card: SafeTrade PEARL/USDT
/// candles with volume and an OHLC crosshair, then their source.
export type KlineZoom = { zoom: number | null; onZoom: Dispatch<SetStateAction<number | null>> };
export function KLinePanel({ data, failed, t, lang, zoom, onZoom }: { data?: Series; failed: boolean; t: Translate; lang: Lang } & KlineZoom) {
  return <div className="kline-panel">
    {data ? <CandleChart candles={data.candles} lang={lang} t={t} zoom={zoom} onZoom={onZoom} /> : failed ? <p className="chart-empty">{t("klineUnavailable")}</p> : <Skeleton label={t("loading")} kind="chart" />}
    <p className="chart-source">{t("source")} · SafeTrade · PEARL/USDT · {t("updated")} · {data ? new Date(data.ts * 1000).toLocaleString(lang) : "—"}</p>
    {data && failed && <p className="status warn">{t("stale")}</p>}
  </div>;
}

/// `zoom` is the number of candles on screen once zoomed (fractional), null to follow the width;
/// its owner keeps it across periods and views.
export function CandleChart({ candles: loaded, lang, t, zoom, onZoom: setZoom }: { candles: Candle[]; lang: Lang; t: Translate } & KlineZoom) {
  const plot = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 600, height: 280 });
  // The inspected candle by its time, so it stays selected while the chart zooms.
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!plot.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(plot.current); return () => observer.disconnect();
  }, []);
  // Another period (or a refresh) is another series: start again from its latest candle.
  useEffect(() => setActive(null), [loaded]);
  const bounds = zoomBounds(size.width, loaded.length), count = shownCount(zoom, size.width, loaded.length);
  const zoomBy = (scale: number) => setZoom((z) => zoomed(z ?? count, scale, bounds));
  // The wheel and Safari's gesture listeners are attached once; they read the latest render here.
  const live = useRef({ zoomBy, current: () => zoom ?? count, zoomFrom: (from: number, scale: number) => setZoom(zoomed(from, scale, bounds)) });
  live.current = { zoomBy, current: () => zoom ?? count, zoomFrom: (from: number, scale: number) => setZoom(zoomed(from, scale, bounds)) };
  useEffect(() => {
    const el = plot.current; if (!el) return;
    let from = 0, gesturing = false;
    // A mouse wheel, or a trackpad: two-finger scrolls and (as ctrlKey wheels) pinches zoom; a
    // sideways swipe is left to the page. React's own wheel listener is passive, hence this one.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (!gesturing) live.current.zoomBy(wheelScale(e.deltaY, e.deltaMode, e.ctrlKey));
    };
    // Safari reports a trackpad pinch as gesture events with the scale since it began.
    const begin = (e: Event) => { e.preventDefault(); gesturing = true; from = live.current.current(); };
    const change = (e: Event) => { e.preventDefault(); live.current.zoomFrom(from, (e as Event & { scale: number }).scale); };
    const finish = (e: Event) => { e.preventDefault(); gesturing = false; };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", begin); el.addEventListener("gesturechange", change); el.addEventListener("gestureend", finish);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", begin); el.removeEventListener("gesturechange", change); el.removeEventListener("gestureend", finish);
    };
  }, []);
  // Two fingers on a touch screen pinch; one finger inspects, as before.
  const touches = useRef(new Map<number, [number, number]>()), pinch = useRef<{ spread: number; from: number } | null>(null);
  const spread = () => { const [a, b] = [...touches.current.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const candles = loaded.slice(-count), n = candles.length;
  const s = candleScale(candles), digits = priceDigits(s.lo, s.hi), top = 4, bottom = size.height;
  const y = (v: number) => top + (s.top - v) / (s.top - s.floor) * (bottom - top);
  const slot = size.width / n, half = Math.max(.5, slot * .35), x = (i: number) => (i + .5) * slot;
  const price = (v: number) => v.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const volume = (v: number) => v.toLocaleString(lang, { notation: "compact", maximumFractionDigits: 1 });
  const ticks = [s.hi, s.lo + (s.hi - s.lo) * 2 / 3, s.lo + (s.hi - s.lo) / 3, s.lo].filter((v, i, all) => all.findIndex((w) => price(w) === price(v)) === i);
  const daily = n > 1 && candles[1].t - candles[0].t >= 86400;
  const when = (ts: number) => new Date(ts * 1000).toLocaleString(lang, daily ? { year: "numeric", month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const tick = (ts: number) => new Date(ts * 1000).toLocaleString(lang, intraday(candles) ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" });
  const found = active == null ? -1 : candles.findIndex((c) => c.t === active), index = found < 0 ? null : found, current = index == null ? null : candles[index], shown = current || candles[n - 1];
  const dir = (c: Candle) => c.c >= c.o ? "kline-up" : "kline-down";
  const select = (i: number) => setActive(candles[Math.max(0, Math.min(n - 1, i))].t);
  const inspect = (clientX: number) => { const box = plot.current!.getBoundingClientRect(); select(Math.floor((clientX - box.left) / box.width * n)); };
  const step = 1.5;
  return <>
  <div className="kline-zoom">
    <button className="icon-button" aria-label={t("zoomOut")} title={t("zoomOut")} disabled={count >= bounds.max} onClick={() => zoomBy(1 / step)}><Icon name="minus" /></button>
    <button className="icon-button" aria-label={t("zoomIn")} title={t("zoomIn")} disabled={count <= bounds.min} onClick={() => zoomBy(step)}><Icon name="plus" /></button>
  </div>
  <div className="kline-frame">
    <div className="kline-plot" ref={plot} tabIndex={0} role="group" aria-label={t("kline")} aria-description={t("klineHelp")}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") touches.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.current.size === 2) { pinch.current = { spread: spread(), from: zoom ?? count }; setActive(null); return; }
        inspect(e.clientX); e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch.current) { if (touches.current.size === 2 && pinch.current.spread > 0) live.current.zoomFrom(pinch.current.from, spread() / pinch.current.spread); return; }
        inspect(e.clientX);
      }}
      onPointerUp={(e) => { touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null; }}
      onPointerCancel={(e) => { touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null; }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}
      onBlur={() => setActive(null)} onFocus={() => select(n - 1)}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); select(e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (index ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1)); }
        else if (["+", "=", "-", "_"].includes(e.key)) { e.preventDefault(); zoomBy(e.key === "+" || e.key === "=" ? step : 1 / step); }
      }}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label={t("kline")} className="kline-chart">
        {ticks.map((v) => <line key={v} x1="0" x2={size.width} y1={y(v)} y2={y(v)} className="gridline" vectorEffect="non-scaling-stroke" />)}
        {candles.map((c, i) => <rect key={"v" + c.t} className={`kline-volume ${dir(c)}`} x={x(i) - half} width={half * 2} y={y(s.volumeTop(c.v))} height={Math.max(0, y(s.floor) - y(s.volumeTop(c.v)))} />)}
        {candles.map((c, i) => <g key={c.t} className={dir(c)}>
          <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} className="kline-wick" vectorEffect="non-scaling-stroke" />
          <rect x={x(i) - half} width={half * 2} y={y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} className="kline-body" />
        </g>)}
        {current && <><line x1={x(index!)} x2={x(index!)} y1={top} y2={bottom} className="chart-cursor kline-cursor" vectorEffect="non-scaling-stroke" /><line x1="0" x2={size.width} y1={y(current.c)} y2={y(current.c)} className="chart-cursor kline-cursor" vectorEffect="non-scaling-stroke" /></>}
        {/* The band's caption, in the row its bars leave free: the crosshair's candle, else the latest. */}
        <text x="4" y={y(s.ceiling) + 2} className="kline-volume-caption">{t("klineVolume")} {volume(shown.v)} PRL</text>
      </svg>
      {current && <output className={`chart-tooltip kline-tooltip ${index! < n / 2 ? "kline-tooltip-right" : ""}`} aria-live="polite">
        <time>{when(current.t)}</time>
        <dl>
          <dt>{t("klineOpen")}</dt><dd>{price(current.o)}</dd>
          <dt>{t("klineHigh")}</dt><dd className="kline-up">{price(current.h)}</dd>
          <dt>{t("klineLow")}</dt><dd className="kline-down">{price(current.l)}</dd>
          <dt>{t("klineClose")}</dt><dd className={dir(current)}>{price(current.c)}</dd>
          <dt>{t("klineVolume")}</dt><dd>{volume(current.v)} PRL</dd>
        </dl>
      </output>}
    </div>
    {/* Labels are SVG text in pixel units (no viewBox), level with the plot's own y; the hidden
        sizer gives the column its width. The site allows no inline styles. */}
    <div className="kline-axis" aria-hidden="true">
      <span className="kline-axis-sizer">{[price(s.top), volume(s.maxVolume)].reduce((a, b) => b.length > a.length ? b : a)}</span>
      <svg className="kline-axis-labels">
        {ticks.map((v) => <text key={v} x="8" y={y(v)}>{price(v)}</text>)}
        {s.maxVolume > 0 && <text x="8" y={y(s.volumeTop(s.maxVolume))}>{volume(s.maxVolume)}</text>}
      </svg>
    </div>
    <div className="chart-ticks" aria-hidden="true">{(size.width < 250 ? [0, .5, 1] : [0, 1 / 3, 2 / 3, 1]).map((f) => <span key={f}>{tick(candles[Math.round(f * (n - 1))].t)}</span>)}</div>
    <div className="sr-only">{candles.map((c) => <span key={c.t}>{when(c.t)} · {t("klineOpen")} {price(c.o)} · {t("klineHigh")} {price(c.h)} · {t("klineLow")} {price(c.l)} · {t("klineClose")} {price(c.c)}; </span>)}</div>
  </div>
  </>;
}
