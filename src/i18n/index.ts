import en from "./en.json";
import ru from "./ru.json";
import hans from "./zh-Hans.json";
import hant from "./zh-Hant.json";
import vi from "./vi.json";
import id from "./id.json";
import es from "./es.json";
import pt from "./pt-BR.json";
import fr from "./fr.json";
import de from "./de.json";
import it from "./it.json";
import tr from "./tr.json";
import ja from "./ja.json";
import ko from "./ko.json";
import hi from "./hi.json";
import th from "./th.json";
import type { Lang } from "../types.ts";
export type TextKey = keyof typeof en;
export const dictionaries: Record<Lang, Record<TextKey, string>> = {
  "en": en,
  "ru": ru,
  "zh-Hans": hans,
  "zh-Hant": hant,
  "vi": vi,
  "id": id,
  "es": es,
  "pt-BR": pt,
  "fr": fr,
  "de": de,
  "it": it,
  "tr": tr,
  "ja": ja,
  "ko": ko,
  "hi": hi,
  "th": th
};
export const languageNames: Record<Lang, string> = {
  "en": "English",
  "ru": "Русский",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  "vi": "Tiếng Việt",
  "id": "Bahasa Indonesia",
  "es": "Español",
  "pt-BR": "Português (Brasil)",
  "fr": "Français",
  "de": "Deutsch",
  "it": "Italiano",
  "tr": "Türkçe",
  "ja": "日本語",
  "ko": "한국어",
  "hi": "हिन्दी",
  "th": "ไทย"
};
