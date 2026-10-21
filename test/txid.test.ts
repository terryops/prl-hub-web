import { test, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { parseTxid, txView, EXPLORER } from "../src/txid.ts";
import type { TxDetail } from "../src/types.ts";

const id = "943da615f933043e5381dc4f417bfc165eb8bbd509391faff7dc04b03ad2f38b";
const mine = "prl1" + "m".repeat(58), other = "prl1" + "o".repeat(58), pool = "prl1" + "p".repeat(58);

test("txid: a bare id in any case, or one inside an explorer link; anything else is rejected", () => {
  assert.equal(parseTxid(id), id);
  assert.equal(parseTxid(`  ${id.toUpperCase()}\n`), id);
  assert.equal(parseTxid(`${EXPLORER}/tx/${id}`), id);
  assert.equal(parseTxid(`https://blockbook.pearlresearch.ai/tx/${id}?page=2#vout`), id);
  for (const bad of ["", id.slice(1), id + "0", id.replace("9", "g"), `${EXPLORER}/tx/${id}0`, `${EXPLORER}/address/${mine}`, `${id} ${id}`])
    assert.equal(parseTxid(bad), null, bad);
});

const payout: TxDetail = {
  txid: id, confirmations: 10, height: 130522, blockHash: "25b3".padEnd(64, "0"), time: 1792462511, size: 43699, vsize: 43401,
  value: "1344493032231", fee: "43403", coinbase: false, inputCount: 2, outputCount: 4,
  inputs: [{ address: pool, value: "1000000000000" }, { address: pool, value: "344493075634" }],
  outputs: [{ address: other, value: "224837670" }, { address: mine, value: "250000000" }, { address: null, value: "0", data: true }, { address: pool, value: "1344018194561" }],
};

test("txid view: the user's own rows come first, with the net across them", () => {
  const known = new Map([[mine, "Rig"]]);
  const view = txView(payout, known);
  assert.deepEqual(view.outputs.map((r) => r.address), [mine, other, null, pool]);
  assert.equal(view.net, "250000000");
  // Spending from a known address nets out against its change.
  assert.equal(txView(payout, new Map([[pool, "Pool"]])).net, String(1344018194561n - 1344493075634n));
  assert.equal(txView(payout, new Map()).net, null);
  assert.deepEqual(txView(payout, new Map()).outputs, payout.outputs);
});

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
after(() => server.close());
const { TxResult, TxLookup } = await server.ssrLoadModule("/src/TxLookup.tsx");
const { dictionaries } = await server.ssrLoadModule("/src/i18n/index.ts");
const { WatchWallet } = await server.ssrLoadModule("/src/WatchWallet.tsx");

test("txid result: every language renders status, facts, own rows and the explorer link", () => {
  for (const lang of Object.keys(dictionaries)) {
    const t = (k: string) => { assert.ok(dictionaries[lang][k], `${lang}: ${k}`); return dictionaries[lang][k]; };
    const html = renderToStaticMarkup(React.createElement(TxResult, { tx: payout, known: new Map([[mine, "Rig"]]), onCopy: () => {}, t, lang }));
    assert.ok(html.includes(`href="${EXPLORER}/tx/${id}"`), lang);
    assert.ok(html.includes(t("txConfirmed")) && html.includes(t("txNet")) && html.includes("OP_RETURN"), lang);
    // The user's output is the first row, labeled, and the net is signed.
    assert.match(html, /<li class="mine"><span class="tx-row-address"><code class="watch-address" title="prl1m+">.*?<span class="badge">Rig<\/span>/, lang);
    assert.ok(html.includes(`+${(2.5).toLocaleString(lang)} <span class="prl-unit">PRL</span>`), lang);
    assert.ok(!html.includes("tx-truncated"), lang);
  }
});

test("txid result: pending, coinbase, long payouts and truncated lists", () => {
  const t = (k: string) => dictionaries.en[k];
  const pending = renderToStaticMarkup(React.createElement(TxResult, { tx: { ...payout, confirmations: 0, height: null, blockHash: null }, known: new Map(), t, lang: "en" }));
  assert.match(pending, /class="status warn" role="status">.*Unconfirmed/); assert.ok(pending.includes("<dd>—</dd>")); assert.ok(!pending.includes("tx-net"));
  const coinbase = renderToStaticMarkup(React.createElement(TxResult, { tx: { ...payout, coinbase: true, inputCount: 0, inputs: [], fee: "0" }, known: new Map(), t, lang: "en" }));
  assert.ok(coinbase.includes(t("txCoinbase")));
  const outputs = Array.from({ length: 2000 }, (_, n) => ({ address: n === 1500 ? mine : other, value: "1" }));
  const big = renderToStaticMarkup(React.createElement(TxResult, { tx: { ...payout, outputCount: 2400, outputs }, known: new Map([[mine, "Rig"]]), t, lang: "en" }));
  // Ten rows until "Show all", the user's own (deep in the list) first, and a note that the list is cut.
  assert.equal((big.match(/<li/g) || []).length, 2 + 10); assert.match(big, /<ul class="tx-rows"><li class="mine">/);
  assert.ok(big.includes("Show all (2,000)")); assert.ok(big.includes("Only the first 2,000 are listed."));
});

test("txid lookup: the dialog opens on just the form", () => {
  const html = renderToStaticMarkup(React.createElement(TxLookup, { known: new Map(), refresh: 0, t: (k: string) => dictionaries["zh-Hans"][k], lang: "zh-Hans" }));
  assert.match(html, /^<div class="tx-lookup"><form class="tx-lookup-form">/); assert.ok(html.includes('placeholder="交易 ID（txid）或区块浏览器链接"'));
  assert.ok(!html.includes("tx-result") && !html.includes("status warn") && !html.includes("<h2"));
});

test("txid lookup: the wallet's actions and its empty state open it", () => {
  for (const lang of Object.keys(dictionaries)) {
    const t = (k: string) => dictionaries[lang][k], props = { lang, refresh: 0, t, onAdd: () => {}, onRename: () => {}, onRemove: () => {}, onSend: () => {}, onLookup: () => {} };
    const html = renderToStaticMarkup(React.createElement(WatchWallet, { ...props, wallets: [{ id: "w", label: "Watch", addr: mine }] }));
    const start = html.indexOf('<div class="wallet-actions" data-count="4">'), actions = html.slice(start, html.indexOf("</div>", start));
    assert.ok(start > 0, lang);
    assert.equal((actions.match(/<button/g) || []).length, 3, lang);
    assert.ok(actions.endsWith(`<span>${t("txLookupShort")}</span></button>`), lang);
    const empty = renderToStaticMarkup(React.createElement(WatchWallet, { ...props, wallets: [] }));
    assert.ok(empty.includes(`${t("txLookup")}</button></section>`), lang);
    // Without the handler (as before) there is no entry.
    assert.ok(!renderToStaticMarkup(React.createElement(WatchWallet, { ...props, onLookup: undefined, wallets: [] })).includes(t("txLookup")), lang);
  }
});
