import { test, after } from "node:test";
import assert from "node:assert/strict";
import { browserLanguage, detectLanguage } from "../src/preferences.ts";
import { defaults, configOf, KEY, readGuest, writeStore } from "../src/store.ts";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
} as Storage;
const browser = (languages: string[], language = languages[0] || "en") =>
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages, language } });
after(() => {
  for (const [name, descriptor] of [["navigator", navigatorDescriptor], ["localStorage", storageDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("language detection respects browser preference order and supported locale boundaries", () => {
  assert.equal(detectLanguage(["sv-SE", "ja-JP", "en-US"]), "ja");
  assert.equal(detectLanguage(["en-GB", "fr-FR"]), "en");
  assert.equal(detectLanguage(["pt-PT"]), "pt-BR");
  assert.equal(detectLanguage([" FR_ca "]), "fr");
  assert.equal(detectLanguage(["invalid", "eng", "zhh", "sv-SE"]), "en");
  assert.equal(detectLanguage([]), "en");
  browser([], "de-AT");
  assert.equal(browserLanguage(), "de");
});

test("Chinese locale detection honors script before region, including Macau and lowercase tags", () => {
  for (const tag of ["zh-TW", "zh-hk", "zh-MO", "ZH_hant_CN"]) assert.equal(detectLanguage([tag]), "zh-Hant", tag);
  for (const tag of ["zh-CN", "zh-SG", "zh", "zh-Hans-HK"]) assert.equal(detectLanguage([tag]), "zh-Hans", tag);
});

test("fresh defaults follow the browser; automatic language is recalculated after reopening", () => {
  memory.clear(); browser(["fr-CA", "en"]);
  const state = defaults();
  assert.equal(state.lang, "fr"); assert.equal(state.followBrowserLanguage, true);
  assert.equal(state.theme, "system");
  writeStore(state);
  browser(["zh-MO"]);
  assert.equal(readGuest().lang, "zh-Hant");
  assert.equal(readGuest().followBrowserLanguage, true);
  assert.equal(configOf(readGuest()).followBrowserLanguage, undefined, "browser behavior remains a local preference");
});

test("manual language and theme choices survive reopening and a browser-language change", () => {
  memory.clear(); browser(["ja-JP"]);
  writeStore({ ...defaults(), lang: "ru", followBrowserLanguage: false, theme: "dark" });
  browser(["de-DE"]);
  assert.equal(readGuest().lang, "ru");
  assert.equal(readGuest().followBrowserLanguage, false);
  assert.equal(readGuest().theme, "dark");
});

test("legacy manual choices survive migration; missing or invalid languages use browser defaults", () => {
  browser(["zh-CN"]);
  for (const lang of ["ru", "zh-Hant"]) {
    memory.set(KEY, JSON.stringify({ version: 1, lang, theme: "light" }));
    assert.equal(readGuest().lang, lang);
    assert.equal(readGuest().followBrowserLanguage, false);
    assert.equal(readGuest().theme, "light");
  }
  for (const lang of [undefined, "unknown"]) {
    memory.set(KEY, JSON.stringify({ version: 1, lang }));
    assert.equal(readGuest().lang, "zh-Hans");
    assert.equal(readGuest().followBrowserLanguage, true);
  }
});
