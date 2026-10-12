import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Lang, PoolOverview } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { realCostPeriods } from "./pool-comparison.ts";

export function PoolCostHelp({ rows, lang, t }: { rows: PoolOverview[]; lang: Lang; t: (key: TextKey) => string }) {
  const id = useId(), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const periods = realCostPeriods(rows);
  const formatter = new Intl.DateTimeFormat(lang, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
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
  }, [open, lang, rows]);

  return <>
    <button type="button" className="pool-cost-help" ref={trigger} aria-label={t("poolRealCostHelp")} aria-describedby={open ? id : undefined} aria-expanded={open}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={() => { if (!pinned.current) close(); }}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}><span aria-hidden="true">?</span></button>
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className="pool-cost-tooltip" onMouseEnter={show} onMouseLeave={leave}>
      <strong>{t("poolRealCostHelp")}</strong>
      <p>{t(periods.length ? "poolRealCostPeriodIntro" : "poolRealCostPeriodMissing")}</p>
      {periods.map((period) => <div className="pool-cost-period" key={`${period.start}:${period.end}`}>
        {periods.length > 1 && <strong>{period.names.join(" · ")}</strong>}
        <dl><dt>{t("poolRealCostFrom")}</dt><dd><time dateTime={new Date(period.start * 1000).toISOString()}>{formatter.format(period.start * 1000)}</time></dd>
          <dt>{t("poolRealCostTo")}</dt><dd><time dateTime={new Date(period.end * 1000).toISOString()}>{formatter.format(period.end * 1000)}</time></dd></dl>
      </div>)}
    </div>, document.body)}
  </>;
}
