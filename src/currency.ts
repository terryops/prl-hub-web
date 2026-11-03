import type { Lang } from "./types.ts";
import { currencyAmount } from "./format.ts";
export const currencies = [
  ["CNY", "¥", 2], ["TWD", "NT$", 0], ["HKD", "HK$", 2], ["RUB", "₽", 2],
  ["VND", "₫", 0], ["IDR", "Rp", 0], ["EUR", "€", 2], ["JPY", "¥", 0],
  ["KRW", "₩", 0], ["GBP", "£", 2], ["SGD", "S$", 2], ["AUD", "A$", 2], ["CAD", "C$", 2], ["BRL", "R$", 2], ["TRY", "₺", 2], ["INR", "₹", 2], ["THB", "฿", 2],
] as const;
export type FX = { ok: boolean; ts: number; base: "USD"; rates: Record<string, number>; stale?: boolean };
// Rates move little within a day and the Worker refreshes its table about daily, so the app asks
// at most once a day (as iOS's CurrencyManager) and keeps the last table for offline use.
export const FX_MAX_AGE = 86_400_000;
const FX_KEY = "pearlhub.fx";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const storage = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
export function loadFX(store: Storage | undefined = storage()): { fx: FX; at: number } | undefined {
  try {
    const v = JSON.parse(store?.getItem(FX_KEY) || "null");
    return v && typeof v.at === "number" && v.fx && typeof v.fx.ts === "number" && v.fx.rates && typeof v.fx.rates === "object" ? { fx: { ...v.fx, stale: undefined }, at: v.at } : undefined;
  } catch { return undefined; }
}
export function saveFX(fx: FX, at = Date.now(), store: Storage | undefined = storage()) {
  try { store?.setItem(FX_KEY, JSON.stringify({ fx: { ...fx, stale: undefined }, at })); } catch { /* This run only. */ }
}
export const secondaryCode = (pref: string | undefined, lang: Lang) => pref == null || pref === "__auto__" ? ({ en: "", "zh-Hans": "CNY", "zh-Hant": "TWD", ru: "RUB", vi: "VND", id: "IDR", es: "EUR", "pt-BR": "BRL", fr: "EUR", de: "EUR", it: "EUR", tr: "TRY", ja: "JPY", ko: "KRW", hi: "INR", th: "THB" }[lang]) : pref;
export function dual(usd: number, pref: string | undefined, lang: Lang, fx?: FX) {
  if (!Number.isFinite(usd)) return "—";
  const primary = currencyAmount(usd, "$", lang), c = currencies.find(([code]) => code === secondaryCode(pref, lang)), rate = c && fx?.rates[c[0]];
  return c && rate != null && Number.isFinite(rate) && rate > 0 ? primary + " · " + currencyAmount(usd * rate, c[1], lang, c[2]) : primary;
}
export const rateLine = (code: string, rate: number, lang: Lang = "en") => `1 USD = ${rate.toLocaleString(lang, { maximumFractionDigits: rate >= 1000 ? 0 : rate >= 20 ? 1 : 2 })} ${code}`;
