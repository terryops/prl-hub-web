import { Icon } from "./Icons.tsx";
import { ExtensionSecurity } from "./ExtensionSecurity.tsx";
import type { Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
// The official wallet download is maintained separately from this frontend.
import manifest from "./extension-release.json";

// Rendered inside the wallet page's fold card, so the sections are plain blocks rather than nested cards,
// and the fold's summary already names the extension.
export function WalletExtension({ t, copy, lang }: {
  lang: Lang;
  t: (key: TextKey) => string;
  copy: (value: string) => Promise<void>;
}) {
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
          <a className="primary extension-download" href={`https://pearlhub.net/downloads/pearl-hub-wallet-${manifest.version}.zip`} download>
            {t("extensionDownload")} <Icon name="down" />
          </a>
          <p className="extension-release">v{manifest.version} · {t("extensionRelease")}</p>
        </div>
        <p className="extension-desktop">{t("extensionDesktop")}</p>
        <ExtensionSecurity lang={lang} />
      </section>
      <section className="extension-install">
        <h2>{t("extensionInstall")}</h2>
        <ol className="extension-steps">
          <li><h3>{t("extensionStep1")}</h3><p>{t("extensionStep1Note")}</p></li>
          <li>
            <h3>{t("extensionStep2")}</h3><p>{t("extensionStep2Note")}</p>
            <div className="extension-address"><code>chrome://extensions</code><button onClick={() => void copy("chrome://extensions")}><Icon name="copy" />{t("extensionCopy")}</button></div>
          </li>
          <li><h3>{t("extensionStep3")}</h3><p>{t("extensionStep3Note")}</p></li>
          <li><h3>{t("extensionStep4")}</h3><p>{t("extensionStep4Note")}</p></li>
        </ol>
        <div className="extension-notes">
          <div><h3>{t("extensionUpdate")}</h3><p>{t("extensionUpdateNote")}</p></div>
          <div><h3>{t("extensionExisting")}</h3><p>{t("extensionExistingNote")}</p></div>
        </div>
      </section>
    </div>
  );
}
