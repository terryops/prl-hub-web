import localized from "./security-overview-locales.json" with { type: "json" };
import { extensionSources } from "./extension-sources.ts";
import type { IconName } from "./icon-symbols.tsx";
import type { Lang } from "./types.ts";

// Settings → Security Overview, the Web and wallet counterpart of the native app's
// 设置 → 安全性说明 (prl-hub Sources/Settings/SecurityInfoView.swift). Same sections and
// wording where the facts match; each platform states only what its own code does.
// Keep in step with site/privacy.html, web/public/_headers (CSP), the extension manifest
// and the requests in api.ts, main.tsx, extension/src/background.ts and account.ts.
export type SecurityCopy = typeof localized.en;
type Text = keyof SecurityCopy;
export type SecurityRow = { icon: IconName; title: Text; text: Text };
export type SecurityRepo = { title: Text; url: string };
export type SecuritySection = { title?: Text; rows: SecurityRow[]; repos?: SecurityRepo[] };
export const securityCopy = (lang: Lang): SecurityCopy => localized[lang] || localized.en;

export const repositories = {
  app: "https://github.com/terryops/prl-hub",
  web: "https://github.com/terryops/prl-hub-web",
  server: "https://github.com/terryops/prl-hub-server",
};

// Open source leads on the Web: the page footer links here instead of to the repository.
export const webSecurity: SecuritySection[] = [
  { title: "openSource", rows: [{ icon: "code", title: "allPublicTitle", text: "allPublic" }], repos: [
    { title: "repoApp", url: repositories.app },
    { title: "repoWeb", url: repositories.web },
    { title: "repoServer", url: repositories.server },
  ] },
  { rows: [{ icon: "shield", title: "webHeadTitle", text: "webHead" }] },
  { title: "neverReceive", rows: [
    { icon: "key", title: "keys", text: "webKeys" },
    { icon: "card", title: "payment", text: "webPayment" },
    { icon: "eyeOff", title: "tracking", text: "webTracking" },
  ] },
  { title: "toServer", rows: [
    { icon: "market", title: "publicData", text: "webPublic" },
    { icon: "pools", title: "webPoolsTitle", text: "webPools" },
    { icon: "wallet", title: "webWatchTitle", text: "webWatch" },
    { icon: "alerts", title: "webPushTitle", text: "webPush" },
    { icon: "sparkles", title: "purchaseTitle", text: "webPurchase" },
    { icon: "account", title: "account", text: "webAccount" },
  ] },
  { title: "webDirect", rows: [
    { icon: "globe", title: "turnstileTitle", text: "webTurnstile" },
    { icon: "market", title: "safetradeTitle", text: "webSafeTrade" },
    { icon: "server", title: "webOthersTitle", text: "webOthers" },
  ] },
  { title: "inBrowser", rows: [{ icon: "mac", title: "thisBrowser", text: "webLocal" }] },
];

export const extensionSecurity: SecuritySection[] = [
  { rows: [{ icon: "shield", title: "extHeadTitle", text: "extHead" }] },
  { title: "neverReceive", rows: [
    { icon: "key", title: "keys", text: "extKeys" },
    { icon: "globe", title: "extPagesTitle", text: "extPages" },
    { icon: "history", title: "history", text: "extHistory" },
    { icon: "eyeOff", title: "tracking", text: "extTracking" },
  ] },
  { title: "toServer", rows: [
    { icon: "market", title: "publicData", text: "extPublic" },
    { icon: "account", title: "account", text: "extAccount" },
  ] },
  { title: "extDirect", rows: [
    { icon: "cube", title: "explorer", text: "extExplorer" },
    { icon: "lock", title: "extOthersTitle", text: "extOthers" },
  ] },
  { title: "inBrowser", rows: [
    { icon: "mac", title: "thisBrowser", text: "extLocal" },
    { icon: "cloudOff", title: "extNoSyncTitle", text: "extNoSync" },
  ] },
  // extSource: the wallet is built from its public repository, extensionSources.source.
  { title: "openSource", rows: [{ icon: "code", title: "allPublicTitle", text: "extSource" }], repos: [
    { title: "repoExtension", url: extensionSources.source },
    { title: "repoApp", url: repositories.app },
    { title: "repoWeb", url: repositories.web },
    { title: "repoServer", url: repositories.server },
  ] },
];
