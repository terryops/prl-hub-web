// Android's 交易 tab: SafeTrade PEARL/USDT, a port of the iOS TradeView (prl-hub Sources/Trade/TradeView.swift,
// TradeMarket.swift, TradeOrderForm.swift, TradeDepthChart.swift). The shell signs and sends every SafeTrade
// request (safetrade-client.ts); the state lives in trade-store.ts for the app's life.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./trade-icons.tsx";
import { CandleChart } from "./KLine.tsx";
import { onNative } from "./android.ts";
import type { LiveTicker } from "./android-live.ts";
import type { WalletControl } from "./android-host.ts";
import type { TextKey } from "./i18n/index.ts";
import type { Lang } from "./types.ts";
import {
  BASE, BASE_TICKER, PAIR, affordableAmount, averagePrice, balanceValue, displayPrice, fixed, floorTo, isOpen, lockedValue, parseAmount,
  ruleMessage, ruleProblem, typed, type Order, type Tr,
} from "./safetrade.ts";
import { PERIODS, tradeStore, upsellAfterLimitOrder, upsellAfterRefresh, useTradeStore, type TradeStore } from "./trade-store.ts";
import { tradeText } from "./trade-i18n.ts";
import "./trade.css";
import { DepthSection } from "./TradeDepthChart.tsx";
import { KeyGuide, KeySettings } from "./TradeKeys.tsx";
import { DepositPage, WithdrawPage } from "./TradeFunds.tsx";
import { setTradeBack } from "./trade-nav.ts";
import { AlertDialog, CoinBadge, Processing, Spinner, StatusLines, SubPage, UnverifiedBanner, UntrustedIPCard, popBackLayer, type DialogButton } from "./TradeUI.tsx";

export type TradeHost = {
  lang: Lang; t: (key: TextKey) => string; pro: boolean;
  contacts: { name: string; address: string }[]; addContact(name: string, address: string): void;
  wallet(): WalletControl | undefined; live: LiveTicker; visible: boolean; alertsActive: number;
  onPro(): void; onAlerts(): void; onWallet(): void;
};
// The guide goes back to the page that opened it.
type Sub = { kind: "deposit" | "withdraw"; currency: string } | { kind: "keys" } | { kind: "guide"; from: Sub } | null;
type Alert = { title: string; message?: string; buttons: DialogButton[] } | null;


const ZOOM_KEY = "pearlhub.safetrade.zoom";
const savedZoom = () => { try { const z = Number(localStorage.getItem(ZOOM_KEY)); return z > 0 ? z : null; } catch { return null; } };
const periodLabel = (p: number, tr: Tr) => p === 5 ? tr("5分") : p === 15 ? tr("15分") : p === 60 ? tr("1时") : p === 240 ? tr("4时") : tr("1日");
const orderDate = (ms: number, lang: Lang) => new Date(ms).toLocaleString(lang, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function TradeTab(host: TradeHost) {
  const store = tradeStore(), s = useTradeStore(store), tr = useMemo(() => tradeText(host.lang), [host.lang]);
  store.setText(tr);
  const [sub, setSub] = useState<Sub>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [zoom, setZoomState] = useState<number | null>(savedZoom);
  const setZoom = useCallback((next: number | null | ((z: number | null) => number | null)) => setZoomState((z) => {
    const v = typeof next === "function" ? next(z) : next;
    try { if (v == null) localStorage.removeItem(ZOOM_KEY); else localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* This run only. */ }
    return v;
  }), []);

  useEffect(() => {
    setTradeBack(() => {
      if (alert) { setAlert(null); return true; }
      if (popBackLayer()) return true;
      if (menu) { setMenu(null); return true; }
      if (fullScreen) { setFullScreen(false); return true; }
      if (sub) { closeSub(); return true; }
      return false;
    });
    return () => setTradeBack(undefined);
  });
  const closeSub = () => setSub(sub?.kind === "guide" ? sub.from : null);
  const openGuide = () => setSub({ kind: "guide", from: sub });

  // Catch up on coming into view / back to the foreground, then keep 现价 fresh every 5 s while the market
  // is on screen (not under a 充值 / 提现 / key page).
  const onMain = sub == null;
  useEffect(() => {
    if (!host.visible || !onMain) return;
    void store.refreshIfStale();
    const timer = setInterval(() => { if (!document.hidden) void store.refreshTickerOnly(); }, 5000);
    const back = () => { if (!document.hidden) void store.refreshIfStale(); };
    document.addEventListener("visibilitychange", back);
    const off = onNative("resume", back);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", back); off(); };
  }, [host.visible, onMain]);

  const manualRefresh = async () => {
    await store.refresh();
    if (upsellAfterRefresh(host.pro)) setTimeout(host.onPro, 600);
  };
  const onDepthVisible = useCallback((v: boolean) => store.setWantsDepthChart(v && host.pro), [host.pro]);

  if (sub?.kind === "keys") return <SubPage back={tr("交易")} title={tr("交易（SafeTrade）")} onBack={closeSub}>
    <KeySettings tr={tr} onGuide={openGuide} onChanged={() => void store.keysChanged()} />
  </SubPage>;
  if (sub?.kind === "guide") return <SubPage back={tr("交易")} title={tr("获取 API 密钥")} onBack={closeSub}><KeyGuide tr={tr} /></SubPage>;
  if (sub?.kind === "deposit") return <DepositPage currency={sub.currency} store={store} tr={tr} lang={host.lang} wallet={host.wallet}
    onWallet={host.onWallet} onBack={closeSub} onGuide={openGuide} />;
  if (sub?.kind === "withdraw") return <WithdrawPage currency={sub.currency} store={store} tr={tr} lang={host.lang} wallet={host.wallet}
    contacts={host.contacts} addContact={host.addContact} onBack={closeSub} onGuide={openGuide} />;

  const usdt = store.balance("usdt"), pearl = store.balance(BASE);
  const canMoveFunds = s.hasKeys === true;
  const footer = lockedValue(usdt) > 0 || lockedValue(pearl) > 0;
  const balanceColumn = (name: string, id: string, b: typeof usdt) => {
    const locked = lockedValue(b);
    const figures = <>
      <span className="trade-coin-row"><CoinBadge symbol={name} /><span>{name}</span>{canMoveFunds && <Icon name="chevron" className="trade-coin-chevron" />}</span>
      <strong className={s.balancesCached ? "trade-balance cached" : "trade-balance"}>{b ? balanceValue(b).toFixed(4) : "—"}</strong>
      {footer && <small className={locked > 0 ? "trade-locked" : "trade-locked hidden"} aria-hidden={locked <= 0}>{tr("锁定 {0}", locked.toFixed(4))}</small>}
    </>;
    return <div className="trade-balance-col">
      {canMoveFunds
        ? <button type="button" className="trade-balance-button" aria-haspopup="menu" aria-expanded={menu === id} onClick={() => setMenu(menu === id ? null : id)}>{figures}</button>
        : <div className="trade-balance-button">{figures}</div>}
      {menu === id && <div className="trade-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenu(null); setSub({ kind: "deposit", currency: id }); }}><Icon name="deposit" />{tr("充值")}</button>
        <button type="button" role="menuitem" onClick={() => { setMenu(null); setSub({ kind: "withdraw", currency: id }); }}><Icon name="withdraw" />{tr("提现")}</button>
      </div>}
    </div>;
  };

  const openCount = s.orders.filter(isOpen).length;
  const rows = (() => { const open = s.orders.filter(isOpen), rest = s.orders.filter((o) => !isOpen(o)); return [...open, ...rest.slice(0, Math.max(0, 10 - open.length))]; })();
  const stateLabel = (state?: string) => {
    switch ((state || "").toLowerCase()) {
      case "done": return tr("已成交");
      case "cancel": return tr("已撤销");
      case "reject": return tr("已拒绝");
      case "wait": case "pending": return tr("挂单中");
      default: return state ?? "";
    }
  };
  const askCancel = (o: Order) => setAlert({
    title: tr("撤销订单"),
    message: tr("确认撤销此订单？{0} {1} PEARL @ {2}", o.side === "buy" ? tr("买入") : tr("卖出"), o.originAmount ?? "", displayPrice(o) ?? "—"),
    buttons: [{ label: tr("确认撤单"), kind: "danger", onClick: () => { setAlert(null); void store.cancelOrder(o); } }, { label: tr("取消"), kind: "cancel", onClick: () => setAlert(null) }],
  });
  const ordersCard = s.orders.length > 0 && <section className="card trade-card">
    <div className="trade-title-row"><h2>{tr("我的订单")}</h2><span className="trade-spacer" />{openCount > 0 && <small className="muted">{tr("{0} 笔挂单", String(openCount))}</small>}</div>
    <div className="trade-orders">{rows.map((o, i) => <div key={o.id ?? `row-${i}`} className="trade-order">
      <span className={o.side === "buy" ? "trade-side trade-up" : "trade-side trade-down"} aria-label={o.side === "buy" ? tr("买入") : tr("卖出")}>{o.side === "buy" ? tr("买") : tr("卖")}</span>
      <span className="trade-order-summary"><span>{tr("{0} PEARL @ {1}", o.originAmount ?? "", displayPrice(o) ?? "—")}</span>{o.placedAt && <small>{orderDate(o.placedAt, host.lang)}</small>}</span>
      <span className="trade-order-trailing">{s.cancelingID === o.id ? <Spinner /> : isOpen(o)
        ? <button type="button" className="text-button danger" disabled={s.cancelingID != null} onClick={() => askCancel(o)}>{tr("撤单")}</button>
        : <small className="muted">{stateLabel(o.state)}</small>}</span>
    </div>)}</div>
  </section>;

  const notices = <>
    {s.hasKeys === false && <section className="card trade-card trade-nokey">
      <span className="trade-nokey-icon"><Icon name="warning" /></span>
      <div><strong>{tr("未配置 SafeTrade API 密钥")}</strong><button type="button" className="text-button" onClick={openGuide}>{tr("如何获取 API 密钥")}</button></div>
      <button type="button" className="primary" onClick={() => setSub({ kind: "keys" })}>{tr("添加")}</button>
    </section>}
    {s.ipIssue && <UntrustedIPCard issue={s.ipIssue} tr={tr} onGuide={openGuide} />}
  </>;
  const balances = <section className="card trade-card">
    <div className="trade-title-row"><small className="muted">{tr("余额")}</small><span className="trade-spacer" />{s.accountStale && s.balances.length > 0 && <small className="trade-warn-text"><Icon name="history" />{tr("刷新失败，显示的是上次的数据")}</small>}</div>
    <div className="trade-balances">{balanceColumn("USDT", "usdt", usdt)}<span className="trade-divider" />{balanceColumn(BASE_TICKER, BASE, pearl)}</div>
  </section>;
  const market = <MarketCard store={store} tr={tr} host={host} zoom={zoom} setZoom={setZoom} onFullScreen={() => setFullScreen(true)} />;
  const depth = <DepthSection depth={s.depth} stale={s.depthStale} pro={host.pro} tr={tr} lang={host.lang} onVisible={onDepthVisible} onUnlock={host.onPro} />;
  const promo = <button type="button" className="card trade-card trade-promo" onClick={host.onAlerts}>
    <span className="trade-promo-icon"><Icon name="alerts" /></span>
    <span className="trade-promo-copy"><span><strong>{tr("价格提醒")}</strong>{!host.pro && <span className="badge trade-pro-badge"><Icon name="sparkles" />{tr("高级版")}</span>}</span>
      {host.pro && host.alertsActive > 0 && <small>{tr("{0} 条提醒生效中", host.alertsActive)}</small>}</span>
    <Icon name="chevron" className="android-row-chevron" />
  </button>;
  const orderSection = <>
    {s.unverifiedOrder && <UnverifiedBanner text={tr("上一笔订单的结果还没确认，核对清楚前暂停下单。")} checking={s.verifyingOrder} tr={tr}
      recheck={() => void store.verifyUnverifiedOrder()} dismiss={() => store.dismissUnverifiedOrder()} />}
    <OrderForm store={store} tr={tr} onAsk={setAlert} pro={host.pro} onPro={host.onPro} />
  </>;
  const status = <StatusLines notice={s.lastOrder} errors={[s.error, s.accountError]} />;

  return <div className="trade-tab">
    <header className="page-heading trade-heading"><div className="page-title"><h1>{tr("交易 · SafeTrade")}</h1>
      <button className="icon-button android-refresh" aria-label={tr("刷新")} title={tr("刷新")} disabled={s.refreshing} onClick={() => void manualRefresh()}><Icon name="refresh" className={s.refreshing ? "spin" : undefined} /></button></div></header>
    {notices}
    <div className="trade-columns">
      <div className="trade-main">{balances}{market}{depth}{promo}</div>
      <div className="trade-side-col">{orderSection}{status}{ordersCard}</div>
    </div>
    {fullScreen && <FullScreenChart store={store} tr={tr} host={host} zoom={zoom} setZoom={setZoom} onClose={() => setFullScreen(false)} />}
    <Processing shown={s.placing || (s.refreshing && !s.balances.length && !s.ticker)} tr={tr} />
    {alert && <AlertDialog title={alert.title} message={alert.message} buttons={alert.buttons} onClose={() => setAlert(null)} />}
  </div>;
}

type ZoomProps = { zoom: number | null; setZoom: (next: number | null | ((z: number | null) => number | null)) => void };

/** PEARL/USDT: price and change, the 2×2 high / low / buy / sell grid, the period picker and the K-line. */
function MarketCard({ store, tr, host, zoom, setZoom, onFullScreen }: { store: TradeStore; tr: Tr; host: TradeHost; onFullScreen: () => void } & ZoomProps) {
  const s = useTradeStore(store), t = s.ticker, chg = store.periodChange(), down = (chg ?? "").startsWith("-");
  const live = host.live;
  const cell = (label: string, value?: string) => <span className="trade-ticker-cell"><small>{label}</small><span>{value ?? "—"}</span></span>;
  return <section className="card trade-card trade-market">
    <div className="trade-title-row"><small className="muted">{PAIR}</small><span className="trade-spacer" />
      {live.supported && <button type="button" className={live.running ? "text-button trade-live on" : "text-button trade-live"} disabled={live.busy}
        onClick={() => { if (!host.pro) { host.onPro(); return; } void live.toggle(!live.running); }}>
        {live.running ? <><span className="trade-live-dot" />{tr("盯盘中")}</> : <><Icon name="lock" />{tr("锁屏盯盘")}</>}
      </button>}
    </div>
    <div className="trade-price-row">
      <div className="trade-price"><strong>{t?.last ?? "—"}</strong>{chg && <span className={down ? "trade-down" : "trade-up"}>{chg}</span>}</div>
      <div className="trade-ticker-grid">{cell(tr("高"), t?.high)}{cell(tr("买"), t?.buy)}{cell(tr("低"), t?.low)}{cell(tr("卖"), t?.sell)}</div>
    </div>
    <div className="trade-period-row">
      <PeriodPicker store={store} tr={tr} />
      <button type="button" className="icon-button" aria-label={tr("全屏")} title={tr("全屏")} onClick={onFullScreen}><Icon name="expand" /></button>
    </div>
    {live.error && <p className="trade-warn-text">{live.error}</p>}
    <Candles store={store} tr={tr} host={host} zoom={zoom} setZoom={setZoom} />
  </section>;
}

function PeriodPicker({ store, tr }: { store: TradeStore; tr: Tr }) {
  const s = useTradeStore(store);
  return <div className="android-segments trade-periods" role="tablist" aria-label={tr("周期")}>
    {PERIODS.map((p) => <button key={p} type="button" role="tab" aria-selected={s.period === p} onClick={() => store.setPeriod(p)}>{periodLabel(p, tr)}</button>)}
  </div>;
}

function Candles({ store, tr, host, zoom, setZoom }: { store: TradeStore; tr: Tr; host: TradeHost } & ZoomProps) {
  const s = useTradeStore(store);
  return s.candles.length
    ? <div className="kline-panel trade-kline"><CandleChart candles={s.candles} lang={host.lang} t={host.t} zoom={zoom} onZoom={setZoom} /></div>
    : <p className="chart-empty trade-kline-empty">{tr("加载 K 线…")}</p>;
}

/** The K-line with the whole screen to itself; the price and the period picker above it. */
function FullScreenChart({ store, tr, host, zoom, setZoom, onClose }: { store: TradeStore; tr: Tr; host: TradeHost; onClose: () => void } & ZoomProps) {
  const s = useTradeStore(store), chg = store.periodChange();
  return <div className="trade-fullscreen" role="dialog" aria-label={tr("K 线")}>
    <div className="trade-fullscreen-head">
      <small className="muted">{PAIR}</small><strong>{s.ticker?.last ?? "—"}</strong>
      {chg && <span className={chg.startsWith("-") ? "trade-down" : "trade-up"}>{chg}</span>}
      <span className="trade-spacer" />
      <button type="button" className="icon-button" aria-label={tr("关闭")} title={tr("关闭")} onClick={onClose}><Icon name="contract" /></button>
    </div>
    <PeriodPicker store={store} tr={tr} />
    <Candles store={store} tr={tr} host={host} zoom={zoom} setZoom={setZoom} />
  </div>;
}

/** 下单. Owns the typed fields, so a keystroke re-renders only this card. */
function OrderForm({ store, tr, onAsk, pro, onPro }: { store: TradeStore; tr: Tr; onAsk: (a: Alert) => void; pro: boolean; onPro: () => void }) {
  const s = useTradeStore(store);
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [type, setType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState(""), [volume, setVolume] = useState("");
  useEffect(() => { store.setWantsDepth(type === "market"); }, [type]);
  useEffect(() => () => store.setWantsDepth(false), []);
  const usdt = store.balance("usdt"), pearl = store.balance(BASE), rules = s.rules;
  const volNum = typed(volume), priceNum = typed(price), total = priceNum * volNum, tick = 10 ** -rules.pricePrecision;
  const marketAvg = s.depth ? averagePrice(volNum, side === "buy" ? s.depth.asks : s.depth.bids) : null;
  const marketEstimate = (marketAvg ?? 0) * volNum;
  const maxAmount = (() => {
    if (side === "sell") return balanceValue(pearl);
    const quote = balanceValue(usdt);
    if (type === "market") return s.depth ? affordableAmount(quote, s.depth.asks, tick) : 0;
    const p = priceNum > 0 ? priceNum : Number(s.ticker?.buy) || 0;
    return p > 0 ? quote / p : 0;
  })();
  const maxText = fixed(floorTo(maxAmount, rules.amountPrecision), rules.amountPrecision);
  const problem = ruleProblem(rules, volume, type === "limit" ? price : null);
  const insufficient = side === "sell" ? volNum > balanceValue(pearl) : (type === "limit" ? total : marketEstimate) > balanceValue(usdt);
  const parsed = parseAmount(volume) != null && (type === "market" || parseAmount(price) != null);
  const canOrder = s.hasKeys === true && !s.placing && !s.unverifiedOrder && parsed && volNum > 0 && (type === "market" || priceNum > 0)
    && !problem && !insufficient && (type === "limit" || marketAvg != null);
  const amt = (x: number) => x.toFixed(4);
  const confirmMessage = (side === "buy" ? tr("买入") : tr("卖出")) + tr(" {0} PEARL", volume)
    + (type === "limit" ? tr(" @ {0} USDT（约 {1} USDT）", price, amt(total)) : tr("（市价，约 {0} USDT）", amt(marketEstimate)));
  const note = volNum > 0 && (problem ? <p className="trade-note trade-down">{ruleMessage(problem, tr)}</p>
    : insufficient ? <p className="trade-note trade-down">{side === "sell" ? tr("PEARL 余额不足") : tr("USDT 余额不足")}</p>
    : type === "market" && !s.depth ? <p className="trade-note trade-warn-text">{tr("等待盘口数据后才能下市价单")}</p>
    : type === "market" && marketAvg == null ? <p className="trade-note trade-warn-text">{tr("盘口深度不够，市价单成交不了这么多，请减少数量或改用限价单")}</p> : null);
  const submit = () => {
    const limitPrice = type === "limit" ? price : "";
    void store.placeOrder(side, type, volume, type === "limit" ? price : null).then((result) => {
      if (!result) return;
      setPrice(""); setVolume("");
      // Market orders fill at once: nothing to be told about. Nor is an order that may not exist.
      if (result === "placed" && upsellAfterLimitOrder(pro, limitPrice)) setTimeout(() => onAsk({
        title: tr("成交时通知你？"), message: tr("PRL 到达 {0} USDT 时给你推送通知，也就是这笔限价单大概率成交的时候。价格提醒是高级版功能。", limitPrice),
        buttons: [{ label: tr("解锁高级版"), kind: "primary", onClick: () => { onAsk(null); onPro(); } }, { label: tr("暂不"), kind: "cancel", onClick: () => onAsk(null) }],
      }), 800);
    });
  };
  return <section className="card trade-card trade-form">
    <h2>{tr("下单")}</h2>
    <div className="android-segments trade-two" role="tablist" aria-label={tr("方向")}>
      <button type="button" role="tab" aria-selected={side === "buy"} onClick={() => setSide("buy")}>{tr("买入 PEARL")}</button>
      <button type="button" role="tab" aria-selected={side === "sell"} onClick={() => setSide("sell")}>{tr("卖出 PEARL")}</button>
    </div>
    <div className="android-segments trade-two" role="tablist" aria-label={tr("类型")}>
      <button type="button" role="tab" aria-selected={type === "limit"} onClick={() => setType("limit")}>{tr("限价")}</button>
      <button type="button" role="tab" aria-selected={type === "market"} onClick={() => setType("market")}>{tr("市价")}</button>
    </div>
    {type === "limit" && <label className="trade-field">
      <span className="trade-field-head"><span>{tr("价格 (USDT)")}</span>{s.ticker?.last && <button type="button" className="text-button" onClick={(e) => { e.preventDefault(); setPrice(s.ticker!.last!); }}>{tr("现价 {0}", s.ticker.last)}</button>}</span>
      <input inputMode="decimal" autoComplete="off" placeholder="0.0" value={price} onChange={(e) => setPrice(e.target.value)} aria-label={tr("价格 (USDT)")} />
    </label>}
    <label className="trade-field">
      <span className="trade-field-head"><span>{tr("数量 (PEARL)")}</span>{maxAmount > 0 && <button type="button" className="text-button" onClick={(e) => { e.preventDefault(); setVolume(maxText); }}>{tr("MAX {0}", maxText)}</button>}</span>
      <input inputMode="decimal" autoComplete="off" placeholder="0.0" value={volume} onChange={(e) => setVolume(e.target.value)} aria-label={tr("数量 (PEARL)")} />
    </label>
    {(type === "limit" || marketAvg != null) && <div className="trade-row"><span>{tr("预计成交额")}</span><span>{type === "market" ? "≈ " : ""}{amt(type === "limit" ? total : marketEstimate)} USDT</span></div>}
    {note}
    <button type="button" className={side === "buy" ? "primary wide trade-buy" : "primary wide trade-sell"} disabled={!canOrder}
      onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); onAsk({
        title: tr("确认下单"), message: confirmMessage,
        buttons: [{ label: side === "buy" ? tr("确认买入") : tr("确认卖出"), kind: side === "buy" ? "primary" : "danger", onClick: () => { onAsk(null); submit(); } }, { label: tr("取消"), kind: "cancel", onClick: () => onAsk(null) }],
      }); }}>{side === "buy" ? tr("买入") : tr("卖出")}</button>
  </section>;
}
