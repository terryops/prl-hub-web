import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeItems,
  mergeConfig,
  defaults,
  configOf,
  normalizeConfig,
  KEY,
  readStore,
  readGuest,
  readAccount,
  writeStore,
} from "../src/store.ts";
import { prl, hashrate, f2ref } from "../src/format.ts";
import { api, ApiError, syncConfig } from "../src/api.ts";
import { quoteExpired } from "../src/orders.ts";
const accountId = "u_test-account-1";
test("payment UI: quote expiry never offers another order after payment is seen", () => {
  assert.equal(quoteExpired({ status: "pending", expires_at: 1800 }, 1800000), true);
  for (const status of ["seen", "paid"] as const)
    assert.equal(quoteExpired({ status, expires_at: 1800 }, 3600000), false);
});
test("translations: sixteen dictionaries have exactly the same keys and nonempty text", () => {
  const languages = ["en", "ru", "zh-Hans", "zh-Hant", "vi", "id", "es", "pt-BR", "fr", "de", "it", "tr", "ja", "ko", "hi", "th"];
  const dictionaries = languages.map((l) =>
    JSON.parse(
      readFileSync(new URL(`../src/i18n/${l}.json`, import.meta.url), "utf8"),
    ),
  );
  for (const d of dictionaries) {
    assert.deepEqual(
      Object.keys(d).sort(),
      Object.keys(dictionaries[0]).sort(),
    );
    assert.ok(
      Object.values(d).every((v) => typeof v === "string" && v.length > 0),
    );
    for (const [key, text] of Object.entries(d) as [string, string][]) {
      assert.doesNotMatch(text, /^0{3,5}(?:\s|[。:.：])/, key);
      assert.deepEqual(text.match(/%@/g), dictionaries[0][key].match(/%@/g), key);
    }
  }
  for (let i of [0, 1, 4, 5])
    assert.ok(
      !/\b(miner|mining|rig)s?\b/i.test(
        // The native F2Pool permission name must match the upstream UI verbatim.
        Object.entries(dictionaries[i]).filter(([key]) => key !== "f2Step3").map(([, value]) => value).join(" "),
      ),
    );
});
test("navigation: all sixteen languages have seven nonempty short labels within the character budget", () => {
  const keys = ["navMarketShort", "navWorkersShort", "navPoolsShort", "navCalculatorShort", "navWalletShort", "navAlertsShort", "navAppShort"];
  for (const lang of ["en", "ru", "zh-Hans", "zh-Hant", "vi", "id", "es", "pt-BR", "fr", "de", "it", "tr", "ja", "ko", "hi", "th"]) {
    const dictionary = JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), "utf8"));
    const limit = lang.startsWith("zh") ? 4 : 8;
    for (const key of keys) {
      const label = dictionary[key], context = `${lang}:${key}`;
      assert.ok(Object.hasOwn(dictionary, key), context);
      assert.equal(typeof label, "string", context);
      assert.ok(label.trim().length > 0, context);
      assert.equal(label, label.trim(), context);
      assert.doesNotMatch(label, /[\r\n]/, context);
      assert.ok(Array.from(label.normalize("NFC")).length <= limit, `${context} exceeds ${limit} characters`);
    }
  }
});
test("merge: tombstones win ties, edits commute and deleted items stay deleted", () => {
  const a = { id: "one", updated: 1, label: "old" },
    b = { id: "one", updated: 2, label: "new" },
    c = { id: "one", updated: 2, label: "new", deleted: true };
  assert.deepEqual(mergeItems([a], [b]), [b]);
  assert.deepEqual(mergeItems([b], [c]), [c]);
  assert.deepEqual(mergeItems([c], [b]), [c]);
  assert.deepEqual(mergeItems([a, b], [c]), mergeItems([c], [a, b]));
  const base = configOf(defaults());
  const result = mergeConfig(
    { ...base, lang: "en", settingsUpdated: 2 },
    { ...base, lang: "ru", settingsUpdated: 3 },
  );
  assert.equal(result.lang, "ru");
});
test("format: exact bigint PRL, hash units and F2Pool pasted links", () => {
  assert.equal(prl("625381700"), "6.253817");
  assert.equal(prl("9007199254740993"), "90071992.54740993");
  assert.equal(prl("-1"), "−0.00000001");
  assert.equal(hashrate(270.123e12), "270.12 TH/s");
  assert.equal(hashrate(undefined), "—");
  assert.equal(hashrate(0), "0 H/s");
  assert.deepEqual(
    f2ref(
      "我的只读页 www.f2pool.com/mining-user/0123456789abcdef0123456789ABCDEF?user_name=My%20Rig 请查收",
    ),
    { addr: "0123456789abcdef0123456789abcdef", acct: "My Rig" },
  );
  assert.equal(
    f2ref("https://fakef2pool.com/mining-user/0123456789abcdef"),
    null,
  );
});
test("store: one versioned key, corrupt data recovery and synced input limits", () => {
  const memory = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => memory.get(k) || null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  } as Storage;
  const s = defaults();
  writeStore(s);
  assert.deepEqual([...memory.keys()], [KEY]);
  assert.deepEqual(readStore(), s);
  memory.set(KEY, "bad json");
  assert.deepEqual(readStore(), defaults());
  assert.throws(() =>
    normalizeConfig({
      ...configOf(s),
      wallets: [{ id: "x", updated: 1, label: "x", addr: "invalid" }],
    }),
  );
});
test("sync: revision conflict pulls, merges and retries account data", async () => {
  const original = globalThis.fetch;
  const state = { ...defaults(), accountId, sync: true, settingsUpdated: 1 };
  state.wallets = [{ id: "local", updated: 1, addr: "prl1" + "a".repeat(38), label: "Local" }];
  let revision = 0,
    puts = 0;
  const remote = {
    ...configOf(state),
    wallets: [],
    lang: "ru" as const,
    settingsUpdated: 2,
  };
  const data = remote;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "PUT") {
      puts++;
      if (puts === 1) {
        revision = 1;
        return Response.json({ error: "conflict" }, { status: 409 });
      }
      const body = JSON.parse(init.body as string);
      assert.equal(body.rev, revision);
      assert.deepEqual(body.data, { ...remote, wallets: state.wallets });
      return Response.json({ rev: revision + 1 });
    }
    return Response.json({ schema_version: 1, rev: revision, data });
  };
  try {
    const result = await syncConfig(state, () => state);
    assert.equal(result.lang, "ru");
    assert.equal(puts, 2);
  } finally {
    globalThis.fetch = original;
  }
});
test("store: malformed config fields and overflowing tombstones preserve credentials and healthy sections", () => {
  const s = { ...defaults(), accountId, token: "paid-device", sync: true, lang: "ru" as const, followBrowserLanguage: false,
    wallets: [{ id: "one", updated: 1, addr: "prl1" + "a".repeat(38), label: "Saved" }] };
  const memory = new Map<string, string>();
  globalThis.localStorage = { getItem: (k: string) => memory.get(k) || null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => memory.delete(k) } as Storage;
  for (const bad of [
    { calculator: { ...s.calculator, fee: -1 } },
    { calculator: { ...s.calculator, fee: 101 } },
    { monitors: Array.from({ length: 501 }, (_, i) => ({ id: `dead-${i}`, updated: i, deleted: true })) },
    { window: { start: -1, end: 100, tz: "UTC" } },
  ]) {
    memory.set(`${KEY}.active`, accountId);
    memory.set(`${KEY}.account.${accountId}`, JSON.stringify({ ...s, ...bad }));
    const recovered = readStore();
    assert.equal(recovered.accountId, accountId); assert.equal(recovered.token, s.token);
    assert.equal(recovered.lang, s.lang); assert.deepEqual(recovered.wallets, s.wallets);
    if ("monitors" in bad) assert.equal(recovered.monitors.length, 501);
    writeStore(recovered);
    assert.equal(readStore().accountId, accountId);
  }
});
test("sync: equal account configuration performs GET only, independent of item/key order", async () => {
  const original = globalThis.fetch;
  const state = { ...defaults(), accountId, sync: true };
  state.wallets = ["b", "a"].map((id) => ({ id, updated: 1, addr: "prl1" + "a".repeat(38), label: id }));
  const remote = { ...configOf(state), wallets: [...state.wallets].reverse().map((w) => ({ label: w.label, addr: w.addr, updated: w.updated, id: w.id })) };
  const data = remote;
  let gets = 0, puts = 0;
  globalThis.fetch = async (_url, init) => { if (init?.method === "PUT") puts++; else gets++; return Response.json({ schema_version: 1, rev: 5, data }); };
  try {
    await syncConfig(state, () => state); await syncConfig(state, () => state);
    assert.equal(gets, 2); assert.equal(puts, 0);
  } finally { globalThis.fetch = original; }
});

test("merge: identical setting timestamps converge across devices", () => {
  const base = configOf(defaults()),
    a = { ...base, lang: "en" as const },
    b = { ...base, lang: "ru" as const };
  assert.deepEqual(mergeConfig(a, b), mergeConfig(b, a));
});

test("account caches isolate two users and preserve guest preferences without old sync secrets", () => {
  const memory = new Map<string, string>();
  globalThis.localStorage = { getItem: (k: string) => memory.get(k) || null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => memory.delete(k) } as Storage;
  const guest = { ...defaults(), lang: "en" as const, followBrowserLanguage: false, secret: "obsolete-sync-code" };
  const a = { ...defaults(), accountId: "u_A", lang: "zh-Hans" as const, followBrowserLanguage: false, sync: true };
  const b = { ...defaults(), accountId: "u_B", lang: "ru" as const, followBrowserLanguage: false, sync: true };
  writeStore(guest); writeStore(a); writeStore(b);
  assert.equal(readStore().accountId, "u_B");
  assert.equal(readAccount("u_A")?.lang, "zh-Hans"); assert.equal(readAccount("u_B")?.lang, "ru");
  assert.equal(readGuest().lang, "en"); assert.equal(readGuest().accountId, "");
  assert.equal(JSON.parse(memory.get(KEY)!).secret, undefined);
  writeStore(readGuest()); assert.equal(memory.has(`${KEY}.active`), false);
  assert.equal(readStore().accountId, ""); assert.equal(readAccount("u_A")?.sync, true);
});
test("uploads use nested allowlists even when local or remote data contains wallet credentials", () => {
  const s = defaults(), privateData = { mnemonic: "private", privateKey: "private", apiKey: "private", password: "private" };
  Object.assign(s, privateData);
  s.contacts = [{ id: "c", updated: 1, name: "Public", address: "prl1" + "a".repeat(38), note: "", ...privateData }];
  s.wallets = [{ id: "w", updated: 1, label: "Watch", addr: "prl1" + "a".repeat(38), ...privateData }];
  Object.assign(s.calculator, privateData); Object.assign(s.fleetSettings, privateData);
  s.fleetSettings.rents = { RTX4090: { daily: 1, currency: "USD", fx: 1, ...privateData } };
  const clean = JSON.stringify(configOf(s));
  assert.doesNotMatch(clean, /mnemonic|privateKey|apiKey|password|private/);
  assert.equal(configOf(s).contacts?.[0].name, "Public");
});
test("sync aborts after an account change during either download or upload", async () => {
  const original = fetch;
  try {
    for (const stage of ["GET", "PUT"]) {
      const state = { ...defaults(), accountId, sync: true }; let current = state, puts = 0;
      globalThis.fetch = async (_url, init) => {
        assert.equal((init!.headers as Record<string, string>)["X-Account-ID"], accountId);
        if (init!.method === "PUT") puts++;
        if (init!.method === stage) current = { ...defaults(), accountId: "u_other" };
        return Response.json(init!.method === "GET" ? { schema_version: 1, rev: 0, data: null } : { rev: 1 });
      };
      await assert.rejects(syncConfig(state, () => current), /identity_changed/);
      assert.equal(puts, stage === "GET" ? 0 : 1);
    }
  } finally { globalThis.fetch = original; }
});

test("api: an error reply that is not JSON keeps its status; a broken success reply still throws", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>Too many requests</html>", { status: 429 });
    await assert.rejects(api("/v1/tx", "POST", { txid: "0".repeat(64) }), (e) => e instanceof ApiError && e.status === 429 && e.message === "upstream");
    globalThis.fetch = async () => Response.json({ ok: false, error: "busy", retry_after: 30 }, { status: 429 });
    await assert.rejects(api("/v1/tx", "POST", {}), (e) => e instanceof ApiError && e.status === 429 && e.message === "busy" && e.data.retry_after === 30);
    globalThis.fetch = async () => new Response("<html>", { status: 200 });
    await assert.rejects(api("/v1/pools"), (e) => !(e instanceof ApiError));
  } finally { globalThis.fetch = original; }
});
