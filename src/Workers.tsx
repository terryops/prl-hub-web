import { useState } from "react";
import type { Lang, Stats, WindowName } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { hashrate } from "./format.ts";
import { relativeTime } from "./alertRules.ts";
export function visibleWorkers(workers: Stats["workers"], lang: Lang, expanded: boolean, onlineOnly = false) {
  const collator = new Intl.Collator(lang, { numeric: true });
  const sorted = workers.filter((w) => !onlineOnly || w.online).sort((a, b) => Number(a.online) - Number(b.online) || collator.compare(a.name, b.name));
  return expanded ? sorted : sorted.slice(0, Math.max(12, sorted.filter((w) => !w.online).length));
}
export function WorkerList({ workers, window, lang, t, onlineOnly = false }: { workers: Stats["workers"]; window: WindowName; lang: Lang; t: (k: TextKey) => string; onlineOnly?: boolean }) {
  const [expanded, setExpanded] = useState(false), visible = visibleWorkers(workers, lang, expanded, onlineOnly), count = workers.filter((w) => !onlineOnly || w.online).length;
  return <><div className="worker-list">{visible.map((worker, i) => <div className={`worker-row ${worker.online ? "" : "worker-offline"}`} key={worker.name + i}>
    <span className={worker.online ? "dot up" : "dot down"} /><span className="worker-name">{worker.name}</span>
    <span className="worker-rate">{worker.online ? hashrate(worker.rates[window]) : <span title={worker.last ? new Date(worker.last * 1000).toLocaleString(lang) : undefined}>{t("offline")}{worker.last ? " · " + relativeTime(worker.last, lang) : ""}</span>}</span>
  </div>)}</div>{!count && <p className="muted">{t("noOnlineWorkers")}</p>}{(count > visible.length || expanded) && <button className="worker-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("collapse") : t("showAllWorkers").replace("%@", count.toLocaleString(lang))}</button>}</>;
}
