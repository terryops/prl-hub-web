import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { touchHover } from "./scripts/touch-hover.mjs";
// `vite build --mode android` builds the copy bundled in the Android app (scripts/build-android.mjs).
export default defineConfig(({ mode }) => ({
  server: { proxy: { "/v1": "http://127.0.0.1:8787" } },
  define: { __PEARL_ANDROID__: JSON.stringify(mode === "android") },
  build: mode === "android" ? { outDir: "dist-android", emptyOutDir: true } : undefined,
  // The app runs on touch screens: hover styles show only while pressed (scripts/touch-hover.mjs).
  css: mode === "android" ? { postcss: { plugins: [touchHover()] } } : undefined,
  plugins: [{
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
