import { Icon } from "./Icons.tsx";
import { securityCopy, type SecuritySection } from "./security-overview.ts";
import type { Lang } from "./types.ts";

export function SecurityOverview({ lang, sections }: { lang: Lang; sections: SecuritySection[] }) {
  const c = securityCopy(lang);
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
