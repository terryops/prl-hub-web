// The website's 交易 page: the Android tab's market (TradeTab.tsx MarketCard, TradeDepthChart.tsx, VolumeShareSection)
// for SafeTrade and Gate PEARL/USDT, read-only. With no Android shell to sign requests, the store reads only the
// exchanges' public endpoints, straight from the browser (trade-fetch.ts); placing orders opens the exchange or the app.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./Icons.tsx";
import type { LiveTicker } from "./android-live.ts";
import type { TextKey } from "./i18n/index.ts";
import type { Lang } from "./types.ts";
import { EXCHANGE_LABELS, type TradeExchange } from "./safetrade.ts";
import { GATE_WEB_TRADE_URL } from "./gate.ts";
import { tradeStore, useTradeStore } from "./trade-store.ts";
import { tradeTextFrom } from "./trade-i18n.ts";
import copy from "virtual:trade-web-copy";
import { DepthSection } from "./TradeDepthChart.tsx";
import { VolumeShareSection } from "./VolumeShareSection.tsx";
import { FullScreenChart, MarketCard, useTradeZoom, type MarketHost } from "./TradeTab.tsx";
import "./trade.css";
import "./trade-web.css";

const EXCHANGES: readonly TradeExchange[] = ["safetrade", "gate"];
const TRADE_URLS: Record<TradeExchange, string> = { safetrade: "https://safetrade.com/exchange/PEARL-USDT", gate: GATE_WEB_TRADE_URL };

export type TradeWebProps = {
  lang: Lang; t: (key: TextKey) => string; pro: boolean; live: LiveTicker;
  /** On screen (the page is open and no panel covers it): only then does it poll. */
  visible: boolean;
  /** The website's 5-second auto-refresh setting. */
  autoRefresh: boolean;
  onPro(): void; onAlerts(): void; onApp(): void;
};

export default function TradeWeb({ lang, t, pro, live, visible, autoRefresh, onPro, onAlerts, onApp }: TradeWebProps) {
  const store = tradeStore(), s = useTradeStore(store), tr = useMemo(() => tradeTextFrom(copy, lang), [lang]);
  store.setText(tr);
  const { zoom, setZoom } = useTradeZoom();
  const [fullScreen, setFullScreen] = useState(false);
  const host: MarketHost = { lang, t, pro, live, onPro };

  // Catch up on coming into view or back to the tab, then keep the price fresh every 5 s (the auto-refresh setting).
  useEffect(() => {
    if (!visible) return;
    void store.refreshIfStale();
    const timer = autoRefresh ? setInterval(() => { if (!document.hidden) void store.refreshTickerOnly(); }, 5000) : undefined;
    const back = () => { if (!document.hidden) void store.refreshIfStale(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", back); };
  }, [visible, autoRefresh, s.exchange]);
  useEffect(() => {
    if (!fullScreen) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setFullScreen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [fullScreen]);
  const onDepthVisible = useCallback((v: boolean) => store.setWantsDepthChart(v && pro), [pro]);
  const name = EXCHANGE_LABELS[s.exchange];

  return <div className="trade-tab trade-web">
    <div className="segments trade-web-exchanges" role="tablist" aria-label={tr("交易所")}>
      {EXCHANGES.map((ex) => <button key={ex} type="button" role="tab" aria-selected={s.exchange === ex} className={s.exchange === ex ? "selected" : ""}
        onClick={() => store.setExchange(ex)}>{EXCHANGE_LABELS[ex]}</button>)}
    </div>
    <div className="trade-columns">
      <div className="trade-main">
        <MarketCard store={store} tr={tr} host={host} zoom={zoom} setZoom={setZoom} onFullScreen={() => setFullScreen(true)} />
        <DepthSection depth={s.depth} stale={s.depthStale} pro={pro} tr={tr} lang={lang} onVisible={onDepthVisible} onUnlock={onPro} />
      </div>
      <div className="trade-side-col">
        <section className="card trade-card trade-web-order">
          <h2>{tr("下单")}</h2>
          <a className="primary app-download-button" href={TRADE_URLS[s.exchange]} target="_blank" rel="noreferrer">
            {t("tradeOnExchange").replace("%@", name)}<Icon name="external" />
          </a>
          <button type="button" className="app-download-button" onClick={onApp}><Icon name="app" />{t("tradeInApp")}</button>
        </section>
        <button type="button" className="card trade-card trade-promo" onClick={onAlerts}>
          <span className="trade-promo-icon"><Icon name="alerts" /></span>
          <span className="trade-promo-copy"><span><strong>{tr("价格提醒")}</strong>{!pro && <span className="badge trade-pro-badge">{tr("高级版")}</span>}</span></span>
          <Icon name="right" className="trade-web-chevron" />
        </button>
        <VolumeShareSection t={t} activeExchange={s.exchange} onSelectExchange={(ex) => store.setExchange(ex)} />
      </div>
    </div>
    {fullScreen && <FullScreenChart store={store} tr={tr} host={host} zoom={zoom} setZoom={setZoom} onClose={() => setFullScreen(false)} />}
  </div>;
}
