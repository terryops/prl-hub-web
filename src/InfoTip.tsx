import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A button whose bubble opens on hover, focus or tap. The bubble sits in a portal so the pool table's scroll box cannot clip it;
 * inside a modal <dialog> the portal is the dialog itself, which sits in the top layer above everything in <body>. */
export function HelpTip({ label, className, bubbleClassName = "pool-cost-tooltip", mark, hint, children }: { label: string; className: string; bubbleClassName?: string; mark: ReactNode; hint?: string; children: ReactNode }) {
  const id = useId(), hintId = `${id}-hint`, [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const close = () => { clearTimeout(timer.current); pinned.current = false; setOpen(false); };
  const leave = () => { timer.current = setTimeout(() => { if (!pinned.current && document.activeElement !== trigger.current) setOpen(false); }, 120); };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) close(); };
    // Esc closes the bubble only, not the sheet or dialog it sits in.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
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
    const top = Math.max(12, Math.min(preferredTop, innerHeight - box.height - 12));
    tooltip.current.style.left = `${left}px`;
    tooltip.current.style.top = `${top}px`;
    // Inside a transformed dialog "fixed" is relative to the dialog, not the screen: correct by the measured offset.
    const placed = tooltip.current.getBoundingClientRect();
    if (placed.left !== left || placed.top !== top) {
      tooltip.current.style.left = `${2 * left - placed.left}px`;
      tooltip.current.style.top = `${2 * top - placed.top}px`;
    }
    tooltip.current.style.visibility = "visible";
  }, [open, children]);

  return <>
    {hint && <span id={hintId} hidden>{hint}</span>}
    <button type="button" className={className} ref={trigger} aria-label={label} aria-describedby={open ? id : hint ? hintId : undefined} aria-expanded={open}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={() => { if (!pinned.current) close(); }}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}>{mark}</button>
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className={bubbleClassName} onMouseEnter={show} onMouseLeave={leave}>{children}</div>, trigger.current?.closest("dialog") || document.body)}
  </>;
}

/** The ⓘ glyph (Ionicons information-circle-outline), for other help buttons that should look the same. */
export const InfoMark = () => <svg className="icon" viewBox="0 0 512 512" aria-hidden="true"><path d="M248 64C146.39 64 64 146.39 64 248s82.39 184 184 184 184-82.39 184-184S349.61 64 248 64Z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="32" /><path d="M220 220h32v116" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32" /><path d="M208 340h88" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="32" /><path fill="currentColor" d="M248 130a26 26 0 1 0 26 26 26 26 0 0 0-26-26" /></svg>;

/** iOS PearlInfoTip: a small ⓘ beside what it explains, holding the sentence that would otherwise sit on the
 * page. Tap (or hover / focus with a mouse) shows it in a bubble. `label` names the button for screen readers;
 * the text is its description. Consequences of an irreversible action stay on the page, never in here. */
export function InfoTip({ text, label, title, warn, className }: { text: ReactNode; label: string; title?: string; warn?: boolean; className?: string }) {
  return <HelpTip label={label} hint={typeof text === "string" ? text : undefined} className={`info-tip${warn ? " warn" : ""}${className ? ` ${className}` : ""}`} bubbleClassName="pool-cost-tooltip info-tip-bubble"
    mark={<InfoMark />}>
    {title && <strong>{title}</strong>}
    <p>{text}</p>
  </HelpTip>;
}
