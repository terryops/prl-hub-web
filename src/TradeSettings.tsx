// 设置 → 交易 and its 获取 API 密钥 page (iOS TradeSettingsView), loaded with the trade copy
// only when opened. Manages both SafeTrade and Gate keys; a saved or cleared key refreshes 交易.
import { useMemo, useState } from "react";
import type { TradeExchange } from "./safetrade.ts";
import { tradeText } from "./trade-i18n.ts";
import "./trade.css";
import { tradeStore } from "./trade-store.ts";
import { AllKeySettings, KeyGuide } from "./TradeKeys.tsx";
import type { Lang } from "./types.ts";

export default function TradeSettings({
  lang,
  page,
  onGuide,
  onFillKeys,
}: {
  lang: Lang;
  page: "trade" | "tradeGuide";
  onGuide: () => void;
  onFillKeys?: () => void;
}) {
  const tr = useMemo(() => tradeText(lang), [lang]);
  const store = tradeStore();
  const [guideExchange, setGuideExchange] = useState<TradeExchange>(() => store.state.exchange);
  const selectExchange = (ex: TradeExchange) => {
    setGuideExchange(ex);
    store.setExchange(ex);
  };
  return page === "tradeGuide"
    ? <KeyGuide
        tr={tr}
        exchange={guideExchange}
        onExchangeChange={selectExchange}
        onFillKeys={onFillKeys ? (ex) => { selectExchange(ex); onFillKeys(); } : undefined}
      />
    : <AllKeySettings
        tr={tr}
        preferred={guideExchange}
        onGuide={(ex) => { selectExchange(ex); onGuide(); }}
        onSaved={(ex) => selectExchange(ex)}
        onChanged={() => void store.keysChanged()}
      />;
}
