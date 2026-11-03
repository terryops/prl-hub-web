import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { State, Device, Stats, Overview, Price, Income, FleetSettings } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { api } from "./api.ts";
import { alive, fresh } from "./store.ts";
import { enabledMonitors, ownAddresses, targetKey, dailyAverage } from "./monitors.ts";
import { fleet, fleetDefaults, normalizeDevice, normalizeFleet, effectiveGrowth, gpuEconomics, gpuRent, rentalRate, deviceCards, deviceWatts, syncDevices, type EconomicsContext } from "./fleet.ts";
import { dual, secondaryCode, rateLine, type FX } from "./currency.ts";
import { hashrate, roundRent } from "./format.ts";
import { Icon } from "./Icons.tsx";
import { InfoTip } from "./InfoTip.tsx";
import { useBackLayer } from "./back-layer.ts";
import { Money, PRLAmount } from "./Money.tsx";
import { Calculator } from "./Calculator.tsx";
import { useGPUs } from "./gpus.ts";
import { scenarioUnit } from "./calculator.ts";
import { ANDROID, androidCopy, fill } from "./android.ts";
import type { NetworkHistory } from "./market.ts";

type Translate = (key: TextKey) => string;
const panels = ["overview", "devices", "catalog", "single"] as const;
type Panel = typeof panels[number];
// The 概览 page's 添加设备 opens the calculator on 我的设备: the next calculator to mount starts there.
let pendingPanel: Panel | null = null;
// "%@" slots (iOS format strings), filled in order.
const slots = (template: string, ...values: (string | number)[]) => values.reduce<string>((s, v) => s.replace("%@", String(v)), template);

/** iOS sheet: the device editor and, on a narrow screen, a GPU's detail. Android's back button closes it. */
function Sheet({ open, title, done, onClose, children }: { open: boolean; title: string; done: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    else if (!open && d.open) d.close();
  }, [open]);
  useBackLayer(open, onClose);
  return <dialog ref={ref} className="fleet-sheet" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
    {open && <div className="dialog-content"><div className="dialog-heading"><h2>{title}</h2><button type="button" className="fleet-sheet-done" onClick={onClose}>{done}</button></div>{children}</div>}
  </dialog>;
}

/** Wide enough for the GPU table and its detail side by side (iOS regular width). */
function useWide(min: number) {
  const ref = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= min + 280);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWide(entry.contentRect.width >= min); });
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);
  return [ref, wide] as const;
}

// `only="overview"`: just the fleet overview, for the Android 概览 page (the iOS 挖矿监控 dashboard shows
// 我的设备 in place rather than behind the calculator). `onOpenDevices` there opens the calculator's 我的设备.
export function FleetCalculator({ state, onState, data, price, fx, incomes, failed, t, only, onOpenDevices }: {
  state: State; onState: (fn: (s: State) => State) => void; data?: Overview; price?: Price; fx?: FX;
  incomes: Record<string, Income | undefined>; failed?: boolean; t: Translate; only?: "overview"; onOpenDevices?: () => void;
}) {
  const a = androidCopy(state.lang);
  const gpus = useGPUs();
  const [difficultyHistory, setDifficultyHistory] = useState<NetworkHistory>();
  const historyAt = useRef(0);
  useEffect(() => {
    if (!data?.network || Date.now() - historyAt.current < 300_000) return;
    let active = true;
    void api<NetworkHistory>("/v1/network/history?span=7d").then((history) => {
      if (active) { historyAt.current = Date.now(); setDifficultyHistory(history); }
    }).catch(() => {});
    return () => { active = false; };
  }, [data?.network?.ts]);
  const [syncing, setSyncing] = useState(false), [syncError, setSyncError] = useState(false);
  const [panel, setPanel] = useState<Panel>(() => !only && pendingPanel || (alive(state.devices || []).length ? "overview" : "single"));
  useEffect(() => { if (!only) pendingPanel = null; }, []);
  const selectPanel = (next: Panel) => { setPanel(next); window.scrollTo(0, 0); };
  // iOS: every control of a device lives in its own editor sheet; the list only reads.
  const [editing, setEditing] = useState<string | null>(null), [confirmDelete, setConfirmDelete] = useState(false);
  const [gpuSheet, setGpuSheet] = useState(false);
  const [catalogBox, wide] = useWide(720);
  const id = useId();
  const settings = state.fleetSettings || fleetDefaults(), input = state.calculator;
  const sort = settings.sortKey || "ownNet";
  const selected = gpus.some((g) => g.name === settings.selectedGPU) ? settings.selectedGPU! : "RTX 5070";
  const code = secondaryCode(state.secondary, state.lang) || "USD";
  const liveFx = fx?.rates[code] || settings.manualFX;
  const fxRate = code === "USD" ? 1 : settings.fxManual ? settings.manualFX : liveFx;
  const calcFX: FX | undefined = settings.fxManual && code !== "USD" ? { ok: true, base: "USD", ts: 0, rates: { ...fx?.rates, [code]: fxRate } } : fx;
  const money = (v: number | null) => v == null ? "—" : dual(v, state.secondary, state.lang, calcFX);
  const amount = (v: number | null, compact = false, block = false) => <Money amount={money(v)} compact={compact} block={block} />;
  const num = (v: number | null, digits = 2, minimumDigits = 0) => v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(state.lang, { minimumFractionDigits: minimumDigits, maximumFractionDigits: digits }).replace(/-/g, "−");
  const ctx: EconomicsContext = { input, settings, price: input.price ?? price?.usd ?? null, unit: scenarioUnit(input, data?.network?.prlPerTHDay ?? null, data?.network?.hashrate ?? null), networkHash: input.networkHash ?? data?.network?.hashrate ?? null, code, rate: fxRate, rates: fx?.rates || {} };
  const growth = effectiveGrowth(settings, input, data?.network, difficultyHistory?.points), result = fleet(state.devices || [], gpus, ctx, growth);
  const liveDevices = alive(state.devices || []), addresses = ownAddresses(state.monitors);
  // A new device goes straight into its editor: picking its card is the next step anyway (iOS addDevice).
  const addDevice = () => {
    const id = crypto.randomUUID();
    setPanel("devices");
    onState((s) => ({ ...s, devices: [...s.devices || [], { id, updated: fresh(), name: t("newDevice"), gpu: "RTX 5080", count: 1, rented: false, hoursPerDay: 24 }] }));
    setConfirmDelete(false); setEditing(id);
  };
  const got24 = addresses.flatMap((a) => incomes[a] ? [incomes[a]!.h24] : []), got7 = addresses.flatMap((a) => incomes[a] ? [incomes[a]!.d7] : []);
  const received24 = got24.length ? got24.reduce((n, v) => n + v, 0) : null;
  const received7 = got7.length ? got7.reduce((n, v) => n + v, 0) : null;
  const actualNet = (prl: number | null) => prl == null || ctx.price == null ? null : prl * ctx.price - result.power - result.rent;
  const measured = result.hash > 0 && (received24 != null || received7 != null) ? dailyAverage(received24 || 0, received7 || 0) / result.hash * 1000 : null;
  const setSettings = (patch: Partial<FleetSettings>) => onState((s) => ({ ...s, fleetSettings: normalizeFleet({ ...s.fleetSettings, ...patch }), settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }));
  const setInput = (patch: Partial<State["calculator"]>) => onState((s) => ({ ...s, calculator: { ...s.calculator, ...patch }, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }));
  const setSort = (sortKey: NonNullable<FleetSettings["sortKey"]>) => setSettings({ sortKey });
  const setSelected = (selectedGPU: string) => setSettings({ selectedGPU });
  const editDevice = (id: string, patch: Partial<Device>) => onState((s) => ({ ...s, devices: (s.devices || []).map((d) => {
    if (d.id !== id) return d;
    try { return normalizeDevice({ ...d, ...patch, updated: Math.max(fresh(), d.updated + 1) }); }
    catch { return d; }
  }) }));
  // Android asks first, as iOS does (an accidental tap must not rebuild the synced devices), and explains
  // what to do when there is nothing to sync.
  const askSync = () => {
    const count = enabledMonitors(state.monitors).length;
    if (!count) { alert(`${a.noWatchTitle}\n\n${a.introText}`); return; }
    if (confirm(`${a.syncAskTitle}\n\n${fill(a.syncAskNote, count)}`)) void sync();
  };
  // The first visit to 我的设备 with monitors but nothing synced yet offers it straight away (iOS didOfferSync).
  const offered = useRef(false);
  useEffect(() => {
    if (!ANDROID || offered.current || panel !== "devices" || !enabledMonitors(state.monitors).length || alive(state.devices || []).some((d) => d.customPearl != null)) return;
    offered.current = true;
    askSync();
  }, [panel]);
  const sync = async () => {
    setSyncing(true); setSyncError(false);
    try {
      const results = await Promise.all(enabledMonitors(state.monitors).map(async (monitor) => {
        try { return { monitor, stats: await api<Stats>("/v1/pool/stats", "POST", { pool: monitor.pool, addr: monitor.addr, acct: monitor.acct }) }; }
        catch { return { monitor, failed: true }; }
      }));
      setSyncError(results.some((r) => r.failed));
      onState((s) => ({ ...s, devices: syncDevices(s.devices || [], enabledMonitors(s.monitors).map((monitor) =>
        results.find((r) => r.monitor.id === monitor.id && targetKey(r.monitor) === targetKey(monitor)) || { monitor, failed: true })) }));
    } finally { setSyncing(false); }
  };
  const setRent = (name: string, hourly: number) => {
    hourly = roundRent(hourly);
    if (!Number.isFinite(hourly) || hourly < 0 || hourly > 125) return;
    onState((s) => ({ ...s, fleetSettings: { ...(s.fleetSettings || fleetDefaults()), rents: { ...s.fleetSettings?.rents, [name]: { ...s.fleetSettings?.rents[name], daily: hourly * 24, currency: s.fleetSettings?.rents[name]?.currency || code, fx: s.fleetSettings?.rents[name]?.currency && s.fleetSettings.rents[name].currency !== code ? fx?.rates[s.fleetSettings.rents[name].currency] || s.fleetSettings.rents[name].fx || fxRate : fxRate } } }, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }));
  };
  const field = (label: string, value: number, min: number, max: number, step: number, save: (v: number) => void, info?: string) => {
    const fieldId = `${id}-${label.replace(/\s+/g, "_")}`;
    const input = <input id={info ? fieldId : undefined} type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v) && v >= min && v <= max) save(v); }} />;
    return info ? <div className="form-field"><span className="field-label"><label htmlFor={fieldId}>{label}</label><InfoTip label={label} text={info} /></span>{input}</div> : <label className="form-field">{label}{input}</label>;
  };
  // A switch with a short label; what it means sits in the ⓘ beside it, outside the label so it stays the switch's name.
  const check = (label: string, value: boolean, save: (v: boolean) => void, info?: string) => {
    const box = <label className="compact-check"><input type="checkbox" className={label === t("rentPower") ? undefined : "switch"} checked={value} onChange={(e) => save(e.target.checked)} />{label}</label>;
    return info ? <div className="fleet-check">{box}<InfoTip label={label} text={info} /></div> : box;
  };
  const catalog = gpus.map((g) => gpuEconomics(g, ctx, growth)).sort((a, b) => {
    const value = (e: typeof a) => ({ ownNet: e.ownNet, rentNet: e.rentNet, breakEvenRent: e.breakEvenRent, hash: e.g.th, efficiency: e.efficiency })[sort] ?? -Infinity;
    return value(b) - value(a) || a.g.name.localeCompare(b.g.name);
  });
  const detail = catalog.find((e) => e.g.name === selected)!, rental = gpuRent(detail.g, ctx);
  const rentalCurrency = rental.currency || code;
  const perDay = t("fleetPerDay"), perHour = t("fleetPerHour");
  const tone = (v: number | null) => v != null && v >= 0 ? "positive" : "negative";
  // 显卡对比 colours only what pays: a loss is grey, not a column of red.
  const gain = (v: number | null) => v != null && v > 0 ? "positive" : "muted";
  const monitorCount = enabledMonitors(state.monitors).length;
  const syncButton = (className?: string) => <button className={className} disabled={syncing || !ANDROID && !monitorCount} onClick={() => { if (ANDROID) askSync(); else void sync(); }}>{syncing ? t("loading") : t("poolSync")}</button>;
  const editingDevice = editing ? liveDevices.find((d) => d.id === editing) : undefined;
  const openGPU = (name: string) => { setSelected(name); if (!wide) setGpuSheet(true); };
  const growthTip = settings.growthMode === "auto" ? t("autoGrowthNote") : t("fleetGrowthManual");

  const deviceEditor = (d: Device) => {
    const g = gpus.find((g) => g.name === d.gpu), row = result.rows.find((r) => r.device.id === d.id);
    const defaultRent = g ? gpuRent(g, ctx).daily * (d.customPearl != null ? deviceCards(d, g) : 1) : 0;
    const rentCurrency = d.rentCurrency || (g ? gpuRent(g, ctx).currency : code);
    const watts = row ? deviceWatts(d, ctx, g) * d.count : 0;
    return <div className="device-editor">
      <label className="form-field">{t("name")}<input maxLength={128} value={d.name} onChange={(e) => editDevice(d.id, { name: e.target.value })} /></label>
      {d.customPearl != null ? <>
        <div className="fleet-line"><span>{t("hashrate")}</span><b>24h {hashrate(d.customPearl * 1e12, state.lang)}</b></div>
        <div className="form-field"><span className="field-label"><label htmlFor={`${id}-chip`}>{t("fleetChip")}</label>{g
          ? <InfoTip label={t("fleetChip")} text={slots(t("fleetChipCards"), num(deviceCards(d, g)), g.name)} />
          : <InfoTip warn label={t("fleetChip")} text={t("unsetChipNote")} />}</span>
          <select id={`${id}-chip`} value={d.gpu} onChange={(e) => editDevice(d.id, { gpu: e.target.value })}><option value="">{t("unsetChip")}</option>{gpus.map((g) => <option key={g.name}>{g.name}</option>)}</select></div>
      </> : <>
        <label className="form-field">{t("cards")}<select value={d.gpu} onChange={(e) => editDevice(d.id, { gpu: e.target.value })}>{gpus.map((g) => <option key={g.name}>{g.name}</option>)}</select></label>
        {field(t("fleetQuantity"), d.count, 1, 256, 1, (count) => editDevice(d.id, { count }))}
      </>}
      <div className="form-field"><span className="field-label"><span id={`${id}-type`}>{t("fleetType")}</span><InfoTip label={t("fleetType")} text={t("fleetRentalNote")} /></span>
        <div className="segments device-type" role="group" aria-labelledby={`${id}-type`}>{[false, true].map((rented) => <button key={String(rented)} type="button" className={d.rented === rented ? "selected" : ""} aria-pressed={d.rented === rented} onClick={() => editDevice(d.id, { rented })}>{t(rented ? "rented" : "owned")}</button>)}</div></div>
      {field(t("fleetHours"), d.hoursPerDay, 0, 24, 1, (hoursPerDay) => editDevice(d.id, { hoursPerDay }))}
      {d.rented && <>{field(`${t("hourlyRent")} (${rentCurrency})`, roundRent((d.rentDaily ?? defaultRent) / 24), 0, 100000, .0001, (hourly) => editDevice(d.id, { rentDaily: roundRent(hourly) * 24, rentCurrency, rentFX: rentalRate({ daily: hourly * 24, currency: rentCurrency, fx: d.rentFX ?? (g ? gpuRent(g, ctx).fx : undefined) }, ctx) }))}
        {d.rentDaily != null && <button className="text-button device-default-rent" onClick={() => editDevice(d.id, { rentDaily: null, rentCurrency: undefined, rentFX: undefined })}>{t("useDefaultRent")}</button>}</>}
      <dl className="calculation-lines device-editor-figures"><div><dt>{t("netDay")}</dt><dd className={tone(row?.net ?? null)}>{amount(row?.net ?? null)}</dd></div>{!d.rented && <div><dt>{t("fleetOwnedPower")}</dt><dd>{num(watts, 0)} W</dd></div>}</dl>
      {confirmDelete
        ? <div className="device-delete-confirm" role="group" aria-label={t("fleetDeleteDevice")}><button className="danger" onClick={() => { setEditing(null); setConfirmDelete(false); editDevice(d.id, { deleted: true }); }}><Icon name="delete" />{t("delete")}</button><button onClick={() => setConfirmDelete(false)}>{t("cancel")}</button></div>
        : <button className="danger device-delete" onClick={() => setConfirmDelete(true)}>{t("fleetDeleteDevice")}</button>}
    </div>;
  };

  const gpuDetail = <div className="gpu-detail-form">
    {wide && <h3>{detail.g.name}</h3>}
    <dl className="calculation-lines">
      <div><dt>{t("hashrate")}</dt><dd>{hashrate(detail.g.th * 1e12, state.lang)}</dd></div>
      <div><dt>{t("fleetGPUPower")}</dt><dd>{num(detail.g.watts, 0)} W</dd></div>
      <div><dt className="field-label">{t("fleetPrice")}<InfoTip label={t("fleetPrice")} text={t("referenceNote")} /></dt><dd>{amount(detail.g.price)}</dd></div>
    </dl>
    <h4>{t("owned")}</h4>
    <dl className="calculation-lines">
      <div className="gpu-detail-key"><dt>{t("ownedNet")}</dt><dd className={tone(detail.ownNet)}>{amount(detail.ownNet)}<small className="fleet-unit">{perDay}</small></dd></div>
      <div><dt>{t("fleetYield")}</dt><dd><PRLAmount lang={state.lang} value={detail.daily} /></dd></div>
      <div><dt>{t("fleetGross")}</dt><dd>{amount(detail.gross)}<small className="fleet-unit">{perDay}</small></dd></div>
      <div><dt>{t("fleetAfterFee")}</dt><dd>{amount(detail.rev)}<small className="fleet-unit">{perDay}</small></dd></div>
      <div><dt>{t("fleetPowerCost")}</dt><dd>{amount(detail.power)}<small className="fleet-unit">{perDay}</small></dd></div>
      <div><dt className="field-label">{t("net30")}{growth !== 0 && <InfoTip label={t("net30")} text={slots(t("fleetGrowthDecay"), num(growth, 0))} />}</dt><dd className={tone(detail.net30)}>{amount(detail.net30)}</dd></div>
      <div><dt>{t("net90")}</dt><dd className={tone(detail.net90)}>{amount(detail.net90)}</dd></div>
    </dl>
    <div className="gpu-rent-head"><h4>{t("rented")}</h4>{settings.rentEnabled && detail.rentNet != null && <span className={detail.rentNet > 0 ? "positive" : "muted"}>{t(detail.rentNet > 0 ? "rentalWorth" : "rentalNotWorth")}</span>}</div>
    <dl className="calculation-lines"><div className="gpu-detail-key"><dt>{t("fleetBreakEvenRent")}</dt><dd>{amount(detail.breakEvenRent)}<small className="fleet-unit">{perHour}</small></dd></div></dl>
    {settings.rentEnabled && <>
      {field(`${t("hourlyRent")} (${rentalCurrency})`, roundRent(rental.daily / 24), 0, 125, .0001, (hourly) => setRent(detail.g.name, hourly))}
      {check(t("rentPower"), input.rentCoversPower, (rentCoversPower) => setInput({ rentCoversPower }))}
      <dl className="calculation-lines">
        <div className="gpu-detail-key"><dt>{t("rentalNet")}</dt><dd className={tone(detail.rentNet)}>{amount(detail.rentNet)}<small className="fleet-unit">{perDay}</small></dd></div>
        <div><dt>{t("fleetRent")}</dt><dd>{amount(detail.rent)}<small className="fleet-unit">{perDay}</small></dd></div>
        <div><dt>{t("fleetReturn")}</dt><dd>{num(detail.roi, 0)}%</dd></div>
        <div><dt>{t("fleetBreakEvenPrice")}</dt><dd>{amount(detail.breakEvenPrice)} / PRL</dd></div>
        <div><dt>{t("fleetBreakEvenNetwork")}</dt><dd>{detail.breakEvenNetwork == null ? "—" : hashrate(detail.breakEvenNetwork, state.lang)}</dd></div>
      </dl>
    </>}
  </div>;

  return <div className={only ? "fleet-page fleet-only" : "fleet-page"}>
    <nav hidden={!!only} className="fleet-nav" role="tablist" aria-label={t("calculator")} onKeyDown={(e) => {
      const index = panels.indexOf(panel);
      const next = e.key === "ArrowRight" ? panels[(index + 1) % panels.length] : e.key === "ArrowLeft" ? panels[(index + panels.length - 1) % panels.length] : e.key === "Home" ? panels[0] : e.key === "End" ? panels[panels.length - 1] : undefined;
      if (!next) return;
      e.preventDefault(); selectPanel(next); document.getElementById(`fleet-tab-${next}`)?.focus();
    }}>{panels.map((name) => <button key={name} id={`fleet-tab-${name}`} role="tab" aria-selected={panel === name} aria-controls={`fleet-${name}`} tabIndex={panel === name ? 0 : -1} onClick={() => selectPanel(name)}>{t(({ overview: "fleetTabOverview", devices: "fleetTabDevices", catalog: "fleetTabGPU", single: "fleetTabSingle" } as const)[name])}</button>)}</nav>
    <section id="fleet-overview" className="fleet-tab-panel" role="tabpanel" aria-labelledby="fleet-tab-overview" hidden={only ? false : panel !== "overview"}>
      {(only || !liveDevices.length) && <div className="fleet-section-head"><h2>{t("myDevices")}</h2>{!liveDevices.length && <button className={only ? undefined : "primary"} onClick={() => { if (only) { pendingPanel = "devices"; onOpenDevices?.(); } else selectPanel("devices"); }}><Icon name="plus" />{t("addDevice")}</button>}</div>}
      <div className="card fleet-hero">{(failed || price?.stale || data?.stale) && <p className="status warn">{t("stale")}</p>}{(ctx.price == null || ctx.unit == null) && <p className="status warn">{t("waitingNetwork")}</p>}
        <div className="fleet-headline"><div className="fleet-primary-result"><h2 className="field-label">{t("fleetEstimate")}<InfoTip label={t("fleetEstimate")} text={t("fleetEstimateNote")} /></h2><strong className="fleet-net">{amount(result.net, false, true)}</strong></div><div className="fleet-key-metrics">
          <div><small>{t("dailyRevenue")}</small><strong>{amount(result.rev)}</strong></div><div><small>{t("dailyCost")}</small><strong>{amount(result.power + result.rent)}</strong><small>{t("dailyPower")} + {t("dailyRent")}</small></div>
        </div></div><div className="fleet-resource-metrics"><div><small>{t("hashrate")}</small><strong>{hashrate(result.hash * 1e12, state.lang)}</strong></div><div><small>{t("grossOutput")}</small><strong><PRLAmount lang={state.lang} value={result.prl} /></strong></div><div><small>{t("deviceCount")} · {t("cards")}</small><strong>{result.count} · {result.cards}</strong><small>{t("owned")} {result.owned} · {t("rented")} {result.rented}</small></div></div>
        {settings.powerBudgetEnabled && result.watts > settings.powerBudgetW && <p className="status warn fleet-power-warning">{t("powerOver").replace("%@", num(result.watts - settings.powerBudgetW, 0))}</p>}
      </div>
      {liveDevices.length > 0 && <div className="fleet-detail-grid"><details className="card actual-income fleet-detail"><summary>{t("actualNet")}<span className="summary-tip" onClick={(e) => e.preventDefault()}><InfoTip label={t("actualNet")} text={t("actualNetNote")} /></span></summary><div className="money-grid"><div><small>{t("recent24h")}</small><strong>{amount(actualNet(received24), false, true)}</strong><small><PRLAmount lang={state.lang} value={received24} /></small></div><div><small>{t("daily7Average")}</small><strong>{amount(actualNet(received7 == null ? null : received7 / 7), false, true)}</strong><small><PRLAmount lang={state.lang} value={received7 == null ? null : received7 / 7} /></small></div></div>
        {addresses.length === 0 && <p className="muted">{t("noAddressIncome")}</p>}{addresses.length > got24.length && <p className="status warn">{t("partial")}</p>}
        {addresses.map((addr) => <div className="income-address" key={addr}><code title={addr}>{addr.slice(0, 8)}…{addr.slice(-4)}</code><span>{t("recent24h")} · <PRLAmount lang={state.lang} value={incomes[addr]?.h24} /><br />{t("recent7d")} · <PRLAmount lang={state.lang} value={incomes[addr]?.d7} /></span></div>)}
        <dl className="calculation-lines"><div><dt>{t("tested")} · {t("perPHDay")}</dt><dd><PRLAmount lang={state.lang} value={measured} /></dd></div><div><dt>{t("theoretical")} · {t("perPHDay")}</dt><dd><PRLAmount lang={state.lang} value={ctx.unit == null ? null : ctx.unit * 1000} /></dd></div><div><dt>{t("efficiency")}</dt><dd>{num(measured != null && ctx.unit != null && ctx.unit > 0 ? measured / (ctx.unit * 1000) * 100 : null, 0)}%</dd></div></dl>
      </details><details className="card fleet-detail"><summary>{t("difficultyProjection")}<span className="summary-tip" onClick={(e) => e.preventDefault()}><InfoTip label={t("difficultyProjection")} text={growthTip} /></span></summary><div className="money-grid"><div><small>{t("net30")}</small><strong>{amount(result.net30, false, true)}</strong></div><div><small>{t("net90")}</small><strong>{amount(result.net90, false, true)}</strong></div></div>
        <p className="fleet-data-line">{growth === 0 ? t("fleetGrowthConstant") : slots(t("fleetGrowthDecay"), num(growth, 0))}</p>
        {settings.selfDilution && <p className="fleet-data-line">{fill(a.dilutionShare, num((1 - result.dilution) * 100, 3), num(result.dilution, 3))}</p>}</details></div>}
    </section>
    <section id="fleet-devices" className="fleet-tab-panel" role="tabpanel" aria-labelledby="fleet-tab-devices" hidden={!!only || panel !== "devices"}>
      {syncError && <p className="status warn">{t("poolSyncPartial")}</p>}
      {!liveDevices.length ? <div className="card fleet-devices-empty">
        <Icon name="workers" />
        {!monitorCount && <p>{t("fleetSyncNeedsMonitor").replace("{page}", ANDROID ? a.myMonitors : t("workers"))}</p>}
        {syncButton("primary")}
        <button onClick={addDevice}><Icon name="plus" />{t("addDevice")}</button>
      </div> : <>
        <div className="card fleet-sum"><div className="fleet-sum-body">
          <div><small>{t("netDay")}</small>
            <div className="fleet-sum-net"><strong className={tone(result.net)}>{amount(result.net, false, true)}</strong><span>{perDay}</span></div></div>
          <dl className="fleet-sum-stats">
            <div><dt>{t("hashrate")}</dt><dd>{hashrate(result.hash * 1e12, state.lang)}</dd></div>
            <div><dt>{t("cards")}</dt><dd>{slots(t("fleetCardCount"), result.cards.toLocaleString(state.lang))}</dd></div>
            {result.watts > 0 && <div><dt>{t("fleetOwnedPower")}</dt><dd>{num(result.watts, 0)} W</dd></div>}
            {result.rent > 0 && <div><dt>{t("dailyRent")}</dt><dd>{amount(result.rent, true)}</dd></div>}
          </dl>
        </div></div>
        <div className="fleet-list-head"><span>{slots(t("fleetUnits"), liveDevices.length.toLocaleString(state.lang))}</span>{syncButton("text-button")}<button className="text-button" aria-label={t("addDevice")} onClick={addDevice}><Icon name="plus" />{t("add")}</button></div>
        <ul className="card device-list" id="fleet-device-list">{liveDevices.map((d) => {
          const row = result.rows.find((r) => r.device.id === d.id)!;
          return <li key={d.id}><button className="device-row" onClick={() => { setConfirmDelete(false); setEditing(d.id); }}>
            <span className="device-row-main"><span className="device-row-name"><strong>{d.name}</strong>{d.rented && <span className="badge">{t("rented")}</span>}</span>
              <small>{d.customPearl != null ? <>{hashrate(d.customPearl * 1e12, state.lang)} · {d.gpu ? d.gpu : <span className="warn-text">{t("fleetNoChip")}</span>}</> : <>{d.gpu} × {d.count}</>}{d.hoursPerDay < 24 && <> · {num(d.hoursPerDay, 1)}h</>}</small></span>
            <span className="device-row-net"><strong className={tone(row.net)}>{amount(row.net, true)}</strong><small>{perDay}</small></span>
            <Icon name="right" />
          </button></li>;
        })}</ul>
      </>}
      {settings.powerBudgetEnabled && <section className="card fleet-power"><div className="card-heading"><h3>{t("cabinetPower")}</h3><strong>{num(result.watts, 0)} / {num(settings.powerBudgetW, 0)} W</strong></div><progress className={result.watts > settings.powerBudgetW ? "over-budget" : ""} value={Math.min(result.watts, settings.powerBudgetW)} max={settings.powerBudgetW} aria-label={t("cabinetPower")} />{result.watts > settings.powerBudgetW && <p className="status warn">{t("powerOver").replace("%@", num(result.watts - settings.powerBudgetW, 0))}</p>}</section>}
      {!only && <Sheet open={!!editingDevice} title={editingDevice?.name || t("newDevice")} done={t("fleetDone")} onClose={() => { setEditing(null); setConfirmDelete(false); }}>{editingDevice && deviceEditor(editingDevice)}</Sheet>}
    </section>
    <section className="fleet-tab-panel fleet-catalog" id="fleet-catalog" role="tabpanel" aria-labelledby="fleet-tab-catalog" hidden={!!only || panel !== "catalog"} ref={catalogBox}>
      <div className="fleet-catalog-bar"><label className="sort-control">{t("sort")}<select value={sort} onChange={(e) => setSort(e.target.value as NonNullable<FleetSettings["sortKey"]>)}>{[["ownNet", "ownedNet"], ["rentNet", "rentalNet"], ["breakEvenRent", "rentLimit"], ["hash", "hashrate"], ["efficiency", "efficiency"]].map(([value, label]) => <option key={value} value={value}>{t(label as TextKey)}</option>)}</select></label></div>
      <div className={wide ? "gpu-split" : undefined}>
        <div className="card gpu-list"><table className="gpu-compare"><thead><tr><th scope="col">{t("cards")}</th><th scope="col">{t("owned")}{perDay}</th>{settings.rentEnabled && <th scope="col">{t("rented")}{perDay}</th>}<th aria-hidden="true" /></tr></thead>
          <tbody>{catalog.map((e) => <tr key={e.g.name} className={wide && selected === e.g.name ? "selected-gpu" : undefined}>
            <th scope="row"><button className="gpu-pick" aria-pressed={wide ? selected === e.g.name : undefined} onClick={() => openGPU(e.g.name)}><strong>{e.g.name}</strong><small>{num(e.g.th)} TH/s · {num(e.g.watts, 0)} W</small></button></th>
            <td className={gain(e.ownNet)}>{amount(e.ownNet, true)}</td>{settings.rentEnabled && <td className={gain(e.rentNet)}>{amount(e.rentNet, true)}</td>}<td aria-hidden="true">{!wide && <Icon name="right" />}</td>
          </tr>)}</tbody></table></div>
        {wide && <div className="card gpu-aside">{gpuDetail}</div>}
      </div>
      {!only && !wide && <Sheet open={gpuSheet} title={detail.g.name} done={t("fleetDone")} onClose={() => setGpuSheet(false)}>{gpuDetail}</Sheet>}
    </section>
    <details className="card fleet-parameters" hidden={panel === "single"}><summary>{t("parameters")}</summary>
      {check(t("cabinetPower"), settings.powerBudgetEnabled, (powerBudgetEnabled) => setSettings({ powerBudgetEnabled }))}
      <div className="calculator-fields">{field(`${t("electricity")} (USD/kWh)`, input.electricity, 0, .5, .005, (electricity) => setInput({ electricity }))}{field(`${t("poolFee")} (%)`, input.fee, 0, 10, .1, (fee) => setInput({ fee }))}{settings.powerBudgetEnabled && field(t("powerBudget"), settings.powerBudgetW, 500, 30000, 100, (powerBudgetW) => setSettings({ powerBudgetW }))}{field(t("syncEfficiency"), settings.syncWPerTH, 0, 5, .1, (syncWPerTH) => setSettings({ syncWPerTH }), t("syncEfficiencyNote"))}</div>
      <div className="form-field"><span className="field-label"><label htmlFor={`${id}-growth`}>{t("monthlyGrowth")}</label><InfoTip label={t("monthlyGrowth")} text={t("fleetGrowthExplain")} /></span><select id={`${id}-growth`} value={settings.growthMode} onChange={(e) => setSettings({ growthMode: e.target.value as FleetSettings["growthMode"] })}><option value="auto">{t("automatic")}</option><option value="manual">{t("manual")}</option></select></div>{settings.growthMode === "manual" ? field(t("monthlyGrowth") + " (%)", input.growth, -20, 200, 1, (growth) => setInput({ growth })) : <p className="fleet-data-line">{num(growth)}%</p>}
      {check(t("fleetSelfDilution"), settings.selfDilution, (selfDilution) => setSettings({ selfDilution }), t("selfDilution"))}{check(t("showRentalColumns"), settings.rentEnabled, (rentEnabled) => setSettings({ rentEnabled }), t("fleetRentColumnsNote"))}
      {code !== "USD" && <>{check(t("fleetAutoRate"), !settings.fxManual, (auto) => setSettings({ fxManual: !auto }), t("autoFX"))}{settings.fxManual ? field(`1 USD = ${code}`, settings.manualFX, Math.max(.0001, liveFx * .5), liveFx * 1.5, Math.max(.0001, liveFx / 200), (manualFX) => setSettings({ manualFX })) : <p className="muted">{rateLine(code, fxRate, state.lang)}{!fx?.rates[code] && <> · {t("fxFallback")}</>}</p>}</>}
    </details>
    <section id="fleet-single" className="fleet-tab-panel single-calculator" role="tabpanel" aria-labelledby="fleet-tab-single" hidden={!!only || panel !== "single"}><Calculator lang={state.lang} value={input} onChange={(calculator) => onState((s) => ({ ...s, calculator, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))} data={data} price={price} failed={failed} t={t} formatMoney={(v) => money(v)} /></section>
  </div>;
}
