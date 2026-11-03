import copy from "./android-copy.json" with { type: "json" };
import { nativeCall, hasBridge, installNativeHelpers } from "./android-bridge.ts";
import type { Lang } from "./types.ts";

// The Android app bundles this site and opens it as https://pearlhub.net/?client=android&store=…
// (BRIDGE.md in the prl-hub-android repository). `vite build --mode android` sets __PEARL_ANDROID__; the website build
// leaves it false, so none of this ships to — or can be switched on in — the website.
declare const __PEARL_ANDROID__: boolean | undefined;
export const ANDROID = typeof __PEARL_ANDROID__ !== "undefined" && __PEARL_ANDROID__ === true;

export type AndroidCopy = typeof copy.en;
// The iOS strings' positional slots ({0}, {1}) filled in.
export const fill = (template: string, ...values: (string | number)[]) => template.replace(/\{(\d)\}/g, (_, i) => String(values[Number(i)] ?? ""));
// The website build folds this to an empty object, which keeps the strings out of its bundle.
export const androidCopy = (lang: Lang): AndroidCopy => ANDROID ? copy[lang] || copy.en : {} as AndroidCopy;

// Google Play forbids selling Pro outside Play billing, so the Play build describes Pro
// without a price or PRL checkout, like the iOS app. The direct (website APK) build sells it.
const STORE_KEY = "pearlhub.android.store";
export function androidStore(search = typeof location === "undefined" ? "" : location.search): "play" | "direct" {
  const given = new URLSearchParams(search).get("store");
  try {
    if (given === "play" || given === "direct") sessionStorage.setItem(STORE_KEY, given);
    return sessionStorage.getItem(STORE_KEY) === "direct" ? "direct" : "play";
  } catch {
    return given === "direct" ? "direct" : "play";
  }
}

export type AppIconChoice = "pearl" | "modern" | "classic";
export type AndroidInfo = {
  flavor: "play" | "direct"; versionName: string; versionCode: number; sdkInt: number; fcm: boolean; deviceSecure: boolean;
  // iOS parity (BRIDGE.md "info"): 应用图标, 锁定竖屏 (phones only), the launch counters behind the
  // review and donation prompts, and whether this build has a store to rate in.
  icon?: AppIconChoice; phone?: boolean; lockPortrait?: boolean; launches?: number; firstLaunch?: number; storeReview?: boolean;
  widgetPlaced?: boolean;
  // The Play build has Google Play Billing (billing.* methods).
  billing?: boolean;
};
let info: Promise<AndroidInfo | null> | undefined;
export const androidInfo = (fresh = false) => {
  if (fresh) info = undefined;
  return info ||= hasBridge() ? nativeCall<AndroidInfo>("info").catch(() => null) : Promise.resolve(null);
};

// 设置 → 外观 → 应用图标 / 锁定竖屏, as in the iOS app.
export const setAppIcon = (icon: AppIconChoice) => nativeCall<{ icon: AppIconChoice }>("icon.set", { icon }).then((r) => r.icon);
export const setLockPortrait = (lock: boolean) => nativeCall<{ lockPortrait: boolean }>("ui.portrait", { lock }).then((r) => r.lockPortrait);
// The store's rating sheet, asked at the iOS app's moment (a 我的监控 refresh that found rigs) under its
// gates, which the shell keeps; and 设置 → 关于 → 为 Pearl Hub 评分, the store page itself.
export const requestReview = () => void nativeCall("review.request").catch(() => {});
export const openStoreReview = () => nativeCall("review.open").then(() => true, () => false);
// A file the person saves through the system's "save as" screen (a download link does nothing in the app).
export const saveFile = (name: string, mime: string, text: string) => nativeCall("file.save", { name, mime, text }, 0);

export type AndroidTab = "wallet" | "trade" | "mining" | "workers" | "settings";
export type MiningPage = "market" | "pools" | "calculator";
export const miningPages: MiningPage[] = ["market", "pools", "calculator"];
export const androidPages = ["wallet", "trade", "market", "pools", "calculator", "workers", "settings", "alerts"] as const;
// Notification and widget taps (BRIDGE.md); `pro` opens 设置 with the Pro introduction.
export const androidRoutes = [...androidPages, "pro"] as const;
export const tabOf = (page: string): AndroidTab =>
  page === "wallet" ? "wallet" : page === "trade" ? "trade" : miningPages.includes(page as MiningPage) ? "mining" : page === "workers" ? "workers" : "settings";

// Native events (resume, pause, notification, pushToken, keyboard) arrive through window.__pearlEvent.
type Listener = (data: Record<string, unknown>) => void;
const listeners = new Map<string, Set<Listener>>();
export function onNative(name: string, listener: Listener) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(listener);
  return () => { listeners.get(name)?.delete(listener); };
}

// Back button: the page closes its top layer first; false lets the shell send the app to
// the background.
let backHandler: (() => boolean) | undefined;
export const setBackHandler = (handler: (() => boolean) | undefined) => { backHandler = handler; };

let installed = false;
export function installAndroid() {
  if (!ANDROID || installed) return;
  installed = true;
  window.__pearlEvent = (name, data) => {
    for (const listener of listeners.get(name) || []) {
      try { listener((data && typeof data === "object" ? data : {}) as Record<string, unknown>); } catch { /* One listener must not stop the rest. */ }
    }
  };
  window.__pearlBack = () => { try { return backHandler?.() === true; } catch { return false; } };
  // The keyboard covers the tab bar on iOS; here the WebView shrinks above it, so hide the bar.
  onNative("keyboard", (data) => { document.documentElement.classList.toggle("android-keyboard", data.visible === true); });
  installNativeHelpers();
  void import("./android.css");
}

// The wallet frame fills the space above the bottom tab bar.
export function trackTabBar(nav: Element | null) {
  if (!nav) return () => {};
  const measure = () => document.documentElement.style.setProperty("--android-nav", `${Math.ceil(nav.getBoundingClientRect().height)}px`);
  const observer = new ResizeObserver(measure);
  observer.observe(nav);
  measure();
  return () => observer.disconnect();
}

// System bars take the page's own background colour.
export function reportTheme() {
  if (!ANDROID || !hasBridge()) return;
  const root = document.documentElement;
  const background = hex(getComputedStyle(document.body).backgroundColor) || hex(getComputedStyle(root).backgroundColor);
  void nativeCall("ui.theme", { background: background || (root.dataset.theme === "dark" ? "#101724" : "#f4f6fc"), dark: root.dataset.theme === "dark" }).catch(() => {});
}
function hex(color: string) {
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3 || (parts.length > 3 && Number(parts[3]) === 0)) return "";
  return "#" + parts.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
}

// Notification permission and the FCM token for PUT /v1/web/push.
export type NativePermission = "granted" | "denied" | "default" | "unavailable";
export const notificationStatus = (): Promise<NativePermission> =>
  nativeCall<{ permission: NativePermission }>("notifications.status").then((r) => r.permission, () => "unavailable");
export const requestNotifications = (): Promise<NativePermission> =>
  nativeCall<{ permission: NativePermission }>("notifications.request", {}, 0).then((r) => r.permission, () => "unavailable");
export const pushToken = () => nativeCall<{ token: string }>("push.token", {}, 30000).then((r) => r.token);
export const deletePushToken = () => nativeCall("push.delete").then(() => undefined, () => undefined);
export const openNotificationSettings = () => void nativeCall("notifications.settings").catch(() => {});

// Home-screen widgets (BRIDGE.md "Widget snapshot"): published when something changed, and
// unchanged figures at most once a minute so the widget's "updated" stamp stays current (iOS restampAfter).
const RESTAMP_MS = 60_000;
const published: Record<string, { key: string; at: number }> = {};
export function publishWidget(part: "app" | "wallet", data: unknown) {
  if (!ANDROID || !hasBridge()) return;
  const key = JSON.stringify(data, (k, v) => k === "at" ? undefined : v), now = Date.now();
  if (published[part]?.key === key && now - published[part].at < RESTAMP_MS) return;
  published[part] = { key, at: now };
  void nativeCall("widgets.update", { part, data }).catch(() => { delete published[part]; });
}
