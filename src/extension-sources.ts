import localized from "./extension-security-locales.json" with { type: "json" };
import type { Lang } from "./types.ts";

// Only the publisher's verified official destinations.
export const extensionSources = { source: "https://github.com/terryops/prl-hub-wallet", store: "https://chromewebstore.google.com/detail/amomopjmejbdinidepgbhlkgknkonhah" };
export const extensionSecurityCopy = (lang: Lang) => localized[lang] || localized.en;
