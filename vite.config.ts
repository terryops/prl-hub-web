import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
export default defineConfig({
  server: { proxy: { "/v1": "http://127.0.0.1:8787" } },
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
});
