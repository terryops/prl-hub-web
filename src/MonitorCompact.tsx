import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Lang, Monitor, Stats, WindowName } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { hashrate, prlNumber, rate as windowRate } from "./format.ts";
import { nearestWindow } from "./monitors.ts";
import { Icon } from "./Icons.tsx";
import { Money } from "./Money.tsx";

// 我的监控 → 一览, as in the app (PoolCompactList.swift): the total hashrate in big type, then one
// small tile per monitor — two across on a phone, as many as fit on a wider screen — for when the
// full cards take a screen each. A tile opens that monitor's full card.

/// 卡片 (a full card per monitor) or 一览. A per-device choice, so it is not synced.
export type MonitorLayout = "cards" | "compact";
export const monitorLayout = (value: unknown): MonitorLayout => value === "compact" ? "compact" : "cards";

/// A pill's colour: quiet while all is well, the palette's gold when some rigs are down, rose when none are up.
export type PillTone = "ok" | "partial" | "down" | "idle";

type Snap = { data?: Stats; failed?: boolean } | undefined;
type T = (key: TextKey) => string;

/// One enabled monitor, reduced to what 一览 shows of it.
export type CompactMonitor = {
  monitor: Monitor;
  /// No answer yet.
  loading: boolean;
  /// The pool reported this address (or link).
  found: boolean;
  /// The read failed and there is nothing older to show.
  failed: boolean;
  /// Hashrate in the window the card shows for the shared window choice.
  rate: number;
  up: number;
  total: number;
  tone: PillTone;
};

export function compactMonitor(monitor: Monitor, snap: Snap, selected: WindowName): CompactMonitor {
  const s = snap?.data, found = !!s && !s.missing;
  const rate = found ? windowRate(s, nearestWindow(selected, s.windows)) : 0;
  const up = found ? s.workers.filter((w) => w.online).length : 0, total = found ? s.workers.length : 0;
  const loading = !s && !snap?.failed, failed = !s && !!snap?.failed;
  // A pool that lists no rigs is judged on its hashrate alone.
  const tone: PillTone = loading ? "idle" : !found ? failed ? "down" : "idle"
    : total === 0 ? rate > 0 ? "ok" : "idle" : up === total ? "ok" : up === 0 ? "down" : "partial";
  return { monitor, loading, found, failed, rate, up, total, tone };
}

/// What a tile's pill says: rigs online of rigs listed, else a word for the state.
export function badgeText(m: CompactMonitor, t: T) {
  if (m.loading) return "";
  if (m.found) return m.total > 0 ? `${m.up}/${m.total}` : t(m.rate > 0 ? "online" : "offline");
  return t(m.failed ? "failedShort" : "offline");
}

/// What a tile is read out as: rigs online, or why there is nothing to show.
export function detailText(m: CompactMonitor, t: T) {
  if (m.loading) return t("loading");
  if (m.found) return m.total > 0 ? t("onlineOf").replace("%@", `${m.up}/${m.total}`) : t(m.rate > 0 ? "online" : "offline");
  return t(m.failed ? "failedShort" : "missing");
}

export const rigsTone = (up: number, rigs: number): PillTone => up === rigs ? "ok" : up === 0 ? "down" : "partial";

/// The fleet: hashrate and rigs of the monitors that reported.
export function compactTotal(items: CompactMonitor[]) {
  const reporting = items.filter((m) => m.found);
  return {
    rate: reporting.reduce((n, m) => n + m.rate, 0),
    up: reporting.reduce((n, m) => n + m.up, 0),
    rigs: reporting.reduce((n, m) => n + m.total, 0),
  };
}

/// What reached the payout addresses in the last 24 h: one figure per address, so two monitors on one
/// address share its income. `h24` is undefined while an address is still loading and null when its read
/// failed with nothing older. Nothing is shown until every address has answered. An F2Pool monitor is a
/// read-only page link with no payout address in it, so its income can't be in the figure: `uncounted`
/// names those pools, or the figure would read as the whole account's.
export function compactIncome(monitors: Monitor[], h24: (addr: string) => number | null | undefined) {
  const addresses = [...new Set(monitors.filter((m) => m.pool !== "F2Pool").map((m) => m.addr))];
  const values = addresses.map(h24);
  const uncounted = [...new Set(monitors.filter((m) => m.pool === "F2Pool").map((m) => m.pool))].sort();
  if (!addresses.length || values.some((v) => v === undefined)) return null;
  const received = values.filter((v): v is number => typeof v === "number");
  return received.length ? { sum: received.reduce((n, v) => n + v, 0), uncounted } : null;
}

/// The pool's own logo (public/pools, from the app's asset catalog), with a dark-mode plate where the app has one.
export const poolSlug = (pool: string) => pool.toLowerCase().replace(/[^a-z0-9]/g, "");
export function PoolIcon({ pool }: { pool: string }) {
  return <span className={`pool-icon pool-icon-${poolSlug(pool)}`} aria-hidden="true" />;
}

/// The 卡片 / 一览 switch in 我的监控's toolbar.
export function LayoutSwitch({ layout, onChange, t }: { layout: MonitorLayout; onChange: (layout: MonitorLayout) => void; t: T }) {
  const options = [["cards", "cards", "cardView"], ["compact", "compact", "compactView"]] as const;
  return <div className="segments layout-switch" role="radiogroup" aria-label={t("layout")} title={t("layout")}>
    {options.map(([value, icon, label]) => <button key={value} type="button" role="radio" aria-checked={layout === value} aria-label={t(label)} title={t(label)}
      className={layout === value ? "selected" : ""} onClick={() => onChange(value)}><Icon name={icon} /></button>)}
  </div>;
}

/// Rigs online as a tinted pill.
function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`rigs-pill rigs-pill-${tone}`}>{children}</span>;
}

/// "2.53 PH/s" with the unit a step quieter than the figure.
function HeroRate({ value, lang }: { value: number; lang: Lang }) {
  if (!(value > 0)) return <>—</>;
  const s = hashrate(value, lang), space = s.lastIndexOf(" ");
  return space < 0 ? <>{s}</> : <>{s.slice(0, space)}<span className="compact-unit">{s.slice(space)}</span></>;
}

type Actions = {
  onOpen: (m: Monitor) => void;
  onPause: (m: Monitor, paused: boolean) => void;
  onEdit: (m: Monitor) => void;
  onDelete: (m: Monitor) => void;
  /// Moves a monitor to `destination` in `monitors`, the order both layouts share.
  onMove: (id: string, destination: number) => void;
};

export function MonitorCompactList({ monitors, snapshot, selected, h24, usd, money, lang, t, ...actions }: Actions & {
  /// Every live monitor, paused ones included, in the user's order.
  monitors: Monitor[];
  snapshot: (m: Monitor) => Snap;
  selected: WindowName;
  h24: (addr: string) => number | null | undefined;
  usd?: number;
  money: (usd: number) => string;
  lang: Lang;
  t: T;
}) {
  const running = monitors.filter((m) => !m.paused), paused = monitors.filter((m) => m.paused);
  const items = running.map((m) => compactMonitor(m, snapshot(m), selected));
  const [showPaused, setShowPaused] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  // Reordering by drag is for a mouse or pen; on a touch screen a long press opens the actions instead.
  const [finePointer] = useState(() => typeof matchMedia !== "function" || matchMedia("(pointer: fine)").matches);
  const row = { menu, setMenu, draggable: finePointer, monitors, t, ...actions };
  return <div className="compact-monitors">
    {/* With one monitor the total would only repeat its tile. */}
    {items.length > 1 && <Total items={items} monitors={running} h24={h24} usd={usd} money={money} lang={lang} t={t} />}
    {items.length > 0 && <div className="monitor-tiles">
      {items.map((m) => <Entry key={m.monitor.id} monitor={m.monitor} className="monitor-tile" label={`${m.monitor.label}, ${m.found && m.rate > 0 ? hashrate(m.rate, lang) : "—"}, ${detailText(m, t)}`} {...row}>
        <span className="tile-top">
          <PoolIcon pool={m.monitor.pool} />
          {!m.loading && <Pill tone={m.tone}>{badgeText(m, t)}</Pill>}
        </span>
        <span className="tile-name">{m.monitor.label}</span>
        {m.loading ? <span className="tile-rate"><span className="tile-loading" aria-hidden="true" /></span>
          : <span className={`tile-rate${m.found ? "" : " tile-rate-none"}`}>{m.found && m.rate > 0 ? hashrate(m.rate, lang) : "—"}</span>}
      </Entry>)}
    </div>}
    {/* Paused monitors fold into one line: nothing is fetched for them, so they only take room. */}
    {paused.length > 0 && <section className="card paused-fold">
      <button type="button" className="paused-toggle" aria-expanded={showPaused} onClick={() => setShowPaused(!showPaused)}>
        <span>{t("paused")} · {paused.length.toLocaleString(lang)}</span><Icon name="chevron" className={showPaused ? "open" : undefined} />
      </button>
      {showPaused && paused.map((m) => <Entry key={m.id} monitor={m} className="paused-line" label={`${m.label}, ${t("paused")}`} {...row}>
        <PoolIcon pool={m.pool} /><span className="paused-name">{m.label}</span>
      </Entry>)}
    </section>}
  </div>;
}

/// The fleet's hashrate in big type, rigs online in a pill beside its label and, under it, what reached
/// the payout addresses in the last 24 h.
function Total({ items, monitors, h24, usd, money, lang, t }: { items: CompactMonitor[]; monitors: Monitor[]; h24: (addr: string) => number | null | undefined; usd?: number; money: (usd: number) => string; lang: Lang; t: T }) {
  const total = compactTotal(items), income = compactIncome(monitors, h24);
  const digits = income && Math.abs(income.sum) < 0.01 ? 4 : 2;
  return <section className="card compact-total">
    <div className="compact-total-head">
      <h2>{t("fleetHash")}</h2>
      {total.rigs > 0 && <Pill tone={rigsTone(total.up, total.rigs)}>{t("onlineOf").replace("%@", `${total.up}/${total.rigs}`)}</Pill>}
    </div>
    <strong className="compact-total-rate"><HeroRate value={total.rate} lang={lang} /></strong>
    {income && <p className="compact-income"><span className="compact-income-line">
      {/* One line where it fits; otherwise the note wraps as a whole rather than inside it. */}
      <span>{t("recent24h")} {income.sum >= 0 ? "+" : ""}{prlNumber(income.sum, lang, digits, digits)} PRL{usd && income.sum > 0 ? <> ≈ <Money compact amount={money(income.sum * usd)} /></> : null}</span>
      {income.uncounted.length > 0 && <span className="compact-income-note">{t("excluding").replace("%@", income.uncounted.join(", "))}</span>}
    </span></p>}
  </section>;
}

/// A tile or a paused line: opens the monitor's card; right click, a long press or the context-menu key has
/// its card's actions, and with a mouse it drags to reorder, the same order as the cards.
function Entry({ monitor, className, label, children, menu, setMenu, draggable, monitors, t, onOpen, onPause, onEdit, onDelete, onMove }: Actions & {
  monitor: Monitor; className: string; label: string; children: ReactNode;
  menu: string | null; setMenu: (id: string | null) => void; draggable: boolean; monitors: Monitor[]; t: T;
}) {
  const open = menu === monitor.id, wrap = useRef<HTMLDivElement>(null), target = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null), pressed = useRef(false);
  const close = (refocus: boolean) => { setMenu(null); if (refocus) target.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>(".tile-menu button")?.focus();
    const outside = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [open]);
  const endPress = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; };
  useEffect(() => endPress, []);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pressed.current = false;
    press.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { pressed.current = true; press.current = null; setMenu(monitor.id); }, 500) };
  };
  const onPointerMove = (e: PointerEvent) => { if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) endPress(); };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(monitor); }
    // The context-menu key and Shift+F10, which not every browser turns into a contextmenu event.
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); setMenu(monitor.id); }
  };
  const menuKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")], at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (e.key === "Tab") close(false);
  };
  const act = (run: () => void) => () => { close(false); run(); };
  return <div ref={wrap} className={`compact-entry${open ? " menu-open" : ""}`} draggable={draggable}
    onDragStart={(e) => { e.dataTransfer.setData("text/plain", monitor.id); e.dataTransfer.effectAllowed = "move"; }}
    onDragOver={(e) => e.preventDefault()}
    onDrop={(e) => { e.preventDefault(); onMove(e.dataTransfer.getData("text/plain"), monitors.findIndex((x) => x.id === monitor.id)); }}>
    <div ref={target} className={className} role="button" tabIndex={0} aria-label={label} aria-haspopup="menu"
      onClick={() => { if (pressed.current) { pressed.current = false; return; } onOpen(monitor); }} onKeyDown={keys}
      onContextMenu={(e) => { e.preventDefault(); if (press.current) pressed.current = true; endPress(); setMenu(monitor.id); }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPress} onPointerCancel={endPress}>
      {children}
    </div>
    {open && <div className="tile-menu" role="menu" aria-label={t("manage")} onKeyDown={menuKeys}>
      <button type="button" role="menuitem" onClick={act(() => onPause(monitor, !monitor.paused))}><Icon name={monitor.paused ? "play" : "pause"} />{t(monitor.paused ? "resume" : "pause")}</button>
      <button type="button" role="menuitem" onClick={act(() => onEdit(monitor))}><Icon name="edit" />{t("edit")}</button>
      <button type="button" role="menuitem" className="danger" onClick={act(() => onDelete(monitor))}><Icon name="delete" />{t("delete")}</button>
    </div>}
  </div>;
}
