import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api.ts";
import { accountCopy } from "./account-copy.ts";
import { configOf, readAccount, defaults } from "./store.ts";
import { Icon } from "./Icons.tsx";
import { dictionaries } from "./i18n/index.ts";
import type { Availability, Lang } from "./types.ts";

export type Account = { user_id: string; email: string; device_id: string; pro?: boolean };
type Proof = { challenge_id: string; code: string };
type Purpose = "login" | "delete" | "change_old" | "change_new";
type Turnstile = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }
let script: Promise<void> | undefined;
function loadTurnstile() {
  return script ||= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    const fail = () => { clearTimeout(timeout); el.remove(); script = undefined; reject(new Error("human")); };
    const timeout = setTimeout(fail, 15_000);
    el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    el.async = true; el.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(); else fail(); };
    el.onerror = fail;
    document.head.append(el);
  });
}
export function browserDevice() {
  const key = "prl.account.device";
  let id = localStorage.getItem(key);
  if (!id || !/^[A-Za-z0-9_-]{16,80}$/.test(id)) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return { device_id: id, platform: "web", device_name: /Edg\//.test(navigator.userAgent) ? "Edge" : /Firefox\//.test(navigator.userAgent) ? "Firefox" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : /Safari\//.test(navigator.userAgent) ? "Safari" : "Web" };
}
export function accountError(error: unknown, lang: Lang) {
  const c = accountCopy(lang), key = error instanceof Error ? error.message : "";
  return key === "rate_limited" ? c.limited : key.startsWith("human") ? c.humanError : key === "accounts_unavailable" || key === "email_unavailable" ? c.unavailable : key === "invalid_code" ? c.invalid : c.failed;
}
function EmailProof({ purpose, email: fixed, accountId = "", lang, siteKey, onProof }: { purpose: Purpose; email?: string; accountId?: string; lang: Lang; siteKey: string; onProof: (proof: Proof) => Promise<void> }) {
  const c = accountCopy(lang), container = useRef<HTMLDivElement>(null), widget = useRef<string | undefined>(undefined);
  const [email, setEmail] = useState(fixed || ""), [human, setHuman] = useState(""), [humanNeeded, setHumanNeeded] = useState(false), [sendPending, setSendPending] = useState(false), [challenge, setChallenge] = useState(""), [code, setCode] = useState(""), [retryAt, setRetryAt] = useState(0), [clock, setClock] = useState(Date.now()), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    if (!humanNeeded) return;
    let disposed = false;
    const failed = () => { if (!disposed) { setHuman(""); setSendPending(false); setHumanNeeded(false); setMessage(c.humanError); } };
    void loadTurnstile().then(() => {
      if (disposed) return;
      if (!container.current || !window.turnstile) { failed(); return; }
      widget.current = window.turnstile.render(container.current, { sitekey: siteKey, action: `email_${purpose}`, size: innerWidth < 480 ? "compact" : "flexible", theme: "auto", "refresh-expired": "manual", callback: (proof: string) => { if (!disposed) setHuman(proof); }, "expired-callback": failed, "error-callback": failed });
    }).catch(failed);
    return () => { disposed = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = undefined; };
  }, [humanNeeded, siteKey, purpose, c.humanError]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const send = async (proof = human) => {
    setBusy(true); setMessage(c.loading); setHumanNeeded(false);
    try {
      const result = await api<{ challenge_id: string; resend_after: number }>("/v1/auth/email/start", "POST", { email, purpose, lang, turnstile: proof }, accountId);
      setChallenge(result.challenge_id); setCode(""); setRetryAt(Date.now() + result.resend_after * 1000); setMessage(c.sent);
    } catch (e) { setMessage(accountError(e, lang)); }
    finally { setBusy(false); setHuman(""); setSendPending(false); }
  };
  useEffect(() => { if (sendPending && human && !busy) { setSendPending(false); void send(human); } }, [sendPending, human, busy]);
  const requestSend = () => {
    if (busy || sendPending || Date.now() < retryAt) return;
    setHuman(""); setMessage(c.human); setSendPending(true); setHumanNeeded(true);
  };
  return <form className="account-form" onSubmit={(e) => { e.preventDefault(); if (busy || sendPending) return; if (!challenge) { requestSend(); return; } setBusy(true); setMessage(""); void onProof({ challenge_id: challenge, code }).catch((e) => setMessage(accountError(e, lang))).finally(() => setBusy(false)); }}>
    <label>{c.email}<input type="email" value={email} disabled={!!fixed || busy || sendPending || !!challenge} required maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} /></label>
    <div ref={container} className="account-human" aria-label={c.human} hidden={!humanNeeded} />
    {challenge && <label>{c.code}<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} required disabled={busy || sendPending} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>}
    <div className="actions">
      {challenge && <button type="submit" className="primary" disabled={busy || sendPending || code.length !== 6}>{busy ? c.loading : c.verify}</button>}
      <button type={challenge ? "button" : "submit"} className={challenge ? undefined : "primary"} disabled={busy || sendPending || clock < retryAt || !email.includes("@")} onClick={challenge ? requestSend : undefined}>{challenge ? c.resend : c.send}{clock < retryAt ? ` (${Math.ceil((retryAt - clock) / 1000)})` : ""}</button>
      {challenge && !fixed && <button type="button" disabled={busy || sendPending} onClick={() => { setChallenge(""); setCode(""); setHumanNeeded(false); setHuman(""); setMessage(""); }}>{c.change}</button>}
    </div>
    {message && <p role="status" className="muted">{message}</p>}
  </form>;
}
const connection = (() => {
  const q = new URLSearchParams(location.search);
  if (q.get("account") !== "connect") return null;
  return { redirect_uri: q.get("redirect_uri"), code_challenge: q.get("code_challenge"), device_id: q.get("device_id"), platform: q.get("platform"), device_name: q.get("device_name"), state: q.get("state"), reauth: q.get("reauth") === "1" };
})();
export const connectingDevice = !!connection;
// Read once at load like the connect parameters: the page removes ?account= from the address bar,
// and only the first account panel opened from a delete link enters delete mode.
let deleteRequested = new URLSearchParams(location.search).get("account") === "delete";
type Device = { id: string; name: string; platform: string; seen_at: number; current: boolean; notifications: boolean };
type Grant = { source: string; platform: string; granted_at: number; revoked_at: number | null };
export function AccountPanel({ accountId, lang, auth, onLogin, onLogout, onEmail, children, purchases, restore = false }: { accountId: string; lang: Lang; auth?: Availability["auth"]; onLogin: (account: Account) => Promise<void>; onLogout: (expected?: string) => Promise<void>; onEmail?: (email: string) => void; children?: ReactNode; purchases?: ReactNode; restore?: boolean }) {
  const c = accountCopy(lang), [account, setAccount] = useState<Account | null>(null), [devices, setDevices] = useState<Device[]>([]), [rights, setRights] = useState<Grant[]>([]), [mode, setMode] = useState<"normal" | "delete" | "change">("normal"), [old, setOld] = useState<Proof | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const deleteLink = useRef(deleteRequested);
  const sensitive = useRef<HTMLDivElement>(null);
  const [reauth, setReauth] = useState(false);
  const currentAccount = useRef(accountId); currentAccount.current = accountId;
  useEffect(() => { if (mode !== "normal") sensitive.current?.scrollIntoView({ block: "center" }); }, [mode, account]);
  useEffect(() => {
    let disposed = false; setAccount(null); setDevices([]); setRights([]); setMode("normal"); setOld(null); setBusy(false); setMessage(""); setReauth(false);
    if (accountId) void Promise.all([api<Account>("/v1/account", "GET", undefined, accountId), api<{ devices: Device[] }>("/v1/account/devices", "GET", undefined, accountId), api<{ entitlements: Grant[] }>("/v1/account/entitlements", "GET", undefined, accountId)]).then(([a, d, r]) => { if (!disposed) { setAccount(a); onEmail?.(a.email); setDevices(d.devices); setRights(r.entitlements); if (deleteLink.current) { deleteLink.current = deleteRequested = false; setMode("delete"); } } }).catch((e) => { if (!disposed) setMessage(accountError(e, lang)); });
    return () => { disposed = true; };
  }, [accountId, lang]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMessage(""); try { await fn(); } catch (e) { if (currentAccount.current === accountId) setMessage(accountError(e, lang)); } finally { if (currentAccount.current === accountId) setBusy(false); } };
  return <div className="setting-section account-section">
    {restore && <section className="restore-purchase-guide" aria-label={dictionaries[lang].restorePurchase}>
      <p>{dictionaries[lang].restorePurchaseIntro}</p>
      <h3>{dictionaries[lang].restorePurchaseGuideTitle}</h3>
      <ol><li>{dictionaries[lang].restorePurchaseAppStep}</li><li>{dictionaries[lang].restorePurchaseWebStep}</li></ol>
      <p className="muted">{dictionaries[lang].restorePurchaseHelp}</p>
    </section>}
    {!accountId ? <>{!restore && <p className="muted">{c.intro}</p>}{auth?.enabled && auth.site_key ? <EmailProof key="login" purpose="login" lang={lang} siteKey={auth.site_key} onProof={async (proof) => { const a = await api<Account>("/v1/auth/email/verify", "POST", { ...proof, ...browserDevice() }); if (currentAccount.current === accountId) await onLogin(a); }} /> : <p role="status" className="muted">{c.unavailable}</p>}</> : !account ? <p>{c.loading}</p> : <>
      <div className="account-profile"><span className="account-avatar"><Icon name="account" /></span><p className="account-email">{account.email}</p><button disabled={busy} onClick={() => void run(async () => { await api("/v1/auth/logout", "POST", {}, accountId); await onLogout(accountId); })}>{c.logout}</button></div>
      {connection && <div className="account-connect"><p>{c.authorizeNote} <strong>{connection.device_name || connection.platform}</strong></p>{reauth && auth?.site_key ? <EmailProof purpose="login" email={account.email} lang={lang} siteKey={auth.site_key} onProof={async (proof) => { const a = await api<Account>("/v1/auth/email/verify", "POST", { ...proof, ...browserDevice() }); if (currentAccount.current === accountId) await onLogin(a); setReauth(false); }} /> : <button disabled={busy} className="primary" onClick={() => void run(async () => { if (!connection.state || !/^[A-Za-z0-9_-]{43}$/.test(connection.state)) throw new Error("bad_callback"); let result; try { result = await api<{ code: string }>("/v1/auth/authorize", "POST", connection, accountId); } catch (e) { if (e instanceof ApiError && e.message === "fresh_login_required") { setReauth(true); return; } throw e; } if (currentAccount.current !== accountId) return; const url = new URL(connection.redirect_uri!); url.searchParams.set("code", result.code); url.searchParams.set("state", connection.state); location.assign(url.href); })}>{c.authorize}</button>}</div>}
      {children}
      <details className="settings-group account-device-group"><summary>{c.devices}<span className="group-count">{devices.length}</span><Icon name="chevron" /></summary><div className="settings-group-body account-devices">{devices.map((d) => <div className="account-device" key={d.id}><div><strong>{d.name}</strong><small>{d.platform} · {d.current ? c.current : new Date(d.seen_at * 1000).toLocaleString(lang)}{d.notifications ? ` · ${c.notifications}` : ""}</small></div><div className="actions"><button disabled={busy} onClick={() => { const name = prompt(c.rename, d.name); if (name?.trim()) void run(async () => { await api(`/v1/account/devices/${d.id}`, "PATCH", { name: name.trim() }, accountId); if (currentAccount.current !== accountId) return; setDevices((xs) => xs.map((x) => x.id === d.id ? { ...x, name: name.trim() } : x)); }); }}>{c.rename}</button><button disabled={busy} onClick={() => { if (confirm(c.revokeConfirm)) void run(async () => { await api(`/v1/account/devices/${d.id}`, "DELETE", {}, accountId); if (currentAccount.current !== accountId) return; if (d.current) await onLogout(accountId); else setDevices((xs) => xs.filter((x) => x.id !== d.id)); }); }}>{c.revoke}</button></div></div>)}</div></details>
      <details className="settings-group account-purchases"><summary>{c.rights}<Icon name="chevron" /></summary><div className="settings-group-body">{purchases}{rights.length ? rights.map((r, i) => <p className="muted" key={i}>{r.source === "apple" ? c.apple : r.source === "prl" ? c.prl : c.admin} · {c.proRights} · {new Date(r.granted_at * 1000).toLocaleDateString(lang)}{r.revoked_at ? ` · ${c.revoked}` : ""}</p>) : <p className="muted">{c.noRights}</p>}<p className="muted">{c.rightsNote}</p></div></details>
      <details className="settings-group account-security" open={mode !== "normal" || undefined}><summary>{c.security}<Icon name="chevron" /></summary><div className="settings-group-body">
      <div className="actions"><button disabled={busy} onClick={() => { setMode("change"); setOld(null); }}>{c.change}</button><button disabled={busy} onClick={() => void run(async () => { const data = { schema_version: 1, data: configOf(readAccount(accountId) || defaults()) }; if (currentAccount.current !== accountId) return; const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "pearl-hub-settings.json"; a.click(); URL.revokeObjectURL(url); })}>{c.export}</button><button className="danger" disabled={busy} onClick={() => { if (confirm(c.deleteConfirm)) setMode("delete"); }}>{c.remove}</button></div>
      {mode !== "normal" && auth?.site_key && <div className="account-sensitive" ref={sensitive}><h4>{mode === "delete" ? c.remove : old ? c.newEmail : c.oldEmail}</h4>{mode === "delete" && <p className="muted">{c.deleteConfirm}</p>}<EmailProof key={`${mode}:${!!old}`} purpose={mode === "delete" ? "delete" : old ? "change_new" : "change_old"} email={mode === "delete" || !old ? account.email : undefined} accountId={accountId} lang={lang} siteKey={auth.site_key} onProof={async (proof) => { if (mode === "delete") { await api("/v1/account", "DELETE", proof, accountId); await onLogout(accountId); } else if (!old) setOld(proof); else { const result = await api<{ email: string }>("/v1/account/email", "POST", { old, next: proof }, accountId); if (currentAccount.current !== accountId) return; setAccount({ ...account, email: result.email }); onEmail?.(result.email); setDevices((ds) => ds.filter((d) => d.current)); setMode("normal"); setMessage(c.changed); } }} /><button onClick={() => setMode("normal")}>{c.cancel}</button></div>}
      </div></details>
    </>}
    <p className="muted account-privacy">{c.privacy}</p>{message && <p role="status">{message}</p>}
  </div>;
}
