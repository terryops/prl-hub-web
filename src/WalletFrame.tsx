import type { RefObject } from "react";
import type { WalletControl } from "./android-host.ts";

// Android's 钱包 tab: the browser wallet's own interface, built for the app (src/android in prl-hub-wallet)
// and served at /wallet/. It stays mounted while other tabs show, so its unlock session and
// open dialogs survive tab switches; the shell's back button reaches it through __pearlBack.
export function WalletFrame({ frame, visible, title }: { frame: RefObject<HTMLIFrameElement | null>; visible: boolean; title: string }) {
  return <iframe ref={frame} className="wallet-frame" src="/wallet/" title={title} hidden={!visible} aria-hidden={!visible} />;
}

export function walletBack(frame: RefObject<HTMLIFrameElement | null>): boolean {
  try { return frame.current?.contentWindow?.__pearlBack?.() === true; }
  catch { return false; }
}

export function walletControl(frame: RefObject<HTMLIFrameElement | null>): WalletControl | undefined {
  try { return frame.current?.contentWindow?.__pearlWallet; }
  catch { return undefined; }
}
