// Global 24h PEARL trading volume share & CEX/DEX liquidity pools, mirroring
// alerts/src/markets.js and prl-hub Sources/Trade/TradeVolumeShare.swift.
import { ANDROID } from "./android.ts";
import { api } from "./api.ts";

export type MarketKind = "cex" | "pool";
export type MarketFilter = "all" | "cex" | "pool";

export type MarketVenue = {
  id: string;
  venue: string;
  pair: string;
  kind: MarketKind;
  chain?: string | null;
  priceUsd?: number | null;
  volumeUsd24h: number;
  liquidityUsd?: number | null;
  share: number;
  tradeUrl?: string | null;
  inAppExchange?: "safetrade" | "gate" | null;
};

export type MarketsSnapshot = {
  updatedAt?: string | null;
  totalVolumeUsd24h: number;
  cexVolumeUsd24h: number;
  poolVolumeUsd24h: number;
  items: MarketVenue[];
};

export type MarketVolumeSlice = {
  id: string;
  name: string;
  volumeUsd: number;
  share: number;
  isPool: boolean;
};

const KNOWN_CONTRACTS: Record<string, string> = {
  "prl.omft.near": "PEARL",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "USDC",
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near": "USDC.e",
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near": "USDT.e",
  "usdt.tether-token.near": "USDT",
  "eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": "USDT",
  "sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near": "USDT",
  "tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near": "USDT",
  "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": "USDC",
  "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": "USDC",
  "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": "USDC",
  "arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near": "USDC",
  "sol.omft.near": "SOL",
  "btc.omft.near": "BTC",
  "nbtc.bridge.near": "BTC",
  "eth.omft.near": "ETH",
  "aurora": "ETH",
  "zec.omft.near": "ZEC",
  "tlr.omft.near": "TLR",
  "eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near": "TLR",
  "qtc.omft.near": "QTC",
  "eth-0x0520280f6b2d39efbd49be01e1c4a5ac9ef3a2ab.omft.near": "QTC",
  "doge.omft.near": "DOGE",
  "xrp.omft.near": "XRP",
  "wrap.near": "wNEAR",
};

const POOL_IDENTIFIERS = new Set([
  "near-intents", "near_intents", "rhea-finance", "rhea_finance",
  "ref-finance", "ref_finance", "uniswap", "raydium", "orca", "pancakeswap",
]);

export const EXCLUDED_VENUES = new Set([
  "bigone", "ourbit", "lbank", "margin-trade",
]);

function isExcludedVenue(id: string, venue: string): boolean {
  const prefix = id.split(":")[0]?.trim().toLowerCase() ?? "";
  if (EXCLUDED_VENUES.has(prefix)) return true;
  const norm = venue.trim().toLowerCase().replace(/\s+/g, "-");
  return EXCLUDED_VENUES.has(norm);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function normalizeVenue(rawId: string, rawName: string): {
  key: string; venue: string; kind: MarketKind; chain: string | null; fallbackUrl: string | null;
} {
  const id = rawId.trim().toLowerCase();
  const name = rawName.trim();
  switch (id) {
    case "gate": case "gate-io": case "gate_io":
      return { key: "gate", venue: "Gate", kind: "cex", chain: null, fallbackUrl: "https://www.gate.com/trade/PEARL_USDT" };
    case "safetrade": case "safe_trade": case "safe-trade":
      return { key: "safetrade", venue: "SafeTrade", kind: "cex", chain: null, fallbackUrl: "https://safetrade.com/exchange/PEARL-USDT" };
    case "bigone":
      return { key: "bigone", venue: "BigONE", kind: "cex", chain: null, fallbackUrl: "https://big.one/trade/PEARL-USDT" };
    case "coinex":
      return { key: "coinex", venue: "CoinEx", kind: "cex", chain: null, fallbackUrl: "https://www.coinex.com/en/exchange/pearl-usdt" };
    case "gdax": case "coinbase_exchange": case "coinbase":
      return { key: "coinbase", venue: "Coinbase Exchange", kind: "cex", chain: null, fallbackUrl: "https://www.coinbase.com/advanced-trade/spot/PEARL-USD" };
    case "kraken":
      return { key: "kraken", venue: "Kraken", kind: "cex", chain: null, fallbackUrl: "https://pro.kraken.com/app/trade/PEARL-USD" };
    case "lbank":
      return { key: "lbank", venue: "LBank", kind: "cex", chain: null, fallbackUrl: "https://www.lbank.com/trade/pearl_usdt" };
    case "ourbit":
      return { key: "ourbit", venue: "Ourbit", kind: "cex", chain: null, fallbackUrl: "https://www.ourbit.com/exchange/PRL_USDT" };
    case "margin-trade-spot": case "margin_trade": case "margin-trade":
      return { key: "margin-trade", venue: "Margin Trade", kind: "cex", chain: null, fallbackUrl: "https://margin.trade/trade" };
    case "near-intents": case "near_intents":
      return { key: "near-intents", venue: "Near Intents", kind: "pool", chain: "near", fallbackUrl: "https://app.near-intents.org/" };
    case "rhea-finance": case "rhea_finance": case "ref_finance": case "ref-finance":
      return { key: "rhea-finance", venue: "Rhea Finance", kind: "pool", chain: "near", fallbackUrl: "https://app.rhea.finance/" };
    default: {
      const isPool = POOL_IDENTIFIERS.has(id) || id.includes("swap") || id.includes("dex") || id.includes("intents");
      return { key: id || name.toLowerCase(), venue: name || id, kind: isPool ? "pool" : "cex", chain: null, fallbackUrl: null };
    }
  }
}

export function cleanMarketSymbol(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (KNOWN_CONTRACTS[lower]) return KNOWN_CONTRACTS[lower];
  if (lower.endsWith(".omft.near")) {
    const prefix = lower.slice(0, -".omft.near".length);
    if (prefix.startsWith("eth-0xdac17")) return "USDT";
    if (prefix.startsWith("eth-0xa0b86")) return "USDC";
    if (!prefix.includes("-") && prefix.length <= 10) {
      const up = prefix.toUpperCase();
      return up === "PRL" ? "PEARL" : up;
    }
  }
  if (trimmed.length > 16) return `${trimmed.slice(0, 6).toUpperCase()}…`;
  return trimmed;
}

export function filterMarkets(items: MarketVenue[], filter: MarketFilter): MarketVenue[] {
  if (filter === "cex") return items.filter((i) => i.kind !== "pool");
  if (filter === "pool") return items.filter((i) => i.kind === "pool");
  return items;
}

export function volumeSlices(items: MarketVenue[], total: number): MarketVolumeSlice[] {
  if (!(total > 0) || !items.length) return [];
  const grouped = new Map<string, { vol: number; isPool: boolean }>();
  for (const item of items) {
    if (!(item.volumeUsd24h > 0)) continue;
    const prev = grouped.get(item.venue);
    grouped.set(item.venue, {
      vol: (prev?.vol ?? 0) + item.volumeUsd24h,
      isPool: prev ? prev.isPool && item.kind === "pool" : item.kind === "pool",
    });
  }
  const sorted = [...grouped.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.vol - a.vol);
  const out: MarketVolumeSlice[] = [];
  let tail = 0;
  sorted.forEach((entry, idx) => {
    const s = entry.vol / total;
    if (idx >= 7 || s < 0.015) {
      tail += entry.vol;
      return;
    }
    out.push({ id: entry.name, name: entry.name, volumeUsd: entry.vol, share: s, isPool: entry.isPool });
  });
  if (tail / total > 0.002) {
    out.push({ id: "_other", name: "_other", volumeUsd: tail, share: tail / total, isPool: false });
  }
  return out;
}

export function hitTestVolumeSlice(
  vx: number,
  vy: number,
  slices: MarketVolumeSlice[],
  cx = 120,
  cy = 120,
  innerRadius = 66,
  outerRadius = 115,
): MarketVolumeSlice | null {
  if (!slices.length) return null;
  const dx = vx - cx;
  const dy = vy - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < innerRadius || dist > outerRadius) return null;
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.volumeUsd), 0);
  if (!(total > 0)) return null;
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += Math.PI * 2;
  const target = (angle / (Math.PI * 2)) * total;
  let cumulative = 0;
  for (const s of slices) {
    const vol = Math.max(0, s.volumeUsd);
    if (!(vol > 0)) continue;
    cumulative += vol;
    if (target <= cumulative) return s;
  }
  return slices.at(-1) ?? null;
}

export function normalizeMarketsSnapshot(raw: unknown): MarketsSnapshot | null {
  const o = obj(raw);
  if (!o) return null;
  const list = Array.isArray(o.items) ? o.items : Array.isArray(o.rows) ? o.rows : null;
  if (!list || list.length === 0) return null;
  const updatedAt = typeof o.updatedAt === "string" && o.updatedAt
    ? o.updatedAt
    : typeof o.ts === "number" && Number.isFinite(o.ts)
      ? new Date(o.ts * 1000).toISOString()
      : null;
  const items: MarketVenue[] = [];
  let stripped = false;
  for (const r of list) {
    const row = obj(r);
    if (!row || typeof row.id !== "string" || typeof row.venue !== "string" || typeof row.pair !== "string") continue;
    if (isExcludedVenue(row.id, row.venue)) {
      stripped = true;
      continue;
    }
    const inApp = row.inAppExchange === "safetrade" || row.inAppExchange === "gate" ? row.inAppExchange : null;
    items.push({
      id: row.id,
      venue: row.venue,
      pair: row.pair,
      kind: row.kind === "pool" ? "pool" : "cex",
      chain: typeof row.chain === "string" ? row.chain : null,
      priceUsd: num(row.priceUsd),
      volumeUsd24h: num(row.volumeUsd24h) ?? 0,
      liquidityUsd: num(row.liquidityUsd),
      share: num(row.share) ?? 0,
      tradeUrl: typeof row.tradeUrl === "string" ? row.tradeUrl : null,
      inAppExchange: inApp,
    });
  }
  if (!items.length) return null;
  if (stripped) return recomputeSnapshot(updatedAt, items);
  return {
    updatedAt,
    totalVolumeUsd24h: num(o.totalVolumeUsd24h) ?? items.reduce((a, i) => a + i.volumeUsd24h, 0),
    cexVolumeUsd24h: num(o.cexVolumeUsd24h) ?? items.filter((i) => i.kind !== "pool").reduce((a, i) => a + i.volumeUsd24h, 0),
    poolVolumeUsd24h: num(o.poolVolumeUsd24h) ?? items.filter((i) => i.kind === "pool").reduce((a, i) => a + i.volumeUsd24h, 0),
    items,
  };
}

export function buildFallbackMarkets(sources: {
  coingecko?: unknown;
  gate?: unknown;
  safetrade?: unknown;
  dexscreener?: unknown;
}): MarketsSnapshot {
  const byKey = new Map<string, MarketVenue>();

  const cg = obj(sources.coingecko);
  if (Array.isArray(cg?.tickers)) {
    for (const raw of cg.tickers) {
      const t = obj(raw);
      if (!t || t.is_stale === true) continue;
      const market = obj(t.market);
      const rawId = typeof market?.identifier === "string" ? market.identifier : "";
      const rawName = typeof market?.name === "string" ? market.name : "";
      const v = normalizeVenue(rawId, rawName);
      if (EXCLUDED_VENUES.has(v.key)) continue;
      const rawBase = cleanMarketSymbol(t.base);
      const rawTarget = cleanMarketSymbol(t.target);
      if ((v.key === "gate" || v.key === "coinex") && rawBase.toUpperCase() === "PRL") continue;
      const baseIsPearl = rawBase.toUpperCase() === "PEARL" || rawBase.toUpperCase() === "PRL";
      const targetIsPearl = !baseIsPearl && (rawTarget.toUpperCase() === "PEARL" || rawTarget.toUpperCase() === "PRL");
      if (!baseIsPearl && !targetIsPearl) continue;
      const base = baseIsPearl && v.kind !== "pool" && rawBase.toUpperCase() === "PRL" ? "PRL" : "PEARL";
      const quote = baseIsPearl ? rawTarget : rawBase;
      if (!quote || quote.toUpperCase() === "PEARL" || quote.toUpperCase() === "PRL") continue;
      const pair = `${base}/${quote}`;
      const convLast = num(obj(t.converted_last)?.usd);
      const convVol = Math.max(0, num(obj(t.converted_volume)?.usd) ?? 0);
      const inApp: "safetrade" | "gate" | null = v.key === "safetrade" && pair === "PEARL/USDT" ? "safetrade"
        : v.key === "gate" && pair === "PEARL/USDT" ? "gate" : null;
      const id = `${v.key}:${pair.toLowerCase()}`;
      const tradeUrl = typeof t.trade_url === "string" && t.trade_url
        ? t.trade_url
        : v.fallbackUrl;
      const prev = byKey.get(id);
      const keepPrevPrice = prev != null && prev.volumeUsd24h >= convVol;
      byKey.set(id, {
        id,
        venue: v.venue,
        pair,
        kind: v.kind,
        chain: v.chain,
        priceUsd: keepPrevPrice ? (prev.priceUsd ?? convLast) : (convLast ?? prev?.priceUsd ?? null),
        volumeUsd24h: (prev?.volumeUsd24h ?? 0) + convVol,
        liquidityUsd: prev?.liquidityUsd ?? null,
        share: 0,
        tradeUrl: (keepPrevPrice ? prev.tradeUrl : null) ?? tradeUrl ?? prev?.tradeUrl ?? null,
        inAppExchange: inApp ?? prev?.inAppExchange ?? null,
      });
    }
  }

  if (Array.isArray(sources.gate) && sources.gate.length > 0) {
    const g = sources.gate.map(obj).find((r) => r?.currency_pair === "PEARL_USDT") ?? obj(sources.gate[0]);
    if (g) {
      const last = num(g.last);
      const qVol = Math.max(0, num(g.quote_volume) ?? 0);
      const id = "gate:pearl/usdt";
      const prev = byKey.get(id);
      byKey.set(id, {
        id,
        venue: "Gate",
        pair: "PEARL/USDT",
        kind: "cex",
        chain: null,
        priceUsd: last ?? prev?.priceUsd ?? null,
        volumeUsd24h: qVol > 0 ? qVol : (prev?.volumeUsd24h ?? 0),
        liquidityUsd: null,
        share: 0,
        tradeUrl: "https://www.gate.com/trade/PEARL_USDT",
        inAppExchange: "gate",
      });
    }
  }

  const stTicker = obj(obj(sources.safetrade)?.ticker);
  if (stTicker) {
    const last = num(stTicker.last);
    // SafeTrade Peatio's `volume` / `vol` is already 24h USDT quote volume (`amount` is base PEARL volume).
    const quoteVol = num(stTicker.volume) ?? num(stTicker.vol);
    const baseAmt = num(stTicker.amount);
    const qVol = quoteVol != null && quoteVol > 0
      ? quoteVol
      : (last != null && baseAmt != null && last > 0 && baseAmt > 0 ? last * baseAmt : 0);
    const id = "safetrade:pearl/usdt";
    const prev = byKey.get(id);
    if (qVol > 0 || prev) {
      byKey.set(id, {
        id,
        venue: "SafeTrade",
        pair: "PEARL/USDT",
        kind: "cex",
        chain: null,
        priceUsd: last ?? prev?.priceUsd ?? null,
        volumeUsd24h: qVol > 0 ? qVol : (prev?.volumeUsd24h ?? 0),
        liquidityUsd: null,
        share: 0,
        tradeUrl: "https://safetrade.com/exchange/PEARL-USDT",
        inAppExchange: "safetrade",
      });
    }
  }

  const dex = obj(sources.dexscreener);
  if (Array.isArray(dex?.pairs)) {
    const dexGrouped = new Map<string, MarketVenue>();
    for (const raw of dex.pairs) {
      const p = obj(raw);
      if (!p) continue;
      const baseTok = obj(p.baseToken), quoteTok = obj(p.quoteToken);
      const bAddr = (typeof baseTok?.address === "string" ? baseTok.address : "").toLowerCase();
      const qAddr = (typeof quoteTok?.address === "string" ? quoteTok.address : "").toLowerCase();
      const bSym = (typeof baseTok?.symbol === "string" ? baseTok.symbol : "").toUpperCase();
      const qSym = (typeof quoteTok?.symbol === "string" ? quoteTok.symbol : "").toUpperCase();
      const baseIsPearl = bAddr === "prl.omft.near" || bSym === "PEARL" || bSym === "PRL";
      const quoteIsPearl = qAddr === "prl.omft.near" || qSym === "PEARL" || qSym === "PRL";
      if (!baseIsPearl && !quoteIsPearl) continue;
      const counterTok = baseIsPearl ? quoteTok : baseTok;
      const counterAddr = (typeof counterTok?.address === "string" ? counterTok.address : "").toLowerCase();
      const quote = KNOWN_CONTRACTS[counterAddr]
        || cleanMarketSymbol(counterTok?.symbol)
        || cleanMarketSymbol(counterTok?.address);
      if (!quote) continue;
      const dexId = (typeof p.dexId === "string" && p.dexId ? p.dexId : "dex").toLowerCase();
      const isRhea = dexId.includes("rhea") || dexId.includes("ref");
      const venue = isRhea ? "Rhea Finance" : `${dexId.charAt(0).toUpperCase()}${dexId.slice(1)}`;
      const mKey = isRhea ? "rhea-finance" : dexId;
      const pair = `PEARL/${quote}`;
      const id = `${mKey}:${pair.toLowerCase()}`;
      const vol = Math.max(0, num(obj(p.volume)?.h24) ?? 0);
      const liq = num(obj(p.liquidity)?.usd);
      if (vol <= 0 && (liq ?? 0) < 500) continue;
      const rawPrice = num(p.priceUsd);
      const priceNative = num(p.priceNative);
      const pearlPrice = baseIsPearl
        ? rawPrice
        : rawPrice != null && priceNative != null && priceNative > 0 ? rawPrice / priceNative : null;
      const prev = dexGrouped.get(id);
      const summedLiq = (prev?.liquidityUsd ?? 0) + (liq ?? 0);
      dexGrouped.set(id, {
        id,
        venue,
        pair,
        kind: "pool",
        chain: typeof p.chainId === "string" && p.chainId ? p.chainId : "near",
        priceUsd: (prev && (prev.liquidityUsd ?? 0) >= (liq ?? 0)) ? (prev.priceUsd ?? pearlPrice) : (pearlPrice ?? prev?.priceUsd ?? null),
        volumeUsd24h: (prev?.volumeUsd24h ?? 0) + vol,
        liquidityUsd: summedLiq > 0 ? summedLiq : null,
        share: 0,
        tradeUrl: typeof p.url === "string" && p.url ? p.url : (prev?.tradeUrl ?? (isRhea ? "https://app.rhea.finance/" : null)),
        inAppExchange: null,
      });
    }
    for (const [id, dv] of dexGrouped.entries()) {
      const prev = byKey.get(id);
      byKey.set(id, {
        ...dv,
        priceUsd: dv.priceUsd ?? prev?.priceUsd ?? null,
        volumeUsd24h: dv.volumeUsd24h > 0 ? dv.volumeUsd24h : (prev?.volumeUsd24h ?? 0),
        liquidityUsd: dv.liquidityUsd ?? prev?.liquidityUsd ?? null,
        tradeUrl: dv.tradeUrl ?? prev?.tradeUrl ?? null,
      });
    }
  }

  const sorted = [...byKey.values()].sort((a, b) => {
    if (b.volumeUsd24h !== a.volumeUsd24h) return b.volumeUsd24h - a.volumeUsd24h;
    return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
  });
  const total = sorted.reduce((acc, i) => acc + i.volumeUsd24h, 0);
  const cexVol = sorted.filter((i) => i.kind !== "pool").reduce((acc, i) => acc + i.volumeUsd24h, 0);
  const poolVol = sorted.filter((i) => i.kind === "pool").reduce((acc, i) => acc + i.volumeUsd24h, 0);
  const items = sorted.map((i) => ({ ...i, share: total > 0 ? i.volumeUsd24h / total : 0 }));
  return {
    updatedAt: new Date().toISOString(),
    totalVolumeUsd24h: total,
    cexVolumeUsd24h: cexVol,
    poolVolumeUsd24h: poolVol,
    items,
  };
}

async function getJSON(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let cached: { snapshot: MarketsSnapshot; at: number } | null = null;
let inflight: Promise<MarketsSnapshot> | null = null;

function recomputeSnapshot(updatedAt: string | null | undefined, items: MarketVenue[]): MarketsSnapshot {
  const sorted = [...items].sort((a, b) => {
    if (b.volumeUsd24h !== a.volumeUsd24h) return b.volumeUsd24h - a.volumeUsd24h;
    return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
  });
  const total = sorted.reduce((acc, i) => acc + i.volumeUsd24h, 0);
  const cexVol = sorted.filter((i) => i.kind !== "pool").reduce((acc, i) => acc + i.volumeUsd24h, 0);
  const poolVol = sorted.filter((i) => i.kind === "pool").reduce((acc, i) => acc + i.volumeUsd24h, 0);
  return {
    updatedAt,
    totalVolumeUsd24h: total,
    cexVolumeUsd24h: cexVol,
    poolVolumeUsd24h: poolVol,
    items: sorted.map((i) => ({ ...i, share: total > 0 ? i.volumeUsd24h / total : 0 })),
  };
}

export async function fetchMarkets(force = false): Promise<MarketsSnapshot> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.snapshot;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await api<unknown>("/v1/markets");
      let snap = normalizeMarketsSnapshot(raw);
      if (snap) {
        // SafeTrade's Cloudflare WAF blocks Worker fetches when safetrade-push is idle, whereas browsers pass CORS:
        // supplement SafeTrade PEARL/USDT directly when absent from /v1/markets.
        if (!snap.items.some((i) => i.inAppExchange === "safetrade")) {
          if (!ANDROID) {
            const safetrade = await getJSON("https://safetrade.com/api/v2/peatio/public/markets/pearlusdt/tickers");
            const st = buildFallbackMarkets({ safetrade }).items[0];
            if (st) snap = recomputeSnapshot(snap.updatedAt, [...snap.items, st]);
          } else {
            const coingecko = await getJSON("https://api.coingecko.com/api/v3/coins/pearl-2/tickers");
            const cgItems = buildFallbackMarkets({ coingecko }).items;
            if (cgItems.length > 0) {
              const have = new Set(snap.items.map((i) => `${i.venue.toLowerCase()}:${i.pair.toLowerCase()}`));
              const missing = cgItems.filter((i) => !have.has(`${i.venue.toLowerCase()}:${i.pair.toLowerCase()}`));
              if (missing.length > 0) snap = recomputeSnapshot(snap.updatedAt, [...snap.items, ...missing]);
            }
          }
        }
        cached = { snapshot: snap, at: Date.now() };
        return snap;
      }
    } catch { /* Fall back to direct public APIs allowed by each platform's CSP when /v1/markets is unavailable. */ }
    if (!ANDROID) {
      // Web CSP allows only pearlhub.net, Turnstile, SafeTrade and Gate (see security-overview.test.ts).
      const [gate, safetrade] = await Promise.all([
        getJSON("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=PEARL_USDT"),
        getJSON("https://safetrade.com/api/v2/peatio/public/markets/pearlusdt/tickers"),
      ]);
      const built = buildFallbackMarkets({ gate, safetrade });
      if (built.items.length > 0) cached = { snapshot: built, at: Date.now() };
      return built.items.length > 0 ? built : (cached?.snapshot ?? built);
    }
    const [coingecko, gate, dexscreener] = await Promise.all([
      getJSON("https://api.coingecko.com/api/v3/coins/pearl-2/tickers"),
      getJSON("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=PEARL_USDT"),
      getJSON("https://api.dexscreener.com/latest/dex/tokens/prl.omft.near"),
    ]);
    const built = buildFallbackMarkets({ coingecko, gate, dexscreener });
    if (built.items.length > 0) cached = { snapshot: built, at: Date.now() };
    return built.items.length > 0 ? built : (cached?.snapshot ?? built);
  })().finally(() => { inflight = null; });
  return inflight;
}

export function compactUSD(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

export function formatUsdPrice(value: number): string {
  if (value >= 10) return `$${value.toFixed(2)}`;
  if (value >= 0.1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}
