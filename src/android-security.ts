import localized from "./android-security-locales.json" with { type: "json" };
import { androidStore } from "./android.ts";
import { extensionSources } from "./extension-sources.ts";
import type { IconName } from "./icon-symbols.tsx";
import { repositories, securityCopy, type SecurityCopy } from "./security-overview.ts";
import type { Lang } from "./types.ts";

// 设置 → 安全与隐私 → 安全性说明 in the Android app, in the order of the native app's
// SecurityInfoView.swift. Rows reuse security-overview-locales.json where the website's or the
// wallet's wording is true of Android word for word; the rest is in android-security-locales.json.
// Keep in step with web/scripts/build-android.mjs (CSP), the prl-hub-android repository and src/android/ in prl-hub-wallet.
export type AndroidSecurityCopy = SecurityCopy & typeof localized.en;
type Text = keyof AndroidSecurityCopy;
export type AndroidSecuritySection = { title?: Text; rows: { icon: IconName; title: Text; text: Text }[]; repos?: { title: Text; url: string }[] };
export const androidSecurityCopy = (lang: Lang): AndroidSecurityCopy => ({ ...securityCopy(lang), ...(localized[lang] || localized.en) });

// The Play build buys Pro through Google Play billing; the website APK takes PRL.
const play = androidStore() === "play";
export const androidSecurity: AndroidSecuritySection[] = [
  { rows: [{ icon: "shield", title: "extHeadTitle", text: "androidHead" }] },
  { title: "neverReceive", rows: [
    { icon: "key", title: "keys", text: "androidKeys" },
    { icon: "lock", title: "androidUnlockTitle", text: "androidUnlock" },
    { icon: "key", title: "androidSafeTradeKeyTitle", text: "androidSafeTradeKey" },
    { icon: "card", title: "payment", text: play ? "androidPaymentPlay" : "androidPayment" },
    { icon: "eyeOff", title: "tracking", text: "androidTracking" },
  ] },
  { title: "toServer", rows: [
    { icon: "history", title: "history", text: "androidHistory" },
    { icon: "market", title: "publicData", text: "webPublic" },
    { icon: "pools", title: "webPoolsTitle", text: "webPools" },
    { icon: "wallet", title: "androidIncomeTitle", text: "androidIncome" },
    { icon: "alerts", title: "androidPushTitle", text: "androidPush" },
    { icon: "sparkles", title: "purchaseTitle", text: play ? "androidPurchasePlay" : "androidPurchase" },
    { icon: "account", title: "account", text: "androidAccount" },
  ] },
  { title: "androidDirect", rows: [
    { icon: "cube", title: "explorer", text: "androidExplorer" },
    // The wallet's NOCK side: rpc.nockbox.org from the WebView, 216.158.95.10 through the shell's nock.rpc.
    { icon: "server", title: "nockTitle", text: "androidNock" },
    { icon: "refresh", title: "androidUpdateTitle", text: "androidUpdate" },
    { icon: "globe", title: "turnstileTitle", text: "webTurnstile" },
    { icon: "market", title: "safetradeTitle", text: "androidSafeTrade" },
    { icon: "change", title: "androidSafeTradeAccountTitle", text: "androidSafeTradeAccount" },
    { icon: "alerts", title: "androidFcmTitle", text: "androidFcm" },
    { icon: "lock", title: "extOthersTitle", text: "androidOthers" },
  ] },
  { title: "onPhone", rows: [
    { icon: "app", title: "thisPhone", text: "androidLocal" },
    { icon: "refresh", title: "androidWidgetsTitle", text: "androidWidgets" },
  ] },
  // The Android shell's own source is not public yet: an empty url renders "Link pending".
  { title: "openSource", rows: [{ icon: "code", title: "androidSourceTitle", text: "androidSource" }], repos: [
    { title: "repoAndroid", url: "" },
    { title: "repoWeb", url: repositories.web },
    { title: "repoExtension", url: extensionSources.source },
    { title: "repoApp", url: repositories.app },
    { title: "repoServer", url: repositories.server },
  ] },
];
