// 设置 → 交易（SafeTrade） and its 获取 API 密钥 page (iOS TradeSettingsView), loaded with the trade copy
// only when opened. A saved or cleared key makes the 交易 tab read its account again.
import { useMemo } from "react";
import { tradeText } from "./trade-i18n.ts";
import "./trade.css";
import { tradeStore } from "./trade-store.ts";
import { KeyGuide, KeySettings } from "./TradeKeys.tsx";
import type { Lang } from "./types.ts";

export default function TradeSettings({ lang, page, onGuide }: { lang: Lang; page: "trade" | "tradeGuide"; onGuide: () => void }) {
  const tr = useMemo(() => tradeText(lang), [lang]);
  return page === "tradeGuide" ? <KeyGuide tr={tr} /> : <KeySettings tr={tr} onGuide={onGuide} onChanged={() => void tradeStore().keysChanged()} />;
}
