import { useEffect, useRef, useState } from "react";
import type { Lang, TxDetail, TxRow } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { api, ApiError } from "./api.ts";
import { prl } from "./format.ts";
import { relativeTime } from "./alertRules.ts";
import { Icon } from "./Icons.tsx";
import { PasteButton } from "./NativeControls.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { EXPLORER, ownFirst, parseTxid, txView } from "./txid.ts";
import { decodeRawTx, type RawTx } from "./rawtx.ts";

type T = (k: TextKey) => string;
// Rows per side before "Show all": a pool payout lists hundreds of outputs.
const FIRST_ROWS = 10;
// Every digit, unlike PRLAmount's four: a lookup is for checking exact amounts.
const Amount = ({ value, lang, signed = false }: { value: string; lang: Lang; signed?: boolean }) =>
  <span className={BigInt(value) < 0n ? "negative" : signed && BigInt(value) > 0n ? "positive" : undefined}>{signed && BigInt(value) > 0n ? "+" : ""}{prl(value, 8, lang)} <span className="prl-unit">PRL</span></span>;
const short = (addr: string) => <><span className="address-full">{addr}</span><span className="address-short">{addr.slice(0, 8)}…{addr.slice(-5)}</span></>;

function Rows({ title, count, rows, known, coinbase = false, t, lang }: { title: string; count: number; rows: TxRow[]; known: ReadonlyMap<string, string>; coinbase?: boolean; t: T; lang: Lang }) {
  const [all, setAll] = useState(false);
  return <section className="tx-side">
    <h3>{title}{!coinbase && <span className="muted">{count.toLocaleString(lang)}</span>}</h3>
    {coinbase ? <p className="tx-coinbase">{t("txCoinbase")}</p> : <ul className="tx-rows">
      {(all ? rows : rows.slice(0, FIRST_ROWS)).map((r, i) => {
        const label = r.address == null ? undefined : known.get(r.address);
        return <li key={i} className={label != null ? "mine" : undefined}>
          <span className="tx-row-address">{r.address ? <code className="watch-address" title={r.address}>{short(r.address)}</code> : <span className="muted">{r.data ? "OP_RETURN" : t("txNonstandard")}</span>}{label != null && <span className="badge">{label}</span>}</span>
          <strong className="tx-row-value"><Amount value={r.value} lang={lang} /></strong>
        </li>;
      })}
    </ul>}
    {rows.length > FIRST_ROWS && <button className="tx-show-all" aria-expanded={all} onClick={() => setAll(!all)}>{all ? t("collapse") : `${t("showAll")} (${rows.length.toLocaleString(lang)})`}</button>}
  </section>;
}

/// A looked-up transaction: status, facts, then its inputs and outputs (the user's own first).
export function TxResult({ tx, known, onCopy, rebroadcast = false, t, lang }: { tx: TxDetail; known: ReadonlyMap<string, string>; onCopy?: (value: string) => void; rebroadcast?: boolean; t: T; lang: Lang }) {
  const view = txView(tx, known), confirmed = tx.confirmations > 0;
  return <div className="tx-result">
    <div className="tx-result-head">
      <span className={confirmed ? "status" : "status warn"} role="status"><Icon name={confirmed ? "check" : "history"} />{t(confirmed ? "txConfirmed" : "unconfirmed")}</span>
      <a className="tx-explorer" href={`${EXPLORER}/tx/${tx.txid}`} target="_blank" rel="noreferrer">{t("explorer")}<Icon name="external" /></a>
    </div>
    <div className="tx-id"><code className="watch-address">{tx.txid}</code>{onCopy && <button className="icon-button" aria-label={t("copy")} title={t("copy")} onClick={() => onCopy(tx.txid)}><Icon name="copy" /></button>}</div>
    <dl className="calculation-lines tx-facts">
      <div><dt>{t("confirmations")}</dt><dd>{tx.confirmations.toLocaleString(lang)}</dd></div>
      <div><dt>{t("txBlock")}</dt><dd>{tx.height == null ? "—" : tx.height.toLocaleString(lang)}</dd></div>
      <div><dt>{t("txTime")}</dt><dd>{tx.time ? <time dateTime={new Date(tx.time * 1000).toISOString()} title={relativeTime(tx.time, lang)}>{new Date(tx.time * 1000).toLocaleString(lang)}</time> : "—"}</dd></div>
      <div><dt>{t("txTotal")}</dt><dd><Amount value={tx.value} lang={lang} /></dd></div>
      <div><dt>{t("networkFee")}</dt><dd><Amount value={tx.fee} lang={lang} /></dd></div>
      {view.net != null && <div className="tx-net"><dt>{t("txNet")}</dt><dd><Amount value={view.net} lang={lang} signed /></dd></div>}
    </dl>
    {rebroadcast && !confirmed && !tx.coinbase && <Rebroadcast txid={tx.txid} t={t} />}
    <Rows title={t("txInputs")} count={tx.inputCount} rows={view.inputs} known={known} coinbase={tx.coinbase} t={t} lang={lang} />
    <Rows title={t("txOutputs")} count={tx.outputCount} rows={view.outputs} known={known} t={t} lang={lang} />
    {(tx.inputCount > tx.inputs.length || tx.outputCount > tx.outputs.length) && <p className="muted tx-truncated">{t("txTruncated").replace("%@", Math.max(tx.inputs.length, tx.outputs.length).toLocaleString(lang))}</p>}
  </div>;
}

type Resent = { sent?: boolean; known?: boolean; confirmed?: boolean; rejected?: string; error?: "txSendRateLimited" | "txSendUnknown" | "txRebroadcastGone" };

/// Rebroadcast for an unconfirmed lookup result: the Worker takes the signed transaction from an indexer
/// that still has it and sends it to both nodes again (POST /v1/tx/send { txid }), for one the network
/// may have dropped. Shares the 5 broadcasts a minute per IP.
function Rebroadcast({ txid, t }: { txid: string; t: T }) {
  const [sending, setSending] = useState(false), [outcome, setOutcome] = useState<Resent | null>(null);
  const resend = async () => {
    setSending(true); setOutcome(null);
    try {
      const r = await api<{ known?: boolean; confirmed?: boolean }>("/v1/tx/send", "POST", { txid });
      setOutcome(r.confirmed ? { confirmed: true } : r.known ? { known: true } : { sent: true });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setOutcome(status === 422 && e instanceof ApiError ? { rejected: String(e.data.reason ?? "") }
        : { error: status === 404 ? "txRebroadcastGone" : status === 429 ? "txSendRateLimited" : "txSendUnknown" });
    } finally { setSending(false); }
  };
  const settled = outcome?.sent || outcome?.known || outcome?.confirmed;
  return <div className="tx-rebroadcast" aria-live="polite">
    {settled && <p className="status" role="status"><Icon name="check" />{t(outcome.sent ? "txRebroadcastDone" : outcome.known ? "txBroadcastKnown" : "txRebroadcastConfirmed")}</p>}
    {outcome?.rejected != null && <div className="status warn" role="alert"><p>{t("txRejected")}</p>{outcome.rejected && <code>{outcome.rejected}</code>}</div>}
    {outcome?.error && <p className="status warn" role="alert">{t(outcome.error)}</p>}
    {!settled && <button type="button" disabled={sending} onClick={() => void resend()}><Icon name="send" />{t(sending ? "txBroadcasting" : "txRebroadcast")}</button>}
  </div>;
}

type Lookup = { txid: string; data?: TxDetail; loading?: boolean; at?: number; error?: "txInvalid" | "txNotFound" | "txRateLimited" | "error" };

/// The transaction lookup dialog's content (opened from the Wallet page's actions and a Market page
/// shortcut): any PRL transaction by txid, or a pasted explorer link, through the Worker's POST /v1/tx,
/// which allows 5 lookups a minute per IP. So a shown result reloads on the page's refresh tick only
/// while it is unconfirmed, and at most once a minute.
export function TxLookup({ known, refresh, lookup: asked, onCopy, t, lang }: { known: ReadonlyMap<string, string>; refresh: number; lookup?: { txid: string; at: number }; onCopy?: (value: string) => void; t: T; lang: Lang }) {
  const [input, setInput] = useState(""), [lookup, setLookup] = useState<Lookup | null>(null);
  const request = useRef(0), shown = useRef<Lookup | null>(null), field = useRef<HTMLInputElement>(null); shown.current = lookup;
  // The dialog opens (showModal, in the page's effect) after this mounts and focuses its close button;
  // take the focus for the txid field once it is open.
  useEffect(() => { const timer = setTimeout(() => field.current?.focus(), 0); return () => clearTimeout(timer); }, []);
  const load = async (txid: string, auto = false) => {
    const at = ++request.current;
    setLookup((old) => ({ txid, loading: true, data: old?.txid === txid ? old.data : undefined, at: old?.at }));
    try {
      const data = await api<TxDetail>("/v1/tx", "POST", { txid });
      if (at === request.current) setLookup({ txid, data, at: Date.now() });
    } catch (e) {
      if (at !== request.current) return;
      const status = e instanceof ApiError ? e.status : 0;
      const error = status === 404 ? "txNotFound" : status === 429 ? "txRateLimited" : "error";
      // The result on screen stays unless the transaction is gone; an automatic reload fails quietly.
      setLookup((old) => old?.data && old.txid === txid && status !== 404 ? { txid, data: old.data, at: Date.now(), error: auto ? undefined : error } : { txid, error, at: Date.now() });
    }
  };
  const submit = (raw: string) => {
    const txid = parseTxid(raw);
    if (!txid) { request.current++; setLookup({ txid: "", error: "txInvalid" }); return; }
    setInput(txid);
    void load(txid);
  };
  useEffect(() => {
    const s = shown.current;
    if (s?.data && !s.loading && s.data.confirmations === 0 && Date.now() - (s.at || 0) >= 60_000) void load(s.txid, true);
  }, [refresh]);
  // "View transaction" after a broadcast.
  useEffect(() => { if (asked) submit(asked.txid); }, [asked?.at]);
  return <div className="tx-lookup">
    <form className="tx-lookup-form" onSubmit={(e) => { e.preventDefault(); submit(input); }}>
      <input ref={field} value={input} onChange={(e) => setInput(e.target.value)} aria-label={t("txLookupPlaceholder")} placeholder={t("txLookupPlaceholder")}
        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
      <div className="tx-lookup-actions">
        <PasteButton t={t} onPaste={(s) => { setInput(s.trim()); submit(s); }} />
        <button className="primary" disabled={!input.trim() || (lookup?.loading && lookup.txid === parseTxid(input))}>{t("txLookupGo")}</button>
      </div>
    </form>
    {lookup?.error && <p className="status warn" role="alert">{t(lookup.error)}</p>}
    {lookup?.loading && !lookup.data && <Skeleton label={t("loading")} />}
    {lookup?.data && <TxResult key={lookup.txid} tx={lookup.data} known={known} onCopy={onCopy} rebroadcast t={t} lang={lang} />}
  </div>;
}

type Outcome = { txid: string; sent?: boolean; known?: boolean; rejected?: string; error?: "txSendRateLimited" | "txSendUnknown" | "txRawInvalid" };

/// The broadcast tab: a transaction signed elsewhere, pasted as hex, is decoded here (txid, outputs,
/// total) for the user to check, and goes out only on Broadcast, through the Worker's POST /v1/tx/send
/// (to our own Blockbook and the official one), which allows 5 broadcasts a minute per IP. Sending the
/// same signed transaction again is harmless, so a broadcast without an answer can simply be repeated.
export function TxBroadcast({ known, onLookup, onCopy, t, lang }: { known: ReadonlyMap<string, string>; onLookup: (txid: string) => void; onCopy?: (value: string) => void; t: T; lang: Lang }) {
  const [input, setInput] = useState(""), [decoding, setDecoding] = useState<{ input: string; tx: RawTx | null }>();
  const [sending, setSending] = useState(false), [outcome, setOutcome] = useState<Outcome | null>(null);
  const shown = useRef(input); shown.current = input;
  useEffect(() => {
    let live = true;
    setOutcome(null);
    if (input.trim()) void decodeRawTx(input).then((tx) => { if (live) setDecoding({ input, tx }); });
    return () => { live = false; };
  }, [input]);
  // Only the decoding of what is in the box now: an older preview must never be the one broadcast.
  const decoded = input.trim() && decoding?.input === input ? decoding.tx : undefined;
  // A txid or explorer link is no transaction (one is at least 120 hex characters), but it can be looked up.
  const asTxid = decoded === null ? parseTxid(input) : null;
  const broadcast = async (tx: RawTx) => {
    // An answer that arrives after the box changed belongs to a transaction no longer shown.
    const at = input, settle = (o: Outcome) => { if (shown.current === at) setOutcome(o); };
    setSending(true); setOutcome(null);
    try {
      const r = await api<{ txid?: string; known?: boolean }>("/v1/tx/send", "POST", { hex: tx.hex });
      settle({ txid: r.txid || tx.txid, ...(r.known ? { known: true } : { sent: true }) });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      settle(status === 422 && e instanceof ApiError ? { txid: tx.txid, rejected: String(e.data.reason ?? "") }
        : { txid: tx.txid, error: status === 429 ? "txSendRateLimited" : status === 400 ? "txRawInvalid" : "txSendUnknown" });
    } finally { setSending(false); }
  };
  const out = outcome?.sent || outcome?.known;
  const view = outcome && <button type="button" onClick={() => onLookup(outcome.txid)}><Icon name="search" />{t("txView")}</button>;
  return <div className="tx-broadcast">
    <textarea value={input} onChange={(e) => setInput(e.target.value)} aria-label={t("txRawPlaceholder")} placeholder={t("txRawPlaceholder")}
      rows={4} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    <div className="tx-lookup-actions">
      <PasteButton t={t} onPaste={(s) => setInput(s.trim())} />
    </div>
    <p className="muted tx-broadcast-note">{t("txBroadcastNote")}</p>
    {decoded === null && (asTxid ? <div className="status warn" role="alert"><p>{t("txIsTxid")}</p><button type="button" onClick={() => onLookup(asTxid)}><Icon name="search" />{t("txView")}</button></div>
      : <p className="status warn" role="alert">{t("txRawInvalid")}</p>)}
    {decoded && <div className="tx-result">
      <div className="tx-id"><code className="watch-address">{decoded.txid}</code>{onCopy && <button className="icon-button" aria-label={t("copy")} title={t("copy")} onClick={() => onCopy(decoded.txid)}><Icon name="copy" /></button>}</div>
      <dl className="calculation-lines tx-facts">
        <div><dt>{t("txInputs")}</dt><dd>{decoded.inputCount.toLocaleString(lang)}</dd></div>
        <div><dt>{t("txTotal")}</dt><dd><Amount value={decoded.value} lang={lang} /></dd></div>
        {/* A raw transaction does not carry its inputs' amounts. */}
        <div><dt>{t("networkFee")}</dt><dd className="muted">{t("txFeeLater")}</dd></div>
      </dl>
      <Rows title={t("txOutputs")} count={decoded.outputs.length} rows={ownFirst(decoded.outputs, known)} known={known} t={t} lang={lang} />
      <div className="tx-broadcast-outcome" aria-live="polite">
        {out && <div className="tx-sent">
          <p className="status" role="status"><Icon name="check" />{t(outcome.sent ? "txBroadcastDone" : "txBroadcastKnown")}</p>
          <div className="tx-lookup-actions">{view}<a className="tx-explorer" href={`${EXPLORER}/tx/${outcome.txid}`} target="_blank" rel="noreferrer">{t("explorer")}<Icon name="external" /></a></div>
        </div>}
        {outcome?.rejected != null && <div className="status warn" role="alert"><p>{t("txRejected")}</p>{outcome.rejected && <code>{outcome.rejected}</code>}</div>}
        {outcome?.error && <p className="status warn" role="alert">{t(outcome.error)}</p>}
        {!out && <div className="tx-lookup-actions">
          <button className="primary" disabled={sending} onClick={() => void broadcast(decoded)}><Icon name="send" />{t(sending ? "txBroadcasting" : "txBroadcastGo")}</button>
          {(outcome?.rejected != null || outcome?.error === "txSendUnknown") && view}
        </div>}
      </div>
    </div>}
  </div>;
}

export type TxTab = "lookup" | "broadcast";
const TABS: [TxTab, TextKey][] = [["lookup", "txLookupGo"], ["broadcast", "txBroadcastGo"]];

/// The transaction dialog's content: Look up and Broadcast tabs. Both stay mounted, so switching
/// keeps what was entered; "View transaction" after a broadcast looks it up in the first tab.
export function TxTools({ tab, onTab, known, refresh, onCopy, t, lang }: { tab: TxTab; onTab: (tab: TxTab) => void; known: ReadonlyMap<string, string>; refresh: number; onCopy?: (value: string) => void; t: T; lang: Lang }) {
  const [lookup, setLookup] = useState<{ txid: string; at: number }>();
  return <>
    <div className="tx-tabs" role="tablist" aria-label={t("txLookup")} onKeyDown={(e) => {
      const next = e.key === "ArrowRight" || e.key === "ArrowLeft" ? TABS.find(([name]) => name !== tab)?.[0] : e.key === "Home" ? "lookup" : e.key === "End" ? "broadcast" : undefined;
      if (!next) return;
      e.preventDefault(); onTab(next); document.getElementById(`tx-tab-${next}`)?.focus();
    }}>{TABS.map(([name, label]) => <button key={name} type="button" id={`tx-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`tx-panel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => onTab(name)}>{t(label)}</button>)}</div>
    <section id="tx-panel-lookup" role="tabpanel" aria-labelledby="tx-tab-lookup" hidden={tab !== "lookup"}>
      <TxLookup known={known} refresh={refresh} lookup={lookup} onCopy={onCopy} t={t} lang={lang} />
    </section>
    <section id="tx-panel-broadcast" role="tabpanel" aria-labelledby="tx-tab-broadcast" hidden={tab !== "broadcast"}>
      <TxBroadcast known={known} onLookup={(txid) => { setLookup({ txid, at: Date.now() }); onTab("lookup"); }} onCopy={onCopy} t={t} lang={lang} />
    </section>
  </>;
}
