// The 交易 tab's back-button hook, kept apart from TradeTab.tsx so main.tsx can call it without loading the
// tab: TradeTab sets the handler while it's on screen, and it closes the tab's top layer first.
let handler: (() => boolean) | undefined;
export const setTradeBack = (next: (() => boolean) | undefined) => { handler = next; };
export const tradeBack = () => { try { return handler?.() === true; } catch { return false; } };
