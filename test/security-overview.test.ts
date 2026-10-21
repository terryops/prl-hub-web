import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import locales from "../src/security-overview-locales.json" with { type: "json" };
import { extensionSecurity, repositories, webSecurity } from "../src/security-overview.ts";

const languages = ["en", "ru", "zh-Hans", "zh-Hant", "vi", "id", "es", "pt-BR", "fr", "de", "it", "tr", "ja", "ko", "hi", "th"] as const;

test("security overview: sixteen languages have the same nonempty copy", () => {
  assert.deepEqual(Object.keys(locales).sort(), [...languages].sort());
  const keys = Object.keys(locales.en).sort();
  for (const lang of languages) {
    assert.deepEqual(Object.keys(locales[lang]).sort(), keys, lang);
    for (const [key, text] of Object.entries(locales[lang])) assert.ok(typeof text === "string" && text.trim().length > 0, `${lang}.${key}`);
  }
});

test("security overview: every section names existing copy and icons", () => {
  const icons = readFileSync(new URL("../src/icon-symbols.tsx", import.meta.url), "utf8");
  for (const sections of [webSecurity, extensionSecurity]) {
    for (const section of sections) {
      if (section.title) assert.ok(section.title in locales.en, section.title);
      for (const row of section.rows) {
        assert.ok(row.title in locales.en && row.text in locales.en, row.text);
        assert.match(icons, new RegExp(`\\n  ${row.icon}: <>`), row.icon);
      }
      for (const repo of section.repos || []) assert.ok(repo.title in locales.en, repo.title);
    }
  }
  assert.equal(webSecurity[0].title, "openSource");
  assert.deepEqual(webSecurity[0].repos?.map((r) => r.url), [repositories.app, repositories.web, repositories.server]);
});

test("security overview: the Web CSP still allows only pearlhub.net, Cloudflare Turnstile and SafeTrade", () => {
  // webOthers / webTurnstile / webSafeTrade describe this policy; change the copy with it.
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const csp = headers.match(/Content-Security-Policy: (.*)/)?.[1] || "";
  const directive = (name: string) => csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + " "));
  assert.equal(directive("connect-src"), "connect-src 'self' https://challenges.cloudflare.com https://safetrade.com");
  assert.equal(directive("script-src"), "script-src 'self' https://challenges.cloudflare.com");
  assert.equal(directive("default-src"), "default-src 'self'");
});
