import { Icon } from "./Icons.tsx";
import { extensionSources, extensionSecurityCopy } from "./extension-sources.ts";
import type { Lang } from "./types.ts";

export function ExtensionSecurity({ lang }: { lang: Lang }) {
  const c = extensionSecurityCopy(lang);
  const entries = [[c.source, extensionSources.source], [c.store, extensionSources.store], [c.releases, extensionSources.releases]];
  return <aside className="extension-security" aria-label={c.title}>
    <div className="extension-security-title"><Icon name="lock" /><h3>{c.title}</h3></div>
    <p>{c.body}</p><p>{c.channels}</p>
    <details><summary>{c.details}</summary><p>{c.check}</p><div className="extension-security-links">
      {entries.map(([label, url]) => url ? <a key={label} href={url} target="_blank" rel="noreferrer"><span>{label}</span><Icon name="external" /></a> : <span className="source-pending" key={label}><span>{label}</span><small>{c.pending}</small></span>)}
    </div></details>
  </aside>;
}
