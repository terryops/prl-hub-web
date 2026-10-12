import type { Lang } from "./types.ts";
import { currencyAmount } from "./format.ts";
export const currencies = [
  ["CNY", "¥", 2], ["TWD", "NT$", 0], ["HKD", "HK$", 2], ["RUB", "₽", 2],
  ["VND", "₫", 0], ["IDR", "Rp", 0], ["EUR", "€", 2], ["JPY", "¥", 0],
  ["KRW", "₩", 0], ["GBP", "£", 2], ["SGD", "S$", 2], ["AUD", "A$", 2], ["CAD", "C$", 2], ["BRL", "R$", 2], ["TRY", "₺", 2], ["INR", "₹", 2], ["THB", "฿", 2],
] as const;
export type FX = { ok: boolean; ts: number; base: "USD"; rates: Record<string, number>; stale?: boolean };
export const secondaryCode = (pref: string | undefined, lang: Lang) => pref == null || pref === "__auto__" ? ({ en: "", "zh-Hans": "CNY", "zh-Hant": "TWD", ru: "RUB", vi: "VND", id: "IDR", es: "EUR", "pt-BR": "BRL", fr: "EUR", de: "EUR", it: "EUR", tr: "TRY", ja: "JPY", ko: "KRW", hi: "INR", th: "THB" }[lang]) : pref;
export function dual(usd: number, pref: string | undefined, lang: Lang, fx?: FX) {
  if (!Number.isFinite(usd)) return "—";
  const primary = currencyAmount(usd, "$", lang), c = currencies.find(([code]) => code === secondaryCode(pref, lang)), rate = c && fx?.rates[c[0]];
  return c && rate != null && Number.isFinite(rate) && rate > 0 ? primary + " · " + currencyAmount(usd * rate, c[1], lang, c[2]) : primary;
}
export const rateLine = (code: string, rate: number, lang: Lang = "en") => `1 USD = ${rate.toLocaleString(lang, { maximumFractionDigits: rate >= 1000 ? 0 : rate >= 20 ? 1 : 2 })} ${code}`;
