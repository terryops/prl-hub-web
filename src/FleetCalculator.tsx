import { useEffect, useRef, useState } from "react";
import type { State, Device, Stats, Overview, Price, Income, FleetSettings } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { api } from "./api.ts";
import { alive, fresh } from "./store.ts";
import { enabledMonitors, ownAddresses, targetKey, dailyAverage } from "./monitors.ts";
import { fleet, fleetDefaults, normalizeDevice, normalizeFleet, effectiveGrowth, gpuEconomics, gpuRent, rentalRate, deviceCards, syncDevices, type EconomicsContext } from "./fleet.ts";
import { dual, secondaryCode, rateLine, type FX } from "./currency.ts";
import { hashrate, roundRent } from "./format.ts";
import { Icon } from "./Icons.tsx";
import { Money, PRLAmount } from "./Money.tsx";
import { Calculator } from "./Calculator.tsx";
import gpus from "./gpus.json";
import { scenarioUnit } from "./calculator.ts";

type Translate = (key: TextKey) => string;
const DEVICE_PREVIEW_COUNT = 4;
const panels = ["overview", "devices", "catalog", "single"] as const;
type Panel = typeof panels[number];
export function FleetCalculator({ state, onState, data, price, fx, incomes, failed, t }: {
  state: State; onState: (fn: (s: State) => State) => void; data?: Overview; price?: Price; fx?: FX;
  incomes: Record<string, Income | undefined>; failed?: boolean; t: Translate;
}) {
  const [syncing, setSyncing] = useState(false), [syncError, setSyncError] = useState(false);
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [devicesExpanded, setDevicesExpanded] = useState(false);
  const [panel, setPanel] = useState<Panel>(() => alive(state.devices || []).length ? "overview" : "single");
  const selectPanel = (next: Panel) => { setPanel(next); window.scrollTo(0, 0); };
  const [deviceToReveal, setDeviceToReveal] = useState<string | null>(null);
  const addedDeviceCard = useRef<HTMLElement>(null);
  useEffect(() => {
    // Scroll only after the manually added card is rendered; pool sync preserves the current view.
    if (!deviceToReveal || !addedDeviceCard.current) return;
    addedDeviceCard.current.scrollIntoView({ block: "center" });
    setDeviceToReveal(null);
  }, [state.devices, deviceToReveal]);
  const settings = state.fleetSettings || fleetDefaults(), input = state.calculator;
  const sort = settings.sortKey || "ownNet";
  const selected = gpus.some((g) => g.name === settings.selectedGPU) ? settings.selectedGPU! : "RTX 5070";
  const code = secondaryCode(state.secondary, state.lang) || "USD";
  const liveFx = fx?.rates[code] || settings.manualFX;
  const fxRate = code === "USD" ? 1 : settings.fxManual ? settings.manualFX : liveFx;
  const calcFX: FX | undefined = settings.fxManual && code !== "USD" ? { ok: true, base: "USD", ts: 0, rates: { ...fx?.rates, [code]: fxRate } } : fx;
  const money = (v: number | null) => v == null ? "—" : dual(v, state.secondary, state.lang, calcFX);
  const amount = (v: number | null, compact = false, block = false) => <Money amount={money(v)} compact={compact} block={block} />;
  const num = (v: number | null, digits = 2) => v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(state.lang, { maximumFractionDigits: digits }).replace(/-/g, "−");
  const ctx: EconomicsContext = { input, settings, price: input.price ?? price?.usd ?? null, unit: scenarioUnit(input, data?.network?.prlPerTHDay ?? null, data?.network?.hashrate ?? null), networkHash: input.networkHash ?? data?.network?.hashrate ?? null, code, rate: fxRate, rates: fx?.rates || {} };
  const growth = effectiveGrowth(settings, input, data?.network), result = fleet(state.devices || [], gpus, ctx, growth);
  const liveDevices = alive(state.devices || []), addresses = ownAddresses(state.monitors);
  const visibleDevices = devicesExpanded ? liveDevices : liveDevices.slice(0, DEVICE_PREVIEW_COUNT);
  const addDevice = () => {
    const id = crypto.randomUUID();
    setPanel("devices");
    if (liveDevices.length >= DEVICE_PREVIEW_COUNT) setDevicesExpanded(true);
    setDeviceToReveal(id);
    onState((s) => ({ ...s, devices: [...s.devices || [], { id, updated: fresh(), name: t("newDevice"), gpu: "RTX 5080", count: 1, rented: false, hoursPerDay: 24 }] }));
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
  const field = (label: string, value: number, min: number, max: number, step: number, save: (v: number) => void) => <label className="form-field">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v) && v >= min && v <= max) save(v); }} /></label>;
  const check = (label: string, value: boolean, save: (v: boolean) => void) => <label className="compact-check"><input type="checkbox" className={label === t("rentPower") ? undefined : "switch"} checked={value} onChange={(e) => save(e.target.checked)} />{label}</label>;
  const catalog = gpus.map((g) => gpuEconomics(g, ctx, growth)).sort((a, b) => {
    const value = (e: typeof a) => ({ ownNet: e.ownNet, rentNet: e.rentNet, breakEvenRent: e.breakEvenRent, hash: e.g.th, efficiency: e.efficiency })[sort] ?? -Infinity;
    return value(b) - value(a) || a.g.name.localeCompare(b.g.name);
  });
  const detail = catalog.find((e) => e.g.name === selected)!, rental = gpuRent(detail.g, ctx);
  const rentalCurrency = rental.currency || code;
  return <div className="fleet-page">
    <nav className="fleet-nav" role="tablist" aria-label={t("calculator")} onKeyDown={(e) => {
      const index = panels.indexOf(panel);
      const next = e.key === "ArrowRight" ? panels[(index + 1) % panels.length] : e.key === "ArrowLeft" ? panels[(index + panels.length - 1) % panels.length] : e.key === "Home" ? panels[0] : e.key === "End" ? panels[panels.length - 1] : undefined;
      if (!next) return;
      e.preventDefault(); selectPanel(next); document.getElementById(`fleet-tab-${next}`)?.focus();
    }}>{panels.map((name) => <button key={name} id={`fleet-tab-${name}`} role="tab" aria-selected={panel === name} aria-controls={`fleet-${name}`} tabIndex={panel === name ? 0 : -1} onClick={() => selectPanel(name)}>{t(({ overview: "fleetTabOverview", devices: "fleetTabDevices", catalog: "fleetTabGPU", single: "fleetTabSingle" } as const)[name])}</button>)}</nav>
    <section id="fleet-overview" className="fleet-tab-panel" role="tabpanel" aria-labelledby="fleet-tab-overview" hidden={panel !== "overview"}>
      <div className="card fleet-hero">{(failed || price?.stale || data?.stale) && <p className="status warn">{t("stale")}</p>}{(ctx.price == null || ctx.unit == null) && <p className="status warn">{t("waitingNetwork")}</p>}
        {!liveDevices.length ? <div className="fleet-empty"><h2>{t("noDevices")}</h2><button className="primary" onClick={addDevice}><Icon name="plus" />{t("addDevice")}</button></div> : <>
        <div className="fleet-headline"><div className="fleet-primary-result"><h2>{t("fleetEstimate")}</h2><strong className="fleet-net">{amount(result.net, false, true)}</strong><p className="help">{t("fleetEstimateNote")}</p></div><div className="fleet-key-metrics">
          <div><small>{t("dailyRevenue")}</small><strong>{amount(result.rev)}</strong></div><div><small>{t("dailyCost")}</small><strong>{amount(result.power + result.rent)}</strong><small>{t("dailyPower")} + {t("dailyRent")}</small></div>
        </div></div><div className="fleet-resource-metrics"><div><small>{t("hashrate")}</small><strong>{hashrate(result.hash * 1e12)}</strong></div><div><small>{t("grossOutput")}</small><strong><PRLAmount lang={state.lang} value={result.prl} /></strong></div><div><small>{t("deviceCount")} · {t("cards")}</small><strong>{result.count} · {result.cards}</strong></div></div><p className="fleet-counts muted">{t("owned")} {result.owned} · {t("rented")} {result.rented}</p>
        {settings.powerBudgetEnabled && result.watts > settings.powerBudgetW && <p className="status warn fleet-power-warning">{t("powerOver").replace("%@", num(result.watts - settings.powerBudgetW, 0))}</p>}
        </>}
      </div>
      {liveDevices.length > 0 && <div className="fleet-detail-grid"><details className="card actual-income fleet-detail"><summary>{t("actualNet")}</summary><p className="help">{t("actualNetNote")}</p><div className="money-grid"><div><small>{t("recent24h")}</small><strong>{amount(actualNet(received24), false, true)}</strong><small><PRLAmount lang={state.lang} value={received24} /></small></div><div><small>{t("daily7Average")}</small><strong>{amount(actualNet(received7 == null ? null : received7 / 7), false, true)}</strong><small><PRLAmount lang={state.lang} value={received7 == null ? null : received7 / 7} /></small></div></div>
        {addresses.length === 0 && <p className="muted">{t("noAddressIncome")}</p>}{addresses.length > got24.length && <p className="status warn">{t("partial")}</p>}
        {addresses.map((addr) => <div className="income-address" key={addr}><code title={addr}>{addr.slice(0, 8)}…{addr.slice(-4)}</code><span>{t("recent24h")} · <PRLAmount lang={state.lang} value={incomes[addr]?.h24} /><br />{t("recent7d")} · <PRLAmount lang={state.lang} value={incomes[addr]?.d7} /></span></div>)}
        <dl className="calculation-lines"><div><dt>{t("tested")} · {t("perPHDay")}</dt><dd><PRLAmount lang={state.lang} value={measured} /></dd></div><div><dt>{t("theoretical")} · {t("perPHDay")}</dt><dd><PRLAmount lang={state.lang} value={ctx.unit == null ? null : ctx.unit * 1000} /></dd></div><div><dt>{t("efficiency")}</dt><dd>{num(measured != null && ctx.unit != null && ctx.unit > 0 ? measured / (ctx.unit * 1000) * 100 : null, 0)}%</dd></div></dl>
      </details><details className="card fleet-detail"><summary>{t("difficultyProjection")}</summary><div className="money-grid"><div><small>{t("net30")}</small><strong>{amount(result.net30, false, true)}</strong></div><div><small>{t("net90")}</small><strong>{amount(result.net90, false, true)}</strong></div></div><p className="help">{t("monthlyGrowth")} · {num(growth)}%{settings.growthMode === "auto" && <> · {t("autoGrowthNote")}</>}{settings.selfDilution && <> · {t("selfDilution")} ×{num(result.dilution, 4)}</>}</p></details></div>}
    </section>
    <section id="fleet-devices" className="fleet-tab-panel" role="tabpanel" aria-labelledby="fleet-tab-devices" hidden={panel !== "devices"}><div className="list-toolbar"><h2>{t("myDevices")}{liveDevices.length > DEVICE_PREVIEW_COUNT && <> · {liveDevices.length.toLocaleString(state.lang)}</>}</h2><div className="actions"><button disabled={syncing || !enabledMonitors(state.monitors).length} onClick={() => void sync()}>{syncing ? t("loading") : t("poolSync")}</button><button className="primary" onClick={addDevice}><Icon name="plus" />{t("addDevice")}</button></div></div>
      {syncError && <p className="status warn">{t("poolSyncPartial")}</p>}
      {!liveDevices.length && <p className="muted">{t("noDevices")}</p>}
      <div className="device-grid" id="fleet-device-list">{visibleDevices.map((d) => {
        const g = gpus.find((g) => g.name === d.gpu), row = result.rows.find((r) => r.device.id === d.id)!, defaultRent = g ? gpuRent(g, ctx).daily * (d.customPearl != null ? deviceCards(d, g) : 1) : 0;
        return <section className="card device-card" key={d.id} ref={d.id === deviceToReveal ? addedDeviceCard : undefined}><div className="card-heading"><input className="device-name" aria-label={t("name")} maxLength={128} value={d.name} onChange={(e) => editDevice(d.id, { name: e.target.value })} /><select aria-label={t("owned") + " / " + t("rented")} value={String(d.rented)} onChange={(e) => editDevice(d.id, { rented: e.target.value === "true" })}><option value="false">{t("owned")}</option><option value="true">{t("rented")}</option></select><details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div><button className="danger" onClick={() => editDevice(d.id, { deleted: true })}><Icon name="delete" />{t("delete")}</button></div></details></div>
          <div className="device-fields"><label className="form-field">{t("gpuReference")}<select value={d.gpu} onChange={(e) => editDevice(d.id, { gpu: e.target.value })}>{d.customPearl != null && <option value="">{t("unsetChip")}</option>}{gpus.map((g) => <option key={g.name}>{g.name}</option>)}</select></label>
          {field(t("cards"), d.count, 1, 256, 1, (count) => editDevice(d.id, { count }))}{field(t("hoursDay"), d.hoursPerDay, 0, 24, 1, (hoursPerDay) => editDevice(d.id, { hoursPerDay }))}</div>
          {d.customPearl != null && <p className="help">{t("poolSync")} · 24h {hashrate(d.customPearl * 1e12)}<br />{g ? `≈ ${num(deviceCards(d, g))} × ${g.name}` : t("unsetChipNote")}</p>}
          {d.rented && field(`${t("hourlyRent")} (${d.rentCurrency || (g ? gpuRent(g, ctx).currency : code)})`, roundRent((d.rentDaily ?? defaultRent) / 24), 0, 100000, .0001, (hourly) => editDevice(d.id, { rentDaily: roundRent(hourly) * 24, rentCurrency: d.rentCurrency || (g ? gpuRent(g, ctx).currency : code), rentFX: rentalRate({ daily: hourly * 24, currency: d.rentCurrency || (g ? gpuRent(g, ctx).currency : code), fx: d.rentFX ?? (g ? gpuRent(g, ctx).fx : undefined) }, ctx) }))}
          {d.rented && d.rentDaily != null && <button className="text-button" onClick={() => editDevice(d.id, { rentDaily: null, rentCurrency: undefined, rentFX: undefined })}>{t("useDefaultRent")}</button>}
          <div className="device-total"><small>{t("netDay")}</small><strong className={row.net != null && row.net >= 0 ? "positive" : "negative"}>{amount(row.net)}</strong></div>
        </section>;
      })}</div>{liveDevices.length > DEVICE_PREVIEW_COUNT && <button className="device-expand" aria-controls="fleet-device-list" aria-expanded={devicesExpanded} onClick={() => setDevicesExpanded(!devicesExpanded)}>{t(devicesExpanded ? "collapse" : "showAll")}{!devicesExpanded && <> ({liveDevices.length.toLocaleString(state.lang)})</>}</button>}<p className="help">{t("fleetRentalNote")}</p>
      {settings.powerBudgetEnabled && <section className="card fleet-power"><div className="card-heading"><h3>{t("cabinetPower")}</h3><strong>{num(result.watts, 0)} / {num(settings.powerBudgetW, 0)} W</strong></div><progress className={result.watts > settings.powerBudgetW ? "over-budget" : ""} value={Math.min(result.watts, settings.powerBudgetW)} max={settings.powerBudgetW} aria-label={t("cabinetPower")} />{result.watts > settings.powerBudgetW && <p className="status warn">{t("powerOver").replace("%@", num(result.watts - settings.powerBudgetW, 0))}</p>}</section>}
    </section>
    <section className="card fleet-tab-panel" id="fleet-catalog" role="tabpanel" aria-labelledby="fleet-tab-catalog" hidden={panel !== "catalog"}><div className="card-heading"><h2>{t("gpuCompare")}</h2><label className="sort-control">{t("sort")}<select value={sort} onChange={(e) => setSort(e.target.value as NonNullable<FleetSettings["sortKey"]>)}>{[["ownNet", "ownedNet"], ["rentNet", "rentalNet"], ["breakEvenRent", "rentLimit"], ["hash", "hashrate"], ["efficiency", "efficiency"]].map(([value, label]) => <option key={value} value={value}>{t(label as TextKey)}</option>)}</select></label></div>
      <table className="gpu-table"><thead><tr><th>{t("gpuReference")}</th><th>TH/s</th><th>{t("ownedNet")}</th>{settings.rentEnabled && <><th>{t("rentalNet")}</th><th>{t("rentLimit")}</th></>}<th>{t("efficiency")} TH/W</th></tr></thead><tbody>{catalog.map((e) => <tr key={e.g.name} className={selected === e.g.name ? "selected-gpu" : ""}><th><button className="text-button" onClick={() => setSelected(e.g.name)} aria-pressed={selected === e.g.name}>{e.g.name}</button></th><td data-label="TH/s">{e.g.th}</td><td data-label={t("ownedNet")}>{amount(e.ownNet, true)}</td>{settings.rentEnabled && <><td data-label={t("rentalNet")}>{amount(e.rentNet, true)}</td><td data-label={t("rentLimit")}>{amount(e.breakEvenRent, true)} / h</td></>}<td data-label={t("efficiency")}>{num(e.efficiency, 3)} TH/W</td></tr>)}</tbody></table>
      <div className="gpu-mobile-list">{(catalogExpanded ? catalog : catalog.slice(0, 8)).map((e) => <button key={e.g.name} className={`gpu-mobile-row ${selected === e.g.name ? "selected-gpu" : ""}`} aria-current={selected === e.g.name ? "true" : undefined} onClick={() => setSelected(e.g.name)}>
        <span className="gpu-mobile-heading"><strong>{e.g.name}</strong><span>{t("ownedNet")} {amount(e.ownNet, true)}</span></span>
        <small>{num(e.g.th)} TH/s · {num(e.efficiency, 3)} TH/W{settings.rentEnabled && <> · {t("rentalNet")} {amount(e.rentNet, true)}</>}</small>
      </button>)}{catalog.length > 8 && <button aria-expanded={catalogExpanded} onClick={() => setCatalogExpanded(!catalogExpanded)}>{t(catalogExpanded ? "collapse" : "showAll")}</button>}</div>
      <section className="gpu-detail"><h3>{detail.g.name}</h3><dl className="calculation-lines">{[[t("hashrate"), hashrate(detail.g.th * 1e12)], [t("devicePower"), detail.g.watts + " W"], [t("hardwareCost"), amount(detail.g.price)], [t("grossOutput"), <PRLAmount lang={state.lang} value={detail.daily} />], [t("dailyRevenue"), amount(detail.rev)], [t("dailyPower"), amount(detail.power)], [t("ownedNet"), amount(detail.ownNet)], [t("rentLimit"), <>{amount(detail.breakEvenRent)} / h</>], [t("net30"), amount(detail.net30)], [t("net90"), amount(detail.net90)]].map(([key, value]) => <div key={String(key)}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {settings.rentEnabled && <div className="rental-analysis"><div className="card-heading"><h3>{t("rentalAnalysis")}</h3><span className={detail.rentNet != null && detail.rentNet > 0 ? "positive" : "negative"}>{detail.rentNet == null ? "—" : <><Icon name={detail.rentNet > 0 ? "check" : "close"} />{t(detail.rentNet > 0 ? "rentalWorth" : "rentalNotWorth")}</>}</span></div>{field(`${t("hourlyRent")} (${rentalCurrency})`, roundRent(rental.daily / 24), 0, 125, .0001, (hourly) => setRent(detail.g.name, hourly))}{check(t("rentPower"), input.rentCoversPower, (rentCoversPower) => setInput({ rentCoversPower }))}<dl className="calculation-lines"><div><dt>{t("dailyRent")}</dt><dd>{amount(detail.rent)}</dd></div><div><dt>{t("rentalNet")}</dt><dd>{amount(detail.rentNet)}</dd></div><div><dt>{t("roi")}</dt><dd>{num(detail.roi)}%</dd></div><div><dt>{t("safetyPrice")}</dt><dd>{amount(detail.breakEvenPrice)} / PRL</dd></div><div><dt>{t("safetyNetwork")}</dt><dd>{detail.breakEvenNetwork == null ? "—" : hashrate(detail.breakEvenNetwork)}</dd></div></dl></div>}
      </section><p className="help">{t("referenceNote")}</p>
    </section>
    <details className="card fleet-parameters" hidden={panel === "single"}><summary>{t("parameters")}</summary>
      {check(t("cabinetPower"), settings.powerBudgetEnabled, (powerBudgetEnabled) => setSettings({ powerBudgetEnabled }))}
      <div className="calculator-fields">{field(`${t("electricity")} (USD/kWh)`, input.electricity, 0, .5, .005, (electricity) => setInput({ electricity }))}{field(`${t("poolFee")} (%)`, input.fee, 0, 10, .1, (fee) => setInput({ fee }))}{settings.powerBudgetEnabled && field(t("powerBudget"), settings.powerBudgetW, 500, 30000, 100, (powerBudgetW) => setSettings({ powerBudgetW }))}{field(t("syncEfficiency"), settings.syncWPerTH, 0, 5, .1, (syncWPerTH) => setSettings({ syncWPerTH }))}</div>
      <label className="form-field">{t("monthlyGrowth")}<select value={settings.growthMode} onChange={(e) => setSettings({ growthMode: e.target.value as FleetSettings["growthMode"] })}><option value="auto">{t("automatic")}</option><option value="manual">{t("manual")}</option></select></label>{settings.growthMode === "manual" ? field(t("monthlyGrowth") + " (%)", input.growth, -20, 200, 1, (growth) => setInput({ growth })) : <p>{num(growth)}% · {t("autoGrowthNote")}</p>}
      {check(t("selfDilution"), settings.selfDilution, (selfDilution) => setSettings({ selfDilution }))}{check(t("showRentalColumns"), settings.rentEnabled, (rentEnabled) => setSettings({ rentEnabled }))}
      {code !== "USD" && <>{check(t("autoFX"), !settings.fxManual, (auto) => setSettings({ fxManual: !auto }))}{settings.fxManual ? field(`1 USD = ${code}`, settings.manualFX, Math.max(.0001, liveFx * .5), liveFx * 1.5, Math.max(.0001, liveFx / 200), (manualFX) => setSettings({ manualFX })) : <p className="muted">{rateLine(code, fxRate, state.lang)}{!fx?.rates[code] && <> · {t("fxFallback")}</>}</p>}</>}
      <p className="help">{t("syncEfficiencyNote")}</p>
    </details>
    <section id="fleet-single" className="fleet-tab-panel single-calculator" role="tabpanel" aria-labelledby="fleet-tab-single" hidden={panel !== "single"}><Calculator lang={state.lang} value={input} onChange={(calculator) => onState((s) => ({ ...s, calculator, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))} data={data} price={price} failed={failed} t={t} formatMoney={(v) => money(v)} /></section>
  </div>;
}
