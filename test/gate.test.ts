import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  GATE_PAIR, gateAuthProblem, gateFailureMessage, gateInterval, gateOrderJSON, isGateAddressWhitelistError,
  parseGateBalances, parseGateCandles, parseGateCurrency, parseGateDepositAddress,
  parseGateDeposits, parseGateDepth, parseGateOrderDetail, parseGateOrders,
  parseGateRules, parseGateSavedAddresses, parseGateTicker, parseGateWithdraws, syntheticIntID,
} from "../src/gate.ts";
import { klineURL, parseSourceCandles } from "../src/kline.ts";
import {
  affordableAmount, canDeposit, canWithdraw, dec, decText, explorerURL, gateAffordableBuyCap, isNewOrder, isOpen, isSettled, isValidChainAddress,
  marketPriceCap, memoOf, mergeOrders, minWithdraw, orderKey, plainAddress, ruleMessage, ruleProblem, slippageFraction, withdrawFee, type Tr,
} from "../src/safetrade.ts";

const tr: Tr = (key, ...args) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));

test("Gate ticker & pair: uses PEARL_USDT and maps bid/ask/change accurately", () => {
  assert.equal(GATE_PAIR, "PEARL_USDT");
  const parsed = parseGateTicker([
    { currency_pair: "PRL_USDT", last: "0.0002", lowest_ask: "0.0003", highest_bid: "0.0001" },
    {
      currency_pair: "PEARL_USDT",
      last: "0.525",
      lowest_ask: "0.5261",
      highest_bid: "0.5248",
      change_percentage: "-2.35",
      base_volume: "125430.5",
      high_24h: "0.5600",
      low_24h: "0.5100",
    },
  ]);
  assert.deepEqual(parsed, {
    last: "0.525",
    buy: "0.5261",
    sell: "0.5248",
    high: "0.5600",
    low: "0.5100",
    vol: "125430.5",
    change: "-2.35%",
  });
});

test("Gate market rules: enforces 3 USDT min_quote_amount and 0.2% taker fee", () => {
  const rules = parseGateRules({
    id: "PEARL_USDT",
    amount_precision: 1,
    precision: 4,
    min_base_amount: "0.1",
    min_quote_amount: "3",
    fee: "0.2",
  })!;
  assert.equal(rules.amountPrecision, 1);
  assert.equal(rules.pricePrecision, 4);
  assert.equal(decText(rules.minAmount, 8), "0.1");
  assert.equal(decText(rules.minQuote!, 8), "3");
  assert.equal(rules.takerFee, 0.002);

  // 2 PEARL @ 0.5 USDT = 1 USDT < 3 USDT minQuote
  const prob = ruleProblem(rules, "2", "0.5");
  assert.equal(prob?.kind, "belowMinQuote");
  assert.equal(ruleMessage(prob!, tr), "下单金额最少 3 USDT");
  // Market order uses referencePrice
  assert.equal(ruleProblem(rules, "4", null, dec("0.5"))?.kind, "belowMinQuote");
  assert.equal(ruleProblem(rules, "8", null, dec("0.5")), null);

  // Taker fee reduces affordable market buy amount slightly vs zero-fee
  const asks = [{ price: 0.5, amount: 100 }];
  const noFee = affordableAmount(10, asks, 0.0001, 0);
  const withFee = affordableAmount(10, asks, 0.0001, 0.002);
  assert.ok(withFee < noFee && withFee > 19.9);

  // 50% custom slippage is clamped inside Gate's ±30% price protection band (29.7%)
  assert.equal(decText(marketPriceCap(rules, "buy", dec("1.5000")!, slippageFraction(50))!, 4), "1.9455");
  // MAX market buy (3.3 PEARL with 5.143881 USDT available, bestAsk 1.5168): clamps 1.7424 -> 1.5587 so amount*cap <= available
  const affordableCap = gateAffordableBuyCap(rules, dec("1.7424")!, dec("1.5168")!, dec("3.3")!, dec("5.143881")!);
  assert.equal(decText(affordableCap, 4), "1.5587");
});

test("Gate candlesticks & klineURL: parses [ts, quoteVol, close, high, low, open, baseVol]", () => {
  assert.equal(gateInterval(5), "5m");
  assert.equal(gateInterval(60), "1h");
  assert.equal(gateInterval(1440), "1d");
  const u = new URL(klineURL(60, 1_800_000_000, 300, "gate"));
  assert.equal(u.origin + u.pathname, "https://api.gateio.ws/api/v4/spot/candlesticks");
  assert.equal(u.searchParams.get("currency_pair"), "PEARL_USDT");
  assert.equal(u.searchParams.get("interval"), "1h");

  const candles = parseGateCandles([
    ["1700003600", "2625.0", "0.5300", "0.5400", "0.5150", "0.5200", "5000.0", "true"],
    ["1700000000", "1050.0", "0.5200", "0.5250", "0.5000", "0.5050", "2000.0", "true"],
  ]);
  assert.deepEqual(candles, [
    { t: 1700000000, o: 0.505, h: 0.525, l: 0.5, c: 0.52, v: 2000 },
    { t: 1700003600, o: 0.52, h: 0.54, l: 0.515, c: 0.53, v: 5000 },
  ]);
  assert.deepEqual(parseSourceCandles([["1700000000", "1050", "0.52", "0.53", "0.5", "0.51", "2000"]], "gate").length, 1);
});

test("Gate balances, order book depth, order JSON (GTC vs Limit+IOC) and order details", () => {
  const bals = parseGateBalances([
    { currency: "USDT", available: "128.45", locked: "12.00" },
    { currency: "PEARL", available: "540.2", locked: "0" },
  ]);
  assert.deepEqual(bals, [
    { currency: "usdt", balance: "128.45", locked: "12.00" },
    { currency: "pearl", balance: "540.2", locked: "0" },
  ]);

  const depth = parseGateDepth({ asks: [["0.5300", "120.5"]], bids: [["0.5250", "300"]] });
  assert.deepEqual(depth, { asks: [{ price: 0.53, amount: 120.5 }], bids: [{ price: 0.525, amount: 300 }] });

  assert.deepEqual(JSON.parse(gateOrderJSON("buy", "10", "0.51", "limit", null)), {
    currency_pair: "PEARL_USDT", side: "buy", type: "limit", time_in_force: "gtc", amount: "10", price: "0.51",
  });
  assert.deepEqual(JSON.parse(gateOrderJSON("sell", "25", null, "market", "0.4800")), {
    currency_pair: "PEARL_USDT", side: "sell", type: "limit", time_in_force: "ioc", amount: "25", price: "0.4800",
  });

  // Open GTC limit order with large string ID beyond 15 digits
  const openDetail = parseGateOrderDetail({
    id: "987654321098765432",
    currency_pair: "PEARL_USDT",
    status: "open",
    type: "limit",
    time_in_force: "gtc",
    side: "buy",
    amount: "50",
    price: "0.5000",
    filled_amount: "0",
    create_time_ms: 1700000000123,
  })!;
  assert.equal(openDetail.order.rawId, "987654321098765432");
  assert.equal(orderKey(openDetail.order), "987654321098765432");
  assert.equal(openDetail.order.state, "wait");
  assert.equal(openDetail.order.type, "limit");

  // Partially filled IOC market order cancelled for remainder -> treated as done market order
  const iocFilled = parseGateOrderDetail({
    id: "987654321098765433",
    currency_pair: "PEARL_USDT",
    status: "cancelled",
    finish_as: "ioc",
    type: "limit",
    time_in_force: "ioc",
    side: "buy",
    amount: "20",
    price: "0.5500",
    filled_amount: "18.5",
    avg_deal_price: "0.5240",
  })!;
  assert.equal(iocFilled.order.type, "market");
  assert.equal(iocFilled.order.state, "done");
  assert.equal(iocFilled.order.originAmount, "18.5");
  assert.equal(iocFilled.order.avgPrice, "0.5240");
  assert.equal(iocFilled.filledAmount, 18.5);

  // Zero-fill IOC market order -> state cancel, filledAmount 0
  const iocUnfilled = parseGateOrderDetail({
    id: "987654321098765434",
    status: "cancelled",
    type: "limit",
    time_in_force: "ioc",
    side: "sell",
    amount: "20",
    price: "0.6000",
    filled_amount: "0",
  })!;
  assert.equal(iocUnfilled.order.state, "cancel");
  assert.equal(iocUnfilled.filledAmount, 0);

  // Merge orders & unverified check work with string rawIds
  const merged = mergeOrders([openDetail.order, iocFilled.order], [openDetail.order]);
  assert.equal(merged.length, 2);
  assert.equal(isNewOrder({ side: "buy", knownIDs: ["987654321098765432"], knownComplete: true, at: 1 }, iocFilled.order), true);
  assert.equal(isNewOrder({ side: "buy", knownIDs: ["987654321098765432"], knownComplete: true, at: 1 }, openDetail.order), false);
  // Gate status=finished omits zero-fill cancelled orders; absentMeansDone settles immediately once balances unlock
  assert.equal(isSettled(undefined, true, (o) => !isOpen(o), true), true);
  assert.equal(isSettled(undefined, false, (o) => !isOpen(o), true), false);
  assert.equal(isSettled(undefined, true, (o) => !isOpen(o), false), false);
  assert.equal(parseGateOrders([ { id: "101", status: "open", side: "sell", amount: "10", price: "0.6" } ])?.length, 1);
  assert.equal(syntheticIntID("987654321098765432"), syntheticIntID("987654321098765432"));
});

test("Gate wallet chains, multichain deposit addresses, history and saved addresses", () => {
  const cur = parseGateCurrency(
    [
      { chain: "BSC", name_cn: "BNB Smart Chain", name_en: "BSC", decimal: "8", is_disabled: 0, is_deposit_disabled: 0, is_withdraw_disabled: 0, is_tag: 0, withdraw_amount_min: "1" },
      { chain: "GRAM", name_cn: "TON", name_en: "TON", decimal: "6", is_disabled: 0, is_deposit_disabled: 0, is_withdraw_disabled: 0, is_tag: 1, withdraw_amount_min: "1" },
      { chain: "NEAR", name_cn: "NEAR", name_en: "NEAR", decimal: "6", is_disabled: 0, is_deposit_disabled: 0, is_withdraw_disabled: 1, is_tag: 0, withdraw_amount_min: "1" },
      { chain: "TRX", name_cn: "Tron", name_en: "Tron(TRC20)", decimal: "6", is_disabled: 0, is_deposit_disabled: 0, is_withdraw_disabled: 0, is_tag: 0, withdraw_amount_min: "10" },
      { chain: "KAIA", name_cn: "Kaia", name_en: "Kaia", decimal: "6", is_disabled: 0, is_deposit_disabled: 0, is_withdraw_disabled: 0, is_tag: 0, withdraw_amount_min: "1" },
      { chain: "PEARL", name_cn: "PEARL", name_en: "PEARL", decimal: "8", is_disabled: 0, is_deposit_disabled: 0, is_withdraw_disabled: 0, is_tag: 0, withdraw_amount_min: "0.01" },
    ],
    [{ currency: "USDT", withdraw_fix_on_chains: { BSC: "0.5", GRAM: "0.2", TRX: "1.5" }, withdraw_percent_on_chains: { BSC: "0%" }, withdraw_amount_mini: "2" }],
    false,
    "USDT",
  )!;
  assert.equal(cur.precision, 8);
  assert.equal(cur.networks.length, 6);
  const [bsc, ton, near, trx, kaia, pearl] = cur.networks;
  assert.equal(canDeposit(bsc), true);
  assert.equal(canWithdraw(bsc), true);
  assert.equal(bsc.precision, 8);
  assert.equal(ton.precision, 6);
  assert.equal(trx.precision, 6);
  assert.equal(decText(withdrawFee(bsc, dec("100")!), 8), "0.5");
  assert.equal(decText(minWithdraw(bsc), 8), "2");
  assert.equal(decText(minWithdraw(trx), 8), "10"); // per-chain withdraw_amount_min (10) overrides coin-level (2)
  assert.equal(ton.requiresMemo, true);
  assert.equal(canWithdraw(near), false);
  assert.equal(isValidChainAddress(near, "alice.near"), true);
  assert.equal(isValidChainAddress(kaia, "0x52908400098527886E0F7030069857D2E4169EE7"), true);
  assert.equal(isValidChainAddress(kaia, "0x52908400098527886E0F7030069857D2E4169ee7"), false); // EIP-55 mismatch
  assert.equal(explorerURL(bsc, "0xabc"), "https://bscscan.com/tx/0xabc");
  assert.equal(explorerURL(ton, "txton"), "https://tonviewer.com/transaction/txton");
  assert.equal(explorerURL(pearl, "txprl"), "https://blockbook.pearlresearch.ai/tx/txprl");

  const addrTon = parseGateDepositAddress({
    currency: "USDT",
    multichain_addresses: [
      { chain: "BSC", address: "0x1111111111111111111111111111111111111111", payment_id: "", obtain_failed: 0 },
      { chain: "TON", address: "EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t", payment_id: "109482", obtain_failed: 0 },
      { chain: "SOL", address: "", payment_id: "", obtain_failed: 1 },
    ],
  }, "usdt", "TON")!;
  assert.equal(plainAddress(addrTon), "EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t");
  assert.equal(memoOf(addrTon), "109482");
  assert.equal(plainAddress(parseGateDepositAddress({ currency: "USDT", multichain_addresses: [{ chain: "SOL", address: "", obtain_failed: 1 }] }, "usdt", "SOL")!), "");
  // English status sentence during initial address generation is never treated as a ready address
  assert.equal(
    plainAddress(parseGateDepositAddress({
      currency: "PEARL",
      address: "New address is being generated for you, please wait a moment and refresh this page. ",
      multichain_addresses: [],
    }, "pearl", "PEARL")!),
    "",
  );

  const deps = parseGateDeposits([
    { id: "d200", currency: "PEARL", chain: "PEARL", amount: "100", txid: "tx2", status: "DONE", timestamp: "1700000500" },
    { id: "d199", currency: "PEARL", chain: "PEARL", amount: "50", txid: "tx1", status: "PEND", timestamp: "1700000100" },
  ], "pearl")!;
  assert.equal(deps[0].status, "credited");
  assert.equal(deps[1].status, "processing");

  const wdrs = parseGateWithdraws([
    { id: "w501", currency: "USDT", chain: "BSC", amount: "25", address: "0x2222222222222222222222222222222222222222", txid: "0xdead", status: "DONE", timestamp: "1700000900" },
    { id: "w500", currency: "USDT", chain: "BSC", amount: "10", address: "0x2222222222222222222222222222222222222222", status: "CANCEL", timestamp: "1700000200" },
  ])!;
  assert.equal(wdrs[0].rawId, "w501");
  assert.equal(wdrs[0].state, "done");
  assert.equal(wdrs[1].state, "cancelled");

  const saved = parseGateSavedAddresses([
    { currency: "Universal address", chain: "ETH", address: "0x52908400098527886E0F7030069857D2E4169EE7", name: "Main ETH", tag: "", verified: "1" },
    { currency: "USDT", chain: "TON", address: "EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t", name: "My TON", tag: "8899", verified: "1" },
    { currency: "USDT", chain: "BSC", address: "0x3333333333333333333333333333333333333333", name: "Unverified", verified: "0" },
  ], "usdt")!;
  assert.equal(saved[0].currencyID, undefined); // Universal address -> undefined so TradeFunds matches by chain
  assert.equal(saved[0].active, true);
  assert.equal(saved[1].currencyID, "usdt");
  assert.equal(saved[1].active, true);
  assert.equal(saved[1].memo, "8899");
  assert.equal(saved[2].active, false);
});

test("Gate auth & error messages map IP whitelist, signature, clock skew and IOC failures cleanly", () => {
  assert.deepEqual(gateAuthProblem(403, JSON.stringify({ label: "INVALID_IP", message: "IP not in whitelist" })), { kind: "untrustedIP" });
  assert.deepEqual(gateAuthProblem(401, JSON.stringify({ label: "INVALID_SIGNATURE" })), { kind: "badKey" });
  assert.deepEqual(gateAuthProblem(401, JSON.stringify({ label: "REQUEST_EXPIRED" })), { kind: "clock" });
  assert.deepEqual(gateAuthProblem(403, "<html>Cloudflare</html>"), { kind: "firewall" });
  assert.deepEqual(gateAuthProblem(403, JSON.stringify({ label: "FORBIDDEN", message: "No withdraw permission" })), { kind: "other", keys: ["FORBIDDEN"] });

  const wlBody = JSON.stringify({ label: "WITHDRAW_ADDRESS_NOT_WHITELISTED", message: "Withdrawal address is not in whitelist" });
  assert.equal(isGateAddressWhitelistError(wlBody), true);
  assert.equal(gateAuthProblem(403, wlBody), null);
  assert.match(gateFailureMessage({ kind: "http", status: 403, body: wlBody }, tr), /收款地址不在 Gate 提币白名单中/);

  assert.match(gateFailureMessage({ kind: "http", status: 422, body: JSON.stringify({ label: "IOC_NOT_FILLED" }) }, tr), /盘口深度不够/);
  assert.match(gateFailureMessage({ kind: "http", status: 400, body: JSON.stringify({ label: "BALANCE_NOT_ENOUGH" }) }, tr), /Gate 可用余额不足/);
  assert.match(gateFailureMessage({ kind: "noCredentials" }, tr), /未配置 Gate API 密钥/);
});

test("trade-copy.json covers every tr() key across all 15 non-zh-Hans languages with matching slots", () => {
  const copy = JSON.parse(readFileSync(new URL("../src/trade-copy.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;
  const srcDir = new URL("../src/", import.meta.url).pathname;
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(/(?<![A-Za-z0-9_])tr\(\s*"([^"]+)"/g)) used.add(m[1]);
      }
    }
  };
  walk(srcDir);
  const passthrough = new Set([" {0} PEARL", "MAX {0}", "{0} PEARL @ {1}"]);
  const slotsOf = (s: string) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort();
  for (const k of used) {
    if (passthrough.has(k)) continue;
    for (const [lang, table] of Object.entries(copy)) {
      assert.ok(Object.hasOwn(table, k), `Missing ${lang} trade-copy translation for: ${k}`);
      const val = table[k];
      assert.deepEqual(slotsOf(val), slotsOf(k), `Slot mismatch in ${lang} for ${k}: ${val}`);
    }
  }
});

test("KeyGuide renders all 6 steps, exchange switcher, API links and fill button for both Gate and SafeTrade", async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createServer } = await import("vite");
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  try {
    const { KeyGuide } = await server.ssrLoadModule("/src/TradeKeys.tsx");
    const { tradeText } = await server.ssrLoadModule("/src/trade-i18n.ts");
    for (const lang of ["zh-Hans", "en", "ja", "ko", "ru", "es"] as const) {
      const t = tradeText(lang);
      const gateHtml = renderToStaticMarkup(
        React.createElement(KeyGuide, { tr: t, exchange: "gate", onFillKeys: () => {} }),
      );
      assert.match(gateHtml, /https:\/\/www\.gate\.com\/myaccount\/apikeys/);
      assert.ok(gateHtml.includes(t("创建 API v4 密钥")), `Gate step 2 missing in ${lang}`);
      assert.ok(gateHtml.includes(t("填写 API 密钥")), `Fill button missing in ${lang}`);
      assert.equal((gateHtml.match(/class="trade-step-n"/g) ?? []).length, 6);

      const stHtml = renderToStaticMarkup(
        React.createElement(KeyGuide, { tr: t, exchange: "safetrade", onFillKeys: () => {} }),
      );
      assert.match(stHtml, /https:\/\/safetrade\.com\/my\/api/);
      assert.ok(stHtml.includes(t("填写 Trusted IPs")), `SafeTrade step 4 missing in ${lang}`);
      assert.ok(stHtml.includes(t("填写 API 密钥")), `Fill button missing in ${lang}`);
      assert.equal((stHtml.match(/class="trade-step-n"/g) ?? []).length, 6);
    }
  } finally {
    await server.close();
  }
});
