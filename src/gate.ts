// Gate REST API v4 (api.gateio.ws) pure wire parsers and formatters for PEARL/USDT (`PEARL_USDT`),
// mirroring prl-hub Sources/Trade/GateClient.swift. No bridge and no React here so test/gate.test.ts
// runs under Node. Note: Gate's Pearl pair is PEARL_USDT (PRL_USDT is an unrelated token).
import {
  DEFAULT_GATE_RULES, dec, decNumber, decOf, decText, parseDepth, parseJSON, rows, sha256, shortAddr, signedPercent, text, timestamp,
  type AuthProblem, type Balance, type Beneficiary, type Currency, type Deposit, type DepositAddress, type DepositStatus,
  type MarketRules, type Network, type Order, type Ticker, type Tr, type TradeFailure, type Withdraw,
} from "./safetrade.ts";
export { gateInterval, parseGateCandles } from "./kline.ts";

export const GATE_PAIR = "PEARL_USDT";
export const GATE_WEB_TRADE_URL = "https://www.gate.com/trade/PEARL_USDT";
export const GATE_API_KEYS_URL = "https://www.gate.com/myaccount/apikeys";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
const str = (v: unknown) => typeof v === "string" ? v : undefined;
const int = (v: unknown) => typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
const loose = (v: unknown) => typeof v === "boolean" ? String(v) : text(v) ?? "";

/** Deterministic safe integer ID for Gate string IDs so Order/Deposit/Withdraw/Beneficiary keep numeric `id`s. */
export function syntheticIntID(raw: string): number {
  if (/^\d{1,15}$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  const digest = sha256(new TextEncoder().encode(raw));
  let v = 0;
  for (let i = 0; i < 6; i++) v = v * 256 + digest[i];
  return (v % 0x1fff_ffff_ffff) + 1;
}

export function parseGateTicker(body: unknown): Ticker | null {
  const row = Array.isArray(body)
    ? (body.map(obj).find((r) => r?.currency_pair === GATE_PAIR) ?? obj(body[0]))
    : obj(body);
  if (!row) return null;
  const rawChg = str(row.change_percentage)?.trim().replace(/%/g, "");
  const chgNum = rawChg != null && rawChg !== "" ? Number(rawChg) : NaN;
  return {
    last: text(row.last),
    buy: text(row.lowest_ask),
    sell: text(row.highest_bid),
    high: text(row.high_24h),
    low: text(row.low_24h),
    vol: text(row.base_volume),
    change: Number.isFinite(chgNum) ? signedPercent(chgNum) : undefined,
  };
}

export function parseGateRules(body: unknown): MarketRules | null {
  const o = obj(body);
  if (!o) return null;
  const d = DEFAULT_GATE_RULES;
  const pricePrecision = int(o.precision) ?? d.pricePrecision;
  const amountPrecision = int(o.amount_precision) ?? d.amountPrecision;
  const minAmount = dec(text(o.min_base_amount)) ?? d.minAmount;
  const minQuote = dec(text(o.min_quote_amount)) ?? d.minQuote;
  const feePct = Number(text(o.fee));
  const takerFee = Number.isFinite(feePct) && feePct >= 0 ? feePct / 100 : d.takerFee;
  const upRate = dec(text(o.up_rate)) ?? d.upRate;
  const downRate = dec(text(o.down_rate)) ?? d.downRate;
  const minPrice = decOf(10 ** -Math.max(0, Math.min(pricePrecision, 12)));
  return {
    amountPrecision,
    pricePrecision,
    minAmount,
    minPrice: minPrice > 0n ? minPrice : d.minPrice,
    maxPrice: d.maxPrice,
    minQuote,
    takerFee,
    upRate: upRate && upRate > 0n ? upRate : d.upRate,
    downRate: downRate && downRate > 0n ? downRate : d.downRate,
  };
}

export const parseGateDepth = parseDepth;

export function parseGateBalances(body: unknown): Balance[] | null {
  if (!Array.isArray(body)) return null;
  const out: Balance[] = [];
  for (const r of body) {
    const o = obj(r), currency = o && str(o.currency), available = o && text(o.available), locked = o && text(o.locked);
    if (!o || !currency || available == null || locked == null) return null;
    out.push({ currency: currency.toLowerCase(), balance: available, locked });
  }
  return out;
}

export type ParsedGateOrder = { order: Order; filledAmount: number; finishAs?: string };

export function parseGateOrderDetail(o: Json): ParsedGateOrder | null {
  const rawId = loose(o.id).trim();
  const id = rawId ? syntheticIntID(rawId) : undefined;
  const tif = (str(o.time_in_force) ?? "").toLowerCase();
  const rawType = (str(o.type) ?? "limit").toLowerCase();
  const isIOCMarket = rawType === "limit" && tif === "ioc";
  const mappedType = isIOCMarket ? "market" : rawType;
  const filled = Number(text(o.filled_amount)) || 0;
  const filledTotal = Number(text(o.filled_total)) || 0;
  const status = (str(o.status) ?? "").toLowerCase();
  const state = status === "open" ? "wait"
    : status === "closed" ? "done"
    : status === "cancelled" || status === "canceled" ? (filled > 0 ? "done" : "cancel")
    : status || "wait";
  const avgDeal = text(o.avg_deal_price);
  const avgPrice = avgDeal && Number(avgDeal) > 0
    ? avgDeal
    : filled > 0 && filledTotal > 0 ? (filledTotal / filled).toFixed(4) : undefined;
  const side = str(o.side)?.toLowerCase();
  const originAmount = (rawType === "market" && side === "buy" && filled > 0)
    ? text(o.filled_amount)
    : (isIOCMarket && state === "done" && filled > 0)
      ? (text(o.filled_amount) ?? text(o.amount))
      : text(o.amount);
  const placedAt = timestamp(o.create_time_ms) ?? timestamp(o.create_time) ?? timestamp(o.update_time_ms) ?? timestamp(o.update_time);
  return {
    order: {
      id,
      rawId: rawId || undefined,
      market: str(o.currency_pair) ?? GATE_PAIR,
      side,
      type: mappedType,
      price: mappedType === "market" ? undefined : text(o.price),
      state,
      originAmount,
      avgPrice,
      placedAt,
    },
    filledAmount: filled,
    finishAs: str(o.finish_as)?.toLowerCase(),
  };
}

export function parseGateOrder(o: Json): Order | null {
  return parseGateOrderDetail(o)?.order ?? null;
}

export function parseGateOrders(body: unknown): Order[] | null {
  return rows(body, parseGateOrder);
}

/** Limit orders use GTC; market orders use Limit + IOC capped at `maxPrice` so `amount` is always PEARL
 *  and the user's slippage cap/floor is enforced server-side. */
export function gateOrderJSON(side: string, amount: string, price: string | null, type: "limit" | "market", maxPrice: string | null): string {
  if (type === "market") {
    return JSON.stringify({
      currency_pair: GATE_PAIR,
      side,
      type: "limit",
      time_in_force: "ioc",
      amount,
      price: maxPrice ?? "",
    });
  }
  return JSON.stringify({
    currency_pair: GATE_PAIR,
    side,
    type: "limit",
    time_in_force: "gtc",
    amount,
    price: price ?? "",
  });
}

function explorerTemplate(chain: string): string | undefined {
  switch (chain.toUpperCase()) {
    case "PEARL": case "PRL": return "https://blockbook.pearlresearch.ai/tx/#{txid}";
    case "ETH": return "https://etherscan.io/tx/#{txid}";
    case "BSC": return "https://bscscan.com/tx/#{txid}";
    case "OPBNB": return "https://opbnb.bscscan.com/tx/#{txid}";
    case "TRX": return "https://tronscan.org/#/transaction/#{txid}";
    case "SOL": return "https://solscan.io/tx/#{txid}";
    case "ARBEVM": return "https://arbiscan.io/tx/#{txid}";
    case "OPETH": return "https://optimistic.etherscan.io/tx/#{txid}";
    case "MATIC": return "https://polygonscan.com/tx/#{txid}";
    case "AVAX_C": return "https://snowtrace.io/tx/#{txid}";
    case "CELO": return "https://celoscan.io/tx/#{txid}";
    case "KAIA": return "https://kaiascan.io/tx/#{txid}";
    case "KAVAEVM": return "https://kavascan.com/tx/#{txid}";
    case "NEAR": return "https://nearblocks.io/txns/#{txid}";
    case "TON": case "GRAM": return "https://tonviewer.com/transaction/#{txid}";
    default: return undefined;
  }
}

function parsePercentRatio(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/%/g, "");
  const d = dec(cleaned);
  if (d == null || d <= 0n) return "0";
  return decText(d / 100n, 8);
}

function mergedMinWithdraw(chainMin?: string, coinMin?: string): string | undefined {
  if (chainMin && coinMin) {
    const da = dec(chainMin), db = dec(coinMin);
    if (da != null && db != null) return da >= db ? chainMin : coinMin;
    return chainMin;
  }
  return chainMin ?? coinMin;
}

export function parseGateCurrency(chainsBody: unknown, statusBody?: unknown, useChinese = false, currency = "PEARL"): Currency | null {
  if (!Array.isArray(chainsBody)) return null;
  const statusRow = Array.isArray(statusBody) ? obj(statusBody[0]) : obj(statusBody);
  const fixOnChains = obj(statusRow?.withdraw_fix_on_chains);
  const pctOnChains = obj(statusRow?.withdraw_percent_on_chains);
  let seenPrecision = 0;
  const networks: Network[] = [];
  for (const raw of chainsBody) {
    const ch = obj(raw), chain = ch && str(ch.chain);
    if (!ch || !chain) continue;
    const active = (int(ch.is_disabled) ?? 0) === 0;
    const decPlaces = int(loose(ch.decimal));
    const clampedDec = decPlaces != null && decPlaces > 0 ? Math.min(Math.max(decPlaces, 2), 8) : undefined;
    if (active && clampedDec != null) seenPrecision = Math.max(seenPrecision, clampedDec);
    const canDep = active && (int(ch.is_deposit_disabled) ?? 0) === 0;
    const canWdr = active && (int(ch.is_withdraw_disabled) ?? 0) === 0;
    const cn = str(ch.name_cn)?.trim(), en = str(ch.name_en)?.trim();
    const label = (useChinese ? cn : en) || en || chain;
    const fix = (fixOnChains && text(fixOnChains[chain])) ?? text(statusRow?.withdraw_fix);
    const pctRaw = (pctOnChains && loose(pctOnChains[chain])) || str(statusRow?.withdraw_percent);
    const minWdr = mergedMinWithdraw(text(ch.withdraw_amount_min), text(statusRow?.withdraw_amount_mini));
    const requiresMemo = (int(ch.is_tag) ?? 0) === 1;
    const options: Record<string, string> = {};
    if (requiresMemo) options.requires_memo = "true";
    if (clampedDec != null) options.precision = String(clampedDec);
    networks.push({
      key: chain,
      protocol: chain,
      protocolName: label,
      withdrawEnabled: canWdr,
      withdrawFee: fix,
      withdrawFeeRatio: parsePercentRatio(pctRaw),
      minWithdraw: minWdr,
      depositEnabled: canDep,
      depositFeeText: "0",
      status: active ? "active" : "disabled",
      explorerTransaction: explorerTemplate(chain),
      requiresMemo,
      precision: clampedDec,
      options,
    });
  }
  const maxPrecision = seenPrecision > 0 ? seenPrecision : (currency.toUpperCase() === "PEARL" ? 8 : 6);
  return { precision: maxPrecision, networks };
}

export function parseGateDepositAddress(body: unknown, currency: string, network: string): DepositAddress | null {
  const env = obj(body);
  if (!env) return null;
  const multi = Array.isArray(env.multichain_addresses) ? env.multichain_addresses.map(obj).filter((x): x is Json => !!x) : null;
  if (multi && multi.length > 0) {
    const hit = multi.find((m) => (str(m.chain) ?? "").toLowerCase() === network.toLowerCase());
    if (!hit) return { network, currencies: [currency] };
    const rawAddr = (str(hit.address) ?? "").trim();
    if ((int(hit.obtain_failed) ?? 0) !== 0 || !rawAddr || /\s/.test(rawAddr)) return { network, currencies: [currency] };
    const memo = (str(hit.payment_id) ?? "").trim();
    return { address: memo ? `${rawAddr}?memo=${memo}` : rawAddr, network, currencies: [currency] };
  }
  const fallback = (str(env.address) ?? "").trim();
  const cleanFallback = !fallback || /\s/.test(fallback) ? undefined : fallback;
  return { address: cleanFallback, network, currencies: [currency] };
}

function mapLedgerStatus(raw?: string): "done" | "cancelled" | "failed" | "processing" {
  switch ((raw ?? "").toUpperCase()) {
    case "DONE": return "done";
    case "CANCEL": case "CANCELED": case "CANCELLED": return "cancelled";
    case "FAIL": case "FAILED": case "INVALID": case "REJECT": case "REJECTED": return "failed";
    default: return "processing";
  }
}

export function parseGateDeposits(body: unknown, currency: string): Deposit[] | null {
  if (!Array.isArray(body)) return null;
  const out: Deposit[] = [];
  body.forEach((raw, idx) => {
    const r = obj(raw);
    if (!r) return;
    const rawId = loose(r.id) || String(idx);
    const st = mapLedgerStatus(str(r.status));
    const status: DepositStatus = st === "done" ? "credited" : st === "processing" ? "processing" : "failed";
    out.push({
      id: syntheticIntID(rawId),
      currency: (str(r.currency) ?? currency).toLowerCase(),
      network: str(r.chain),
      amount: text(r.amount),
      txid: str(r.txid),
      status,
      createdAt: timestamp(r.timestamp),
    });
  });
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function parseGateWithdraws(body: unknown): Withdraw[] | null {
  if (!Array.isArray(body)) return null;
  const out: Withdraw[] = [];
  body.forEach((raw, idx) => {
    const r = obj(raw);
    if (!r) return;
    const rawId = loose(r.id) || String(idx);
    out.push({
      id: syntheticIntID(rawId),
      rawId,
      amount: text(r.amount),
      fee: text(r.fee),
      destination: str(r.address),
      txid: str(r.txid),
      state: mapLedgerStatus(str(r.status)),
      network: str(r.chain),
      createdAt: timestamp(r.timestamp),
    });
  });
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function normalizedSavedCurrency(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.includes("universal") || lower.includes("通用")) return undefined;
  return lower;
}

export function parseGateSavedAddresses(body: unknown, _currency?: string): Beneficiary[] | null {
  if (!Array.isArray(body)) return null;
  const out: Beneficiary[] = [];
  body.forEach((raw, idx) => {
    const r = obj(raw);
    if (!r) return;
    const destination = str(r.address)?.trim();
    if (!destination) return;
    const chain = str(r.chain);
    const key = `${chain ?? ""}|${destination}|${idx}`;
    const verified = loose(r.verified);
    const active = verified === "1" || verified.toLowerCase() === "true";
    const memo = str(r.tag)?.trim() || undefined;
    out.push({
      id: syntheticIntID(key),
      title: str(r.name)?.trim() || shortAddr(destination),
      currencyID: normalizedSavedCurrency(str(r.currency)),
      network: chain,
      destination,
      active,
      memo,
    });
  });
  return out;
}

export function gateErrorPayload(body: string): { label?: string; message?: string } {
  const o = obj(parseJSON(body));
  const label = str(o?.label)?.trim();
  const message = (str(o?.message) ?? str(o?.detail))?.trim();
  return { label: label || undefined, message: message || undefined };
}

export function isGateAddressWhitelistError(body: string): boolean {
  const { label: rawLabel, message } = gateErrorPayload(body);
  const label = (rawLabel ?? "").toUpperCase();
  const lowerMsg = (message ?? "").toLowerCase();
  if (label.includes("ADDRESS_NOT_WHITELIST") || label.includes("NOT_IN_WHITELIST")) return true;
  if (lowerMsg.includes("address") && lowerMsg.includes("whitelist")) return true;
  return false;
}

export function gateAuthProblem(status: number, body: string): AuthProblem | null {
  if (status !== 401 && status !== 403) return null;
  if (isGateAddressWhitelistError(body)) return null;
  const { label: rawLabel, message } = gateErrorPayload(body);
  const label = (rawLabel ?? "").toUpperCase();
  const lowerMsg = (message ?? "").toLowerCase();
  if (!label && /<html/i.test(body)) return { kind: "firewall" };
  if (label === "INVALID_IP" || (lowerMsg.includes("ip") && (lowerMsg.includes("whitelist") || lowerMsg.includes("trusted") || lowerMsg.includes("not allowed") || lowerMsg.includes("forbidden")))) {
    return { kind: "untrustedIP" };
  }
  if (label === "REQUEST_EXPIRED" || label === "INVALID_TIMESTAMP") return { kind: "clock" };
  if (["INVALID_KEY", "INVALID_SIGNATURE", "INVALID_CREDENTIALS", "KEY_EXPIRED"].includes(label)) return { kind: "badKey" };
  return { kind: "other", keys: label ? [label] : [] };
}

export function gateAuthMessage(p: AuthProblem, body: string, tr: Tr): string {
  switch (p.kind) {
    case "untrustedIP": return tr("Gate 拒绝了当前网络：这个 API 密钥绑定了 IP 白名单，而你现在的 IP 不在名单里。");
    case "badKey": return tr("Gate 不认这个 API 密钥：Key 或 Secret 不对，或者密钥已停用。");
    case "clock": return tr("签名已过期：本机时间和 Gate 相差太多，请打开「自动设置时间」后重试。");
    case "firewall": return tr("请求被 Gate 的防火墙拦截，通常是当前网络或代理的出口被拦，换个网络再试。");
    case "other": {
      const detail = gateErrorPayload(body).message ?? (p.keys.length ? p.keys.join(", ") : "401/403");
      return tr("Gate 拒绝了这个请求（{0}）", detail);
    }
  }
}

export function gateFailureMessage(f: TradeFailure, tr: Tr): string {
  switch (f.kind) {
    case "withdrawUnverified": return tr("提现请求可能已提交但未能确认结果，请先看下方提现记录，切勿重复提交。");
    case "placedUnverified": return tr("订单可能已提交但未能确认结果，请到下方订单列表核对，切勿重复下单。");
    case "noCredentials": return tr("未配置 Gate API 密钥");
    case "decode": return tr("解析失败: {0}", f.detail);
    case "unreached": return tr("暂时无法连接 Gate（网络问题）");
    case "device": return f.code === "no_lock_screen" ? tr("请先在系统设置里设置锁屏密码，提现前要用它验证身份") : tr("身份验证未通过，已取消提现");
    case "failed": return tr("暂时无法连接 Gate（网络问题）");
    case "http": {
      if (isGateAddressWhitelistError(f.body)) {
        return tr("收款地址不在 Gate 提币白名单中。请先到 Gate 网站将该地址加入白名单并完成验证。");
      }
      const auth = gateAuthProblem(f.status, f.body);
      if (auth) return gateAuthMessage(auth, f.body, tr);
      const { label: rawLabel, message } = gateErrorPayload(f.body);
      switch ((rawLabel ?? "").toUpperCase()) {
        case "BALANCE_NOT_ENOUGH": case "INSUFFICIENT_BALANCE": return tr("Gate 可用余额不足");
        case "AMOUNT_TOO_LITTLE": return tr("数量低于交易所的最小下单量");
        case "AMOUNT_TOO_MUCH": return tr("超出今日提现额度");
        case "INVALID_PRECISION": return tr("数量的小数位太多");
        case "INVALID_CURRENCY": case "WITHDRAWAL_DISABLED": return tr("Gate 暂停了这条链的提现");
        case "INVALID_ADDRESS": return tr("收款地址无效");
        case "IOC_NOT_FILLED": return tr("盘口深度不够，市价单成交不了这么多，请减少数量或改用限价单");
        default: return message ? `Gate: ${message}` : `HTTP ${f.status}: ${f.body.slice(0, 120)}`;
      }
    }
  }
}

export const gateDecimalNumber = decNumber;
