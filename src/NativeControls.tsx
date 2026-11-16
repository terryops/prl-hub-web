import { useState } from "react";
import type { TextKey } from "./i18n/index.ts";
import { ANDROID } from "./android.ts";
import { nativeCall } from "./android-bridge.ts";

export function PasteButton({ t, onPaste }: { t: (key: TextKey) => string; onPaste: (s: string) => void }) {
  const [failed, setFailed] = useState(false);
  return <><button type="button" onClick={() => {
    setFailed(false);
    if (ANDROID) void nativeCall<{ text: string }>("clipboard.read").then((r) => onPaste(r.text)).catch(() => setFailed(true));
    else if (navigator.clipboard) void navigator.clipboard.readText().then(onPaste).catch(() => setFailed(true));
    else setFailed(true);
  }}>{t("paste")}</button>{failed && <small role="status" className="status warn">{t("clipboardError")}</small>}</>;
}
