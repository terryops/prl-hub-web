// The 交易 tab's state, a port of the iOS SafeTradeStore (prl-hub Sources/Trade/SafeTradeStore.swift).
// One instance for the app's life, so the tab keeps its figures across tab switches the way the iOS
// tab's @StateObject does. Components read it through useTradeStore (useSyncExternalStore).
import { useSyncExternalStore } from "react";
import * as api from "./safetrade-client.ts";
import {
  BASE, DEFAULT_RULES, authProblemOf, displayPrice, failureMessage, failureOf, isNewOrder, isOpen, lookForUnverified, mergeOrders, parseAmount,
  parsePendingCheck, decText, rollingChange, sameCandles, sameDepth, sameOrders, sameTicker, settleLeft, sha256, signedPercent, TradeError,
  type Balance, type Candle, type Depth, type MarketRules, type Order, type PendingOrderCheck, type PendingWithdrawCheck, type Ticker, type Tr,
} from "./safetrade.ts";

export const PERIODS = [5, 15, 60, 240, 1440] as const;
/** Enough candles to zoom well out; the iOS app reads 120, the website's K-line 300. */
const CANDLE_LIMIT = 300;
const DEPTH_CHART_INTERVAL = 9000;
const PERIOD_KEY = "pearlhub.safetrade.period";

export type IPIssue = { ip: string | null };
export type TradeState = {
  /** null until the shell has said whether keys are saved. */
  hasKeys: boolean | null; masked: string | null;
  balances: Balance[]; balancesCached: boolean;
  ticker: Ticker | null; orders: Order[];
  candles: Candle[]; candlesPeriod: number | null; minuteCandles: Candle[]; period: number;
  depth: Depth | null; depthStale: boolean; rules: MarketRules;
  refreshing: boolean; accountStale: boolean; placing: boolean; cancelingID: number | null;
  error: string | null; accountError: string | null; lastOrder: string | null;
  ipIssue: IPIssue | null; unverifiedOrder: PendingOrderCheck | null; verifyingOrder: boolean;
  unverifiedWithdraws: Record<string, PendingWithdrawCheck>;
};

function savedPeriod() {
  try { const p = Number(localStorage.getItem(PERIOD_KEY)); return (PERIODS as readonly number[]).includes(p) ? p : 60; } catch { return 60; }
}

export class TradeStore {
  private s: TradeState = {
    hasKeys: null, masked: null, balances: [], balancesCached: false, ticker: null, orders: [], candles: [], candlesPeriod: null,
    minuteCandles: [], period: savedPeriod(), depth: null, depthStale: false, rules: DEFAULT_RULES, refreshing: false, accountStale: false,
    placing: false, cancelingID: null, error: null, accountError: null, lastOrder: null, ipIssue: null, unverifiedOrder: null,
    verifyingOrder: false, unverifiedWithdraws: {},
  };
  private listeners = new Set<() => void>();
  private tr: Tr = (k) => k;
  private run: Promise<void> | null = null;
  private lastRefreshAt = 0;
  private candleRequest = 0;
  private minutesAt = 0;
  private depthAt = 0;
  private rulesLoaded = false;
  private lastOrderTimer: ReturnType<typeof setTimeout> | undefined;
  /** The order form is on 市价: poll the book with the ticker. */
  private wantsDepth = false;
  /** The Pro depth chart is on screen: poll the book every ~10 s. */
  private wantsDepthChart = false;
  /** Bumped when the keys change: account figures a refresh read with the old keys are dropped. */
  private keyGen = 0;
  /** The next automatic look for an unverified order, once looks can tell it never went in. */
  private orderRecheck: ReturnType<typeof setTimeout> | undefined;

  get state() { return this.s; }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<TradeState>) { this.s = { ...this.s, ...patch }; for (const l of this.listeners) l(); }
  setText(tr: Tr) { this.tr = tr; }
  balance = (currency: string) => this.s.balances.find((b) => b.currency.toLowerCase() === currency.toLowerCase());

  setWantsDepth(on: boolean) {
    const was = this.wantsDepth; this.wantsDepth = on;
    if (on && !was) void this.refreshDepth();
  }
  setWantsDepthChart(on: boolean) {
    const was = this.wantsDepthChart; this.wantsDepthChart = on;
    if (on && !was && !this.s.refreshing && this.depthDue(DEPTH_CHART_INTERVAL)) void this.refreshDepth();
  }

  /** Re-read whether keys are saved (after 设置 → 交易 saved or cleared them). null: the shell didn't answer,
   *  which says nothing either way, so what's on screen stands. */
  async readKeys(): Promise<boolean | null> {
    let k: api.KeyStatus;
    try { k = await api.keyStatus(); } catch { return null; }
    if (k.set !== this.s.hasKeys || k.masked !== this.s.masked) {
      this.set({ hasKeys: k.set, masked: k.masked });
      this.loadLocks();
    }
    return k.set;
  }

  /** A full refresh unless one ran within `ms` and left nothing missing (re-entering the tab / the foreground). */
  async refreshIfStale(ms = 30000) {
    if (this.run) await this.run;
    if (Date.now() - this.lastRefreshAt < ms && !this.s.accountStale && this.s.candlesPeriod === this.s.period) return;
    await this.refresh();
  }

  /** Market data always; the account when keys are set. What's on screen stays when a part fails. */
  refresh(): Promise<void> {
    if (this.run) return this.run;
    this.run = this.runRefresh().finally(() => { this.run = null; this.lastRefreshAt = Date.now(); });
    return this.run;
  }

  private async runRefresh() {
    this.set({ refreshing: true });
    const gen = this.keyGen;
    try {
      const keys = await this.readKeys();
      if (keys === false || (keys === null && this.s.hasKeys !== true)) {
        if (keys === false && gen === this.keyGen) this.set({ balances: [], balancesCached: false, orders: [], lastOrder: null, ipIssue: null, accountStale: false, accountError: this.tr("未配置 API 密钥") });
        await this.loadPrimaryMarket();
        await this.loadSecondaryMarket();
        return;
      }
      // Last session's balances for this key until the fresh read replaces them.
      if (gen === this.keyGen && !this.s.balances.length) { const cached = this.cachedBalances(); if (cached) this.set({ balances: cached, balancesCached: true }); }
      const balanceError = this.loadBalances();
      await this.loadPrimaryMarket();
      const be = await balanceError;
      if (be) { await this.settleAccount(be); await this.loadSecondaryMarket(); return; }
      const orderError = this.loadOrders();
      await this.loadSecondaryMarket();
      await this.settleAccount(await orderError);
      // An order left unverified (maybe in an earlier run of the app): look for it again.
      if (this.s.unverifiedOrder && !this.s.verifyingOrder) void this.verifyUnverifiedOrder();
    } finally {
      this.set({ refreshing: false });
    }
  }

  setPeriod(p: number) {
    this.set({ period: p });
    try { localStorage.setItem(PERIOD_KEY, String(p)); } catch { /* This run only. */ }
    const id = ++this.candleRequest;
    void this.loadCandles(p, id);
  }

  private async loadPrimaryMarket() {
    const p = this.s.period, id = ++this.candleRequest;
    await Promise.all([api.ticker().then((t) => this.setTicker(t), () => {}), this.loadCandles(p, id)]);
  }
  private async loadCandles(p: number, id: number) {
    try {
      const next = await api.kline(p, CANDLE_LIMIT);
      if (id !== this.candleRequest || p !== this.s.period) return;
      this.set({ candles: sameCandles(next, this.s.candles) ? this.s.candles : next, candlesPeriod: p });
    } catch { /* The next 现价 tick asks again (candlesPeriod stays behind). */ }
  }
  private async loadSecondaryMarket() {
    await Promise.all([this.refreshMinutes(true), this.loadRules(), this.wantsDepth || this.wantsDepthChart ? this.refreshDepth() : undefined]);
  }

  /** The periodic 现价 poll, plus the book (every tick on 市价, every ~10 s for the chart). */
  async refreshTickerOnly() {
    const bookDue = this.wantsDepth || (this.wantsDepthChart && this.depthDue(DEPTH_CHART_INTERVAL));
    const candlesDue = this.s.candlesPeriod !== this.s.period, p = this.s.period, id = candlesDue ? ++this.candleRequest : 0;
    await Promise.all([
      this.refreshMinutes(false),
      bookDue ? this.refreshDepth() : undefined,
      candlesDue ? this.loadCandles(p, id) : undefined,
      api.ticker().then((t) => this.setTicker(t), () => {}),
    ]);
  }
  /** Publish only a quote that changed; a failed read keeps the last one. */
  private setTicker(t: Ticker) { if (!sameTicker(t, this.s.ticker)) this.set({ ticker: t }); }

  private async refreshMinutes(force: boolean) {
    if (this.s.period === 1440) return;
    if (!force && Date.now() - this.minutesAt < 30000) return;
    try {
      const m = await api.kline(1, 250);
      if (m.length) { this.minutesAt = Date.now(); if (!sameCandles(m, this.s.minuteCandles)) this.set({ minuteCandles: m }); }
    } catch { /* Keeps the last ones. */ }
  }
  /** 100 levels: the chart's window and a market order's walk. A failed read keeps the last book, flagged stale. */
  private async refreshDepth() {
    try {
      const d = await api.depth(100);
      this.depthAt = Date.now();
      this.set({ depth: sameDepth(d, this.s.depth) ? this.s.depth : d, depthStale: false });
    } catch {
      if (this.s.depth && !this.s.depthStale) this.set({ depthStale: true });
    }
  }
  private depthDue(ms: number) { return Date.now() - this.depthAt >= ms; }
  private async loadRules() {
    if (this.rulesLoaded) return;
    try { const r = await api.marketRules(); this.rulesLoaded = true; this.set({ rules: r }); } catch { /* The built-in rules stand. */ }
  }

  /** Change shown next to the price: rolling over the chart's period, the exchange's 24 h change for 1日. */
  periodChange(): string | null {
    const { period, ticker, minuteCandles } = this.s;
    if (period === 1440) return ticker?.change ?? null;
    const now = Number(ticker?.last) || minuteCandles.at(-1)?.c;
    const pct = now ? rollingChange(minuteCandles, period, now) : null;
    return pct == null ? null : signedPercent(pct);
  }

  /** "placed": the exchange accepted the order. "unverified": it may have (the form clears either way, so it
   *  isn't sent twice). false: it didn't. */
  async placeOrder(side: "buy" | "sell", type: "limit" | "market", volume: string, price: string | null): Promise<"placed" | "unverified" | false> {
    const amount = parseAmount(volume);
    if (this.s.placing || this.s.unverifiedOrder || amount == null) return false;
    const priceValue = price != null ? parseAmount(price) : null;
    const amountText = decText(amount, 18), priceText = priceValue != null ? decText(priceValue, 18) : null;
    const before = { side, knownIDs: this.s.orders.flatMap((o) => o.id != null ? [o.id] : []), knownComplete: !this.s.accountStale };
    this.set({ placing: true, error: null, lastOrder: null });
    try {
      const o = await api.placeOrder(side, amountText, priceText, type);
      const sideWord = o.side ?? side;
      this.set({ placing: false, orders: [o, ...this.s.orders],
        lastOrder: this.tr("已下单 #{0} · {1} {2} @ {3} · {4}", o.id != null ? String(o.id) : "?", sideWord, o.originAmount ?? amountText, displayPrice(o) ?? priceText ?? "—", o.state ?? "") });
      void this.refreshAccount();
      clearTimeout(this.lastOrderTimer);
      this.lastOrderTimer = setTimeout(() => this.set({ lastOrder: null }), 5000);
      return "placed";
    } catch (e) {
      const f = failureOf(e);
      if (f.kind === "placedUnverified") {
        this.set({ placing: false, error: failureMessage(f, this.tr) });
        this.setLocks({ unverifiedOrder: { ...before, at: Date.now() } });
        void this.verifyUnverifiedOrder();
        return "unverified";
      }
      this.set({ placing: false });
      if (e instanceof TradeError) await this.present(e);
      else { this.set({ error: String(e) }); void this.refreshAccount(); }
      return false;
    }
  }

  /** Look for the unverified order (lookForUnverified). Still unknown before SETTLE_MS: look again then. */
  async verifyUnverifiedOrder() {
    const check = this.s.unverifiedOrder;
    if (!check || this.s.verifyingOrder) return;
    clearTimeout(this.orderRecheck);
    this.set({ verifyingOrder: true });
    try {
      const r = await lookForUnverified(check, async () => (await api.orders()).find((o: Order) => isNewOrder(check, o)));
      if (this.s.unverifiedOrder !== check) return;   // dismissed, or another key's meanwhile
      if (r.kind === "found") {
        this.setLocks({ unverifiedOrder: null });
        this.set({ error: null, lastOrder: this.tr("已在订单列表找到这笔订单 #{0}", r.hit.id != null ? String(r.hit.id) : "?") });
      } else if (r.kind === "absent") {
        this.setLocks({ unverifiedOrder: null });
        this.set({ error: this.tr("订单列表里没有这笔订单，下单没有成功，可以重新下单。") });
      } else {
        this.set({ error: this.tr("暂时无法确认下单结果，请到 SafeTrade 网站核对，或稍后点「重新核对」。") });
        const left = settleLeft(check);
        if (left > 0) this.orderRecheck = setTimeout(() => void this.verifyUnverifiedOrder(), left + 1000);
      }
      await this.refreshAccount();
    } finally {
      this.set({ verifyingOrder: false });
    }
  }
  dismissUnverifiedOrder() {
    clearTimeout(this.orderRecheck);
    this.setLocks({ unverifiedOrder: null });
    this.set({ error: null });
  }

  /** One cancel at a time; the row spins until the cancel is accepted and the list re-read. */
  async cancelOrder(o: Order) {
    if (o.id == null || this.s.cancelingID != null || this.s.placing) return;
    this.set({ cancelingID: o.id, error: null, lastOrder: null });
    try { await api.cancelOrder(o.id); await this.refreshAccount(); }
    catch (e) { await this.present(e); }
    this.set({ cancelingID: null });
  }

  async refreshAccount() {
    const [b, o] = await Promise.all([this.loadBalances(), this.loadOrders()]);
    await this.settleAccount(b ?? o);
  }
  // A read that finishes after the keys changed belongs to the old account: dropped (null, as if it was fine).
  private async loadBalances(): Promise<unknown> {
    const gen = this.keyGen;
    try {
      const next = await api.balances();
      if (gen !== this.keyGen) return null;
      this.set({ balances: JSON.stringify(next) === JSON.stringify(this.s.balances) ? this.s.balances : next, balancesCached: false });
      this.rememberBalances(next);
      return null;
    } catch (e) { return gen === this.keyGen ? e : null; }
  }
  /** Recent + every resting order. The open-orders read is best effort: the open ones on screen stand in. */
  private async loadOrders(): Promise<unknown> {
    const gen = this.keyGen;
    const open = api.orders("wait", 100).catch(() => null);
    try {
      const recent = await api.orders();
      const merged = mergeOrders(recent, (await open) ?? this.s.orders.filter(isOpen));
      if (gen !== this.keyGen) return null;
      if (!sameOrders(merged, this.s.orders)) this.set({ orders: merged });
      return null;
    } catch (e) { return gen === this.keyGen ? e : null; }
  }
  private async settleAccount(error: unknown) {
    if (error) { this.set({ accountStale: true }); await this.present(error, true); }
    else this.set({ accountStale: false, accountError: null, ipIssue: null });
  }

  async present(e: unknown, account = false) {
    if (failureOf(e).kind === "noCredentials") void this.readKeys();
    await explainFailure(e, this.tr, { ip: (ipIssue) => this.set({ ipIssue }), error: (m) => this.set(account ? { accountError: m } : { error: m }) }, this.s.ipIssue);
  }

  setUnverifiedWithdraw(currency: string, check: PendingWithdrawCheck | null) {
    const next = { ...this.s.unverifiedWithdraws };
    if (check) next[currency] = check; else delete next[currency];
    this.setLocks({ unverifiedWithdraws: next });
  }

  /** Keys changed in 设置 → 交易: forget the old account's figures and read again. A refresh already running
   *  read the old keys: what it still brings back is dropped (keyGen), and the keys are read once it's done. */
  async keysChanged() {
    this.keyGen++;
    this.set({ balances: [], orders: [], balancesCached: false, ipIssue: null, accountError: null, accountStale: false, error: null, lastOrder: null });
    this.lastRefreshAt = 0;
    if (this.run) await this.run;
    await this.refresh();
  }

  // MARK: per key storage, under a hash of its masked form (the key itself never goes to storage)

  private keyDigest() {
    const m = this.s.masked;
    if (!m) return null;
    return Array.from(sha256(new TextEncoder().encode(m)).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // The unverified order / withdrawals block a resubmit, so they outlive the app: kept until settled.
  private setLocks(patch: Pick<Partial<TradeState>, "unverifiedOrder" | "unverifiedWithdraws">) {
    this.set(patch);
    const d = this.keyDigest();
    if (!d) return;
    const { unverifiedOrder: order, unverifiedWithdraws: withdraws } = this.s, k = `pearlhub.safetrade.unverified.${d}`;
    try {
      if (!order && !Object.keys(withdraws).length) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify({ order, withdraws }));
    } catch { /* This run only. */ }
  }
  private loadLocks() {
    const d = this.keyDigest();
    let order: PendingOrderCheck | null = null;
    const withdraws: Record<string, PendingWithdrawCheck> = {};
    if (d) {
      try {
        const saved = JSON.parse(localStorage.getItem(`pearlhub.safetrade.unverified.${d}`) || "null");
        const o = parsePendingCheck(saved?.order), side = saved?.order?.side;
        if (o && (side === "buy" || side === "sell")) order = { ...o, side };
        for (const [c, v] of Object.entries(saved?.withdraws ?? {})) { const w = parsePendingCheck(v); if (w && /^[a-z0-9]{1,32}$/.test(c)) withdraws[c] = w; }
      } catch { /* None saved. */ }
    }
    this.set({ unverifiedOrder: order, unverifiedWithdraws: withdraws });
  }

  private balanceCacheKey() {
    const d = this.keyDigest();
    return d ? `pearlhub.safetrade.lastBalances.${d}` : null;
  }
  private cachedBalances(): Balance[] | null {
    const k = this.balanceCacheKey();
    if (!k) return null;
    try {
      const rows = JSON.parse(localStorage.getItem(k) || "null");
      if (!Array.isArray(rows)) return null;
      const list = rows.filter((r) => r && typeof r.currency === "string" && typeof r.balance === "string" && typeof r.locked === "string")
        .map((r) => ({ currency: r.currency === "prl" ? BASE : r.currency, balance: r.balance, locked: r.locked }));
      return list.length ? list : null;
    } catch { return null; }
  }
  private rememberBalances(list: Balance[]) {
    const k = this.balanceCacheKey();
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(list.map(({ currency, balance, locked }) => ({ currency, balance, locked })))); } catch { /* Not cached. */ }
  }
}

/** A refusal for this network's IP shows the IP card (with the address SafeTrade sees) instead of an error
 *  line; anything else, its message. `known`: the IP card already on screen, kept while it's looked up again. */
export async function explainFailure(e: unknown, tr: Tr, show: { ip(issue: IPIssue): void; error(message: string | null): void }, known?: IPIssue | null) {
  const f = failureOf(e);
  if (authProblemOf(f)?.kind === "untrustedIP") {
    show.error(null);
    if (!known) show.ip({ ip: null });
    try { show.ip({ ip: await api.publicIP() }); } catch { /* Stays "looking up". */ }
    return;
  }
  show.error(failureMessage(f, tr));
}

let shared: TradeStore | undefined;
export const tradeStore = () => shared ||= new TradeStore();
export function useTradeStore(store: TradeStore): TradeState {
  return useSyncExternalStore(store.subscribe, () => store.state, () => store.state);
}

// MARK: - Pro offer earned by use (iOS UpsellPrompt): 6 manual refreshes in 24 h, or right after a limit order.

const STAMPS = "pearlhub.upsell.refreshStamps", SHOWN = "pearlhub.upsell.shown", ORDER_ASKED = "pearlhub.upsell.orderAsked";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* This run only. */ } };
/** Call only from a refresh the person asked for. True when the offer should open now. */
export function upsellAfterRefresh(pro: boolean, now = Date.now()) {
  if (pro || read(SHOWN) === "1") return false;
  let stamps: number[] = [];
  try { stamps = (JSON.parse(read(STAMPS) || "[]") as unknown[]).filter((x): x is number => typeof x === "number" && now - x < 86400000); } catch { /* Start over. */ }
  stamps = [...stamps, now].slice(-6);
  write(STAMPS, JSON.stringify(stamps));
  if (stamps.length < 6) return false;
  write(SHOWN, "1");
  return true;
}
/** A limit order was accepted: ask once whether to be told when it fills (a price alert). */
export function upsellAfterLimitOrder(pro: boolean, price: string) {
  if (pro || !price || read(ORDER_ASKED) === "1" || read(SHOWN) === "1") return false;
  write(ORDER_ASKED, "1");
  return true;
}
export const upsellShown = () => write(SHOWN, "1");
