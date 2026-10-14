import type {
  State,
  Config,
  Item,
  Lang,
  Monitor,
  Wallet,
  Rule,
  PushWindow,
} from "./types.ts";
import { calculatorDefaults, normalizeCalculator } from "./calculator.ts";
import { currencies } from "./currency.ts";
import { fleetDefaults, normalizeFleet, normalizeDevice } from "./fleet.ts";
import { browserLanguage, langs } from "./preferences.ts";
import { localPurchase } from "./purchase-key.ts";
export { langs } from "./preferences.ts";
export const KEY = "prl.web.v1";
export const pools = [
  "AlphaPool",
  "Lucky Pool",
  "HeroMiners",
  "Pearl Fortune",
  "PearlHash",
  "Kryptex",
  "F2Pool",
];
export const alive = <T extends Item>(items: T[]) =>
  items.filter((x) => !x.deleted);
let lastStamp = 0;
export const fresh = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));
const idOK = (o: unknown): o is Item =>
  !!o &&
  typeof o === "object" &&
  /^[A-Za-z0-9-]{1,64}$/.test((o as Item).id) &&
  Number.isSafeInteger((o as Item).updated) &&
  (o as Item).updated >= 0;
const labelOK = (v: unknown) => typeof v === "string" && v.length <= 40;
export const addrOK = (v: unknown) =>
  typeof v === "string" && /^prl1[0-9a-z]{20,100}$/.test(v);
const monitorOK = (o: Monitor) =>
  idOK(o) &&
  (o.deleted ||
    (pools.includes(o.pool) &&
      labelOK(o.label) &&
      typeof o.alert === "boolean" &&
      [600, 900, 1800, 3600].includes(o.after) &&
      (o.pool === "F2Pool"
        ? /^[0-9a-f]{16,64}$/.test(o.addr) &&
          (o.acct == null ||
            (typeof o.acct === "string" && o.acct.length <= 64))
        : addrOK(o.addr))));
const walletOK = (o: Wallet) =>
  idOK(o) && (o.deleted || (addrOK(o.addr) && labelOK(o.label)));
const ruleOK = (o: Rule) =>
  idOK(o) &&
  (o.deleted ||
    (["above", "below", "move"].includes(o.kind) &&
      Number.isFinite(o.value) &&
      o.value >= (o.kind === "move" ? 0.5 : 0.01) &&
      o.value < (o.kind === "move" ? 1000.01 : 1e6) &&
      (o.kind === "move"
        ? [300, 3600, 86400].includes(o.window)
        : o.window === 0) &&
      typeof o.enabled === "boolean" &&
      Number.isFinite(o.seen_fired) &&
      (o.repeat == null || typeof o.repeat === "boolean")));
export function normalizeConfig(o: Partial<Config>): Config {
  if (!o || typeof o !== "object") throw new Error("invalid_config");
  const take = <T>(
    xs: T[] | undefined,
    valid: (x: T) => unknown,
    limit: number,
  ): T[] => {
    // Tombstones do not count toward the live-item limits. Ciphertext bytes
    // are bounded by syncConfig/the server; a long deletion history stays local.
    if (!Array.isArray(xs) || xs.some((x) => !valid(x)))
      throw new Error("invalid_config");
    const items = [...new Map(xs.map((x) => [(x as Item).id, x])).values()];
    if (alive(items as Item[]).length > limit) throw new Error("config_limit");
    return items;
  };
  const w = o.window;
  const order = o.monitorOrder;
  if (order != null && (!Array.isArray(order.ids) || order.ids.some((id) => typeof id !== "string") || !Number.isSafeInteger(order.updated) || order.updated < 0)) throw new Error("invalid_config");
  if (o.devices != null && !Array.isArray(o.devices)) throw new Error("invalid_config");
  if (
    w != null &&
    (!Number.isInteger(w.start) ||
      !Number.isInteger(w.end) ||
      w.start < 0 ||
      w.end < 0 ||
      w.start >= 1440 ||
      w.end >= 1440 ||
      typeof w.tz !== "string")
  )
    throw new Error("invalid_config");
  return {
    ...o,
    autoRefresh: o.autoRefresh !== false,
    contacts: take(o.contacts ?? [], (c) => idOK(c) && (c.deleted || (typeof c.name === "string" && typeof c.address === "string" && /^(?:t)?prl1[0-9a-z]{20,100}$/.test(c.address) && typeof c.note === "string")), Number.MAX_SAFE_INTEGER),
    theme: ["system", "light", "dark"].includes(o.theme || "") ? o.theme : "system",
    secondary: o.secondary === "" || o.secondary === "__auto__" || currencies.some(([c]) => c === o.secondary) ? o.secondary : "__auto__",
    lang: langs.includes(o.lang as Lang) ? (o.lang as Lang) : browserLanguage(),
    calculator: normalizeCalculator(o.calculator),
    devices: take((o.devices ?? []).map(normalizeDevice), idOK, Number.MAX_SAFE_INTEGER),
    fleetSettings: normalizeFleet(o.fleetSettings),
    settingsUpdated: Number.isSafeInteger(o.settingsUpdated)
      ? o.settingsUpdated!
      : 0,
    monitors: take(o.monitors ?? [], monitorOK, 20),
    wallets: take(o.wallets ?? [], walletOK, 10),
    rules: take(o.rules ?? [], ruleOK, 20),
    window: (w && w.start !== w.end ? w : null) as PushWindow,
  };
}
export function defaults(): State {
  return {
    version: 1,
    purchaseId: localPurchase()?.id || "",
    autoRefresh: true,
    contacts: [],
    devices: [],
    fleetSettings: fleetDefaults(),
    theme: "system",
    secondary: "__auto__",
    calculator: calculatorDefaults(),
    lang: browserLanguage(),
    followBrowserLanguage: true,
    monitors: [],
    wallets: [],
    rules: [],
    window: null,
    settingsUpdated: 0,
    accountId: "",
    token: "",
    sync: false,
  };
}
export function readGuest(): State { return readKey(KEY); }
export function readAccount(id: string): State | null {
  return localStorage.getItem(`${KEY}.account.${id}`) ? { ...readKey(`${KEY}.account.${id}`), accountId: id } : null;
}
export function readStore(): State {
  const id = localStorage.getItem(`${KEY}.active`);
  return id && /^u_[A-Za-z0-9_-]+$/.test(id) ? readAccount(id) || readGuest() : readGuest();
}
function readKey(key: string): State {
  try {
    const o = JSON.parse(localStorage.getItem(key) || "null");
    if (!o || typeof o !== "object") return defaults();
    const state = {
      ...defaults(),
      accountId: key !== KEY && typeof o.accountId === "string" ? o.accountId : "",
      token: typeof o.token === "string" ? o.token : "",
      sync: key !== KEY && o.sync === true,
      ...(o.palette == null ? {} : { palette: o.palette }), ...(o.hashWindow == null ? {} : { hashWindow: o.hashWindow }), ...(o.onlineOnly == null ? {} : { onlineOnly: o.onlineOnly }),
    };
    if (o.version === 1) {
      // Recover each section independently without retaining obsolete login secrets.
      for (const key of ["lang", "calculator", "settingsUpdated", "monitors", "wallets", "rules", "window", "theme", "secondary", "devices", "fleetSettings", "monitorOrder", "autoRefresh", "contacts"] as const) {
        if (key === "monitorOrder" && o[key] == null) continue;
        try { Object.assign(state, { [key]: normalizeConfig({ ...configOf(state), [key]: o[key] })[key] }); }
        catch { /* Keep the default for this section and recover the others. */ }
      }
      // Older saves only have lang; preserve those choices as manual preferences.
      state.followBrowserLanguage = typeof o.followBrowserLanguage === "boolean"
        ? o.followBrowserLanguage : !langs.includes(o.lang);
      if (state.followBrowserLanguage) state.lang = browserLanguage();
    }
    return state;
  } catch {
    return defaults();
  }
}
// Object property order and collection order are not configuration changes.
export function sameConfig(a: Config, b: Config): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
    return value;
  };
  const ordered = (c: Config) => ({ ...c,
    monitors: [...c.monitors].sort((a, b) => a.id.localeCompare(b.id)),
    wallets: [...c.wallets].sort((a, b) => a.id.localeCompare(b.id)),
    rules: [...c.rules].sort((a, b) => a.id.localeCompare(b.id)),
    devices: [...(c.devices || [])].sort((a, b) => a.id.localeCompare(b.id)),
    contacts: [...(c.contacts || [])].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return JSON.stringify(canonical(ordered(a))) === JSON.stringify(canonical(ordered(b)));
}
export const writeStore = (state: State) => {
  const { secret: obsolete, ...safe } = state;
  if (state.accountId) {
    localStorage.setItem(`${KEY}.account.${state.accountId}`, JSON.stringify(safe));
    localStorage.setItem(`${KEY}.active`, state.accountId);
  } else {
    localStorage.setItem(KEY, JSON.stringify(safe));
    localStorage.removeItem(`${KEY}.active`);
  }
};
export const configOf = (state: State): Config => {
  // Explicit allowlists at every level keep wallet credentials and local state out of uploads.
  const pick = (value: unknown, keys: string[]) => Object.fromEntries(Object.entries((value || {}) as object).filter(([k]) => keys.includes(k)));
  const items = (xs: Item[], keys: string[]) => xs.map((x) => pick(x, x.deleted ? ["id", "updated", "deleted"] : ["id", "updated", "deleted", ...keys]));
  return {
    lang: state.lang, settingsUpdated: state.settingsUpdated, autoRefresh: state.autoRefresh,
    window: state.window ? pick(state.window, ["start", "end", "tz"]) : null,
    monitors: items(state.monitors, ["pool", "addr", "acct", "label", "alert", "after", "paused"]),
    wallets: items(state.wallets, ["addr", "label"]),
    rules: items(state.rules, ["kind", "value", "window", "enabled", "seen_fired", "repeat"]),
    contacts: items(state.contacts || [], ["name", "address", "note"]),
    devices: items(state.devices || [], ["name", "gpu", "count", "rented", "hoursPerDay", "customPearl", "rentDaily", "rentCurrency", "rentFX", "sourceKey"]),
    calculator: pick(state.calculator, ["gpu", "count", "th", "watts", "hardware", "hours", "fee", "electricity", "rent", "rented", "rentCoversPower", "growth", "price", "yield", "networkHash"]),
    theme: state.theme, secondary: state.secondary,
    ...(state.monitorOrder ? { monitorOrder: pick(state.monitorOrder, ["ids", "updated"]) } : {}),
    fleetSettings: { ...pick(state.fleetSettings, ["powerBudgetW", "powerBudgetEnabled", "syncWPerTH", "selfDilution", "fxManual", "manualFX", "rentEnabled", "growthMode", "sortKey", "selectedGPU"]),
      rents: Object.fromEntries(Object.entries(state.fleetSettings?.rents || {}).map(([key, rent]) => [key, pick(rent, ["daily", "currency", "fx"])])) },
  } as Config;
};
export function mergeItems<T extends Item>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const x of [...local, ...remote]) {
    const old = map.get(x.id);
    if (
      !old ||
      x.updated > old.updated ||
      (x.updated === old.updated &&
        ((x.deleted && !old.deleted) ||
          (!!x.deleted === !!old.deleted &&
            JSON.stringify(x) > JSON.stringify(old))))
    )
      map.set(x.id, old ? { ...old, ...x } : x);
    else if (old) map.set(x.id, { ...x, ...old });
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function mergeConfig(a: Config, b: Config): Config {
  const settingsKey = (c: Config) => {
    const { monitors, wallets, rules, devices, contacts, monitorOrder, ...settings } = c;
    const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, stable(value)])) : v;
    return JSON.stringify(stable(settings));
  };
  const settings =
    a.settingsUpdated > b.settingsUpdated
      ? a
      : a.settingsUpdated < b.settingsUpdated
        ? b
        : settingsKey(a) >= settingsKey(b)
          ? a
          : b;
  return normalizeConfig({
    ...(settings === a ? b : a),
    ...settings,
    monitorOrder: orderWinner(a.monitorOrder, b.monitorOrder),
    monitors: mergeItems(a.monitors, b.monitors),
    wallets: mergeItems(a.wallets, b.wallets),
    rules: mergeItems(a.rules, b.rules),
    devices: mergeItems(a.devices || [], b.devices || []),
    contacts: mergeItems(a.contacts || [], b.contacts || []),
  });
}

const orderWinner = (a: State["monitorOrder"], b: State["monitorOrder"]) => !a ? b : !b ? a :
  a.updated > b.updated ? a : a.updated < b.updated ? b : JSON.stringify(a) >= JSON.stringify(b) ? a : b;
export function orderedMonitors(c: Config): Monitor[] {
  const ids = c.monitorOrder?.ids || [];
  const rank = (id: string) => { const i = ids.indexOf(id); return i < 0 ? ids.length : i; };
  return alive(c.monitors).sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
export function deepLink(hash: string) {
  const [page, query] = hash.replace(/^#/, "").split("?");
  const addr = new URLSearchParams(query).get("addr");
  return ["wallet", "workers"].includes(page) && addrOK(addr) ? { page, addr: addr as string } : null;
}
