import { Icon } from "./Icons.tsx";
import type { IconName } from "./icon-symbols.tsx";
import { securityCopy, type SecurityCopy } from "./security-overview.ts";
import type { Lang } from "./types.ts";

// Sections name keys of `copy`, the shared Security Overview copy unless a caller passes a
// wider one (the Android app's, android-security.ts).
type Section<K> = { title?: K; rows: { icon: IconName; title: K; text: K }[]; repos?: { title: K; url: string }[] };

export function SecurityOverview<C extends SecurityCopy>({ lang, sections, copy }: { lang: Lang; sections: Section<keyof NoInfer<C> & string>[]; copy?: C }) {
  const c = (copy || securityCopy(lang)) as SecurityCopy & Record<keyof C, string>;
  return <div className="security-overview">
    {sections.map((s, i) => <section key={i} className="security-group">
      {s.title && <h3>{c[s.title]}</h3>}
      <ul>
        {s.rows.map((r) => <li key={r.text} className="security-row"><Icon name={r.icon} /><div><strong>{c[r.title]}</strong><p>{c[r.text]}</p></div></li>)}
        {s.repos?.map(({ title, url }) => <li key={title} className="security-repo">{url
          ? <a href={url} target="_blank" rel="noreferrer"><Icon name="external" /><div><strong>{c[title]}</strong><code>{url.replace(/^https:\/\//, "")}</code></div></a>
          : <div className="source-pending"><Icon name="external" /><div><strong>{c[title]}</strong><small>{c.pending}</small></div></div>}</li>)}
      </ul>
    </section>)}
  </div>;
}
