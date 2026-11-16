import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFX, saveFX, FX_MAX_AGE } from "../src/currency.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test("FX is asked at most once a day", () => assert.equal(FX_MAX_AGE, 24 * 3600 * 1000));

test("the last table and when it was fetched survive a restart, without the stale mark", () => {
  const store = memory();
  saveFX({ ok: true, ts: 1793175369, base: "USD", rates: { CNY: 6.68 }, stale: true }, 1234, store);
  const back = loadFX(store);
  assert.equal(back?.at, 1234);
  assert.equal(back?.fx.rates.CNY, 6.68);
  assert.equal(back?.fx.stale, undefined);
});

test("missing or broken caches read as none", () => {
  assert.equal(loadFX(memory()), undefined);
  const store = memory();
  store.setItem("pearlhub.fx", "{not json");
  assert.equal(loadFX(store), undefined);
  store.setItem("pearlhub.fx", JSON.stringify({ at: 1, fx: { ts: 1 } }));
  assert.equal(loadFX(store), undefined);
  assert.equal(loadFX(undefined), undefined);
});
