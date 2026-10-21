import type { ClipboardEvent } from "react";
import type { TextKey } from "./i18n/index.ts";
import { Icon } from "./Icons.tsx";
import { Money } from "./Money.tsx";

type Translate = (key: TextKey) => string;
export function PaymentHead({ amount, estimate, t, onCopy }: { amount: string; estimate: string; t: Translate; onCopy: (value: string) => void }) {
  return <div className="payment-head">
    <p>{t("amount")}</p>
    <strong className="payment-amount">{amount}</strong>
    <div className="payment-unit-row"><small>PRL</small><button onClick={() => onCopy(amount)}><Icon name="copy" />{t("copy")}</button></div>
    <p className="muted"><Money amount={estimate} /></p>
  </div>;
}
// Two lines on screen, one address on the clipboard: copying a selection drops the line break the
// halves put in it (a pasted "prl1…\n…" is no address). A tap selects the whole address (style.css).
function copyWithoutBreaks(event: ClipboardEvent<HTMLElement>) {
  const selected = window.getSelection()?.toString() ?? "";
  if (!selected) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", selected.replace(/\s+/g, ""));
}
export function PaymentAddress({ address, t, onCopy }: { address: string; t: Translate; onCopy: (value: string) => void }) {
  // Split the display once; the QR, accessible name and clipboard keep the full address.
  const middle = Math.ceil(address.length / 2);
  return <div className="pay-address"><code title={address} aria-label={address} onCopy={copyWithoutBreaks}><span>{address.slice(0, middle)}</span><span>{address.slice(middle)}</span></code><button aria-label={t("copy")} title={t("copy")} onClick={() => onCopy(address)}><Icon name="copy" /><span className="payment-copy-text">{t("copy")}</span></button></div>;
}
