import { useCallback, useEffect, useRef, useState } from "react";
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
import { enabledMonitors, alertMonitors, cleanAddress, moveIds, ownAddresses, targetKey, duplicateMonitor, hashrate24h, dailyAverage, nearestWindow } from "./monitors.ts";
import { Icon, type IconName } from "./Icons.tsx";
import { Money, PRLAmount } from "./Money.tsx";
import { PaymentHead, PaymentAddress } from "./Payment.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { PasteButton } from "./NativeControls.tsx";
import { WorkerList } from "./Workers.tsx";
import { WatchWallet } from "./WatchWallet.tsx";
import { WalletExtension } from "./WalletExtension.tsx";
import { pushTimeout, subscribePush } from "./push.ts";
import type { Overview } from "./types.ts";
import { appClient } from "./app-client.ts";

const fromApp = appClient();

type Page = "market" | "workers" | "pools" | "calculator" | "wallet" | "alerts" | "app";
const appStoreURL = "https://apps.apple.com/app/id6777132941";
const macStoreURL = `${appStoreURL}?platform=mac`;
const navShortKeys = {
  market: "navMarketShort",
  workers: "navWorkersShort",
  pools: "navPoolsShort",
  calculator: "navCalculatorShort",
  wallet: "navWalletShort",
  alerts: "navAlertsShort",
  app: "navAppShort",
} as const;
type Panel = "settings" | "security" | "account" | "restore" | "monitor" | "rule" | "pro" | "payment" | "wallet" | "appqr" | null;
type Snapshot<T> = { data?: T; failed?: boolean; target?: string };
// ?account=manage|delete|restore opens a panel once, when the page loads; keeping it in the address bar
// reopened that panel on every reload. The device-connect flow keeps its parameters.
function keptSearch() {
  const q = new URLSearchParams(location.search);
  if (q.get("account") !== "connect") q.delete("account");
  const s = q.toString();
  return s ? `?${s}` : "";
}
const pageFromHash = (): Page => {
  const page = location.hash.slice(1).split("?")[0];
  return ["market", "workers", "pools", "calculator", "wallet", "alerts", "app"].includes(page) ? page as Page : "market";
};
const uid = () => crypto.randomUUID();
const hasPush = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const QR = ({ value, cell = 5, margin = 12 }: { value: string; cell?: number; margin?: number }) => {
  const q = qrcode(0, "M");
  q.addData(value);
  q.make();
  return <img className="qr" src={q.createDataURL(cell, margin)} alt="QR" />;
};
const initialState = readStore();
applyAppearance(initialState.theme, initialState.palette);
function App() {
  const [state, setState] = useState<State>(initialState),
    stateRef = useRef(state);
  stateRef.current = state;
  const [page, setPage] = useState<Page>(pageFromHash),
    [panel, setPanel] = useState<Panel>(() => { const d = deepLink(location.hash), account = new URLSearchParams(location.search).get("account"); return connectingDevice || ["manage", "delete"].includes(account || "") ? "account" : account === "restore" ? "restore" : d ? d.page === "wallet" ? "wallet" : "monitor" : null; });
  const [draftAddress, setDraftAddress] = useState(() => deepLink(location.hash)?.addr || "");
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, { kind: Rule["kind"]; value: number; window: number; deferred?: boolean }>>({});
  const [incomes, setIncomes] = useState<Record<string, Snapshot<Income>>>({});
  const [price, setPrice] = useState<Snapshot<Price>>({}),
    [history, setHistory] = useState<
      Snapshot<{ source: string; points: number[][] }>
    >({});
  const [fx, setFX] = useState<FX>();
  const [overview, setOverview] = useState<Snapshot<Overview>>({});
  const [stats, setStats] = useState<Record<string, Snapshot<Stats>>>({});
  const [availability, setAvailability] = useState<Availability>({
    pay: { enabled: false, usd: 4.99 },
    vapid_key: null,
  });
  const [me, setMe] = useState<Me | null>(null),
    [order, setOrder] = useState<Order | null>(null);
  const canSync = !!(state.accountId && me?.pro && me.pro_scope !== "device");
  const canSyncRef = useRef(canSync);
  canSyncRef.current = canSync;
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [accountReady, setAccountReady] = useState(false);
  const accountReadyRef = useRef(accountReady); accountReadyRef.current = accountReady;
  const [permission, setPermission] = useState(
    hasPush() ? Notification.permission : "unavailable",
  );
  const [pushState, setPushState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pendingMonitor, setPendingMonitor] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false),
    [syncStatus, setSyncStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    refreshingRef = useRef(false),
    refreshQueued = useRef(false),
    syncRef = useRef(false),
    pushGeneration = useRef(0),
    accountGeneration = useRef(0),
    pushQueue = useRef<Promise<unknown>>(Promise.resolve());
  const money = (v: number) => dual(v, state.secondary, state.lang, fx);
  const t = (key: TextKey) => dictionaries[state.lang][key];
  const errorText = (error: unknown) =>
    error instanceof Error && error.message === "purchase_storage" ? t("storageError") :
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
      const d = deepLink(location.hash);
      if (d) { setDraftAddress(d.addr); setPanel(d.page === "wallet" ? "wallet" : "monitor"); }
      window.history.replaceState(null, "", `/${keptSearch()}#${pageFromHash()}`);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    window.history.replaceState(null, "", `/${keptSearch()}#${page}`);
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
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
    const apply = () => applyAppearance(state.theme, state.palette);
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
    setMe(null); setOrder(null); setDeliveries({}); setPushState("idle"); setAccountReady(true);
    if (hasPush() && !localPurchase()) {
      try { const reg = await pushTimeout(navigator.serviceWorker.ready); const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch { /* Local features remain available. */ }
    }
  }, []);
  const adoptAccount = useCallback(async (account: Account, askImport = true, generation = ++accountGeneration.current) => {
    const id = account.user_id;
    const association=localPurchase()?await associatePurchase(id):null;
    const profile = await api<Me>("/v1/me", "GET", undefined, id);
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
    setMe(profile); setOrder(profile.order); setDeliveries({}); setAccountReady(true);
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
    const s = stateRef.current;
    await Promise.allSettled([
      api<FX>("/v1/fx").then(setFX).catch(() => setFX((old) => old ? { ...old, stale: true } : undefined)),
      api<Price>("/v1/price")
        .then((data) => setPrice({ data }))
        .catch(() => setPrice((prev) => ({ ...prev, failed: true }))),
      api<Overview>("/v1/pools")
        .then((data) => setOverview({ data }))
        .catch(() => setOverview((prev) => ({ ...prev, failed: true }))),
      api<{ source: string; points: number[][] }>("/v1/price/history")
        .then((data) => setHistory({ data }))
        .catch(() => setHistory((prev) => ({ ...prev, failed: true }))),
      ...enabledMonitors(s.monitors).map((m) =>
        api<Stats>("/v1/pool/stats", "POST", {
          pool: m.pool,
          addr: m.addr,
          acct: m.acct,
        })
          .then((data) => { if (enabledMonitors(stateRef.current.monitors).some((x) => x.id === m.id && targetKey(x) === targetKey(m))) setStats((prev) => ({ ...prev, [m.id]: { data, target: targetKey(m) } })); })
          .catch(() => { if (enabledMonitors(stateRef.current.monitors).some((x) => x.id === m.id && targetKey(x) === targetKey(m))) setStats((prev) => ({ ...prev, [m.id]: { ...(prev[m.id]?.target === targetKey(m) ? prev[m.id] : {}), target: targetKey(m), failed: true } })); }),
      ),
      ...ownAddresses(s.monitors).map((addr) => {
        const own = ownAddresses(s.monitors), target = JSON.stringify(own.slice().sort());
        return api<Income>("/v1/address/income", "POST", { addr, own })
          .then((data) => { if (JSON.stringify(ownAddresses(stateRef.current.monitors).sort()) === target) setIncomes((v) => ({ ...v, [addr]: { data, target } })); })
          .catch(() => { if (JSON.stringify(ownAddresses(stateRef.current.monitors).sort()) === target) setIncomes((v) => ({ ...v, [addr]: { failed: true, target } })); });
      }),
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
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  const loadMe = useCallback(async (accountId: string) => {
    const result = await api<Me>("/v1/me", "GET", undefined, accountId);
    if ((stateRef.current.accountId||stateRef.current.purchaseId) !== accountId) return result;
    setMe(result);
    setAvailability((previous) => ({ ...previous, ...result }));
    if (result.order) setOrder(result.order);
    return result;
  }, []);
  const reconcileRules = async (token: string) => {
    const result = await api<{
      rules: { id: string; kind: Rule["kind"]; value: number; window: number; enabled: boolean; last_fired: number | null; deferred?: boolean }[];
    }>(`/v1/devices/${token}`, "GET", undefined, buyerId(stateRef.current));
    if (stateRef.current.token !== token) return;
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
  const showPro = () => setPanel("pro");
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
  const sendSettings = async (s: State, subscription?: PushSubscription) => {
    setPushState("saving");
    try {
      const reg = await pushTimeout(navigator.serviceWorker.ready),
        sub = subscription || (await reg.pushManager.getSubscription());
      if (!sub || !buyerId(s) || Notification.permission !== "granted") {
        update((latest) => ({ ...latest, token: "" }));
        throw new Error("pushConnectError");
      }
      const result = await api<{
        token: string;
        rules: { id: string; kind: Rule["kind"]; value: number; window: number; enabled: boolean; last_fired: number | null }[];
      }>(
        "/v1/web/push",
        "PUT",
        {
          subscription: sub.toJSON(),
          lang: s.lang,
          window: s.window,
          rules: alive(s.rules),
          watches: alertMonitors(s.monitors)
            .map((m) => ({
              id: m.id,
              pool: m.pool,
              addr: m.addr,
              acct: m.acct,
              label: m.label,
              after: m.after,
            })),
        },
        buyerId(s),
      );
      if (buyerId(stateRef.current) !== buyerId(s)) return;
      if(s.purchaseId)rememberPurchaseToken(result.token);
      setPushState("saved");
      update((latest) => ({
        ...latest,
        token: result.token,
        rules: latest.rules.map((r) => {
          const remote = result.rules.find((x) => x.id === r.id);
          return reconcileRule(r, remote);
        }),
      }));
    } catch (error) {
      if (buyerId(stateRef.current) !== buyerId(s)) return;
      setPushState("error");
      throw error;
    }
  };
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
      pushQueue.current = pushQueue.current
        .catch(() => {})
        .then(() => generation === pushGeneration.current && stateRef.current.token ? sendSettings(stateRef.current) : undefined)
        .catch(() => setMessage(dictionaries[stateRef.current.lang].error));
    }, 400);
    return () => clearTimeout(timer);
  }, [pushValues, state.token, me?.pro]);
  const enablePush = () => {
    if (!me?.pro) {
      showPro();
      return;
    }
    if (!hasPush() || !availability.vapid_key) {
      setMessage(t("pushUnavailable"));
      return;
    }
    void run(async () => {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") throw new Error("pushPermission");
      await ensureBuyer();
      setPushState("saving");
      try {
        const reg = await pushTimeout(navigator.serviceWorker.ready);
        const sub = await pushTimeout(subscribePush(reg, availability.vapid_key!));
        const next = {
          ...stateRef.current,
          monitors: stateRef.current.monitors.map((m) =>
            m.id === pendingMonitor ? { ...m, alert: true, updated: Math.max(fresh(), m.updated + 1) } : m),
        };
        await sendSettings(next, sub);
        if (pendingMonitor) {
          update((s) => ({ ...s, monitors: next.monitors }));
          setPendingMonitor(null);
          setPage("workers");
        }
        setMessage(t("pushConnected"));
      } catch (error) {
        setPushState("error");
        if (error instanceof ApiError || (error instanceof Error && error.message === "pushTimeout")) throw error;
        throw new Error("pushConnectError");
      }
    });
  };
  const disablePush = () => void run(async () => {
    // Delete server watches first, so a disconnected browser cannot leave active alerts.
    pushGeneration.current++;
    await pushQueue.current.catch(() => {});
    const token = stateRef.current.token;
    if (token) await api(`/v1/devices/${token}`, "DELETE", {}, buyerId(stateRef.current));
    rememberPurchaseToken("");
    stateRef.current = { ...stateRef.current, token: "" };
    update((s) => ({ ...s, token: "" }));
    setPushState("idle");
    const reg = await pushTimeout(navigator.serviceWorker.ready);
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    setMessage(t("pushDisconnected"));
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
        setMessage(t("pushSetupMonitor"));
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
  const moveMonitor = (id: string, destination: number) => {
    const oldIds = activeMonitors.map((m) => m.id), ids = moveIds(oldIds, id, destination);
    if (ids === oldIds) return;
    update((s) => ({ ...s, monitorOrder: { ids, updated: Math.max(fresh(), (s.monitorOrder?.updated || 0) + 1) } }));
  };
  const incomeTarget = JSON.stringify(ownAddresses(state.monitors).sort());
  const incomeFor = (addr: string) => incomes[addr]?.target === incomeTarget && !incomes[addr]?.failed ? incomes[addr]?.data : undefined;
  const addressHash = (addr: string) => enabledMonitors(state.monitors).filter((m) => m.addr === addr && stats[m.id]?.target === targetKey(m)).reduce((n, m) => n + hashrate24h(stats[m.id]?.data), 0);
  const fleetSnapshots = enabledMonitors(state.monitors).map((m) => stats[m.id]?.target === targetKey(m) ? stats[m.id] : undefined);
  const fleetStats = fleetSnapshots.flatMap((snap) => snap?.data && !snap.data.missing ? [snap.data] : []);
  const incomeAddresses = ownAddresses(state.monitors), fleetIncomes = incomeAddresses.flatMap((addr) => incomeFor(addr) ? [incomeFor(addr)!] : []);
  const fleetHash = fleetStats.reduce((n, s) => n + rate(s, nearestWindow(selected, s.windows)), 0);
  const fleetOnline = fleetStats.reduce((n, s) => n + s.workers.filter((w) => w.online).length, 0), fleetTotal = fleetStats.reduce((n, s) => n + s.workers.length, 0);
  const summaryWaiting = fleetSnapshots.some((s) => !s?.data && !s?.failed) || incomeAddresses.some((a) => !incomes[a] || incomes[a].target !== incomeTarget);
  const restoreLink = <a className="pro-restore" href="/?account=restore#alerts" onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); setPanel("restore"); } }}>{t("restorePurchase")}</a>;
  const pendingOrderLink = order && order.status !== "paid" && <button onClick={() => setPanel("payment")}>{t("order")} · {order.id.slice(0, 8)}</button>;
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
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Pearl Hub">
          <img src="/icon-192.png?v=pearl-light" alt="" width="44" height="44" />
          <span className="brand-copy">
            <span className="brand-name">Pearl Hub</span>
            <small className="brand-meta"><span>PRL</span><span className="brand-dot" aria-hidden="true" /><span className="brand-platform">WEB</span></small>
          </span>
        </a>
        <nav>
          {(
            [
              "market",
              "workers",
              "pools",
              "calculator",
              "wallet",
              "alerts",
              "app",
            ] as Page[]
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
        <div className="sidebar-foot">
          <div className="sidebar-actions">
            <button className="settings-button" aria-label={t("settings")} title={t("settings")} onClick={() => setPanel("settings")}><Icon name="settings" /></button>
            <button className={`account-entry ${accountReady && state.accountId ? "" : "primary"}`} onClick={() => setPanel("account")} aria-label={accountReady && state.accountId ? accountCopy(state.lang).account : t("signIn")} aria-haspopup="dialog">
              <Icon name="account" /><span>{accountReady && state.accountId ? accountCopy(state.lang).account : t("signIn")}</span>
            </button>
          </div>
        </div>
      </aside>
      <main className={page === "pools" ? "pool-page" : page === "wallet" || page === "alerts" || page === "app" ? "narrow-page" : undefined}>
        <div className="page-toolbar">
        <header className="page-heading">
          <div>
            <div className="page-title"><h1>{t(page === "pools" ? "poolOverview" : page)}</h1>{page === "alerts" && me?.pro && <span className="badge" title={t("proActive")}><Icon name="check" />PRO · {me.pro_src === "apple" ? t("appleSource") : me.pro_src || "PRO"}</span>}</div>
            {page !== "app" && (
              <p>
                {t(
                  (
                    {
                      market: "marketNote",
                      workers: "workerNote",
                      pools: "poolsNote",
                      calculator: "calculatorNote",
                      wallet: "walletNote",
                      alerts: "alertNote",
                    } as const
                  )[page],
                )}
              </p>
            )}
          </div>
        </header>
        <div className="global-actions">
          <AppearanceMenu state={state} t={t} onChange={(appearance) => update((s) => ({ ...s, ...appearance, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))} />
        </div>
        </div>
        {page === "app" && (
          <section className="app-download" aria-labelledby="app-download-title">
            <div className="app-download-main">
              <img className="app-download-logo" src="/icon-192.png?v=pearl-light" alt="" width="88" height="88" />
              <h2 id="app-download-title">Pearl Hub</h2>
              <p className="app-download-note">{t("appDownloadDescription")}</p>
              <div className="app-download-actions">
                <a className="primary app-download-button" href={appStoreURL} target="_blank" rel="noreferrer"><Icon name="app" />{t("iosDownload")}</a>
                <a className="primary app-download-button" href={macStoreURL} target="_blank" rel="noreferrer"><Icon name="mac" />{t("macDownload")}</a>
              </div>
              <p className="app-coming-soon">Android<span>{t("appComingSoon")}</span></p>
            </div>
            <div className="app-download-qr">
              <QR value={appStoreURL} cell={4} margin={16} />
              <p>{t("appScanDownload")}</p>
            </div>
            <button className="app-qr-button" aria-label={t("appShowQR")} title={t("appShowQR")} aria-haspopup="dialog" onClick={() => setPanel("appqr")}><Icon name="qr" /></button>
          </section>
        )}
        {page === "market" && (
          <>
            <MarketData price={price.data} overview={overview.data} history={history.data} failed={price.failed || overview.failed || history.failed} t={t} lang={state.lang} money={money} refresh={refreshEpoch} />
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
                    {t("extensionShortcut")}
                  </small>
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
        {page === "workers" && (
          <>
            <div className="list-toolbar workers-toolbar">
              <span>{t("monitors")} {activeMonitors.length} / 20</span>
              <label className="compact-check"><input type="checkbox" className="switch" checked={state.onlineOnly === true} onChange={(e) => update((s) => ({ ...s, onlineOnly: e.target.checked }))} />{t("onlineOnly")}</label>
              {addButton("monitor", activeMonitors.length, 20)}
            </div>
            {enabledMonitors(state.monitors).length > 0 && <section className="card monitor-summary" aria-label={t("overview")}>{summaryWaiting ? <Skeleton label={t("loading")} /> : <div className="fleet-strip">
              <div><small>{t("fleetHash")} · {t(selected)}</small><strong>{fleetStats.length ? hashrate(fleetHash, state.lang) : "—"}</strong></div>
              <div><small>{t("onlineWorkers")}</small><strong>{fleetStats.length ? `${fleetOnline.toLocaleString(state.lang)} / ${fleetTotal.toLocaleString(state.lang)}` : "—"}</strong></div>
              <div><small>{t("recent24h")}</small><strong><PRLAmount lang={state.lang} value={fleetIncomes.length ? fleetIncomes.reduce((n, i) => n + i.h24, 0) : null} /></strong></div>
              <div><small>{t("recent7d")}</small><strong><PRLAmount lang={state.lang} value={fleetIncomes.length ? fleetIncomes.reduce((n, i) => n + i.d7, 0) : null} /></strong></div>
            </div>}{(fleetSnapshots.some((s) => s?.failed || s?.data?.partial) || fleetIncomes.length < incomeAddresses.length) && !summaryWaiting && <p className="status warn">{t("partial")}</p>}</section>}
            {!activeMonitors.length && (
              <Empty
                symbol="workers"
                text={t("noMonitors")}
                onClick={() => setPanel("monitor")}
                button={t("add")}
              />
            )}
            {activeMonitors.map((m) => {
              const snap = stats[m.id]?.target === targetKey(m) ? stats[m.id] : undefined,
                s = snap?.data,
                w = nearestWindow(selected, s?.windows);
              return (
                <section className="card monitor-card" key={m.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", m.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveMonitor(e.dataTransfer.getData("text/plain"), activeMonitors.findIndex((x) => x.id === m.id)); }}>
                  <div className="card-heading">
                    <div className="card-name">
                      <div className="monitor-title"><h2>{m.label}</h2><small>{m.pool}</small>{m.paused ? <span className="badge">{t("paused")}</span> : s && !s.missing && <span className={`badge ${s.workers.some((x) => !x.online) ? "offline-badge" : "online-badge"}`}>{s.workers.some((x) => !x.online) ? t("offlineCount").replace("%@", String(s.workers.filter((x) => !x.online).length)) : t("online")}</span>}</div>
                    </div>
                    <div className="inline-controls"><div className="alert-controls">
                      {availability.vapid_key && !m.paused && (
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
                            <select
                              aria-label={t("minutes")}
                              value={m.after}
                              onChange={(e) => {
                                const after = Number(e.target.value);
                                gated(() =>
                                  update((st) => ({
                                    ...st,
                                    monitors: st.monitors.map((x) =>
                                      x.id === m.id
                                        ? { ...x, after, updated: Math.max(fresh(), x.updated + 1) }
                                        : x,
                                    ),
                                  })),
                                );
                              }}
                            >
                              {[600, 900, 1800, 3600].map((n) => (
                                <option key={n} value={n}>
                                  {n / 60} {t("minutes")}
                                </option>
                              ))}
                            </select>
                          )}
                        </>
                      )}
                      </div><details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div>
                        <button onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setMonitorPaused(m, !m.paused); }}><Icon name={m.paused ? "play" : "pause"} />{t(m.paused ? "resume" : "pause")}</button>
                        <button onClick={() => { setEditingMonitor(m); setDraftAddress(m.pool === "F2Pool" ? `https://www.f2pool.com/mining-user/${m.addr}?user_name=${encodeURIComponent(m.acct || "")}` : m.addr); setPanel("monitor"); }}><Icon name="edit" />{t("edit")}</button>
                        <button onClick={() => rename("monitors", m.id, m.label)}><Icon name="rename" />{t("rename")}</button>
                        <button disabled={activeMonitors[0].id === m.id} onClick={() => moveMonitor(m.id, activeMonitors.findIndex((x) => x.id === m.id) - 1)}><Icon name="up" />{t("moveUp")}</button>
                        <button disabled={activeMonitors.at(-1)!.id === m.id} onClick={() => moveMonitor(m.id, activeMonitors.findIndex((x) => x.id === m.id) + 1)}><Icon name="down" />{t("moveDown")}</button>
                        <button className="danger" onClick={() => remove("monitors", m.id)}><Icon name="delete" />{t("delete")}</button>
                      </div></details>
                    </div>
                  </div>
                  {!m.paused && stale(snap?.failed)}
                  {!m.paused && m.alert && (pushState === "error" || !state.token) && <p className="status warn">{t("pushNeedsConnection")}</p>}
                  {m.paused ? <div className="monitor-paused"><p className="muted">{t("pausedNote")}</p><button onClick={() => setMonitorPaused(m, false)}>{t("resume")}</button></div> : !s ? (
                    snap?.failed ? <p className="muted">{t("error")}</p> : <Skeleton label={t("loading")} />
                  ) : s.missing ? (
                    <p className="muted">{t("missing")}</p>
                  ) : (
                    <>
                      <div className="monitor-stats">
                        <div>
                          <div className="rate-value">
                            {hashrate(rate(s, w), state.lang)}
                          </div>
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
                        <span className="status">{s.workers.filter((x) => x.online).length} / {s.workers.length} {t("online")}</span>
                      </div>
                      <div className="money-grid">
                        <div>
                          <small>{t(s.pendingKind)}</small>
                          <strong>
                            <PRLAmount lang={state.lang} value={s.pending} />
                          </strong>
                        </div>
                        <div>
                          <small>{t("paid")}</small>
                          <strong>
                            <PRLAmount lang={state.lang} value={s.paid} />
                          </strong>
                        </div>
                      </div>

                      <WorkerList workers={s.workers} window={w} lang={state.lang} t={t} onlineOnly={state.onlineOnly === true} />
                      {s.partial && <p className="muted">{t("partial")}</p>}
                    </>
                  )}
                      {!m.paused && m.pool !== "F2Pool" && <div className="income-grid"><h3>{t("chainIncome")}</h3>{!incomeFor(m.addr) && (!incomes[m.addr] || incomes[m.addr]?.target !== incomeTarget) ? <Skeleton label={t("loading")} /> : <>{(["h24", "d7", "total"] as const).map((key) => <div key={key}><small>{key === "h24" ? t("recent24h") : key === "d7" ? t("recent7d") : t("totalIncome")}</small><strong><PRLAmount lang={state.lang} value={incomeFor(m.addr)?.[key]} /></strong><small><Money amount={incomeFor(m.addr) && price.data ? money(incomeFor(m.addr)![key] * price.data.usd) : "—"} /></small></div>)}<div><small>{t("tested")} · {t("perPHDay")}</small><strong><PRLAmount lang={state.lang} value={incomeFor(m.addr) && addressHash(m.addr) > 0 ? dailyAverage(incomeFor(m.addr)!.h24, incomeFor(m.addr)!.d7) / (addressHash(m.addr) / 1e15) : null} /></strong></div></>}</div>}
                </section>
              );
            })}
          </>
        )}
        {page === "wallet" && <>
          <WatchWallet lang={state.lang} wallets={alive(state.wallets)} price={price.data} refresh={refreshEpoch} t={t} money={money} onCopy={copy}
            onAdd={() => { setDraftAddress(""); setPanel("wallet"); }}
            onRename={(w) => rename("wallets", w.id, w.label)} onRemove={(w) => remove("wallets", w.id)} />
          <details className="card extension-fold"><summary>{t("extensionBadge")}</summary><WalletExtension t={t} copy={copy} lang={state.lang} /></details>
        </>}
        {page === "alerts" && (
          <>
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
            {!availability.vapid_key ? (
              <Empty symbol="alerts" text={t("pushOff")} />
            ) : (
              <>
                {me?.pro && state.token && permission === "granted" && pushState !== "error" ? <section className="card notification-status"><span role="status"><Icon name="check" />{t(pushState === "saving" ? "pushSaving" : "notificationOn")}</span><div className="actions"><button disabled={busy} onClick={() => void run(async () => { await api(`/v1/devices/${state.token}/test`, "POST"); setMessage(t("testSent")); })}>{t("testPush")}</button><button onClick={disablePush} disabled={busy}>{t("disablePush")}</button></div></section> : (
                <section className="card">
                  <div className="card-heading">
                    <h2>{t("notifications")}</h2>
                    <span className="badge">PRO</span>
                  </div>
                  <p role="status">
                    {t(
                      pushState === "saving" ? "pushSaving" :
                      pushState === "error" ? "pushSaveError" :
                      state.token && permission === "granted" ? "pushConnected" :
                      permission === "granted"
                        ? "pushGranted"
                        : permission === "denied"
                          ? "pushDenied"
                          : permission === "unavailable"
                            ? "pushUnavailable"
                            : "pushDefault",
                    )}
                  </p>
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
                  <details className="help">
                    <summary>{t("pushHelp")}</summary>
                    <p>{t("pushLimits")}</p>
                  </details>
                </section>
                )}
                <section className="card offline-intro">
                  <h2>{t("offlineAlert")}</h2>
                  <p>{t("offlineIntro")}</p><details className="help"><summary>{t("learnMore")}</summary><p>{t("offlineGuide")}</p></details>
                  <button onClick={() => setPage("workers")}>{t("workers")} <Icon name="right" /></button>
                </section>
                <div className="list-toolbar">
                  <span>{t("priceAlerts")} {activeRules.length} / 20</span>
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
                    <Icon name={r.kind === "above" ? "up" : r.kind === "below" ? "down" : "change"} />
                    <div className="rule-label"><button className="text-button" onClick={() => gated(() => { setEditingRule(r); setPanel("rule"); })}><strong>{t(r.kind)} {r.kind === "move" ? `${r.value}% · ${r.window === 300 ? "5m" : r.window === 3600 ? "1h" : "24h"}` : <Money amount={money(r.value)} />}</strong></button>
                      {deliveries[r.id]?.deferred && deliveries[r.id].kind === r.kind && deliveries[r.id].value === r.value && deliveries[r.id].window === r.window && <small className="status warn">{t("deferredAlert").replace("%@", state.window ? `${String(Math.floor(state.window.start / 60)).padStart(2, "0")}:${String(state.window.start % 60).padStart(2, "0")} · ${state.window.tz}` : t("start"))}</small>}
                      <small><span>{t(r.repeat ? "repeatingAlert" : "oneShotAlert")}</span>{r.seen_fired > 0 && <span title={new Date(r.seen_fired * 1000).toLocaleString(state.lang)}>{t("lastAlert").replace("%@", relativeTime(r.seen_fired, state.lang))}</span>}</small>
                    </div>
                    <div className="rule-controls"><input type="checkbox" className="switch" aria-label={t("alerts")} checked={r.enabled} onChange={() => gated(() => update((s) => ({ ...s, rules: s.rules.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled, updated: Math.max(fresh(), x.updated + 1) } : x) })))} /><details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div><button onClick={() => gated(() => { setEditingRule(r); setPanel("rule"); })}><Icon name="edit" />{t("edit")}</button><button className="danger" onClick={() => remove("rules", r.id)}><Icon name="delete" />{t("delete")}</button></div></details></div>
                  </div>
                ))}</section>}
                <section className="card">
                  <div className="card-heading">
                    <h2>{t("pushWindow")}</h2>
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
                              if (
                                !Number.isFinite(h + m) ||
                                h * 60 + m ===
                                  state.window![
                                    key === "start" ? "end" : "start"
                                  ]
                              )
                                return;
                              update((s) => ({
                                ...s,
                                window: { ...s.window!, [key]: h * 60 + m },
                                settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1),
                              }));
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
        <footer className="main-foot">
          <span>Pearl Hub</span>
          <div className="main-foot-links">
            <a href="https://github.com/terryops/prl-hub-web" target="_blank" rel="noreferrer">
              {t("webSource")} <Icon name="external" />
            </a>
            <a href="https://t.me/prl_hub" target="_blank" rel="noreferrer">
              {t("support")} <Icon name="external" />
            </a>
          </div>
        </footer>
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
        className={panel === "appqr" ? "app-qr-dialog" : panel === "settings" || panel === "security" ? "settings-dialog" : panel === "account" || panel === "restore" ? "account-dialog" : panel === "payment" ? "payment-dialog" : undefined}
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setPanel(null);
        }}
      >
        <div className={`dialog-content ${panel === "payment" ? "payment-content" : ""}`}>
          <div className="dialog-heading">
            <h2>
              {panel === "appqr" ? t("appShowQR") : panel === "payment" || panel === "pro"
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
          {panel === "appqr" && <div className="app-qr-content"><QR value={appStoreURL} /><p>{t("appScanDownload")}</p></div>}
          {panel === "settings" && (
            <>
              <div className="setting-section appearance-settings">
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
                    <option value="system">{t("browserLanguage")}</option>
                    {langs.map((l) => (
                      <option key={l} value={l}>
                        {languageNames[l]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-toggle"><span>{t("autoRefresh")}</span><input type="checkbox" className="switch" checked={state.autoRefresh !== false} onChange={(e) => update((s) => ({ ...s, autoRefresh: e.target.checked, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))} /></label>
              </div>
              <details className="settings-group display-options">
                <summary>{t("moreDisplayOptions")}<Icon name="chevron" /></summary>
                <div className="settings-group-body">
                <label className="form-field">{t("secondaryCurrency")}<select aria-label={t("secondaryCurrency")} value={state.secondary || (state.secondary === "" ? "" : "__auto__")} onChange={(e) => update((s) => ({ ...s, secondary: e.target.value, settingsUpdated: Math.max(fresh(), s.settingsUpdated + 1) }))}><option value="__auto__">{t("followLanguage")}</option><option value="">{t("hideCurrency")}</option>{currencies.map(([code, symbol]) => <option key={code} value={code}>{code} · {symbol}</option>)}</select></label>
                <p className="muted">{fx?.rates[secondaryCode(state.secondary, state.lang)] ? rateLine(secondaryCode(state.secondary, state.lang), fx.rates[secondaryCode(state.secondary, state.lang)], state.lang) : "—"}<br />{t("updated")} · {fx ? new Date(fx.ts * 1000).toLocaleString(state.lang) : "—"}{fx?.stale && <> · {t("stale")}</>}</p>
                </div>
              </details>
              <p className="settings-saved muted">{t("settingsSaved")}</p>
              <button className="security-entry" onClick={() => { dialog.current?.scrollTo({ top: 0 }); setPanel("security"); }}><Icon name="shield" /><span>{securityCopy(state.lang).title}</span><Icon name="chevron" className="security-entry-chevron" /></button>
              <div className="settings-links">
                <a href="https://t.me/prl_hub" target="_blank" rel="noreferrer">{t("support")} <Icon name="external" /></a>
                <a href="/privacy.html" target="_blank" rel="noreferrer">{t("privacy")} <Icon name="external" /></a>
              </div>
            </>
          )}
          {panel === "security" && <>
            <button className="security-back" onClick={() => { dialog.current?.scrollTo({ top: 0 }); setPanel("settings"); }}><Icon name="chevron" />{securityCopy(state.lang).back}</button>
            <SecurityOverview lang={state.lang} sections={webSecurity} />
          </>}
          {(panel === "account" || panel === "restore") && (
            <AccountPanel restore={panel === "restore" && !canSync} accountId={accountReady ? state.accountId : ""} lang={state.lang} auth={availability.auth} onLogin={(a) => adoptAccount(a)} onLogout={leaveAccount} purchases={(
                <div className="setting-section">
                  <div className="card-heading">
                    <div>
                      <h3>{t("pro")}</h3>
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
                  {!me?.pro && !fromApp && <p className="muted">{t("appPurchaseLink")}</p>}
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
                  <h3>{t("sync")}</h3>
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
                <p className="muted">{canSync ? t("proSyncNote") : t("syncRequiresPro")}</p>
                {canSync && <p className="muted">{accountCopy(state.lang).syncNote}</p>}
                {!canSync && <button className="primary" onClick={showPro}>{t(fromApp ? "learnMore" : "buy")}</button>}
                {canSync && state.sync && (
                  <div className="actions">
                    <button disabled={syncing} onClick={() => void sync()}>
                      {syncing ? t("loading") : t("syncNow")}
                    </button>
                    <small role="status">{syncStatus}</small>
                  </div>
                )}
              </div>
            </AccountPanel>
          )}
          {panel === "wallet" && <WatchAddressForm t={t} lang={state.lang} initial={draftAddress} onSave={(label, addr) => {
            if (!/^prl1[0-9a-z]{20,100}$/.test(addr)) { setMessage(t("invalid")); return; }
            if (alive(state.wallets).length >= 10) { setMessage(t("limit")); return; }
            update((s) => ({ ...s, wallets: [...s.wallets, { id: uid(), updated: fresh(), label: label || addr.slice(0, 12), addr }] }));
            setPanel(null);
          }} />}
          {panel === "monitor" && (
            <TargetForm
              t={t}
              key={editingMonitor?.id || "new"}
              initial={draftAddress}
              initialMonitor={editingMonitor}
              lang={state.lang}
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
          {panel === "rule" && (
            <RuleForm
              key={editingRule?.id || "new"}
              initialRule={editingRule}
              t={t}
              onSave={(kind, value, window, repeat) => {
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
              }}
            />
          )}
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
function TargetForm({
  t,
  onSave,
  initial = "",
  initialMonitor,
  lang,
}: {
  t: (k: TextKey) => string;
  lang: State["lang"];
  initial?: string;
  initialMonitor?: Monitor | null;
  onSave: (name: string, target: string, pool: string) => void;
}) {
  const [pool, setPool] = useState(initialMonitor?.pool || pools[0]);
  const [target, setTarget] = useState(initial);
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
      <label className="form-field">
        {t(pool === "F2Pool" ? "link" : "address")}
        <textarea
          name="target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
          autoComplete="off"
          rows={3}
          placeholder={
            pool === "F2Pool"
              ? "https://www.f2pool.com/mining-user/…"
              : "prl1…"
          }
        />
      </label>
      {pool === "F2Pool" && <details className="help" open><summary>{t("f2Help")}</summary><ol>{(["f2Step1", "f2Step2", "f2Step3", "f2Step4"] as const).map((k) => <li key={k}>{t(k)}</li>)}</ol><p>{t("f2Permission")}</p><p>{t("f2ReadOnly")}</p></details>}
      <div className="actions form-actions"><PasteButton t={t} onPaste={setTarget} /><button className="primary">{t("save")}</button></div>
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
          {(["above", "below", "move"] as const).map((k) => (
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
