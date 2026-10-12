export function Skeleton({ label, kind = "card" }: { label: string; kind?: "card" | "chart" | "mini" | "table" | "balance" }) {
  return <div className={`skeleton skeleton-${kind}`} role="status" aria-label={label}><span className="sr-only">{label}</span><span /><span /><span /></div>;
}
