import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackMarkets, cleanMarketSymbol, compactUSD, fetchMarkets,
  filterMarkets, formatUsdPrice, hitTestVolumeSlice, normalizeMarketsSnapshot, volumeSlices,
} from "../src/markets.ts";
import { EXCHANGE_STORAGE_KEY, hasSavedExchange, savedExchange, saveExchange, subscribeExchange } from "../src/kline.ts";

test("cleanMarketSymbol normalizes NEAR intents & bridge contracts to readable tickers", () => {
  assert.equal(cleanMarketSymbol("prl.omft.near"), "PEARL");
  assert.equal(cleanMarketSymbol("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), "USDC");
  assert.equal(cleanMarketSymbol("eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near"), "USDT");
  assert.equal(cleanMarketSymbol("sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near"), "USDT");
  assert.equal(cleanMarketSymbol("eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near"), "TLR");
  assert.equal(cleanMarketSymbol("wrap.near"), "wNEAR");
  assert.equal(cleanMarketSymbol("zec.omft.near"), "ZEC");
  assert.equal(cleanMarketSymbol("tlr.omft.near"), "TLR");
  assert.equal(cleanMarketSymbol("btc.omft.near"), "BTC");
  assert.equal(cleanMarketSymbol("USDT"), "USDT");
});

test("buildFallbackMarkets aggregates CEX spot pairs, Gate live quote, Near Intents and Rhea Finance pools without double counting", () => {
  const snapshot = buildFallbackMarkets({
    coingecko: {
      tickers: [
        {
          base: "PEARL",
          target: "USDT",
          market: { name: "BigONE", identifier: "bigone" },
          converted_last: { usd: 0.528 },
          converted_volume: { usd: 210_000 },
          trade_url: "https://big.one/en/trade/PEARL-USDT",
        },
        {
          base: "PRL",
          target: "USDT",
          market: { name: "Ourbit", identifier: "ourbit" },
          converted_last: { usd: 0.528 },
          converted_volume: { usd: 190_000 },
          trade_url: "https://www.ourbit.com/exchange/PRL_USDT",
        },
        {
          base: "PEARL",
          target: "USDT",
          market: { name: "LBank", identifier: "lbank" },
          converted_last: { usd: 0.528 },
          converted_volume: { usd: 120_000 },
          trade_url: "https://www.lbank.com/trade/pearl_usdt",
        },
        {
          base: "PEARL",
          target: "USD",
          market: { name: "Coinbase Exchange", identifier: "gdax" },
          converted_last: { usd: 0.528 },
          converted_volume: { usd: 210_000 },
          trade_url: "https://www.coinbase.com/advanced-trade/spot/PEARL-USD",
        },
        {
          base: "PEARL",
          target: "USDT",
          market: { name: "SafeTrade", identifier: "safe_trade" },
          converted_last: { usd: 0.525 },
          converted_volume: { usd: 45_000 },
          trade_url: "https://safetrade.com/exchange/PEARL-USDT",
        },
        {
          base: "PEARL",
          target: "USDC",
          market: { name: "SafeTrade", identifier: "safe_trade" },
          converted_last: { usd: 0.524 },
          converted_volume: { usd: 5_000 },
          trade_url: "https://safetrade.com/exchange/PEARL-USDC",
        },
        {
          base: "PEARL",
          target: "USDT",
          market: { name: "Gate", identifier: "gate" },
          converted_last: { usd: 0.520 },
          converted_volume: { usd: 90_000 },
        },
        {
          base: "PRL",
          target: "USDT",
          market: { name: "Gate", identifier: "gate" },
          converted_last: { usd: 0.0001 },
          converted_volume: { usd: 888_888 },
        },
        {
          base: "prl.omft.near",
          target: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
          market: { name: "Near Intents", identifier: "near-intents" },
          converted_last: { usd: 0.526 },
          converted_volume: { usd: 40_000 },
        },
        {
          base: "prl.omft.near",
          target: "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
          market: { name: "Near Intents", identifier: "near-intents" },
          converted_last: { usd: 0.525 },
          converted_volume: { usd: 20_000 },
        },
        {
          base: "PRL.OMFT.NEAR",
          target: "17208628F84F5D6AD33F0DA3BBBEB27FFCB398EAC501A31BD6AD2011E36133A1",
          market: { name: "Rhea Finance", identifier: "ref_finance" },
          converted_last: { usd: 0.526 },
          converted_volume: { usd: 32_000 },
        },
        {
          base: "PEARL",
          target: "USDT",
          market: { name: "StaleEx", identifier: "stale" },
          is_stale: true,
          converted_last: { usd: 0.5 },
          converted_volume: { usd: 999_999 },
        },
      ],
    },
    gate: [
      { currency_pair: "PEARL_USDT", last: "0.5275", quote_volume: "115000" },
    ],
    dexscreener: {
      pairs: [
        {
          chainId: "near",
          dexId: "rhea-finance",
          url: "https://dexscreener.com/near/rhea-pearl-usdc",
          baseToken: { address: "prl.omft.near", symbol: "PRL" },
          quoteToken: { address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC" },
          priceUsd: "0.5268",
          volume: { h24: 35_000 },
          liquidity: { usd: 142_500 },
        },
        {
          chainId: "near",
          dexId: "rhea-finance",
          baseToken: { address: "prl.omft.near", symbol: "PRL" },
          quoteToken: { address: "dust.near", symbol: "DUST" },
          priceUsd: "0.5",
          volume: { h24: 0 },
          liquidity: { usd: 12 },
        },
      ],
    },
  });

  assert.equal(snapshot.items.find((i) => i.venue === "BigONE"), undefined);
  assert.equal(snapshot.items.find((i) => i.venue === "Ourbit"), undefined);
  assert.equal(snapshot.items.find((i) => i.venue === "LBank"), undefined);

  // Total = Coinbase 210k + Gate 115k + Near Intents 60k (40k+20k) + SafeTrade USDT 45k + Rhea 35k (DexScreener replaces ref_finance 32k, no double count!) + SafeTrade USDC 5k = 470k
  assert.equal(snapshot.totalVolumeUsd24h, 470_000);
  assert.equal(snapshot.cexVolumeUsd24h, 375_000);
  assert.equal(snapshot.poolVolumeUsd24h, 95_000);
  assert.equal(snapshot.items.length, 6);

  const gateRow = snapshot.items.find((i) => i.id === "gate:pearl/usdt")!;
  assert.equal(gateRow.priceUsd, 0.5275);
  assert.equal(gateRow.volumeUsd24h, 115_000);
  assert.equal(gateRow.inAppExchange, "gate");

  const stUsdt = snapshot.items.find((i) => i.id === "safetrade:pearl/usdt")!;
  assert.equal(stUsdt.inAppExchange, "safetrade");
  const stUsdc = snapshot.items.find((i) => i.id === "safetrade:pearl/usdc")!;
  assert.equal(stUsdc.inAppExchange, null);

  const rhea = snapshot.items.find((i) => i.id === "rhea-finance:pearl/usdc")!;
  assert.equal(rhea.kind, "pool");
  assert.equal(rhea.liquidityUsd, 142_500);
  assert.equal(rhea.pair, "PEARL/USDC");

  const intents = snapshot.items.find((i) => i.id === "near-intents:pearl/usdc")!;
  assert.equal(intents.kind, "pool");
  assert.equal(intents.volumeUsd24h, 60_000);
  assert.equal(intents.tradeUrl, "https://app.near-intents.org/");

  // Filter checks
  assert.equal(filterMarkets(snapshot.items, "cex").length, 4);
  assert.equal(filterMarkets(snapshot.items, "pool").length, 2);
  assert.equal(filterMarkets(snapshot.items, "all").length, 6);

  // Donut slices group SafeTrade pairs together and sum to 1.0
  const slices = volumeSlices(snapshot.items, snapshot.totalVolumeUsd24h);
  const stSlice = slices.find((s) => s.name === "SafeTrade")!;
  assert.equal(stSlice.volumeUsd, 50_000);
  const shareSum = slices.reduce((a, s) => a + s.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9);
});

test("volumeSlices groups minor tail venues into _other; compactUSD and formatUsdPrice format cleanly", () => {
  const many = Array.from({ length: 10 }, (_, idx) => ({
    id: `v${idx}`,
    venue: `Venue ${idx}`,
    pair: "PEARL/USDT",
    kind: "cex" as const,
    volumeUsd24h: idx === 0 ? 910 : 10,
    share: (idx === 0 ? 910 : 10) / 1000,
  }));
  const slices = volumeSlices(many, 1000);
  assert.equal(slices[0].name, "Venue 0");
  assert.equal(slices.at(-1)?.id, "_other");
  assert.equal(slices.at(-1)?.volumeUsd, 90);

  assert.equal(compactUSD(0), "$0");
  assert.equal(compactUSD(850), "$850");
  assert.equal(compactUSD(42_300), "$42.3K");
  assert.equal(compactUSD(2_450_000), "$2.45M");
  assert.equal(formatUsdPrice(12.345), "$12.35");
  assert.equal(formatUsdPrice(0.52681), "$0.5268");
  assert.equal(formatUsdPrice(0.0042189), "$0.004219");
});

test("fetchMarkets uses /v1/markets when available and falls back cleanly on error", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/v1/markets")) {
        return Response.json({
          updatedAt: "2026-11-15T00:00:00Z",
          totalVolumeUsd24h: 100_000,
          cexVolumeUsd24h: 80_000,
          poolVolumeUsd24h: 20_000,
          items: [
            { id: "gate:pearl/usdt", venue: "Gate", pair: "PEARL/USDT", kind: "cex", volumeUsd24h: 80_000, share: 0.8, inAppExchange: "gate" },
            { id: "rhea-finance:pearl/usdc", venue: "Rhea Finance", pair: "PEARL/USDC", kind: "pool", volumeUsd24h: 20_000, share: 0.2 },
          ],
        });
      }
      return new Response("not needed", { status: 404 });
    };
    const res = await fetchMarkets(true);
    assert.equal(res.totalVolumeUsd24h, 100_000);
    assert.equal(res.items.length, 2);

    const workerShape = normalizeMarketsSnapshot({
      ok: true,
      schemaVersion: 1,
      ts: 1794747000,
      totalVolumeUsd24h: 3_000_000,
      cexVolumeUsd24h: 3_000_000,
      poolVolumeUsd24h: 0,
      rows: [
        { id: "gate:PEARL/USDT", venue: "Gate", pair: "PEARL/USDT", kind: "cex", priceUsd: 1.52, volumeUsd24h: 3_000_000, share: 1, inAppExchange: "gate" },
      ],
    })!;
    assert.equal(workerShape.items.length, 1);
    assert.ok(workerShape.updatedAt?.startsWith("2026-"));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("saveExchange and savedExchange persist last selected exchange across Market and Trade views", () => {
  const store = new Map<string, string>();
  const origStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
  try {
    assert.equal(hasSavedExchange(), false);
    assert.equal(savedExchange(), "safetrade");

    // Legacy kline.source migrates seamlessly
    store.set("pearlhub.kline.source", "gate");
    assert.equal(hasSavedExchange(), true);
    assert.equal(savedExchange(), "gate");

    const seen: string[] = [];
    const off = subscribeExchange((ex) => seen.push(ex));
    saveExchange("safetrade");
    assert.equal(store.get(EXCHANGE_STORAGE_KEY), "safetrade");
    assert.equal(savedExchange(), "safetrade");
    saveExchange("gate");
    assert.equal(store.get(EXCHANGE_STORAGE_KEY), "gate");
    assert.equal(savedExchange(), "gate");
    off();
    assert.deepEqual(seen, ["safetrade", "gate"]);
  } finally {
    if (origStorage === undefined) delete (globalThis as Record<string, unknown>).localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: origStorage });
  }
});

test("hitTestVolumeSlice maps 12-o'clock clockwise ring coordinates and excludes hole and margins", () => {
  const slices = [
    { id: "gate", name: "Gate", volumeUsd: 250, share: 0.25, isPool: false },
    { id: "intents", name: "Near Intents", volumeUsd: 500, share: 0.50, isPool: true },
    { id: "safetrade", name: "SafeTrade", volumeUsd: 250, share: 0.25, isPool: false },
  ];
  const pt = (deg: number, r = 88) => {
    const rad = (deg * Math.PI) / 180;
    return [120 + Math.sin(rad) * r, 120 - Math.cos(rad) * r] as const;
  };
  assert.equal(hitTestVolumeSlice(...pt(0), slices)?.id, "gate");
  assert.equal(hitTestVolumeSlice(...pt(45), slices)?.id, "gate");
  assert.equal(hitTestVolumeSlice(...pt(135), slices)?.id, "intents");
  assert.equal(hitTestVolumeSlice(...pt(225), slices)?.id, "intents");
  assert.equal(hitTestVolumeSlice(...pt(315), slices)?.id, "safetrade");
  assert.equal(hitTestVolumeSlice(...pt(359.5), slices)?.id, "safetrade");
  assert.equal(hitTestVolumeSlice(120, 120, slices), null);
  assert.equal(hitTestVolumeSlice(...pt(45, 50), slices), null);
  assert.equal(hitTestVolumeSlice(...pt(45, 130), slices), null);
});
