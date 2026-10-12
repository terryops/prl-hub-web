import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribePush, pushTimeout } from "../src/push.ts";
import { encode64 } from "../src/encoding.ts";

test("push: reuse a subscription only when its application key matches", async () => {
  const key = new Uint8Array(65).fill(1);
  let removed = 0, created = 0;
  const old = { options: { applicationServerKey: key.buffer }, unsubscribe: async () => { removed++; return true; } };
  const current = {};
  const reg = { pushManager: {
    getSubscription: async () => old,
    subscribe: async (options: { applicationServerKey: Uint8Array }) => {
      assert.deepEqual(options.applicationServerKey, new Uint8Array(65).fill(2));
      created++; return current;
    },
  } } as unknown as ServiceWorkerRegistration;
  assert.equal(await subscribePush(reg, encode64(key)), old);
  assert.equal(created, 0);
  assert.equal(await subscribePush(reg, encode64(new Uint8Array(65).fill(2))), current);
  assert.equal(removed, 1);
  assert.equal(created, 1);
});

test("push: unreachable registration times out and a later retry can succeed", async () => {
  await assert.rejects(pushTimeout(new Promise(() => {}), 5), /pushTimeout/);
  assert.equal(await pushTimeout(Promise.resolve("connected"), 100), "connected");
  await assert.rejects(pushTimeout(Promise.reject(new Error("denied"))), /denied/);
});
