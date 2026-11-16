// The 交易 tab's state, a port of the iOS SafeTradeStore (prl-hub Sources/Trade/SafeTradeStore.swift),
// supporting both SafeTrade and Gate PEARL/USDT.
import { useSyncExternalStore } from "react";
import * as stApi from "./safetrade-client.ts";
import * as gateApi from "./gate-client.ts";
import { gateAuthProblem, gateFailureMessage } from "./gate.ts";
import { hasSavedExchange, savedExchange, saveExchange, subscribeExchange } from "./kline.ts";
import {
  BASE, DEFAULT_GATE_RULES, DEFAULT_RULES, EXCHANGE_LABELS, authProblemOf, dec, decOf, gateAffordableBuyCap, marketPriceCap, slippageFraction, SLIPPAGE_DEFAULT,
  displayPrice, failureMessage, failureOf, isNewOrder, isOpen, isPending, isSettled, lookForUnverified, mergeOrders, orderKey, parseAmount,
  parsePendingCheck, decText, rollingChange, SETTLE_DELAYS, sameCandles, sameDepth, sameOrders, sameTicker, settleLeft, sha256, signedPercent, TradeError,
  type Balance, type Candle, type Depth, type MarketRules, type Order, type PendingOrderCheck, type PendingWithdrawCheck, type Ticker, type Tr, type TradeExchange,
} from "./safetrade.ts";

export const PERIODS = [5, 15, 60, 240, 1440] as const;
const CANDLE_LIMIT = 300;
const DEPTH_CHART_INTERVAL = 9000;
const PERIOD_KEY = "pearlhub.safetrade.period";

export type IPIssue = { ip: string | null };
export type TradeState = {
  exchange: TradeExchange;
  /** null until the shell has said whether keys are saved. */
  hasKeys: boolean | null; masked: string | null;
  balances: Balance[]; balancesCached: boolean;
  ticker: Ticker | null; orders: Order[];
  candles: Candle[]; candlesPeriod: number | null; minuteCandles: Candle[]; period: number;
  depth: Depth | null; depthStale: boolean; rules: MarketRules;
  refreshing: boolean; accountStale: boolean; placing: boolean; cancelingID: number | null; cancelingKey: string | null;
  error: string | null; accountError: string | null; lastOrder: string | null;
  ipIssue: IPIssue | null; unverifiedOrder: PendingOrderCheck | null; verifyingOrder: boolean;
  unverifiedWithdraws: Record<string, PendingWithdrawCheck>;
};

function savedPeriod() {
  try { const p = Number(localStorage.getItem(PERIOD_KEY)); return (PERIODS as readonly number[]).includes(p) ? p : 60; } catch { return 60; }
}
function defaultRulesFor(ex: TradeExchange): MarketRules {
  return ex === "gate" ? DEFAULT_GATE_RULES : DEFAULT_RULES;
}

export class TradeStore {
  private s: TradeState = (() => {
    const exchange = savedExchange();
    return {
      exchange,
      hasKeys: null, masked: null, balances: [], balancesCached: false, ticker: null, orders: [], candles: [], candlesPeriod: null,
      minuteCandles: [], period: savedPeriod(), depth: null, depthStale: false, rules: defaultRulesFor(exchange), refreshing: false, accountStale: false,
      placing: false, cancelingID: null, cancelingKey: null, error: null, accountError: null, lastOrder: null, ipIssue: null, unverifiedOrder: null,
      verifyingOrder: false, unverifiedWithdraws: {},
    };
  })();
  constructor() {
    subscribeExchange((ex) => {
      if (ex !== this.s.exchange) this.applyExchange(ex, false);
    });
  }
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
  /** Bumped when the keys or exchange change: account figures read for the previous context are dropped. */
  private keyGen = 0;
  /** The next automatic look for an unverified order, once looks can tell it never went in. */
  private orderRecheck: ReturnType<typeof setTimeout> | undefined;
  /** Follow-up account reads after an order or a cancel (settle); bumped to stop the one under way. */
  private settleGen = 0;
  private settling = false;
  /** When the order lists were last read, for the open-order watch. */
  private ordersReadAt = 0;

  get state() { return this.s; }
  get exchangeName() { return EXCHANGE_LABELS[this.s.exchange]; }
  get isGate() { return this.s.exchange === "gate"; }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<TradeState>) { this.s = { ...this.s, ...patch }; for (const l of this.listeners) l(); }
  setText(tr: Tr) { this.tr = tr; }
  balance = (currency: string) => this.s.balances.find((b) => b.currency.toLowerCase() === currency.toLowerCase());

  private client() { return this.s.exchange === "gate" ? gateApi : stApi; }

  private applyExchange(ex: TradeExchange, shouldRefresh: boolean) {
    this.keyGen++;
    this.settleGen++;
    this.candleRequest++;
    this.settling = false;
    this.rulesLoaded = false;
    this.lastRefreshAt = 0;
    this.minutesAt = 0;
    this.depthAt = 0;
    this.ordersReadAt = 0;
    this.run = null;
    clearTimeout(this.orderRecheck);
    clearTimeout(this.lastOrderTimer);
    this.set({
      exchange: ex,
      hasKeys: null, masked: null, balances: [], balancesCached: false,
      ticker: null, orders: [], candles: [], candlesPeriod: null, minuteCandles: [],
      depth: null, depthStale: false, rules: defaultRulesFor(ex),
      refreshing: false, accountStale: false, placing: false, cancelingID: null, cancelingKey: null,
      error: null, accountError: null, lastOrder: null, ipIssue: null,
      unverifiedOrder: null, verifyingOrder: false, unverifiedWithdraws: {},
    });
    if (shouldRefresh) void this.refresh();
  }

  setExchange(ex: TradeExchange) {
    const changed = ex !== this.s.exchange;
    if (changed) this.applyExchange(ex, true);
    saveExchange(ex);
  }

  setWantsDepth(on: boolean) {
    const was = this.wantsDepth; this.wantsDepth = on;
    if (on && !was) void this.refreshDepth();
  }
  setWantsDepthChart(on: boolean) {
    const was = this.wantsDepthChart; this.wantsDepthChart = on;
    if (on && !was && !this.s.refreshing && this.depthDue(DEPTH_CHART_INTERVAL)) void this.refreshDepth();
  }

  async readKeys(): Promise<boolean | null> {
    const gen = this.keyGen;
    let k: stApi.KeyStatus;
    try { k = await this.client().keyStatus(); } catch { return null; }
    if (gen !== this.keyGen) return null;
    if (k.set !== this.s.hasKeys || k.masked !== this.s.masked) {
      this.set({ hasKeys: k.set, masked: k.masked });
      this.loadLocks();
    }
    return k.set;
  }

  async refreshIfStale(ms = 30000) {
    if (this.run) await this.run;
    if (Date.now() - this.lastRefreshAt < ms && !this.s.accountStale && this.s.candlesPeriod === this.s.period) return;
    await this.refresh();
  }

  refresh(): Promise<void> {
    if (this.run) return this.run;
    const gen = this.keyGen;
    const p = this.runRefresh(gen).finally(() => {
      if (this.run === p) { this.run = null; this.lastRefreshAt = Date.now(); }
    });
    this.run = p;
    return p;
  }

  private async runRefresh(gen: number) {
    this.set({ refreshing: true });
    try {
      const keys = await this.readKeys();
      if (gen !== this.keyGen) return;
      if (keys === false && this.s.exchange === "safetrade" && !hasSavedExchange()) {
        const gateStatus = await gateApi.keyStatus().catch(() => null);
        if (gen !== this.keyGen) return;
        if (gateStatus?.set) {
          this.setExchange("gate");
          return;
        }
      }
      if (keys === false || (keys === null && this.s.hasKeys !== true)) {
        if (keys === false && gen === this.keyGen) {
          this.set({ balances: [], balancesCached: false, orders: [], lastOrder: null, ipIssue: null, accountStale: false, accountError: this.tr("未配置 API 密钥") });
        }
        await this.loadPrimaryMarket(gen);
        await this.loadSecondaryMarket(gen);
        return;
      }
      if (gen === this.keyGen && !this.s.balances.length) {
        const cached = this.cachedBalances();
        if (cached) this.set({ balances: cached, balancesCached: true });
      }
      const balanceError = this.loadBalances();
      await this.loadPrimaryMarket(gen);
      const be = await balanceError;
      if (gen !== this.keyGen) return;
      if (be) { await this.settleAccount(be); await this.loadSecondaryMarket(gen); return; }
      const orderError = this.loadOrders();
      await this.loadSecondaryMarket(gen);
      if (gen !== this.keyGen) return;
      await this.settleAccount(await orderError);
      if (this.s.unverifiedOrder && !this.s.verifyingOrder) void this.verifyUnverifiedOrder();
    } finally {
      if (gen === this.keyGen) this.set({ refreshing: false });
    }
  }

  setPeriod(p: number) {
    this.set({ period: p });
    try { localStorage.setItem(PERIOD_KEY, String(p)); } catch { /* This run only. */ }
    const id = ++this.candleRequest;
    void this.loadCandles(p, id, this.keyGen);
  }

  private async loadPrimaryMarket(gen: number) {
    const p = this.s.period, id = ++this.candleRequest, c = this.client();
    await Promise.all([
      c.ticker().then((t) => { if (gen === this.keyGen) this.setTicker(t); }, () => {}),
      this.loadCandles(p, id, gen),
    ]);
  }
  private async loadCandles(p: number, id: number, gen: number) {
    try {
      const next = await this.client().kline(p, CANDLE_LIMIT);
      if (gen !== this.keyGen || id !== this.candleRequest || p !== this.s.period) return;
      this.set({ candles: sameCandles(next, this.s.candles) ? this.s.candles : next, candlesPeriod: p });
    } catch { /* Next tick retries. */ }
  }
  private async loadSecondaryMarket(gen: number) {
    await Promise.all([this.refreshMinutes(true, gen), this.loadRules(gen), this.wantsDepth || this.wantsDepthChart ? this.refreshDepth(gen) : undefined]);
  }

  async refreshTickerOnly() {
    const gen = this.keyGen, c = this.client();
    const bookDue = this.wantsDepth || (this.wantsDepthChart && this.depthDue(DEPTH_CHART_INTERVAL));
    const candlesDue = this.s.candlesPeriod !== this.s.period, p = this.s.period, id = candlesDue ? ++this.candleRequest : 0;
    await Promise.all([
      this.refreshMinutes(false, gen),
      bookDue ? this.refreshDepth(gen) : undefined,
      candlesDue ? this.loadCandles(p, id, gen) : undefined,
      c.ticker().then((t) => { if (gen === this.keyGen) this.setTicker(t); }, () => {}),
    ]);
  }
  private setTicker(t: Ticker) { if (!sameTicker(t, this.s.ticker)) this.set({ ticker: t }); }

  private async refreshMinutes(force: boolean, gen = this.keyGen) {
    if (this.s.period === 1440) return;
    if (!force && Date.now() - this.minutesAt < 30000) return;
    try {
      const m = await this.client().kline(1, 250);
      if (gen !== this.keyGen) return;
      if (m.length) { this.minutesAt = Date.now(); if (!sameCandles(m, this.s.minuteCandles)) this.set({ minuteCandles: m }); }
    } catch { /* Keeps last ones. */ }
  }
  private async refreshDepth(gen = this.keyGen) {
    try {
      const d = await this.client().depth(100);
      if (gen !== this.keyGen) return;
      this.depthAt = Date.now();
      this.set({ depth: sameDepth(d, this.s.depth) ? this.s.depth : d, depthStale: false });
    } catch {
      if (gen === this.keyGen && this.s.depth && !this.s.depthStale) this.set({ depthStale: true });
    }
  }
  private depthDue(ms: number) { return Date.now() - this.depthAt >= ms; }
  private async loadRules(gen = this.keyGen) {
    if (this.rulesLoaded) return;
    try {
      const r = await this.client().marketRules();
      if (gen !== this.keyGen) return;
      this.rulesLoaded = true;
      this.set({ rules: r });
    } catch { /* Built-in rules stand. */ }
  }

  periodChange(): string | null {
    const { period, ticker, minuteCandles } = this.s;
    if (period === 1440) return ticker?.change ?? null;
    const now = Number(ticker?.last) || minuteCandles.at(-1)?.c;
    const pct = now ? rollingChange(minuteCandles, period, now) : null;
    return pct == null ? null : signedPercent(pct);
  }

  marketCap(side: "buy" | "sell", slippagePercent: number, amount?: bigint | null) {
    const fromLast = dec(this.s.ticker?.last), book = side === "buy" ? this.s.depth?.asks[0]?.price : this.s.depth?.bids[0]?.price;
    const last = fromLast != null && fromLast > 0n ? fromLast : book != null ? decOf(book) : null;
    if (last == null) return null;
    const baseCap = marketPriceCap(this.s.rules, side, last, slippageFraction(slippagePercent));
    if (baseCap == null) return null;
    if (this.s.exchange === "gate" && side === "buy" && amount != null && amount > 0n) {
      const avail = dec(this.balance("usdt")?.balance);
      if (avail != null && avail > 0n) {
        const minExec = book != null ? decOf(book) : (last * 99n / 100n);
        return gateAffordableBuyCap(this.s.rules, baseCap, minExec, amount, avail);
      }
    }
    return baseCap;
  }

  async placeOrder(side: "buy" | "sell", type: "limit" | "market", volume: string, price: string | null,
    slippagePercent = SLIPPAGE_DEFAULT): Promise<"placed" | "unverified" | false> {
    const amount = parseAmount(volume);
    if (this.s.placing || this.s.unverifiedOrder || amount == null) return false;
    const gen = this.keyGen, ex = this.s.exchange;
    const priceValue = price != null ? parseAmount(price) : null;
    const amountText = decText(amount, 18), priceText = priceValue != null ? decText(priceValue, 18) : null;
    const cap = type === "market" ? this.marketCap(side, slippagePercent, amount) : null, capText = cap != null ? decText(cap, 18) : null;
    const before = { side, knownIDs: this.s.orders.flatMap((o) => { const k = orderKey(o); return k != null ? [k] : []; }), knownComplete: !this.s.accountStale };
    const balancesBefore = this.s.balances;
    this.set({ placing: true, error: null, lastOrder: null });
    try {
      const o = ex === "gate"
        ? await gateApi.placeOrder(side, amountText, priceText, type, capText)
        : await stApi.placeOrder(side, amountText, priceText, type, capText);
      if (gen !== this.keyGen) return false;
      const sideWord = o.side ?? side, labelId = o.rawId ?? (o.id != null ? String(o.id) : "?");
      this.set({ placing: false, orders: [o, ...this.s.orders],
        lastOrder: this.tr("已下单 #{0} · {1} {2} @ {3} · {4}", labelId, sideWord, o.originAmount ?? amountText, displayPrice(o) ?? priceText ?? "—", o.state ?? "") });
      void this.settle(orderKey(o), balancesBefore, 0, type === "market" ? (x) => !isOpen(x) : (x) => !isPending(x));
      clearTimeout(this.lastOrderTimer);
      this.lastOrderTimer = setTimeout(() => this.set({ lastOrder: null }), 5000);
      return "placed";
    } catch (e) {
      if (gen !== this.keyGen) return false;
      const f = failureOf(e);
      if (f.kind === "placedUnverified") {
        const msg = ex === "gate" ? gateFailureMessage(f, this.tr) : failureMessage(f, this.tr);
        this.set({ placing: false, error: msg });
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

  async verifyUnverifiedOrder() {
    const check = this.s.unverifiedOrder;
    if (!check || this.s.verifyingOrder) return;
    const ex = this.s.exchange;
    clearTimeout(this.orderRecheck);
    this.set({ verifyingOrder: true });
    try {
      const r = await lookForUnverified(check, async () => {
        const list = ex === "gate"
          ? mergeOrders(await gateApi.orders("finished", 20), await gateApi.orders("open", 100).catch(() => []))
          : await stApi.orders();
        return list.find((o: Order) => isNewOrder(check, o));
      });
      if (this.s.unverifiedOrder !== check) return;
      if (r.kind === "found") {
        const labelId = r.hit.rawId ?? (r.hit.id != null ? String(r.hit.id) : "?");
        this.setLocks({ unverifiedOrder: null });
        this.set({ error: null, lastOrder: this.tr("已在订单列表找到这笔订单 #{0}", labelId) });
      } else if (r.kind === "absent") {
        this.setLocks({ unverifiedOrder: null });
        this.set({ error: this.tr("订单列表里没有这笔订单，下单没有成功，可以重新下单。") });
      } else {
        this.set({
          error: ex === "gate"
            ? this.tr("暂时无法确认下单结果，请到 Gate 网站核对，或稍后点「重新核对」。")
            : this.tr("暂时无法确认下单结果，请到 SafeTrade 网站核对，或稍后点「重新核对」。"),
        });
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

  async cancelOrder(o: Order) {
    const key = orderKey(o);
    if (!key || this.s.cancelingKey != null || this.s.placing) return;
    const ex = this.s.exchange;
    if (ex === "safetrade" && o.id == null) return;
    this.set({ cancelingID: o.id ?? null, cancelingKey: key, error: null, lastOrder: null });
    const balancesBefore = this.s.balances, done = (x: Order) => !isOpen(x);
    try {
      if (ex === "gate") await gateApi.cancelOrder(o.rawId ?? key);
      else await stApi.cancelOrder(o.id!);
      await this.refreshAccount();
      const absentOK = ex === "gate";
      if (!isSettled(this.s.orders.find((x) => orderKey(x) === key), this.s.balances !== balancesBefore, done, absentOK)) {
        void this.settle(key, balancesBefore, 1, done, absentOK);
      }
    } catch (e) { await this.present(e); }
    this.set({ cancelingID: null, cancelingKey: null });
  }

  private async settle(key: string | null | undefined, balancesBefore: Balance[], firstDelay: number, done: (o: Order) => boolean, absentMeansDone = false) {
    const gen = ++this.settleGen;
    this.settling = true;
    try {
      for (const delay of [firstDelay, ...SETTLE_DELAYS]) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay * 1000));
        if (gen !== this.settleGen) return;
        await this.refreshAccount();
        if (isSettled(this.s.orders.find((x) => key != null && orderKey(x) === key), this.s.balances !== balancesBefore, done, absentMeansDone)) break;
      }
    } finally { if (gen === this.settleGen) this.settling = false; }
  }

  async refreshAccountIfOrdersOpen(ms = 15000) {
    const s = this.s;
    if (s.hasKeys !== true || !s.orders.some(isOpen) || s.placing || s.refreshing || s.cancelingKey != null || s.unverifiedOrder || this.settling) return;
    if (Date.now() - this.ordersReadAt < ms) return;
    await this.refreshAccount();
  }

  async refreshAccount() {
    const gen = this.keyGen;
    const [b, o] = await Promise.all([this.loadBalances(), this.loadOrders()]);
    if (gen !== this.keyGen) return;
    await this.settleAccount(b ?? o);
  }
  private async loadBalances(): Promise<unknown> {
    const gen = this.keyGen;
    try {
      const next = await this.client().balances();
      if (gen !== this.keyGen) return null;
      this.set({ balances: JSON.stringify(next) === JSON.stringify(this.s.balances) ? this.s.balances : next, balancesCached: false });
      this.rememberBalances(next);
      return null;
    } catch (e) { return gen === this.keyGen ? e : null; }
  }
  private async loadOrders(): Promise<unknown> {
    const gen = this.keyGen, ex = this.s.exchange;
    const open = ex === "gate" ? gateApi.orders("open", 100).catch(() => null) : stApi.orders("wait", 100).catch(() => null);
    try {
      const recent = ex === "gate" ? await gateApi.orders("finished", 20) : await stApi.orders();
      const merged = mergeOrders(recent, (await open) ?? this.s.orders.filter(isOpen));
      if (gen !== this.keyGen) return null;
      if (!sameOrders(merged, this.s.orders)) this.set({ orders: merged });
      this.ordersReadAt = Date.now();
      return null;
    } catch (e) { return gen === this.keyGen ? e : null; }
  }
  private async settleAccount(error: unknown) {
    if (error) { this.set({ accountStale: true }); await this.present(error, true); }
    else this.set({ accountStale: false, accountError: null, ipIssue: null });
  }

  async present(e: unknown, account = false) {
    const gen = this.keyGen;
    if (failureOf(e).kind === "noCredentials") void this.readKeys();
    await explainFailure(e, this.tr, {
      ip: (ipIssue) => { if (gen === this.keyGen) this.set({ ipIssue }); },
      error: (m) => { if (gen === this.keyGen) this.set(account ? { accountError: m } : { error: m }); },
    }, this.s.ipIssue, this.s.exchange);
  }

  setUnverifiedWithdraw(currency: string, check: PendingWithdrawCheck | null) {
    const next = { ...this.s.unverifiedWithdraws };
    if (check) next[currency] = check; else delete next[currency];
    this.setLocks({ unverifiedWithdraws: next });
  }

  async keysChanged() {
    this.keyGen++;
    this.set({ balances: [], orders: [], balancesCached: false, ipIssue: null, accountError: null, accountStale: false, error: null, lastOrder: null });
    this.lastRefreshAt = 0;
    if (this.run) await this.run;
    await this.refresh();
  }

  // MARK: per key storage, under a hash of its masked form (SafeTrade keeps its legacy key prefix)

  private storagePrefix() {
    return this.s.exchange === "gate" ? "pearlhub.gate" : "pearlhub.safetrade";
  }

  private keyDigest() {
    const m = this.s.masked;
    if (!m) return null;
    return Array.from(sha256(new TextEncoder().encode(m)).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  private setLocks(patch: Pick<Partial<TradeState>, "unverifiedOrder" | "unverifiedWithdraws">) {
    this.set(patch);
    const d = this.keyDigest();
    if (!d) return;
    const { unverifiedOrder: order, unverifiedWithdraws: withdraws } = this.s, k = `${this.storagePrefix()}.unverified.${d}`;
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
        const saved = JSON.parse(localStorage.getItem(`${this.storagePrefix()}.unverified.${d}`) || "null");
        const o = parsePendingCheck(saved?.order), side = saved?.order?.side;
        if (o && (side === "buy" || side === "sell")) order = { ...o, side };
        for (const [c, v] of Object.entries(saved?.withdraws ?? {})) { const w = parsePendingCheck(v); if (w && /^[a-z0-9]{1,32}$/.test(c)) withdraws[c] = w; }
      } catch { /* None saved. */ }
    }
    this.set({ unverifiedOrder: order, unverifiedWithdraws: withdraws });
  }

  private balanceCacheKey() {
    const d = this.keyDigest();
    return d ? `${this.storagePrefix()}.lastBalances.${d}` : null;
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

export async function explainFailure(e: unknown, tr: Tr, show: { ip(issue: IPIssue): void; error(message: string | null): void }, known?: IPIssue | null, exchange: TradeExchange = "safetrade") {
  const f = failureOf(e);
  const auth = exchange === "gate" ? (f.kind === "http" ? gateAuthProblem(f.status, f.body) : null) : authProblemOf(f);
  if (auth?.kind === "untrustedIP") {
    show.error(null);
    if (!known) show.ip({ ip: null });
    try { show.ip({ ip: await (exchange === "gate" ? gateApi.publicIP() : stApi.publicIP()) }); } catch { /* Stays "looking up". */ }
    return;
  }
  show.error(exchange === "gate" ? gateFailureMessage(f, tr) : failureMessage(f, tr));
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
export function upsellAfterLimitOrder(pro: boolean, price: string) {
  if (pro || !price || read(ORDER_ASKED) === "1" || read(SHOWN) === "1") return false;
  write(ORDER_ASKED, "1");
  return true;
}
export const upsellShown = () => write(SHOWN, "1");
