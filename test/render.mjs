// Browser-free rendering smoke check. This does not verify CSS layout or interaction.
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
try {
  const { FleetCalculator } = await server.ssrLoadModule("/src/FleetCalculator.tsx");
  const { WatchWallet } = await server.ssrLoadModule("/src/WatchWallet.tsx");
  const { MarketData, PoolDonut } = await server.ssrLoadModule("/src/MarketData.tsx");
  const { defaults } = await server.ssrLoadModule("/src/store.ts");
  const { dictionaries } = await server.ssrLoadModule("/src/i18n/index.ts");
  const { dual } = await server.ssrLoadModule("/src/currency.ts");
  const now = 1791648000, addr = "prl1" + "a".repeat(38);
  const data = { ok: true, ts: now, source: "fixture", partial: false, stale: false, network: { source: "fixture", ts: now, difficulty: 12000000, difficulty7d: 10000000, difficulty3d: 11000000, difficulty24h: 11500000, hashrate: 12e18, prlPerTHDay: .02, reward: 2000, blockTime: 235 }, rows: [{ id: "a", name: "AlphaPool", hashrate: 9e18 }] };
  const price = { usd: .8, ts: now, source: "fixture", stale: false, change24h: 2 };
  const fx = { ok: true, base: "USD", ts: now, rates: { CNY: 7.2, TWD: 32, HKD: 7.8, RUB: 90, VND: 25000, IDR: 15000 } };
  await mkdir("out/parity-ssr", { recursive: true });
  let count = 0;
  for (const lang of Object.keys(dictionaries)) for (const scenario of ["missing", "live", "over-budget"]) {
    const state = { ...defaults(), lang, secondary: "__auto__", monitors: [{ id: "monitor", updated: 1, pool: "AlphaPool", addr, label: "Test", alert: false, after: 600 }], devices: [{ id: "manual", updated: 1, name: "Long device name for mobile rendering", gpu: "RTX 4090", count: 2, rented: false, hoursPerDay: 12 }, { id: "rental", updated: 1, name: "Rental", gpu: "RTX 5080", count: 1, rented: true, rentDaily: 12, rentCurrency: "USD", hoursPerDay: 24 }], fleetSettings: { ...defaults().fleetSettings, powerBudgetW: scenario === "over-budget" ? 500 : 3000, powerBudgetEnabled: scenario === "over-budget" } };
    const t = (k) => { if (!dictionaries[lang][k]) throw new Error("missing translation " + lang + ":" + k); return dictionaries[lang][k]; };
    const money = (v) => dual(v, state.secondary, lang, fx);
    const body = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(FleetCalculator, { state, onState: () => {}, data: scenario === "missing" ? undefined : data, price: scenario === "missing" ? undefined : price, fx, incomes: scenario === "missing" ? {} : { [addr]: { ok: true, ts: now, h24: 3, d7: 21, total: 100 } }, t }),
      React.createElement(WatchWallet, { wallets: [{ id: "wallet", updated: 1, label: "Watch", addr }], price, refresh: 0, t, money, lang, onAdd: () => {}, onRename: () => {}, onRemove: () => {} }),
      React.createElement(MarketData, { price, overview: data, t, lang, money, refresh: 0 }),
      React.createElement(PoolDonut, { data, t, lang })
    ));
    if (/NaN|Infinity|undefined/.test(body)) throw new Error("invalid display " + lang + "/" + scenario);
    if (scenario === "over-budget" && !body.includes("over-budget")) throw new Error("missing power warning");
    if ((body.match(/aria-pressed=/g) || []).length !== 27) throw new Error("catalog count");
    await writeFile(`out/parity-ssr/${lang}-${scenario}.html`, `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../../src/style.css"><body>${body}</body></html>`);
    count++;
  }
  console.log(`SSR rendered ${count} multilingual scenarios; 27 GPU controls, missing data and power warnings checked. No browser or upstream requests.`);
} finally { await server.close(); }
