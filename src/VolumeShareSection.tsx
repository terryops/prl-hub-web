// Global 24h trading volume share & liquidity pools card for MarketData (web + Android) and TradeTab (Android).
// Zero inline styles (CSP `style-src 'self'`).
import { useEffect, useState, type PointerEvent } from "react";
import { Icon } from "./Icons.tsx";
import { Skeleton } from "./Skeleton.tsx";
import type { TextKey } from "./i18n/index.ts";
import {
  compactUSD, fetchMarkets, filterMarkets, formatUsdPrice, hitTestVolumeSlice, volumeSlices,
  type MarketFilter, type MarketsSnapshot, type MarketVenue,
} from "./markets.ts";

const SLICE_COUNT = 9;

function sliceIndexForVenue(venue: string, orderedNames: string[], fallbackIndex: number): number {
  if (venue === "_other") return 8;
  const idx = orderedNames.indexOf(venue);
  if (idx >= 0) return idx % 8;
  let hash = 0;
  for (let i = 0; i < venue.length; i++) hash = (hash * 31 + venue.charCodeAt(i)) | 0;
  return Math.abs(hash + fallbackIndex) % 8;
}

export function VolumeShareSection({
  t,
  refresh = 0,
  activeExchange,
  onSelectExchange,
}: {
  t: (k: TextKey) => string;
  refresh?: number;
  activeExchange?: "safetrade" | "gate";
  onSelectExchange?: (exchange: "safetrade" | "gate") => void;
}) {
  const [snapshot, setSnapshot] = useState<MarketsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const [hoveredSliceId, setHoveredSliceId] = useState<string | null>(null);

  const load = (force = false) => {
    setLoading(true);
    void fetchMarkets(force)
      .then((snap) => { if (snap.items.length > 0) setSnapshot(snap); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(false); }, [Math.floor(refresh / 12)]);

  const items = snapshot ? filterMarkets(snapshot.items, filter) : [];
  const slices = snapshot ? volumeSlices(snapshot.items, snapshot.totalVolumeUsd24h) : [];
  const sliceTotal = slices.reduce((sum, s) => sum + Math.max(0, s.volumeUsd), 0);
  const orderedSliceNames = slices.map((s) => s.name);
  const visibleRows = expanded ? items : items.slice(0, 8);
  const sliceLabel = (name: string) => name === "_other" ? t("otherVenues") : name;
  const activeIdx = hoveredSliceId != null ? slices.findIndex((s) => s.id === hoveredSliceId) : -1;
  const activeSlice = activeIdx >= 0 ? slices[activeIdx] : null;
  const activeColorIdx = activeSlice ? (activeSlice.id === "_other" ? 8 : (activeIdx % 8)) : 0;

  const hitFromEvent = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const vx = ((e.clientX - rect.left) / rect.width) * 240;
    const vy = ((e.clientY - rect.top) / rect.height) * 240;
    return hitTestVolumeSlice(vx, vy, slices);
  };

  let offset = 0;

  const renderRowBody = (item: MarketVenue, idx: number, isCurrent: boolean, isInAppSwitch: boolean) => {
    const sIdx = sliceIndexForVenue(item.venue, orderedSliceNames, idx);
    return <>
      <span className={`slice-dot slice-${sIdx % SLICE_COUNT}`} aria-hidden="true" />
      <span className="volume-row-main">
        <span className="volume-row-title">
          <strong>{item.venue}</strong>
          {item.kind === "pool" && <span className="volume-pool-badge">{t("poolBadge")}</span>}
          {isCurrent && <Icon name="check" className="volume-active-icon" />}
        </span>
        <small className="volume-row-meta">
          <span>{item.pair}</span>
          {item.priceUsd != null && item.priceUsd > 0 && <span>{formatUsdPrice(item.priceUsd)}</span>}
          {item.liquidityUsd != null && item.liquidityUsd > 0 && <span>TVL {compactUSD(item.liquidityUsd)}</span>}
        </small>
      </span>
      <span className="volume-row-figures">
        <strong>{compactUSD(item.volumeUsd24h)}</strong>
        <small>{(item.share * 100).toFixed(1)}%</small>
      </span>
      {(isInAppSwitch || item.tradeUrl)
        ? <Icon name={isInAppSwitch ? "change" : "external"} className="volume-row-action" />
        : <span className="volume-row-action" aria-hidden="true" />}
    </>;
  };

  return (
    <section className="card volume-share-card" data-nosnippet>
      <div className="card-heading volume-share-head">
        <h2>{t("volumeAndPools")}</h2>
        <div className="segments" role="tablist" aria-label={t("volumeAndPools")}>
          {([
            ["all", t("all")],
            ["cex", t("exchanges")],
            ["pool", t("liquidityPools")],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {snapshot && snapshot.items.length > 0 ? (
        <>
          {slices.length > 0 && (
            <div className="donut-layout volume-donut-layout">
              <div className="volume-donut-wrap">
                <svg
                  viewBox="0 0 240 240"
                  role="img"
                  aria-label={t("volumeAndPools")}
                  onPointerMove={(e) => {
                    if (e.pointerType === "touch") return;
                    const hit = hitFromEvent(e);
                    setHoveredSliceId((prev) => (prev === (hit?.id ?? null) ? prev : (hit?.id ?? null)));
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "touch") return;
                    setHoveredSliceId(null);
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType !== "touch") return;
                    const hit = hitFromEvent(e)?.id ?? null;
                    setHoveredSliceId((prev) => (hit && prev === hit ? null : hit));
                  }}
                >
                  {slices.map((s, i) => {
                    const normShare = sliceTotal > 0 ? s.volumeUsd / sliceTotal : s.share;
                    const start = offset;
                    offset += normShare;
                    const sIdx = s.id === "_other" ? 8 : (i % 8);
                    const dash = Math.max(0, normShare - 0.003);
                    const isHovered = activeSlice?.id === s.id;
                    const cls = !activeSlice
                      ? "volume-donut-slice"
                      : isHovered
                        ? "volume-donut-slice active"
                        : "volume-donut-slice dimmed";
                    return (
                      <circle
                        key={s.id}
                        className={cls}
                        cx="120"
                        cy="120"
                        r={isHovered ? 91 : 88}
                        fill="none"
                        stroke={`var(--slice-${sIdx})`}
                        strokeWidth={isHovered ? 44 : 38}
                        pathLength="1"
                        strokeDasharray={`${dash} ${1 - dash}`}
                        strokeDashoffset={-start}
                        transform="rotate(-90 120 120)"
                      >
                        <title>{`${sliceLabel(s.name)} · ${(s.share * 100).toFixed(1)}% · ${compactUSD(s.volumeUsd)}`}</title>
                      </circle>
                    );
                  })}
                </svg>
                <div className="volume-donut-center" aria-hidden="true">
                  {activeSlice ? (
                    <>
                      <span className="volume-donut-center-name">
                        <span className={`slice-dot slice-${activeColorIdx}`} />
                        <span>{sliceLabel(activeSlice.name)}</span>
                      </span>
                      <strong className="volume-donut-center-value">{compactUSD(activeSlice.volumeUsd)}</strong>
                      <small className="volume-donut-center-share">{(activeSlice.share * 100).toFixed(1)}%</small>
                    </>
                  ) : (
                    <>
                      <span className="volume-donut-center-caption">{t("globalVolume24h")}</span>
                      <strong className="volume-donut-center-value">{compactUSD(snapshot.totalVolumeUsd24h)}</strong>
                    </>
                  )}
                </div>
              </div>
              <div className="donut-legend">
                {slices.map((s, i) => {
                  const sIdx = s.id === "_other" ? 8 : (i % 8);
                  const label = sliceLabel(s.name);
                  const isHovered = activeSlice?.id === s.id;
                  const rowCls = !activeSlice ? "" : isHovered ? "active" : "dimmed";
                  return (
                    <div
                      key={s.id}
                      className={rowCls}
                      onPointerEnter={(e) => { if (e.pointerType !== "touch") setHoveredSliceId(s.id); }}
                      onPointerLeave={(e) => { if (e.pointerType !== "touch") setHoveredSliceId(null); }}
                      onClick={() => setHoveredSliceId((prev) => (prev === s.id ? null : s.id))}
                    >
                      <span className={`slice-dot slice-${sIdx}`} />
                      <span title={label}>{label}</span>
                      <strong>{(s.share * 100).toFixed(1)}%</strong>
                      <small>{compactUSD(s.volumeUsd)}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="volume-rows">
            {visibleRows.map((item, idx) => {
              const inApp = onSelectExchange && (item.inAppExchange === "safetrade" || item.inAppExchange === "gate")
                ? item.inAppExchange
                : null;
              const isCurrent = !!inApp && activeExchange === inApp;
              if (inApp && onSelectExchange) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={isCurrent ? "volume-row current" : "volume-row"}
                    onClick={() => onSelectExchange(inApp)}
                  >
                    {renderRowBody(item, idx, isCurrent, true)}
                  </button>
                );
              }
              if (item.tradeUrl) {
                return (
                  <a
                    key={item.id}
                    className="volume-row"
                    href={item.tradeUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {renderRowBody(item, idx, false, false)}
                  </a>
                );
              }
              return (
                <div key={item.id} className="volume-row static">
                  {renderRowBody(item, idx, false, false)}
                </div>
              );
            })}
          </div>

          {items.length > 8 && (
            <button type="button" className="text-button volume-expand" onClick={() => setExpanded(!expanded)}>
              {expanded ? t("collapseList") : t("showAllCount").replace("%@", String(items.length))}
            </button>
          )}
        </>
      ) : loading ? (
        <Skeleton label={t("loading")} kind="chart" />
      ) : (
        <div className="volume-empty-row">
          <span className="muted">{t("marketsUnavailable")}</span>
          <button type="button" className="text-button" onClick={() => load(true)}>{t("retry")}</button>
        </div>
      )}
    </section>
  );
}
