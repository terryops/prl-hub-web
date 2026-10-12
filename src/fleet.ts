import type { Device, FleetSettings, CalculatorInput, Network, Monitor, Stats, RentSetting } from "./types.ts";
import { fresh } from "./store.ts";
import { hashrate24h, enabledMonitors } from "./monitors.ts";

export type GPU = { name: string; th: number; watts: number; price: number; rentDefault: number };
export const fleetDefaults = (): FleetSettings => ({ powerBudgetW: 3000, powerBudgetEnabled: false, syncWPerTH: 1.8, selfDilution: false, fxManual: false, manualFX: 7.2, rentEnabled: true, growthMode: "auto", rents: {} });
export function normalizeFleet(value: unknown): FleetSettings {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) throw new Error("invalid_config");
  const c = { ...fleetDefaults(), ...(value || {}) } as FleetSettings;
  for (const [k, lo, hi] of [["powerBudgetW", 500, 30000], ["syncWPerTH", 0, 5], ["manualFX", .0001, 1e9]] as const) if (!Number.isFinite(c[k]) || c[k] < lo || c[k] > hi) throw new Error("invalid_config");
  for (const k of ["powerBudgetEnabled", "selfDilution", "fxManual", "rentEnabled"] as const) if (typeof c[k] !== "boolean") throw new Error("invalid_config");
  if (!["auto", "manual"].includes(c.growthMode) || !c.rents || typeof c.rents !== "object" || Array.isArray(c.rents)) throw new Error("invalid_config");
  if (c.sortKey != null && !["ownNet", "rentNet", "breakEvenRent", "hash", "efficiency"].includes(c.sortKey)) throw new Error("invalid_config");
  if (c.selectedGPU != null && (typeof c.selectedGPU !== "string" || c.selectedGPU.length > 64)) throw new Error("invalid_config");
  for (const r of Object.values(c.rents)) if (!r || !Number.isFinite(r.daily) || r.daily < 0 || r.daily > 2400000 || typeof r.currency !== "string" || (r.fx != null && (!Number.isFinite(r.fx) || r.fx <= 0))) throw new Error("invalid_config");
  return c;
}
export function normalizeDevice(o: Device): Device {
  if (!o || typeof o !== "object" || !/^[A-Za-z0-9-]{1,64}$/.test(o.id) || !Number.isSafeInteger(o.updated) || o.updated < 0) throw new Error("invalid_config");
  if (o.deleted) return o;
  const d = { name: "", gpu: "RTX 4090", count: 1, rented: false, hoursPerDay: 24, ...(o as Partial<Device>), id: o.id, updated: o.updated } as Device;
  if (typeof d.name !== "string" || d.name.length > 128 || typeof d.gpu !== "string" || d.gpu.length > 64 || !Number.isInteger(d.count) || d.count < 1 || d.count > 256 || typeof d.rented !== "boolean" || !Number.isFinite(d.hoursPerDay) || d.hoursPerDay < 0 || d.hoursPerDay > 24) throw new Error("invalid_config");
  for (const k of ["customPearl", "rentDaily"] as const) if (d[k] != null && (!Number.isFinite(d[k]) || d[k]! < 0 || d[k]! > 1e12)) throw new Error("invalid_config");
  if (d.rentFX != null && (!Number.isFinite(d.rentFX) || d.rentFX <= 0)) throw new Error("invalid_config");
  if (d.sourceKey != null && (typeof d.sourceKey !== "string" || d.sourceKey.length > 1024)) throw new Error("invalid_config");
  return d;
}
export function projection(revenue: number | null, cost: number, growth: number, days: number) {
  if (revenue == null) return null;
  const r = growth / 100 <= -.99 ? 1 : (1 + growth / 100) ** (-1 / 30);
  return revenue * (Math.abs(r - 1) < 1e-12 ? days : (1 - r ** days) / (1 - r)) - cost * days;
}
export function effectiveGrowth(settings: FleetSettings, c: CalculatorInput, n?: Network | null) {
  return settings.growthMode === "auto" && c.price == null && c.yield == null && c.networkHash == null && n?.difficulty && n.difficulty7d ? Math.min(200, Math.max(-20, (n.difficulty / n.difficulty7d - 1) * 30 / 7 * 100)) : c.growth;
}
export type EconomicsContext = { input: CalculatorInput; settings: FleetSettings; price: number | null; unit: number | null; networkHash: number | null; code: string; rate: number; rates: Record<string, number> };
export const rentalRate = (r: RentSetting, ctx: EconomicsContext) => r.currency === "USD" ? 1 : r.currency === ctx.code ? ctx.rate : ctx.rates[r.currency] || r.fx || ctx.rate;
export const gpuRent = (g: GPU, ctx: EconomicsContext): RentSetting => ctx.settings.rents[g.name] || { daily: g.rentDefault, currency: ctx.code };
export const deviceHash = (d: Device, gpu?: GPU) => d.customPearl ?? gpu?.th ?? 0;
export const deviceCards = (d: Device, gpu?: GPU) => d.customPearl != null && gpu?.th ? d.customPearl / gpu.th : d.count;
export const deviceWatts = (d: Device, ctx: EconomicsContext, gpu?: GPU) => d.customPearl != null ? gpu ? Math.max(1, deviceCards(d, gpu)) * gpu.watts : d.customPearl * ctx.settings.syncWPerTH : gpu?.watts || 0;
export function deviceEcon(d: Device, ctx: EconomicsContext, unit: number | null, g?: GPU) {
  const duty = Math.max(0, Math.min(24, d.hoursPerDay)) / 24, prl = unit == null ? null : deviceHash(d, g) * unit * duty;
  const rev = prl != null && ctx.price != null ? prl * ctx.price * (1 - ctx.input.fee / 100) : null;
  const power = d.rented ? 0 : deviceWatts(d, ctx, g) / 1000 * 24 * ctx.input.electricity * duty;
  const rentSetting = g ? gpuRent(g, ctx) : { daily: 0, currency: ctx.code };
  const rent = d.rented ? (d.rentDaily != null ? d.rentDaily / rentalRate({ daily: d.rentDaily, currency: d.rentCurrency || rentSetting.currency, fx: d.rentFX }, ctx) : rentSetting.daily / rentalRate(rentSetting, ctx) * (d.customPearl != null ? deviceCards(d, g) : 1)) * duty : 0;
  return { prl, rev, power, rent, net: rev == null ? null : rev - power - rent };
}
export function fleet(devices: Device[], catalog: GPU[], ctx: EconomicsContext, growth: number) {
  const live = devices.filter((d) => !d.deleted), byName = (name: string) => catalog.find((g) => g.name === name);
  const hash = live.reduce((n, d) => n + deviceHash(d, byName(d.gpu)) * d.count, 0);
  const dilution = ctx.settings.selfDilution && hash > 0 && ctx.networkHash ? ctx.networkHash / (ctx.networkHash + hash * 1e12) : 1;
  const unit = ctx.unit == null ? null : ctx.unit * dilution;
  let cards = 0, owned = 0, rented = 0, watts = 0, power = 0, rent = 0, hardware = 0;
  let prl: number | null = ctx.unit == null ? null : 0, rev: number | null = ctx.price == null || ctx.unit == null ? null : 0;
  const rows = live.map((d) => {
    const g = byName(d.gpu), e = deviceEcon(d, ctx, unit, g), n = d.count;
    cards += n; if (d.rented) rented += n; else { owned += n; watts += deviceWatts(d, ctx, g) * n; hardware += (d.customPearl != null ? deviceCards(d, g) : 1) * (g?.price || 0) * n; }
    power += e.power * n; rent += e.rent * n; if (prl != null && e.prl != null) prl += e.prl * n; if (rev != null && e.rev != null) rev += e.rev * n;
    return { device: d, ...e, net: e.net == null ? null : e.net * n };
  });
  return { count: live.length, cards, owned, rented, hash, dilution, unit, watts, power, rent, hardware, prl, rev, net: rev == null ? null : rev - power - rent, net30: projection(rev, power + rent, growth, 30), net90: projection(rev, power + rent, growth, 90), rows };
}
export function gpuEconomics(g: GPU, ctx: EconomicsContext, growth: number) {
  const daily = ctx.unit == null ? null : g.th * ctx.unit;
  const gross = daily != null && ctx.price != null ? daily * ctx.price : null, rev = gross == null ? null : gross * (1 - ctx.input.fee / 100);
  const power = g.watts / 1000 * 24 * ctx.input.electricity, r = gpuRent(g, ctx), rent = r.daily / rentalRate(r, ctx), extra = ctx.input.rentCoversPower ? 0 : power, cost = rent + extra;
  return { g, daily, gross, rev, power, rent, cost, ownNet: rev == null ? null : rev - power, rentNet: rev == null ? null : rev - cost,
    roi: rev == null ? null : cost > 0 ? (rev - cost) / cost * 100 : 0, breakEvenRent: rev == null ? null : (rev - extra) / 24,
    breakEvenPrice: daily && (1 - ctx.input.fee / 100) > 0 ? cost / (daily * (1 - ctx.input.fee / 100)) : null,
    breakEvenNetwork: rev != null && ctx.networkHash != null ? cost > 0 ? ctx.networkHash * rev / cost : 0 : null,
    net30: projection(rev, power, growth, 30), net90: projection(rev, power, growth, 90), efficiency: g.th / g.watts };
}
const addressKey = (m: Monitor) => m.pool === "F2Pool" ? `https://www.f2pool.com/mining-user/${m.addr}?user_name=${encodeURIComponent(m.acct || "")}`.toLowerCase() : m.addr.toLowerCase();
/// PRLStore.syncFromPools: preserve edits/errors, replace orphaned samples with tombstones.
export function syncDevices(previous: Device[], results: { monitor: Monitor; stats?: Stats; failed?: boolean }[]): Device[] {
  const live = previous.filter((d) => !d.deleted), synced = live.filter((d) => d.customPearl != null), byKey = new Map(synced.filter((d) => d.sourceKey).map((d) => [d.sourceKey!, d])), byName = new Map(synced.map((d) => [d.name, d]));
  const next = live.filter((d) => d.customPearl == null), keys = new Set<string>(), ids = new Set(next.map((d) => d.id));
  for (const { monitor: m, stats: s, failed } of results) {
    if (!enabledMonitors([m]).length) continue;
    const prefix = `${m.pool}|${addressKey(m)}|`;
    if (failed || !s || s.missing) {
      for (const d of synced) if ((d.sourceKey?.startsWith(prefix) || (!d.sourceKey && d.name.startsWith(m.pool + "·"))) && !ids.has(d.id)) { next.push(d); ids.add(d.id); if (d.sourceKey) keys.add(d.sourceKey); }
      continue;
    }
    const workerHash = (w: Stats["workers"][number]) => w.rates.day || w.rates.live || w.rates.m15 || w.rates.m30 || 0;
    const workers = (s.workers || []).filter((w) => workerHash(w) > 0);
    const rows = workers.length ? workers.map((w) => ({ name: m.pool + "·" + w.name, key: prefix + w.name, hash: workerHash(w) / 1e12 })) : hashrate24h(s) > 0 ? [{ name: m.pool + "·" + addressKey(m).slice(-6), key: prefix + "_address", hash: hashrate24h(s) / 1e12 }] : [];
    for (const r of rows) {
      if (keys.has(r.key)) continue;
      keys.add(r.key);
      const old = byKey.get(r.key) || byName.get(r.name);
      const d = { ...(old || { id: crypto.randomUUID(), updated: 0, name: r.name, gpu: "RTX 4090", count: 1, rented: false, hoursPerDay: 24 }), customPearl: r.hash, sourceKey: r.key };
      if (ids.has(d.id)) d.id = crypto.randomUUID();
      if (!d.name.trim()) d.name = r.name;
      if (!old || JSON.stringify({ ...d, updated: old.updated }) !== JSON.stringify(old)) d.updated = Math.max(fresh(), (old?.updated || 0) + 1);
      next.push(d); ids.add(d.id);
    }
  }
  const deleted = previous.filter((d) => d.deleted), removed = synced.filter((d) => !ids.has(d.id)).map((d) => ({ ...d, deleted: true, updated: Math.max(fresh(), d.updated + 1) }));
  return [...deleted, ...removed, ...next];
}
