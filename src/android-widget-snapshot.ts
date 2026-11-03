import { rate } from "./format.ts";
import { nearestWindow, targetKey } from "./monitors.ts";
import type { Monitor, Stats } from "./types.ts";

type Snapshot = { data?: Stats & { ts?: number }; target?: string; at?: number; failed?: boolean };

function sourceTime(snapshot?: Snapshot) {
  if (!snapshot?.data || typeof snapshot.at !== "number" || !Number.isFinite(snapshot.at) || snapshot.at <= 0) return 0;
  const ts = snapshot.data.ts;
  if (ts === undefined) return snapshot.at;
  return typeof ts === "number" && Number.isSafeInteger(ts) && ts > 0 && ts * 1000 <= snapshot.at + 60_000 ? ts * 1000 : 0;
}

/** Pool figures carry the time they were read, independent of price, language and theme updates. */
export function widgetPoolSnapshot(monitors: Monitor[], stats: Record<string, Snapshot>) {
  const snapshots = monitors.map((m) => stats[m.id]?.target === targetKey(m) ? stats[m.id] : undefined);
  const times = snapshots.map(sourceTime);
  const poolsAt = times.length && times.every((at) => at > 0) ? Math.floor(Math.min(...times) / 1000) : 0;
  const pools = monitors.flatMap((m, i) => {
    const data = snapshots[i]?.data;
    if (!data || data.missing) return [];
    // WidgetData.parseMonitor normalizes these fields before constructing its private cache key.
    const monitorKey = [m.pool.trim().slice(0, 40), m.addr.trim().slice(0, 200), (m.acct || "").trim().slice(0, 64)].join("|");
    return [{ label: m.label, pool: m.pool, hashrate: rate(data, nearestWindow("live", data.windows)),
      online: data.workers.filter((w) => w.online).length, total: data.workers.length, monitorKey }];
  });
  return { pools, poolsAt };
}
