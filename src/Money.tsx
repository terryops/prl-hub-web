import type { Lang } from "./types.ts";
import { prl, prlNumber } from "./format.ts";

export function Money({ amount, block = false, compact = false, secondaryOnly = false }: { amount: string; block?: boolean; compact?: boolean; secondaryOnly?: boolean }) {
  const [primary, secondary] = amount.replace(/-/g, "−").split(" · ");
  if (secondaryOnly) return secondary ? <span className="money-secondary">≈ {secondary}</span> : null;
  return <span className={`money ${block ? "money-block" : ""} ${primary.startsWith("−") ? "negative" : ""} ${primary === "—" ? "missing-value" : ""}`} title={compact ? amount : undefined}>
    <span className="money-primary">{primary}</span>{secondary && !compact && <span className="money-secondary">≈ {secondary}</span>}
  </span>;
}
export function PRLAmount({ value, lang, signed = false }: { value: number | string | null | undefined; lang: Lang; signed?: boolean }) {
  if (value == null) return <span className="missing-value">—</span>;
  const negative = typeof value === "string" ? BigInt(value) < 0n : value < 0;
  const display = typeof value === "string" ? prl(value, 4, lang) : prlNumber(value, lang);
  const full = typeof value === "string" ? prl(value, 8, lang, false) : prlNumber(value, lang, 8, 8);
  return <span title={`${signed && !negative ? "+" : ""}${full} PRL`} className={negative ? "negative" : undefined}>{signed && !negative ? "+" : ""}{display} <span className="prl-unit">PRL</span></span>;
}
