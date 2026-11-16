import { useEffect, useRef, useState } from "react";
import { nativeCall, BridgeError } from "./android-bridge.ts";
import { onNative } from "./android.ts";
import { api, ApiError } from "./api.ts";
import type { Me } from "./types.ts";

// Pro in the Play build: Google Play Billing, as the iOS app buys through StoreKit (ProStore.swift).
// The shell runs Play's sheets (prl-hub-android Billing.kt, BRIDGE.md `billing.*`). Each purchase
// token goes to POST /v1/purchase/google, where the server checks it with Google, acknowledges it,
// and grants Pro:
//   - signed in: to the account;
//   - otherwise: to this device's purchase credential, which signing in later moves to the account.
// That is the same device / account Pro the website APK's PRL checkout gives.

export const PLAY_PRODUCT = "com.prl.wizard.pro";
export type PlayPurchase = { productId: string; purchaseToken: string; orderId: string | null; state: "purchased" | "pending"; acknowledged: boolean };
export type PlayCopy = { unavailable: string; unverified: string; pending: string; nothingToRestore: string; linkedElsewhere: string };
export type PlayStore = { price: string | null; busy: boolean; message: string | null; buy: () => void; restore: () => void };
export type PlayOutcome = "pro" | "pending" | "linked" | "unverified" | "unavailable";

// Which outcome to report when a restore sent several purchases.
const RANK: PlayOutcome[] = ["unavailable", "unverified", "linked", "pending", "pro"];
export const bestOutcome = (outcomes: PlayOutcome[]): PlayOutcome =>
  outcomes.length ? outcomes.reduce((a, b) => RANK.indexOf(b) > RANK.indexOf(a) ? b : a) : "unverified";

/** One purchase → the server. `buyer` makes sure this device has a purchase credential (and links it to the account). */
export async function sendPlayPurchase(p: PlayPurchase, buyer: () => Promise<string>, loadMe: (id: string) => Promise<Me>, current = () => true): Promise<PlayOutcome> {
  if (!current()) return "unavailable";
  if (p.state !== "purchased") return "pending";
  let id: string;
  try { id = await buyer(); } catch { return "unavailable"; }
  if (!current()) return "unavailable";
  try {
    const r = await api<Partial<Me> & { pending?: boolean }>("/v1/purchase/google", "POST", { product_id: p.productId || PLAY_PRODUCT, purchase_token: p.purchaseToken }, id);
    if (!current()) return "unavailable";
    if (r.pending) return "pending";
    const me = await loadMe(id).catch(() => null);
    if (!current() || !me) return "unavailable";
    return me.pro ? "pro" : "unverified";
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return "linked";
    if (e instanceof ApiError && e.status === 400) return "unverified";
    return "unavailable";
  }
}

export function usePlayStore({ on, identity, pro, buyer, loadMe, copy }: {
  // The Play build, its shell has Play Billing, and the server can verify purchases.
  on: boolean;
  // The account session; creating a credential for the same guest must keep this key stable.
  identity: string;
  // false once this device is known not to be Pro; undefined while that is still loading.
  pro: boolean | undefined;
  buyer: () => Promise<string>;
  loadMe: (id: string) => Promise<Me>;
  copy: PlayCopy;
}): PlayStore | null {
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const latest = useRef({ on, pro, buyer, loadMe, copy });
  latest.current = { on, pro, buyer, loadMe, copy };
  const context = useRef({ on, identity, generation: 0 });
  if (context.current.on !== on || context.current.identity !== identity) {
    context.current = { on, identity, generation: context.current.generation + 1 };
  }
  const mounted = useRef(true);
  const capture = () => {
    const generation = context.current.generation;
    const { buyer, loadMe } = latest.current;
    const current = () => mounted.current && context.current.on && context.current.generation === generation;
    return { generation, current, send: (p: PlayPurchase) => sendPlayPurchase(p, buyer, loadMe, current) };
  };
  type Operation = ReturnType<typeof capture>;
  const say = (o: PlayOutcome, operation: Operation) => {
    if (!operation.current()) return;
    const c = latest.current.copy;
    setMessage(o === "pro" ? null : o === "pending" ? c.pending : o === "linked" ? c.linkedElsewhere : o === "unverified" ? c.unverified : c.unavailable);
  };
  const working = useRef<{ generation: number } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; context.current.generation++; };
  }, []);
  useEffect(() => {
    setBusy(false);
    setMessage(null);
  }, [on, identity]);

  useEffect(() => {
    if (!on) return;
    const operation = capture();
    void nativeCall<{ price: string }>("billing.product").then((r) => { if (operation.current()) setPrice(r.price || null); }, () => {});
  }, [on, identity]);

  // At launch, like StoreKit's current entitlements on iOS: Pro this Google account already owns
  // unlocks without a tap (a reinstall, a second phone, a payment approved while the app was closed).
  const synced = useRef<number | null>(null);
  const syncing = useRef<number | null>(null);
  const syncOwned = async () => {
    const operation = capture(), generation = operation.generation;
    if (!operation.current() || latest.current.pro !== false || synced.current === generation || syncing.current === generation) return;
    syncing.current = generation;
    try {
      const { purchases } = await nativeCall<{ purchases: PlayPurchase[] }>("billing.owned");
      if (!operation.current()) return;
      let retry = false;
      for (const p of purchases.filter((x) => x.state === "purchased")) {
        const outcome = await operation.send(p);
        if (!operation.current()) return;
        if (outcome === "pro") { retry = false; break; }
        if (outcome === "unavailable") retry = true;
      }
      if (!retry) synced.current = generation;
    } catch { /* A later resume or capability check retries an unavailable restore. */ }
    finally { if (syncing.current === generation) syncing.current = null; }
  };
  useEffect(() => {
    void syncOwned();
  }, [on, identity, pro]);
  useEffect(() => on ? onNative("resume", () => { void syncOwned(); }) : undefined, [on, identity]);
  // A purchase that finished while no sheet was waiting (a pending payment approved).
  useEffect(() => on ? onNative("billing", (data) => {
    const operation = capture();
    const list = (Array.isArray(data.purchases) ? data.purchases : []) as PlayPurchase[];
    void (async () => {
      for (const p of list.filter((x) => x.state === "purchased")) {
        const outcome = await operation.send(p);
        if (!operation.current()) return;
        if (outcome !== "unavailable") say(outcome, operation);
        if (outcome === "pro") break;
      }
    })();
  }) : undefined, [on, identity]);

  if (!on) return null;
  const run = async (work: (operation: Operation) => Promise<void>) => {
    const operation = capture();
    if (!operation.current() || working.current?.generation === operation.generation) return;
    const active = { generation: operation.generation };
    working.current = active;
    setBusy(true);
    setMessage(null);
    try { await work(operation); }
    finally {
      if (working.current === active) {
        working.current = null;
        if (operation.current()) setBusy(false);
      }
    }
  };
  return {
    price, busy, message,
    buy: () => void run(async (operation) => {
      let p: PlayPurchase;
      try { p = await nativeCall<PlayPurchase>("billing.purchase", {}, 0); }
      catch (e) {
        // Closing Play's sheet is not an error (iOS shows nothing for userCancelled).
        if (!(e instanceof BridgeError && e.code === "cancelled")) say("unavailable", operation);
        return;
      }
      if (operation.current()) say(await operation.send(p), operation);
    }),
    restore: () => void run(async (operation) => {
      let purchases: PlayPurchase[];
      try { ({ purchases } = await nativeCall<{ purchases: PlayPurchase[] }>("billing.owned")); }
      catch { say("unavailable", operation); return; }
      if (!operation.current()) return;
      if (!purchases.length) { setMessage(latest.current.copy.nothingToRestore); return; }
      const outcomes: PlayOutcome[] = [];
      for (const p of purchases) {
        const outcome = await operation.send(p);
        if (!operation.current()) return;
        outcomes.push(outcome);
        if (outcome === "pro") break;
      }
      say(bestOutcome(outcomes), operation);
    }),
  };
}
