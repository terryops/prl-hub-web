import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lang, PoolOverview } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { hasPpsRealCost, ppsWindowEnd, realCostPeriods } from "./pool-comparison.ts";

/** A button whose bubble opens on hover, focus or tap. The bubble sits in a portal so the pool table's scroll box cannot clip it. */
export function HelpTip({ label, className, bubbleClassName = "pool-cost-tooltip", mark, children }: { label: string; className: string; bubbleClassName?: string; mark: ReactNode; children: ReactNode }) {
  const id = useId(), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const close = () => { clearTimeout(timer.current); pinned.current = false; setOpen(false); };
  const leave = () => { timer.current = setTimeout(() => { if (!pinned.current && document.activeElement !== trigger.current) setOpen(false); }, 120); };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const scroll = (event: Event) => { if (!tooltip.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", close); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect(), box = tooltip.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.right - box.width, innerWidth - box.width - 12));
    const preferredTop = anchor.bottom + 8 + box.height <= innerHeight - 12 ? anchor.bottom + 8 : anchor.top - box.height - 8;
    tooltip.current.style.left = `${left}px`;
    tooltip.current.style.top = `${Math.max(12, Math.min(preferredTop, innerHeight - box.height - 12))}px`;
    tooltip.current.style.visibility = "visible";
  }, [open, children]);

  return <>
    <button type="button" className={className} ref={trigger} aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={() => { if (!pinned.current) close(); }}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}>{mark}</button>
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className={bubbleClassName} onMouseEnter={show} onMouseLeave={leave}>{children}</div>, document.body)}
  </>;
}

export function PoolCostHelp({ rows, lang, t }: { rows: PoolOverview[]; lang: Lang; t: (key: TextKey) => string }) {
  const periods = realCostPeriods(rows), pps = periods.length > 0 && hasPpsRealCost(rows);
  // Without a timeZone override, Intl uses the visitor's device zone; lang controls formatting only.
  const formatter = new Intl.DateTimeFormat(lang, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
  return <HelpTip label={t("poolRealCostHelp")} className="pool-cost-help" mark={<span aria-hidden="true">?</span>}>
      <strong>{t("poolRealCostHelp")}</strong>
      <p>{t(periods.length ? "poolRealCostPeriodIntro" : "poolRealCostPeriodMissing")}</p>
      {periods.map((period) => <div className="pool-cost-period" key={`${period.start}:${period.end}`}>
        {periods.length > 1 && <strong>{period.names.join(" · ")}</strong>}
        <dl><dt>{t("poolRealCostFrom")}</dt><dd><time dateTime={new Date(period.start * 1000).toISOString()}>{formatter.format(period.start * 1000)}</time></dd>
          <dt>{t("poolRealCostTo")}</dt><dd><time dateTime={new Date(period.end * 1000).toISOString()}>{formatter.format(period.end * 1000)}</time></dd></dl>
      </div>)}
      {pps && <p className="pool-cost-note">{t("poolRealCostPpsUpdate").replace("%@",
        new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(ppsWindowEnd()))}</p>}
  </HelpTip>;
}
