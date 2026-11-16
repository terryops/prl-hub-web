import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { LiveRegistration, type LiveRegistrationState } from "../src/android-live-registration.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(initial: LiveRegistrationState = { token: "", retiring: [] }) {
  let saved = structuredClone(initial);
  const calls: string[] = [], delays: number[] = [];
  const server = new Map<string, number>();
  if (initial.token) server.set(initial.token, 10);
  const ports = {
    token: async () => "device-token",
    hash: async (token: string) => `hash-${token}`,
    put: async (key: string, _token: string, at: number) => { calls.push(`PUT ${key}`); server.set(key, at); },
    remove: async (key: string) => { calls.push(`DELETE ${key}`); server.delete(key); },
    persist: (state: LiveRegistrationState) => { saved = structuredClone(state); },
    sleep: async (ms: number) => { delays.push(ms); },
  };
  const registration = new LiveRegistration(saved, ports);
  return { registration, ports, calls, delays, server, saved: () => saved };
}

test("stopping while the native token is pending cannot recreate the Worker registration", async () => {
  const f = fixture(), token = deferred<string>();
  f.ports.token = () => token.promise;
  const starting = f.registration.register(100);
  await f.registration.unregister();
  token.resolve("late-token");
  await starting;
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.saved(), { token: "", retiring: [] });
  assert.equal(f.registration.pending, false);
});

test("a newer token supersedes an older digest that finishes later", async () => {
  const f = fixture(), digest = deferred<string>();
  f.ports.hash = (token) => token === "old" ? digest.promise : Promise.resolve(`hash-${token}`);
  const old = f.registration.register(100, "old");
  await setImmediate();
  await f.registration.register(100, "new");
  digest.resolve("hash-old");
  await old;
  assert.deepEqual(f.calls, ["PUT hash-new"]);
  assert.equal(f.saved().token, "hash-new");
});

test("stop deletes after an already-started PUT, leaving no orphan subscription", async () => {
  const f = fixture(), accepted = deferred<void>();
  f.ports.put = async (key, _token, at) => {
    f.calls.push(`PUT ${key}`);
    await accepted.promise;
    f.server.set(key, at);
  };
  const starting = f.registration.register(100);
  await setImmediate();
  const stopping = f.registration.unregister();
  await setImmediate();
  assert.deepEqual(f.calls, ["PUT hash-device-token"]);
  accepted.resolve();
  await Promise.all([starting, stopping]);
  assert.deepEqual(f.calls, ["PUT hash-device-token", "DELETE hash-device-token"]);
  assert.equal(f.server.size, 0);
  assert.equal(f.registration.needsCleanup, false);
});

test("an old stop is serialized before a new ticker using the same FCM token", async () => {
  const f = fixture(), accepted = deferred<void>();
  f.ports.put = async (key, _token, at) => {
    f.calls.push(`PUT ${key} ${at}`);
    if (at === 100) await accepted.promise;
    f.server.set(key, at);
  };
  const old = f.registration.register(100);
  await setImmediate();
  const stop = f.registration.unregister();
  const next = f.registration.register(200);
  await setImmediate();
  accepted.resolve();
  await Promise.all([old, stop, next]);
  assert.deepEqual(f.calls, ["PUT hash-device-token 100", "DELETE hash-device-token", "PUT hash-device-token 200"]);
  assert.equal(f.server.get("hash-device-token"), 200);
});

test("a failed withdrawal is persisted and retried after a new page starts", async () => {
  const f = fixture({ token: "hash-old", retiring: [] });
  f.ports.remove = async () => { throw new Error("offline"); };
  await f.registration.unregister();
  assert.deepEqual(f.saved(), { token: "", retiring: ["hash-old"] });
  assert.equal(f.registration.needsCleanup, true);

  f.ports.remove = async (key) => { f.server.delete(key); };
  const restored = new LiveRegistration(f.saved(), f.ports);
  await restored.unregister();
  assert.equal(f.server.size, 0);
  assert.deepEqual(f.saved(), { token: "", retiring: [] });
});

test("rotation installs the new token even if old-token withdrawal fails, then retries cleanup", async () => {
  const f = fixture({ token: "hash-old", retiring: [] });
  let fail = true;
  f.ports.remove = async (key) => {
    f.calls.push(`DELETE ${key}`);
    if (fail) throw new Error("offline");
    f.server.delete(key);
  };
  await f.registration.register(100, "new");
  assert.equal(f.server.get("hash-new"), 100);
  assert.equal(f.registration.pending, true);
  fail = false;
  await f.registration.register(100, "new");
  assert.equal(f.server.has("hash-old"), false);
  assert.deepEqual(f.saved(), { token: "hash-new", retiring: [] });
  assert.equal(f.registration.pending, false);
});

test("registration performs the immediate attempt and all four backoff retries", async () => {
  const f = fixture();
  let attempts = 0;
  f.ports.put = async () => { attempts++; throw new Error("offline"); };
  await f.registration.register(100);
  assert.equal(attempts, 5);
  assert.deepEqual(f.delays, [5000, 10000, 20000, 40000]);
  assert.equal(f.registration.pending, true);
});

test("a token-rotation event supplies the new token without rereading a stale native result", async () => {
  const f = fixture();
  f.ports.token = async () => { throw new Error("native read should not run"); };
  await f.registration.register(100, "rotated");
  assert.deepEqual(f.calls, ["PUT hash-rotated"]);
  assert.equal(f.registration.pending, false);
});

test("a failed native token read can be recovered on the next registration request", async () => {
  const f = fixture();
  f.ports.token = async () => { throw new Error("native temporarily unavailable"); };
  await f.registration.register(100);
  assert.equal(f.registration.pending, true);
  f.ports.token = async () => "available";
  await f.registration.register(100);
  assert.deepEqual(f.calls, ["PUT hash-available"]);
  assert.equal(f.registration.pending, false);
});
