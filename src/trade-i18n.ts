// The 交易 tab's copy: the iOS app's own strings (prl-hub Sources/*.lproj/Localizable.strings, keyed by
// their Chinese source text, %@ → {0}) for every string the iOS Trade folder uses, plus the few the
// Android version words differently (the Android Keystore instead of the iCloud Keychain; fingerprint,
// face or screen lock instead of Face ID). zh-Hans is the keys themselves. Loaded with the tab only.
import copy from "./trade-copy.json" with { type: "json" };
import { fill } from "./android.ts";
import type { Tr } from "./safetrade.ts";
import type { Lang } from "./types.ts";

const tables = copy as Record<string, Record<string, string>>;
export function tradeText(lang: Lang): Tr {
  const table = lang === "zh-Hans" ? {} : tables[lang] ?? tables.en;
  return (key, ...args) => fill(table[key] ?? key, ...args);
}
