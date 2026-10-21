import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import type { NetworkPoint } from "./market.ts";
import { Skeleton } from "./Skeleton.tsx";
import { nearestPoint } from "./chart.ts";
import { difficulty, hashUnit } from "./format.ts";
import { SPAN_SECONDS, TICK_FORMAT, alignedAxis, averageBlockTime, axisDigits, changeSince, duration, niceAxis, placeTicks, type HashSpan } from "./hashview.ts";

type Translate = (k: TextKey) => string;

/// The Network hashrate card's mixed view: the latest rolling estimate and its change over the
/// span; the estimate as a filled line on the left axis with difficulty dotted on the right axis,
/// both on the same gridlines; then block time over the same window, on the same time axis.
/// `points` are the span's samples and `series` their estimates over `blocks` blocks (historySeries),
/// the same kind the Network hashrate card reads its figures from.
export function HashChart({ points, series, blocks, span, loading, t, lang }: { points: NetworkPoint[]; series: number[][]; blocks: number; span: HashSpan; loading: boolean; t: Translate; lang: Lang }) {
  if (loading) return <Skeleton label={t("loading")} kind="chart" />;
  if (series.length < 2) return <p className="chart-empty">{t("samplingHistory")}</p>;
  return <HashPlot series={series} points={points} blocks={blocks} span={span} t={t} lang={lang} />;
}

const longest = (labels: string[]) => labels.reduce((a, b) => b.length > a.length ? b : a, "");
/// Pixel height of the plots; CSS sets the same (smaller on phones), measured once rendered.
const useHeight = (initial: number) => {
  const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 600, height: initial });
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
};

function HashPlot({ series, points, blocks, span, t, lang }: { series: number[][]; points: NetworkPoint[]; blocks: number; span: HashSpan; t: Translate; lang: Lang }) {
  const [plot, size] = useHeight(240), [blockPlot, blockSize] = useHeight(84), [active, setActive] = useState<number | null>(null);
  const fill = "hash-fill-" + useId().replace(/[^\w-]/g, "");
  const values = series.map((p) => p[1]), blockTimes = series.map((p) => p[2]), diffs = points.map((p) => [p.ts, p.difficulty]);
  // Each estimate is at one of the span's samples, so its difficulty is that sample's.
  const difficultyAt = useMemo(() => new Map(points.map((p) => [p.ts, p.difficulty])), [points]);
  const [unit, scale] = hashUnit(Math.max(...values)), latest = series.at(-1)!, change = changeSince(series, SPAN_SECONDS[span]), average = averageBlockTime(points);
  // Hashrate picks round gridlines; difficulty gets its own round values on the same lines.
  const hashTicks = niceAxis(Math.min(...values) / scale, Math.max(...values) / scale), intervals = hashTicks.length - 1;
  const diffValues = diffs.map((p) => p[1] / 1e6), diffTicks = alignedAxis(Math.min(...diffValues), Math.max(...diffValues), intervals);
  const blockTicks = niceAxis(Math.min(...blockTimes), Math.max(...blockTimes), 2), blockIntervals = blockTicks.length - 1;
  const start = points[0].ts, end = points.at(-1)!.ts, pad = 10;
  const level = (i: number, height = size.height, n = intervals) => height - pad - i / n * (height - 2 * pad);
  const x = (ts: number) => (ts - start) / (end - start || 1) * size.width;
  const y = (v: number) => level((v / scale - hashTicks[0]) / (hashTicks[intervals] - hashTicks[0]) * intervals);
  const dy = (v: number) => level((v / 1e6 - diffTicks[0]) / (diffTicks[intervals] - diffTicks[0]) * intervals);
  const by = (v: number) => level((v - blockTicks[0]) / (blockTicks[blockIntervals] - blockTicks[0]) * blockIntervals, blockSize.height, blockIntervals);
  const bottom = level(0), line = series.map(([ts, v]) => `${x(ts).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(series[0][0]).toFixed(1)},${bottom} ${line} ${x(latest[0]).toFixed(1)},${bottom}`;
  const digits = (ticks: number[]) => { const d = axisDigits(ticks); return { minimumFractionDigits: d, maximumFractionDigits: d }; };
  const hashLabels = hashTicks.map((v) => v.toLocaleString(lang, digits(hashTicks))), diffLabels = diffTicks.map((v) => v === 0 ? "0" : v.toLocaleString(lang, digits(diffTicks)) + "M");
  const blockLabels = blockTicks.map((v) => v.toLocaleString(lang, digits(blockTicks)) + "s");
  const amount = (v: number) => (v / scale).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (ts: number) => new Date(ts * 1000).toLocaleString(lang, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const ticks = useMemo(() => placeTicks(start, end, size.width, (tick) => new Date(tick.ts * 1000).toLocaleString(lang, TICK_FORMAT[tick.kind])), [start, end, size.width, lang]);
  const current = active == null ? null : series[Math.min(active, series.length - 1)];
  const currentDifficulty = current && difficultyAt.get(current[0]);
  // Either plot inspects the same moment: one cursor through both, one tooltip.
  const pointer = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => { inspect(e.currentTarget, e.clientX); e.currentTarget.setPointerCapture(e.pointerId); },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => inspect(e.currentTarget, e.clientX),
    onPointerLeave: (e: PointerEvent<HTMLDivElement>) => { if (e.pointerType === "mouse") setActive(null); },
  };
  const inspect = (el: HTMLElement, clientX: number) => { const box = el.getBoundingClientRect(); setActive(nearestPoint(series, start + Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * (end - start))); };
  const axis = (side: string, labels: string[], height: number, n: number, anchor?: "end") => <div className={`hash-axis hash-axis-${side}`} aria-hidden="true">
    <span className="hash-axis-sizer">{longest(labels)}</span>
    <svg className="hash-axis-labels">{labels.map((text, i) => <text key={i} x={anchor ? "100%" : "0"} y={level(i, height, n)} textAnchor={anchor}>{text}</text>)}</svg>
  </div>;
  const label = `${t("network")} · ${t("difficulty")}`;
  return <div className="hash-view">
    <div className="hash-summary">
      <p className="hash-value"><strong>{amount(latest[1])}</strong><span>{unit}</span></p>
      {change != null && <p className="hash-change">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={change >= 0 ? "M4 12 12 4M6 4h6v6" : "M4 4l8 8M12 6v6H6"} /></svg>
        <span>{change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(1)}%</span><span className="hash-change-span">{span}</span>
      </p>}
      <p className="hash-basis">{t("hashRollingEstimate").replace("%@", blocks.toLocaleString(lang))}</p>
    </div>
    <div className="hash-frame">
      <div className="hash-axis-titles" aria-hidden="true"><span className="hash-axis-title-hash">{unit}</span><span className="hash-axis-title-difficulty">{t("difficulty")}</span></div>
      {/* Axis labels are SVG text level with the plots' gridlines; the hidden sizer gives each
          column its width. The site allows no inline styles. */}
      {axis("left", hashLabels, size.height, intervals, "end")}
      <div className="hash-plot" ref={plot} tabIndex={0} role="group" aria-label={label} aria-description={t("chartHelp")} {...pointer}
        onBlur={() => setActive(null)} onFocus={() => setActive(series.length - 1)}
        onKeyDown={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); setActive(e.key === "Home" ? 0 : e.key === "End" ? series.length - 1 : Math.max(0, Math.min(series.length - 1, (active ?? series.length - 1) + (e.key === "ArrowLeft" ? -1 : 1)))); } }}>
        <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label={label} className="hash-svg">
          <defs><linearGradient id={fill} x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="hash-fill-top" /><stop offset="1" className="hash-fill-bottom" /></linearGradient></defs>
          {hashTicks.map((_, i) => <line key={i} x1="0" x2={size.width} y1={level(i)} y2={level(i)} className="hash-grid" />)}
          <polygon points={area} fill={`url(#${fill})`} />
          <polyline points={diffs.map(([ts, v]) => `${x(ts).toFixed(1)},${dy(v).toFixed(1)}`).join(" ")} className="hash-difficulty" />
          <polyline points={line} className="hash-line" />
          {current ? <>
            <line x1={x(current[0])} x2={x(current[0])} y1={level(intervals)} y2={bottom} className="chart-cursor" />
            {currentDifficulty != null && <circle cx={x(current[0])} cy={dy(currentDifficulty)} r="3.5" className="hash-difficulty-dot" />}
            <circle cx={x(current[0])} cy={y(current[1])} r="4.5" className="hash-dot" />
          </> : <><circle cx={x(latest[0])} cy={y(latest[1])} r="9" className="hash-halo" /><circle cx={x(latest[0])} cy={y(latest[1])} r="4.5" className="hash-dot" /></>}
        </svg>
        {current && <output className={`chart-tooltip hash-tooltip ${x(current[0]) < size.width / 2 ? "hash-tooltip-right" : ""}`} aria-live="polite">
          <time>{when(current[0])}</time>
          <dl>
            <dt><i className="hash-key-line" />{t("hashrate")}</dt><dd>{amount(current[1])} {unit}</dd>
            {currentDifficulty != null && <><dt><i className="hash-key-difficulty" />{t("difficulty")}</dt><dd>{difficulty(currentDifficulty, lang)}</dd></>}
            <dt><i className="hash-key-block" />{t("blockTime")}</dt><dd>{duration(current[2])}</dd>
          </dl>
        </output>}
      </div>
      {axis("right", diffLabels, size.height, intervals)}
      <p className="hash-block-title">{t("blockTime")}{average != null && <span> · {t("spanAverage").replace("%@", duration(average))}</span>}</p>
      {axis("block", blockLabels, blockSize.height, blockIntervals, "end")}
      <div className="hash-block-plot" ref={blockPlot} {...pointer}>
        <svg viewBox={`0 0 ${blockSize.width} ${blockSize.height}`} preserveAspectRatio="none" role="img" aria-label={t("blockTime")} className="hash-svg">
          {blockTicks.map((_, i) => <line key={i} x1="0" x2={blockSize.width} y1={level(i, blockSize.height, blockIntervals)} y2={level(i, blockSize.height, blockIntervals)} className="hash-grid" />)}
          <polyline points={series.map(([ts, , b]) => `${(x(ts) * blockSize.width / size.width).toFixed(1)},${by(b).toFixed(1)}`).join(" ")} className="hash-block-line" />
          {current && <>
            <line x1={x(current[0]) * blockSize.width / size.width} x2={x(current[0]) * blockSize.width / size.width} y1="0" y2={blockSize.height} className="chart-cursor" />
            <circle cx={x(current[0]) * blockSize.width / size.width} cy={by(current[2])} r="3.5" className="hash-block-dot" />
          </>}
        </svg>
      </div>
      <svg className="hash-ticks" aria-hidden="true">{ticks.map((tick) => <text key={tick.ts} x={tick.x} y="13" textAnchor={tick.anchor}>{tick.text}</text>)}</svg>
      <div className="sr-only">{series.map(([ts, v, b], i) => <span key={i}>{when(ts)} · {amount(v)} {unit} · {difficulty(difficultyAt.get(ts), lang)} · {duration(b)}; </span>)}</div>
    </div>
  </div>;
}
