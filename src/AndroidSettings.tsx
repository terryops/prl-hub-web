import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons.tsx";
import { nativeCall } from "./android-bridge.ts";
import { setAppIcon, setLockPortrait, openStoreReview, fill, type AndroidCopy, type AndroidInfo, type AppIconChoice } from "./android.ts";
import type { LiveTicker, LiveStyle } from "./android-live.ts";
import type { PlayStore } from "./android-billing.ts";
import type { WalletControl, WalletState, WalletTarget } from "./android-host.ts";
import type { TextKey } from "./i18n/index.ts";
import type { Me, Monitor, State } from "./types.ts";
import { ALERT_AFTER, ALERT_AGAIN } from "./monitors.ts";
import { securityCopy } from "./security-overview.ts";
import { InfoTip } from "./InfoTip.tsx";

// Android's 设置 tab, laid out like the iOS app's SettingsView (prl-hub Sources/Settings/SettingsView.swift,
// SettingsPages.swift): account and wallet, Pro, notifications, appearance, language and currency, gateway,
// security, help and about. Rows open second-level pages inside the tab, as iOS pushes them on its navigation
// stack; the back button and "‹ 设置" return.
export type SettingsPage = "wallet" | "web" | "pro" | "live" | "offline" | "appearance" | "icon" | "network" | "about" | "licenses" | "trade" | "tradeGuide";

// iOS WebVersion.url: Pearl Hub in a computer's browser.
export const WEB_URL = "https://pearlhub.net/";

// What the 掉线提醒 page (iOS OfflineAlertsView.swift) needs from the app: the monitors, what the Worker
// reports about each (missing at the pool / not answering), and the setters the 我的监控 cards use.
export type OfflineAlerts = {
  monitors: Monitor[]; status: Record<string, { missing: boolean; stale: boolean }>; denied: boolean; window: boolean;
  setAfter(m: Monitor, seconds: number): void; setAgain(m: Monitor, seconds: number): void;
  remindOnce: string; remindAfter: string;
};
// iOS OfflineAlertStore.durationText: "10 分钟", "1 小时".
export const alertDuration = (a: AndroidCopy, seconds: number) => seconds % 3600 === 0 ? fill(a.hours, seconds / 3600) : fill(a.minutes, seconds / 60);

// `hint` is what a screen reader adds after the label (iOS accessibilityHint); nothing extra is drawn.
type Row = { icon: IconName; label: string; detail?: string; hint?: string; value?: ReactNode; onClick?: () => void; href?: string; danger?: boolean; plain?: boolean };
function Rows({ rows }: { rows: Row[] }) {
  return <div className="android-rows">{rows.map((row) => {
    const body = <><span className="android-row-icon"><Icon name={row.icon} /></span><span className="android-row-label">{row.label}{row.detail && <small>{row.detail}</small>}</span>{row.value != null && <span className="android-row-value">{row.value}</span>}{!row.plain && <Icon name={row.href ? "external" : "chevron"} className="android-row-chevron" />}</>;
    const className = row.danger ? "android-row danger" : "android-row";
    return row.href
      ? <a key={row.label} className={className} href={row.href} target="_blank" rel="noreferrer" aria-description={row.hint}>{body}</a>
      : <button key={row.label} className={className} onClick={row.onClick} disabled={!row.onClick} aria-description={row.hint}>{body}</button>;
  })}</div>;
}
// `info` (iOS PearlSectionHeader(info:)): an ⓘ beside the title holding what would otherwise be a footer paragraph.
function Group({ title, info, children, footer }: { title?: string; info?: string; children: ReactNode; footer?: ReactNode }) {
  return <section className="android-group">{title && (info
    ? <div className="android-group-head"><h2>{title}</h2><InfoTip label={title} text={info} /></div>
    : <h2>{title}</h2>)}<div className="card android-card">{children}</div>{footer && <p className="android-footer muted">{footer}</p>}</section>;
}
const Badge = ({ children }: { children: ReactNode }) => <span className="badge">{children}</span>;

// Pictures of the three icons (iOS AppLogoPearl / AppLogoModern / AppLogo), copied into the app's bundle
// only (web/android-public, scripts/build-android.mjs).
const ICONS: { id: AppIconChoice; src: string; label: (a: AndroidCopy) => string }[] = [
  { id: "pearl", src: "/android/icons/pearl.webp", label: (a) => a.iconPearl },
  { id: "modern", src: "/android/icons/modern.webp", label: (a) => a.iconModern },
  { id: "classic", src: "/android/icons/classic.webp", label: (a) => a.iconClassic },
];

// The iOS LicensesView's list, for what this app actually ships: the web UI and wallet libraries and the
// Android libraries of the shell.
const LICENSES: { name: string; license: string; holder: string; url: string }[] = [
  { name: "React, React DOM", license: "MIT", holder: "© Meta Platforms, Inc. and affiliates", url: "https://github.com/facebook/react" },
  { name: "@scure/btc-signer, @scure/bip32, @scure/bip39, @scure/base", license: "MIT", holder: "© Paul Miller", url: "https://github.com/paulmillr/scure-btc-signer" },
  { name: "@noble/curves, @noble/hashes", license: "MIT", holder: "© Paul Miller", url: "https://github.com/paulmillr/noble-curves" },
  { name: "qrcode-generator", license: "MIT", holder: "© Kazuhiko Arase", url: "https://github.com/kazuhikoarase/qrcode-generator" },
  { name: "Ionicons", license: "MIT", holder: "© Ionic", url: "https://github.com/ionic-team/ionicons" },
  // The wallet's NOCK core (prl-hub-wallet nock-core/, WebAssembly), as in the native app's LicensesView.
  { name: "Iris Wallet SDK (iris-rs) — NOCK wallet core", license: "MIT", holder: "© 2025 NockBox inc.", url: "https://github.com/nockbox/iris-rs" },
  { name: "Nockchain protocol definitions", license: "MIT", holder: "© Zorp Corp", url: "https://github.com/zorp-corp/nockchain" },
  { name: "Rust standard library & crates (prost, bip39, serde_json…)", license: "MIT OR Apache-2.0", holder: "© The Rust Project Developers and crate authors", url: "https://www.rust-lang.org" },
  { name: "AndroidX (Activity, AppCompat, Biometric, Core, SplashScreen, WebKit, WorkManager)", license: "Apache-2.0", holder: "© The Android Open Source Project", url: "https://github.com/androidx/androidx" },
  { name: "Material Components for Android", license: "Apache-2.0", holder: "© Google LLC", url: "https://github.com/material-components/material-components-android" },
  { name: "Firebase Cloud Messaging", license: "Apache-2.0", holder: "© Google LLC", url: "https://github.com/firebase/firebase-android-sdk" },
  { name: "Kotlin Standard Library", license: "Apache-2.0", holder: "© JetBrains s.r.o. and Kotlin Programming Language contributors", url: "https://github.com/JetBrains/kotlin" },
];

export function AndroidSettings({ state, me, accountReady, accountEmail, info, a, t, general, page, setPage, live, wallet, pushReady, pay, store, offlineAlerts,
  onAppearance, onInfo, onAccount, onBuy, onAlerts, onSecurity, onWidgets, onWallet, trade }: {
  state: State; me: Me | null; accountReady: boolean; accountEmail: string; info: AndroidInfo | null;
  a: AndroidCopy; t: (key: TextKey) => string; general: ReactNode;
  page: SettingsPage | null; setPage: (page: SettingsPage | null) => void;
  live: LiveTicker; wallet: () => WalletControl | undefined; pushReady: boolean;
  // The direct build's PRL checkout (price, and whether it is open); null in the Play build.
  pay: { price: ReactNode; enabled: boolean } | null;
  // The Play build's Google Play Billing (android-billing.ts); null in the direct build, or when Play
  // Billing or the server's purchase check is not available.
  store: PlayStore | null;
  offlineAlerts: OfflineAlerts;
  onAppearance: (appearance: Partial<Pick<State, "theme">> & { palette?: string }) => void;
  onInfo: (info: AndroidInfo) => void;
  onAccount: () => void; onBuy: () => void; onAlerts: () => void; onSecurity: () => void; onWidgets: () => void;
  onWallet: () => void;
  // 设置 → 交易（SafeTrade） (iOS TradeSettingsView) and its 获取 API 密钥 page, drawn by the trade module.
  trade: { guideTitle: string; render: (page: "trade" | "tradeGuide") => ReactNode };
}) {
  const signedIn = accountReady && !!state.accountId;
  const pro = !!me?.pro;
  const rules = state.rules.filter((r) => !r.deleted && r.enabled).length;
  const offline = state.monitors.filter((m) => !m.deleted && !m.paused && m.alert).length;
  const [walletState, setWalletState] = useState<WalletState | null>(() => wallet()?.state() || null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  useEffect(() => {
    let off: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    // The frame may still be loading: wait for its control to appear.
    const attach = () => {
      const control = wallet();
      if (!control) { timer = setTimeout(attach, 500); return; }
      setWalletState(control.state());
      off = control.subscribe(() => setWalletState(control.state()));
    };
    attach();
    return () => { clearTimeout(timer); off?.(); };
  }, [wallet]);
  const openWallet = (target?: WalletTarget) => { onWallet(); if (target) wallet()?.open(target); };
  const proBadge = (count: number) => !pro ? <Badge>{a.premium}</Badge> : count ? String(count) : undefined;
  const themeLabel = t(state.theme === "light" ? "light" : state.theme === "dark" ? "dark" : "systemTheme");
  const icon = ICONS.find((i) => i.id === (info?.icon || "pearl")) || ICONS[0];
  const version = info ? `${info.versionName} (${info.versionCode})` : "—";
  const network = walletState?.network === "testnet" ? "Testnet" : walletState?.network === "mainnet" ? "Mainnet" : undefined;

  const sub = (title: string, body: ReactNode, info?: string) => <div className="android-settings">
    <div><button className="android-back" onClick={() => setPage(page === "licenses" ? "about" : page === "tradeGuide" ? "trade" : null)}><Icon name="chevron" />{page === "licenses" ? a.about : page === "tradeGuide" ? a.tradeSettings : a.tabSettings}</button>
      {info ? <div className="android-page-head"><h1 className="android-page-title">{title}</h1><InfoTip label={title} text={info} /></div> : <h1 className="android-page-title">{title}</h1>}</div>
    {body}
  </div>;

  const proFeatures = <ul className="android-features">
    {([["refresh", a.proFeatureSync], ["market", a.proFeatureTarget], ["change", a.proFeatureMove], ["workers", a.proFeatureOffline], ["lock", a.proFeatureLive], ["pools", a.proFeatureDepth], ["app", a.proFeatureWidgets]] as [IconName, string][])
      .map(([name, text]) => <li key={text}><Icon name={name} /><span>{text}</span></li>)}
  </ul>;
  const proCard = pro
    ? <div className="card android-pro-card">
      <div className="android-pro-head"><span className="android-row-icon"><Icon name="sparkles" /></span><strong>{a.proTitle}</strong><Badge><Icon name="check" />{a.proActive}</Badge></div>
      {proFeatures}
    </div>
    : <div className="card android-pro-card">
      <div className="android-pro-hero"><span className="android-row-icon"><Icon name="sparkles" /></span><strong>{a.proTitle}</strong></div>
      {proFeatures}
      {pay && <button className="primary wide" disabled={!pay.enabled} onClick={onBuy}>{t("buy")} · {pay.price}</button>}
      {pay && <p className="muted android-center">{a.proOneTime}</p>}
      {/* As the iOS paywall: 以 <price> 解锁, then 恢复购买 · 一次性购买，不是订阅。, then any message. */}
      {store && <button className="primary wide" disabled={store.busy} onClick={store.buy}>{store.price ? fill(a.proUnlockFor, store.price) : a.proUnlock}</button>}
      {store && <p className="muted android-center android-store-foot"><button className="text-button" disabled={store.busy} onClick={store.restore}>{t("restorePurchase")}</button> · {a.proOneTime}</p>}
      {store?.message && <p className="muted android-center" role="status">{store.message}</p>}
      <button className="text-button android-center" onClick={onAccount}>{a.proHaveIt}</button>
    </div>;
  // iOS ProSettingsView.syncDetails: the title, what syncs (and the shared purchase) in the ⓘ, the way to the account.
  const syncCard = <Group title={a.crossDeviceSync} info={info?.flavor === "play" ? `${a.proSyncDetail}\n\n${a.proSameEmailPlay}` : a.proSyncDetail}>
    <Rows rows={[{ icon: "account", label: a.emailAccount, value: signedIn ? a.connected : undefined, onClick: onAccount }]} />
  </Group>;

  if (page === "pro") return sub(a.proMembershipTitle, <>{proCard}{syncCard}</>);

  // iOS WebVersionView (设置 → 网页版): the address to type on a computer, with copy / open / share. Only an
  // account that syncs (Pro on the account) finds its monitors there already, so it is told which email to use.
  if (page === "web") return sub(a.webVersion, <>
    <Group>
      <div className="android-web-address">
        <code>pearlhub.net</code><InfoTip label={a.webVersion} text={a.webTip} />
        <button className="text-button" onClick={() => void navigator.clipboard?.writeText(WEB_URL).then(() => setCopied(true), () => {})}>{copied ? t("copied") : t("copy")}</button>
      </div>
      <Rows rows={[
        { icon: "globe", label: a.openInBrowser, href: WEB_URL },
        { icon: "send", label: a.share, plain: true, onClick: () => void nativeCall("share", { text: WEB_URL }).catch(() => {}) },
      ]} />
    </Group>
    {signedIn && pro && me?.pro_scope !== "device" && accountEmail && <Group>
      <div className="android-row android-row-static">
        <span className="android-row-icon"><Icon name="account" /></span>
        <span className="android-row-label android-title-tip">{a.webSameEmail}<InfoTip label={a.webSameEmail} text={fill(a.webSameEmailTip, accountEmail)} /></span>
        <span className="android-row-value">{accountEmail}</span>
      </div>
    </Group>}
  </>);
  if (page === "trade" || page === "tradeGuide") return sub(page === "trade" ? a.tradeSettings : trade.guideTitle, trade.render(page));

  if (page === "offline") {
    const running = offlineAlerts.monitors.filter((m) => !m.deleted && !m.paused);
    const on = running.filter((m) => m.alert).length;
    // iOS OfflineAlertsView.howItWorks: how it works, what a drop outside the push hours does and what the
    // server keeps, all in the ⓘ by 我的监控; each row's menus say what is being chosen.
    const howItWorks = [a.offlineIntro, ...offlineAlerts.window ? [a.offlineWindowNote] : [], a.offlinePrivacy].join("\n\n");
    return sub(a.offlineAlerts, <>
      {pro ? <>
        {offlineAlerts.denied && <p className="android-warn">{a.offlineDenied}</p>}
        <Group title={a.myMonitors} info={howItWorks} footer={on >= 20 ? fill(a.offlineCap, 20) : undefined}>
          {!running.length ? <p className="android-empty">{offlineAlerts.monitors.some((m) => !m.deleted) ? a.offlineAllPaused : a.offlineNoMonitors}</p>
            : running.map((m) => {
              const status = m.alert ? offlineAlerts.status[m.id] : undefined;
              return <div key={m.id} className="android-offline-row">
                <span className="android-row-icon"><Icon name="workers" /></span>
                <span className="android-offline-copy"><strong>{m.label}</strong>
                  <small className={status?.missing || status?.stale ? "android-warn" : undefined}>{status?.missing ? a.offlineMissing : status?.stale ? a.offlineStale
                    : m.alert ? m.again ? fill(a.offlineSummaryAgain, alertDuration(a, m.after), alertDuration(a, m.again)) : fill(a.offlineSummary, alertDuration(a, m.after)) : m.pool}</small></span>
                <span className="android-offline-pickers">
                  <select aria-label={`${a.offlineAlerts}: ${m.label}`} value={m.alert ? m.after : 0} disabled={!m.alert && on >= 20} onChange={(e) => offlineAlerts.setAfter(m, Number(e.target.value))}>
                    <option value={0}>{a.offlineOff}</option>
                    {ALERT_AFTER.map((n) => <option key={n} value={n}>{alertDuration(a, n)}</option>)}
                  </select>
                  {m.alert && <select aria-label={offlineAlerts.remindOnce} value={m.again || 0} onChange={(e) => offlineAlerts.setAgain(m, Number(e.target.value))}>
                    <option value={0}>{offlineAlerts.remindOnce}</option>
                    {ALERT_AGAIN.map((n) => <option key={n} value={n}>{offlineAlerts.remindAfter.replace("%@", alertDuration(a, n))}</option>)}
                  </select>}
                </span>
              </div>;
            })}
        </Group>
        <Group><Rows rows={[{ icon: "alerts", label: a.pushWindow, onClick: onAlerts }]} /></Group>
      </> : <>{proCard}{syncCard}</>}
    </>);
  }

  if (page === "live") return sub(a.liveTicker, pro ? <div className="card android-live">
    <div className="android-live-head">
      <span className="android-row-icon"><Icon name="lock" /></span>
      <span className="android-live-copy android-title-tip"><strong>{a.liveTicker}</strong><InfoTip label={a.liveTicker} text={a.liveIntro} /></span>
      <input type="checkbox" className="switch" aria-label={a.liveTicker} checked={live.running} disabled={live.busy} onChange={(e) => void live.toggle(e.target.checked)} />
    </div>
    {/* The style picks what carries the price; the status-bar chip exists from Android 16 (API 36). */}
    {(info?.sdkInt || 0) >= 36 && <div className="android-choices" role="radiogroup">
      {([["full", a.liveFull, a.liveFullNote], ["lock", a.liveLock, a.liveLockNote], ["island", a.liveBarFirst, a.liveBarNote]] as [LiveStyle, string, string][]).map(([id, title, note]) =>
        <button key={id} role="radio" aria-checked={live.style === id} className="android-choice" onClick={() => live.setStyle(id)}>
          <span className={live.style === id ? "android-radio on" : "android-radio"} aria-hidden="true" /><span><strong>{title}</strong><small>{note}</small></span>
        </button>)}
    </div>}
    {live.error && <p className="android-warn">{live.error}</p>}
    {!pushReady && info?.fcm === false && <p className="muted">{a.liveNoPush}</p>}
  </div> : <>{proCard}{syncCard}</>);

  if (page === "appearance") return sub(a.themePalette, <Group>
    <div className="android-fields">
      <label className="form-field">{t("theme")}
        <select aria-label={t("theme")} value={state.theme || "system"} onChange={(e) => onAppearance({ theme: e.target.value as State["theme"] })}>
          {(["system", "light", "dark"] as const).map((value) => <option key={value} value={value}>{t(value === "system" ? "systemTheme" : value)}</option>)}
        </select>
      </label>
      <label className="form-field">{t("palette")}
        <select aria-label={t("palette")} value={state.palette === "mono" ? "mono" : "classic"} onChange={(e) => onAppearance({ palette: e.target.value })}>
          <option value="classic">{t("classicBlue")}</option>
          <option value="mono">{t("modernSilver")}</option>
        </select>
      </label>
      {info?.phone && <label className="settings-toggle"><span>{a.lockPortrait}</span><input type="checkbox" className="switch" checked={info.lockPortrait !== false}
        onChange={(e) => void setLockPortrait(e.target.checked).then((lockPortrait) => onInfo({ ...info, lockPortrait })).catch(() => {})} /></label>}
    </div>
  </Group>);

  if (page === "icon") return sub(a.appIcon, <>
    <div className="card android-icons" role="radiogroup" aria-label={a.appIcon}>
      {ICONS.map((choice) => <button key={choice.id} role="radio" aria-checked={icon.id === choice.id} className={icon.id === choice.id ? "android-icon selected" : "android-icon"}
        onClick={() => { if (info && icon.id !== choice.id) void setAppIcon(choice.id).then((next) => onInfo({ ...info, icon: next })).catch(() => {}); }}>
        <img src={choice.src} alt="" width="72" height="72" /><span>{choice.label(a)}</span>{icon.id === choice.id && <Icon name="check" />}
      </button>)}
    </div>
  </>, a.iconNote);

  if (page === "network") return sub(a.pearlNetwork, <Group footer={walletState?.exists && walletState.locked ? a.unlockForNetwork : undefined}>
    <div className="android-fields">
      <label className="form-field">{a.pearlNetwork}
        <select aria-label={a.pearlNetwork} value={walletState?.network || "mainnet"} disabled={!walletState?.exists || walletState.locked}
          onChange={(e) => void wallet()?.setNetwork(e.target.value as "mainnet" | "testnet")}>
          <option value="mainnet">Mainnet</option>
          <option value="testnet">Testnet</option>
        </select>
      </label>
      {walletState?.exists && walletState.locked && <button onClick={() => openWallet()}>{a.unlock}</button>}
    </div>
    <Rows rows={(walletState?.network === "testnet" ? ["blockbook.testnet.pearlresearch.ai"] : ["pearlhub.net/node", "blockbook.pearlresearch.ai"]).map((host, index) => ({ icon: "server", label: `${a.indexer} ${index + 1}`, value: host, plain: true }))} />
  </Group>);

  if (page === "wallet") return sub(a.walletSecurity, <>
    {walletState?.exists && !walletState.locked && <Group title={a.walletSection}>
      <Rows rows={[
        { icon: "wallet", label: a.manageWallets, value: String(walletState.count), onClick: () => openWallet("wallets") },
        { icon: "account", label: a.addressBook, onClick: () => openWallet("contacts") },
        // A read-only wallet has no seed: nothing to reveal or recover (iOS SettingsPages, c14f2e6).
        ...walletState.readOnly ? [] : [
          { icon: "key" as const, label: a.viewPhrase, onClick: () => openWallet("backup") },
          { icon: "change" as const, label: a.recoverChange, onClick: () => openWallet("recover") },
        ],
        { icon: "lock", label: a.lockWallet, plain: true, onClick: () => wallet()?.lock() },
        { icon: "delete", label: walletState.readOnly ? a.removeWatchWallet : a.removeWallet, danger: true, onClick: () => openWallet("remove") },
      ]} />
      {/* Brings back the wallet page's NOCK line once closed there (only for a wallet that doesn't use NOCK). */}
      {walletState.nockLink && <label className="android-row android-row-static android-row-switch">
        <span className="android-row-icon"><svg className="icon" viewBox="0 0 512 512" aria-hidden="true"><path d="M256 40 443 148v216L256 472 69 364V148Z" fill="currentColor" /></svg></span>
        <span className="android-row-label">{a.showNockLink}</span>
        <input type="checkbox" className="switch" checked={walletState.nockLink === "shown"} onChange={(e) => wallet()?.setNockLink?.(e.target.checked)} />
      </label>}
    </Group>}
    {/* Locked (it locks after five minutes): the rows above need the wallet open, so offer the unlock. */}
    {walletState?.exists && walletState.locked && <Group title={a.walletSection}>
      <Rows rows={[{ icon: "lock", label: a.unlock, onClick: () => openWallet() }]} />
    </Group>}
    {/* iOS: the gist in the ⓘ, the full account of what is kept where one tap away. */}
    <Group title={a.security} info={a.walletSecurityNote}><Rows rows={[{ icon: "shield", label: securityCopy(state.lang).title, onClick: onSecurity }]} /></Group>
  </>);

  if (page === "about") return sub(a.about, <Group>
    <Rows rows={[
      { icon: "app", label: a.appLabel, value: "Pearl Hub", plain: true },
      { icon: "check", label: a.version, value: version, plain: true },
      ...info?.storeReview ? [{ icon: "sparkles" as IconName, label: a.rate, onClick: () => void openStoreReview() }] : [],
      { icon: "account", label: a.developer, value: "Cyber Corner", plain: true },
      { icon: "send", label: "Telegram @prl_hub", hint: a.telegram, href: "https://t.me/prl_hub" },
      { icon: "mail", label: "support@pearlhub.net", href: "mailto:support@pearlhub.net" },
      { icon: "code", label: a.github, href: "https://github.com/terryops/prl-hub-web" },
      { icon: "card", label: a.licenses, onClick: () => setPage("licenses") },
    ]} />
  </Group>);

  if (page === "licenses") return sub(a.licenses, <Group title={a.bundled} footer={a.licensesNote}>
    <div className="android-licenses">{LICENSES.map((c) => <div key={c.name} className="android-license">
      <div><strong>{c.name}</strong><span className="android-license-badge">{c.license}</span></div>
      <small className="muted">{c.holder}</small>
      <a href={c.url} target="_blank" rel="noreferrer">{c.url.replace("https://", "")}</a>
    </div>)}</div>
  </Group>);

  return <div className="android-settings">
    <Group title={a.accountWallet}>
      <Rows rows={[
        { icon: "account", label: a.emailAccount, value: signedIn ? a.connected : t("signIn"), onClick: onAccount },
        { icon: "mac", label: a.webVersion, value: "pearlhub.net", onClick: () => setPage("web") },
        { icon: "shield", label: a.walletSecurity, value: walletState?.exists && !walletState.locked ? String(walletState.count) : undefined, onClick: () => setPage("wallet") },
      ]} />
    </Group>
    <Group title={a.proMembership}>
      <Rows rows={[{ icon: "sparkles", label: a.proBenefits, value: pro ? a.proActive : a.proNone, onClick: () => setPage("pro") }]} />
    </Group>
    <Group title={a.notificationSettings}>
      <Rows rows={[
        { icon: "alerts", label: a.priceAlerts, value: proBadge(rules), onClick: onAlerts },
        { icon: "workers", label: a.offlineAlerts, value: proBadge(offline), onClick: () => setPage("offline") },
        { icon: "lock", label: a.liveTicker, value: !pro ? <Badge>{a.premium}</Badge> : live.running ? <span className="android-live-on">{a.liveRunning}</span> : undefined, onClick: () => setPage("live") },
      ]} />
    </Group>
    <Group title={a.appearance}>
      <Rows rows={[
        { icon: "appearance", label: a.themePalette, value: themeLabel, onClick: () => setPage("appearance") },
        { icon: "app", label: a.appIcon, value: icon.label(a), onClick: () => setPage("icon") },
      ]} />
    </Group>
    <Group title={a.widget}>
      <Rows rows={[{ icon: "app", label: a.widgetAdd, onClick: onWidgets }]} />
    </Group>
    <Group title={a.languageCurrency}>
      <div className="android-fields settings-dialog">{general}</div>
    </Group>
    <Group title={a.gateway}>
      <Rows rows={[
        { icon: "globe", label: a.pearlNetwork, value: network, onClick: () => setPage("network") },
        { icon: "key", label: a.tradeSettings, onClick: () => setPage("trade") },
      ]} />
    </Group>
    <Group title={a.securityPrivacy}>
      <Rows rows={[
        { icon: "shield", label: securityCopy(state.lang).title, onClick: onSecurity },
        { icon: "eyeOff", label: t("privacy"), href: "https://pearlhub.net/privacy.html" },
      ]} />
    </Group>
    <Group title={a.helpAbout}>
      <Rows rows={[{ icon: "check", label: a.about, value: version, onClick: () => setPage("about") }]} />
    </Group>
  </div>;
}

// The native app's WidgetGuide: what each home-screen widget shows, and a button that asks the
// launcher to place it (AppWidgetManager.requestPinAppWidget; BRIDGE.md `widgets.pin`).
export type WidgetKind = "hub" | "price" | "quote" | "change1h" | "change24h" | "quoteMining" | "coverMarket" | "coverMining";
export function AndroidWidgets({ a, add, pro, onPin, onPro }: { a: AndroidCopy; add: string; pro: boolean; onPin: (kind: WidgetKind) => void; onPro: () => void }) {
  // iOS WidgetGuide: no intro or footnotes; a row's name says what it shows, the ⓘ holds the rest.
  const cover = `${a.widgetCoverNote}\n${a.widgetCoverSteps}`;
  const widgets: [WidgetKind, string, string?][] = [
    ["hub", "Pearl Hub", a.widgetHubNote],
    ["price", a.widgetPrice],
    ["quote", a.widgetQuote],
    ["change1h", a.widgetChange1h],
    ["change24h", a.widgetChange24h],
    ["quoteMining", a.widgetQuoteMining, `${a.widgetQuoteMiningShort}\n${a.widgetQuoteMiningNote}`],
    ["coverMarket", a.widgetCoverMarket, cover],
    ["coverMining", a.widgetCoverMining, cover],
  ];
  return <div className="android-widgets">
    {pro
      ? <p className="android-widget-pro"><Icon name="check" />{a.widgetProUnlocked}</p>
      : <div className="card android-widget-upsell">
        <span className="android-title-tip"><strong>{a.widgetProTitle}</strong><InfoTip label={a.widgetProTitle} text={a.widgetFree} /></span>
        <button className="primary" onClick={onPro}>{a.proUnlock}</button>
      </div>}
    <div className="card android-card">{widgets.map(([kind, name, info]) => <div key={kind} className="android-widget-row">
      <span className="android-row-icon"><Icon name={kind === "hub" ? "wallet" : kind === "quoteMining" || kind === "coverMining" ? "workers" : "market"} /></span>
      <span className="android-widget-copy android-title-tip"><strong>{name}</strong>{info && <InfoTip label={name} text={info} />}</span>
      <button aria-label={`${a.widgetAdd}: ${name}`} onClick={() => onPin(kind)}>{add}</button>
    </div>)}</div>
  </div>;
}
