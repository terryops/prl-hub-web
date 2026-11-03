import type { Rule } from "./types.ts";

// The price-alert editor's rules, from the iOS AlertEditorSheet (prl-hub Sources/Settings/AlertEditorSheet.swift).
export const cents = (v: number) => Math.round(v * 100) / 100;
export const number = (s: string) => { const n = Number(s.trim().replace(",", ".")); return s.trim() && Number.isFinite(n) ? n : null; };
// Digits and one separator, at most 2 decimals (AlertEditorSheet.limitDecimals).
export function limitDecimals(s: string) {
  let out = "", sep = false, frac = 0;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") { if (sep) { if (frac >= 2) continue; frac++; } out += ch; }
    else if ((ch === "." || ch === ",") && !sep) { sep = true; out += ch; }
  }
  return out;
}
export const usd = (v: number) => `$${v.toFixed(2)}`;

/// An unchanged target keeps its direction even if the market crossed it; a new one is "above" when it is
/// over the current price. A target equal to the current price (to the cent) is refused.
export function priceRule(target: number, current: number | undefined, existing?: Rule | null, reach = false): { kind: "above" | "below" | "reach"; value: number } | null {
  const t = cents(target);
  if (!(t >= 0.01 && t < 1_000_000)) return null;
  if (existing && existing.kind !== "move" && (reach ? existing.kind === "reach" : existing.kind !== "reach") && t === existing.value) return { kind: existing.kind, value: t };
  if (current != null && t === cents(current)) return null;
  if (reach) return { kind: "reach", value: t };
  return { kind: current == null || t > current ? "above" : "below", value: t };
}

