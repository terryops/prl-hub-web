import { Icon } from "./Icons.tsx";
import { extensionSources, extensionSecurityCopy } from "./extension-sources.ts";
import type { Lang } from "./types.ts";

export function ExtensionSecurity({ lang }: { lang: Lang }) {
  const c = extensionSecurityCopy(lang);
  return <aside className="extension-security" aria-label={c.title}>
    <div className="extension-security-title"><Icon name="lock" /><h3>{c.title}</h3></div>
    <p>{c.body}</p>
    <a className="extension-security-source" href={extensionSources.source} target="_blank" rel="noreferrer"><span>{c.source}</span><Icon name="external" /></a>
  </aside>;
}
