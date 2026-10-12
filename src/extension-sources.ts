import localized from "./extension-security-locales.json";
import type { Lang } from "./types.ts";

// Fill these only with the publisher's verified official destinations.
// Empty values render as pending text rather than navigable links.
export const extensionSources = { source: "", store: "", releases: "" };
export const extensionSecurityCopy = (lang: Lang) => localized[lang] || localized.en;
