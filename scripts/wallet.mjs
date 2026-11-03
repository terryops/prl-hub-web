// The browser wallet is its own public repository, prl-hub-wallet, checked out next to this one.
// Its shared/ holds copies of some web/src files, and the wallet ZIP and the Android wallet are
// built from those copies: say so when they differ from this checkout's web/src.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export const walletURL = new URL("../../prl-hub-wallet/", import.meta.url);
export const wallet = fileURLToPath(walletURL);
export function checkShared() {
  try {
    execFileSync("node", [`${wallet}scripts/sync-shared.mjs`, "--check", fileURLToPath(new URL("../src/", import.meta.url))], { stdio: "pipe" });
  } catch (error) {
    console.warn(`Warning: ${String(error.stdout || error.message).trim()}\nThe wallet is built from its own copies; run npm run sync:shared in prl-hub-wallet and commit there.`);
  }
}
