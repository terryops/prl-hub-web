// 充值 and 提现 of PEARL or USDT on SafeTrade, the iOS DepositStore / DepositView and WithdrawStore /
// WithdrawView (prl-hub Sources/Trade), by the routes SafeTrade's own web client uses. A withdrawal is
// confirmed on a receipt page, then the shell asks for the device check before it sends it.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./trade-icons.tsx";
import type { WalletControl } from "./android-host.ts";
import * as api from "./safetrade-client.ts";
import {
  BASE, authProblemOf, canDeposit, canWithdraw, dec, decText, depositFee, explorerURL, failureMessage, failureOf, isPRLAddress, isValidChainAddress,
  lookForUnverified, maintenanceMessage, memoOf, minDeposit, minWithdraw, networkName, networkShortName, parseAmount, pickAddress, plainAddress,
  settleLeft, shortAddr, withdrawFee, withdrawState, addressReady, errorKeys, type Beneficiary, type DepositAddress, type Deposit, type Network,
  type PendingWithdrawCheck, type Tr, type Withdraw,
} from "./safetrade.ts";
import { explainFailure, useTradeStore, type IPIssue, type TradeStore } from "./trade-store.ts";
import type { Lang } from "./types.ts";
import { AlertDialog, CopyButton, InfoTip, Processing, QR, Row, Spinner, StatusLines, SubPage, UnverifiedBanner, UntrustedIPCard, useBackLayer } from "./TradeUI.tsx";

// iOS isWatchOnly: a read-only wallet only watches an address (no seed here), so it can't pay a deposit, and the
// address it watches may well be someone else's. Optional on the wallet's side: an older wallet reads as false.
const isReadOnly = (w?: object) => !!(w as { readOnly?: boolean } | undefined)?.readOnly;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const when = (ms: number, lang: Lang) => new Date(ms).toLocaleString(lang, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const unitOf = (currency: string) => currency.toUpperCase();
/** Plain decimal, at most 8 dp (iOS fmt). */
const fmt = (d: bigint, places = 8) => decText(d, places, "down");

/** The IP card for a refusal of this network's IP, else the message. */
const explain = (e: unknown, tr: Tr, setIP: (i: IPIssue | null) => void, setError: (m: string | null) => void) => explainFailure(e, tr, { ip: setIP, error: setError });

function NetworkTile({ n, selected, detail, onPick }: { n: Network; selected: boolean; detail: string; onPick: () => void }) {
  return <button type="button" className={selected ? "trade-tile selected" : "trade-tile"} aria-pressed={selected} onClick={onPick}>
    <span className="trade-tile-head"><strong>{networkShortName(n)}</strong>{selected && <Icon name="check" />}</span>
    <small>{detail}</small>
  </button>;
}

// MARK: - 充值

export function DepositPage({ currency, store, tr, lang, wallet, onWallet, onBack, onGuide }: {
  currency: string; store: TradeStore; tr: Tr; lang: Lang; wallet: () => WalletControl | undefined; onWallet: () => void; onBack: () => void; onGuide: () => void;
}) {
  useTradeStore(store);
  const unit = unitOf(currency), isPearl = currency === BASE;
  const [networks, setNetworks] = useState<Network[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [address, setAddress] = useState<DepositAddress | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false), [loadingAddress, setLoadingAddress] = useState(false), [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null), [addressError, setAddressError] = useState<string | null>(null);
  const [history, setHistory] = useState<Deposit[]>([]);
  const [ipIssue, setIPIssue] = useState<IPIssue | null>(null);
  const [walletState, setWalletState] = useState(() => wallet()?.state());
  const chosen = useRef<string | null>(null);
  const network = networks.find((n) => n.key === key);

  useEffect(() => wallet()?.subscribe(() => setWalletState(wallet()?.state())), [wallet]);

  /** SafeTrade generates the address on first ask and answers with an empty one meanwhile: ask a few times. */
  const loadAddress = async (k: string) => {
    setAddressError(null);
    const known = store.balance(currency)?.depositAddresses;
    const hit = known && pickAddress(known, currency, k);
    if (hit) { setAddress(hit); return; }
    setLoadingAddress(true);
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const a = await api.depositAddress(currency, k);
          if (chosen.current !== k) return;
          if (addressReady(a)) { setAddress(a); setIPIssue(null); return; }
          setGenerating(true);
        } catch (e) {
          if (chosen.current !== k) return;
          await explain(e, tr, setIPIssue, setAddressError);
          return;
        }
        if (attempt < 5) await sleep(3000);
      }
      setAddressError(tr("SafeTrade 还在生成充值地址，请稍后下拉刷新。"));
    } finally {
      // Another network picked meanwhile: its own load owns the spinner.
      if (chosen.current === k) { setLoadingAddress(false); setGenerating(false); }
    }
  };
  const select = (k: string) => {
    if (k === chosen.current) return;
    chosen.current = k; setKey(k); setAddress(null); setAddressError(null);
    void loadAddress(k);
  };
  const load = async () => {
    setLoadingInfo(true);
    const recent = api.deposits(currency).then(setHistory, () => {});
    let pick: string | null = chosen.current;
    try {
      const open = (await api.currency(currency)).networks.filter(canDeposit);
      setNetworks(open);
      setLoadError(open.length ? null : tr("SafeTrade 暂时没有开放 {0} 的充值网络", unit));
      if (pick && !open.some((n) => n.key === pick)) pick = null;
      if (!pick && open.length === 1) pick = open[0].key;
    } catch (e) {
      setLoadError(tr("读取 SafeTrade 充值信息失败：{0}", failureMessage(failureOf(e), tr)));
    }
    setLoadingInfo(false);
    chosen.current = pick; setKey(pick);
    if (pick) await loadAddress(pick);
    await recent;
  };
  useEffect(() => { void load(); }, []);

  const unlocked = walletState?.exists && !walletState.locked;
  const unlockHint = useId();
  const [handing, setHanding] = useState(false), [walletError, setWalletError] = useState<string | null>(null);
  /** The wallet's send screen with this address. Locked, it opens once unlocked, so the wallet tab shows to
   *  unlock it; busy (a refresh running), the wallet turns it down, so ask again for a few seconds. */
  const transfer = async (a: string) => {
    setWalletError(null); setHanding(true);
    try {
      for (let i = 0; i < 24; i++) {
        const w = wallet(), st = w?.state();
        if (!w?.send || !st) return;
        if (w.send(a) || st.locked) { onWallet(); return; }
        if (st.network !== "mainnet" || isReadOnly(st)) return;
        await sleep(250);
      }
      setWalletError(tr("钱包正忙，请稍后再试"));
    } finally { setHanding(false); }
  };
  // Locked, the same button unlocks the wallet first (iOS: a lock on the button, 解锁钱包 as its hint).
  const fromWallet = (a: string) => {
    if (!isPearl || !walletState?.exists || isReadOnly(walletState)) return null;
    if (unlocked && walletState.network !== "mainnet") return null;
    return <>
      <button type="button" className="primary wide" disabled={handing} aria-describedby={unlocked ? undefined : unlockHint} onClick={() => void transfer(a)}>
        {handing ? <Spinner /> : <Icon name={unlocked ? "deposit" : "lock"} />}{tr("从钱包转入")}{!unlocked && <span id={unlockHint} hidden>{tr("解锁钱包")}</span>}
      </button>
      {walletError && <p className="trade-line trade-error" role="alert"><Icon name="warning" /><span>{walletError}</span></p>}
    </>;
  };
  const statusLabel = (d: Deposit) => d.status === "credited" ? tr("已到账") : d.status === "processing" ? tr("处理中") : d.status === "feeRequired" ? tr("待付手续费") : tr("失败");

  return <SubPage back={tr("交易")} title={tr("充值 {0}", unit)} onBack={onBack}
    trailing={<button type="button" className="icon-button android-refresh" aria-label={tr("刷新")} onClick={() => void load()}><Icon name="refresh" className={loadingInfo ? "spin" : undefined} /></button>}>
    {ipIssue && <UntrustedIPCard issue={ipIssue} tr={tr} onGuide={onGuide} />}
    <section className="card trade-card">
      {!networks.length ? loadingInfo ? <Spinner label={tr("正在读取充值网络…")} /> : loadError && <p className="trade-line trade-warn"><Icon name="warning" /><span>{loadError}</span></p>
        : networks.length === 1 ? <Row label={tr("网络")} value={networkName(networks[0])} />
        : <>
          <div className="trade-title-row"><small className="muted">{tr("网络")}</small><InfoTip label={tr("网络")} text={tr("先选择充值网络：要和转出方使用的网络一致。")} /></div>
          <div className="trade-tiles">{networks.map((n) => <NetworkTile key={n.key} n={n} selected={key === n.key} detail={tr("最少 {0}", fmt(minDeposit(n)))} onPick={() => select(n.key)} />)}</div>
        </>}
      {network && maintenanceMessage(network) && <p className="trade-line trade-info"><Icon name="info" /><span>{tr("SafeTrade 提示：{0}", maintenanceMessage(network)!)}</span></p>}
    </section>
    {key && <section className="card trade-card trade-address">
      {address && addressReady(address) ? <>
        <QR value={plainAddress(address)} alt={tr("充值地址")} />
        <div className="trade-copy-row"><small className="muted">{tr("充值地址")}</small><div><code>{plainAddress(address)}</code><CopyButton value={plainAddress(address)} tr={tr} /></div></div>
        {memoOf(address) && <>
          <div className="trade-copy-row"><small className="muted">Memo</small><div><code>{memoOf(address)}</code><CopyButton value={memoOf(address)!} tr={tr} /></div></div>
          <p className="trade-line trade-warn"><Icon name="warning" /><span>{tr("转账时必须同时填写这个 Memo，否则充值无法到账。")}</span></p>
        </>}
        {network && <div className="trade-facts">
          {minDeposit(network) > 0n && <Row label={tr("最少充值")} value={`${fmt(minDeposit(network))} ${unit}`} />}
          {(network.minConfirmations ?? 0) > 0 && <Row label={tr("到账确认")} value={tr("{0} 个区块", network.minConfirmations!)} />}
          {depositFee(network) > 0n && <Row label={tr("充值手续费")} value={`${fmt(depositFee(network))} ${unit}`} />}
        </div>}
        <p className="trade-line trade-warn"><Icon name="shield" /><span>{tr("只能向这个地址充值 {0}（{1} 网络）。转入其他币种或走错网络，资金可能无法找回。", unit, network ? networkName(network) : "")}</span></p>
        {fromWallet(plainAddress(address))}
      </> : loadingAddress ? <Spinner label={generating ? tr("SafeTrade 正在生成充值地址…") : tr("正在获取充值地址…")} />
        : addressError && <div className="trade-center"><p className="trade-line trade-warn"><Icon name="warning" /><span>{addressError}</span></p>
          <button type="button" className="text-button" onClick={() => key && void loadAddress(key)}>{tr("重试")}</button></div>}
    </section>}
    {history.length > 0 && <section className="card trade-card">
      <h2>{tr("充值记录")}</h2>
      <div className="trade-history">{history.map((d) => {
        const chain = networks.find((n) => n.key === d.network) ?? network, url = d.txid ? explorerURL(chain, d.txid) : undefined;
        return <div key={d.id} className="trade-history-row">
          <span><span>{d.amount ?? "—"} {unit}{!isPearl && chain ? ` · ${networkName(chain)}` : ""}</span>{d.createdAt && <small>{when(d.createdAt, lang)}</small>}</span>
          <span><small className={d.status === "credited" ? "trade-up" : d.status === "failed" ? "trade-down" : "trade-warn-text"}>{statusLabel(d)}</small>
            {url && <a className="trade-small-link" href={url} target="_blank" rel="noreferrer">{tr("查看交易")}</a>}</span>
        </div>;
      })}</div>
    </section>}
  </SubPage>;
}

// MARK: - 提现: saved USDT destinations (iOS WithdrawAddressBook; PEARL payees live in the wallet's address book)

type Preset = { id: string; currency: string; blockchainKey: string; address: string; name: string };
const PRESETS = "pearlhub.safetrade.withdrawAddresses";
function readPresets(): Preset[] {
  try {
    const list = JSON.parse(localStorage.getItem(PRESETS) || "[]");
    return Array.isArray(list) ? list.filter((p) => p && typeof p.address === "string" && typeof p.blockchainKey === "string" && typeof p.currency === "string") : [];
  } catch { return []; }
}
function writePresets(list: Preset[]) {
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  try { localStorage.setItem(PRESETS, JSON.stringify(sorted)); } catch { /* This run only. */ }
  return sorted;
}

export function WithdrawPage({ currency, store, tr, lang, wallet, contacts, addContact, onBack, onGuide }: {
  currency: string; store: TradeStore; tr: Tr; lang: Lang; wallet: () => WalletControl | undefined;
  contacts: { name: string; address: string }[]; addContact: (name: string, address: string) => void; onBack: () => void; onGuide: () => void;
}) {
  const s = useTradeStore(store);
  const unit = unitOf(currency), isPearl = currency === BASE;
  // The exchange's side (WithdrawStore).
  const [networks, setNetworks] = useState<Network[]>([]);
  const [precision, setPrecision] = useState(8);
  const [networkKey, setNetworkKey] = useState<string | null>(null);
  const [history, setHistory] = useState<Withdraw[]>([]);
  const historyLoaded = useRef(false);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [bookNote, setBookNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null), [loadingInfo, setLoadingInfo] = useState(false);
  const [sendingCode, setSendingCode] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [codeContext, setCodeContext] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false), [needsPhoneCode, setNeedsPhoneCode] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [ipIssue, setIPIssue] = useState<IPIssue | null>(null), [verifying, setVerifying] = useState(false);
  // The form (WithdrawView).
  const [address, setAddress] = useState(""), [amount, setAmount] = useState("");
  const [emailCode, setEmailCode] = useState(""), [otpCode, setOtpCode] = useState(""), [phoneCode, setPhoneCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [naming, setNaming] = useState(false), [presetName, setPresetName] = useState("");
  const [managing, setManaging] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [beneficiaryID, setBeneficiaryID] = useState<number | null>(null);
  const [presets, setPresets] = useState<Preset[]>(readPresets);
  const cooldownTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  useEffect(() => () => Object.values(cooldownTimers.current).forEach(clearInterval), []);
  useBackLayer(presetsOpen, () => setPresetsOpen(false));
  useBackLayer(managing, () => setManaging(false));
  useBackLayer(confirming, () => setConfirming(false));
  useBackLayer(naming, () => setNaming(false));

  const unverified = s.unverifiedWithdraws[currency];
  const network = networks.find((n) => n.key === networkKey);
  const openNetworks = networks.filter(canWithdraw);
  const available = dec(store.balance(currency)?.balance) ?? 0n;
  const trimmed = address.trim();
  const addressValid = isPearl ? isPRLAddress(trimmed) : network ? isValidChainAddress(network, trimmed) : false;
  /** Rejected when it has more decimals than the exchange takes. */
  const amountValue = useMemo(() => {
    const v = parseAmount(amount, 18);
    return v != null && dec(decText(v, precision, "down")) === v ? v : null;
  }, [amount, precision]);
  const fee = network ? withdrawFee(network, amountValue ?? 0n) : 0n;
  const received = (amountValue ?? 0n) - fee > 0n ? (amountValue ?? 0n) - fee : 0n;
  const amountProblem = (() => {
    if (amount && amountValue == null) return tr("数量格式不对");
    if (amountValue == null) return null;
    if (network && amountValue < minWithdraw(network)) return tr("最少提现 {0} {1}", fmt(minWithdraw(network)), unit);
    if (amountValue > available) return tr("{0} 余额不足", unit);
    if (amountValue <= fee) return tr("数量需大于手续费");
    return null;
  })();
  const codeReady = addressValid && !amountProblem && (amountValue ?? 0n) > 0n;
  const codeSignature = `${trimmed}|${amount}|${networkKey ?? ""}`;
  const chainKeyOf = (b: Beneficiary) => b.network ?? (networks.length === 1 ? networks[0].key : undefined);
  const networkFor = (k?: string | null) => networks.find((n) => n.key === k);
  /** The chosen SafeTrade address-book entry, while the form still shows its exact address and chain. */
  const beneficiary = beneficiaries.find((b) => b.id === beneficiaryID && b.active && b.destination === trimmed && chainKeyOf(b) === networkKey);
  const canSubmit = codeReady && !!network && canWithdraw(network) && (!!beneficiary || emailCode.length === 6)
    && (otpCode.length === 0 || otpCode.length === 6) && (!needsPhoneCode || phoneCode.length === 6) && !submitting && !unverified && !verifying;
  const myWallets = isPearl ? (wallet()?.wallets?.() ?? []).filter((w) => !isReadOnly(w)) : [];
  const people = isPearl ? contacts.filter((c) => isPRLAddress(c.address)) : [];
  const currencyPresets = presets.filter((p) => p.currency === currency);
  const bookEntries = beneficiaries.filter((b) => b.destination && networkFor(chainKeyOf(b)));
  const savedName = (() => {
    if (!addressValid) return null;
    if (beneficiary) return tr("SafeTrade 地址簿「{0}」· 免邮箱验证码", beneficiary.title);
    if (isPearl) {
      const w = myWallets.find((x) => x.address === trimmed);
      if (w) return tr("钱包「{0}」", w.name);
      const c = contacts.find((x) => x.address === trimmed);
      return c ? tr("通讯录「{0}」", c.name) : null;
    }
    const p = currencyPresets.find((x) => x.address === trimmed && x.blockchainKey === networkKey);
    return p ? tr("常用地址「{0}」", p.name) : null;
  })();
  const canSavePreset = addressValid && !savedName && (isPearl || !!networkKey);

  /** Look for the unverified withdrawal (lookForUnverified). Still unknown before SETTLE_MS: look again then. */
  const recheck = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(recheck.current), []);
  const verifyUnverified = async (check: PendingWithdrawCheck | undefined = store.state.unverifiedWithdraws[currency]) => {
    if (!check || verifying) return;
    clearTimeout(recheck.current);
    setVerifying(true);
    try {
      const r = await lookForUnverified(check, async () => {
        const rows = await api.withdraws(currency);
        setHistory(rows);
        return check.knownComplete ? rows.find((w) => !check.knownIDs.includes(w.id)) : undefined;
      });
      if (store.state.unverifiedWithdraws[currency] !== check) return;   // dismissed meanwhile
      if (r.kind === "found") { store.setUnverifiedWithdraw(currency, null); setError(null); setNotice(tr("提现记录里出现了这笔提现（{0} {1}），已提交成功。", r.hit.amount ?? "—", unit)); }
      else if (r.kind === "absent") { store.setUnverifiedWithdraw(currency, null); setError(tr("提现记录里没有新的提现，这次没有提交成功，可以重新提交。")); }
      else {
        setError(tr("暂时无法确认提现结果，请到 SafeTrade 网站核对提现记录，或稍后点「重新核对」。"));
        const left = settleLeft(check);
        if (left > 0) recheck.current = setTimeout(() => void verifyLatest.current(), left + 1000);
      }
    } finally { setVerifying(false); }
  };
  const verifyLatest = useRef(verifyUnverified);
  verifyLatest.current = verifyUnverified;

  const load = async () => {
    setLoadingInfo(true);
    const h = api.withdraws(currency), b = api.beneficiaries();
    let list: Network[] = networks;
    try {
      const c = await api.currency(currency);
      list = c.networks;
      setNetworks(c.networks);
      if (c.precision != null) setPrecision(c.precision);
      if (c.networks.length === 1) setNetworkKey(c.networks[0].key);
      setLoadError(c.networks.length ? null : tr("SafeTrade 没有返回 {0} 的提现网络", unit));
    } catch (e) {
      setLoadError(tr("读取 SafeTrade 提现信息失败：{0}", failureMessage(failureOf(e), tr)));
    }
    setLoadingInfo(false);
    // History and the address book are extras: a failure leaves them out rather than blocking the withdrawal.
    try { setHistory(await h); historyLoaded.current = true; } catch { /* Kept as it was. */ }
    try {
      const all = await b, onChain = (k?: string) => list.some((n) => n.key === k);
      const mine = all.filter((x) => x.currencyID === currency || (x.currencyID == null && onChain(x.network)));
      setBeneficiaries(mine);
      const key1 = list.length === 1 ? list[0].key : undefined;
      const usable = mine.filter((x) => x.destination && onChain(x.network ?? key1));
      setBookNote(all.length && !usable.length
        ? tr("SafeTrade 地址簿有 {0} 个地址（{1}），但没有可用于 {2} 的。", all.length, all.slice(0, 6).map((x) => `${x.currencyID ?? "?"}/${x.network ?? "?"}`).join(", "), unit) : null);
    } catch (e) {
      setBeneficiaries([]);
      setBookNote(tr("读取 SafeTrade 地址簿失败：{0}", failureMessage(failureOf(e), tr)));
    }
    if (store.state.unverifiedWithdraws[currency]) await verifyUnverified();
  };
  useEffect(() => {
    if (isPearl && !address) { const w = wallet()?.state(), own = w && !isReadOnly(w) ? w.address : null; if (own) setAddress(own); }
    void load();
  }, []);

  // An address picked for the old chain doesn't belong on the new one (kept if it's saved for the new chain too).
  const lastKey = useRef(networkKey);
  useEffect(() => {
    const old = lastKey.current; lastKey.current = networkKey;
    const savedFor = (k: string | null) => !!k && !!trimmed && (currencyPresets.some((p) => p.address === trimmed && p.blockchainKey === k) || beneficiaries.some((b) => b.destination === trimmed && chainKeyOf(b) === k));
    if (old && old !== networkKey && savedFor(old) && !savedFor(networkKey)) { setAddress(""); setBeneficiaryID(null); }
  }, [networkKey]);
  // The codes are bound to the address, amount and chain they were sent for.
  useEffect(() => {
    if (!codeContext || codeContext === codeSignature) return;
    setEmailCode(""); setPhoneCode(""); setCodeContext(null); setCooldowns({}); setNotice(null);
    Object.values(cooldownTimers.current).forEach(clearInterval); cooldownTimers.current = {};
    setError(tr("地址、数量或网络改了，之前的验证码已失效，请重新获取。"));
  }, [codeSignature]);

  const present = async (e: unknown) => {
    const f = failureOf(e);
    if (f.kind === "http" && errorKeys(f.body).some((k) => k.endsWith("missing_phone_code"))) setNeedsPhoneCode(true);
    const auth = authProblemOf(f);
    // The key reads fine elsewhere, so an authz refusal here means it may not withdraw.
    if (auth?.kind === "other" && auth.keys.some((k) => k.startsWith("authz."))) {
      setError(tr("SafeTrade 拒绝了这个 API 密钥的提现请求（{0}）。到 SafeTrade「API 管理」编辑这个密钥：勾选 Enable Withdraw，并把当前网络的公网 IP 加入 Trusted IPs。", auth.keys.join(", ")));
      return;
    }
    await explain(e, tr, setIPIssue, setError);
  };
  const startCooldown = (type: string) => {
    clearInterval(cooldownTimers.current[type]);
    setCooldowns((c) => ({ ...c, [type]: 60 }));
    cooldownTimers.current[type] = setInterval(() => setCooldowns((c) => {
      const left = Math.max(0, (c[type] ?? 0) - 1);
      if (!left) clearInterval(cooldownTimers.current[type]);
      return { ...c, [type]: left };
    }), 1000);
  };
  const sendCode = async (type: "email" | "phone") => {
    if (!network || sendingCode || (cooldowns[type] ?? 0) > 0 || amountValue == null) return;
    const ctx = codeSignature;
    setSendingCode(type); setError(null); setNotice(null); setIPIssue(null);
    try {
      await api.sendWithdrawCode(type, trimmed, decText(amountValue, 18), network.key, currency);
      setNotice(type === "phone" ? tr("短信验证码已发送") : tr("验证码已发到你的 SafeTrade 注册邮箱"));
      setCodeContext(ctx);
      startCooldown(type);
    } catch (e) { await present(e); }
    setSendingCode(null);
  };
  const submit = async () => {
    if (!network || submitting || unverified || amountValue == null) return;
    const viaBook = beneficiary?.id;
    const known = { knownIDs: history.map((w) => w.id), knownComplete: historyLoaded.current };
    setSubmitting(true); setError(null); setNotice(null); setIPIssue(null);
    try {
      await api.createWithdraw({ address: trimmed, amount: decText(amountValue, 18), blockchainKey: network.key, beneficiaryID: viaBook,
        emailCode: viaBook == null ? emailCode : "", otpCode, phoneCode, currency, confirm: { title: tr("验证身份以确认提现") } });
      setCodeContext(null);
      setNotice(tr("提现已提交，SafeTrade 处理后会广播上链"));
      setAmount(""); setEmailCode(""); setOtpCode(""); setPhoneCode("");
      setSubmitting(false);
      void store.refresh();
      await load();
    } catch (e) {
      setSubmitting(false);
      const f = failureOf(e);
      if (f.kind === "withdrawUnverified") {
        const before: PendingWithdrawCheck = { ...known, at: Date.now() };
        setCodeContext(null);
        store.setUnverifiedWithdraw(currency, before);
        setError(failureMessage(f, tr));
        setAmount(""); setEmailCode(""); setOtpCode(""); setPhoneCode("");
        await verifyUnverified(before);
        void store.refresh();
        return;
      }
      await present(e);
    }
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (isPearl) addContact(name || shortAddr(trimmed), trimmed);
    else if (networkKey && !presets.some((p) => p.currency === currency && p.blockchainKey === networkKey && p.address === trimmed)) {
      setPresets(writePresets([...presets, { id: crypto.randomUUID(), currency, blockchainKey: networkKey, address: trimmed, name: name || shortAddr(trimmed) }]));
    }
    setNaming(false);
  };
  const applyBook = (b: Beneficiary) => { const k = chainKeyOf(b); if (!b.destination || !k) return; setNetworkKey(k); setAddress(b.destination); setBeneficiaryID(b.id); setPresetsOpen(false); };
  const applyPreset = (p: Preset) => { setNetworkKey(p.blockchainKey); setAddress(p.address); setPresetsOpen(false); };
  const placeholder = isPearl ? "prl1…" : !network ? tr("先选择网络") : network.key.toLowerCase().startsWith("tron") ? "T…" : /^(spl|sol)/.test(network.key.toLowerCase()) ? "Solana" : "0x…";
  const hasPresets = bookEntries.length > 0 || (isPearl ? myWallets.length > 0 || people.length > 0 : currencyPresets.length > 0);
  const stateText = (st: string) => { const k = withdrawState(st); return k === "done" ? tr("已到账") : k === "canceled" ? tr("已取消") : k === "failed" ? tr("失败") : k ? tr("处理中") : ""; };
  const stateClass = (st: string) => { const k = withdrawState(st); return k === "done" ? "trade-up" : k === "canceled" || k === "failed" ? "trade-down" : "trade-warn-text"; };
  const codeField = (title: string, value: string, set: (v: string) => void, sendType?: "email" | "phone") => <label className="trade-field">
    <span className="trade-field-head"><span>{title}</span></span>
    <span className="trade-code">
      <input inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={value} aria-label={title} onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      {sendType && <button type="button" disabled={!codeReady || !!sendingCode || (cooldowns[sendType] ?? 0) > 0 || !network} onClick={(e) => { e.preventDefault(); void sendCode(sendType); }}>
        {sendingCode === sendType ? <Spinner /> : (cooldowns[sendType] ?? 0) > 0 ? tr("{0} 秒", String(cooldowns[sendType])) : tr("获取验证码")}</button>}
    </span>
  </label>;

  if (managing) return <SubPage back={tr("提现 {0}", unit)} title={tr("常用地址")} onBack={() => setManaging(false)}>
    <section className="card android-card">
      {currencyPresets.length ? currencyPresets.map((p) => <div key={p.id} className="android-row trade-preset">
        <span className="android-row-label">{p.name}<small>{networkFor(p.blockchainKey) ? networkName(networkFor(p.blockchainKey)!) : p.blockchainKey}</small><small className="trade-mono">{shortAddr(p.address)}</small></span>
        <button type="button" className="icon-button" aria-label={tr("删除")} onClick={() => setPresets(writePresets(presets.filter((x) => x.id !== p.id)))}><Icon name="delete" /></button>
      </div>) : <p className="muted trade-empty">{tr("还没有常用地址")}</p>}
    </section>
  </SubPage>;

  if (confirming && network && amountValue != null) return <SubPage back={tr("取消")} title={tr("确认提现")} onBack={() => setConfirming(false)}>
    <section className="android-group"><h2>{tr("金额")}</h2><div className="card trade-card trade-receipt">
      <Row label={tr("提现数量")} value={`${fmt(amountValue)} ${unit}`} />
      <Row label={tr("手续费")} value={`− ${fmt(fee)} ${unit}`} />
      <Row label={tr("实际到账")} value={`${fmt(received)} ${unit}`} strong />
    </div></section>
    <section className="android-group"><h2>{tr("收款信息")}</h2><div className="card trade-card trade-receipt">
      {!isPearl && <Row label={tr("网络")} value={networkName(network)} />}
      <div className="trade-receipt-address"><small className="muted">{tr("收款地址")}</small>
        <code>{(trimmed.match(/.{1,4}/g) ?? []).join(" ")}</code>{savedName && <small className="muted">{savedName}</small>}</div>
    </div></section>
    <p className="trade-line trade-warn trade-warn-box"><Icon name="warning" /><span>{tr("链上转账无法撤回，请核对地址和网络。")}</span></p>
    <button type="button" className="primary wide" onClick={() => { setConfirming(false); void submit(); }}>{tr("确认提现")}</button>
  </SubPage>;

  return <SubPage back={tr("交易")} title={tr("提现 {0}", unit)} onBack={onBack}
    trailing={<button type="button" className="icon-button android-refresh" aria-label={tr("刷新")} onClick={() => void load()}><Icon name="refresh" className={loadingInfo ? "spin" : undefined} /></button>}>
    <section className="card trade-card trade-form">
      <Row label={tr("可提 {0}", unit)} value={<strong>{fmt(available)}</strong>} />
      {loadError && <div className="trade-title-row"><p className="trade-line trade-error"><Icon name="warning" /><span>{loadError}</span></p><button type="button" className="text-button" disabled={loadingInfo} onClick={() => void load()}>{tr("重试")}</button></div>}
      {!isPearl && openNetworks.length > 0 && <div>
        <div className="trade-title-row"><small className="muted">{tr("网络")}</small><InfoTip label={tr("网络")} text={tr("请确认收款方支持这条链，选错网络资金可能找不回。")} /></div>
        <div className="trade-tiles">{openNetworks.map((n) => <NetworkTile key={n.key} n={n} selected={networkKey === n.key} detail={tr("手续费 {0} · 最少 {1}", fmt(withdrawFee(n, 0n)), fmt(minWithdraw(n)))} onPick={() => setNetworkKey(n.key)} />)}</div>
      </div>}
      {network && !canWithdraw(network) ? <p className="trade-line trade-warn"><Icon name="pause" /><span>{tr("SafeTrade 暂停了这条链的提现")}</span></p>
        : networks.length > 0 && !openNetworks.length && <p className="trade-line trade-warn"><Icon name="pause" /><span>{tr("SafeTrade 暂停了 {0} 提现", unit)}</span></p>}
      <div className="trade-field">
        <span className="trade-field-head"><span>{tr("收款地址")}{bookNote && <InfoTip warn label={tr("收款地址")} text={bookNote} />}</span>
          {hasPresets && <button type="button" className="text-button" aria-expanded={presetsOpen} onClick={() => setPresetsOpen(!presetsOpen)}>{tr("常用地址")}</button>}</span>
        {presetsOpen && <div className="trade-menu trade-presets" role="menu">
          {bookEntries.length > 0 && <><small>{tr("SafeTrade 地址簿（免邮箱验证码）")}</small>{bookEntries.map((b) => { const n = networkFor(chainKeyOf(b));
            return <button key={b.id} type="button" role="menuitem" disabled={!b.active || !n || !canWithdraw(n)} onClick={() => applyBook(b)}>{isPearl ? b.title : `${b.title} · ${n ? networkName(n) : ""}`}</button>; })}</>}
          {isPearl ? <>
            {myWallets.length > 0 && <><small>{tr("我的钱包")}</small>{myWallets.map((w) => <button key={w.address} type="button" role="menuitem" onClick={() => { setAddress(w.address); setPresetsOpen(false); }}>{w.name}</button>)}</>}
            {people.length > 0 && <><small>{tr("通讯录")}</small>{people.map((c) => <button key={c.address + c.name} type="button" role="menuitem" onClick={() => { setAddress(c.address); setPresetsOpen(false); }}>{c.name}</button>)}</>}
          </> : <>
            {currencyPresets.length > 0 && <><small>{tr("常用地址")}</small>{currencyPresets.map((p) => { const n = networkFor(p.blockchainKey);
              return <button key={p.id} type="button" role="menuitem" disabled={!n || !canWithdraw(n)} onClick={() => applyPreset(p)}>{`${p.name} · ${n ? networkName(n) : p.blockchainKey}`}</button>; })}</>}
            <button type="button" role="menuitem" onClick={() => { setPresetsOpen(false); setManaging(true); }}>{tr("管理常用地址…")}</button>
          </>}
        </div>}
        <textarea className="trade-mono" rows={2} placeholder={placeholder} value={address} aria-label={tr("收款地址")} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setAddress(e.target.value)} />
        {trimmed && !addressValid && (isPearl || network) ? <small className="trade-down">{isPearl ? tr("不是有效的 PRL 主网地址") : tr("不是有效的 {0} 地址", network ? networkName(network) : "")}</small>
          : savedName ? <small className="muted">{savedName}</small>
          : canSavePreset && <button type="button" className="text-button trade-start" onClick={() => { setPresetName(""); setNaming(true); }}>{isPearl ? tr("加入通讯录") : tr("保存为常用地址")}</button>}
      </div>
      <label className="trade-field">
        <span className="trade-field-head"><span>{tr("数量 ({0})", unit)}</span>{available > 0n && <button type="button" className="text-button" onClick={(e) => { e.preventDefault(); setAmount(decText(available, precision, "down")); }}>{tr("MAX {0}", fmt(available))}</button>}</span>
        <input inputMode="decimal" autoComplete="off" placeholder="0.0" value={amount} aria-label={tr("数量 ({0})", unit)} onChange={(e) => setAmount(e.target.value)} />
        {amountProblem && <small className="trade-down">{amountProblem}</small>}
      </label>
      {network && <div className="trade-facts">
        <Row label={tr("手续费")} value={`${fmt(fee)} ${unit}`} />
        <Row label={tr("预计到账")} value={`${fmt(received)} ${unit}`} />
        {isPearl && <Row label={tr("最少提现")} value={`${fmt(minWithdraw(network))} ${unit}`} />}
      </div>}
    </section>
    <section className="card trade-card trade-form">
      <div className="trade-title-row"><h2>{tr("安全验证")}</h2><InfoTip label={tr("安全验证")} text={tr("API 密钥需在 SafeTrade 开启 Enable Withdraw；它的 Trusted IPs 白名单对所有请求都生效，不只是提现。")} /></div>
      {!beneficiary && codeField(tr("邮箱验证码"), emailCode, setEmailCode, "email")}
      {codeField(tr("谷歌验证码（开启了 2FA 才需要）"), otpCode, setOtpCode)}
      {needsPhoneCode && codeField(tr("短信验证码"), phoneCode, setPhoneCode, "phone")}
      <button type="button" className="primary wide" disabled={!canSubmit} onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setConfirming(true); }}>{tr("提现")}</button>
    </section>
    {unverified && <UnverifiedBanner text={tr("上一笔提现的结果还没确认，核对清楚前暂停提现。")} checking={verifying} tr={tr} recheck={() => void verifyUnverified()}
      dismiss={() => { clearTimeout(recheck.current); store.setUnverifiedWithdraw(currency, null); setError(null); }} />}
    {ipIssue && <UntrustedIPCard issue={ipIssue} tr={tr} onGuide={onGuide} />}
    <StatusLines notice={notice} errors={[error]} />
    {history.length > 0 && <section className="card trade-card">
      <h2>{tr("提现记录")}</h2>
      <div className="trade-history">{history.map((w) => {
        const chain = networkFor(w.network) ?? network, url = w.txid ? explorerURL(chain, w.txid) : undefined;
        return <div key={w.id} className="trade-history-row">
          <span><span>{w.amount ?? "—"} {unit}{!isPearl && networkFor(w.network) ? ` · ${networkName(networkFor(w.network)!)}` : ""}</span>
            {w.destination && <small className="trade-mono">{shortAddr(w.destination)}</small>}{w.createdAt && <small>{when(w.createdAt, lang)}</small>}</span>
          <span><small className={stateClass(w.state)}>{stateText(w.state)}</small>{url && <a className="trade-small-link" href={url} target="_blank" rel="noreferrer">{tr("查看交易")}</a>}</span>
        </div>;
      })}</div>
    </section>}
    <Processing shown={submitting} tr={tr} />
    {naming && <AlertDialog title={isPearl ? tr("加入通讯录") : tr("保存为常用地址")}
      message={<><span className="trade-mono">{isPearl ? shortAddr(trimmed) : `${network ? networkName(network) : ""} · ${shortAddr(trimmed)}`}</span>
        <input className="trade-dialog-input" placeholder={tr("名称")} aria-label={tr("名称")} value={presetName} onChange={(e) => setPresetName(e.target.value)} /></>}
      buttons={[{ label: tr("保存"), kind: "primary", onClick: savePreset }, { label: tr("取消"), kind: "cancel", onClick: () => setNaming(false) }]} onClose={() => setNaming(false)} />}
  </SubPage>;
}
