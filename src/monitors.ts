import type { Monitor, Stats, WindowName } from "./types.ts";
export const targetKey = (m: Monitor) => JSON.stringify([m.pool, m.addr, m.acct || ""]);
export const duplicateMonitor = (items: Monitor[], pool: string, addr: string, id?: string) => items.some((m) => !m.deleted && m.id !== id && m.pool === pool && m.addr.toLowerCase() === addr.toLowerCase());
export const enabledMonitors = (items: Monitor[]) => items.filter((m) => !m.deleted && !m.paused);
export const alertMonitors = (items: Monitor[]) => enabledMonitors(items).filter((m) => m.alert);
export const ownAddresses = (items: Monitor[]) => [...new Set(enabledMonitors(items).filter((m) => m.pool !== "F2Pool").map((m) => m.addr))];
export const cleanAddress = (raw: string) => raw.trim().split(/\s+/)[0].toLowerCase();
export function moveIds(ids: string[], id: string, destination: number) {
  const moved = [...ids], from = moved.indexOf(id);
  if (from < 0 || destination < 0 || destination >= moved.length || from === destination) return ids;
  moved.splice(from, 1); moved.splice(destination, 0, id);
  return moved;
}
/// PoolMiner.hr24hRaw falls back through the published averages to live.
export function hashrate24h(s?: Stats) {
  if (!s || s.missing) return 0;
  const sum = (w: keyof Stats["rates"]) => s.workers.reduce((n, x) => n + (x.rates[w] || 0), 0) || s.rates[w] || 0;
  for (const w of [...s.windows].reverse()) { const h = sum(w); if (h > 0) return h; }
  return 0;
}
export const dailyAverage = (h24: number, d7: number) => d7 > 0 ? d7 / (h24 > 0 ? Math.min(7, Math.max(1, d7 / h24)) : 7) : h24;
/// SpeedWindow.nearest: ties choose the fresher published window.
export function nearestWindow(selected: WindowName, available: WindowName[] = []): WindowName {
  const order: WindowName[] = ["live", "m15", "m30", "hour", "h3", "day"], mine = Math.max(0, order.indexOf(selected));
  return [...available].sort((a, b) => Math.abs(order.indexOf(a) - mine) - Math.abs(order.indexOf(b) - mine) || order.indexOf(a) - order.indexOf(b))[0] || "day";
}
