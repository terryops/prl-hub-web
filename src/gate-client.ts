// Gate API v4 requests for the Android 交易 tab, through the shell (BRIDGE.md `gate.*`).
// Mirroring prl-hub Sources/Trade/GateClient.swift and safetrade-client.ts.
import { BridgeError, hasBridge, nativeCall } from "./android-bridge.ts";
import { publicGet } from "./trade-fetch.ts";
import { publicIP as safetradePublicIP, type CredentialCheck, type KeyStatus } from "./safetrade-client.ts";
import { TradeError, parseJSON, traceIP, type Balance } from "./safetrade.ts";
import {
  GATE_PAIR, gateAuthProblem, gateInterval, gateOrderJSON, parseGateBalances, parseGateCandles, parseGateCurrency,
  parseGateDepositAddress, parseGateDeposits, parseGateDepth, parseGateOrderDetail, parseGateOrders, parseGateRules,
  parseGateSavedAddresses, parseGateTicker, parseGateWithdraws,
} from "./gate.ts";

type Auth = "none" | "stored" | { key: string; secret: string };
type Request = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string>;
  json?: string;
  auth?: Auth;
  confirm?: { title: string; subtitle?: string };
};

async function send(path: string, r: Request = {}): Promise<string> {
  const method = r.method ?? "GET", auth = r.auth ?? "none";
  // The website (no shell): public reads from the browser; anything signed fails as having no key.
  if (!hasBridge()) {
    if (method === "GET" && auth === "none") return publicGet("https://api.gateio.ws", path, r.query);
    throw new TradeError({ kind: "noCredentials" });
  }
  const params: Record<string, unknown> = { method, path, auth: typeof auth === "string" ? auth : "explicit" };
  if (typeof auth === "object") { params.key = auth.key; params.secret = auth.secret; }
  if (r.query) params.query = r.query;
  if (r.json) params.json = r.json;
  if (r.confirm) { params.title = r.confirm.title; if (r.confirm.subtitle) params.subtitle = r.confirm.subtitle; }
  let reply: { status: number; body: string };
  try {
    reply = await nativeCall<{ status: number; body: string }>("gate.request", params, method === "GET" ? 60000 : 0);
  } catch (e) {
    const code = e instanceof BridgeError ? e.code : "failed";
    if (code === "no_credentials") throw new TradeError({ kind: "noCredentials" });
    if (code === "unconfirmed") throw new TradeError({ kind: "failed", code });
    if (code === "unreached" || code === "timeout") throw new TradeError({ kind: "unreached" });
    if (r.confirm && code !== "bad_params") throw new TradeError({ kind: "device", code });
    if (code === "unavailable") throw new TradeError({ kind: "unreached" });
    throw new TradeError({ kind: "failed", code });
  }
  if (reply.status >= 200 && reply.status < 300) return reply.body;
  throw new TradeError({ kind: "http", status: reply.status, body: reply.body ?? "" });
}

const json = (body: string) => parseJSON(body);
const peek = (body: string, n = 120) => body.slice(0, n);

function ambiguous(e: unknown) {
  if (!(e instanceof TradeError)) return false;
  const f = e.failure;
  return (f.kind === "failed" && f.code === "unconfirmed") || (f.kind === "http" && (f.status === 0 || f.status >= 500));
}

// MARK: keys

export const keyStatus = () => nativeCall<KeyStatus>("gate.keys");
export const saveKeys = (key: string, secret: string) => nativeCall<{ masked: string }>("gate.save", { key, secret }).then((r) => r.masked);
export const clearKeys = () => nativeCall("gate.clear").then(() => undefined);

export async function verifyCredentials(key: string, secret: string): Promise<CredentialCheck> {
  try {
    await send("/api/v4/spot/accounts", { auth: { key, secret } });
    return { kind: "ok" };
  } catch (e) {
    const f = e instanceof TradeError ? e.failure : null;
    if (f?.kind === "http") {
      const problem = gateAuthProblem(f.status, f.body);
      return problem ? { kind: "rejected", problem } : { kind: "serverError", status: f.status };
    }
    return { kind: "network" };
  }
}

export async function publicIP(): Promise<string> {
  try {
    const r = await fetch("https://pearlhub.net/cdn-cgi/trace", { credentials: "omit", cache: "no-store" });
    if (r.ok) {
      const ip = traceIP(await r.text());
      if (ip) return ip;
    }
  } catch { /* Fall back to shell trace. */ }
  return safetradePublicIP();
}

// MARK: reads

export async function balances(): Promise<Balance[]> {
  const body = await send("/api/v4/spot/accounts", { auth: "stored" });
  const list = parseGateBalances(json(body));
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}

export async function ticker() {
  const body = await send("/api/v4/spot/tickers", { query: { currency_pair: GATE_PAIR } });
  const t = parseGateTicker(json(body));
  if (!t) throw new TradeError({ kind: "decode", detail: peek(body) });
  return t;
}

export async function marketRules() {
  const body = await send(`/api/v4/spot/currency_pairs/${GATE_PAIR}`);
  const r = parseGateRules(json(body));
  if (!r) throw new TradeError({ kind: "decode", detail: peek(body) });
  return r;
}

export async function depth(limit = 100) {
  const body = await send("/api/v4/spot/order_book", { query: { currency_pair: GATE_PAIR, limit: String(limit) } });
  const d = parseGateDepth(json(body));
  if (!d) throw new TradeError({ kind: "decode", detail: peek(body) });
  return d;
}

export async function orders(status: "open" | "finished" = "finished", limit = 20) {
  const body = await send("/api/v4/spot/orders", { query: { currency_pair: GATE_PAIR, status, limit: String(limit) }, auth: "stored" });
  const list = parseGateOrders(json(body));
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}

export async function kline(period: number, limit: number) {
  const body = await send("/api/v4/spot/candlesticks", {
    query: { currency_pair: GATE_PAIR, interval: gateInterval(period), limit: String(Math.min(Math.max(limit, 1), 999)) },
  });
  return parseGateCandles(json(body));
}

export async function currency(id: string, useChinese = false) {
  const ccy = id.toUpperCase();
  const [chainsBody, statusBody] = await Promise.all([
    send("/api/v4/wallet/currency_chains", { query: { currency: ccy } }),
    send("/api/v4/wallet/withdraw_status", { query: { currency: ccy }, auth: "stored" }).catch(() => ""),
  ]);
  const c = parseGateCurrency(json(chainsBody), statusBody ? json(statusBody) : undefined, useChinese, ccy);
  if (!c) throw new TradeError({ kind: "decode", detail: peek(chainsBody) });
  return c;
}

export async function depositAddress(currencyId: string, network: string) {
  const body = await send("/api/v4/wallet/deposit_address", { query: { currency: currencyId.toUpperCase() }, auth: "stored" });
  const a = parseGateDepositAddress(json(body), currencyId, network);
  if (!a) throw new TradeError({ kind: "decode", detail: peek(body) });
  return a;
}

export async function deposits(currencyId: string, limit = 10) {
  const body = await send("/api/v4/wallet/deposits", { query: { currency: currencyId.toUpperCase(), limit: String(limit) }, auth: "stored" });
  const list = parseGateDeposits(json(body), currencyId);
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}

export async function withdraws(currencyId: string, limit = 10) {
  const body = await send("/api/v4/wallet/withdrawals", { query: { currency: currencyId.toUpperCase(), limit: String(limit) }, auth: "stored" });
  const list = parseGateWithdraws(json(body));
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}

export async function beneficiaries(currencyId: string) {
  const body = await send("/api/v4/wallet/saved_address", { query: { currency: currencyId.toUpperCase() }, auth: "stored" });
  const list = parseGateSavedAddresses(json(body), currencyId);
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body, 160) });
  return list;
}

// MARK: actions

export async function placeOrder(side: string, amount: string, price: string | null, type: "limit" | "market", maxPrice: string | null = null) {
  if (type === "market" && !maxPrice) {
    throw new TradeError({ kind: "http", status: 400, body: JSON.stringify({ label: "IOC_NOT_FILLED" }) });
  }
  let body: string;
  try {
    body = await send("/api/v4/spot/orders", { method: "POST", json: gateOrderJSON(side, amount, price, type, maxPrice), auth: "stored" });
  } catch (e) {
    if (ambiguous(e)) throw new TradeError({ kind: "placedUnverified" });
    throw e;
  }
  const raw = json(body);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TradeError({ kind: "placedUnverified" });
  const parsed = parseGateOrderDetail(raw as Record<string, unknown>);
  if (!parsed) throw new TradeError({ kind: "placedUnverified" });
  if (type === "market" && parsed.order.state === "cancel" && parsed.filledAmount <= 0) {
    throw new TradeError({ kind: "http", status: 422, body: JSON.stringify({ label: "IOC_NOT_FILLED" }) });
  }
  return parsed.order;
}

export const cancelOrder = (rawId: string) =>
  send(`/api/v4/spot/orders/${encodeURIComponent(rawId)}`, { method: "DELETE", query: { currency_pair: GATE_PAIR }, auth: "stored" }).then(() => undefined);

export async function createWithdraw(w: { address: string; amount: string; blockchainKey: string; memo?: string; currency: string; confirm: { title: string } }) {
  const payload: Record<string, string> = {
    currency: w.currency.toUpperCase(),
    address: w.address,
    amount: w.amount,
    chain: w.blockchainKey,
  };
  const memo = w.memo?.trim();
  if (memo) payload.memo = memo;
  try {
    await send("/api/v4/withdrawals", { method: "POST", json: JSON.stringify(payload), auth: "stored", confirm: w.confirm });
  } catch (e) {
    if (ambiguous(e)) throw new TradeError({ kind: "withdrawUnverified" });
    throw e;
  }
}
