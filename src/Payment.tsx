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
export function PaymentAddress({ address, t, onCopy }: { address: string; t: Translate; onCopy: (value: string) => void }) {
  // Split the display once; the QR, accessible name and clipboard keep the full address.
  const middle = Math.ceil(address.length / 2);
  return <div className="pay-address"><code title={address} aria-label={address}><span>{address.slice(0, middle)}</span><span>{address.slice(middle)}</span></code><button aria-label={t("copy")} title={t("copy")} onClick={() => onCopy(address)}><Icon name="copy" /><span className="payment-copy-text">{t("copy")}</span></button></div>;
}
