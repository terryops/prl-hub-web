import { Icon } from "./Icons.tsx";
import { ExtensionSecurity } from "./ExtensionSecurity.tsx";
import type { Lang } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
// The official wallet download is maintained separately from this frontend.
import manifest from "./extension-release.json";

export function WalletExtension({ t, copy, lang }: {
  lang: Lang;
  t: (key: TextKey) => string;
  copy: (value: string) => Promise<void>;
}) {
  return (
    <div className="wallet-guide">
      <section className="card extension-hero">
        <div className="extension-brand">
          <img src="/icon-192.png?v=pearl" alt="" />
          <div><span className="badge">{t("extensionBadge")}</span><h2>Pearl Hub Wallet</h2></div>
        </div>
        <p className="extension-intro">{t("extensionIntro")}</p>
        <ul className="extension-features">
          <li><Icon name="sent" />{t("extensionSend")}</li>
          <li><Icon name="wallet" />{t("extensionRestore")}</li>
          <li><Icon name="lock" />{t("extensionLocal")}</li>
        </ul>
        <a className="primary extension-download" href={`https://prl.tools.video/downloads/pearl-hub-wallet-${manifest.version}.zip`} download>
          {t("extensionDownload")} <Icon name="down" />
        </a>
        <p className="extension-release">v{manifest.version} · {t("extensionRelease")}</p>
        <ExtensionSecurity lang={lang} />
        <p className="extension-desktop">{t("extensionDesktop")}</p>
      </section>
      <section className="card extension-install">
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
        <div className="extension-existing"><h3>{t("extensionUpdate")}</h3><p>{t("extensionUpdateNote")}</p></div>
        <div className="extension-existing"><h3>{t("extensionExisting")}</h3><p>{t("extensionExistingNote")}</p></div>
      </section>
    </div>
  );
}
