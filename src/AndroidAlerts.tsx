// Pieces of the Android app's 价格和到账提醒 page (iOS AlertsView in PriceAlertsView.swift, AlertPageParts.swift and
// IncomeAlertsView.swift, 2.1.9): each card's title block, and the 到账提醒 card. The page itself, with the price
// alerts, the notification card and 推送时段, stays in main.tsx next to the website's alerts page.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons.tsx";
import { InfoTip } from "./InfoTip.tsx";
import { fill, type AndroidCopy } from "./android.ts";
import { useBackLayer } from "./back-layer.ts";
import { normalizeIncomeAddress, shortAddress, type IncomeSetting, type KnownAddress } from "./income-alert.ts";

/** A card's title block (iOS AlertCardHeader): badge, the alert's name with its ⓘ, one line on what it pushes, and
 *  the card's own control on the right. */
export function AlertCardHeader({ icon, title, subtitle, info, children }: { icon: IconName; title: string; subtitle: string; info?: string; children?: ReactNode }) {
  return <div className="alert-card-head">
    <span className="alert-card-badge"><Icon name={icon} /></span>
    <span className="alert-card-copy">
      <span className="android-title-tip"><strong>{title}</strong>{info && <InfoTip label={title} text={info} />}</span>
      <small>{subtitle}</small>
    </span>
    {children}
  </div>;
}

const OTHER = "__other", CURRENT = "__current";

/** 到账提醒 (iOS IncomeAlertCard): one address, a push when it is paid. The address is picked, not typed: it starts as
 *  the open wallet's own, the menu lists the other wallets (read-only ones too) and the monitors' payout addresses, and
 *  其他地址… takes any other. Before the alert was ever set the card ends in 开启到账提醒; after that the switch in its
 *  header turns it off and on, and picking another address moves it there, on or off as it was. */
export function AndroidIncomeCard({ a, setting, known, own, window, onSet }: {
  a: AndroidCopy; setting: IncomeSetting | null;
  /** The user's wallets and monitors (income-alert.ts knownAddresses). */
  known: KnownAddress[];
  /** The open wallet's main mainnet address, if known. */
  own: string | null;
  /** 推送时段 is set: the ⓘ says what happens to a payment outside it. */
  window: boolean;
  onSet(next: IncomeSetting): void;
}) {
  // Picked before the alert was ever switched on (null: the open wallet's own address).
  const [choice, setChoice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const selected = setting?.addr ?? choice ?? own ?? known[0]?.addr ?? null;
  // The name this address goes by here (the one saved with the alert, for an address that is no longer one of these).
  const nameFor = (addr: string) => known.find((k) => k.addr === addr)?.name ?? (setting?.addr === addr ? setting.label : "");
  const kindOf = (addr: string | null) => known.find((k) => k.addr === addr)?.kind;
  const name = selected ? nameFor(selected) : "";
  const howItWorks = [a.incomeIntro, ...window ? [a.incomeWindowNote] : [], a.incomePrivacy].join("\n\n");

  // Before the alert exists a pick only changes what 开启 will watch; after, it moves the alert there, still on or off
  // as it was (an alert switched off is not sent anywhere).
  const pick = (addr: string) => {
    if (setting) { if (addr !== setting.addr) onSet({ addr, label: nameFor(addr), on: setting.on }); }
    else setChoice(addr);
  };
  const enable = () => {
    if (!selected) { setTyping(true); return; }
    // The push leads with the name the address has here (a wallet's, a monitor's).
    onSet({ addr: selected, label: nameFor(selected), on: true });
  };

  const row = <span className={setting?.on === false ? "income-row off" : "income-row"} aria-hidden="true">
    <Icon name={kindOf(selected) === "wallet" ? "wallet" : kindOf(selected) === "monitor" ? "workers" : "received"} />
    <span className="income-row-copy">{selected
      ? <><strong>{name || shortAddress(selected)}</strong>{name && <code>{shortAddress(selected)}</code>}</>
      : <span className="muted">{a.incomeAddress}</span>}</span>
    <Icon name="chevron" className="income-row-chevron" />
  </span>;
  const label = `${a.incomeAddress}${selected ? `: ${name ? `${name}, ` : ""}${shortAddress(selected)}` : ""}`;
  const wallets = known.filter((k) => k.kind === "wallet"), monitors = known.filter((k) => k.kind === "monitor");
  const option = (k: KnownAddress) => <option key={k.addr} value={k.addr}>{`${k.name} · ${shortAddress(k.addr)}`}</option>;

  return <section className="card alert-card income-card">
    <AlertCardHeader icon="received" title={a.incomeAlerts} subtitle={a.incomeSubtitle} info={howItWorks}>
      {setting && <input type="checkbox" className="switch" aria-label={a.incomeAlerts} checked={setting.on}
        onChange={(e) => onSet({ ...setting, on: e.target.checked })} />}
    </AlertCardHeader>
    {/* Nothing to choose from: straight to typing one. Otherwise the system's list over the row. */}
    {!known.length
      ? <button type="button" className="income-pick" aria-label={label} onClick={() => setTyping(true)}>{row}</button>
      : <label className="income-pick">{row}
        <select aria-label={label} value={selected && known.some((k) => k.addr === selected) ? selected : CURRENT}
          onChange={(e) => { const v = e.target.value; if (v === OTHER) setTyping(true); else if (v !== CURRENT) pick(v); e.target.value = selected ?? CURRENT; }}>
          {/* The address shown when it is none of the known ones (typed earlier), so the list opens on it. */}
          <option value={CURRENT} hidden disabled>{selected ? name || shortAddress(selected) : a.incomeAddress}</option>
          {wallets.length > 0 && <optgroup label={a.myWallets}>{wallets.map(option)}</optgroup>}
          {monitors.length > 0 && <optgroup label={a.myMonitors}>{monitors.map(option)}</optgroup>}
          <option value={OTHER}>{a.incomeOther}</option>
        </select>
      </label>}
    {!setting && <button type="button" className="primary wide" onClick={enable}><Icon name="alerts" />{a.incomeEnable}</button>}
    {typing && <IncomeAddressSheet a={a} initial={selected && !known.some((k) => k.addr === selected) ? selected : ""}
      onDone={(addr) => { setTyping(false); pick(addr); }} onCancel={() => setTyping(false)} />}
  </section>;
}

/** 其他地址…: type or paste any mainnet PRL address (iOS IncomeAddressSheet). */
function IncomeAddressSheet({ a, initial, onDone, onCancel }: { a: AndroidCopy; initial: string; onDone(addr: string): void; onCancel(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initial);
  const normalized = normalizeIncomeAddress(text);
  const invalid = text.trim() !== "" && !normalized;
  useBackLayer(true, onCancel);
  useEffect(() => { const d = dialog.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  const done = () => { if (normalized) onDone(normalized); };
  // A pasted payment link (pearl:…?amount=) goes in as the bare address it names.
  const paste = () => void navigator.clipboard?.readText().then((s) => { if (s) setText(normalizeIncomeAddress(s) ?? s.trim()); }, () => {});
  return <dialog ref={dialog} className="android-sheet income-sheet" aria-labelledby="income-sheet-title"
    onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => { if (e.target === dialog.current) onCancel(); }}>
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); done(); }}>
      <div className="income-sheet-bar">
        <button type="button" className="text-button" onClick={onCancel}>{a.cancel}</button>
        <h2 id="income-sheet-title">{a.incomeAddress}</h2>
        <button type="submit" className="text-button" disabled={!normalized}>{a.done}</button>
      </div>
      <div className="income-sheet-field">
        <textarea rows={3} aria-label={a.incomeAddress} placeholder="prl1…" value={text} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(); } }} />
        <button type="button" className="icon-button" aria-label={a.paste} title={a.paste} onClick={paste}><Icon name="copy" /></button>
      </div>
      {invalid && <p className="android-warn" role="alert">{fill(a.incomeBadAddress, "prl1")}</p>}
    </form>
  </dialog>;
}
