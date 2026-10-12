import type { Lang, State } from "./types.ts";

export const langs: Lang[] = ["en", "ru", "zh-Hans", "zh-Hant", "vi", "id", "es", "pt-BR", "fr", "de", "it", "tr", "ja", "ko", "hi", "th"];

export function detectLanguage(preferences: readonly string[]): Lang {
  for (const raw of preferences) {
    const locale = raw.trim().toLowerCase().replaceAll("_", "-");
    const [base, ...parts] = locale.split("-");
    if (base === "zh") {
      if (parts.includes("hans")) return "zh-Hans";
      return parts.includes("hant") || parts.some((part) => ["tw", "hk", "mo"].includes(part)) ? "zh-Hant" : "zh-Hans";
    }
    if (base === "pt") return "pt-BR";
    if (langs.includes(base as Lang)) return base as Lang;
  }
  return "en";
}

export function browserLanguage(): Lang {
  return detectLanguage(typeof navigator === "undefined" ? [] : [...(navigator.languages || []), navigator.language || ""]);
}

export function applyAppearance(theme: State["theme"], palette: unknown): void {
  document.documentElement.dataset.theme = theme === "light" || theme === "dark"
    ? theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.palette = palette === "mono" ? "mono" : "classic";
}
