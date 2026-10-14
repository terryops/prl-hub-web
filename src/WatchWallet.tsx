import { useEffect, useRef, useState } from "react";
import type { Address, Wallet, Price, Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { api } from "./api.ts";
import { usd } from "./format.ts";
import { relativeTime } from "./alertRules.ts";
import { Icon } from "./Icons.tsx";
import { Money, PRLAmount } from "./Money.tsx";
import { Skeleton } from "./Skeleton.tsx";

export function WatchWallet({ wallets, price, refresh, t, lang, onAdd, onRename, onRemove, onCopy, money = (v) => usd(v, lang) }: {
  wallets: Wallet[]; price?: Price; refresh: number; t: (k: TextKey) => string; lang: Lang;
  onAdd: () => void; onRename: (w: Wallet) => void; onRemove: (w: Wallet) => void; onCopy?: (value: string) => Promise<void>; money?: (x: number) => string;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, { data?: Address; failed?: boolean; loading?: boolean }>>({}), [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const generation = useRef<Record<string, number>>({});
  const addresses = useRef(new Set<string>()); addresses.current = new Set(wallets.map((w) => w.addr));
  const load = async (addr: string, page = 1) => {
    const at = generation.current[addr] = (generation.current[addr] || 0) + 1;
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
    }
  };
  const targets = wallets.map((w) => w.addr).join(",");
  useEffect(() => {
    for (const addr of addresses.current) void load(addr);
    return () => { for (const addr of Object.keys(generation.current)) generation.current[addr]++; };
  }, [targets, refresh]);
  return <>
    <div className="list-toolbar"><span className="badge">{t("readOnly")} · {wallets.length} / 10</span><button className="primary" disabled={wallets.length >= 10} onClick={onAdd}><Icon name="plus" />{t("add")}</button></div>
    {!wallets.length && <section className="card empty"><span><Icon name="wallet" /></span><h2>{t("noWallets")}</h2><button className="primary" onClick={onAdd}><Icon name="plus" />{t("add")}</button></section>}
    {wallets.map((w) => {
      const snap = snapshots[w.addr], data = snap?.data, more = expanded[w.id];
      return <section className="card wallet-card" key={w.id}>
        <div className="card-heading"><h2>{w.label}</h2><details className="menu"><summary aria-label={t("manage")}><Icon name="more" /></summary><div><button onClick={() => onRename(w)}><Icon name="rename" />{t("rename")}</button><button className="danger" onClick={() => onRemove(w)}><Icon name="delete" />{t("delete")}</button></div></details></div>
        <div className="wallet-address"><code className="watch-address" title={w.addr}><span className="address-full">{w.addr}</span><span className="address-short">{w.addr.slice(0, 8)}…{w.addr.slice(-5)}</span></code><button className="icon-button" aria-label={t("copy")} onClick={() => { if (onCopy) void onCopy(w.addr); }}><Icon name="copy" /></button></div>
        {!data && !snap?.failed ? <><Skeleton label={t("loading")} kind="balance" /><Skeleton label={t("loading")} /></> : data && <>
          <div className="wallet-balance"><small>{t("balance")}</small><strong><PRLAmount value={data.balance} lang={lang} /></strong>{price && <Money amount={money(Number(BigInt(data.balance)) / 1e8 * price.usd)} />}</div>
          <p>{t("unconfirmed")} · <PRLAmount value={data.unconfirmed} lang={lang} /></p><h3>{t("transactions")}</h3>
          {data.history.length === 0 && <p className="muted">{t("noTransactions")}</p>}
          <div className="wallet-transactions">{(more ? data.history : data.history.slice(0, 8)).map((tx) => {
            const sent = tx.sent ?? BigInt(tx.delta) < 0n;
            const value = tx.amount == null ? tx.delta : (sent ? "-" : "") + tx.amount;
            return <div className="wallet-transaction-row" key={tx.txid}><a href={`https://blockbook.pearlresearch.ai/tx/${encodeURIComponent(tx.txid)}`} target="_blank" rel="noreferrer" className="wallet-transaction">
              <span className={`transaction-direction ${sent ? "negative" : "positive"}`}><Icon name={sent ? "sent" : "received"} /></span>
              <span className="transaction-info"><span>{t(sent ? "sent" : "received")}</span><time title={tx.time ? new Date(tx.time * 1000).toLocaleString(lang) : undefined}>{tx.time ? relativeTime(tx.time, lang) : "—"}</time></span>
              <span className="transaction-value"><strong className={sent ? "negative" : "positive"}><PRLAmount value={value} lang={lang} signed /></strong><small>{tx.confirmations.toLocaleString(lang)} {t("confirmations")}</small>{sent && tx.fee != null && <small>{t("networkFee")} · <PRLAmount value={tx.fee} lang={lang} /></small>}</span>
            </a>{tx.address && <div className="wallet-address transaction-peer"><small>{t(sent ? "recipient" : "sender")}</small><code className="watch-address" title={tx.address}><span className="address-full">{tx.address}</span><span className="address-short">{tx.address.slice(0, 8)}…{tx.address.slice(-5)}</span></code><button className="icon-button" aria-label={t("copy")} onClick={() => { if (onCopy) void onCopy(tx.address!); }}><Icon name="copy" /></button></div>}</div>;
          })}</div>{(data.history.length > 8 || data.hasMore) && <div className="wallet-history-actions">{data.history.length > 8 && <button aria-expanded={!!more} onClick={() => setExpanded((s) => ({ ...s, [w.id]: !more }))}>{t(more ? "collapse" : "showMore")}</button>}
          {data.hasMore && (more || data.history.length <= 8) && <button disabled={snap?.loading} onClick={() => { setExpanded((s) => ({ ...s, [w.id]: true })); void load(w.addr, (data.page || 1) + 1); }}>{t(snap?.loading ? "loading" : "loadMore")}</button>}</div>}
        </>}
        {snap?.failed && <p className="status warn">{t(data ? "stale" : "error")}</p>}
      </section>;
    })}
  </>;
}
