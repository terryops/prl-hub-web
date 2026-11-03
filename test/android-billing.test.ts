// The Play build's purchase hand-off (android-billing.ts): a Play purchase → POST /v1/purchase/google → Pro.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendPlayPurchase, bestOutcome, PLAY_PRODUCT, type PlayPurchase } from "../src/android-billing.ts";
import type { Me } from "../src/types.ts";

const fetchBefore = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchBefore; });
const purchase = (extra: Partial<PlayPurchase> = {}): PlayPurchase =>
  ({ productId: PLAY_PRODUCT, purchaseToken: "tok-" + "x".repeat(40), orderId: "GPA.1", state: "purchased", acknowledged: false, ...extra });
const me = (pro: boolean) => ({ pro, pro_scope: "device" } as unknown as Me);

function server(reply: (body: Record<string, unknown>) => Response) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    calls.push({ url: String(url), init, body });
    return reply(body);
  };
  return calls;
}

test("a purchase goes to the server with the buyer id, and Pro comes from /v1/me", async () => {
  const calls = server(() => Response.json({ pro: true, pro_scope: "device" }));
  let loaded = "";
  const out = await sendPlayPurchase(purchase(), async () => "g_buyer", async (id) => { loaded = id; return me(true); });
  assert.equal(out, "pro");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v1/purchase/google");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, { product_id: PLAY_PRODUCT, purchase_token: "tok-" + "x".repeat(40) });
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Account-ID"], "g_buyer");
  assert.equal(loaded, "g_buyer");
});

test("pending purchases never reach the server; 202, 409, 400 and outages map to their messages", async () => {
  let asked = 0;
  server(() => { asked++; return Response.json({}); });
  assert.equal(await sendPlayPurchase(purchase({ state: "pending" }), async () => "g", async () => me(false)), "pending");
  assert.equal(asked, 0);
  server(() => Response.json({ pending: true }, { status: 202 }));
  assert.equal(await sendPlayPurchase(purchase(), async () => "g", async () => me(false)), "pending");
  server(() => Response.json({ error: "purchase_already_linked" }, { status: 409 }));
  assert.equal(await sendPlayPurchase(purchase(), async () => "u", async () => me(false)), "linked");
  server(() => Response.json({ error: "bad_receipt" }, { status: 400 }));
  assert.equal(await sendPlayPurchase(purchase(), async () => "u", async () => me(false)), "unverified");
  server(() => Response.json({ error: "play_unavailable" }, { status: 503 }));
  assert.equal(await sendPlayPurchase(purchase(), async () => "u", async () => me(false)), "unavailable");
  server(() => new Response("<html>bad gateway</html>", { status: 502 }));
  assert.equal(await sendPlayPurchase(purchase(), async () => "u", async () => me(false)), "unavailable");
  // No purchase credential could be made (offline): nothing is sent.
  asked = 0;
  server(() => { asked++; return Response.json({}); });
  assert.equal(await sendPlayPurchase(purchase(), async () => { throw new Error("offline"); }, async () => me(false)), "unavailable");
  assert.equal(asked, 0);
});

test("a restore reports the best outcome among the purchases it sent", () => {
  assert.equal(bestOutcome(["unavailable", "pro"]), "pro");
  assert.equal(bestOutcome(["unverified", "pending"]), "pending");
  assert.equal(bestOutcome(["unavailable"]), "unavailable");
  assert.equal(bestOutcome(["unavailable", "linked"]), "linked");
  assert.equal(bestOutcome([]), "unverified");
});

test("a verified payment whose profile cannot be refreshed reports that recovery is still needed", async () => {
  server(() => Response.json({ pro: true, pro_scope: "device" }));
  assert.equal(await sendPlayPurchase(purchase(), async () => "g", async () => { throw new Error("offline"); }), "unavailable");
  assert.equal(await sendPlayPurchase(purchase(), async () => "g", async () => me(false)), "unverified");
});

test("an identity change during buyer setup cannot submit a purchase for the new context", async () => {
  const calls = server(() => Response.json({ pro: true }));
  let current = true;
  const result = await sendPlayPurchase(purchase(), async () => { current = false; return "account-a"; }, async () => me(true), () => current);
  assert.equal(result, "unavailable");
  assert.equal(calls.length, 0);
});

test("an identity change during verification cannot reload a stale account profile", async () => {
  let current = true, loaded = false;
  const calls = server(() => { current = false; return Response.json({ pro: true }); });
  const result = await sendPlayPurchase(purchase(), async () => "account-a", async () => { loaded = true; return me(true); }, () => current);
  assert.equal(result, "unavailable");
  assert.equal(calls.length, 1);
  assert.equal(loaded, false);
});
