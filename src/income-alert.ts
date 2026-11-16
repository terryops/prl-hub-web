// 到账提醒 for the Android app (iOS IncomeAlerts.swift, 2.1.8): one mainnet PRL address, Pro. The Worker
// (prl-hub alerts/src/income-watch.js) reads every new block and pushes when a transaction pays the address, from its
// first confirmation; sends from the address, and the change they return to it, are not income.
//
// Switching it on is what sends the address to the Worker: it rides on this device's push registration
// (`income` in PUT /v1/web/push, next to the price alerts and 掉线提醒); nothing is sent while it is off. Kept on this
// device only: iOS keeps it in iCloud, not in the account configuration the web syncs, and Android has no iCloud.
// Switched off, the address stays here so it can be switched back on. No React or bridge here (test/income-alert.test.ts).
import { isPRLAddress } from "./safetrade.ts";

/** What is kept: the address, the name the push leads with, and whether the alert is on. */
export type IncomeSetting = { addr: string; label: string; on: boolean };
/** The address as the Worker gets it (sanitizeIncome): the label only when there is one. */
export type IncomeWire = { addr: string; label?: string };

export const INCOME_KEY = "pearlhub.incomeAlert";

/** A mainnet PRL address as typed or pasted (spaces, a `pearl:` link, upper case), or null (IncomeAlertStore.normalize). */
export function normalizeIncomeAddress(raw: string): string | null {
  let a = raw.trim().toLowerCase();
  if (a.startsWith("pearl:")) a = a.slice(6);
  const q = a.indexOf("?");
  if (q >= 0) a = a.slice(0, q);
  return isPRLAddress(a) ? a : null;
}

/** One line, and at most 40 UTF-16 units as the Worker keeps it: whole characters are dropped until it fits. */
export function incomeLabel(raw: string) {
  const chars = [...raw.replace(/[\r\n]+/g, " ").trim()];
  while (chars.join("").length > 40) chars.pop();
  return chars.join("");
}

/** The setting for `raw` (replacing whatever was watched), or null when it is not a mainnet address. */
export function incomeSetting(raw: string, label = "", on = true): IncomeSetting | null {
  const addr = normalizeIncomeAddress(raw);
  return addr ? { addr, label: incomeLabel(label), on } : null;
}

/** What the Worker should watch: the address, while its alert is on. */
export const incomeWire = (s: IncomeSetting | null | undefined): IncomeWire | null =>
  !s?.on ? null : s.label ? { addr: s.addr, label: s.label } : { addr: s.addr };

/** A stored setting, or null when it is missing or unreadable. */
export function parseIncome(raw: unknown): IncomeSetting | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.addr !== "string" || normalizeIncomeAddress(o.addr) !== o.addr) return null;
  return { addr: o.addr, label: typeof o.label === "string" ? incomeLabel(o.label) : "", on: o.on !== false };
}

export function readIncome(storage: Pick<Storage, "getItem"> = localStorage): IncomeSetting | null {
  try { return parseIncome(JSON.parse(storage.getItem(INCOME_KEY) || "null")); } catch { return null; }
}

export function writeIncome(s: IncomeSetting | null, storage: Pick<Storage, "setItem" | "removeItem"> = localStorage) {
  try { if (s) storage.setItem(INCOME_KEY, JSON.stringify(s)); else storage.removeItem(INCOME_KEY); } catch { /* This run only. */ }
}

/** An address the user already has here, for the card's menu (IncomeAlertCard.Known). */
export type KnownAddress = { name: string; addr: string; kind: "wallet" | "monitor" };

/** The wallets' main addresses, then the monitors' payout addresses, each once (IncomeAlertCard.knownAddresses).
 *  F2Pool monitors are left out: they are kept as a read-only page link, not an address. */
export function knownAddresses(wallets: { name: string; address: string }[], monitors: { pool: string; addr: string; label: string; deleted?: boolean }[]): KnownAddress[] {
  const seen = new Set<string>(), out: KnownAddress[] = [];
  for (const w of wallets) {
    const addr = normalizeIncomeAddress(w.address);
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push({ name: w.name, addr, kind: "wallet" });
  }
  for (const m of monitors) {
    if (m.deleted || m.pool === "F2Pool") continue;
    const addr = normalizeIncomeAddress(m.addr);
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push({ name: m.label, addr, kind: "monitor" });
  }
  return out;
}

/** The address in short, as iOS shortAddr: the first 10 and the last 6 characters. */
export const shortAddress = (addr: string) => addr.length > 16 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr;

/** The wallets' names and main addresses as last seen unlocked (public addresses only): the wallet locks itself after
 *  five minutes and then lists nothing, while iOS keeps its wallets' addresses readable. */
const WALLETS_KEY = "pearlhub.incomeWallets";
export function readKnownWallets(storage: Pick<Storage, "getItem"> = localStorage): { name: string; address: string }[] {
  try {
    const list = JSON.parse(storage.getItem(WALLETS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((w) => w && typeof w.name === "string" && typeof w.address === "string" && normalizeIncomeAddress(w.address))
      .map((w) => ({ name: w.name as string, address: w.address as string })) : [];
  } catch { return []; }
}
export function writeKnownWallets(list: { name: string; address: string }[], storage: Pick<Storage, "setItem"> = localStorage) {
  try { storage.setItem(WALLETS_KEY, JSON.stringify(list.map(({ name, address }) => ({ name, address })))); } catch { /* This run only. */ }
}
