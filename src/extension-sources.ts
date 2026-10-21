import localized from "./extension-security-locales.json" with { type: "json" };
import type { Lang } from "./types.ts";

// Fill these only with the publisher's verified official destinations.
// Empty values render as pending text rather than navigable links.
export const extensionSources = { source: "https://github.com/terryops/prl-hub-wallet", store: "https://chromewebstore.google.com/detail/amomopjmejbdinidepgbhlkgknkonhah", releases: "https://github.com/terryops/prl-hub-wallet/releases" };
export const extensionSecurityCopy = (lang: Lang) => localized[lang] || localized.en;
