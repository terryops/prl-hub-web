// SafeTrade requests for the Android 交易 tab, through the shell (BRIDGE.md `safetrade.*`): SafeTrade's
// private API refuses the WebView's CORS preflight, so the shell signs each request with the key pair
// it keeps in the Android Keystore and sends it itself. The page never sees the secret once saved.
// The iOS counterpart is prl-hub Sources/Trade/SafeTradeClient.swift.
import { BridgeError, nativeCall } from "./android-bridge.ts";
import {
  MARKET, TradeError, parseBalances, parseBeneficiaries, parseCurrency, parseDepositAddressReply, parseDeposits, parseDepth, parseJSON,
  parseKline, parseOrder, parseRules, parseTicker, parseWithdraws, rows, traceIP, authProblem, unknownKey, UNKNOWN_KEY, type AuthProblem, type Balance,
} from "./safetrade.ts";

type Auth = "none" | "stored" | { key: string; secret: string };
type Request = {
  method?: "GET" | "POST"; query?: Record<string, string>; form?: Record<string, string>; json?: string; auth?: Auth;
  // The withdrawal: the shell asks for the device check (fingerprint, face or screen lock) first.
  confirm?: { title: string; subtitle?: string };
};

/** The body of a 2xx reply. Anything else throws a TradeError: the HTTP status and body, or why it never arrived. */
async function send(path: string, r: Request = {}): Promise<string> {
  const method = r.method ?? "GET", auth = r.auth ?? "none";
  const params: Record<string, unknown> = { method, path, auth: typeof auth === "string" ? auth : "explicit" };
  if (typeof auth === "object") { params.key = auth.key; params.secret = auth.secret; }
  if (r.query) params.query = r.query;
  if (r.form) params.form = r.form;
  if (r.json) params.json = r.json;
  if (r.confirm) { params.title = r.confirm.title; if (r.confirm.subtitle) params.subtitle = r.confirm.subtitle; }
  let reply: { status: number; body: string };
  try {
    // A POST waits however long it takes (the device check waits for the person); the shell's own
    // timeouts end it. A GET that hangs past the shell's two tries is given up here.
    reply = await nativeCall<{ status: number; body: string }>("safetrade.request", params, method === "POST" ? 0 : 60000);
  } catch (e) {
    const code = e instanceof BridgeError ? e.code : "failed";
    if (code === "no_credentials") throw new TradeError({ kind: "noCredentials" });
    if (code === "unconfirmed") throw new TradeError({ kind: "failed", code });
    if (code === "unreached" || code === "timeout") throw new TradeError({ kind: "unreached" });
    // Everything else the withdrawal gets is its device check's code (`unavailable` included: no biometric
    // hardware); the shell reports a failure to send as `unreached`.
    if (r.confirm && code !== "bad_params") throw new TradeError({ kind: "device", code });
    if (code === "unavailable") throw new TradeError({ kind: "unreached" });
    throw new TradeError({ kind: "failed", code });
  }
  if (reply.status >= 200 && reply.status < 300) return reply.body;
  throw new TradeError({ kind: "http", status: reply.status, body: reply.body ?? "" });
}
const json = (body: string) => parseJSON(body);
/** A JSON body with `amount` written as the plain decimal it is (iOS sends an NSDecimalNumber), not a
 *  float that JSON.stringify or the shell's org.json might reformat. */
function withAmount(fields: Record<string, unknown>, amount: string) {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new TradeError({ kind: "failed", code: "bad_amount" });
  const rest = JSON.stringify(fields);
  return rest === "{}" ? `{"amount":${amount}}` : `${rest.slice(0, -1)},"amount":${amount}}`;
}
const peek = (body: string, n = 120) => body.slice(0, n);

/** An order / withdrawal POST that may have gone through: the shell lost the reply after sending, or a 5xx. */
function ambiguous(e: unknown) {
  if (!(e instanceof TradeError)) return false;
  const f = e.failure;
  return (f.kind === "failed" && f.code === "unconfirmed") || (f.kind === "http" && (f.status === 0 || f.status >= 500));
}

// MARK: keys

export type KeyStatus = { set: boolean; masked: string | null };
/** Rejects when the shell doesn't answer: that says nothing about whether a key is saved. */
export const keyStatus = () => nativeCall<KeyStatus>("safetrade.keys");
export const saveKeys = (key: string, secret: string) => nativeCall<{ masked: string }>("safetrade.save", { key, secret }).then((r) => r.masked);

export const clearKeys = () => nativeCall("safetrade.clear").then(() => undefined);

export type CredentialCheck = { kind: "ok" } | { kind: "rejected"; problem: AuthProblem } | { kind: "serverError"; status: number } | { kind: "network" };
/** Signs a balances read with the typed keys before they're saved, so the page can say why they don't work. */
export async function verifyCredentials(key: string, secret: string): Promise<CredentialCheck> {
  try {
    await send("/api/v2/trade/account/balances/spot", { auth: { key, secret } });
    return { kind: "ok" };
  } catch (e) {
    const f = e instanceof TradeError ? e.failure : null;
    if (f?.kind === "http" && unknownKey(f.status, f.body)) return { kind: "rejected", problem: { kind: "badKey" } };
    if (f?.kind === "http") {
      const problem = authProblem(f.status, f.body);
      return problem ? { kind: "rejected", problem } : { kind: "serverError", status: f.status };
    }
    return { kind: "network" };
  }
}

// MARK: reads

export async function balances(): Promise<Balance[]> {
  let body: string;
  try { body = await send("/api/v2/trade/account/balances/spot", { auth: "stored" }); }
  catch (e) { if (e instanceof TradeError && e.failure.kind === "http" && unknownKey(e.failure.status, e.failure.body)) throw new TradeError(UNKNOWN_KEY); throw e; }
  const list = parseBalances(json(body));
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}
/** The public IP SafeTrade's edge sees (Cloudflare answers /cdn-cgi/trace itself, even while the key is refused). */
export async function publicIP() {
  const ip = traceIP(await send("/cdn-cgi/trace"));
  if (!ip) throw new TradeError({ kind: "decode", detail: "cdn-cgi/trace" });
  return ip;
}
export async function ticker() {
  const body = await send(`/api/v2/peatio/public/markets/${MARKET}/tickers`), t = parseTicker(json(body));
  if (!t) throw new TradeError({ kind: "decode", detail: peek(body) });
  return t;
}
export async function marketRules() {
  const body = await send(`/api/v2/trade/public/markets/${MARKET}`), r = parseRules(json(body));
  if (!r) throw new TradeError({ kind: "decode", detail: peek(body) });
  return r;
}
export async function depth(limit = 100) {
  const body = await send(`/api/v2/trade/public/markets/${MARKET}/depth`, { query: { limit: String(limit) } }), d = parseDepth(json(body));
  if (!d) throw new TradeError({ kind: "decode", detail: peek(body) });
  return d;
}
/** Newest first. `state: "wait"` lists every resting order (the plain list is capped). */
export async function orders(state?: string, limit = 20) {
  const query: Record<string, string> = { market: MARKET, limit: String(limit), ordering: "desc" };
  if (state) query.state = state;
  const body = await send("/api/v2/trade/market/orders", { query, auth: "stored" }), list = rows(json(body), parseOrder);
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}
/** Without a time range the API returns the OLDEST candles, so ask for the latest window. */
export async function kline(period: number, limit: number) {
  const to = Math.floor(Date.now() / 1000), from = to - period * 60 * limit;
  const body = await send(`/api/v2/trade/public/markets/${MARKET}/k-line`, { query: { period: String(period), time_from: String(from), time_to: String(to), limit: String(limit) } });
  return parseKline(json(body));
}
export async function currency(id: string) {
  const body = await send(`/api/v2/trade/public/currencies/${id}`), c = parseCurrency(json(body));
  if (!c) throw new TradeError({ kind: "decode", detail: peek(body) });
  return c;
}
export async function withdraws(currencyId: string, limit = 10) {
  const body = await send("/api/v2/trade/account/withdraws", { query: { currency: currencyId, limit: String(limit), ordering: "desc" }, auth: "stored" });
  const list = parseWithdraws(json(body));
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}
export async function depositAddress(currencyId: string, network: string) {
  const body = await send(`/api/v2/trade/account/deposit_address/${currencyId}`, { query: { network }, auth: "stored" });
  const a = parseDepositAddressReply(json(body), currencyId, network);
  if (!a) throw new TradeError({ kind: "decode", detail: peek(body) });
  return a;
}
export async function deposits(currencyId: string, limit = 10) {
  const body = await send("/api/v2/trade/account/deposits", { query: { currency: currencyId, limit: String(limit), page: "1" }, auth: "stored" });
  const list = parseDeposits(json(body));
  if (!list) throw new TradeError({ kind: "decode", detail: peek(body) });
  return list;
}
export async function beneficiaries() {
  const body = await send("/api/v2/trade/account/beneficiaries", { query: { limit: "100" }, auth: "stored" });
  const list = parseBeneficiaries(json(body));
  if (typeof list === "string") throw new TradeError({ kind: "decode", detail: list || peek(body, 160) });
  return list;
}

// MARK: actions

export async function placeOrder(side: string, amount: string, price: string | null, type: "limit" | "market") {
  const form: Record<string, string> = { market: MARKET, side, amount, type };
  if (type === "limit" && price) form.price = price;
  let body: string;
  try { body = await send("/api/v2/trade/market/orders", { method: "POST", form, auth: "stored" }); }
  catch (e) { if (ambiguous(e)) throw new TradeError({ kind: "placedUnverified" }); throw e; }
  // Accepted (2xx). An unreadable reply means we can't tell what was booked: reconcile, never re-order.
  const o = json(body);
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new TradeError({ kind: "placedUnverified" });
  return parseOrder(o as Record<string, unknown>);
}
export const cancelOrder = (id: number) => send(`/api/v2/trade/market/orders/${id}/cancel`, { method: "POST", auth: "stored" }).then(() => undefined);

/** Ask SafeTrade to e-mail (or text) the one-time code, bound to this address + amount. */
export function sendWithdrawCode(type: "email" | "phone", address: string, amount: string, blockchainKey: string, currencyId: string) {
  return send("/api/v2/trade/account/withdraws/generate_code", { method: "POST", auth: "stored",
    json: withAmount({ type, address, currency: currencyId, blockchain_key: blockchainKey }, amount) }).then(() => undefined);
}
/** An on-chain withdrawal, the body SafeTrade's web client sends. With `beneficiaryID` the destination is an
 *  address-book entry (no address, no e-mail code). The shell asks for the device check before it sends. */
export async function createWithdraw(w: { address: string; amount: string; blockchainKey: string; beneficiaryID?: number; emailCode: string; otpCode: string; phoneCode: string; currency: string; confirm: { title: string } }) {
  const body: Record<string, unknown> = { currency: w.currency, blockchain_key: w.blockchainKey };
  if (w.beneficiaryID != null) body.beneficiary_id = w.beneficiaryID; else body.address = w.address;
  if (w.emailCode) body.email_code = w.emailCode;
  if (w.otpCode) body.otp_code = w.otpCode;
  if (w.phoneCode) body.phone_code = w.phoneCode;
  try { await send("/api/v2/trade/account/withdraws", { method: "POST", json: withAmount(body, w.amount), auth: "stored", confirm: w.confirm }); }
  catch (e) { if (ambiguous(e)) throw new TradeError({ kind: "withdrawUnverified" }); throw e; }
}
