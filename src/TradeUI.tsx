// Pieces shared by the 交易 tab, its 充值 / 提现 pages and the key pages (iOS Sources/Trade/TradeUI.swift).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import { Icon } from "./trade-icons.tsx";
import type { Tr } from "./safetrade.ts";
import type { IPIssue } from "./trade-store.ts";

// The shell's back button closes the top-most open layer of the tab (a confirm page, a menu, a dialog)
// before the page itself: each layer registers here while it's open.
const backStack: (() => void)[] = [];
export function useBackLayer(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const fn = () => latest.current();
    backStack.push(fn);
    return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
  }, [open]);
}
export const popBackLayer = () => { const top = backStack.at(-1); if (!top) return false; top(); return true; };

/** A green success line and any red error lines, full width. */
export function StatusLines({ notice, errors }: { notice?: string | null; errors: (string | null | undefined)[] }) {
  return <>
    {notice && <p className="trade-line trade-ok" role="status"><Icon name="check" /><span>{notice}</span></p>}
    {errors.filter((e): e is string => !!e).map((e) => <p key={e} className="trade-line trade-error" role="alert"><Icon name="warning" /><span>{e}</span></p>)}
  </>;
}

import { InfoTip } from "./InfoTip.tsx";
export { InfoTip };

export function CopyButton({ value, tr, className = "text-button" }: { value: string; tr: Tr; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  return <button type="button" className={className} onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {}); }}>{copied ? tr("已复制") : tr("复制")}</button>;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="trade-spinner" role={label ? "status" : undefined}><Icon name="refresh" className="spin" />{label && <span>{label}</span>}</span>;
}

/** "Your IP isn't on this key's Trusted IPs": the address SafeTrade sees, with copy, and what to do. */
export function UntrustedIPCard({ issue, tr, onGuide }: { issue: IPIssue; tr: Tr; onGuide: () => void }) {
  const v6 = !!issue.ip?.includes(":");
  const what = v6 ? tr("这是 IPv6 地址：白名单里如果只有 IPv4，可能需要把这个 IPv6 地址也加进 Trusted IPs。") : tr("把上面这个 IP 加进这把密钥的 Trusted IPs 即可。");
  return <section className="card trade-card trade-notice">
    <div className="trade-title-row warn">
      <Icon name="shield" /><strong>{tr("当前网络的 IP 不在密钥的白名单里")}</strong>
      <InfoTip label={tr("当前网络的 IP 不在密钥的白名单里")} text={[what, tr("同一个网络下，手机可能时而用 IPv4、时而用 IPv6 连接，IPv6 地址也会定期变化；换网络后 IP 也会变。开着代理或 VPN 时，这里显示的是代理的出口 IP。")].join("\n\n")} />
    </div>
    <div className="trade-ip">
      {issue.ip ? <><code>{issue.ip}</code><CopyButton value={issue.ip} tr={tr} /></> : <Spinner label={tr("正在查询…")} />}
    </div>
    <button type="button" className="text-button trade-link" onClick={onGuide}>{tr("在哪里设置 Trusted IPs")}</button>
  </section>;
}

/** A POST whose result is unknown: submitting stays locked until the history settles it. */
export function UnverifiedBanner({ text, checking, tr, recheck, dismiss }: { text: string; checking: boolean; tr: Tr; recheck: () => void; dismiss: () => void }) {
  return <section className="card trade-card trade-notice">
    <p className="trade-line trade-warn"><Icon name="help" /><span>{text}</span></p>
    <div className="trade-actions-row">
      {checking ? <Spinner label={tr("正在核对…")} /> : <>
        <button type="button" className="text-button" onClick={recheck}>{tr("重新核对")}</button>
        <button type="button" className="text-button trade-quiet" onClick={dismiss}>{tr("我已在网站核对，解除锁定")}</button>
      </>}
    </div>
  </section>;
}

/** iOS .alert: a title, a message and its own buttons (the shell's confirm() only has OK / Cancel). */
export type DialogButton = { label: string; onClick: () => void; kind?: "primary" | "danger" | "cancel" };
export function AlertDialog({ title, message, buttons, onClose }: { title: string; message?: ReactNode; buttons: DialogButton[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} className="trade-alert" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <div className="trade-alert-body"><h2>{title}</h2>{message && <p>{message}</p>}</div>
    <div className="trade-alert-buttons">
      {buttons.map((b) => <button key={b.label} type="button" className={b.kind === "primary" ? "primary" : b.kind === "danger" ? "danger" : undefined} onClick={b.onClick}>{b.label}</button>)}
    </div>
  </dialog>;
}

/** Dims the page under a centred "处理中…" while an order or a withdrawal is in flight. */
export function Processing({ shown, tr }: { shown: boolean; tr: Tr }) {
  return shown ? <div className="trade-processing" role="status"><div><Spinner /><span>{tr("处理中…")}</span></div></div> : null;
}

/** A second-level page of the tab: back to where it came from, then its title. */
export function SubPage({ back, title, onBack, children, trailing }: { back: string; title: string; onBack: () => void; children: ReactNode; trailing?: ReactNode }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return <div className="trade-sub">
    <div className="trade-sub-head">
      <button type="button" className="android-back" onClick={onBack}><Icon name="chevron" />{back}</button>
      <div className="trade-sub-title"><h1 className="android-page-title">{title}</h1>{trailing}</div>
    </div>
    {children}
  </div>;
}

export function CoinBadge({ symbol }: { symbol: string }) {
  return symbol.toUpperCase() === "USDT"
    ? <span className="trade-coin usdt" aria-hidden="true">₮</span>
    : <span className="trade-coin pearl" aria-hidden="true" />;
}

export function QR({ value, alt }: { value: string; alt: string }) {
  const src = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(value);
    q.make();
    return q.createDataURL(5, 12);
  }, [value]);
  return <img className="qr trade-qr" src={src} alt={alt} />;
}

export function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return <div className={strong ? "trade-row strong" : "trade-row"}><span>{label}</span><span>{value}</span></div>;
}

