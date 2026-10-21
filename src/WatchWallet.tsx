import { useEffect, useRef, useState } from "react";
import type { Address, Wallet, Price, Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { api } from "./api.ts";
import { usd } from "./format.ts";
import { relativeTime } from "./alertRules.ts";
import { Icon } from "./Icons.tsx";
import { PRLAmount } from "./Money.tsx";
import { Skeleton } from "./Skeleton.tsx";

import { EXPLORER } from "./txid.ts";
// Same split as the wallet extension: two decimals at full size, the rest smaller.
function balanceParts(value: string, lang: Lang) {
  const n = BigInt(value), v = n < 0n ? -n : n;
  const fraction = (v % 100000000n).toString().padStart(8, "0").replace(/0+$/, "").padEnd(2, "0");
  const decimal = (1.1).toLocaleString(lang).replace(/1/g, "");
  return { head: `${n < 0n ? "−" : ""}${(v / 100000000n).toLocaleString(lang)}${decimal}${fraction.slice(0, 2)}`, tail: fraction.slice(2) };
}
const short = (addr: string) => <><span className="address-full">{addr}</span><span className="address-short">{addr.slice(0, 8)}…{addr.slice(-5)}</span></>;

// One watched address at a time, laid out like the wallet extension and the app's wallet tab.
export function WatchWallet({ wallets, selected, onSelect = () => {}, price, refresh, t, lang, onAdd, onRename, onRemove, onReceive, onSend, onLookup, onCopy, money = (v) => usd(v, lang) }: {
  wallets: Wallet[]; selected?: string; onSelect?: (id: string) => void; price?: Price; refresh: number; t: (k: TextKey) => string; lang: Lang;
  onAdd: () => void; onRename: (w: Wallet) => void; onRemove: (w: Wallet) => void; onReceive?: (w: Wallet) => void; onSend?: () => void; onLookup?: () => void; onCopy?: (value: string) => Promise<void>; money?: (x: number) => string;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, { data?: Address; failed?: boolean; loading?: boolean }>>({}), [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const generation = useRef<Record<string, number>>({}), loading = useRef<Record<string, boolean>>({});
  const addresses = useRef(new Set<string>()); addresses.current = new Set(wallets.map((w) => w.addr));
  const switcher = useRef<HTMLDetailsElement>(null);
  const load = async (addr: string, page = 1) => {
    const at = generation.current[addr] = (generation.current[addr] || 0) + 1;
    loading.current[addr] = true;
    setSnapshots((s) => ({ ...s, [addr]: { ...s[addr], loading: true } }));
    try {
      const data = await api<Address>("/v1/address", "POST", { addr, page });
      if (generation.current[addr] !== at || !addresses.current.has(addr)) return;
      setSnapshots((s) => {
        const old = s[addr]?.data;
        // Refresh the first page without discarding pages the user already opened.
        const history = [...new Map([...(old?.history || []), ...data.history].map((tx) => [tx.txid, tx])).values()].sort((a, b) => b.time - a.time);
        return { ...s, [addr]: { data: { ...data, history, ...(page === 1 && (old?.page || 1) > 1 ? { page: old!.page, hasMore: old!.hasMore } : {}) } } };
      });
    } catch {
      if (generation.current[addr] === at && addresses.current.has(addr)) setSnapshots((s) => ({ ...s, [addr]: { ...s[addr], loading: false, failed: true } }));
    } finally {
      if (generation.current[addr] === at) loading.current[addr] = false;
    }
  };
  const targets = wallets.map((w) => w.addr).join(",");
  useEffect(() => {
    for (const addr of addresses.current) void load(addr);
    return () => { for (const addr of Object.keys(generation.current)) generation.current[addr]++; };
  }, [targets]);
  // Each refresh tick reloads page 1, but skips an address whose request is still in flight so the
  // tick cannot cancel a "load more" (or pile up behind a slow response).
  useEffect(() => {
    for (const addr of addresses.current) if (!loading.current[addr]) void load(addr);
  }, [refresh]);
  useEffect(() => {
    const dismissOutside = (event: Event) => {
      if (switcher.current?.open && !switcher.current.contains(event.target as Node)) switcher.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !switcher.current?.open) return;
      switcher.current.open = false;
      switcher.current.querySelector("summary")?.focus();
      event.preventDefault();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const add = <button className="primary" disabled={wallets.length >= 10} onClick={onAdd}><Icon name="plus" />{t("add")}</button>;
  const count = <span className="badge">{t("readOnly")} · {wallets.length} / 10</span>;
  const w = wallets.find((x) => x.id === selected) || wallets[0];
  if (!w) return <>
    <div className="list-toolbar">{count}{add}</div>
    <section className="card empty"><span><Icon name="wallet" /></span><h2>{t("noWallets")}</h2><button className="primary" onClick={onAdd}><Icon name="plus" />{t("add")}</button>{onLookup && <> <button onClick={onLookup}><Icon name="search" />{t("txLookup")}</button></>}</section>
  </>;
  const snap = snapshots[w.addr], data = snap?.data, more = expanded[w.id];
  const balance = data && balanceParts(data.balance, lang);
  return <>
    <div className="list-toolbar wallet-bar">
      <div className="wallet-bar-name">
        <details className="wallet-switcher" ref={switcher}>
          <summary aria-label={`${t("selectWallet")}: ${w.label}`} title={t("selectWallet")}><span>{w.label}</span><Icon name="chevron" /></summary>
          <div className="wallet-switcher-menu">{wallets.map((x) => {
            const d = snapshots[x.addr]?.data;
            return <button key={x.id} aria-current={x.id === w.id || undefined} onClick={() => { if (switcher.current) switcher.current.open = false; onSelect(x.id); }}>
              <span className="wallet-switcher-label"><strong>{x.label}</strong><code>{x.addr.slice(0, 8)}…{x.addr.slice(-5)}</code></span>
              <span className="wallet-switcher-balance">{d ? <PRLAmount value={d.balance} lang={lang} /> : "—"}</span>
              <Icon name="check" className="wallet-switcher-check" />
            </button>;
          })}</div>
        </details>
        <details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div><button onClick={() => onRename(w)}><Icon name="rename" />{t("rename")}</button><button className="danger" onClick={() => onRemove(w)}><Icon name="delete" />{t("delete")}</button></div></details>
      </div>
      <div className="wallet-bar-actions">{count}{add}</div>
    </div>
    <section className="wallet-hero" key={w.id}>
      <div className="wallet-hero-top"><span>{t("confirmedBalance")}</span>{price && <span className="price-chip"><span>PRL</span><strong>{usd(price.usd, lang)}</strong></span>}</div>
      {!data && !snap?.failed ? <Skeleton label={t("loading")} kind="balance" /> : <>
        <div className="wallet-hero-balance" data-long={(balance?.head.length || 0) > 12}>
          <span className="sr-only">{t("confirmedBalance")} {balance ? `${balance.head}${balance.tail}` : "—"} PRL</span>
          <span aria-hidden="true">{balance ? <>{balance.head}<span className="balance-tail">{balance.tail}</span></> : "—"}</span><small aria-hidden="true">PRL</small>
        </div>
        <p className="wallet-hero-fiat">{data && price ? `≈ ${money(Number(BigInt(data.balance)) / 1e8 * price.usd)}` : "—"}</p>
        <p className="wallet-hero-status">{t("unconfirmed")} · <PRLAmount value={data?.unconfirmed} lang={lang} /></p>
      </>}
    </section>
    <div className="wallet-actions" data-count={2 + (onSend ? 1 : 0) + (onLookup ? 1 : 0)}>
      <button onClick={() => onReceive?.(w)}><span className="action-icon"><Icon name="qr" /></span><span>{t("receive")}</span></button>
      {/* This page only watches; sending happens in the wallet extension, so Send opens its guide. */}
      {onSend && <button onClick={onSend}><span className="action-icon"><Icon name="send" /></span><span>{t("walletSend")}</span></button>}
      <a href={`${EXPLORER}/address/${encodeURIComponent(w.addr)}`} target="_blank" rel="noreferrer"><span className="action-icon"><Icon name="external" /></span><span>{t("explorer")}</span></a>
      {onLookup && <button onClick={onLookup}><span className="action-icon"><Icon name="search" /></span><span>{t("txLookupShort")}</span></button>}
    </div>
    <section className="wallet-address-card">
      <div className="wallet-address-head"><span>{t("address")}</span><button onClick={() => { if (onCopy) void onCopy(w.addr); }}><Icon name="copy" />{t("copy")}</button></div>
      <code className="watch-address">{w.addr}</code>
      <p>{t("singleAddressNote")}</p>
    </section>
    <section className="card wallet-card">
      <h2>{t("transactions")}</h2>
      {!data ? !snap?.failed && <Skeleton label={t("loading")} /> : <>
        {data.history.length === 0 && <p className="muted">{t("noTransactions")}</p>}
        <div className="wallet-transactions">{(more ? data.history : data.history.slice(0, 8)).map((tx) => {
          const sent = tx.sent ?? BigInt(tx.delta) < 0n;
          const value = tx.amount == null ? tx.delta : (sent ? "-" : "") + tx.amount;
          return <div className="wallet-transaction-row" key={tx.txid}><a href={`${EXPLORER}/tx/${encodeURIComponent(tx.txid)}`} target="_blank" rel="noreferrer" className="wallet-transaction">
            <span className={`transaction-direction ${sent ? "negative" : "positive"}`}><Icon name={sent ? "sent" : "received"} /></span>
            <span className="transaction-info"><span>{t(sent ? "sent" : "received")}</span><small className="transaction-meta"><time title={tx.time ? new Date(tx.time * 1000).toLocaleString(lang) : undefined}>{tx.time ? relativeTime(tx.time, lang) : "—"}</time> · <span>{tx.confirmations.toLocaleString(lang)} {t("confirmations")}</span></small></span>
            <span className="transaction-value"><strong className={sent ? "negative" : "positive"}><PRLAmount value={value} lang={lang} signed /></strong>{sent && tx.fee != null && <small>{t("networkFee")} · <PRLAmount value={tx.fee} lang={lang} /></small>}</span>
          </a>{tx.address && <div className="wallet-address transaction-peer"><small>{t(sent ? "recipient" : "sender")}</small><code className="watch-address" title={tx.address}>{short(tx.address)}</code><button className="icon-button" aria-label={t("copy")} onClick={() => { if (onCopy) void onCopy(tx.address!); }}><Icon name="copy" /></button></div>}</div>;
        })}</div>{(data.history.length > 8 || data.hasMore) && <div className="wallet-history-actions">{data.history.length > 8 && <button aria-expanded={!!more} onClick={() => setExpanded((s) => ({ ...s, [w.id]: !more }))}>{t(more ? "collapse" : "showMore")}</button>}
        {data.hasMore && (more || data.history.length <= 8) && <button disabled={snap?.loading} onClick={() => { setExpanded((s) => ({ ...s, [w.id]: true })); void load(w.addr, (data.page || 1) + 1); }}>{t(snap?.loading ? "loading" : "loadMore")}</button>}</div>}
      </>}
      {snap?.failed && <p className="status warn">{t(data ? "stale" : "error")}</p>}
    </section>
  </>;
}
