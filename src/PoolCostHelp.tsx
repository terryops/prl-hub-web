import { HelpTip, InfoMark } from "./InfoTip.tsx";
import type { Lang, PoolOverview } from "./types.ts";
import type { TextKey } from "./i18n/index.ts";
import { hasPpsRealCost, ppsWindowEnd, realCostPeriods } from "./pool-comparison.ts";
export { HelpTip };

export function PoolCostHelp({ rows, lang, t }: { rows: PoolOverview[]; lang: Lang; t: (key: TextKey) => string }) {
  const periods = realCostPeriods(rows), pps = periods.length > 0 && hasPpsRealCost(rows);
  // Without a timeZone override, Intl uses the visitor's device zone; lang controls formatting only.
  const formatter = new Intl.DateTimeFormat(lang, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
  // iOS RealFeeHelpButton: info.circle, like every other ⓘ.
  return <HelpTip label={t("poolRealCostHelp")} className="pool-cost-help info-tip" mark={<InfoMark />}>
      <strong>{t("poolRealCostHelp")}</strong>
      <p>{t(periods.length ? "poolRealCostPeriodIntro" : "poolRealCostPeriodMissing")}</p>
      {periods.map((period) => <div className="pool-cost-period" key={`${period.start}:${period.end}`}>
        {periods.length > 1 && <strong>{period.names.join(" · ")}</strong>}
        <dl><dt>{t("poolRealCostFrom")}</dt><dd><time dateTime={new Date(period.start * 1000).toISOString()}>{formatter.format(period.start * 1000)}</time></dd>
          <dt>{t("poolRealCostTo")}</dt><dd><time dateTime={new Date(period.end * 1000).toISOString()}>{formatter.format(period.end * 1000)}</time></dd></dl>
      </div>)}
      {pps && <p className="pool-cost-note">{t("poolRealCostPpsUpdate").replace("%@",
        new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(ppsWindowEnd()))}</p>}
  </HelpTip>;
}
