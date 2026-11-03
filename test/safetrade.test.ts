import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affordableAmount, authProblem, averagePrice, base58Decode, cleanCredential, dec, decimalPlaces, decText, DEFAULT_RULES, depthCurve, displayPrice, eip55,
  isCredential, isPending, isSettled, SETTLE_DELAYS, lookForUnverified, parsePendingCheck, SETTLE_MS, settleLeft,
  errorKeys, failureMessage, halfWidth, isNewOrder, isOpen, isPRLAddress, isValidChainAddress, isValidEVM, isValidSolana, isValidTron,
  keccak256, keyMessage, levelNear, memoOf, mergeOrders, parseAmount, parseBalances, parseBeneficiaries, parseCurrency, parseDeposits,
  parseDepth, parseDepositAddressReply, parseKline, parseOrder, parseRules, parseTicker, parseWithdraws, pickAddress, plainAddress,
  marketPriceCap, orderJSON, parseSlippage, slippageFraction, slippageNumber, worstPrice, rollingChange, ruleMessage, ruleProblem, sha256, signedPercent, timestamp, traceIP, unknownKey, UNKNOWN_KEY, withdrawFee, withdrawState, type Network, type Order, type Tr,
} from "../src/safetrade.ts";
import { segwitAddress } from "../src/rawtx.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const tr: Tr = (key, ...args) => key.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)]));

test("decimals parse, round and format exactly", () => {
  assert.equal(dec("1.5"), 1500000000000000000n);
  assert.equal(dec("1e-8"), 10000000000n);
  assert.equal(dec("abc"), null);
  assert.equal(decText(dec("1.123456789")!, 8, "down"), "1.12345678");
  assert.equal(decText(dec("1.123456785")!, 8), "1.12345679");
  assert.equal(decText(dec("100")!), "100");
  assert.equal(decText(dec("0.0010")!), "0.001");
  assert.equal(parseAmount("1,5"), dec("1.5"));
  assert.equal(parseAmount("1.123456789"), null);
  assert.equal(parseAmount("1.2.3"), null);
  assert.equal(parseAmount("-1"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(decimalPlaces("1.50"), 1);
  assert.equal(decimalPlaces("2"), 0);
});

test("timestamps: seconds, milliseconds, numeric strings and ISO 8601", () => {
  assert.equal(timestamp(1700000000), 1700000000000);
  assert.equal(timestamp(1700000000123), 1700000000123);
  assert.equal(timestamp("1700000000"), 1700000000000);
  assert.equal(timestamp("2026-10-18T12:00:00Z"), Date.UTC(2026, 9, 18, 12));
  assert.equal(timestamp("soon"), undefined);
});

test("market rules: precision, minimum and range", () => {
  const r = parseRules({ amount_precision: 4, price_precision: 2, min_amount: "2.0", min_price: "0.01", max_price: "100000.0" })!;
  assert.deepEqual(r, DEFAULT_RULES);
  assert.equal(ruleProblem(r, "1", "0.5")?.kind, "belowMinAmount");
  assert.equal(ruleMessage(ruleProblem(r, "1", null)!, tr), "最少下单 2 PEARL");
  assert.equal(ruleProblem(r, "2.12345", "0.5")?.kind, "amountDecimals");
  assert.equal(ruleProblem(r, "3", "0.555")?.kind, "priceDecimals");
  assert.equal(ruleProblem(r, "3", "0.550"), null);
  assert.equal(ruleProblem(r, "3", "200000")?.kind, "priceOutOfRange");
  assert.equal(ruleProblem(r, "", ""), null);
});

test("market orders carry SafeTrade's web-client cap: last ± 15%, rounded outward, inside the price range", () => {
  const r = DEFAULT_RULES, txt = (d: bigint | null) => d == null ? null : decText(d, 18);
  assert.equal(txt(marketPriceCap(r, "sell", dec("1.53")!)), "1.3");      // 1.3005 → down
  assert.equal(txt(marketPriceCap(r, "buy", dec("1.53")!)), "1.76");      // 1.7595 → up
  assert.equal(txt(marketPriceCap(r, "sell", dec("0.01")!)), "0.01");     // never below min_price
  assert.equal(txt(marketPriceCap(r, "buy", dec("100000")!)), "100000");  // never above max_price
  assert.equal(marketPriceCap(r, "sell", 0n), null);
  assert.equal(txt(marketPriceCap(r, "sell", dec("1.53")!, slippageFraction(1))), "1.51");     // 1.5147 → down
  assert.equal(txt(marketPriceCap(r, "buy", dec("1.53")!, slippageFraction(1))), "1.55");      // 1.5453 → up
  assert.equal(txt(marketPriceCap(r, "sell", dec("1.53")!, slippageFraction(2.5))), "1.49");   // 1.49175
  assert.notEqual(failureMessage({ kind: "http", status: 422, body: '{"errors":["market.order.market_price_exceeded"]}' }, tr), "HTTP 422");
  assert.ok(!failureMessage({ kind: "http", status: 422, body: '{"errors":["market.order.market_price_exceeded"]}' }, tr).includes("HTTP"));
});

test("after an order the account is read again until the order is done AND the balances moved", () => {
  const o = (state: string) => parseOrder({ id: 5, side: "sell", state });
  const marketDone = (x: Order) => !isOpen(x), limitDone = (x: Order) => !isPending(x);
  assert.equal(isSettled(o("done"), true, marketDone), true);
  assert.equal(isSettled(o("done"), false, marketDone), false);     // balance lagging
  assert.equal(isSettled(o("pending"), true, marketDone), false);
  assert.equal(isSettled(o("wait"), true, marketDone), false);
  assert.equal(isSettled(undefined, true, marketDone), false);      // not listed yet
  assert.equal(isSettled(o("wait"), true, limitDone), true);        // a resting limit order has settled
  assert.equal(isSettled(o("pending"), true, limitDone), false);
  assert.ok(SETTLE_DELAYS.reduce((a, b) => a + b, 0) < 30);
});

test("orders go out as JSON with string values, like SafeTrade's web client (a form body loses max_price)", () => {
  assert.deepEqual(JSON.parse(orderJSON("sell", "71.2606", "1.5", "market", "1.22")),
    { market: "pearlusdt", side: "sell", amount: "71.2606", type: "market", max_price: "1.22" });
  assert.deepEqual(JSON.parse(orderJSON("buy", "10", "1.43", "limit", "1.6")),
    { market: "pearlusdt", side: "buy", amount: "10", type: "limit", price: "1.43" });
  const fail = (key: string) => failureMessage({ kind: "http", status: 422, body: JSON.stringify({ errors: [key] }) }, tr);
  // A field the exchange didn't get is not a price problem: the raw key stays visible.
  assert.ok(fail("market.order.missing_max_price").includes("missing_max_price"));
  // Not enough on the book (SafeTrade's current key) reads like the old liquidity one.
  assert.equal(fail("market.order.market_insufficient"), fail("market.order.insufficient_market_liquidity"));
  assert.equal(fail("market.account.insufficient_balance"), tr("SafeTrade 可用余额不足"));
});

test("ticker, balances, orders and candles decode leniently", () => {
  assert.deepEqual(parseTicker({ ticker: { last: "0.55", buy: 0.56, sell: "0.54", price_change_percent: "+1.2%" } }),
    { last: "0.55", buy: "0.56", sell: "0.54", high: undefined, low: undefined, vol: undefined, change: "+1.2%" });
  assert.equal(parseBalances([{ currency: "pearl", balance: "1", locked: "0" }])?.length, 1);
  assert.equal(parseBalances({ errors: [] }), null);
  const o = parseOrder({ id: 7, side: "buy", state: "wait", price: null, avg_price: "0.55", origin_amount: "10", created_at: "2026-10-18T00:00:00Z" });
  assert.equal(isOpen(o), true);
  assert.equal(displayPrice(o), "0.55");
  assert.equal(displayPrice(parseOrder({ id: 8, price: "0", avg_price: "0" })), undefined);
  assert.deepEqual(parseKline([[1, "1", "2", "0.5", "1.5", "10"], ["x"]]), [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]);
});

test("orders merge: every open order first, the recent copy wins", () => {
  const recent: Order[] = [{ id: 3, state: "done" }, { id: 2, state: "wait" }];
  const open: Order[] = [{ id: 3, state: "wait" }, { id: 1, state: "wait" }, { id: 2, state: "wait" }];
  assert.deepEqual(mergeOrders(recent, open).map((o) => o.id), [1, 2, 3]);
  assert.equal(isNewOrder({ side: "buy", knownIDs: [1, 2], knownComplete: true, at: 0 }, { id: 5, side: "buy" }), true);
  assert.equal(isNewOrder({ side: "buy", knownIDs: [1, 2], knownComplete: true, at: 0 }, { id: 5, side: "sell" }), false);
  assert.equal(isNewOrder({ side: "buy", knownIDs: [1, 2], knownComplete: true, at: 0 }, { id: 2, side: "buy" }), false);
});

test("order book: average fill, affordable amount and the depth window", () => {
  const depth = parseDepth({ asks: [["1.02", "10"], ["1.01", "5"]], bids: [["0.99", "4"], ["0.98", "6"]] })!;
  assert.deepEqual(depth.asks.map((l) => l.price), [1.01, 1.02]);
  assert.equal(averagePrice(10, depth.asks), (5 * 1.01 + 5 * 1.02) / 10);
  assert.equal(averagePrice(100, depth.asks), null);
  assert.ok(Math.abs(affordableAmount(5.06, depth.asks, 0.01) - 5.06 * 0.999 / 1.02) < 1e-9);
  const curve = depthCurve(depth)!;
  assert.equal(curve.mid, 1);
  assert.equal(curve.bids.at(-1)!.cumulative, 10);
  assert.equal(levelNear(curve, 0.995)?.side, "bid");
  assert.equal(levelNear(curve, 1.006)?.side, "ask");
  // The window stops at the shorter side's last fetched level (here 2 %), never below 0.5 %.
  assert.ok(Math.abs(halfWidth(1, depth.bids, depth.asks) - 0.02) < 1e-12);
  assert.equal(halfWidth(1, [{ price: 1, amount: 1 }], [{ price: 1, amount: 1 }]), 0.005);
});

test("rolling change reads the minute that ended before the window", () => {
  const now = 1_000_000 * 1000, minute = (m: number, c: number) => ({ t: now / 1000 - m * 60, o: c, h: c, l: c, c, v: 1 });
  const candles = [minute(20, 1), minute(16, 2), minute(15, 3), minute(1, 4)];
  assert.equal(rollingChange(candles, 15, 4, now), 100);
  assert.equal(rollingChange(candles, 60, 4, now), null);
  assert.equal(signedPercent(1.234), "+1.23%");
  assert.equal(signedPercent(-0.5), "-0.50%");
});

test("auth refusals are told apart", () => {
  const body = (k: string) => JSON.stringify({ errors: [k] });
  assert.equal(authProblem(401, body("authz.not_trusted_ip"))?.kind, "untrustedIP");
  assert.equal(authProblem(401, body("authz.nonce_expired"))?.kind, "clock");
  assert.equal(authProblem(401, body("authz.invalid_signature"))?.kind, "badKey");
  assert.equal(authProblem(403, body("authz.invalid_permission"))?.kind, "other");
  assert.equal(authProblem(403, "<html>Attention Required</html>")?.kind, "firewall");
  assert.equal(authProblem(422, body("x")), null);
  assert.deepEqual(errorKeys(body("a.b")), ["a.b"]);
  assert.equal(keyMessage("account.withdraw.invalid_otp_code", tr), "谷歌验证码（2FA）错误");
  assert.equal(keyMessage("account.beneficiary.invalid_code", tr), "验证码错误或已过期");
  assert.equal(keyMessage("market.account.insufficient_balance", tr), "SafeTrade 可用余额不足");
  assert.equal(keyMessage("account.deposit_address.otp_required_2fa", tr), "SafeTrade 要求先开启谷歌验证（2FA）才能生成充值地址");
  assert.equal(failureMessage({ kind: "http", status: 422, body: body("market.order.invalid_volume_round") }, tr), "数量的小数位太多");
  assert.match(failureMessage({ kind: "http", status: 500, body: "oops" }, tr), /^HTTP 500: oops/);
  assert.equal(traceIP("fl=1\nip=2001:db8::1\nts=1"), "2001:db8::1");
  // An API key SafeTrade doesn't know: 404 record.not_found (live, 2026-10-28), read as a wrong key.
  assert.equal(unknownKey(404, body("record.not_found")), true);
  assert.equal(unknownKey(404, body("market.order.not_found")), false);
  assert.equal(authProblem(UNKNOWN_KEY.status, UNKNOWN_KEY.body)?.kind, "badKey");
});

test("networks, fees, withdrawals, deposits and the address book", () => {
  const cur = parseCurrency({ precision: 6, networks: [
    { blockchain_key: "bsc-tokens", protocol: "BSC", protocol_name: "Binance Smart Chain", withdraw_enabled: true, withdraw_fee: "0.5", withdraw_fee_ratio: "0.001", min_withdraw_amount: 10, status: "active", explorer_transaction: "https://bscscan.com/tx/#{txid}", options: { maintenance_message: "", gas: 21000 } },
    { blockchain_key: "tron-tokens", withdraw_enabled: false },
  ] })!;
  const bsc = cur.networks[0] as Network;
  assert.equal(cur.precision, 6);
  assert.equal(decText(withdrawFee(bsc, dec("100")!)), "0.5");
  assert.equal(decText(withdrawFee(bsc, dec("1000")!)), "1");
  assert.equal(bsc.options.gas, "21000");
  assert.equal(isValidChainAddress(bsc, "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), true);
  assert.equal(withdrawState("succeed"), "done");
  assert.equal(withdrawState("prepared"), "processing");
  assert.equal(parseWithdraws([{ id: 1, amount: 5, blockchain_txid: "", txid: "ab", state: "Succeed" }])![0].txid, "ab");
  const deposits = parseDeposits([{ id: 1, credited: true, created_at: 1 }, { id: 2, currency: "usdt", fee_currency: "bnb", fee_paid: false, created_at: 2 }, { id: 3, state: "rejected", created_at: 3 }])!;
  assert.deepEqual(deposits.map((d) => [d.id, d.status]), [[3, "failed"], [2, "feeRequired"], [1, "credited"]]);
  const book = parseBeneficiaries({ data: [{ id: 4, name: "Me", currency: "USDT", blockchain_key: "bsc-tokens", data: { address: " 0xabc " }, state: "pending" }] });
  assert.ok(Array.isArray(book));
  assert.deepEqual(book[0], { id: 4, title: "Me", currencyID: "usdt", network: "bsc-tokens", destination: "0xabc", active: false });
  assert.equal(typeof parseBeneficiaries([{ nope: true }]), "string");
});

test("deposit addresses: memo, generating, lists", () => {
  const a = parseDepositAddressReply({ address: "rAddr?memo=123", network: "xrp" }, "xrp", "xrp")!;
  assert.equal(plainAddress(a), "rAddr");
  assert.equal(memoOf(a), "123");
  assert.equal(plainAddress(parseDepositAddressReply({ address: "", network: "bsc" }, "usdt", "bsc")!), "");
  const list = [{ address: "0x1", network: "bsc-tokens", currencies: ["usdt"] }, { address: "T1", network: "tron-tokens" }];
  assert.equal(pickAddress(list, "usdt", "tron-tokens")?.address, "T1");
  assert.equal(parseDepositAddressReply(list, "usdt", "eth")?.network, "eth");
});

test("hashes and address checks", () => {
  assert.equal(hex(keccak256(new Uint8Array())), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(hex(sha256(new TextEncoder().encode("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(eip55("5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  assert.equal(isValidEVM("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), true);
  assert.equal(isValidEVM("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), true);
  assert.equal(isValidEVM("0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), false);
  assert.equal(isValidTron("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"), true);
  assert.equal(isValidTron("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u"), false);
  assert.equal(isValidSolana("So11111111111111111111111111111111111111112"), true);
  assert.equal(isValidSolana("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), false);
  assert.equal(base58Decode("11")?.length, 2);
  const program = Uint8Array.from({ length: 32 }, (_, i) => i);
  const prl = segwitAddress("prl", 1, program);
  assert.equal(isPRLAddress(prl), true);
  assert.equal(isPRLAddress(prl.toUpperCase()), true);
  assert.equal(isPRLAddress(segwitAddress("tprl", 1, program)), false);
  assert.equal(isPRLAddress(segwitAddress("prl", 0, program)), false);
  assert.equal(isPRLAddress(prl.slice(0, -1) + (prl.endsWith("q") ? "p" : "q")), false);
});

test("decText keeps 0…18 places whatever precision the exchange sends", () => {
  const v = dec("1.123456789")!;
  assert.equal(decText(v, 20, "down"), "1.123456789");
  assert.equal(dec(decText(v, 20, "down")), v);
  assert.equal(decText(v, -2, "down"), "1");
  assert.equal(decText(v, 2.7, "down"), "1.12");
  assert.equal(decText(v, Number.NaN, "down"), "1.123456789");
});

test("an unanswered order or withdrawal is only called absent from looks made after SETTLE_MS", async () => {
  const wait = async () => {};
  const start = 1_000_000;
  let clock = start;
  const now = () => clock;
  const look = (hits: (string | null)[]) => { let i = 0; return async () => { clock += 3000; return hits[i++] ?? null; }; };
  // Right after the POST: clean looks don't count yet.
  assert.deepEqual(await lookForUnverified({ knownComplete: true, at: start }, look([null, null, null]), wait, now), { kind: "unknown" });
  // Found at any time.
  clock = start;
  assert.deepEqual(await lookForUnverified({ knownComplete: true, at: start }, look([null, "o1"]), wait, now), { kind: "found", hit: "o1" });
  // Two clean looks after SETTLE_MS at a complete list: it never went in.
  clock = start + SETTLE_MS;
  assert.deepEqual(await lookForUnverified({ knownComplete: true, at: start }, look([null, null, null]), wait, now), { kind: "absent" });
  // An incomplete list proves nothing; failed reads don't count.
  clock = start + SETTLE_MS;
  assert.deepEqual(await lookForUnverified({ knownComplete: false, at: start }, look([null, null, null]), wait, now), { kind: "unknown" });
  clock = start + SETTLE_MS;
  let n = 0;
  const flaky = async () => { if (n++ < 2) throw new Error("offline"); return null; };
  assert.deepEqual(await lookForUnverified({ knownComplete: true, at: start }, flaky, wait, now), { kind: "unknown" });
  assert.equal(settleLeft({ at: start }, start + 1000), SETTLE_MS - 1000);
  assert.equal(settleLeft({ at: start }, start + SETTLE_MS + 1), 0);
});

test("saved unverified locks are read back only in their own shape", () => {
  assert.deepEqual(parsePendingCheck({ knownIDs: [1, 2], knownComplete: true, at: 5 }), { knownIDs: [1, 2], knownComplete: true, at: 5 });
  assert.deepEqual(parsePendingCheck({ knownIDs: [], knownComplete: false }), { knownIDs: [], knownComplete: false, at: 0 });
  assert.equal(parsePendingCheck({ knownIDs: ["1"], knownComplete: true, at: 5 }), null);
  assert.equal(parsePendingCheck({ knownIDs: [1] }), null);
  assert.equal(parsePendingCheck(null), null);
});

test("pasted keys lose what copying adds; anything else is refused before the shell sees it", () => {
  assert.equal(cleanCredential(" abc\u200bDEF\u00a0123\n"), "abcDEF123");
  assert.equal(cleanCredential("\ufeffkey\u2060"), "key");
  assert.equal(isCredential("Ab12!~/x"), true);
  assert.equal(isCredential(""), false);
  assert.equal(isCredential("ключ"), false);
  assert.equal(isCredential("a".repeat(257)), false);
});

test("the slippage setting: one decimal, 0.1 – 50, commas and % allowed", () => {
  assert.equal(parseSlippage("2.5"), 2.5);
  assert.equal(parseSlippage("2,5%"), 2.5);
  assert.equal(parseSlippage(" 3 "), 3);
  assert.equal(parseSlippage("0"), 0.1);
  assert.equal(parseSlippage("80"), 50);
  assert.equal(parseSlippage("1.26"), 1.3);
  assert.equal(parseSlippage("abc"), null);
  assert.equal(parseSlippage(""), null);
  assert.equal(decText(slippageFraction(15), 18), "0.15");
  assert.equal(decText(slippageFraction(0.5), 18), "0.005");
  assert.equal(slippageNumber(15), "15");
  assert.equal(slippageNumber(0.5), "0.5");
});

test("worstPrice is the farthest level a market order reaches", () => {
  const levels = [{ price: 1.48, amount: 5591.0758 }, { price: 1.49, amount: 20676.3443 }];
  assert.equal(worstPrice(100, levels), 1.48);
  assert.equal(worstPrice(5591.0758, levels), 1.48);
  assert.equal(worstPrice(6000, levels), 1.49);
  assert.equal(worstPrice(1_000_000, levels), null);
  assert.equal(worstPrice(0, levels), null);
});
