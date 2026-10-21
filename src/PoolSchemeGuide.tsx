import type { Lang, Overview } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { poolsByScheme, schemeFamilies, type SchemeFamily } from "./pool-comparison.ts";

const copy: Record<SchemeFamily, { name: TextKey; pay: TextKey; bearer: TextKey; risk: TextKey; income: TextKey }> = {
  PPS: { name: "poolSchemePpsName", pay: "poolSchemePpsPay", bearer: "poolSchemeBearerPool", risk: "poolSchemePpsRisk", income: "poolSchemePpsIncome" },
  PROP: { name: "poolSchemePropName", pay: "poolSchemePropPay", bearer: "poolSchemeBearerMiners", risk: "poolSchemePropRisk", income: "poolSchemePropIncome" },
  PPLNS: { name: "poolSchemePplnsName", pay: "poolSchemePplnsPay", bearer: "poolSchemeBearerMiners", risk: "poolSchemePplnsRisk", income: "poolSchemePplnsIncome" },
  SOLO: { name: "poolSchemeSoloName", pay: "poolSchemeSoloPay", bearer: "poolSchemeBearerSelf", risk: "poolSchemeSoloRisk", income: "poolSchemeSoloIncome" },
};
const SHOWN = 4;

/** What PPS, PROP, PPLNS and SOLO pay, who carries luck and orphans, and which pools on the page use each. */
export function PoolSchemeGuide({ data, lang, t }: { data?: Overview; lang: Lang; t: (key: TextKey) => string }) {
  const pools = poolsByScheme(data?.rows || []), network = data?.network;
  // Days 1 PH/s takes to find a block on average, at today's difficulty.
  const soloDays = network?.reward && network.prlPerTHDay ? network.reward / (network.prlPerTHDay * 1000) : null;
  return <details className="card pool-scheme-guide"><summary>{t("poolSchemeGuide")}</summary>
    <p className="pool-scheme-intro">{t("poolSchemeIntro")}</p>
    <div className="pool-scheme-grid">{schemeFamilies.map((family) => {
      const c = copy[family], listed = pools[family];
      return <section className="pool-scheme" key={family} aria-label={`${family} · ${t(c.name)}`}>
        <header><strong>{family}</strong><span>{t(c.name)}</span></header>
        <dl>
          <dt>{t("poolSchemePay")}</dt><dd>{t(c.pay)}</dd>
          <dt>{t("poolSchemeRisk")}</dt><dd><span className={`pool-scheme-bearer${family === "PPS" ? " pool" : ""}`}>{t(c.bearer)}</span> {t(c.risk)}</dd>
          <dt>{t("poolSchemeIncome")}</dt><dd>{t(c.income)}{family === "SOLO" && soloDays != null && Number.isFinite(soloDays) && soloDays > 0 &&
            <> {t("poolSchemeSoloOdds").replace("%@", Math.round(soloDays).toLocaleString(lang))}</>}</dd>
        </dl>
        {family === "PPS" && <p className="pool-scheme-note">{t("poolSchemePpsVariants")}</p>}
        <div className="pool-scheme-pools"><small>{t("poolSchemeHere")}</small>
          {listed.length ? <>{listed.slice(0, SHOWN).map(({ pool, scheme }) => <span className="pool-scheme-chip" key={pool.id}>
            {pool.name}{scheme !== family && <small>{scheme}</small>}</span>)}
            {listed.length > SHOWN && <span className="pool-scheme-chip more">{t("poolSchemeMore").replace("%@", String(listed.length - SHOWN))}</span>}</>
            : <span className="pool-scheme-chip none">—</span>}
        </div>
      </section>;
    })}</div>
    <div className="pool-scheme-extra">
      <section><h3>{t("poolSchemeOrphanTitle")}</h3><p>{t("poolSchemeOrphan")}</p><p>{t("poolSchemeOrphanRate")}</p></section>
      <section><h3>{t("poolSchemeChooseTitle")}</h3><p>{t("poolSchemeChoose")}</p></section>
    </div>
  </details>;
}
