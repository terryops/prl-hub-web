import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import qrcode from "qrcode-generator";
import { api, syncConfig, ApiError } from "./api.ts";
import { ensurePurchase, restorePurchase, associatePurchase } from "./purchases.ts";
import { localPurchase, rememberPurchaseToken } from "./purchase-key.ts";
import { AccountPanel, connectingDevice, browserDevice, type Account } from "./AccountPanel.tsx";
import { accountCopy } from "./account-copy.ts";
import {
  readStore,
  readGuest,
  readAccount,
  defaults,
  writeStore,
  configOf,
  normalizeConfig,
  mergeConfig,
  alive,
  pools,
  langs,
  fresh,
  deepLink,
  orderedMonitors,
} from "./store.ts";
import { dictionaries, languageNames, type TextKey } from "./i18n/index.ts";
import { applyAppearance, browserLanguage } from "./preferences.ts";
import { AppearanceMenu } from "./AppearanceMenu.tsx";
import { hashrate, rate, f2ref } from "./format.ts";
import type {
  State,
  Price,
  Stats,
  Order,
  Me,
  Availability,
  Monitor,
  WindowName,
  Lang,
  Rule,
  Income,
  Wallet,
} from "./types.ts";
import "./style.css";
import { MarketData, PoolDonut } from "./MarketData.tsx";
import { PoolComparison } from "./PoolOverview.tsx";
import { FleetCalculator } from "./FleetCalculator.tsx";
import { SecurityOverview } from "./SecurityOverview.tsx";
import { securityCopy, webSecurity } from "./security-overview.ts";
import { calculatorWithPoolFee } from "./calculator.ts";
import { quoteExpired } from "./orders.ts";
import { dual, rateLine, secondaryCode, currencies, type FX } from "./currency.ts";
import { applyingEdit, reconcileRule, relativeTime } from "./alertRules.ts";
import { enabledMonitors, alertMonitors, cleanAddress, moveIds, ownAddresses, targetKey, duplicateMonitor, hashrate24h, dailyAverage, nearestWindow, ALERT_AFTER, ALERT_AGAIN } from "./monitors.ts";
import { Icon, type IconName } from "./Icons.tsx";
import { Money, PRLAmount } from "./Money.tsx";
import { PaymentHead, PaymentAddress } from "./Payment.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { PasteButton } from "./NativeControls.tsx";
import { TxTools, type TxTab } from "./TxLookup.tsx";
import { WorkerList } from "./Workers.tsx";
import { LayoutSwitch, MonitorCompactList, monitorLayout } from "./MonitorCompact.tsx";
import { WatchWallet } from "./WatchWallet.tsx";
import { ExtensionBanner, WalletExtension } from "./WalletExtension.tsx";
import { pushTimeout, subscribePush } from "./push.ts";
import type { Overview } from "./types.ts";
import { appClient } from "./app-client.ts";
import { ANDROID, fill, androidStore, androidCopy, androidInfo, installAndroid, reportTheme, trackTabBar, publishWidget, onNative, setBackHandler, tabOf, miningPages, androidPages, notificationStatus, requestNotifications, pushToken, deletePushToken, openNotificationSettings, requestReview, type AndroidInfo, type AndroidTab, type MiningPage, type NativePermission } from "./android.ts";
import { useLiveTicker } from "./android-live.ts";
import { appStoreURL, macStoreURL, playStoreURL, downloadHash, downloadLink, storeFor } from "./app-stores.ts";
import { tradeBack } from "./trade-nav.ts";
import { InfoTip } from "./InfoTip.tsx";
import { popBackLayer } from "./back-layer.ts";
import { TabIcon } from "./android-icons.tsx";
import { widgetPoolSnapshot } from "./android-widget-snapshot.ts";
import { usePlayStore } from "./android-billing.ts";
import { PushSettings, pushTargetKey } from "./push-settings.ts";
import { contactsFromWallet, mergeWallets, walletChangesEmpty, withoutSkipped, type PearlHost } from "./android-host.ts";
import { hasBridge, nativeCall } from "./android-bridge.ts";
import { WalletFrame, walletBack, walletControl } from "./WalletFrame.tsx";
import { AndroidSettings, AndroidWidgets, type SettingsPage } from "./AndroidSettings.tsx";
import { AndroidRuleForm } from "./AndroidRuleForm.tsx";
import { androidSecurity, androidSecurityCopy } from "./android-security.ts";

// The Google Play build may not sell Pro outside Play billing; it follows the iOS app's rule.
const fromApp = appClient() || (ANDROID && androidStore() === "play");
if (ANDROID) installAndroid();
// The App page's QR code opens pearlhub.net/#download: a phone goes on to its store, anything else sees the App page.
if (!ANDROID && location.hash === downloadHash) {
  const store = storeFor(navigator.userAgent, navigator.maxTouchPoints);
  if (store) location.replace(store);
  else history.replaceState(null, "", `${location.pathname}${location.search}#app`);
}

type Page = "market" | "workers" | "pools" | "calculator" | "wallet" | "alerts" | "app" | "settings" | "trade";
const navShortKeys = {
  market: "navMarketShort",
  workers: "navWorkersShort",
  pools: "navPoolsShort",
  calculator: "navCalculatorShort",
  wallet: "navWalletShort",
  alerts: "navAlertsShort",
  app: "navAppShort",
} as const;
type Panel = "settings" | "security" | "account" | "restore" | "monitor" | "rule" | "pro" | "payment" | "wallet" | "walletqr" | "extension" | "appqr" | "widgets" | "txlookup" | null;
/// `at` is when `data` last arrived; a failed refresh keeps the previous data.
type Snapshot<T> = { data?: T; failed?: boolean; target?: string; at?: number };
// ?account=manage|delete|restore opens a panel once, when the page loads; keeping it in the address bar
// reopened that panel on every reload. The device-connect flow keeps its parameters.
function keptSearch() {
  const q = new URLSearchParams(location.search);
  if (q.get("account") !== "connect") q.delete("account");
  const s = q.toString();
  return s ? `?${s}` : "";
}
// The 交易 tab (SafeTrade) and 设置 → 交易（SafeTrade） load with their copy only when opened; the website
// build has neither.
declare const __PEARL_ANDROID__: boolean | undefined;
// The build-time constant itself (not the imported ANDROID), so the website build drops the import()s and
// emits no trade chunks.
const TradeTab = __PEARL_ANDROID__ ? lazy(() => import("./TradeTab.tsx")) : null;
const TradeSettings = __PEARL_ANDROID__ ? lazy(() => import("./TradeSettings.tsx")) : null;
const pageFromHash = (): Page => {
  const page = location.hash.slice(1).split("?")[0];
  // Like the iOS app, Android always opens on the wallet unless a notification names a page.
  if (ANDROID) return page === "pro" ? "settings" : (androidPages as readonly string[]).includes(page) ? page as Page : "wallet";
  return ["market", "workers", "pools", "calculator", "wallet", "alerts", "app"].includes(page) ? page as Page : "market";
};
// Android has no watch-only wallet page; its wallet is the real one.
const linkFromHash = (hash: string) => { const d = deepLink(hash); return ANDROID && d?.page === "wallet" ? null : d; };
const uid = () => crypto.randomUUID();
const hasPush = () => ANDROID ? hasBridge() :
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const QR = ({ value, cell = 5, margin = 12, alt = "QR" }: { value: string; cell?: number; margin?: number; alt?: string }) => {
  const q = qrcode(0, "M");
  q.addData(value);
  q.make();
  return <img className="qr" src={q.createDataURL(cell, margin)} alt={alt} />;
};
const initialState = readStore();
applyAppearance(initialState.theme, initialState.palette);
// Android: the wallet frame watches language, currency, appearance and its address book.
const hostListeners = new Set<() => void>();
const hostChanged = () => { for (const listener of hostListeners) { try { listener(); } catch { /* A closed frame. */ } } };
function App() {
  const [state, setState] = useState<State>(initialState),
    stateRef = useRef(state);
  stateRef.current = state;
  const [page, setPage] = useState<Page>(pageFromHash),
    [panel, setPanel] = useState<Panel>(() => { const d = linkFromHash(location.hash), account = new URLSearchParams(location.search).get("account"); return connectingDevice || ["manage", "delete"].includes(account || "") ? "account" : account === "restore" ? "restore" : d ? d.page === "wallet" ? "wallet" : "monitor" : null; });
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(() => ANDROID && location.hash === "#pro" ? "pro" : null);
  const [draftAddress, setDraftAddress] = useState(() => linkFromHash(location.hash)?.addr || "");
  const [walletId, setWalletId] = useState(""), [qrWallet, setQrWallet] = useState<Wallet | null>(null);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [txTab, setTxTab] = useState<TxTab>("lookup");
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null);
  const [watchStatus, setWatchStatus] = useState<Record<string, { missing: boolean; stale: boolean }>>({});
  const [alertHintDismissed, setAlertHintDismissed] = useState(() => { if (!ANDROID) return true; try { return localStorage.getItem("pearlhub.android.alertHint") === "1"; } catch { return false; } });
  const dismissAlertHint = () => { setAlertHintDismissed(true); try { localStorage.setItem("pearlhub.android.alertHint", "1"); } catch { /* This run only. */ } };
  // iOS PoolView's 网页版 card (WebVersionHintCard): opened or closed, it never comes back. It never sits beside
  // the 掉线提醒 card, and once that card was up this run it waits for a later launch rather than taking its place.
  const [webHintDismissed, setWebHintDismissed] = useState(() => { if (!ANDROID) return true; try { return localStorage.getItem("pearlhub.android.webHint") === "1"; } catch { return false; } });
  const dismissWebHint = () => { setWebHintDismissed(true); try { localStorage.setItem("pearlhub.android.webHint", "1"); } catch { /* This run only. */ } };
  const [alertHintSeen, setAlertHintSeen] = useState(false);
  // Market page: the Android launch banner, website only. Closing it is remembered on this device.
  const [androidBannerHidden, setAndroidBannerHidden] = useState(() => { if (ANDROID || fromApp) return true; try { return localStorage.getItem("pearlhub.androidBanner") === "1"; } catch { return false; } });
  const hideAndroidBanner = () => { setAndroidBannerHidden(true); try { localStorage.setItem("pearlhub.androidBanner", "1"); } catch { /* This visit only. */ } };
  const [manualRefresh, setManualRefresh] = useState(false);
  /// The monitor opened from 一览, shown as its full card in place of the list; null = none.
  /// `listScroll` is where the list was, to return to it.
  const [openMonitor, setOpenMonitor] = useState<string | null>(null), listScroll = useRef(0);
  const [deliveries, setDeliveries] = useState<Record<string, { kind: Rule["kind"]; value: number; window: number; deferred?: boolean }>>({});
  const [incomes, setIncomes] = useState<Record<string, Snapshot<Income>>>({});
  const [price, setPrice] = useState<Snapshot<Price>>({}),
    [history, setHistory] = useState<
      Snapshot<{ source: string; points: number[][] }>
    >({});
  const [fx, setFX] = useState<FX>();
  const [overview, setOverview] = useState<Snapshot<Overview>>({});
  const [stats, setStats] = useState<Record<string, Snapshot<Stats>>>({});
  // refresh() is created once, so it reads the latest snapshots through these.
  const statsRef = useRef(stats), incomesRef = useRef(incomes), readAt = useRef<Record<string, number>>({});
  statsRef.current = stats; incomesRef.current = incomes;
  const [availability, setAvailability] = useState<Availability>({
    pay: { enabled: false, usd: 4.99 },
    vapid_key: null,
  });
  const [androidInfoValue, setAndroidInfo] = useState<AndroidInfo | null>(null);
  const pushReady = ANDROID ? !!availability.fcm && androidInfoValue?.fcm === true : !!availability.vapid_key;
  const [miningPage, setMiningPage] = useState<MiningPage>(() => miningPages.includes(pageFromHash() as MiningPage) ? pageFromHash() as MiningPage : "market");
  const walletFrame = useRef<HTMLIFrameElement>(null);
  const [me, setMe] = useState<Me | null>(null),
    [order, setOrder] = useState<Order | null>(null),
    [accountEmail, setAccountEmail] = useState("");
  const canSync = !!(state.accountId && me?.pro && me.pro_scope !== "device");
  const canSyncRef = useRef(canSync);
  canSyncRef.current = canSync;
  const live = useLiveTicker({ price: price.data, pro: me ? me.pro : undefined, buyer: state.accountId || state.purchaseId, pushReady, a: androidCopy(state.lang) });
  const walletOf = useCallback(() => ANDROID ? walletControl(walletFrame) : undefined, []);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [accountReady, setAccountReady] = useState(false);
  const accountReadyRef = useRef(accountReady); accountReadyRef.current = accountReady;
  const [permission, setPermission] = useState<NotificationPermission | NativePermission>(
    ANDROID ? "default" : hasPush() ? Notification.permission : "unavailable",
  );
  const [pushState, setPushState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pendingMonitor, setPendingMonitor] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false),
    [syncStatus, setSyncStatus] = useState(""),
    // When the account last synced (iOS "已同步 · 3 分钟前").
    [syncedAt, setSyncedAt] = useState(0);
  const [ratesBusy, setRatesBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    refreshingRef = useRef(false),
    refreshQueued = useRef(false),
    syncRef = useRef(false),
    pushGeneration = useRef(0),
    accountGeneration = useRef(0);
  const pushSettings = useRef<PushSettings<State, PushTarget, PushReply> | null>(null);
  const money = (v: number) => dual(v, state.secondary, state.lang, fx);
  const t = (key: TextKey) => dictionaries[state.lang][key];
  const a = androidCopy(state.lang);
  const errorText = (error: unknown) =>
    error instanceof Error && error.message === "purchase_storage" ? t("storageError") :
    ANDROID && error instanceof Error && error.message === "pushPermission" ? a.notifyDenied :
    error instanceof Error && ["pushTimeout", "pushConnectError", "pushPermission"].includes(error.message)
      ? t(error.message as TextKey)
      :
    error instanceof Error &&
    ["invalid_config"].includes(error.message)
      ? t("invalid")
      : error instanceof ApiError && error.message === "login_required" ? accountCopy(state.lang).intro
      : error instanceof ApiError &&
          ["busy", "rate limited", "too many", "too_many_devices"].includes(
            error.message,
          )
        ? t("busy")
        : t("error");
  useEffect(() => {
    const changed = () => {
      setPage(pageFromHash());
      const d = linkFromHash(location.hash);
      if (d) { setDraftAddress(d.addr); setPanel(d.page === "wallet" ? "wallet" : "monitor"); }
      window.history.replaceState(null, "", `/${keptSearch()}#${pageFromHash()}`);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    window.history.replaceState(null, "", `/${keptSearch()}#${page}`);
    window.scrollTo(0, 0);
    listScroll.current = 0; setOpenMonitor(null);   // a page opens on its list, not on a monitor left open there
  }, [page]);
  // An opened monitor starts at the top; going back returns to where the list was.
  useEffect(() => { window.scrollTo(0, openMonitor ? 0 : listScroll.current); }, [openMonitor]);
  useEffect(() => {
    if (ANDROID) {
      // The system permission can change in Settings while the app is in the background.
      const check = () => void notificationStatus().then(setPermission);
      check();
      return onNative("resume", check);
    }
    if (!hasPush()) return;
    let status: PermissionStatus | undefined, disposed = false;
    void navigator.permissions.query({ name: "notifications" }).then((value) => {
      if (disposed) return;
      status = value;
      status.onchange = () => setPermission(Notification.permission);
    }).catch(() => {});
    return () => { disposed = true; if (status) status.onchange = null; };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { applyAppearance(state.theme, state.palette); if (ANDROID) { reportTheme(); hostChanged(); } };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state.theme, state.palette]);
  useEffect(() => {
    if (!state.followBrowserLanguage) return;
    const apply = () => setState((s) => {
      const lang = browserLanguage();
      return s.lang === lang ? s : { ...s, lang };
    });
    apply();
    window.addEventListener("languagechange", apply);
    return () => window.removeEventListener("languagechange", apply);
  }, [state.followBrowserLanguage]);
  useEffect(() => {
    document.documentElement.lang = state.lang;
    try {
      writeStore(state);
    } catch {
      setMessage(dictionaries[state.lang].storageError);
    }
  }, [state]);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else {
      dialog.current?.close();

    }
  }, [panel]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (panel !== "payment") return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [panel]);
  const update = (fn: (s: State) => State) => setState((s) => fn(s));
  const buyerId = (s: State) => s.accountId || s.purchaseId;
  const ensureBuyer = async () => {
    const at=accountGeneration.current;
    const profile=await ensurePurchase(browserDevice());
    if(at!==accountGeneration.current)throw new Error("identity_changed");
    if(stateRef.current.accountId)await associatePurchase(stateRef.current.accountId);
    if(at!==accountGeneration.current)throw new Error("identity_changed");
    stateRef.current={...stateRef.current,purchaseId:profile.purchase_id};
    update(s=>({...s,purchaseId:profile.purchase_id}));
    return buyerId(stateRef.current);
  };
  const leaveAccount = useCallback(async (expected?: string) => {
    if (expected && stateRef.current.accountId !== expected) return;
    accountGeneration.current++;
    pushGeneration.current++;
    const guest = {...readGuest(),token:localPurchase()?.token || readGuest().token};
    stateRef.current = guest; setState(guest); writeStore(guest);
    setMe(null); setOrder(null); setDeliveries({}); setPushState("idle"); setAccountEmail(""); setAccountReady(true);
    if (hasPush() && !localPurchase()) {
      if (ANDROID) await deletePushToken();
      else try { const reg = await pushTimeout(navigator.serviceWorker.ready); const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch { /* Local features remain available. */ }
    }
  }, []);
  const adoptAccount = useCallback(async (account: Account, askImport = true, generation = ++accountGeneration.current) => {
    const id = account.user_id;
    const association=localPurchase()?await associatePurchase(id):null;
    // Email sign-in returns only the ids; the account button is labelled from the email.
    const [profile, email] = await Promise.all([api<Me>("/v1/me", "GET", undefined, id), account.email || api<Account>("/v1/account", "GET", undefined, id).then((a) => a.email, () => "")]);
    const paid = profile.pro && profile.pro_scope !== "device";
    const server = paid ? await api<{ schema_version: number; data: import("./types.ts").Config | null }>("/v1/account/config", "GET", undefined, id) : { schema_version: 1, data: null };
    if (generation !== accountGeneration.current) return;
    if(association?.conflict)setMessage(accountCopy(stateRef.current.lang).purchaseLinkedElsewhere);
    if (server.schema_version !== 1) throw new Error("invalid_config");
    const cached = readAccount(id);
    const guest = readGuest();
    const remote = server.data ? normalizeConfig(server.data) : null;
    let config = cached ? remote ? mergeConfig(configOf(cached), remote) : configOf(cached) : remote || configOf(paid ? defaults() : guest);
    const hasLocal = guest.monitors.length || guest.wallets.length || guest.rules.length || guest.contacts?.length || guest.devices?.length || guest.settingsUpdated;
    if (paid && askImport && !cached && hasLocal && confirm(accountCopy(guest.lang).import)) config = mergeConfig(config, configOf(guest));
    const followBrowserLanguage = cached?.followBrowserLanguage ?? stateRef.current.followBrowserLanguage;
    const next: State = { ...(cached || (paid ? defaults() : guest)), ...config, followBrowserLanguage, lang: followBrowserLanguage ? browserLanguage() : config.lang, accountId: id, purchaseId:localPurchase()?.id||"", token: localPurchase()?.token || cached?.token || "", sync: cached?.sync ?? true };
    pushGeneration.current++; stateRef.current = next; setState(next); writeStore(next);
    setMe(profile); setOrder(profile.order); setDeliveries({}); setAccountEmail(email); setAccountReady(true);
  }, []);
  useEffect(() => {
    let disposed = false;
    const check = () => { const generation = ++accountGeneration.current; void api<Account>("/v1/account").then((a) => { if (!disposed && generation === accountGeneration.current) return adoptAccount(a, false, generation); }).catch((e) => {
      if (disposed || generation !== accountGeneration.current) return;
      if (e instanceof ApiError && e.status === 401) void leaveAccount();
      // Keep an offline account cache, but defer private requests until its session is checked.
    }); };
    check();
    const changed = (e: StorageEvent) => { if (e.key === "prl.web.v1.active") { accountGeneration.current++; setAccountReady(false); check(); } };
    // Re-check on focus only while the session is still unsettled (e.g. it started offline).
    const visible = () => { if (!document.hidden && !accountReadyRef.current) check(); };
    window.addEventListener("storage", changed); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; window.removeEventListener("storage", changed); document.removeEventListener("visibilitychange", visible); };
  }, [adoptAccount, leaveAccount]);
  const refresh = useCallback(async () => {
    if (document.hidden) return;
    if (refreshingRef.current) {
      refreshQueued.current = true;
      return;
    }
    refreshingRef.current = true;
    const s = stateRef.current, t = Date.now(), reads = readAt.current;
    // Every read below except /v1/price shares the Worker's limit of 120 a minute per IP, and the
    // Worker caches them for 15 s to 12 h. Asking every 5 s spent the limit for a few monitors, and
    // the income reads, sent last, got 429. Ask again once the server copy can have changed; a
    // target without data, or whose last read failed, is asked on every refresh.
    const due = (at: number | undefined, ms: number) => !at || t - at >= ms;
    const own = ownAddresses(s.monitors), target = JSON.stringify(own.slice().sort());
    await Promise.allSettled([
      due(reads.fx, 600_000) && api<FX>("/v1/fx").then((v) => { reads.fx = Date.now(); setFX(v); }).catch(() => setFX((old) => old ? { ...old, stale: true } : undefined)),
      api<Price>("/v1/price")
        .then((data) => setPrice({ data }))
        .catch(() => setPrice((prev) => ({ ...prev, failed: true }))),
      due(reads.pools, 15_000) && api<Overview>("/v1/pools")
        .then((data) => { reads.pools = Date.now(); setOverview({ data }); })
        .catch(() => setOverview((prev) => ({ ...prev, failed: true }))),
      due(reads.history, 60_000) && api<{ source: string; points: number[][] }>("/v1/price/history")
        .then((data) => { reads.history = Date.now(); setHistory({ data }); })
        .catch(() => setHistory((prev) => ({ ...prev, failed: true }))),
      ...enabledMonitors(s.monitors).filter((m) => { const old = statsRef.current[m.id]; return old?.target !== targetKey(m) || old.failed || due(old.at, 30_000); }).map((m) =>
        api<Stats>("/v1/pool/stats", "POST", {
          pool: m.pool,
          addr: m.addr,
          acct: m.acct,
        })
          .then((data) => { if (enabledMonitors(stateRef.current.monitors).some((x) => x.id === m.id && targetKey(x) === targetKey(m))) setStats((prev) => ({ ...prev, [m.id]: { data, target: targetKey(m), at: Date.now() } })); })
          .catch(() => { if (enabledMonitors(stateRef.current.monitors).some((x) => x.id === m.id && targetKey(x) === targetKey(m))) setStats((prev) => ({ ...prev, [m.id]: { ...(prev[m.id]?.target === targetKey(m) ? prev[m.id] : {}), target: targetKey(m), failed: true } })); }),
      ),
      ...own.filter((addr) => { const old = incomesRef.current[addr]; return old?.target !== target || old.failed || due(old.at, 60_000); }).map((addr) =>
        api<Income>("/v1/address/income", "POST", { addr, own })
          .then((data) => { if (JSON.stringify(ownAddresses(stateRef.current.monitors).sort()) === target) setIncomes((v) => ({ ...v, [addr]: { data, target, at: Date.now() } })); })
          // Keep the last figures; a refused read used to blank the card until the next one succeeded.
          .catch(() => { if (JSON.stringify(ownAddresses(stateRef.current.monitors).sort()) === target) setIncomes((v) => ({ ...v, [addr]: { ...(v[addr]?.target === target ? v[addr] : {}), failed: true, target } })); }),
      ),
    ]);
    refreshingRef.current = false;
    setRefreshEpoch((n) => n + 1);
    if (refreshQueued.current) {
      refreshQueued.current = false;
      void refresh();
    }
  }, []);
  const targets = JSON.stringify([
    alive(state.monitors).map((m) => [m.id, m.pool, m.addr, m.acct, m.paused]),
  ]);
  useEffect(() => {
    // A resumed or retargeted watch must not reuse the previous target's data.
    setStats((old) => Object.fromEntries(Object.entries(old).filter(([id, snap]) =>
      enabledMonitors(stateRef.current.monitors).some((m) => m.id === id && targetKey(m) === snap.target))));
    void refresh();
    const timer = state.autoRefresh !== false ? setInterval(() => void refresh(), 5000) : undefined;
    const visible = () => {
      if (!document.hidden && stateRef.current.autoRefresh !== false) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, targets, state.autoRefresh]);
  useEffect(() => {
    void api<Availability>("/v1/web/status")
      .then(setAvailability)
      .catch(() => {});
    if (!ANDROID && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  const panelRef = useRef(panel); panelRef.current = panel;
  const pageRef = useRef(page); pageRef.current = page;
  const openMonitorRef = useRef(openMonitor); openMonitorRef.current = openMonitor;
  const settingsPageRef = useRef(settingsPage); settingsPageRef.current = settingsPage;
  const meRef = useRef(me); meRef.current = me;
  const infoRef = useRef(androidInfoValue); infoRef.current = androidInfoValue;
  useEffect(() => {
    if (!ANDROID) return;
    void androidInfo().then(setAndroidInfo);
    // The wallet frame's view of the app (android-host.ts). Its address book is the app's
    // `contacts`, so a Pro account syncs it with the iOS app, the website and the extension.
    window.__pearlApp = {
      prefs: () => {
        const s = stateRef.current;
        return { lang: s.lang, secondary: s.secondary === undefined ? "__auto__" : s.secondary, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", palette: s.palette === "mono" ? "mono" : "classic" };
      },
      contacts: () => alive(stateRef.current.contacts || []).map(({ updated: _updated, ...contact }) => contact),
      setContacts: (next) => {
        const contacts = contactsFromWallet(stateRef.current.contacts || [], next, fresh);
        stateRef.current = { ...stateRef.current, contacts };
        setState((s) => ({ ...s, contacts: contactsFromWallet(s.contacts || [], next, fresh) }));
      },
      subscribe: (listener) => { hostListeners.add(listener); return () => { hostListeners.delete(listener); }; },
      openPage: (hash) => { location.hash = hash; },
      visible: () => pageRef.current === "wallet" && !panelRef.current && !document.hidden,
      alerts: () => ({ pro: !!meRef.current?.pro, ready: meRef.current != null, active: stateRef.current.rules.filter((r) => !r.deleted && r.enabled).length }),
      widgetPlaced: () => !!infoRef.current?.widgetPlaced,
      // The account's web 钱包 page and the wallet's wallets, both ways for read-only ones (iOS
      // WebSharedMerge.wallets). `base` (what both sides last agreed) is kept per account on this device.
      syncWallets: (rows) => {
        const s = stateRef.current;
        if (!canSyncRef.current || !s.sync || !s.accountId) return null;
        let saved: { account?: string; items?: Record<string, string> } = {};
        try { saved = JSON.parse(localStorage.getItem("pearlhub.android.walletBase") || "{}"); } catch { /* start over */ }
        const merged = mergeWallets(rows, s.wallets, saved.account === s.accountId ? saved.items || {} : {}, fresh());
        const commit = (skipped: string[] = []) => { try { localStorage.setItem("pearlhub.android.walletBase", JSON.stringify({ account: s.accountId, items: withoutSkipped(merged.base, skipped) })); } catch { /* storage full */ } };
        if (merged.changed) {
          const wallets = merged.rows as typeof s.wallets;
          stateRef.current = { ...stateRef.current, wallets };
          // Merged against this list: if a sync changed it meanwhile, the next round redoes it.
          setState((cur) => cur.wallets === s.wallets ? { ...cur, wallets } : cur);
        }
        // Nothing for the wallet to do: agreed now. Otherwise once the wallet has applied it.
        if (walletChangesEmpty(merged.native)) commit();
        return { changes: merged.native, commit };
      },
      open: (target) => { if (target === "widgets") { setPage("settings"); setPanel("widgets"); } else { setPanel(null); setPage("alerts"); } },
    } satisfies PearlHost;
    setBackHandler(() => {
      if (pageRef.current === "wallet" && !panelRef.current && walletBack(walletFrame)) return true;
      if (panelRef.current) { setPanel(null); return true; }
      if (popBackLayer()) return true;
      if (pageRef.current === "trade" && tradeBack()) return true;
      if (pageRef.current === "settings" && settingsPageRef.current) { setSettingsPage(settingsPageRef.current === "licenses" ? "about" : settingsPageRef.current === "tradeGuide" ? "trade" : null); return true; }
      if (pageRef.current === "workers" && openMonitorRef.current) { setOpenMonitor(null); return true; }
      if (pageRef.current === "alerts") { setPage("settings"); return true; }
      if (pageRef.current !== "wallet") { setPage("wallet"); return true; }
      return false;
    });
    const off = [
      onNative("notification", (data) => {
        const route = String(data.route || "");
        if (route === "pro") { setPanel(null); setPage("settings"); setSettingsPage("pro"); }
        else if ((androidPages as readonly string[]).includes(route)) { setPanel(null); setPage(route as Page); }
      }),
      // A rotated FCM token: register it while notifications are on.
      onNative("pushToken", () => {
        if (!stateRef.current.token) return;
        void sendSettings(stateRef.current).catch(() => {});
      }),
    ];
    const untrack = trackTabBar(document.querySelector(".sidebar nav"));
    return () => { off.forEach((stop) => stop()); setBackHandler(undefined); untrack(); };
  }, []);
  const contactsKey = ANDROID ? JSON.stringify(state.contacts || []) : "";
  const webWalletsKey = ANDROID ? JSON.stringify(state.wallets) + canSync : "";
  const liveRuleCount = ANDROID ? state.rules.filter((r) => !r.deleted && r.enabled).length : 0;
  useEffect(() => { if (ANDROID) hostChanged(); }, [state.lang, state.secondary, contactsKey, webWalletsKey, me?.pro, liveRuleCount, androidInfoValue?.widgetPlaced]);
  // The wallet refreshes when its tab comes back into view, and on returning to the app (a widget may be placed meanwhile).
  useEffect(() => { if (ANDROID && page === "wallet") walletControl(walletFrame)?.refresh?.(); }, [page]);
  useEffect(() => {
    if (!ANDROID) return;
    return onNative("resume", () => {
      // Back in the foreground: fresh figures, as iOS refreshes on becoming active, auto-refresh or not.
      void refresh();
      hostChanged();
      void androidInfo(true).then((info) => { if (info) setAndroidInfo(info); });
      if (pageRef.current === "wallet") walletControl(walletFrame)?.refresh?.();
    });
  }, []);
  useEffect(() => { if (ANDROID && miningPages.includes(page as MiningPage)) setMiningPage(page as MiningPage); }, [page]);
  // Home-screen widgets: what the iOS app writes to its App Group snapshot (WidgetBridge.swift).
  useEffect(() => {
    if (!ANDROID) return;
    const code = secondaryCode(state.secondary, state.lang), currency = currencies.find(([c]) => c === code), rateValue = currency && fx?.rates[currency[0]];
    const running = enabledMonitors(state.monitors);
    publishWidget("app", {
      lang: state.lang, theme: state.theme || "system", palette: state.palette === "mono" ? "mono" : "classic", pro: !!me?.pro,
      price: price.data ? { usd: price.data.usd, change1h: price.data.change1h ?? null, change24h: price.data.change24h ?? null, at: price.data.ts } : null,
      fiat: currency && rateValue ? { code: currency[0], symbol: currency[1], decimals: currency[2], rate: rateValue } : null,
      ...widgetPoolSnapshot(running, stats),
      monitors: running.map((m) => ({ pool: m.pool, addr: m.addr, acct: m.acct ?? null, label: m.label })),
      at: Math.floor(Date.now() / 1000),
    });
  }, [state.lang, state.theme, state.palette, state.secondary, me?.pro, price.data, fx, stats, state.monitors]);
  const loadMe = useCallback(async (accountId: string) => {
    const generation = accountGeneration.current;
    const result = await api<Me>("/v1/me", "GET", undefined, accountId);
    if (generation !== accountGeneration.current || (stateRef.current.accountId||stateRef.current.purchaseId) !== accountId) return result;
    setMe(result);
    setAvailability((previous) => ({ ...previous, ...result }));
    if (result.order) setOrder(result.order);
    return result;
  }, []);
  // The Play build sells Pro through Google Play Billing (android-billing.ts) when its shell has it and
  // the server can check purchases (/v1/web/status `play`). `pro` is false only once this device is
  // known not to be Pro, so the launch-time check of owned purchases waits for /v1/me.
  const playStore = usePlayStore({
    on: accountReady && ANDROID && androidStore() === "play" && androidInfoValue?.billing === true && availability.play === true,
    identity: `${state.accountId}:${accountGeneration.current}`,
    pro: !accountReady ? undefined : me ? me.pro : buyerId(state) ? undefined : false,
    buyer: ensureBuyer, loadMe,
    copy: { unavailable: androidCopy(state.lang).playUnavailable, unverified: androidCopy(state.lang).purchaseUnverified,
      pending: androidCopy(state.lang).purchasePending, nothingToRestore: androidCopy(state.lang).nothingToRestore,
      linkedElsewhere: accountCopy(state.lang).purchaseLinkedElsewhere },
  });
  const reconcileRules = async (token: string) => {
    const result = await api<{
      rules: { id: string; kind: Rule["kind"]; value: number; window: number; enabled: boolean; last_fired: number | null; deferred?: boolean }[];
      watches?: { id: string; missing: boolean; stale: boolean }[];
    }>(`/v1/devices/${token}`, "GET", undefined, buyerId(stateRef.current));
    if (stateRef.current.token !== token) return;
    setWatchStatus(Object.fromEntries((result.watches || []).map((w) => [w.id, { missing: !!w.missing, stale: !!w.stale }])));
    setDeliveries(Object.fromEntries(result.rules.map((r) => [r.id, r])));
    update((s) => ({
      ...s,
      rules: s.rules.map((r) => {
        const remote = result.rules.find((x) => x.id === r.id);
        return reconcileRule(r, remote);
      }),
    }));
  };
  useEffect(() => {
    if (accountReady && buyerId(state))
      void loadMe(buyerId(state)).catch(() =>
        setMessage(dictionaries[stateRef.current.lang].error),
      );
    if (state.token) void reconcileRules(state.token).catch(() => {});
  }, [state.accountId, state.purchaseId, accountReady, loadMe]);
  useEffect(()=>{
    if(!accountReady||!buyerId(state))return;
    const id=buyerId(state),check=()=>{if(!document.hidden)void loadMe(id).catch(()=>{});};
    document.addEventListener("visibilitychange",check);
    const timer=order&&order.status!=="paid"?setInterval(check,15000):undefined;
    return()=>{document.removeEventListener("visibilitychange",check);if(timer)clearInterval(timer);};
  },[state.accountId,state.purchaseId,accountReady,order?.status,loadMe]);
  useEffect(()=>{
    if(!accountReady||state.purchaseId||!localPurchase())return;
    let disposed=false;
    void restorePurchase().then(profile=>{if(profile&&!disposed)update(s=>({...s,purchaseId:profile.purchase_id}));}).catch(()=>{});
    return()=>{disposed=true;};
  },[accountReady,state.purchaseId]);
  useEffect(() => {
    setDeliveries({});
    if (!state.token || !accountReady || !buyerId(state)) return;
    const token = state.token;
    void reconcileRules(token).catch(() => {});
    const timer = setInterval(() => { if (!document.hidden) void reconcileRules(token).catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [state.token, state.accountId, state.purchaseId, accountReady]);
  const sync = useCallback(async () => {
    const s = stateRef.current;
    if (!s.accountId || !canSyncRef.current || syncRef.current) return;
    syncRef.current = true;
    setSyncing(true);
    try {
      const merged = await syncConfig(s, () => stateRef.current);
      if (stateRef.current.accountId === s.accountId && canSyncRef.current) {
        setState((latest) => {
          const config = mergeConfig(configOf(latest), merged);
          return { ...latest, ...config, lang: latest.followBrowserLanguage ? browserLanguage() : config.lang };
        });
        setSyncStatus(dictionaries[stateRef.current.lang].synced);
        setSyncedAt(Math.floor(Date.now() / 1000));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && stateRef.current.accountId === s.accountId) { setMessage(accountCopy(s.lang).expired); void leaveAccount(); }
      else if (e instanceof ApiError && e.message === "sync_requires_pro" && stateRef.current.accountId === s.accountId) {
        setMe((old) => old ? { ...old, pro: false } : old);
        setSyncStatus(dictionaries[s.lang].syncRequiresPro);
      } else setSyncStatus(dictionaries[stateRef.current.lang].error);
    } finally {
      syncRef.current = false;
      setSyncing(false);
    }
  }, []);
  const serialized = JSON.stringify(configOf(state));
  useEffect(() => {
    if (!accountReady || !state.sync || !canSync) return;
    const timer = setTimeout(() => void sync(), 1500);
    return () => clearTimeout(timer);
  }, [serialized, state.sync, state.accountId, accountReady, canSync, sync]);
  useEffect(() => {
    if (!accountReady || !state.sync || !canSync) return;
    void sync();
    const timer = setInterval(() => {
      if (!document.hidden) void sync();
    }, 60000);
    return () => clearInterval(timer);
  }, [state.sync, state.accountId, accountReady, canSync, sync]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = (value: string) =>
    run(async () => {
      await navigator.clipboard.writeText(value);
      setMessage(t("copied"));
    });
  const showPro = () => { if (ANDROID) { setPanel(null); setPage("settings"); setSettingsPage("pro"); } else setPanel("pro"); };
  const buy = () => {
    if (fromApp) return;
    if (!availability.pay.enabled) {
      setMessage(t("paymentsOff"));
      return;
    }
    void run(async () => {
      const accountId = await ensureBuyer();
      const o = await api<Order>("/v1/orders", "POST", undefined, accountId);
      if(buyerId(stateRef.current)!==accountId)return;
      setOrder(o);
      setPanel("payment");
      await loadMe(accountId);
    });
  };
  useEffect(() => {
    if (
      panel !== "payment" ||
      !order ||
      order.status === "paid" ||
      !buyerId(state)
    )
      return;
    const id = order.id,
      code = buyerId(state);
    const timer = setInterval(() => {
      if (!document.hidden)
        void api<Order>(`/v1/orders/${id}`, "GET", undefined, code)
          .then((o) => {
            if (buyerId(stateRef.current) === code) {
              setOrder(o);
              if (o.status === "paid") {
                void (async()=>{if(stateRef.current.accountId)await associatePurchase(stateRef.current.accountId);await loadMe(code);})().catch(()=>setMessage(t("error")));
              }
            }
          })
          .catch(() => setMessage(dictionaries[stateRef.current.lang].stale));
    }, 5000);
    return () => clearInterval(timer);
  }, [panel, order?.id, order?.status, state.accountId, state.purchaseId, loadMe]);
  type PushTarget = { subscription: PushSubscriptionJSON } | { fcm: { token: string } };
  type PushReply = { token: string; rules: (Pick<Rule, "id" | "kind" | "value" | "window" | "enabled" | "repeat"> & { last_fired: number | null })[] };
  if (!pushSettings.current) pushSettings.current = new PushSettings({
    current: () => ({ state: stateRef.current, account: accountGeneration.current, generation: pushGeneration.current }),
    saving: () => setPushState("saving"),
    key: pushTargetKey,
    attempted: (s: State, token: string) => {
      if (s.purchaseId) rememberPurchaseToken(token);
      const next = { ...stateRef.current, token };
      stateRef.current = next;
      update((latest) => ({ ...latest, token }));
      writeStore(next);
    },
    put: (s: State, target: PushTarget) => api<PushReply>("/v1/web/push", "PUT", {
      ...target, lang: s.lang, window: s.window, rules: alive(s.rules),
      watches: alertMonitors(s.monitors).map((m) => ({
        id: m.id, pool: m.pool, addr: m.addr, acct: m.acct, label: m.label, after: m.after, again: m.again || undefined,
      })),
    }, buyerId(s)),
    saved: (s: State, result: PushReply) => {
      if (s.purchaseId) rememberPurchaseToken(result.token);
      setPushState("saved");
      update((latest) => ({ ...latest, token: result.token, rules: latest.rules.map((r) => reconcileRule(r, result.rules.find((x) => x.id === r.id))) }));
    },
    // A temporary transport failure does not remove server watches. Keep their known key
    // so retry/disable can still reach them, and expose the failed connection separately.
    failed: () => setPushState("error"),
    remove: async (s: State) => { if (s.token) await api(`/v1/devices/${s.token}`, "DELETE", {}, buyerId(s)); },
    removed: async () => {
      rememberPurchaseToken("");
      stateRef.current = { ...stateRef.current, token: "" };
      update((s) => ({ ...s, token: "" }));
      setPushState("idle");
      // FCM is shared with the independent live ticker. DELETE above disables ordinary alerts;
      // deleting transport here would also silently stop the ticker's background updates.
      if (!ANDROID) {
        const reg = await pushTimeout(navigator.serviceWorker.ready), sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
    },
  });
  const sendSettings = (s: State, subscription?: PushSubscription) => pushSettings.current!.register(s, async (): Promise<PushTarget> => {
    if (ANDROID) {
      const status = await notificationStatus();
      setPermission(status);
      const token = status === "granted" && buyerId(s) ? await pushTimeout(pushToken()).catch(() => "") : "";
      if (!token) throw new Error("pushConnectError");
      return { fcm: { token } };
    }
    const reg = await pushTimeout(navigator.serviceWorker.ready), sub = subscription || await reg.pushManager.getSubscription();
    if (!sub || !buyerId(s) || Notification.permission !== "granted") throw new Error("pushConnectError");
    return { subscription: sub.toJSON() };
  });
  const pushValues = JSON.stringify([
    state.lang,
    state.window,
    alive(state.rules),
    alertMonitors(state.monitors),
  ]);
  useEffect(() => {
    if (!accountReady || !buyerId(state) || !state.token || !me?.pro || !hasPush()) return;
    const generation = pushGeneration.current;
    const timer = setTimeout(() => {
      if (generation === pushGeneration.current && stateRef.current.token) void sendSettings(stateRef.current)
        .catch(() => setMessage(dictionaries[stateRef.current.lang].error));
    }, 400);
    return () => clearTimeout(timer);
  }, [pushValues, state.token, me?.pro]);
  const enablePush = () => {
    if (!me?.pro) {
      showPro();
      return;
    }
    if (!hasPush() || !pushReady) {
      setMessage(ANDROID ? androidInfoValue?.fcm === false ? a.notifyUnavailable : a.notifyNotReady : t("pushUnavailable"));
      return;
    }
    void run(async () => {
      const generation = pushGeneration.current, account = accountGeneration.current;
      const p = ANDROID ? await requestNotifications() : await Notification.requestPermission();
      if (generation !== pushGeneration.current || account !== accountGeneration.current) return;
      setPermission(p);
      if (p !== "granted") throw new Error("pushPermission");
      await ensureBuyer();
      if (generation !== pushGeneration.current || account !== accountGeneration.current) return;
      setPushState("saving");
      try {
        const sub = ANDROID ? undefined : await pushTimeout(subscribePush(await pushTimeout(navigator.serviceWorker.ready), availability.vapid_key!));
        if (generation !== pushGeneration.current || account !== accountGeneration.current) return;
        const next = {
          ...stateRef.current,
          monitors: stateRef.current.monitors.map((m) =>
            m.id === pendingMonitor ? { ...m, alert: true, updated: Math.max(fresh(), m.updated + 1) } : m),
        };
        if (!await sendSettings(next, sub)) return;
        if (generation !== pushGeneration.current || account !== accountGeneration.current) return;
        if (pendingMonitor) {
          update((s) => ({ ...s, monitors: s.monitors.map((m) => m.id === pendingMonitor && !m.deleted
            ? { ...m, alert: true, updated: Math.max(fresh(), m.updated + 1) } : m) }));
          setPendingMonitor(null);
          setPage("workers");
        }
        setMessage(t("pushConnected"));
      } catch (error) {
        if (generation !== pushGeneration.current || account !== accountGeneration.current) return;
        setPushState("error");
        if (error instanceof ApiError || (error instanceof Error && error.message === "pushTimeout")) throw error;
        throw new Error("pushConnectError");
      }
    });
  };
  const disablePush = () => void run(async () => {
    // Delete server watches first, so a disconnected browser cannot leave active alerts.
    pushGeneration.current++;
    if (await pushSettings.current!.withdraw(stateRef.current)) setMessage(t("pushDisconnected"));
  });
  const remove = (key: "monitors" | "rules" | "wallets", id: string) => {
    if (confirm(t("confirmDelete")))
      update((s) => ({
        ...s,
        [key]: s[key].map((x) =>
          x.id === id ? { ...x, deleted: true, updated: Math.max(fresh(), x.updated + 1) } : x,
        ),
      }));
  };
  const rename = (key: "monitors" | "wallets", id: string, label: string) => {
    const v = prompt(t("rename"), label);
    // null is Cancel. A cleared name is an answer: back to the default, as the add / edit forms do.
    if (v == null) return;
    update((s) => ({
      ...s,
      [key]: s[key].map((x) =>
        x.id === id
          ? { ...x, label: v.trim().slice(0, 40) || ("pool" in x ? x.pool : x.addr.slice(0, 12)), updated: Math.max(fresh(), x.updated + 1) }
          : x,
      ),
    }));
  };
  const gated = (fn: () => void) => {
    if (!me?.pro) showPro();
    else fn();
  };
  const toggleMonitorAlert = (m: Monitor) => {
    if (!m.alert && (!me?.pro || !state.token || permission !== "granted")) {
      setPendingMonitor(m.id);
      if (!me?.pro) showPro();
      else {
        setPage("alerts");
        setMessage(ANDROID ? a.notifyFirst : t("pushSetupMonitor"));
      }
      return;
    }
    gated(() => {
      update((s) => ({
        ...s,
        monitors: s.monitors.map((x) =>
          x.id === m.id ? { ...x, alert: !x.alert, updated: Math.max(fresh(), x.updated + 1) } : x,
        ),
      }));
    });
  };
  /// One monitor's 掉线提醒 settings: `after` and its reminder `again` (seconds).
  const setMonitorAlert = (m: Monitor, patch: Pick<Monitor, "after"> | Pick<Monitor, "again">) =>
    gated(() =>
      update((st) => ({
        ...st,
        monitors: st.monitors.map((x) =>
          x.id === m.id ? { ...x, ...patch, updated: Math.max(fresh(), x.updated + 1) } : x,
        ),
      })),
    );
  /// "10 min", "2 h": whole hours read as hours.
  // Currency names in the app's language, as iOS lists them ("人民币 · CNY").
  const currencyName = (code: string) => { try { return new Intl.DisplayNames([state.lang], { type: "currency" }).of(code) || code; } catch { return code; } };
  const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const duration = (seconds: number) =>
    seconds % 3600 === 0
      ? t("durationHours").replace("%@", String(seconds / 3600))
      : t("durationMinutes").replace("%@", String(seconds / 60));
  const setMonitorPaused = (m: Monitor, paused: boolean) => update((s) => ({
    ...s,
    monitors: s.monitors.map((x) => x.id === m.id ? { ...x, paused, updated: Math.max(fresh(), x.updated + 1) } : x),
  }));
  const stale = (failed?: boolean) =>
    failed ? <span className="status warn">{t("stale")}</span> : null;
  const addButton = (value: Panel, size: number, limit: number) => (
    <button
      className="primary"
      onClick={() => { if (size >= limit) setMessage(t("limit")); else { if (value === "monitor") { setEditingMonitor(null); setDraftAddress(""); } setPanel(value); } }}
    >
      <Icon name="plus" />{t("add")}
    </button>
  );
  const selected = (state.hashWindow as WindowName) || "day";
  const activeMonitors = orderedMonitors(configOf(state)),
    activeRules = alive(state.rules);
  const showsAlertHint = ANDROID && activeMonitors.length > 0 && !alertHintDismissed && !activeMonitors.some((m) => m.alert);
  const showsWebHint = ANDROID && activeMonitors.length > 0 && !webHintDismissed && !showsAlertHint && !alertHintSeen;
  useEffect(() => { if (showsAlertHint && page === "workers") setAlertHintSeen(true); }, [showsAlertHint, page]);
  /// 卡片 or 一览 (MonitorCompact.tsx), this browser's choice.
  const layout = monitorLayout(state.monitorLayout);
  const openedMonitor = openMonitor ? activeMonitors.find((m) => m.id === openMonitor) : undefined;
  const editMonitor = (m: Monitor) => { setEditingMonitor(m); setDraftAddress(m.pool === "F2Pool" ? `https://www.f2pool.com/mining-user/${m.addr}?user_name=${encodeURIComponent(m.acct || "")}` : m.addr); setPanel("monitor"); };
  // The opened monitor was deleted (here, or on another device): back to the list.
  useEffect(() => { if (openMonitor && !openedMonitor) setOpenMonitor(null); }, [openMonitor, !!openedMonitor]);
  const onlineOnlySwitch = <label className="compact-check"><input type="checkbox" className="switch" checked={state.onlineOnly === true} onChange={(e) => update((s) => ({ ...s, onlineOnly: e.target.checked }))} />{t("onlineOnly")}</label>;
  const moveMonitor = (id: string, destination: number) => {
    const oldIds = activeMonitors.map((m) => m.id), ids = moveIds(oldIds, id, destination);
    if (ids === oldIds) return;
    update((s) => ({ ...s, monitorOrder: { ids, updated: Math.max(fresh(), (s.monitorOrder?.updated || 0) + 1) } }));
  };
  const incomeTarget = JSON.stringify(ownAddresses(state.monitors).sort());
  // A failed read keeps showing the last figures, marked as possibly out of date.
  const incomeFor = (addr: string) => incomes[addr]?.target === incomeTarget ? incomes[addr]?.data : undefined;
  const incomeStale = (addr: string) => !!incomeFor(addr) && !!incomes[addr]?.failed;
  // Addresses the user already follows, by name, so a looked-up transaction lists them first.
  const knownAddresses = new Map([...alive(state.monitors).filter((m) => m.addr.startsWith("prl1")).map((m) => [m.addr, m.label] as const), ...alive(state.wallets).map((w) => [w.addr, w.label] as const)]);
  const addressHash = (addr: string) => enabledMonitors(state.monitors).filter((m) => m.addr === addr && stats[m.id]?.target === targetKey(m)).reduce((n, m) => n + hashrate24h(stats[m.id]?.data), 0);
  const fleetSnapshots = enabledMonitors(state.monitors).map((m) => stats[m.id]?.target === targetKey(m) ? stats[m.id] : undefined);
  const fleetStats = fleetSnapshots.flatMap((snap) => snap?.data && !snap.data.missing ? [snap.data] : []);
  const incomeAddresses = ownAddresses(state.monitors), fleetIncomes = incomeAddresses.flatMap((addr) => incomeFor(addr) ? [incomeFor(addr)!] : []);
  const fleetHash = fleetStats.reduce((n, s) => n + rate(s, nearestWindow(selected, s.windows)), 0);
  const fleetOnline = fleetStats.reduce((n, s) => n + s.workers.filter((w) => w.online).length, 0), fleetTotal = fleetStats.reduce((n, s) => n + s.workers.length, 0);
  const reviewAsked = useRef(false);
  useEffect(() => {
    if (!ANDROID || reviewAsked.current || page !== "workers" || fleetTotal === 0) return;
    reviewAsked.current = true;
    requestReview();
  }, [page, fleetTotal]);
  const summaryWaiting = fleetSnapshots.some((s) => !s?.data && !s?.failed) || incomeAddresses.some((a) => !incomes[a] || incomes[a].target !== incomeTarget);
  /// One monitor's full card: in the card grid, and on its own when opened from 一览.
  const monitorCard = (m: Monitor) => {
    const snap = stats[m.id]?.target === targetKey(m) ? stats[m.id] : undefined,
      s = snap?.data,
      w = nearestWindow(selected, s?.windows);
    return (
      <section className="card monitor-card" key={m.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", m.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveMonitor(e.dataTransfer.getData("text/plain"), activeMonitors.findIndex((x) => x.id === m.id)); }}>
        <div className="card-heading">
          <div className="card-name">
            <div className="monitor-title"><h2>{m.label}</h2><small>{m.pool}</small>{ANDROID && <code className="monitor-addr" title={m.addr}>{m.addr.length > 20 ? `${m.addr.slice(0, 10)}…${m.addr.slice(-8)}` : m.addr}</code>}{m.paused ? <span className="badge">{t("paused")}</span> : s && !s.missing && <span className={`badge ${s.workers.some((x) => !x.online) ? "offline-badge" : "online-badge"}`}>{s.workers.some((x) => !x.online) ? t("offlineCount").replace("%@", String(s.workers.filter((x) => !x.online).length)) : t("online")}</span>}</div>
          </div>
          <div className="inline-controls"><div className="alert-controls">
            {(pushReady || ANDROID) && !m.paused && (
              <>
                <label
                  className="compact-check"
                  title={t("offlineAlert")}
                >
                  <input
                    type="checkbox" className="switch"
                    checked={m.alert}
                    onChange={() => toggleMonitorAlert(m)}
                  />
                  {t("offlineAlert")}
                </label>
                {m.alert && (
                  <>
                    <select
                      aria-label={t("minutes")}
                      value={m.after}
                      onChange={(e) => setMonitorAlert(m, { after: Number(e.target.value) })}
                    >
                      {ALERT_AFTER.map((n) => (
                        <option key={n} value={n}>
                          {duration(n)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("remindAgain")}
                      title={t("remindAgain")}
                      value={m.again || 0}
                      onChange={(e) => setMonitorAlert(m, { again: Number(e.target.value) || undefined })}
                    >
                      <option value={0}>{t("remindOnce")}</option>
                      {ALERT_AGAIN.map((n) => (
                        <option key={n} value={n}>
                          {t("remindAfter").replace("%@", duration(n))}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </>
            )}
            </div><details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div>
              <button onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setMonitorPaused(m, !m.paused); }}><Icon name={m.paused ? "play" : "pause"} />{t(m.paused ? "resume" : "pause")}</button>
              <button onClick={() => editMonitor(m)}><Icon name="edit" />{t("edit")}</button>
              <button onClick={() => rename("monitors", m.id, m.label)}><Icon name="rename" />{t("rename")}</button>
              <button disabled={activeMonitors[0].id === m.id} onClick={() => moveMonitor(m.id, activeMonitors.findIndex((x) => x.id === m.id) - 1)}><Icon name="up" />{t("moveUp")}</button>
              <button disabled={activeMonitors.at(-1)!.id === m.id} onClick={() => moveMonitor(m.id, activeMonitors.findIndex((x) => x.id === m.id) + 1)}><Icon name="down" />{t("moveDown")}</button>
              <button className="danger" onClick={() => remove("monitors", m.id)}><Icon name="delete" />{t("delete")}</button>
            </div></details>
          </div>
        </div>
        {!m.paused && stale(snap?.failed || (m.pool !== "F2Pool" && incomeStale(m.addr)))}
        {!m.paused && m.alert && (pushState === "error" || !state.token) && <button className="status warn status-link" onClick={() => setPage("alerts")}><span>{t("pushNeedsConnection")}</span><Icon name="right" /></button>}
        {m.paused ? <div className="monitor-paused"><button onClick={() => setMonitorPaused(m, false)}>{t("resume")}</button></div> : <>
          {!s ? (
            snap?.failed ? <p className="muted">{t("error")}</p> : <Skeleton label={t("loading")} />
          ) : s.missing ? (
            <p className="muted">{t("missing")}</p>
          ) : (
            <div className="monitor-stats">
              <div className="rate-value">
                {hashrate(rate(s, w), state.lang)}
              </div>
              {ANDROID && (() => { const ref = w === "day" ? s.windows.find((x) => x !== "day") : s.windows.includes("day") ? "day" : undefined; return ref ? <div className="rate-ref"><small>{t(ref)}</small><b>{hashrate(rate(s, ref), state.lang)}</b></div> : null; })()}
              <div className="segments">
                {s.windows.map((win) => (
                  <button
                    key={win}
                    className={win === w ? "selected" : ""}
                    onClick={() =>
                      update((old) => ({ ...old, hashWindow: win }))
                    }
                  >
                    {t(win)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Pool balances and on-chain income share one grid, so every tile lines up. */}
          {(s && !s.missing || m.pool !== "F2Pool") && <div className="monitor-earnings"><div className="earnings-grid">
            {s && !s.missing && <div className="earnings-group">
              <h3>{t("pool")}</h3>
              <div className="earning"><small>{t(s.pendingKind)}</small><strong><PRLAmount lang={state.lang} value={s.pending} /></strong><small><Money amount={price.data ? money(s.pending * price.data.usd) : "—"} /></small></div>
              <div className="earning"><small>{t("paid")}</small><strong><PRLAmount lang={state.lang} value={s.paid} /></strong><small><Money amount={price.data ? money(s.paid * price.data.usd) : "—"} /></small></div>
            </div>}
            {m.pool !== "F2Pool" && <div className="earnings-group earnings-chain"><h3>{t("chainIncome")}</h3>{!incomeFor(m.addr) && (!incomes[m.addr] || incomes[m.addr]?.target !== incomeTarget) ? <Skeleton label={t("loading")} /> : <>{(["h24", "d7", "total"] as const).map((key) => <div className="earning" key={key}><small>{key === "h24" ? t("recent24h") : key === "d7" ? t("recent7d") : t("totalIncome")}</small><strong><PRLAmount lang={state.lang} value={incomeFor(m.addr)?.[key]} /></strong><small><Money amount={incomeFor(m.addr) && price.data ? money(incomeFor(m.addr)![key] * price.data.usd) : "—"} /></small></div>)}<div className="earning"><small>{t("tested")} · {t("perPHDay")}</small><strong><PRLAmount lang={state.lang} value={incomeFor(m.addr) && addressHash(m.addr) > 0 ? dailyAverage(incomeFor(m.addr)!.h24, incomeFor(m.addr)!.d7) / (addressHash(m.addr) / 1e15) : null} /></strong></div></>}</div>}
          </div></div>}
          {s && !s.missing && <>
            <div className="monitor-section-head"><h3>{t("workers")}</h3><span>{s.workers.filter((x) => x.online).length} / {s.workers.length} {t("online")}</span></div>
            <WorkerList workers={s.workers} window={w} lang={state.lang} t={t} onlineOnly={state.onlineOnly === true} />
            {s.partial && <p className="muted">{t("partial")}</p>}
          </>}
        </>}
      </section>
    );
  };
  const restoreLink = <a className="pro-restore" href="/?account=restore#alerts" onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); setPanel("restore"); } }}>{t("restorePurchase")}</a>;
  const pendingOrderLink = order && order.status !== "paid" && <button onClick={() => setPanel("payment")}>{t("order")} · {order.id.slice(0, 8)}</button>;
  const generalSettings = <div className="setting-section appearance-settings">
    <label className="form-field">
      {t("language")}
      <select
        aria-label={t("language")}
        value={state.followBrowserLanguage ? "system" : state.lang}
        onChange={(e) => {
          const value = e.target.value;
          update((s) => ({
            ...s,
            lang: value === "system" ? browserLanguage() : value as Lang,
            followBrowserLanguage: value === "system",
            settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1),
          }));
        }}
      >
        <option value="system">{t(ANDROID ? "systemTheme" : "browserLanguage")}</option>
        {langs.map((l) => (
          <option key={l} value={l}>
            {languageNames[l]}
          </option>
        ))}
      </select>
    </label>
    <label className="form-field">{t("secondaryCurrency")}<select aria-label={t("secondaryCurrency")} value={state.secondary || (state.secondary === "" ? "" : "__auto__")} onChange={(e) => update((s) => ({ ...s, secondary: e.target.value, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))}><option value="__auto__">{t("followLanguage")}</option><option value="">{t("hideCurrency")}</option>{currencies.map(([code, symbol]) => <option key={code} value={code}>{ANDROID ? `${currencyName(code)} · ${code}` : `${code} · ${symbol}`}</option>)}</select></label>
    {ANDROID && <p className="muted currency-rate">{a.primaryCurrency} · {currencyName("USD")} · USD{(state.secondary === undefined || state.secondary === "__auto__") && secondaryCode(state.secondary, state.lang) && <><br />{a.currentSecondary} · {currencyName(secondaryCode(state.secondary, state.lang)!)} · {secondaryCode(state.secondary, state.lang)}</>}</p>}
    {secondaryCode(state.secondary, state.lang) && <p className="muted currency-rate">{fx?.rates[secondaryCode(state.secondary, state.lang)] ? rateLine(secondaryCode(state.secondary, state.lang), fx.rates[secondaryCode(state.secondary, state.lang)], state.lang) : "—"}{ANDROID && <> <InfoTip label={t("moreInfo")} text={a.ratesNote} /></>}<br />{t("updated")} · {fx ? new Date(fx.ts * 1000).toLocaleString(state.lang) : "—"}{fx?.stale && <> · {t("stale")}</>}</p>}
    {ANDROID && <button type="button" disabled={ratesBusy} onClick={() => { setRatesBusy(true); void api<FX>("/v1/fx").then(setFX, () => setFX((old) => old ? { ...old, stale: true } : old)).finally(() => setRatesBusy(false)); }}>{a.refreshRates}</button>}
    <label className="settings-toggle"><span>{t("autoRefresh")}</span><input type="checkbox" className="switch" checked={state.autoRefresh !== false} onChange={(e) => update((s) => ({ ...s, autoRefresh: e.target.checked, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))} /></label>
  </div>;
  const pushStatusText =
    pushState === "saving" ? t("pushSaving") :
    pushState === "error" ? t("pushSaveError") :
    state.token && permission === "granted" ? t("pushConnected") :
    permission === "granted" ? t(ANDROID ? "pushDisconnected" : "pushGranted") :
    permission === "denied" ? ANDROID ? a.notifyDenied : t("pushDenied") :
    permission === "unavailable" ? ANDROID ? a.notifyUnavailable : t("pushUnavailable") :
    t("pushDefault");
  // Android mirrors the iOS tab bar: 钱包 / 交易 / 挖矿监控 / 我的监控 / 设置.
  const androidTabs: { tab: AndroidTab; icon: "wallet" | "trade" | "pools" | "workers" | "settings"; label: string; page: Page }[] = [
    { tab: "wallet", icon: "wallet", label: a.tabWallet, page: "wallet" },
    { tab: "trade", icon: "trade", label: a.tabTrade, page: "trade" },
    { tab: "mining", icon: "pools", label: a.tabMining, page: miningPage },
    { tab: "workers", icon: "workers", label: a.tabMonitor, page: "workers" },
    { tab: "settings", icon: "settings", label: a.tabSettings, page: "settings" },
  ];
  const proOffer = <div className="pro-intro">
    {!fromApp && <div className="pro-price"><strong><Money amount={money(availability.pay.usd)} block /></strong><span>{t("payWithPRL")}</span></div>}
    <p>{t("proCopy")}</p>
    <ul className="pro-features"><li><Icon name="market" />{t("priceAlerts")}</li><li><Icon name="workers" />{t("offlineAlert")}</li><li><Icon name="alerts" />{t("pushWindow")}</li><li><Icon name="refresh" />{t("dataSync")}</li></ul>
    <p className="muted">{t("proSyncNote")}</p>
    {!fromApp && <button className="primary" disabled={busy || !accountReady || !availability.pay.enabled} onClick={buy}>{t("buy")}</button>}
    {restoreLink}
    {!fromApp && <>
      {!availability.pay.enabled && <p className="muted">{t("paymentsOff")}</p>}
      {!state.accountId && <p className="muted guest-purchase-note">{accountCopy(state.lang).guestPurchaseNote}</p>}
      {pendingOrderLink}
      <p className="muted">{t("appPurchaseLink")}</p>
    </>}
  </div>;
  return (
    <div className={ANDROID ? "app android-app" : "app"}>
      <aside className="sidebar">
        {!ANDROID && <a className="brand" href="/" aria-label="Pearl Hub">
          <img src="/icon-192.png?v=pearl-light" alt="" width="44" height="44" />
          <span className="brand-copy">
            <span className="brand-name">Pearl Hub</span>
            <small className="brand-meta"><span>PRL</span><span className="brand-dot" aria-hidden="true" /><span className="brand-platform">WEB</span></small>
          </span>
        </a>}
        <nav>
          {ANDROID ? androidTabs.map((item) => (
            <button key={item.tab} className={tabOf(page) === item.tab ? "nav-item active" : "nav-item"} aria-label={item.label} title={item.label} aria-current={tabOf(page) === item.tab ? "page" : undefined} onClick={() => setPage(item.page)}>
              <span className="nav-icon"><TabIcon name={item.icon} /></span>
              <span className="nav-label" aria-hidden="true"><span className="nav-label-full">{item.label}</span><span className="nav-label-short">{item.label}</span></span>
            </button>
          )) : (
            [
              "market",
              "workers",
              "pools",
              "calculator",
              "wallet",
              "alerts",
              "app",
            ] as Exclude<Page, "settings" | "trade">[]
          ).map((p) => (
            <button
              key={p}
              className={page === p ? "nav-item active" : "nav-item"}
              aria-label={t(p)}
              title={t(p)}
              onClick={() => setPage(p)}
            >
              <span className="nav-icon">
                <Icon name={p} />
              </span>
              <span className="nav-label" aria-hidden="true">
                <span className="nav-label-full">{t(p)}</span>
                <span className="nav-label-short">{t(navShortKeys[p])}</span>
              </span>
              {p === "alerts" && <small>PRO</small>}
            </button>
          ))}
        </nav>
        {!ANDROID && <div className="sidebar-foot">
          <div className="sidebar-actions">
            <button className="settings-button" aria-label={t("settings")} title={t("settings")} onClick={() => setPanel("settings")}><Icon name="settings" /></button>
            <button className={`account-entry ${accountReady && state.accountId ? "" : "primary"}`} onClick={() => setPanel("account")} title={accountReady && state.accountId ? accountEmail || undefined : undefined} aria-label={accountReady && state.accountId ? accountEmail ? `${accountCopy(state.lang).account}: ${accountEmail}` : accountCopy(state.lang).account : t("signIn")} aria-haspopup="dialog">
              <Icon name="account" /><span className={accountReady && state.accountId && accountEmail ? "account-entry-name" : undefined}>{accountReady && state.accountId ? accountEmail.split("@")[0] || accountCopy(state.lang).account : t("signIn")}</span>
            </button>
          </div>
        </div>}
      </aside>
      {ANDROID && <WalletFrame frame={walletFrame} visible={page === "wallet"} title={a.tabWallet} />}
      <main className={page === "pools" ? "pool-page" : page === "wallet" || page === "alerts" || page === "app" || page === "settings" ? "narrow-page" : undefined} hidden={ANDROID && page === "wallet"} data-subpage={ANDROID && page === "settings" && settingsPage ? "" : undefined}>
        {ANDROID && miningPages.includes(page as MiningPage) && <div className="android-segments" role="tablist" aria-label={a.tabMining}>
          {miningPages.map((p) => <button key={p} role="tab" aria-selected={page === p} onClick={() => setPage(p)}>{p === "market" ? a.overview : p === "pools" ? a.pool : t("calculator")}</button>)}
        </div>}
        {ANDROID && page === "alerts" && <button className="android-back" onClick={() => setPage("settings")}><Icon name="chevron" />{a.tabSettings}</button>}
        {!(ANDROID && page === "trade") && <div className="page-toolbar">
        <header className="page-heading">
          <div>
            <div className="page-title"><h1 className={ANDROID && (page === "pools" || page === "calculator") ? "sr-only" : undefined}>{ANDROID && page === "workers" ? a.myMonitors : t(page === "pools" ? "poolOverview" : page as Exclude<Page, "trade">)}</h1>{ANDROID && miningPages.includes(page as MiningPage) && <InfoTip label={t("moreInfo")} text={a.notMining} />}{ANDROID && ["market", "pools", "calculator", "workers"].includes(page) && <button className="icon-button android-refresh" aria-label={a.refresh} title={a.refresh} disabled={manualRefresh} onClick={() => { setManualRefresh(true); void refresh().finally(() => setManualRefresh(false)); }}><Icon name="refresh" className={manualRefresh ? "spin" : undefined} /></button>}{page === "alerts" && me?.pro && <span className="badge" title={t("proActive")}><Icon name="check" />PRO · {me.pro_src === "apple" ? t("appleSource") : me.pro_src || "PRO"}</span>}{page === "wallet" && !ANDROID && <InfoTip label={t("moreInfo")} text={t("walletNote")} />}</div>
            {/* No subtitle under the title (iOS 6a1e720): the page's own layout and controls say what it is. */}
            {page === "wallet" && !ANDROID && state.hideExtensionBanner === true && <p><button className="text-button extension-banner-show" onClick={() => update((s) => ({ ...s, hideExtensionBanner: false }))}>Pearl Hub Wallet</button></p>}
          </div>
        </header>
        {!ANDROID && <div className="global-actions">
          <AppearanceMenu state={state} t={t} onChange={(appearance) => update((s) => ({ ...s, ...appearance, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))} />
        </div>}
        </div>}
        {ANDROID && page === "trade" && TradeTab && <Suspense fallback={<Skeleton label={t("loading")} kind="chart" />}>
          <TradeTab lang={state.lang} t={t} pro={!!me?.pro} live={live} wallet={walletOf} visible={page === "trade" && !panel} alertsActive={liveRuleCount}
            contacts={alive(state.contacts || []).map((c) => ({ name: c.name, address: c.address }))}
            addContact={(name, address) => update((s) => ({ ...s, contacts: [...(s.contacts || []), { id: uid(), updated: fresh(), name, address, note: "" }] }))}
            onPro={showPro} onAlerts={() => { setPanel(null); setPage("alerts"); }} onWallet={() => { setPanel(null); setPage("wallet"); }} />
        </Suspense>}
        {page === "app" && (
          <section className="app-download" aria-labelledby="app-download-title">
            <div className="app-download-main">
              <img className="app-download-logo" src="/icon-192.png?v=pearl-light" alt="" width="88" height="88" />
              <h2 id="app-download-title">Pearl Hub</h2>
              <p className="app-download-note">{t("appDownloadDescription")}</p>
              <div className="app-download-actions">
                <a className="primary app-download-button" href={appStoreURL} target="_blank" rel="noreferrer"><Icon name="app" />{t("iosDownload")}</a>
                <a className="primary app-download-button" href={macStoreURL} target="_blank" rel="noreferrer"><Icon name="mac" />{t("macDownload")}</a>
                <a className="primary app-download-button" href={playStoreURL} target="_blank" rel="noreferrer"><Icon name="android" />{t("androidDownload")}</a>
              </div>
            </div>
            <div className="app-download-qr">
              <QR value={downloadLink} cell={4} margin={16} />
              <p>{t("appScanDownload")}</p>
            </div>
            <button className="app-qr-button" aria-label={t("appShowQR")} title={t("appShowQR")} aria-haspopup="dialog" onClick={() => setPanel("appqr")}><Icon name="qr" /></button>
          </section>
        )}
        {page === "market" && (
          <>
            {!androidBannerHidden && (
              <section className="card market-banner" aria-labelledby="market-banner-title">
                <img src="/icon-192.png?v=pearl-light" alt="" width="48" height="48" />
                <h2 id="market-banner-title">{t("androidBannerTitle")}</h2>
                <a className="primary market-banner-action" href={playStoreURL} target="_blank" rel="noreferrer"><Icon name="android" />{t("androidBannerAction")}</a>
                <button className="icon-button market-banner-close" onClick={hideAndroidBanner} aria-label={t("close")} title={t("close")}><Icon name="close" /></button>
              </section>
            )}
            <MarketData price={price.data} overview={overview.data} history={history.data} failed={price.failed || overview.failed || history.failed} t={t} lang={state.lang} money={money} refresh={refreshEpoch} live={state.autoRefresh !== false} />
            {ANDROID && <FleetCalculator only="overview" onOpenDevices={() => setPage("calculator")} state={state} onState={update} data={overview.data} price={price.data} fx={fx}
              incomes={Object.fromEntries(ownAddresses(state.monitors).map((addr) => [addr, incomeFor(addr)]))}
              failed={price.failed || overview.failed} t={t} />}
            <div className="summary-grid">
              <button
                className="card shortcut"
                onClick={() => setPage("workers")}
              >
                <span className="shortcut-icon purple"><Icon name="workers" /></span>
                <span>
                  {t("workers")}
                  <small>{t("monitors")} {activeMonitors.length} / 20</small>
                </span>
                <Icon name="right" />
              </button>
              <button
                className="card shortcut"
                onClick={() => setPage("wallet")}
              >
                <span className="shortcut-icon cyan"><Icon name="wallet" /></span>
                <span>
                  {t("wallet")}
                  <small>
                    {ANDROID ? `${a.receive} · ${a.send}` : t("extensionShortcut")}
                  </small>
                </span>
                <Icon name="right" />
              </button>
              <button
                className="card shortcut"
                onClick={() => { setTxTab("lookup"); setPanel("txlookup"); }}
              >
                <span className="shortcut-icon"><Icon name="search" /></span>
                <span>
                  {t("txLookup")}
                  <small>{t("txLookupNote")}</small>
                </span>
                <Icon name="right" />
              </button>
            </div>
          </>
        )}
        {page === "pools" && (<>
          <PoolComparison
            lang={state.lang}
            data={overview.data}
            failed={overview.failed}
            onRetry={() => void refresh()}
            t={t}
            onUse={(r) => {
              update((s) => ({
                ...s,
                calculator: calculatorWithPoolFee(s.calculator, r.fee, r.devFee),
                settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1),
              }));
              setPage("calculator");
            }}
          />
          <details className="card pool-share-reference"><summary>{t("poolHashShare")}</summary><PoolDonut data={overview.data} lang={state.lang} t={t} /></details>
        </>)}
        {page === "calculator" && (
          <FleetCalculator state={state} onState={update} data={overview.data} price={price.data} fx={fx}
            incomes={Object.fromEntries(ownAddresses(state.monitors).map((addr) => [addr, incomeFor(addr)]))}
            failed={price.failed || overview.failed} t={t} />
        )}
        {page === "workers" && openedMonitor && <>
          <div className="list-toolbar monitor-open-toolbar">
            <button className="monitor-back" onClick={() => setOpenMonitor(null)}><Icon name="chevron" />{t("workers")}</button>
            {onlineOnlySwitch}
          </div>
          <div className="monitor-opened">{monitorCard(openedMonitor)}</div>
        </>}
        {page === "workers" && !openedMonitor && (
          <>
            <div className="list-toolbar workers-toolbar">
              <span>{t("monitors")} {activeMonitors.length} / 20</span>
              {/* 一览 lists no workers, so "online only" has nothing to filter there. */}
              {layout === "cards" && onlineOnlySwitch}
              {activeMonitors.length > 0 && <LayoutSwitch layout={layout} onChange={(v) => update((s) => ({ ...s, monitorLayout: v }))} t={t} />}
              {addButton("monitor", activeMonitors.length, 20)}
            </div>
            {layout === "cards" && enabledMonitors(state.monitors).length > 0 && <section className="card monitor-summary" aria-label={t("overview")}>{summaryWaiting ? <Skeleton label={t("loading")} /> : <div className="fleet-strip">
              <div><small>{t("fleetHash")} · {t(selected)}</small><strong>{fleetStats.length ? hashrate(fleetHash, state.lang) : "—"}</strong></div>
              <div><small>{t("onlineWorkers")}</small><strong>{fleetStats.length ? `${fleetOnline.toLocaleString(state.lang)} / ${fleetTotal.toLocaleString(state.lang)}` : "—"}</strong></div>
              <div><small>{t("recent24h")}</small><strong><PRLAmount lang={state.lang} value={fleetIncomes.length ? fleetIncomes.reduce((n, i) => n + i.h24, 0) : null} /></strong></div>
              <div><small>{t("recent7d")}</small><strong><PRLAmount lang={state.lang} value={fleetIncomes.length ? fleetIncomes.reduce((n, i) => n + i.d7, 0) : null} /></strong></div>
            </div>}{(fleetSnapshots.some((s) => s?.failed || s?.data?.partial) || fleetIncomes.length < incomeAddresses.length || incomeAddresses.some(incomeStale)) && !summaryWaiting && <p className="status warn">{t("partial")}</p>}</section>}
            {showsAlertHint && <div className="card android-hint">
              <button className="android-hint-body" onClick={() => { dismissAlertHint(); setPage("settings"); setSettingsPage("offline"); }}>
                <span className="android-row-icon"><Icon name="alerts" /></span>
                <span><strong>{a.offlineHint}{!me?.pro && <span className="badge">{a.premium}</span>}</strong></span>
              </button>
              <button className="android-hint-close" aria-label={a.close} onClick={dismissAlertHint}><Icon name="close" /></button>
            </div>}
            {/* Name + address: the card is the way to 设置 → 网页版, nothing to read. */}
            {showsWebHint && <div className="card android-hint android-web-hint">
              <button className="android-hint-body" onClick={() => { dismissWebHint(); setPage("settings"); setSettingsPage("web"); }}>
                <span className="android-row-icon"><Icon name="mac" /></span>
                <span><strong>{a.webVersion}</strong><code>pearlhub.net</code></span>
                <Icon name="chevron" className="android-row-chevron" />
              </button>
              <button className="android-hint-close" aria-label={a.close} onClick={dismissWebHint}><Icon name="close" /></button>
            </div>}
            {!activeMonitors.length && (ANDROID
              ? <section className="empty android-monitor-empty"><Icon name="workers" /><h2>{a.addMonitorTitle}</h2><button className="primary" onClick={() => setPanel("monitor")}><Icon name="plus" />{t("add")}</button><small>{a.notMining}</small></section>
              : <Empty
                symbol="workers"
                text={t("noMonitors")}
                onClick={() => setPanel("monitor")}
                button={t("add")}
              />
            )}
            {layout === "compact" && activeMonitors.length > 0 && <MonitorCompactList monitors={activeMonitors} selected={selected} lang={state.lang} t={t}
              snapshot={(m) => stats[m.id]?.target === targetKey(m) ? stats[m.id] : undefined}
              h24={(addr) => incomeFor(addr)?.h24 ?? (incomes[addr]?.target === incomeTarget && incomes[addr]?.failed ? null : undefined)}
              usd={price.data?.usd} money={money}
              onOpen={(m) => { listScroll.current = window.scrollY; setOpenMonitor(m.id); }}
              onPause={setMonitorPaused} onEdit={editMonitor} onDelete={(m) => remove("monitors", m.id)} onMove={moveMonitor} />}
            {layout === "cards" && activeMonitors.length > 0 && <div className="monitor-grid">{activeMonitors.map(monitorCard)}</div>}
          </>
        )}
        {page === "wallet" && !ANDROID && <>
          {state.hideExtensionBanner !== true && <ExtensionBanner t={t} onGuide={() => setPanel("extension")} onHide={() => update((s) => ({ ...s, hideExtensionBanner: true }))} />}
          <WatchWallet lang={state.lang} wallets={alive(state.wallets)} selected={walletId} onSelect={setWalletId} price={price.data} refresh={refreshEpoch} t={t} money={money} onCopy={copy}
            onAdd={() => { setDraftAddress(""); setPanel("wallet"); }} onReceive={(w) => { setQrWallet(w); setPanel("walletqr"); }} onSend={() => setPanel("extension")}
            onLookup={() => { setTxTab("lookup"); setPanel("txlookup"); }} onRename={(w) => rename("wallets", w.id, w.label)} onRemove={(w) => remove("wallets", w.id)} />
        </>}
        {page === "alerts" && (
          <>
            {ANDROID && <section className="card android-ref-price">
              {/* The Worker prices off SafeTrade and only falls back to the three-exchange median while that is down. */}
              <span className="label-tip"><small>{a.refPrice}</small><InfoTip label={a.refPrice} text={price.data?.source === "median" ? a.sourceMedian : a.sourceSafeTrade} /></span>
              <strong>{price.data ? `$${price.data.usd.toFixed(2)}` : "—"}</strong>
              <div className="android-ref-changes">{([[a.min5, price.data?.change5m], [a.hour1, price.data?.change1h], [a.hour24, price.data?.change24h]] as [string, number | null | undefined][]).map(([label, pct]) =>
                <div key={label}><small>{label}</small><b className={pct == null ? undefined : pct >= 0 ? "up" : "down"}>{pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}</b></div>)}</div>
            </section>}
            {me?.pro&&me.pro_scope==="device"&&<section className="card"><p role="status">{accountCopy(state.lang).guestPro}</p>{!state.accountId&&<button onClick={()=>setPanel("account")}>{accountCopy(state.lang).savePurchase}</button>}</section>}
            {!me?.pro && <section className="card pro-preview">
              <img className="pro-preview-logo" src="/icon-192.png?v=pearl-light" alt="" width="40" height="40" />
              <div className="pro-preview-copy">
                <h2>{t("pro")}</h2>
                <p>{t("priceAlerts")} · {t("offlineAlert")} · {t("dataSync")}</p>
              </div>
              <div className="pro-preview-actions">
                {!fromApp && <strong className="pro-preview-price"><Money amount={money(availability.pay.usd)} block /></strong>}
                <button className="primary" onClick={showPro}>{t("learnMore")}<Icon name="right" /></button>
              </div>
            </section>}
            {!pushReady ? (
              <Empty symbol="alerts" text={ANDROID ? androidInfoValue?.fcm === false ? a.notifyUnavailable : a.notifyNotReady : t("pushOff")} />
            ) : (
              <>
                {me?.pro && state.token && permission === "granted" && pushState !== "error" ? <section className="card notification-status"><span role="status"><Icon name="check" />{t(pushState === "saving" ? "pushSaving" : "notificationOn")}</span><div className="actions"><button disabled={busy} onClick={() => void run(async () => { await api(`/v1/devices/${state.token}/test`, "POST"); setMessage(t("testSent")); })}>{t("testPush")}</button><button onClick={disablePush} disabled={busy}>{t("disablePush")}</button></div></section> : (
                <section className="card">
                  <div className="card-heading">
                    <span className="label-tip"><h2>{ANDROID ? a.notificationSettings : t("notifications")}</h2>{!ANDROID && <InfoTip label={t("pushHelp")} text={t("pushLimits")} />}</span>
                    <span className="badge">PRO</span>
                  </div>
                  <p role="status">{pushStatusText}</p>
                  {ANDROID && permission === "denied" && <button onClick={openNotificationSettings}>{a.openSettings}</button>}
                  <div className="actions">
                    <button
                      className="primary"
                      onClick={enablePush}
                      disabled={
                        busy ||
                        permission === "denied" ||
                        permission === "unavailable"
                      }
                    >
                      {t(state.token ? "pushReconnect" : "enablePush")}
                    </button>
                    {state.token && <>
                      <button onClick={disablePush} disabled={busy}>{t("disablePush")}</button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(
                              `/v1/devices/${state.token}/test`,
                              "POST",
                            );
                            setMessage(t("testSent"));
                          })
                        }
                      >
                        {t("testPush")}
                      </button>
                    </>}
                  </div>
                </section>
                )}
                {/* Android reaches 掉线提醒 from its own 设置 row, as on iOS; the website points at 矿机 with the guide in the ⓘ. */}
                {!ANDROID && <section className="card offline-intro">
                  <span className="label-tip"><h2>{t("offlineAlert")}</h2><InfoTip label={t("offlineAlert")} text={t("offlineGuide")} /></span>
                  <button onClick={() => setPage("workers")}>{t("workers")} <Icon name="right" /></button>
                </section>}
                <div className="list-toolbar">
                  <span className="label-tip">{t("priceAlerts")} {activeRules.length} / 20{ANDROID && <InfoTip label={t("priceAlerts")} text={a.alertsPrivacy} />}</span>
                  <button
                    className="primary"
                    onClick={() =>
                      gated(() =>
                        activeRules.length >= 20
                          ? setMessage(t("limit"))
                          : (setEditingRule(null), setPanel("rule")),
                      )
                    }
                  >
                    <Icon name="plus" />{t("add")}
                  </button>
                </div>
                {!activeRules.length ? <Empty symbol="alerts" text={t("noRules")} button={t("addPriceAlert")} onClick={() => gated(() => { setEditingRule(null); setPanel("rule"); })} /> : <section className="card rules-card" aria-label={t("alerts")}>{activeRules.map((r) => (
                  <div className="rule-card" key={r.id}>
                    <Icon name={r.kind === "above" ? "up" : r.kind === "below" ? "down" : r.kind === "reach" ? "reach" : "change"} />
                    <div className="rule-label"><button className="text-button" onClick={() => gated(() => { setEditingRule(r); setPanel("rule"); })}><strong>{ANDROID && r.kind === "reach" ? `${fill(a.ruleReachLabel, `$${r.value.toFixed(2)}`)} · ${a.ruleEither}` : <>{t(r.kind)} {r.kind === "move" ? `${r.value}% · ${r.window === 300 ? "5m" : r.window === 3600 ? "1h" : "24h"}` : <Money amount={money(r.value)} />}</>}</strong></button>
                      {deliveries[r.id]?.deferred && deliveries[r.id].kind === r.kind && deliveries[r.id].value === r.value && deliveries[r.id].window === r.window && <small className="status warn">{t("deferredAlert").replace("%@", state.window ? `${String(Math.floor(state.window.start / 60)).padStart(2, "0")}:${String(state.window.start % 60).padStart(2, "0")} · ${state.window.tz}` : t("start"))}</small>}
                      <small><span>{t(r.repeat ? "repeatingAlert" : "oneShotAlert")}</span>{r.seen_fired > 0 && <span title={new Date(r.seen_fired * 1000).toLocaleString(state.lang)}>{t("lastAlert").replace("%@", relativeTime(r.seen_fired, state.lang))}</span>}</small>
                    </div>
                    <div className="rule-controls"><input type="checkbox" className="switch" aria-label={t("alerts")} checked={r.enabled} onChange={() => gated(() => update((s) => ({ ...s, rules: s.rules.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled, updated: Math.max(fresh(), x.updated + 1) } : x) })))} /><details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div><button onClick={() => gated(() => { setEditingRule(r); setPanel("rule"); })}><Icon name="edit" />{t("edit")}</button><button className="danger" onClick={() => remove("rules", r.id)}><Icon name="delete" />{t("delete")}</button></div></details></div>
                  </div>
                ))}</section>}
                <section className="card">
                  <div className="card-heading">
                    <span className="label-tip"><h2>{t("pushWindow")}</h2>{ANDROID && <InfoTip label={t("pushWindow")} text={state.window ? fill(a.windowSummary, hm(state.window.start), hm(state.window.end), hm(state.window.start)) : a.windowAllDay} />}</span>
                    <label className="compact-check">
                      <input
                        type="checkbox" className="switch"
                        checked={!state.window}
                        onChange={() =>
                          gated(() =>
                            update((s) => ({
                              ...s,
                              window: s.window
                                ? null
                                : {
                                    start: 480,
                                    end: 1320,
                                    tz: Intl.DateTimeFormat().resolvedOptions()
                                      .timeZone,
                                  },
                              settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1),
                            })),
                          )
                        }
                      />
                      {t("allDay")}
                    </label>
                  </div>
                  {state.window && (
                    <div className="time-grid">
                      {(["start", "end"] as const).map((key) => (
                        <label key={key}>
                          {t(key)}
                          <input
                            type="time"
                            value={`${String(Math.floor(state.window![key] / 60)).padStart(2, "0")}:${String(state.window![key] % 60).padStart(2, "0")}`}
                            onChange={(e) => {
                              const [h, m] = e.target.value
                                .split(":")
                                .map(Number);
                              if (!Number.isFinite(h + m)) return;
                              const same = h * 60 + m === state.window![key === "start" ? "end" : "start"];
                              if (same && !ANDROID) return;
                              // An empty window would mean "never": like iOS, push the end an hour on.
                              update((s) => {
                                const next = { ...s.window!, [key]: h * 60 + m };
                                if (next.start === next.end) next.end = (next.end + 60) % 1440;
                                return { ...s, window: next, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) };
                              });
                            }}
                          />
                        </label>
                      ))}
                      <small>{state.window.tz}</small>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
        {ANDROID && page === "settings" && <AndroidSettings state={state} me={me} accountReady={accountReady} accountEmail={accountEmail} info={androidInfoValue} a={a} t={t} general={generalSettings}
          page={settingsPage} setPage={(next) => { setSettingsPage(next); window.scrollTo(0, 0); }} live={live} wallet={walletOf} pushReady={pushReady}
          pay={fromApp ? null : { price: <Money amount={money(availability.pay.usd)} />, enabled: availability.pay.enabled && accountReady && !busy }}
          store={playStore}
          onAppearance={(appearance) => update((s) => ({ ...s, ...appearance, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))}
          offlineAlerts={{ monitors: activeMonitors, status: watchStatus, denied: permission === "denied", window: !!state.window, remindOnce: t("remindOnce"), remindAfter: t("remindAfter"),
            setAfter: (m, seconds) => { if (!seconds) { if (m.alert) toggleMonitorAlert(m); } else { if (!m.alert) toggleMonitorAlert(m); setMonitorAlert(m, { after: seconds }); } },
            setAgain: (m, seconds) => setMonitorAlert(m, { again: seconds || undefined }) }}
          onInfo={setAndroidInfo} onAccount={() => setPanel("account")} onBuy={buy} onAlerts={() => setPage("alerts")}
          onSecurity={() => setPanel("security")} onWidgets={() => setPanel("widgets")} onWallet={() => { setPanel(null); setPage("wallet"); }}
          trade={{ guideTitle: a.tradeGuide, render: (p) => TradeSettings && <Suspense fallback={<Skeleton label={t("loading")} />}><TradeSettings lang={state.lang} page={p} onGuide={() => { setSettingsPage("tradeGuide"); window.scrollTo(0, 0); }} /></Suspense> }} />}
        {!ANDROID && <footer className="main-foot">
          <span>Pearl Hub</span>
          <div className="main-foot-links">
            <button className="main-foot-link" onClick={() => setPanel("security")}>
              <Icon name="shield" /> {securityCopy(state.lang).title}
            </button>
            <a href="https://t.me/prl_hub" target="_blank" rel="noreferrer">
              {t("support")} <Icon name="external" />
            </a>
            <a href="mailto:support@pearlhub.net">
              <Icon name="mail" /> support@pearlhub.net
            </a>
          </div>
        </footer>}
      </main>
      {message && (
        <div className="toast" role="status">
          {message}
          <button aria-label={t("close")} onClick={() => setMessage("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className={panel === "txlookup" ? "tx-dialog" : panel === "appqr" || panel === "walletqr" ? "app-qr-dialog" : panel === "settings" || panel === "security" || panel === "extension" ? "settings-dialog" : panel === "account" || panel === "restore" ? "account-dialog" : panel === "payment" ? "payment-dialog" : undefined}
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setPanel(null);
        }}
      >
        <div className={`dialog-content ${panel === "payment" ? "payment-content" : ""}`}>
          <div className="dialog-heading">
            <h2>
              {ANDROID && panel === "widgets" ? a.widget : panel === "txlookup" ? t(txTab === "broadcast" ? "txBroadcast" : "txLookup") : panel === "appqr" ? t("appShowQR") : panel === "walletqr" ? t("receive") : panel === "extension" ? t("extensionBadge") : panel === "payment" || panel === "pro"
                ? t("pro")
                : panel === "monitor"
                  ? t(editingMonitor ? "editMonitor" : "addMonitor")
                  : panel === "rule"
                    ? t(editingRule ? "editPriceAlert" : "addPriceAlert")
                    : panel === "wallet" ? t("addWatchAddress") : panel === "restore" ? t("restorePurchase") : panel === "security" ? securityCopy(state.lang).title : panel === "account" ? accountReady && state.accountId ? accountCopy(state.lang).account : accountCopy(state.lang).login : t("settings")}
            </h2>
            <button onClick={() => setPanel(null)} aria-label={t("close")}>
              <Icon name="close" />
            </button>
          </div>
          {panel === "pro" && proOffer}
          {ANDROID && panel === "widgets" && <AndroidWidgets a={a} add={t("add")} pro={!!me?.pro} onPro={showPro} onPin={(kind) => void nativeCall("widgets.pin", { kind }).catch(() => setMessage(a.widgetSteps))} />}
          {panel === "appqr" && <div className="app-qr-content"><QR value={downloadLink} /><p>{t("appScanDownload")}</p></div>}
          {panel === "extension" && <WalletExtension t={t} copy={copy} lang={state.lang} />}
          {panel === "txlookup" && <TxTools tab={txTab} onTab={setTxTab} known={knownAddresses} refresh={refreshEpoch} onCopy={copy} t={t} lang={state.lang} />}
          {panel === "walletqr" && qrWallet && <div className="app-qr-content wallet-qr"><strong>{qrWallet.label}</strong><QR value={qrWallet.addr} alt={t("receiveQR")} /><PaymentAddress address={qrWallet.addr} t={t} onCopy={(value) => void copy(value)} /><p>{t("receiveMainnetOnly")}</p></div>}
          {panel === "settings" && (
            <>
              {generalSettings}
              <p className="settings-saved muted">{t("settingsSaved")}</p>
              <button className="security-entry" onClick={() => { dialog.current?.scrollTo({ top: 0 }); setPanel("security"); }}><Icon name="shield" /><span>{securityCopy(state.lang).title}</span><Icon name="chevron" className="security-entry-chevron" /></button>
              <div className="settings-links">
                <a href="https://t.me/prl_hub" target="_blank" rel="noreferrer">{t("support")} <Icon name="external" /></a>
                <a href="mailto:support@pearlhub.net"><Icon name="mail" /> support@pearlhub.net</a>
                <a href="/privacy.html" target="_blank" rel="noreferrer">{t("privacy")} <Icon name="external" /></a>
              </div>
            </>
          )}
          {panel === "security" && <>
            <button className="security-back" onClick={() => { dialog.current?.scrollTo({ top: 0 }); setPanel(ANDROID ? null : "settings"); }}><Icon name="chevron" />{securityCopy(state.lang).back}</button>
            {ANDROID ? <SecurityOverview lang={state.lang} sections={androidSecurity} copy={androidSecurityCopy(state.lang)} /> : <SecurityOverview lang={state.lang} sections={webSecurity} />}
          </>}
          {(panel === "account" || panel === "restore") && (
            <AccountPanel restore={panel === "restore" && !canSync} accountId={accountReady ? state.accountId : ""} lang={state.lang} auth={availability.auth} onLogin={(a) => adoptAccount(a)} onLogout={leaveAccount} onEmail={setAccountEmail} purchases={(
                <div className="setting-section">
                  <div className="card-heading">
                    <div>
                      <span className="label-tip"><h3>{t("pro")}</h3>{!me?.pro && !fromApp && <InfoTip label={t("pro")} text={t("appPurchaseLink")} />}</span>
                      <p className="muted">
                        {me?.pro
                          ? `${me.pro_scope==="device"?accountCopy(state.lang).guestPro:t("proActive")} · ${me.pro_src === "apple" ? t("appleSource") : me.pro_src} · ${new Date(me.pro_at! * 1000).toLocaleDateString(state.lang)}`
                          : fromApp ? t("proCopy") : <><Money amount={money(availability.pay.usd)} /> · {t("proCopy")}</>}
                      </p>
                    </div>
                    {!me?.pro && !fromApp && availability.pay.enabled && (
                      <button className="primary" disabled={busy} onClick={buy}>
                        {t("buy")}
                      </button>
                    )}
                  </div>
                  {!fromApp && order && order.status !== "paid" && (
                    <button onClick={() => setPanel("payment")}>
                      {t("order")} · {order.id.slice(0, 8)}
                    </button>
                  )}
                </div>
              )}
            >
              <div className="setting-section">
                <div className="card-heading">
                  {/* iOS WebLinkView.syncTip: what syncs, what never leaves the device, and without Pro that nothing syncs yet. */}
                  <span className="label-tip"><h3>{t("sync")}</h3><InfoTip label={t("sync")} text={[canSync ? t("proSyncNote") : t("syncRequiresPro"), ...canSync ? [accountCopy(state.lang).syncNote] : [], accountCopy(state.lang).privacy].join("\n\n")} /></span>
                  <input
                    type="checkbox" className="switch"
                    aria-label={t("sync")}
                    checked={canSync && state.sync}
                    disabled={!canSync || !accountReady}
                    onChange={() => {
                      if (!canSync || !accountReady) return;
                      update((s) => ({ ...s, sync: !s.sync }));
                    }}
                  />
                </div>
                {!canSync && <button className="primary" onClick={showPro}>{t(fromApp ? "learnMore" : "buy")}</button>}
                {canSync && state.sync && (
                  <div className="actions">
                    <button disabled={syncing} onClick={() => void sync()}>
                      {syncing ? t("loading") : t("syncNow")}
                    </button>
                    <small role="status">{ANDROID ? syncing ? a.syncing : syncedAt && syncStatus === t("synced") ? `${a.synced} · ${relativeTime(syncedAt, state.lang)}` : syncStatus : syncStatus}</small>
                  </div>
                )}
              </div>
            </AccountPanel>
          )}
          {panel === "wallet" && <WatchAddressForm t={t} lang={state.lang} initial={draftAddress} onSave={(label, addr) => {
            if (!/^prl1[0-9a-z]{20,100}$/.test(addr)) { setMessage(t("invalid")); return; }
            if (alive(state.wallets).length >= 10) { setMessage(t("limit")); return; }
            const id = uid();
            update((s) => ({ ...s, wallets: [...s.wallets, { id, updated: fresh(), label: label || addr.slice(0, 12), addr }] }));
            setWalletId(id); setPanel(null);
          }} />}
          {panel === "monitor" && (
            <TargetForm
              t={t}
              key={editingMonitor?.id || "new"}
              initial={draftAddress}
              initialMonitor={editingMonitor}
              lang={state.lang}
              extras={ANDROID ? { walletAddress: walletControl(walletFrame)?.state().address || undefined, useWallet: a.useWalletAddress, badAddress: a.badAddress, badF2Pool: a.badF2Pool, f2Guide: a.f2poolGuide } : undefined}
              onSave={(label, target, pool) => {
                const parsed =
                  pool === "F2Pool"
                    ? f2ref(target)
                    : /^prl1[0-9a-z]{20,100}$/.test(target)
                      ? { addr: target }
                      : null;
                if (!parsed) {
                  setMessage(t("invalid"));
                  return;
                }
                if (duplicateMonitor(state.monitors, pool, parsed.addr, editingMonitor?.id)) { setMessage(t("invalid")); return; }
                if (!editingMonitor && alive(state.monitors).length >= 20) {
                  setMessage(t("limit"));
                  return;
                }
                update((s) => ({
                  ...s,
                  monitors: editingMonitor ? s.monitors.map((m) => m.id === editingMonitor.id ? { ...m, acct: undefined, label, ...parsed, pool, updated: Math.max(fresh(), m.updated + 1) } : m) : [
                    ...s.monitors,
                    {
                      id: uid(),
                      updated: fresh(),
                      label,
                      ...parsed,
                      pool,
                      alert: false,
                      after: 600,
                    },
                  ],
                }));
                setPanel(null);
              }}
            />
          )}
          {panel === "rule" && (() => {
            const saveRule = (kind: Rule["kind"], value: number, window: number, repeat: boolean) => {
                if (
                  !(
                    value >= (kind === "move" ? 0.5 : 0.01) &&
                    value <= (kind === "move" ? 1000 : 999999.99)
                  ) ||
                  (!editingRule && activeRules.length >= 20)
                ) {
                  setMessage(t("invalid"));
                  return;
                }
                update((s) => ({
                  ...s,
                  rules: editingRule ? s.rules.map((r) => r.id === editingRule.id ? applyingEdit(r, { kind, value, window, repeat }) : r) : [
                    ...s.rules,
                    {
                      id: uid(),
                      updated: fresh(),
                      kind,
                      value,
                      window,
                      enabled: true,
                      seen_fired: 0,
                      repeat,
                    },
                  ],
                }));
                setPanel(null);
            };
            return ANDROID
              ? <AndroidRuleForm key={editingRule?.id || "new"} a={a} initialRule={editingRule} current={price.data?.usd} onSave={saveRule}
                  onDelete={editingRule ? () => { const id = editingRule.id; setPanel(null); remove("rules", id); } : undefined} />
              : <RuleForm key={editingRule?.id || "new"} initialRule={editingRule} t={t} onSave={saveRule} />;
          })()}
          {panel === "payment" && order && !fromApp && (
            <>
              <div className="payment-body">
              <div className="payment-overview">
                <PaymentHead amount={order.amount} estimate={money(order.usd)} t={t} onCopy={(value) => void copy(value)} />
                <QR value={order.address} />
              </div>
              <PaymentAddress address={order.address} t={t} onCopy={(value) => void copy(value)} />
              <div className="payment-warning">{t("payWarning")}</div>
              {!state.accountId&&<p className="muted guest-purchase-note">{accountCopy(state.lang).guestCheckout}</p>}
              <details className="payment-details">
                <summary>{t("learnMore")}</summary>
                {!state.accountId&&<p className="muted">{accountCopy(state.lang).guestPurchaseNote}</p>}
              <ol className="payment-steps">
                {(["waiting", "seen", "complete"] as const).map((k, i) => (
                  <li
                    key={k}
                    className={
                      i === ["pending", "seen", "paid"].indexOf(order.status)
                        ? "current"
                        : ""
                    }
                  >
                    {t(k)}
                  </li>
                ))}
              </ol>
              <div className="order-id">
                {t("order")}
                <button onClick={() => void copy(order.id)}><Icon name="copy" />{order.id}</button>
                <a href="https://t.me/prl_hub" target="_blank" rel="noreferrer">
                  {t("support")} <Icon name="external" />
                </a>
              </div>
              </details>
              </div>
              <div className="payment-footer">
              <p className="payment-status" role="status" aria-live="polite">{order.status==="paid"?state.accountId?t("proActive"):accountCopy(state.lang).guestPro:t(order.status==="seen"?"seen":"waiting")}</p>
              {order.status === "paid" && (
                <button className="primary" onClick={() => { setPanel(null); setPage("alerts"); }}>
                  {t("enablePush")} <Icon name="right" />
                </button>
              )}
              {order.status==="paid"&&!state.accountId&&<button onClick={()=>setPanel("account")}>{accountCopy(state.lang).savePurchase}</button>}
              {order.status === "pending" && (
                <p className="countdown"><span>{t("orderRemaining")}</span><strong>
                  {quoteExpired(order, clock)
                    ? t("expired")
                    : `${Math.floor((order.expires_at * 1000 - clock) / 60000)}:${String(Math.floor((order.expires_at * 1000 - clock) / 1000) % 60).padStart(2, "0")}`}
                </strong></p>
              )}
              {quoteExpired(order, clock) && (
                <button className="primary" onClick={buy} disabled={busy}>
                  {t("newOrder")}
                </button>
              )}
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
function Empty({
  symbol,
  text,
  button,
  onClick,
}: {
  symbol: IconName;
  text: string;
  button?: string;
  onClick?: () => void;
}) {
  return (
    <section className="card empty">
      <span><Icon name={symbol} /></span>
      <h2>{text}</h2>
      {button && (
        <button className="primary" onClick={onClick}>
          <Icon name="plus" />{button}
        </button>
      )}
    </section>
  );
}
// The Android app's additions from the iOS add-monitor sheet (PoolView.swift): the wallet's own address,
// the F2Pool tutorial link, and the reason a target is refused, shown as it is typed.
type TargetExtras = { walletAddress?: string; useWallet: string; badAddress: string; badF2Pool: string; f2Guide: string };
function TargetForm({
  t,
  onSave,
  initial = "",
  initialMonitor,
  lang,
  extras,
}: {
  t: (k: TextKey) => string;
  lang: State["lang"];
  initial?: string;
  initialMonitor?: Monitor | null;
  onSave: (name: string, target: string, pool: string) => void;
  extras?: TargetExtras;
}) {
  const [pool, setPool] = useState(initialMonitor?.pool || pools[0]);
  const [target, setTarget] = useState(initial);
  const refused = extras && target.trim() ? pool === "F2Pool" ? !f2ref(target.trim()) && extras.badF2Pool : !/^prl1[0-9a-z]{20,100}$/.test(cleanAddress(target)) && extras.badAddress : "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onSave(
          String(data.get("label") || "").trim() || pool,
          pool === "F2Pool"
            ? String(data.get("target") || "").trim()
            : cleanAddress(String(data.get("target") || "")),
          pool,
        );
      }}
    >
      <label className="form-field">
        {t("pool")}
        <select value={pool} onChange={(e) => setPool(e.target.value)}>
          {pools.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="form-field">
        {t("name")}
        <input name="label" maxLength={40} autoComplete="off" defaultValue={initialMonitor?.label || ""} />
      </label>
      {(() => {
        const field = <textarea
          name="target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
          autoComplete="off"
          rows={3}
          aria-label={pool === "F2Pool" ? t("link") : undefined}
          placeholder={
            pool === "F2Pool"
              ? "https://www.f2pool.com/mining-user/…"
              : "prl1…"
          }
        />;
        // iOS WatchSheet: the read-only link's safety note is an ⓘ beside its title (outside the <label>, whose
        // clicks a button inside would take).
        return pool === "F2Pool"
          ? <div className="form-field"><span className="label-tip">{t("link")}<InfoTip label={t("link")} text={t("f2ReadOnly")} /></span>{field}</div>
          : <label className="form-field">{t("address")}{field}</label>;
      })()}
      {refused && <small className="field-error">{refused}</small>}
      {extras?.walletAddress && pool !== "F2Pool" && <button type="button" className="text-button use-wallet" onClick={() => setTarget(extras.walletAddress!)}>{extras.useWallet}</button>}
      {pool === "F2Pool" && <details className="help" open><summary>{t("f2Help")}</summary><ol>{(["f2Step1", "f2Step2", "f2Step3"] as const).map((k) => <li key={k}>{t(k)}{k === "f2Step3" && <> <InfoTip label={t("f2Help")} text={t("f2Permission")} /></>}</li>)}</ol>{extras && <a href="https://f2pool.zendesk.com/hc/en-us/articles/360058722231" target="_blank" rel="noreferrer">{extras.f2Guide}</a>}</details>}
      <div className="actions form-actions"><PasteButton t={t} onPaste={setTarget} /><button className="primary" disabled={!!refused}>{t("save")}</button></div>
    </form>
  );
}
function WatchAddressForm({ t, initial, onSave, lang }: { lang: State["lang"]; t: (k: TextKey) => string; initial: string; onSave: (label: string, addr: string) => void }) {
  const [addr, setAddr] = useState(initial);
  return <form onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); onSave(String(d.get("label") || "").trim(), addr.trim().toLowerCase()); }}>
    <label className="form-field">{t("name")}<input name="label" maxLength={40} /></label>
    <label className="form-field">{t("address")}<textarea required value={addr} onChange={(e) => setAddr(e.target.value)} rows={3} placeholder="prl1…" /></label>
    <div className="actions form-actions"><PasteButton t={t} onPaste={setAddr} /><button className="primary">{t("save")}</button></div>
  </form>;
}
function RuleForm({
  t,
  onSave,
  initialRule,
}: {
  initialRule?: Rule | null;
  t: (k: TextKey) => string;
  onSave: (kind: Rule["kind"], value: number, window: number, repeat: boolean) => void;
}) {
  const [kind, setKind] = useState<Rule["kind"]>(initialRule?.kind || "above");
  const [repeat, setRepeat] = useState(initialRule?.repeat === true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onSave(
          kind,
          Math.round(Number(data.get("value")) * 100) / 100,
          kind === "move" ? Number(data.get("window")) : 0,
          repeat,
        );
      }}
    >
      <label className="form-field">
        {t("ruleType")}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Rule["kind"])}
        >
          {(["above", "below", "reach", "move"] as const).map((k) => (
            <option key={k} value={k}>
              {t(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        {t("threshold")} ({kind === "move" ? "%" : "USD"})
        <input
          name="value"
          defaultValue={initialRule?.value}
          type="number"
          min={kind === "move" ? 0.5 : 0.01}
          max={kind === "move" ? 1000 : 999999.99}
          step="0.01"
          required
        />
      </label>
      {kind === "reach" && <p className="muted">{t("reachNote")}</p>}
      {kind === "move" && (
        <label className="form-field">
          {t("move")}
          <select name="window" defaultValue={initialRule?.window || 86400}>
            <option value="300">5m</option>
            <option value="3600">1h</option>
            <option value="86400">24h</option>
          </select>
        </label>
      )}
      <label className="form-field">
        {t("alertFrequency")}
        <select value={repeat ? "repeat" : "once"} onChange={(e) => setRepeat(e.target.value === "repeat")}>
          <option value="once">{t("oneShotAlert")}</option>
          <option value="repeat">{t("repeatingAlert")}</option>
        </select>
      </label>
      <p className="muted">{t(repeat ? "repeatingAlertNote" : "oneShotAlertNote")}</p>
      <div className="actions form-actions"><button className="primary">{t("save")}</button></div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
