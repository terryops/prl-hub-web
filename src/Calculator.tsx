import { Money, PRLAmount } from "./Money.tsx";
import type { CalculatorInput, Overview, Price, Lang } from "./types.ts";
import { calculate, normalizeCalculator, scenarioUnit } from "./calculator.ts";
import { NetworkSummary, numeric, type Translate } from "./PoolOverview.tsx";
import { useGPUs } from "./gpus.ts";
import { usd, roundRent } from "./format.ts";
export function Calculator({
  value,
  onChange,
  data,
  price,
  failed,
  t,
  lang,
  formatMoney = (v) => usd(v, lang),
}: {
  value: CalculatorInput;
  onChange: (c: CalculatorInput) => void;
  data?: Overview;
  price?: Price;
  failed?: boolean;
  t: Translate;
  lang: Lang;
  formatMoney?: (v: number) => string;
}) {
  const gpus = useGPUs();
  const p = value.price ?? price?.usd ?? null,
    unit = scenarioUnit(value, data?.network?.prlPerTHDay ?? null, data?.network?.hashrate ?? null);
  const r = calculate(value, p, unit);
  const set = (patch: Partial<CalculatorInput>) => {
    try {
      onChange(normalizeCalculator({ ...value, ...patch }));
    } catch {
      /* Keep the last valid input. Native bounds also describe acceptable values. */
    }
  };
  const field = (
    key:
      | "count"
      | "th"
      | "watts"
      | "hardware"
      | "hours"
      | "fee"
      | "electricity"
      | "rent"
      | "growth"
      | "price"
      | "yield",
    label: string,
    min: number,
    max: number,
    step: number,
    placeholder?: string,
  ) => (
    <label className="form-field" key={key}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={key === "rent" ? roundRent(value.rent) : value[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) =>
          set({
            [key]:
              e.target.value === "" && ["price", "yield"].includes(key)
                ? null
                : key === "rent" ? roundRent(Number(e.target.value)) : Number(e.target.value),
          })
        }
      />
    </label>
  );
  const money = (v: number | null, block = false) => <Money amount={v != null ? formatMoney(v) : "—"} block={block} />;
  const fields = [
    field("count", t("deviceCount"), 1, 100000, 1),
    field("th", t("deviceHash") + " (TH/s)", 0, 1e9, 0.01),
    field("watts", t("devicePower") + " (W)", 0, 1e9, 1),
    field("hours", t("hoursDay"), 0, 24, 0.5),
    field("fee", t("totalFee") + " (%)", 0, 100, 0.01),
    value.rented
      ? field("rent", t("hourlyRent") + " (USD)", 0, 1e9, 0.0001)
      : field("hardware", t("hardwareCost") + " (USD)", 0, 1e9, 1),
    field("electricity", t("electricity") + " (USD/kWh)", 0, 1000, 0.001),
  ];
  return (
    <>
      <div className="calculator-layout">
        <section className="card calculator-inputs">
          <h2>{t("deviceInputs")}</h2>
          <label className="form-field">
            {t("gpuReference")}
            <select
              value={value.gpu}
              onChange={(e) => {
                const g = gpus.find((g) => g.name === e.target.value);
                set(
                  g
                    ? {
                        gpu: g.name,
                        th: g.th,
                        watts: g.watts,
                        hardware: g.price,
                      }
                    : { gpu: "custom" },
                );
              }}
            >
              <option value="custom">{t("custom")}</option>
              {gpus.map((g) => (
                <option key={g.name}>{g.name}</option>
              ))}
            </select>
          </label>
          <div className="segments calc-mode">
            <button
              className={!value.rented ? "selected" : ""}
              onClick={() => set({ rented: false })}
            >
              {t("owned")}
            </button>
            <button
              className={value.rented ? "selected" : ""}
              onClick={() => set({ rented: true })}
            >
              {t("rented")}
            </button>
          </div>
          <div className="calculator-fields">{fields}</div>
          {value.rented && (
            <label className="compact-check rent-check">
              <input
                type="checkbox"
                checked={value.rentCoversPower}
                onChange={(e) => set({ rentCoversPower: e.target.checked })}
              />
              {t("rentPower")}
            </label>
          )}
          <details className="help calculator-advanced">
            <summary>{t("scenario")}</summary>
            <div className="calculator-fields">
              <label className="form-field">{t("scenarioNetwork")} (EH/s)<input type="number" min={0.000001} step={0.1} value={value.networkHash == null ? "" : value.networkHash / 1e18} placeholder={data?.network?.hashrate ? String(data.network.hashrate / 1e18) : t("live")} onChange={(e) => set({ networkHash: e.target.value === "" ? null : e.target.valueAsNumber * 1e18 })} /></label>
              {field(
                "price",
                t("scenarioPrice") + " (USD)",
                0.000001,
                1e9,
                0.000001,
                p != null ? numeric(p, 6, lang) : t("live"),
              )}
              {field(
                "yield",
                t("scenarioYield"),
                0.000001,
                1e9,
                0.000001,
                unit != null ? numeric(unit, 6, lang) : t("live"),
              )}
              {field("growth", t("monthlyGrowth") + " (%)", -98, 10000, 0.1)}
            </div>
            <button
              className="text-button"
              onClick={() => set({ price: null, yield: null, networkHash: null, growth: 0 })}
            >
              {t("resetLive")}
            </button>
          </details>
          <p className="help">{t("referenceNote")}</p>
        </section>
        <section className="card calculator-results" aria-live="polite">
          <div className="card-heading">
            <h2>{t("estimatedResult")}</h2>
            <span className="badge">USD</span>
          </div>
          {(failed || price?.stale || data?.stale) && (
            <p className="status warn">{t("stale")}</p>
          )}
          {(p == null || unit == null) && (
            <p className="status warn">{t("waitingNetwork")}</p>
          )}
          <small>{t("netDay")}</small>
          <div
            className={`calc-net ${r.net != null && r.net >= 0 ? "positive" : "negative"}`}
          >
            {money(r.net, true)}
          </div>
          <p className="help calc-net-note">{t("fleetEstimateNote")}</p>
          <div className="break-even">
            <small>{t("costPrice")}</small>
            <strong>
              {money(r.costPerPRL)}
              <small> / PRL</small>
            </strong>
          </div>
          <details className="help calculator-breakdown">
            <summary>{t("resultDetails")}</summary>
            <dl className="calculation-lines">
              {[
                [
                  t("grossOutput"),
                  <PRLAmount lang={lang} value={r.dailyPRL} />,
                ],
                [
                  t("afterFeeOutput"),
                  <PRLAmount lang={lang} value={r.netPRL} />,
                ],
                [t("dailyRevenue"), money(r.revenue)],
                [t("dailyPower"), money(r.power)],
                [t("dailyRent"), money(r.rent)],
                [t("rentLimit"), <>{money(r.rentLimit)} / h</>],
                [
                  t("payback"),
                  r.payback != null
                    ? numeric(r.payback, 1, lang) + " " + t("days")
                    : t("notApplicable"),
                ],
                [t("net30"), money(r.net30)],
                [t("net90"), money(r.net90)],
              ].map(([label, v]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="help">{t("costExplanation")}</p>
            <p className="help">{t("calculationExplanation")}</p>
          </details>
          <footer className="data-footer">
            <span>
              {t("priceUsed")} · {money(p)}
            </span>
            <span>
              {value.price != null || value.yield != null || value.networkHash != null
                ? t("scenario")
                : data?.network?.source || "—"}
            </span>
          </footer>
        </section>
      </div>
      <details className="card calculator-network">
        <summary>{t("networkReference")}</summary>
        <NetworkSummary data={data} failed={failed} t={t} lang={lang} />
      </details>
    </>
  );
}
