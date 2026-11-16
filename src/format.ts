import type { Lang, Stats, WindowName } from "./types.ts";
export function prl(value: string, digits = 8, lang?: Lang, trim = true) {
  const n = BigInt(value),
    neg = n < 0n,
    v = neg ? -n : n;
  const fraction = (v % 100000000n)
    .toString()
    .padStart(8, "0")
    .slice(0, digits);
  const decimal = trim ? fraction.replace(/0+$/, "") : fraction;
  return `${neg ? "−" : ""}${lang ? (v / 100000000n).toLocaleString(lang) : v / 100000000n}${decimal ? (lang ? (1.1).toLocaleString(lang).replace(/1/g, "") : ".") + decimal : ""}`;
}
export function currencyAmount(value: number, symbol: string, lang: Lang = "en", digits = 2, maxDigits = digits) {
  if (!Number.isFinite(value)) return "—";
  return `${value < 0 ? "−" : ""}${symbol}${Math.abs(value).toLocaleString(lang, {
    minimumFractionDigits: digits,
    maximumFractionDigits: maxDigits,
  })}`;
}
export const dollars = (value: string, price: number, lang: Lang = "en") =>
  currencyAmount(Number(BigInt(value)) / 1e8 * price, "$", lang);
export const usd = (x: number, lang: Lang = "en") => currencyAmount(x, "$", lang, 2, 4);
export const roundRent = (value: number) => Number(value.toFixed(4));
export const change = (x: number | null | undefined) =>
  x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%`;
/// The largest unit `x` H/s reaches, and its size in H/s.
export function hashUnit(x: number): [string, number] {
  for (const unit of [
    ["EH/s", 1e18],
    ["PH/s", 1e15],
    ["TH/s", 1e12],
    ["GH/s", 1e9],
    ["MH/s", 1e6],
    ["kH/s", 1e3],
  ] as [string, number][])
    if (x >= unit[1]) return unit;
  return ["H/s", 1];
}
export function hashrate(x: number | undefined, lang?: Lang): string {
  if (x == null) return "—";
  const [u, n] = hashUnit(x);
  if (n === 1) return `${Math.round(x)} H/s`;
  return `${lang ? (x / n).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (x / n).toFixed(2)} ${u}`;
}
export function rate(s: Stats, w: WindowName) {
  const sum = s.workers.reduce((n, x) => n + (x.rates[w] || 0), 0);
  return sum > 0 ? sum : s.rates[w] || 0;
}
export function f2ref(raw: string) {
  const found = raw
    .match(/(?:https?:\/\/)?[a-z0-9.-]*f2pool\.com\/[^\s]+/i)?.[0]
    .replace(/[。，、）)\]》」』.,;]+$/, "");
  if (!found) return null;
  try {
    const u = new URL(/^https?:/i.test(found) ? found : "https://" + found);
    if (!(u.hostname === "f2pool.com" || u.hostname.endsWith(".f2pool.com")))
      return null;
    const parts = u.pathname.split("/");
    const i = parts.findIndex((x) => x.startsWith("mining-user"));
    const key =
      i < 0
        ? undefined
        : parts.slice(i + 1).find((x) => /^[0-9a-f]{16,64}$/i.test(x));
    const acct = (u.searchParams.get("user_name") || "").trim();
    return key && acct.length <= 64 ? { addr: key.toLowerCase(), acct } : null;
  } catch {
    return null;
  }
}

export const prlNumber = (v: number | null | undefined, lang: Lang, digits = 4, minimumDigits = 0) => v == null || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(lang, { minimumFractionDigits: minimumDigits, maximumFractionDigits: digits })}`;
export const difficulty = (v: number | null | undefined, lang: Lang) => v == null ? "—" : (v / 1e6).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "M";
export const unitYield = (v: number | null | undefined, lang: Lang, day: string) => v == null ? "—" : prlNumber(v * 1000, lang, 2) + ` PRL/PH·${day}`;
