import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { touchHover } from "./scripts/touch-hover.mjs";

// The website's read-only 交易 page (TradeWeb.tsx) needs a few dozen of trade-copy.json's strings, not all of the
// Android tab's (~600 KB): this module is that file cut down to the tr("…") keys its source files use.
const TRADE_WEB_COPY = "virtual:trade-web-copy";
const TRADE_WEB_SOURCES = ["TradeWeb.tsx", "TradeTab.tsx", "TradeDepthChart.tsx"];
const tradeWebCopy = {
  name: "trade-web-copy",
  resolveId: (id: string) => id === TRADE_WEB_COPY ? `\0${id}` : undefined,
  load(this: { addWatchFile(path: string): void }, id: string) {
    if (id !== `\0${TRADE_WEB_COPY}`) return undefined;
    const src = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url));
    const keys = new Set<string>();
    for (const name of TRADE_WEB_SOURCES) {
      this.addWatchFile(src(name));
      for (const m of readFileSync(src(name), "utf8").matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
    }
    this.addWatchFile(src("trade-copy.json"));
    const tables = JSON.parse(readFileSync(src("trade-copy.json"), "utf8")) as Record<string, Record<string, string>>;
    const cut = Object.fromEntries(Object.entries(tables).map(([lang, table]) => [lang, Object.fromEntries(Object.entries(table).filter(([k]) => keys.has(k)))]));
    return `export default ${JSON.stringify(cut)};`;
  },
};
// `vite build --mode android` builds the copy bundled in the Android app (scripts/build-android.mjs).
export default defineConfig(({ mode }) => ({
  server: { proxy: { "/v1": "http://127.0.0.1:8787" } },
  define: { __PEARL_ANDROID__: JSON.stringify(mode === "android") },
  build: mode === "android" ? { outDir: "dist-android", emptyOutDir: true } : undefined,
  // The app runs on touch screens: hover styles show only while pressed (scripts/touch-hover.mjs).
  css: mode === "android" ? { postcss: { plugins: [touchHover()] } } : undefined,
  plugins: [tradeWebCopy, {
    name: "privacy-page",
    generateBundle() {
      for (const page of ["privacy", "support"]) {
        const source = readFileSync(new URL(`./content/${page}.html`, import.meta.url), "utf8");
        const style = source.match(/<style>([\s\S]*?)<\/style>/);
        if (!style) throw new Error(`${page} page stylesheet is missing`);
        // Honor the site's CSP by keeping page styles in a local stylesheet.
        this.emitFile({ type: "asset", fileName: `assets/${page}.css`, source: style[1] });
        this.emitFile({ type: "asset", fileName: `${page}.html`, source: source
          .replace(style[0], `<link rel="stylesheet" href="/assets/${page}.css">`)
          .replace('src="/logo.png"', 'src="/icon-192.png"') });
      }
    },
  }],
}));
