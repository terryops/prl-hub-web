import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { nativeCall, BridgeError } from "./android-bridge.ts";
import { ANDROID, onNative, pushToken, type AndroidCopy } from "./android.ts";
import type { Price } from "./types.ts";
import { LiveRegistration, type LiveRegistrationState } from "./android-live-registration.ts";

// 锁屏盯盘 (Pro), the iOS Live Activity's Android counterpart (prl-hub Sources/App/PriceLiveActivity.swift;
// BRIDGE.md "Live ticker" in prl-hub-android). The shell draws an ongoing notification with the price and
// its 1-hour and 24-hour change. This module starts and stops it, feeds it every new app-wide price while
// the page runs, and registers the phone with the alert Worker the way iOS registers the activity's push
// token (PUT /v1/live/:token), so the Worker's once-a-minute price keeps it current while the app is closed.
// The token is the one the Worker files the phone's FCM registration under: hex SHA-256 of "fcm:" + token.
// Like iOS it lasts at most 8 hours, and it stops when Pro lapses or the person dismisses it.

export type LiveStyle = "full" | "lock" | "island";
type NativeStatus = { running: boolean; style: LiveStyle; startedAt: number | null; canShow: boolean };
type Quote = { usd: number; change1h: number | null; change24h: number | null; at: number };

const REGISTERED = "pearlhub.live.registered";
const REGISTRATION = "pearlhub.live.registration";
function savedRegistration(): LiveRegistrationState {
  try {
    const stored = JSON.parse(localStorage.getItem(REGISTRATION) || "null") as Partial<LiveRegistrationState> | null;
    const valid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    return {
      token: valid(stored?.token) ? stored.token : localStorage.getItem(REGISTERED) || "",
      retiring: Array.isArray(stored?.retiring) ? stored.retiring.filter(valid) : [],
    };
  } catch { return { token: "", retiring: [] }; }
}
function saveRegistration(state: LiveRegistrationState) {
  try {
    if (state.token || state.retiring.length) localStorage.setItem(REGISTRATION, JSON.stringify(state));
    else localStorage.removeItem(REGISTRATION);
    localStorage.removeItem(REGISTERED);
  } catch { /* The in-memory state still serializes this run's requests. */ }
}

async function liveToken(reg: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fcm:${reg}`)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
const quoteOf = (p: Price): Quote => ({ usd: p.usd, change1h: p.change1h, change24h: p.change24h, at: p.ts });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type LiveTicker = {
  supported: boolean; running: boolean; style: LiveStyle; busy: boolean; error: string;
  toggle(on: boolean): Promise<void>; setStyle(style: LiveStyle): void;
};

export function useLiveTicker({ price, pro, buyer, pushReady, a }: {
  price: Price | undefined; pro: boolean | undefined; buyer: string; pushReady: boolean; a: AndroidCopy;
}): LiveTicker {
  // ANDROID is a build-time constant, so every render of a build takes the same path: the website
  // build keeps none of what follows.
  if (!ANDROID) return OFF;
  const [status, setStatus] = useState<NativeStatus | null>(null);
  // Which presentation carries the price — kept across tickers, as iOS keeps "live.style".
  const [style, setStyleState] = useState<LiveStyle>(savedLiveStyle);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const latest = useRef({ price, buyer, pushReady, a });
  latest.current = { price, buyer, pushReady, a };
  const operation = useRef(0);
  const registration = useRef<LiveRegistration | null>(null);
  if (!registration.current) registration.current = new LiveRegistration(savedRegistration(), {
    token: pushToken, hash: liveToken, persist: saveRegistration, sleep,
    put: async (key, token, startedAt) => {
      await api(`/v1/live/${key}`, "PUT", { topic: "android", env: "production", fcm: { token }, started_at: startedAt }, latest.current.buyer);
    },
    remove: async (key) => {
      try { await api(`/v1/live/${key}`, "DELETE", undefined, latest.current.buyer); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
    },
  });

  const refresh = useCallback(() => nativeCall<NativeStatus>("live.status").then((s) => { setStatus(s); return s; }, () => null), []);

  // Withdraw the registration of a ticker that is gone (stopped, dismissed, 8 hours up while closed).
  const unregister = useCallback(async () => {
    await registration.current!.unregister();
  }, []);

  // PUT with the iOS app's retries (5, 10, 20, 40 s); a newer start or a stop supersedes it.
  const register = useCallback(async (startedAt: number, token?: string) => {
    if (!latest.current.pushReady) return registration.current!.defer();
    await registration.current!.register(startedAt, token);
  }, []);

  const start = useCallback(async (style: LiveStyle) => {
    const run = ++operation.current;
    const { a } = latest.current;
    let p = latest.current.price;
    if (!p) p = await api<Price>("/v1/price").catch(() => undefined);
    if (run !== operation.current) return;
    if (!p) { setError(a.liveNoPrice); return; }
    try {
      await nativeCall<{ running: boolean; startedAt: number }>("live.start", {
        title: a.livePriceTitle, label1h: a.label1h, label24h: a.label24h, style, state: quoteOf(p),
      }, 0);
      if (run !== operation.current) return;
      const shown = await refresh();
      if (run !== operation.current) return;
      if (shown?.running && shown.startedAt) void register(shown.startedAt);
      else if (shown && !shown.running) await unregister();
      else registration.current!.defer();
    } catch (e) {
      if (run !== operation.current) return;
      setError(e instanceof BridgeError && e.code === "denied" ? a.notifyDenied : a.liveNoPrice);
    }
  }, [refresh, register, unregister]);

  const stop = useCallback(async () => {
    const run = ++operation.current;
    let stopped = false;
    try { await nativeCall("live.stop"); stopped = true; } catch { /* Status decides whether it ended. */ }
    const shown = await refresh();
    if (run !== operation.current) return;
    if (shown?.running || (!stopped && !shown)) {
      setError(latest.current.a.liveFailed);
      return;
    }
    await unregister();
  }, [refresh, unregister]);

  // At launch: what the shell shows; a registration whose ticker ended meanwhile is withdrawn.
  useEffect(() => {
    if (!ANDROID) return;
    void refresh().then((s) => {
      if (s && !s.running) void unregister();
      else if (s?.running && s.startedAt) void register(s.startedAt);
    });
    const off = onNative("live", (data) => {
      if (data.running === false) operation.current++;
      void refresh().then((s) => { if (s && !s.running) void unregister(); });
    });
    return () => { off(); registration.current!.invalidate(); };
  }, [refresh, register, unregister]);
  // Back in the foreground: the ticker may have run out, and a registration may still be owed.
  useEffect(() => {
    if (!ANDROID) return;
    return onNative("resume", () => {
      void refresh().then((s) => {
        if (s && !s.running && registration.current!.needsCleanup) void unregister();
        else if (s?.running && s.startedAt && registration.current!.pending) void register(s.startedAt);
      });
    });
  }, [refresh, register, unregister]);

  // A ticker started before capability discovery, or before FCM token rotation, needs a new PUT.
  const wasPushReady = useRef(pushReady);
  useEffect(() => {
    const becameReady = pushReady && !wasPushReady.current;
    wasPushReady.current = pushReady;
    if (becameReady) void refresh().then((s) => { if (s?.running && s.startedAt) void register(s.startedAt); });
  }, [pushReady, refresh, register]);
  useEffect(() => onNative("pushToken", (data) => {
    const token = typeof data.token === "string" ? data.token : undefined;
    void refresh().then((s) => { if (s?.running && s.startedAt) void register(s.startedAt, token); });
  }), [refresh, register]);

  const running = !!status?.running;
  // While the page runs, every new app-wide price goes straight to the ticker.
  useEffect(() => {
    if (!running || !price) return;
    void nativeCall("live.update", { state: quoteOf(price) }).catch(() => {});
  }, [running, price]);
  // A language change redraws it in the new language, keeping its start.
  useEffect(() => {
    if (running) void start(style);
  }, [a.livePriceTitle]);
  // Pro lapsed (refund, sign-out): take it down, as iOS does.
  useEffect(() => { if (running && pro === false) void stop(); }, [running, pro, stop]);

  return {
    supported: ANDROID,
    running,
    style,
    busy,
    error,
    async toggle(on) {
      setBusy(true); setError("");
      try { if (on) await start(style); else await stop(); }
      finally { setBusy(false); }
    },
    // A running ticker is redrawn in the new style and keeps its start (iOS restarts the activity).
    setStyle(next) {
      setStyleState(next);
      try { localStorage.setItem(STYLE, next); } catch { /* Per run only. */ }
      if (running) void start(next);
    },
  };
}

const OFF: LiveTicker = { supported: false, running: false, style: "full", busy: false, error: "", toggle: async () => {}, setStyle: () => {} };
const STYLE = "pearlhub.live.style";
function savedLiveStyle(): LiveStyle {
  try { const s = localStorage.getItem(STYLE); return s === "lock" || s === "island" ? s : "full"; } catch { return "full"; }
}
