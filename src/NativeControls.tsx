import { useState } from "react";
import type { TextKey } from "./i18n/index.ts";

export function PasteButton({ t, onPaste }: { t: (key: TextKey) => string; onPaste: (s: string) => void }) {
  const [failed, setFailed] = useState(false);
  return <><button type="button" onClick={() => {
    setFailed(false);
    void navigator.clipboard?.readText().then(onPaste).catch(() => setFailed(true));
    if (!navigator.clipboard) setFailed(true);
  }}>{t("paste")}</button>{failed && <small role="status" className="status warn">{t("clipboardError")}</small>}</>;
}
