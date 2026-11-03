import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import { PushSettings, pushTargetKey } from "../src/push-settings.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Execute the production App registration block with native/API ports; no account or network.
function appRegistration() {
  const source = readFileSync(process.env.PUSH_SETTINGS_SOURCE || new URL("../src/main.tsx", import.meta.url), "utf8");
  const start = source.includes("  type PushTarget =") ? source.indexOf("  type PushTarget =") : source.indexOf("  const sendSettings =");
  const block = source.slice(start, source.indexOf("  const pushValues =", start));
  const token = deferred<string>();
  type Monitor = { id: string; label: string; alert: boolean; updated: number; deleted?: boolean };
  const stateRef = { current: { accountId: "A", purchaseId: "", token: "registered", lang: "en", rules: [], monitors: [] as Monitor[] } };
  const pushGeneration = { current: 0 }, accountGeneration = { current: 0 };
  const puts: unknown[] = [], statuses: string[] = [], deletes: string[] = [];
  let transportDeletes = 0;
  let running: Promise<unknown> = Promise.resolve();
  const context = vm.createContext({
    PushSettings, pushTargetKey: async () => "registered", stateRef, pushGeneration, accountGeneration, pushSettings: { current: null }, pushQueue: { current: Promise.resolve() },
    ANDROID: true, notificationStatus: async () => "granted", pushTimeout: <T>(p: Promise<T>) => p,
    pushToken: () => token.promise, setPermission() {}, buyerId: (s: { accountId: string; purchaseId: string }) => s.accountId || s.purchaseId,
    api: async (path: string, method: string, body: unknown) => { if (method === "PUT") puts.push(body); else if (method === "DELETE") deletes.push(path); return { token: "registered", rules: [] }; },
    setPushState: (s: string) => statuses.push(s), update: (fn: (s: typeof stateRef.current) => typeof stateRef.current) => { stateRef.current = fn(stateRef.current); },
    alive: (a: unknown[]) => a, alertMonitors: () => [], reconcileRule: (r: unknown) => r,
    rememberPurchaseToken() {}, deletePushToken: async () => { transportDeletes++; },
    writeStore() {},
    run: (work: () => Promise<unknown>) => { running = work(); return running; }, setMessage() {}, t: (key: string) => key,
    me: { pro: true }, hasPush: () => true, pushReady: true, requestNotifications: async () => "granted",
    ensureBuyer: async () => stateRef.current.accountId, pendingMonitor: "rig", fresh: () => Date.now(), setPendingMonitor() {}, setPage() {},
  });
  vm.runInContext(ts.transpile(`${block}\nglobalThis.sendSettings = sendSettings;`, { target: ts.ScriptTarget.ES2022 }), context);
  const disableStart = source.indexOf("  const disablePush =");
  const disable = source.slice(disableStart, source.indexOf("  const remove =", disableStart));
  vm.runInContext(ts.transpile(`${disable}\nglobalThis.disablePush = disablePush;`, { target: ts.ScriptTarget.ES2022 }), context);
  const enableStart = source.indexOf("  const enablePush =");
  vm.runInContext(ts.transpile(`${source.slice(enableStart, disableStart)}\nglobalThis.enablePush = enablePush;`, { target: ts.ScriptTarget.ES2022 }), context);
  const send = () => (context.sendSettings as (s: typeof stateRef.current) => Promise<unknown>)({ ...stateRef.current });
  const withdraw = () => {
    (context.disablePush as () => void)();
    return running;
  };
  const enable = () => { (context.enablePush as () => void)(); return running; };
  return { token, stateRef, pushGeneration, accountGeneration, puts, statuses, deletes, send, withdraw, enable, transportDeletes: () => transportDeletes };
}

test("actual App registration cannot PUT after disabling while the FCM token is pending", async () => {
  const f = appRegistration();
  const pending = f.send();
  await new Promise((r) => setImmediate(r));
  f.pushGeneration.current++;
  f.stateRef.current = { ...f.stateRef.current, token: "" };
  f.token.resolve("late-token");
  await pending;
  assert.equal(f.puts.length, 0);
  assert.equal(f.stateRef.current.token, "");
});

test("actual App registration ignores an old account response even after switching A to B to A", async () => {
  const f = appRegistration();
  const pending = f.send();
  await new Promise((r) => setImmediate(r));
  f.accountGeneration.current += 2;
  f.token.resolve("old-account-token");
  await pending;
  assert.equal(f.puts.length, 0);
  assert.equal(f.statuses.includes("saved"), false);
});

test("a failed old native token lookup cannot clear a new account's device token", async () => {
  const f = appRegistration();
  const pending = f.send();
  await new Promise((r) => setImmediate(r));
  f.accountGeneration.current++;
  f.stateRef.current = { ...f.stateRef.current, accountId: "B", token: "new-account-registration" };
  f.token.resolve("");
  await pending;
  assert.equal(f.stateRef.current.token, "new-account-registration");
  assert.equal(f.statuses.includes("error"), false);
});

test("actual App withdrawal deletes ordinary alert settings while preserving shared live-ticker FCM transport", async () => {
  const f = appRegistration();
  await f.withdraw();
  assert.deepEqual(f.deletes, ["/v1/devices/registered"]);
  assert.equal(f.stateRef.current.token, "");
  assert.equal(f.transportDeletes(), 0);
});

test("a temporary token lookup failure retains the known Worker registration for retry or withdrawal", async () => {
  const f = appRegistration();
  const pending = f.send();
  f.token.resolve("");
  await assert.rejects(pending, /pushConnectError/);
  assert.equal(f.stateRef.current.token, "registered");
  assert.equal(f.statuses.at(-1), "error");
});

test("finishing push setup preserves monitor edits and additions made while native registration waited", async () => {
  const f = appRegistration();
  const rig = { id: "rig", label: "Original", alert: false, updated: 1 };
  f.stateRef.current.monitors = [rig];
  const pending = f.enable();
  await new Promise((r) => setImmediate(r));
  f.stateRef.current = { ...f.stateRef.current, monitors: [{ ...rig, label: "Edited", updated: 2 }, { ...rig, id: "new", label: "New monitor" }] };
  f.token.resolve("device-token");
  await pending;
  assert.deepEqual(f.stateRef.current.monitors.map((m) => m.label), ["Edited", "New monitor"]);
  assert.equal(f.stateRef.current.monitors[0].alert, true);
});

test("withdrawal waits for accepted PUT before DELETE and skips a queued stale update", async () => {
  type S = { accountId: string; purchaseId: string; token: string };
  const state: S = { accountId: "A", purchaseId: "", token: "key" };
  const context = { state, account: 0, generation: 0 };
  const accepted = deferred<void>(), calls: string[] = [], server = new Set<string>();
  const queue = new PushSettings<S, string, string>({
    current: () => context, saving() {},
    key: async () => "key", attempted() {},
    put: async () => { calls.push("PUT"); await accepted.promise; server.add("key"); return "key"; },
    saved() {}, failed() {}, remove: async () => { calls.push("DELETE"); server.delete("key"); },
    removed: async () => { context.state = { ...state, token: "" }; },
  });
  const putting = queue.register(state, async () => "native");
  await new Promise((r) => setImmediate(r));
  context.generation++;
  const deleting = queue.withdraw(state);
  const stale = queue.register(state, async () => "native");
  accepted.resolve();
  await Promise.all([putting, deleting, stale]);
  assert.deepEqual(calls, ["PUT", "DELETE"]);
  assert.equal(server.size, 0);
});

test("failed withdrawal leaves the registration available for retry", async () => {
  const state = { accountId: "A", purchaseId: "", token: "key" };
  let fail = true;
  const queue = new PushSettings<typeof state, string, string>({
    current: () => ({ state, account: 0, generation: 0 }), saving() {},
    key: async () => "key", attempted() {},
    put: async () => "key", saved() {}, failed() {},
    remove: async () => { if (fail) throw new Error("offline"); },
    removed: async () => { state.token = ""; },
  });
  await assert.rejects(queue.withdraw(state), /offline/);
  assert.equal(state.token, "key");
  fail = false;
  assert.equal(await queue.withdraw(state), true);
  assert.equal(state.token, "");
});

test("a rotated key is remembered before PUT, so withdrawal removes an accepted write with a lost response", async () => {
  const initial = { accountId: "A", purchaseId: "", token: "old-key" };
  const context = { state: initial, account: 0, generation: 0 };
  const accepted = deferred<void>(), server = new Set<string>(), remembered: string[] = [];
  const queue = new PushSettings<typeof initial, string, string>({
    current: () => context, saving() {}, key: async () => "rotated-key",
    attempted: (_s, token) => { remembered.push(token); context.state = { ...context.state, token }; },
    put: async () => { server.add("rotated-key"); await accepted.promise; throw new Error("response lost"); },
    saved() {}, failed() {}, remove: async (s) => { server.delete(s.token); }, removed: async () => {},
  });
  const putting = queue.register(initial, async () => "rotated-device-token");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(remembered, ["rotated-key"]);
  context.generation++;
  const stopping = queue.withdraw(context.state);
  accepted.resolve();
  await Promise.all([putting, stopping]);
  assert.equal(server.size, 0);
});

test("device keys match the Worker's FCM and Web Push hashing contract", async () => {
  for (const [target, value] of [
    [{ fcm: { token: "device-token" } }, "fcm:device-token"],
    [{ subscription: { endpoint: "https://push.example.test/subscription" } }, "https://push.example.test/subscription"],
  ] as const) assert.equal(await pushTargetKey(target), createHash("sha256").update(value).digest("hex"));
});
