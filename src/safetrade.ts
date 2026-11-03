// SafeTrade (safetrade.com) for the Android app's 交易 tab: a port of the iOS app's pure trade logic
// (prl-hub Sources/Trade: SafeTradeClient.swift's models, SafeTradeRules.swift, TradeDepth.swift,
// ChainAddress.swift, and WalletKit's PRLAmount / PRLAddress). No bridge and no React here, so
// test/safetrade.test.ts runs it under Node. The signed requests themselves are made by the
// Android shell (BRIDGE.md `safetrade.request`); safetrade-client.ts asks it.
import { BECH32_CHARSET, bech32Polymod } from "./rawtx.ts";

/** Localized text: the iOS key (its Chinese source string) with {0}, {1} slots filled. */
export type Tr = (key: string, ...args: (string | number)[]) => string;

/** The one market the app trades. SafeTrade renamed PRL → PEARL on 2026-10-18. */
export const MARKET = "pearlusdt", BASE = "pearl", BASE_TICKER = "PEARL", PAIR = "PEARL/USDT";

// MARK: - lenient JSON reading

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
/** A number or numeric string kept as its text (SafeTrade sends both). */
export const text = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? numberText(v) : undefined;
/** A JSON scalar as text (string, number or bool); anything else "". iOS STLooseText. */
const loose = (v: unknown) => typeof v === "boolean" ? String(v) : text(v) ?? "";
const int = (v: unknown) => typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
const bool = (v: unknown) => typeof v === "boolean" ? v : undefined;
const str = (v: unknown) => typeof v === "string" ? v : undefined;
/** Plain decimal text of a JSON number (no exponent). */
function numberText(n: number) {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(18).replace(/\.?0+$/, "") : s;
}

/** Unix seconds, or milliseconds when too large to be seconds; numeric strings and ISO 8601 too. → ms. */
export function timestamp(v: unknown): number | undefined {
  const epoch = (n: number) => Number.isFinite(n) && n > 0 ? (n > 1e11 ? n : n * 1000) : undefined;
  if (typeof v === "number") return epoch(v);
  if (typeof v !== "string" || !v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return epoch(Number(v));
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

/** Each row decoded on its own: one odd row must not blank a whole list. null when not a list. */
export function rows<T>(body: unknown, decode: (row: Json) => T | null): T[] | null {
  if (!Array.isArray(body)) return null;
  return body.flatMap((r) => { const o = obj(r); const v = o ? decode(o) : null; return v == null ? [] : [v]; });
}

export function parseJSON(body: string): unknown {
  try { return JSON.parse(body); } catch { return undefined; }
}

// MARK: - exact decimals (iOS Decimal)

/** Fixed-point decimal: the value × 10^18 as a bigint. Enough for every SafeTrade amount, exactly. */
export type Dec = bigint;
const SCALE = 18, ONE = 10n ** 18n;
/** Plain decimal text ("1.5", "0.001", "1e-8") → Dec; null when it isn't one. */
export function dec(raw: string | undefined | null): Dec | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)e[+-]?\d+$/i.test(s)) { const n = Number(s); if (!Number.isFinite(n)) return null; s = n.toFixed(SCALE); }
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = (m[3] || "").slice(0, SCALE).padEnd(SCALE, "0");
  const v = BigInt(m[2] || "0") * ONE + BigInt(frac);
  return m[1] ? -v : v;
}
export const decOf = (n: number): Dec => dec(numberText(n)) ?? 0n;
export const decMax = (a: Dec, b: Dec) => a > b ? a : b;
/** a × ratio (both Dec). */
export const decMul = (a: Dec, ratio: Dec) => a * ratio / ONE;
export const decNumber = (d: Dec) => Number(d) / 1e18;
/** Round to `places` (down, or half-up for "plain"), as plain text without trailing zeros: NSDecimalNumber.stringValue. */
export function decText(d: Dec, places = 8, mode: "down" | "plain" = "plain"): string {
  // The exchange's `precision` comes in here too: 0…18 places, whatever it says.
  places = Number.isFinite(places) ? Math.max(0, Math.min(Math.trunc(places), SCALE)) : SCALE;
  const neg = d < 0n, a = neg ? -d : d;
  const unit = 10n ** BigInt(SCALE - places);
  let q = a / unit;
  if (mode === "plain" && (a % unit) * 2n >= unit) q += 1n;
  const p = BigInt(places), whole = q / 10n ** p, frac = (q % 10n ** p).toString().padStart(places, "0").replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return neg && q !== 0n ? `-${out}` : out;
}

/** WalletKit PRLAmount.parse: digits with at most one decimal mark (a comma counts: ru/vi/id keypads
 *  type one) and at most `maxDecimals` decimals. Zero parses; callers decide whether it's allowed. */
export function parseAmount(raw: string, maxDecimals = 8): Dec | null {
  const t = raw.trim();
  if (!/[0-9]/.test(t) || /[^0-9.,]/.test(t)) return null;
  const parts = t.replace(/,/g, ".").split(".");
  if (parts.length > 2 || (parts.length === 2 && parts[1].length > maxDecimals)) return null;
  return dec(parts.join("."));
}
/** The typed number for arithmetic (0 when it isn't one). */
export const typed = (raw: string) => { const d = parseAmount(raw); return d == null ? 0 : decNumber(d); };

/** Significant decimals typed ("1.50" → 1: a trailing zero changes nothing). */
export function decimalPlaces(raw: string) {
  const t = raw.trim().replace(/,/g, "."), dot = t.indexOf(".");
  return dot < 0 ? 0 : t.slice(dot + 1).replace(/0+$/, "").length;
}

/** Round DOWN to `places`: MAX fills must never exceed what's held. */
export function floorTo(x: number, places: number) {
  const m = 10 ** places;
  return Math.floor(x * m + 1e-9) / m;
}
export const fixed = (x: number, places: number) => floorTo(x, places).toFixed(places);

export const shortAddr = (a: string) => a.length > 16 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;

// MARK: - account and market models (SafeTradeClient.swift)

/** A deposit address (`GET /trade/account/deposit_address/{currency}?network=…` and each balance's
 *  `deposit_addresses`). An address-memo coin packs the memo in as "addr?memo=…". Empty = still generating. */
export type DepositAddress = { address?: string; network?: string; currencies?: string[] };
export const plainAddress = (a: DepositAddress) => (a.address ?? "").split("?")[0].trim();
export function memoOf(a: DepositAddress) {
  const i = (a.address ?? "").indexOf("?memo="), m = i < 0 ? "" : a.address!.slice(i + 6).trim();
  return m || undefined;
}
export const addressReady = (a: DepositAddress) => !!plainAddress(a);
export function pickAddress(list: DepositAddress[], currency: string, network: string) {
  return list.find((a) => a.network === network && (a.currencies ?? [currency]).includes(currency) && addressReady(a));
}
function parseDepositAddress(o: Json): DepositAddress {
  const currencies = Array.isArray(o.currencies) ? o.currencies.filter((c): c is string => typeof c === "string") : undefined;
  return { address: str(o.address), network: str(o.network), currencies };
}
export function parseDepositAddressReply(body: unknown, currency: string, network: string): DepositAddress | null {
  const one = obj(body);
  if (one) return parseDepositAddress(one);
  const list = rows(body, parseDepositAddress);
  return list ? pickAddress(list, currency, network) ?? { network } : null;
}

export type Balance = { currency: string; balance: string; locked: string; depositAddresses?: DepositAddress[] };
export const balanceValue = (b?: Balance | null) => Number(b?.balance) || 0;
export const lockedValue = (b?: Balance | null) => Number(b?.locked) || 0;
export function parseBalances(body: unknown): Balance[] | null {
  if (!Array.isArray(body)) return null;
  const out: Balance[] = [];
  for (const r of body) {
    const o = obj(r), currency = o && str(o.currency), balance = o && text(o.balance), locked = o && text(o.locked);
    if (!o || currency == null || balance == null || locked == null) return null;   // iOS decodes the list strictly
    const list = Array.isArray(o.deposit_addresses) ? rows(o.deposit_addresses, parseDepositAddress) ?? undefined : undefined;
    out.push({ currency, balance, locked, depositAddresses: list });
  }
  return out;
}

/** `buy` is the price you BUY at (the best ask), `sell` the best bid — checked live 2026-09-27. */
export type Ticker = { last?: string; buy?: string; sell?: string; high?: string; low?: string; vol?: string; change?: string };
export function parseTicker(body: unknown): Ticker | null {
  const t = obj(obj(body)?.ticker);
  if (!t) return null;
  return { last: text(t.last), buy: text(t.buy), sell: text(t.sell), high: text(t.high), low: text(t.low), vol: text(t.vol), change: text(t.price_change_percent) };
}
export const sameTicker = (a: Ticker | null, b: Ticker | null) => JSON.stringify(a) === JSON.stringify(b);

export type Order = { id?: number; market?: string; side?: string; type?: string; price?: string; state?: string; originAmount?: string; avgPrice?: string; placedAt?: number };
export function parseOrder(o: Json): Order {
  return { id: int(o.id), market: str(o.market), side: str(o.side), type: str(o.type), price: text(o.price), state: str(o.state),
    originAmount: text(o.origin_amount), avgPrice: text(o.avg_price), placedAt: timestamp(o.created_at) ?? timestamp(o.updated_at) };
}
/** Still resting on the book: the only orders the exchange will cancel. */
export const isOpen = (o: Order) => ["wait", "pending"].includes((o.state || "").toLowerCase());
/** A limit order's price, else a market order's realized average; undefined while unpriced. */
export const displayPrice = (o: Order) => [o.price, o.avgPrice].find((p) => p != null && Number(p) > 0);

/** Open orders first, then the recent list, each id once; an order in both takes the recent copy. */
export function mergeOrders(recent: Order[], open: Order[]): Order[] {
  const fresh = new Map<number, Order>();
  for (const o of recent) if (o.id != null && !fresh.has(o.id)) fresh.set(o.id, o);
  const stillOpen = open.map((o) => (o.id != null && fresh.get(o.id)) || o).filter(isOpen);
  const seen = new Set<number>();
  return [...stillOpen, ...recent].filter((o) => o.id == null || (!seen.has(o.id) && !!seen.add(o.id)));
}
export const sameOrders = (a: Order[], b: Order[]) => JSON.stringify(a) === JSON.stringify(b);

/** An order POST whose outcome is unknown. Deliberately loose (no amount match): mistaking another new
 *  order for this one only blocks a re-order; the reverse would book a duplicate. `at`: when the POST
 *  came back without an answer (ms). */
export type PendingOrderCheck = { side: string; knownIDs: number[]; knownComplete: boolean; at: number };
export const isNewOrder = (c: PendingOrderCheck, o: Order) => o.id != null && !c.knownIDs.includes(o.id) && (o.side == null || o.side === c.side);

/** A withdrawal POST whose outcome is unknown; any withdrawal that wasn't there before settles it. */
export type PendingWithdrawCheck = { knownIDs: number[]; knownComplete: boolean; at: number };

/** How long after an unanswered POST the exchange may still act on it: Cloudflare gives SafeTrade's
 *  server 100 s to answer, and the request may still be running there when the shell gives up at 20 s.
 *  Only lists read after this can show that it never went in. */
export const SETTLE_MS = 120_000;

export type UnverifiedResult<T> = { kind: "found"; hit: T } | { kind: "absent" } | { kind: "unknown" };
/** Look for an unanswered order / withdrawal a few times (`look` returns it, or null when the list doesn't
 *  show it; a throw is a failed read). Found → it went in. Two clean looks at a complete list, both made
 *  SETTLE_MS or more after the POST → it didn't. Anything else → still unknown. */
export async function lookForUnverified<T>(check: { knownComplete: boolean; at: number }, look: () => Promise<T | null | undefined>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), now: () => number = Date.now): Promise<UnverifiedResult<T>> {
  let clean = 0;
  for (const delay of [0, 3000, 6000]) {
    if (delay) await wait(delay);
    let hit: T | null | undefined;
    try { hit = await look(); } catch { continue; }
    if (hit) return { kind: "found", hit };
    if (now() - check.at >= SETTLE_MS) clean++;
  }
  return check.knownComplete && clean >= 2 ? { kind: "absent" } : { kind: "unknown" };
}
/** Milliseconds until clean looks count (0 once they do). */
export const settleLeft = (check: { at: number }, now = Date.now()) => Math.max(0, check.at + SETTLE_MS - now);
/** A lock read back from storage: the shape it was saved in, or null. */
export function parsePendingCheck(v: unknown): { knownIDs: number[]; knownComplete: boolean; at: number } | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.knownIDs) || !o.knownIDs.every((x) => Number.isSafeInteger(x)) || typeof o.knownComplete !== "boolean") return null;
  return { knownIDs: o.knownIDs as number[], knownComplete: o.knownComplete, at: typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0 };
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export function parseKline(body: unknown): Candle[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((r) => {
    if (!Array.isArray(r) || r.length < 6) return [];
    const [t, o, h, l, c, v] = r.slice(0, 6).map((x) => Number(x) || 0);
    return t > 0 ? [{ t, o, h, l, c, v }] : [];
  });
}
export const sameCandles = (a: Candle[], b: Candle[]) => a.length === b.length && a.every((c, i) => { const d = b[i]; return c.t === d.t && c.o === d.o && c.h === d.h && c.l === d.l && c.c === d.c && c.v === d.v; });

/** % change of `price` against the close of the minute that ended at or just before `minutes` ago. */
export function rollingChange(minuteCandles: Candle[], minutes: number, price: number, now = Date.now()) {
  const target = now / 1000 - minutes * 60, first = minuteCandles[0];
  if (!first || first.t > target || !(price > 0)) return null;
  let ref: Candle | undefined;
  for (const c of minuteCandles) if (c.t + 60 <= target) ref = c;
  return ref && ref.c > 0 ? (price - ref.c) / ref.c * 100 : null;
}
/** "+1.23%" the way String(format: "%+.2f%%") writes it. */
export const signedPercent = (pct: number) => `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(2)}%`;

/** One network of a currency (`GET /trade/public/currencies/{id}`), for withdrawing and depositing. */
export type Network = {
  key: string; protocol?: string; protocolName?: string; withdrawEnabled?: boolean; withdrawFee?: string; withdrawFeeRatio?: string;
  minWithdraw?: string; depositEnabled?: boolean; minDepositAmount?: string; minConfirmations?: number; depositFeeText?: string;
  status?: string; explorerTransaction?: string; addressRegexes?: string[]; options: Record<string, string>;
};
function parseNetwork(o: Json): Network | null {
  const key = str(o.blockchain_key);
  if (!key) return null;
  const regexes = obj(o.system_options)?.address_validate_regexes;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(o.options) ?? {})) options[k] = loose(v);
  return { key, protocol: str(o.protocol), protocolName: str(o.protocol_name), withdrawEnabled: bool(o.withdraw_enabled), withdrawFee: text(o.withdraw_fee),
    withdrawFeeRatio: text(o.withdraw_fee_ratio), minWithdraw: text(o.min_withdraw_amount), depositEnabled: bool(o.deposit_enabled),
    minDepositAmount: text(o.min_deposit_amount), minConfirmations: int(o.min_confirmations), depositFeeText: text(o.deposit_fee),
    status: str(o.status), explorerTransaction: str(o.explorer_transaction),
    addressRegexes: Array.isArray(regexes) ? regexes.filter((r): r is string => typeof r === "string") : undefined, options };
}
export type Currency = { precision?: number; networks: Network[] };
export function parseCurrency(body: unknown): Currency | null {
  const o = obj(body);
  if (!o || !Array.isArray(o.networks)) return null;
  return { precision: int(o.precision), networks: rows(o.networks, parseNetwork) ?? [] };
}
export const networkName = (n: Network) => n.protocolName ?? n.key;
/** "Binance Smart Chain" → "BSC": the full name unless it's long. */
export const networkShortName = (n: Network) => n.protocolName && [...n.protocolName].length <= 12 ? n.protocolName : n.protocol ?? networkName(n);
export const canWithdraw = (n: Network) => n.withdrawEnabled === true && (n.status ?? "active") === "active";
export const canDeposit = (n: Network) => n.depositEnabled === true && (n.status ?? "active") === "active";
export const minDeposit = (n: Network) => dec(n.minDepositAmount) ?? 0n;
export const depositFee = (n: Network) => dec(n.depositFeeText) ?? 0n;
export const minWithdraw = (n: Network) => dec(n.minWithdraw) ?? 0n;
export const maintenanceMessage = (n: Network) => n.options.maintenance_message || undefined;
/** Same rule as the SafeTrade web client: max(fixed fee, amount × ratio). */
export function withdrawFee(n: Network, amount: Dec): Dec {
  const fixedFee = dec(n.withdrawFee) ?? 0n, ratio = dec(n.withdrawFeeRatio) ?? 0n;
  return ratio > 0n ? decMax(fixedFee, decMul(amount, ratio)) : fixedFee;
}
export function explorerURL(n: Network | undefined, txid: string) {
  if (!n?.explorerTransaction) return undefined;
  try { const url = new URL(n.explorerTransaction.replace("#{txid}", encodeURIComponent(txid))); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; }
  catch { return undefined; }
}
/** The exchange's own regexes when it publishes them (PEARL does), else a checksum check by chain family. */
export function isValidChainAddress(n: Network, a: string) {
  if (n.addressRegexes?.length) return n.addressRegexes.some((r) => { try { return new RegExp(r).test(a); } catch { return false; } });
  const key = n.key.toLowerCase();
  if (key.startsWith("tron")) return isValidTron(a);
  if (key.startsWith("spl") || key.startsWith("sol")) return isValidSolana(a);
  return isValidEVM(a);
}

export type Withdraw = { id: number; amount?: string; fee?: string; destination?: string; txid?: string; state: string; network?: string; createdAt?: number };
function parseWithdraw(o: Json): Withdraw | null {
  const id = int(o.id);
  if (id == null) return null;
  const txid = [str(o.blockchain_txid), str(o.txid)].find((t) => !!t);
  return { id, amount: text(o.amount), fee: text(o.fee), destination: str(o.rid) ?? str(o.address), txid, state: (str(o.state) ?? str(o.status) ?? "").toLowerCase(),
    network: str(o.blockchain_key), createdAt: timestamp(o.created_at) };
}
export const parseWithdraws = (body: unknown) => rows(body, parseWithdraw);
export type WithdrawState = "done" | "canceled" | "failed" | "processing" | "";
export function withdrawState(s: string): WithdrawState {
  if (["succeed", "success", "done", "completed"].includes(s)) return "done";
  if (["canceled", "cancelled"].includes(s)) return "canceled";
  if (["rejected", "failed", "errored"].includes(s)) return "failed";
  return s ? "processing" : "";
}

export type DepositStatus = "credited" | "processing" | "feeRequired" | "failed";
export type Deposit = { id: number; currency?: string; network?: string; amount?: string; txid?: string; status: DepositStatus; createdAt?: number };
function parseDeposit(o: Json): Deposit | null {
  const id = int(o.id);
  if (id == null) return null;
  const currency = str(o.currency), feeCurrency = str(o.fee_currency), credited = loose(o.credited).toLowerCase(), state = (str(o.state) ?? "").toLowerCase();
  let status: DepositStatus = "processing";
  if (credited === "true" || (dec(credited) ?? 0n) > 0n || ["accepted", "collected", "succeed", "success", "done", "completed"].includes(state)) status = "credited";
  else if (["rejected", "canceled", "cancelled", "errored", "failed", "skipped", "refunding"].includes(state)) status = "failed";
  else if (o.fee_paid === false && feeCurrency && currency && feeCurrency.toLowerCase() !== currency.toLowerCase()) status = "feeRequired";
  return { id, currency, network: str(o.blockchain_key), amount: text(o.amount), txid: str(o.txid), status, createdAt: timestamp(o.created_at) };
}
export function parseDeposits(body: unknown) {
  const list = rows(body, parseDeposit);
  return list && list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** A SafeTrade address-book entry ("beneficiary"). Withdrawing to an active one skips the e-mail code. */
export type Beneficiary = { id: number; title: string; currencyID?: string; network?: string; destination?: string; active: boolean };
function parseBeneficiary(o: Json): Beneficiary | null {
  const id = int(o.id);
  if (id == null) return null;
  const destination = (str(o.address) ?? str(obj(o.data)?.address))?.trim();
  const title = [str(o.label), str(o.name), str(o.description)].find((s) => !!s) ?? shortAddr(destination ?? "");
  return { id, title, currencyID: (str(o.currency_id) ?? str(o.currency))?.toLowerCase(), network: str(o.blockchain_key), destination,
    active: (str(o.state) ?? "active").toLowerCase() === "active" };
}
/** A bare list or a `{"data": [...]}` envelope. Throws (with a peek) when rows exist but none can be read. */
export function parseBeneficiaries(body: unknown): Beneficiary[] | string {
  const list = Array.isArray(body) ? body : Array.isArray(obj(body)?.data) ? obj(body)!.data as unknown[] : null;
  if (!list) return "";
  const parsed = rows(list, parseBeneficiary) ?? [];
  if (!parsed.length && list.length) return JSON.stringify(list[0]).slice(0, 160);
  return parsed;
}

// MARK: - order rules (SafeTradeRules.swift)

/** `GET /trade/public/markets/{id}`. Checked live for pearlusdt 2026-10-19. */
export type MarketRules = { amountPrecision: number; pricePrecision: number; minAmount: Dec; minPrice: Dec; maxPrice: Dec };
export const DEFAULT_RULES: MarketRules = { amountPrecision: 4, pricePrecision: 2, minAmount: dec("2")!, minPrice: dec("0.01")!, maxPrice: dec("100000")! };
export function parseRules(body: unknown): MarketRules | null {
  const o = obj(body);
  if (!o) return null;
  const d = DEFAULT_RULES;
  return { amountPrecision: int(o.amount_precision) ?? d.amountPrecision, pricePrecision: int(o.price_precision) ?? d.pricePrecision,
    minAmount: dec(text(o.min_amount)) ?? d.minAmount, minPrice: dec(text(o.min_price)) ?? d.minPrice, maxPrice: dec(text(o.max_price)) ?? d.maxPrice };
}
export type RuleProblem = { kind: "priceDecimals" | "amountDecimals"; places: number } | { kind: "belowMinAmount"; min: Dec } | { kind: "priceOutOfRange"; lo: Dec; hi: Dec };
/** The first rule the typed order breaks; empty / unparseable fields pass. `priceText` null for a market order. */
export function ruleProblem(r: MarketRules, amountText: string, priceText: string | null): RuleProblem | null {
  if (priceText != null) {
    const p = parseAmount(priceText);
    if (p != null) {
      if (decimalPlaces(priceText) > r.pricePrecision) return { kind: "priceDecimals", places: r.pricePrecision };
      if (p > 0n && (p < r.minPrice || p > r.maxPrice)) return { kind: "priceOutOfRange", lo: r.minPrice, hi: r.maxPrice };
    }
  }
  const a = parseAmount(amountText);
  if (a != null && a > 0n) {
    if (decimalPlaces(amountText) > r.amountPrecision) return { kind: "amountDecimals", places: r.amountPrecision };
    if (a < r.minAmount) return { kind: "belowMinAmount", min: r.minAmount };
  }
  return null;
}
export function ruleMessage(p: RuleProblem, tr: Tr) {
  switch (p.kind) {
    case "priceDecimals": return tr("价格最多 {0} 位小数", p.places);
    case "amountDecimals": return tr("数量最多 {0} 位小数", p.places);
    case "belowMinAmount": return tr("最少下单 {0} PEARL", decText(p.min, 18));
    case "priceOutOfRange": return tr("价格需在 {0} – {1} USDT 之间", decText(p.lo, 18), decText(p.hi, 18));
  }
}

// MARK: - order book

export type Level = { price: number; amount: number };
export type Depth = { asks: Level[]; bids: Level[] };
export function parseDepth(body: unknown): Depth | null {
  const o = obj(body);
  if (!o) return null;
  const side = (v: unknown) => (Array.isArray(v) ? v : []).flatMap((r) => {
    if (!Array.isArray(r) || r.length < 2) return [];
    const price = Number(r[0]), amount = Number(r[1]);
    return price > 0 && amount > 0 ? [{ price, amount }] : [];
  });
  return { asks: side(o.asks).sort((a, b) => a.price - b.price), bids: side(o.bids).sort((a, b) => b.price - a.price) };
}
export const sameDepth = (a: Depth | null, b: Depth | null) => JSON.stringify(a) === JSON.stringify(b);

/** SafeTrade's default taker fee (0.1%), charged on what an order receives. */
export const TAKER_FEE = 0.001;
/** Average fill price for `amount` walking `levels` best-first; null when the visible book can't fill it. */
export function averagePrice(amount: number, levels: Level[]) {
  if (!(amount > 0)) return null;
  let left = amount, cost = 0;
  for (const l of levels) {
    const take = Math.min(left, l.amount);
    cost += take * l.price;
    left -= take;
    if (left <= 1e-12) return cost / amount;
  }
  return null;
}
/** How much base a `quote` budget buys walking the asks, each priced a tick higher, budget less the fee. */
export function affordableAmount(quote: number, asks: Level[], tick: number) {
  let budget = quote * (1 - TAKER_FEE), got = 0;
  for (const l of asks) {
    const price = l.price + tick, cost = l.amount * price;
    if (budget >= cost) { budget -= cost; got += l.amount; }
    else return got + budget / price;
  }
  return got;
}

/** One book level with everything resting between it and the best price on its side (TradeDepth.swift). */
export type DepthPoint = { price: number; cumulative: number; cumulativeValue: number };
export type DepthCurve = { bids: DepthPoint[]; asks: DepthPoint[]; bestBid?: number; bestAsk?: number; mid: number; lo: number; hi: number };
const BASE_HALF_WIDTH = 0.10, MIN_LEVELS = 8;
export function depthCurve(depth: Depth): DepthCurve | null {
  const bidLevels = [...depth.bids].sort((a, b) => b.price - a.price), askLevels = [...depth.asks].sort((a, b) => a.price - b.price);
  if (!bidLevels.length && !askLevels.length) return null;
  const bestBid = bidLevels[0]?.price, bestAsk = askLevels[0]?.price;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk!;
  if (!(mid > 0)) return null;
  const w = halfWidth(mid, bidLevels, askLevels), lo = mid * (1 - w), hi = mid * (1 + w), slack = mid * 1e-9;
  return { bestBid, bestAsk, mid, lo, hi, bids: accumulate(bidLevels.filter((l) => l.price >= lo - slack)), asks: accumulate(askLevels.filter((l) => l.price <= hi + slack)) };
}
/** ±10 % by default, widened until each side shows 8 levels, never past the shorter side's last fetched level. */
export function halfWidth(mid: number, bids: Level[], asks: Level[]) {
  const reach = (l?: Level) => l ? Math.abs(l.price - mid) / mid : undefined;
  const kth = (side: Level[]) => reach(side.slice(0, MIN_LEVELS).at(-1));
  const reaches = [reach(bids.at(-1)), reach(asks.at(-1))].filter((x): x is number => x != null);
  const kths = [kth(bids), kth(asks)].filter((x): x is number => x != null);
  const wanted = Math.max(BASE_HALF_WIDTH, kths.length ? Math.max(...kths) : 0);
  const cap = reaches.length ? Math.min(...reaches) : wanted;
  return Math.max(Math.min(wanted, cap), 0.005);
}
function accumulate(levels: Level[]): DepthPoint[] {
  let amount = 0, value = 0;
  return levels.map((l) => { amount += l.amount; value += l.amount * l.price; return { price: l.price, cumulative: amount, cumulativeValue: value }; });
}
export const bidTotal = (c: DepthCurve) => c.bids.at(-1)?.cumulative ?? 0;
export const askTotal = (c: DepthCurve) => c.asks.at(-1)?.cumulative ?? 0;
export const bidShare = (c: DepthCurve) => { const t = bidTotal(c) + askTotal(c); return t > 0 ? bidTotal(c) / t : null; };
/** The level a scrub at `price` points at: a bid at or below the best bid, an ask at or above the best ask,
 *  inside the spread whichever best price is closer; snapped to the nearest drawn level on that side. */
export function levelNear(c: DepthCurve, price: number): { side: "bid" | "ask"; point: DepthPoint } | null {
  const b = c.bids[0], a = c.asks[0];
  let side: "bid" | "ask";
  if (b && a) side = price <= b.price ? "bid" : price >= a.price ? "ask" : price - b.price <= a.price - price ? "bid" : "ask";
  else if (b) side = "bid";
  else if (a) side = "ask";
  else return null;
  const points = side === "bid" ? c.bids : c.asks;
  const point = points.reduce<DepthPoint | null>((best, p) => !best || Math.abs(p.price - price) < Math.abs(best.price - price) ? p : best, null);
  return point && { side, point };
}

// MARK: - why a request was refused

/** `{"errors":["account.withdraw.invalid_otp_code"]}` → the keys. */
export function errorKeys(body: string): string[] {
  const errors = obj(parseJSON(body))?.errors;
  return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : [];
}
/** "authz.not_trusted_ip" → ["authz", "not", "trusted", "ip"]: whole tokens, so "ip" can't hit inside "invalid_permission". */
export const tokens = (key: string) => key.toLowerCase().split(/[._-]/).filter(Boolean);

/** Why SafeTrade refused a signed request (401/403), read from its `authz.*` keys; each has its own fix. */
export type AuthProblem = { kind: "untrustedIP" | "badKey" | "clock" | "firewall" } | { kind: "other"; keys: string[] };
const LIST_TOKENS = ["whitelist", "whitelisted", "allowlist", "allowlisted"];
export function authProblem(status: number, body: string): AuthProblem | null {
  if (status !== 401 && status !== 403) return null;
  const keys = errorKeys(body);
  if (!keys.length) return /<html/i.test(body) ? { kind: "firewall" } : { kind: "other", keys: [] };
  const t = keys.map(tokens);
  if (t.some((x) => x.includes("ip") || x.some((w) => w.includes("trusted") || LIST_TOKENS.includes(w)))) return { kind: "untrustedIP" };
  if (t.some((x) => x.includes("nonce"))) return { kind: "clock" };
  if (t.some((x) => x.some((w) => ["apikey", "key", "signature", "secret"].includes(w)))) return { kind: "badKey" };
  return { kind: "other", keys };
}
/** SafeTrade answers a signed request with an API key it doesn't know by 404 `record.not_found` (checked live
 *  2026-10-28), not 401. Only read so on the balances call, where nothing else can be "not found": the iOS
 *  app shows it as a raw HTTP 404. */
export const unknownKey = (status: number, body: string) => status === 404 && errorKeys(body).includes("record.not_found");
/** That reply recast as the refusal it is, so it reads as a wrong key. */
export const UNKNOWN_KEY: { kind: "http"; status: number; body: string } = { kind: "http", status: 401, body: JSON.stringify({ errors: ["authz.unknown_api_key"] }) };
export function authMessage(p: AuthProblem, tr: Tr) {
  switch (p.kind) {
    case "untrustedIP": return tr("SafeTrade 拒绝了当前网络：这个 API 密钥绑定了 Trusted IPs（IP 白名单），而你现在的 IP 不在名单里。");
    case "badKey": return tr("SafeTrade 不认这个 API 密钥：Key 或 Secret 不对，或者密钥已停用。");
    case "clock": return tr("签名已过期：本机时间和 SafeTrade 相差太多，请打开「自动设置时间」后重试。");
    case "firewall": return tr("请求被 SafeTrade 的防火墙（Cloudflare）拦截，通常是当前网络或代理的出口被拦，换个网络再试。");
    case "other": return tr("SafeTrade 拒绝了这个请求（{0}）", p.keys.length ? p.keys.join(", ") : "401/403");
  }
}

/** Human copy for the error keys expected around withdrawals, deposits and orders; unknown keys → undefined. */
export function keyMessage(key: string, tr: Tr): string | undefined {
  if (key.startsWith("market.")) return orderMessage(key, tr);
  const deposit = depositMessage(key, tr);
  if (deposit) return deposit;
  switch (key.replace("account.beneficiary.", "account.withdraw.")) {
    case "account.withdraw.missing_email_code": return tr("请填写邮箱验证码");
    case "account.withdraw.missing_phone_code": return tr("请填写短信验证码");
    case "account.withdraw.missing_otp_code": return tr("请填写谷歌验证码（2FA）");
    case "account.withdraw.invalid_otp_code": return tr("谷歌验证码（2FA）错误");
    case "account.withdraw.invalid_code": return tr("验证码错误或已过期");
    case "account.withdraw.insufficient_balance": return tr("SafeTrade 可用余额不足");
    case "account.withdraw.limit_exceeded": return tr("超出今日提现额度");
    case "account.withdraw.withdraw_disabled": return tr("SafeTrade 暂停了这条链的提现");
    case "account.withdraw.address_validation": case "account.withdraw.missing_address": case "account.withdraw.missing_rid": return tr("收款地址无效");
    case "account.withdraw.blocked_address_send_back": return tr("不能提现到 SafeTrade 自己的充值地址");
    case "account.withdraw.non_round_amount": return tr("数量的小数位太多");
  }
  return undefined;
}
function depositMessage(key: string, tr: Tr) {
  switch (key) {
    case "account.deposit_address.network_doesnt_exist": return tr("SafeTrade 不支持用这条链充值");
    case "account.currency.deposit_disabled": return tr("SafeTrade 暂停了这个币种的充值");
    case "account.wallet.not_found": return tr("SafeTrade 这条链的充值钱包暂时不可用，请稍后再试");
  }
  const t = tokens(key);
  return key.startsWith("account.deposit") && (t.includes("2fa") || t.includes("otp")) ? tr("SafeTrade 要求先开启谷歌验证（2FA）才能生成充值地址") : undefined;
}
function orderMessage(key: string, tr: Tr) {
  const t = new Set(tokens(key)), has = (w: string) => t.has(w);
  if (has("insufficient") && has("balance")) return tr("SafeTrade 可用余额不足");
  if (has("liquidity")) return tr("盘口深度不够，市价单成交不了这么多，请减少数量或改用限价单");
  if (has("round") && has("price")) return tr("价格的小数位太多");
  if (has("round") && (has("amount") || has("volume"))) return tr("数量的小数位太多");
  if ((has("amount") || has("volume")) && (has("min") || has("less") || has("small"))) return tr("数量低于交易所的最小下单量");
  if (has("price") && (has("min") || has("max") || has("range") || has("less") || has("greater"))) return tr("价格超出交易所允许的范围");
  return undefined;
}

/** What went wrong with a SafeTrade call. */
export type TradeFailure =
  | { kind: "noCredentials" }
  | { kind: "http"; status: number; body: string }
  | { kind: "decode"; detail: string }
  /** Never reached the exchange (offline, DNS, refused, TLS): safe to retry. */
  | { kind: "unreached" }
  /** An order POST may have been booked before its reply was lost. */
  | { kind: "placedUnverified" }
  /** A withdrawal POST may have been made before its reply was lost. */
  | { kind: "withdrawUnverified" }
  /** The device check before a withdrawal didn't pass (the shell's code). */
  | { kind: "device"; code: string }
  | { kind: "failed"; code: string };
export class TradeError extends Error {
  failure: TradeFailure;
  constructor(failure: TradeFailure) { super(failure.kind); this.failure = failure; }
}
export const failureOf = (e: unknown): TradeFailure => e instanceof TradeError ? e.failure : { kind: "failed", code: e instanceof Error ? e.message : String(e) };
export const authProblemOf = (f: TradeFailure) => f.kind === "http" ? authProblem(f.status, f.body) : null;
export function failureMessage(f: TradeFailure, tr: Tr): string {
  switch (f.kind) {
    case "withdrawUnverified": return tr("提现请求可能已提交但未能确认结果，请先看下方提现记录，切勿重复提交。");
    case "placedUnverified": return tr("订单可能已提交但未能确认结果，请到下方订单列表核对，切勿重复下单。");
    case "noCredentials": return tr("未配置 SafeTrade API 密钥");
    case "decode": return tr("解析失败: {0}", f.detail);
    case "unreached": return tr("暂时无法连接 SafeTrade（网络问题）");
    case "device": return f.code === "no_lock_screen" ? tr("请先在系统设置里设置锁屏密码，提现前要用它验证身份") : tr("身份验证未通过，已取消提现");
    case "failed": return tr("暂时无法连接 SafeTrade（网络问题）");
    case "http": {
      const auth = authProblem(f.status, f.body);
      if (auth) return authMessage(auth, tr);
      for (const k of errorKeys(f.body)) { const m = keyMessage(k, tr); if (m) return m; }
      return `HTTP ${f.status}: ${f.body.slice(0, 120)}`;
    }
  }
}

/** A pasted key or secret without the spaces, line breaks and invisible characters copying can add (none
 *  belongs in one); `isCredential` then tells whether the shell will take it (BRIDGE.md `safetrade.save`). */
export const cleanCredential = (raw: string) => raw.replace(/[\s\u00ad\u180e\u200b-\u200f\u2028-\u202f\u2060-\u2064\ufeff]/g, "");
export const isCredential = (text: string) => text.length >= 1 && text.length <= 256 && /^[\x21-\x7e]+$/.test(text);

/** Cloudflare's `/cdn-cgi/trace`: `ip=` is the address SafeTrade's edge sees. */
export function traceIP(body: string) {
  for (const line of body.split(/\r?\n/)) if (line.startsWith("ip=")) { const ip = line.slice(3).trim(); return ip || null; }
  return null;
}

// MARK: - addresses (WalletKit PRLAddress, Trade/ChainAddress.swift)

/** A mainnet PRL address: bech32m, hrp "prl", witness v1, 32-byte program (Taproot). */
export function isPRLAddress(raw: string, hrp = "prl") {
  const s = raw.trim();
  if (s.length < 14 || s.length > 90 || /[^\x21-\x7e]/.test(s)) return false;
  const lower = s.toLowerCase();
  if (s !== lower && s !== s.toUpperCase()) return false;
  const sep = lower.lastIndexOf("1");
  if (sep < 0 || lower.slice(0, sep) !== hrp) return false;
  const data = [...lower.slice(sep + 1)].map((c) => BECH32_CHARSET.indexOf(c));
  if (data.length < 7 || data.includes(-1)) return false;
  const codes = [...hrp].map((c) => c.charCodeAt(0));
  if (bech32Polymod([...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31), ...data]) !== 0x2bc830a3) return false;
  const payload = data.slice(0, -6);
  if (payload[0] !== 1) return false;
  let acc = 0, bits = 0;
  const program: number[] = [];
  for (const v of payload.slice(1)) {
    acc = ((acc << 5) | v) & 0xfff;
    bits += 5;
    while (bits >= 8) { bits -= 8; program.push((acc >> bits) & 0xff); }
  }
  return bits < 5 && ((acc << (8 - bits)) & 0xff) === 0 && program.length === 32;
}

/** Ethereum and the EVM chains: 0x + 40 hex; a mixed-case address must match its EIP-55 checksum. */
export function isValidEVM(a: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const hex = a.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  return eip55(hex.toLowerCase()) === hex;
}
export function eip55(lowerHex: string) {
  const hash = keccak256(new TextEncoder().encode(lowerHex));
  return [...lowerHex].map((ch, i) => {
    const nibble = i % 2 === 0 ? hash[i >> 1] >> 4 : hash[i >> 1] & 0x0f;
    return /[a-f]/.test(ch) && nibble >= 8 ? ch.toUpperCase() : ch;
  }).join("");
}
/** TRON: base58check of 0x41 + 20 bytes; checksum = first 4 bytes of sha256². */
export function isValidTron(a: string) {
  const b = a.startsWith("T") ? base58Decode(a) : null;
  if (!b || b.length !== 25 || b[0] !== 0x41) return false;
  const check = sha256(sha256(b.slice(0, 21)));
  return check.slice(0, 4).every((x, i) => x === b[21 + i]);
}
/** Solana: base58 of a 32-byte public key. */
export const isValidSolana = (a: string) => a.length >= 32 && a.length <= 44 && base58Decode(a)?.length === 32;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array | null {
  if (!s) return null;
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let j = bytes.length - 1; j >= 0; j--) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.unshift(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  while (s[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

/** Keccak-256 (Ethereum's original padding, not SHA3-256). */
export function keccak256(input: Uint8Array): Uint8Array {
  const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const ROT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
  const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
  const MASK = (1n << 64n) - 1n, rate = 136;
  const rotl = (x: bigint, n: number) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;
  const msg = [...input, 0x01];
  while (msg.length % rate) msg.push(0);
  msg[msg.length - 1] |= 0x80;
  const s = new Array<bigint>(25).fill(0n), c = new Array<bigint>(5).fill(0n);
  for (let block = 0; block < msg.length; block += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(msg[block + i * 8 + b]) << BigInt(8 * b);
      s[i] ^= lane;
    }
    for (let round = 0; round < 24; round++) {
      for (let i = 0; i < 5; i++) c[i] = s[i] ^ s[i + 5] ^ s[i + 10] ^ s[i + 15] ^ s[i + 20];
      for (let i = 0; i < 5; i++) { const d = c[(i + 4) % 5] ^ rotl(c[(i + 1) % 5], 1); for (let j = 0; j < 25; j += 5) s[j + i] ^= d; }
      let t = s[1];
      for (let i = 0; i < 24; i++) { const j = PI[i], next = s[j]; s[j] = rotl(t, ROT[i]); t = next; }
      for (let j = 0; j < 25; j += 5) {
        for (let i = 0; i < 5; i++) c[i] = s[j + i];
        for (let i = 0; i < 5; i++) s[j + i] ^= (~c[(i + 1) % 5] & MASK) & c[(i + 2) % 5];
      }
      s[0] ^= RC[round];
    }
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((s[i] >> BigInt(8 * b)) & 0xffn);
  return out;
}

/** SHA-256 (sync, for the TRON checksum). */
export function sha256(data: Uint8Array): Uint8Array {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = data.length, padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(data); padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, len * 8); view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  const w = new Uint32Array(64), r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  H.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}
