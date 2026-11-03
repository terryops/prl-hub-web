import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { Skeleton } from "./Skeleton.tsx";
import { Icon } from "./Icons.tsx";
import { candleScale, candleSpacing, dragIntent, intraday, klineURL, panned, parseCandles, priceDigits, revealing, shownCount, visibleRange, wheelScale, zoomBounds, zoomed, type Candle, type KlinePeriod } from "./kline.ts";

type Translate = (k: TextKey) => string;
type Series = { candles: Candle[]; ts: number };
/// One finger (or the mouse button) on the plot: still deciding, panning, inspecting (a touch held
/// still for HOLD_MS, as on native), or left to the page (a touch that set off up or down).
type Drag = { id: number; mouse: boolean; x: number; y: number; lastX: number; from: number; width: number; mode: "wait" | "pan" | "inspect" | "off"; timer?: ReturnType<typeof setTimeout> };
/// Native HoldToScrub's long press; Android's touch slop (8 dp); DragGesture(minimumDistance: 4) on the Mac.
const HOLD_MS = 200, TOUCH_SLOP = 8, MOUSE_SLOP = 4;

/// SafeTrade candles for `period`, read while `enabled` (the K-line view is on screen) and
/// again on each refresh. Periods already read stay on screen while the next read runs.
/// See kline.ts for why the browser asks SafeTrade directly.
/// A read still under way is left to finish (or time out) rather than restarted: the page
/// refreshes every 5 s, and cancelling on each tick meant a SafeTrade slower than that never
/// drew a chart, and one that stopped answering showed the loading state for good.
export const KLINE_TIMEOUT_MS = 15000;
export function useKline(period: KlinePeriod, refresh: number, enabled: boolean) {
  const [series, setSeries] = useState<Partial<Record<KlinePeriod, Series>>>({});
  const [failed, setFailed] = useState<Partial<Record<KlinePeriod, boolean>>>({});
  const reading = useRef<Partial<Record<KlinePeriod, AbortController>>>({});
  useEffect(() => () => { for (const abort of Object.values(reading.current)) abort?.abort(); reading.current = {}; }, []);
  useEffect(() => {
    if (!enabled || reading.current[period]) return;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), KLINE_TIMEOUT_MS);
    reading.current[period] = abort;
    void fetch(klineURL(period, Date.now() / 1000), { signal: abort.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`SafeTrade k-line: HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const candles = parseCandles(body);
        if (!candles.length) throw new Error("SafeTrade k-line: no candles");
        if (reading.current[period] === abort) { setSeries((s) => ({ ...s, [period]: { candles, ts: Date.now() / 1000 } })); setFailed((f) => ({ ...f, [period]: false })); }
      })
      .catch(() => { if (reading.current[period] === abort) setFailed((f) => ({ ...f, [period]: true })); })
      .finally(() => { clearTimeout(timer); if (reading.current[period] === abort) delete reading.current[period]; });
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
  // Candles hidden past the right edge by dragging the chart; 0 ends it at the latest. A refresh
  // keeps it, another period starts again from its latest candle (native CandleChart.hidden).
  const [hiddenState, setHidden] = useState(0), [panning, setPanning] = useState(false);
  const spacing = candleSpacing(loaded), [period, setPeriod] = useState(spacing);
  if (period !== spacing) { setPeriod(spacing); setHidden(0); }
  const bounds = zoomBounds(size.width, loaded.length), count = shownCount(zoom, size.width, loaded.length);
  const zoomBy = (scale: number) => setZoom((z) => zoomed(z ?? count, scale, bounds));
  // The wheel and Safari's gesture listeners are attached once; they read the latest render here.
  const live = useRef({ zoomBy, current: () => zoom ?? count, zoomFrom: (from: number, scale: number) => setZoom(zoomed(from, scale, bounds)), inspect: (_: number) => {} });
  const drag = useRef<Drag | null>(null);
  useEffect(() => {
    const el = plot.current; if (!el) return;
    // A pan or a held inspection owns the finger: the page mustn't start scrolling under it.
    // Until then the page may (touch-action: pan-y), and a drag that sets off up or down is its.
    const hold = (e: TouchEvent) => { const mode = drag.current?.mode; if ((mode === "pan" || mode === "inspect") && e.cancelable) e.preventDefault(); };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => { el.removeEventListener("touchmove", hold); clearTimeout(drag.current?.timer); };
  }, []);
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
  // Two fingers on a touch screen pinch; one pans, or inspects (see the plot's handlers).
  const touches = useRef(new Map<number, [number, number]>()), pinch = useRef<{ spread: number; from: number } | null>(null);
  const spread = () => { const [a, b] = [...touches.current.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const [start, end] = visibleRange(loaded.length, count, hiddenState), hidden = loaded.length - end;
  const candles = loaded.slice(start, end), n = candles.length;
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
  live.current = { zoomBy, current: () => zoom ?? count, zoomFrom: (from: number, scale: number) => setZoom(zoomed(from, scale, bounds)), inspect };
  const release = (id: number) => {
    const d = drag.current; if (!d || d.id !== id) return null;
    clearTimeout(d.timer); drag.current = null; setPanning(false); return d;
  };
  // The keyboard moves the crosshair through everything loaded, panning at the window's edges.
  const reach = (i: number) => {
    const at = Math.max(0, Math.min(loaded.length - 1, i));
    setHidden(revealing(hidden, at, count, loaded.length)); setActive(loaded[at].t);
  };
  const step = 1.5;
  return <>
  <div className="kline-zoom">
    <button className="icon-button" aria-label={t("zoomOut")} title={t("zoomOut")} disabled={count >= bounds.max} onClick={() => zoomBy(1 / step)}><Icon name="minus" /></button>
    <button className="icon-button" aria-label={t("zoomIn")} title={t("zoomIn")} disabled={count <= bounds.min} onClick={() => zoomBy(step)}><Icon name="plus" /></button>
  </div>
  <div className="kline-frame">
    <div className={panning ? "kline-plot kline-panning" : "kline-plot"} ref={plot} tabIndex={0} role="group" aria-label={t("kline")} aria-description={t("klineHelp")}
      // The mouse inspects by hovering and pans by dragging. A finger pans by setting off sideways,
      // inspects once held still (then scrubs) or by tapping, and leaves an up-or-down swipe to the
      // page; two fingers pinch. As native CandleChart / HoldToScrub.
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.pointerType === "touch") touches.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.current.size >= 2) {
          if (drag.current) release(drag.current.id);
          if (touches.current.size === 2) { pinch.current = { spread: spread(), from: zoom ?? count }; setActive(null); }
          return;
        }
        if (drag.current) release(drag.current.id);
        const mouse = e.pointerType === "mouse", id = e.pointerId;
        const d: Drag = { id, mouse, x: e.clientX, y: e.clientY, lastX: e.clientX, from: hidden, width: e.currentTarget.getBoundingClientRect().width, mode: "wait" };
        if (mouse) inspect(e.clientX);
        else d.timer = setTimeout(() => { const now = drag.current; if (now?.id === id && now.mode === "wait") { now.mode = "inspect"; live.current.inspect(now.lastX); } }, HOLD_MS);
        drag.current = d;
        e.currentTarget.setPointerCapture(id);
      }}
      onPointerMove={(e) => {
        if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch.current) { if (touches.current.size === 2 && pinch.current.spread > 0) live.current.zoomFrom(pinch.current.from, spread() / pinch.current.spread); return; }
        const d = drag.current;
        if (!d || d.id !== e.pointerId) { if (e.pointerType === "mouse") inspect(e.clientX); return; }
        d.lastX = e.clientX;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (d.mode === "wait") {
          const intent = d.mouse ? (Math.hypot(dx, dy) >= MOUSE_SLOP ? "pan" : null) : dragIntent(dx, dy, TOUCH_SLOP);
          if (!intent) { if (d.mouse) inspect(e.clientX); return; }
          clearTimeout(d.timer);
          if (intent === "scroll") { d.mode = "off"; return; }
          d.mode = "pan"; setPanning(true); setActive(null);
        }
        if (d.mode === "pan") setHidden(panned(d.from, dx, d.width, count, loaded.length));
        else if (d.mode === "inspect") inspect(e.clientX);
      }}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null;
        const d = release(e.pointerId);
        // A tap inspects the candle under it, as before; after a pan the mouse is back to hovering.
        if (d && !d.mouse && d.mode === "wait") inspect(e.clientX);
        else if (d?.mouse && d.mode === "pan") inspect(e.clientX);
      }}
      onPointerCancel={(e) => { touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null; release(e.pointerId); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse" && !drag.current) setActive(null); }}
      // A long press would otherwise bring up the browser's own menu over the inspection.
      onContextMenu={(e) => { if (drag.current && !drag.current.mouse) e.preventDefault(); }}
      onBlur={() => setActive(null)} onFocus={() => { if (active == null) select(n - 1); }}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const at = index == null ? end - 1 : start + index; reach(e.key === "Home" ? 0 : e.key === "End" ? loaded.length - 1 : at + (e.key === "ArrowLeft" ? -1 : 1)); }
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
