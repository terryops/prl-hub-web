import { Icon } from "./Icons.tsx";
import { ExtensionSecurity } from "./ExtensionSecurity.tsx";
import { extensionSources } from "./extension-sources.ts";
import type { Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
// The official wallet download is maintained separately from this frontend.
import manifest from "./extension-release.json";

const download = `/downloads/pearl-hub-wallet-${manifest.version}.zip`;

// The wallet page leads with this: what the extension does, its Chrome Web Store page, and the full guide.
// Touch devices get only the guide, which says the extension needs desktop Chrome.
// Hiding it is remembered on this device; the page subtitle then offers it back.
export function ExtensionBanner({ t, onGuide, onHide }: { t: (key: TextKey) => string; onGuide: () => void; onHide: () => void }) {
  return (
    <section className="card extension-banner">
      <button className="icon-button extension-banner-hide" onClick={onHide} aria-label={t("extensionHide")} title={t("extensionHide")}><Icon name="close" /></button>
      <img src="/icon-192.png?v=pearl-light" alt="" />
      <div className="extension-banner-text">
        <h2>Pearl Hub Wallet <small>{t("extensionBadge")} · v{manifest.version}</small></h2>
        <p>{t("extensionIntro")}</p>
      </div>
      <div className="extension-banner-actions">
        <a className="primary extension-banner-store" href={extensionSources.store} target="_blank" rel="noreferrer">{t("extensionAddToChrome")} <Icon name="external" /></a>
        <button onClick={onGuide}>{t("extensionInstall")}</button>
      </div>
    </section>
  );
}

// The full guide, in the dialog the banner and the wallet's Send action open: plain sections
// rather than nested cards, under a dialog heading that names the extension. The Chrome Web Store
// comes first; the ZIP and its manual steps stay in a fold for browsers without the store.
export function WalletExtension({ t, copy, lang }: {
  lang: Lang;
  t: (key: TextKey) => string;
  copy: (value: string) => Promise<void>;
}) {
  const setUp = <li><h3>{t("extensionStep4")}</h3><p>{t("extensionStep4Note")}</p></li>;
  return (
    <div className="wallet-guide">
      <section className="extension-overview">
        <div className="extension-brand">
          <img src="/icon-192.png?v=pearl-light" alt="" />
          <div><h2>Pearl Hub Wallet</h2><p className="extension-intro">{t("extensionIntro")}</p></div>
        </div>
        <ul className="extension-features">
          <li><Icon name="sent" />{t("extensionSend")}</li>
          <li><Icon name="wallet" />{t("extensionRestore")}</li>
          <li><Icon name="lock" />{t("extensionLocal")}</li>
        </ul>
        <div className="extension-get">
          <a className="primary extension-store" href={extensionSources.store} target="_blank" rel="noreferrer">
            {t("extensionAddToChrome")} <Icon name="external" />
          </a>
          <p className="extension-release">v{manifest.version} · {t("extensionStoreRelease")}</p>
        </div>
        <p className="extension-desktop">{t("extensionDesktop")}</p>
        <ExtensionSecurity lang={lang} />
      </section>
      <section className="extension-install">
        <h2>{t("extensionInstall")}</h2>
        <ol className="extension-steps">
          <li><h3>{t("extensionStoreStep")}</h3><p>{t("extensionStoreStepNote")}</p></li>
          {setUp}
        </ol>
        <div className="extension-notes">
          <div><h3>{t("extensionExisting")}</h3><p>{t("extensionExistingNote")}</p></div>
          <div><h3>{t("extensionMoved")}</h3><p>{t("extensionMovedNote")}</p></div>
        </div>
        <details className="extension-manual">
          <summary>{t("extensionManual")}</summary>
          <p className="extension-manual-note">{t("extensionManualNote")}</p>
          <div className="extension-get">
            <a className="extension-download" href={download} download>{t("extensionDownload")} <Icon name="down" /></a>
            <p className="extension-release">v{manifest.version} · {t("extensionRelease")}</p>
          </div>
          <ol className="extension-steps">
            <li><h3>{t("extensionStep1")}</h3><p>{t("extensionStep1Note")}</p></li>
            <li>
              <h3>{t("extensionStep2")}</h3><p>{t("extensionStep2Note")}</p>
              <div className="extension-address"><code>chrome://extensions</code><button onClick={() => void copy("chrome://extensions")}><Icon name="copy" />{t("extensionCopy")}</button></div>
            </li>
            <li><h3>{t("extensionStep3")}</h3><p>{t("extensionStep3Note")}</p></li>
            {setUp}
          </ol>
          <div className="extension-notes">
            <div><h3>{t("extensionUpdate")}</h3><p>{t("extensionUpdateNote")}</p></div>
          </div>
        </details>
      </section>
    </div>
  );
}
