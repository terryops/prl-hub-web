import type { CalculatorInput } from "./types.ts";
export const calculatorDefaults = (): CalculatorInput => ({
  gpu: "RTX 4090",
  count: 1,
  th: 250,
  watts: 450,
  hardware: 1600,
  hours: 24,
  fee: 3,
  electricity: 0.1,
  rent: 0,
  rented: false,
  rentCoversPower: true,
  growth: 0,
  price: null,
  yield: null,
  networkHash: null,
});
export function normalizeCalculator(value: unknown): CalculatorInput {
  if (value == null) return calculatorDefaults();
  if (typeof value !== "object") throw new Error("invalid_config");
  const c = { ...calculatorDefaults(), ...value } as CalculatorInput;
  const bounds = {
    count: [1, 100000],
    th: [0, 1e9],
    watts: [0, 1e9],
    hardware: [0, 1e9],
    hours: [0, 24],
    fee: [0, 100],
    electricity: [0, 1000],
    rent: [0, 1e9],
    growth: [-98, 10000],
  } as const;
  for (const [k, [min, max]] of Object.entries(bounds)) {
    const x = c[k as keyof typeof bounds];
    if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max)
      throw new Error("invalid_config");
  }
  if (
    !Number.isInteger(c.count) ||
    typeof c.gpu !== "string" ||
    c.gpu.length > 64 ||
    typeof c.rented !== "boolean" ||
    typeof c.rentCoversPower !== "boolean"
  )
    throw new Error("invalid_config");
  for (const k of ["price", "yield"] as const)
    if (c[k] !== null && (!Number.isFinite(c[k]) || c[k]! <= 0 || c[k]! > 1e9))
      throw new Error("invalid_config");
  if (c.networkHash != null && (!Number.isFinite(c.networkHash) || c.networkHash <= 0 || c.networkHash > 1e30)) throw new Error("invalid_config");
  return c;
}
export function scenarioUnit(c: CalculatorInput, liveUnit: number | null, liveHash: number | null) {
  return c.yield ?? (c.networkHash != null && liveHash != null && liveHash > 0 && liveUnit != null ? liveUnit * liveHash / c.networkHash : liveUnit);
}
export function calculate(
  c: CalculatorInput,
  price: number | null,
  unit: number | null,
) {
  normalizeCalculator(c);
  const dailyPRL =
    unit != null && unit > 0 ? (c.th * c.count * unit * c.hours) / 24 : null;
  const netPRL = dailyPRL != null ? dailyPRL * (1 - c.fee / 100) : null;
  const power =
    c.rented && c.rentCoversPower
      ? 0
      : ((c.watts * c.count) / 1000) * c.hours * c.electricity;
  const rent = c.rented ? c.rent * c.count * c.hours : 0,
    cost = power + rent;
  const revenue =
    netPRL != null && price != null && price > 0 ? netPRL * price : null;
  const net = revenue != null ? revenue - cost : null;
  const r = (1 + c.growth / 100) ** (-1 / 30);
  const projection = (days: number) =>
    revenue == null
      ? null
      : revenue * (Math.abs(r - 1) < 1e-12 ? days : (1 - r ** days) / (1 - r)) -
        cost * days;
  return {
    dailyPRL,
    netPRL,
    power,
    rent,
    cost,
    revenue,
    net,
    net30: projection(30),
    net90: projection(90),
    costPerPRL: netPRL != null && netPRL > 0 ? cost / netPRL : null,
    rentLimit:
      revenue != null && c.hours > 0
        ? (revenue - power) / (c.count * c.hours)
        : null,
    payback:
      !c.rented && net != null && net > 0 && c.hardware > 0
        ? (c.hardware * c.count) / net
        : null,
  };
}
export function calculatorWithPoolFee(c: CalculatorInput, fee: number | null, devFee: number | null): CalculatorInput {
  if (fee == null || [fee, devFee ?? 0].some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return normalizeCalculator(c);
  return normalizeCalculator({ ...c, fee: Number(((1 - (1 - fee / 100) * (1 - (devFee ?? 0) / 100)) * 100).toFixed(6)) });
}
