// Builds the web bundle the Android app ships (BRIDGE.md in the prl-hub-android repository):
//   dist-android/            the app page (vite --mode android)
//   dist-android/wallet/     the wallet (vite.android.config.ts in prl-hub-wallet, next to this repository)
//   dist-android/csp.txt     the Content-Security-Policy the shell sends with each HTML file
// The Android Gradle build (prl-hub-android, task syncWeb) copies this folder into the APK.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wallet as extension, checkShared } from "./wallet.mjs";

const web = fileURLToPath(new URL("..", import.meta.url));
const out = `${web}dist-android/`;
const run = (cwd, command, args) => execFileSync(command, args, { cwd, stdio: "inherit" });

checkShared();
run(extension, "npm", ["run", "build:android"]);
run(web, "npx", ["tsc", "--noEmit"]);
run(web, "npx", ["vite", "build", "--mode", "android"]);

// The website's deployment files and the Chrome extension download do not belong in the app.
for (const name of ["downloads", "sw.js", "_headers", "robots.txt", "sitemap.xml", "og-image.jpg", "favicon.ico"]) rmSync(`${out}${name}`, { recursive: true, force: true });

cpSync(`${extension}dist-android/`, `${out}wallet/`, { recursive: true });
cpSync(`${web}android-public/`, `${out}android/`, { recursive: true });
renameSync(`${out}wallet/android.html`, `${out}wallet/index.html`);
cpSync(`${extension}public/icon.png`, `${out}wallet/icon.png`);
// The wallet's third-party notices, among them its NOCK core's (licenses/nock-core.txt).
cpSync(`${extension}public/licenses/`, `${out}licenses/`, { recursive: true });

// The site's policy (web/public/_headers) plus the wallet frame and the Blockbook hosts the
// wallet reads (the shell proxies them; see BRIDGE.md). The wallet's NOCK side runs its packaged
// WebAssembly core ('wasm-unsafe-eval'), reads the public Nockchain node rpc.nockbox.org (the
// second node, plain HTTP, goes through the shell's nock.rpc) and CoinGecko's NOCK price.
writeFileSync(`${out}csp.txt`, [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com https://safetrade.com https://blockbook.pearlresearch.ai https://blockbook.testnet.pearlresearch.ai https://rpc.nockbox.org https://api.coingecko.com https://nockscan.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ") + "\n");

for (const required of ["index.html", "wallet/index.html", "csp.txt"]) {
  if (!existsSync(`${out}${required}`)) throw new Error(`dist-android/${required} is missing`);
}
console.log(`Android web bundle ready: ${out}`);
