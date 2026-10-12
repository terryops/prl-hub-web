import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
export default defineConfig({
  server: { proxy: { "/v1": "http://127.0.0.1:8787" } },
  plugins: [{
    name: "privacy-page",
    generateBundle() {
      const source = readFileSync(new URL("./content/privacy.html", import.meta.url), "utf8");
      const style = source.match(/<style>([\s\S]*?)<\/style>/);
      if (!style) throw new Error("Privacy page stylesheet is missing");
      // Keep the canonical policy in sync while honoring the SPA's strict CSP.
      this.emitFile({ type: "asset", fileName: "assets/privacy.css", source: style[1] });
      this.emitFile({ type: "asset", fileName: "privacy.html", source: source
        .replace(style[0], '<link rel="stylesheet" href="/assets/privacy.css">')
        .replace('src="/logo.png"', 'src="/icon-192.png"') });
    },
  }],
});
