export type Lang = "en" | "ru" | "zh-Hans" | "zh-Hant" | "vi" | "id" | "es" | "pt-BR" | "fr" | "de" | "it" | "tr" | "ja" | "ko" | "hi" | "th";
export type WindowName = "live" | "m15" | "m30" | "hour" | "h3" | "day";
export type Item = { id: string; updated: number; deleted?: boolean; [key: string]: unknown };
export type Monitor = Item & {
  pool: string;
  addr: string;
  acct?: string;
  label: string;
  alert: boolean;
  after: number;
  paused?: boolean;
};
export type Wallet = Item & { addr: string; label: string };
export type Rule = Item & {
  kind: "above" | "below" | "move";
  value: number;
  window: number;
  enabled: boolean;
  seen_fired: number;
};
export type PushWindow = { start: number; end: number; tz: string } | null;
export type State = {
  purchaseId: string;
  [key: string]: unknown;
  version: 1;
  lang: Lang;
  followBrowserLanguage?: boolean;
  monitors: Monitor[];
  wallets: Wallet[];
  rules: Rule[];
  window: PushWindow;
  settingsUpdated: number;
  calculator: CalculatorInput;
  accountId: string;
  token: string;
  sync: boolean;
  monitorOrder?: { ids: string[]; updated: number };
  secondary?: string;
  theme?: "system" | "light" | "dark";
  autoRefresh?: boolean;
  contacts?: (Item & { name: string; address: string; note: string })[];
  devices?: Device[];
  fleetSettings?: FleetSettings;
};
export type Config = Pick<
  State,
  | "lang"
  | "monitors"
  | "wallets"
  | "rules"
  | "window"
  | "settingsUpdated"
  | "calculator"
  | "contacts"
  | "autoRefresh"
> & { monitorOrder?: State["monitorOrder"]; secondary?: string; theme?: State["theme"]; devices?: Device[]; fleetSettings?: FleetSettings; [key: string]: unknown };
export type Device = Item & { name: string; gpu: string; count: number; rented: boolean; hoursPerDay: number; customPearl?: number | null; rentDaily?: number | null; rentCurrency?: string; rentFX?: number; sourceKey?: string };
export type RentSetting = { daily: number; currency: string; fx?: number; [key: string]: unknown };
export type FleetSettings = { powerBudgetW: number; powerBudgetEnabled: boolean; syncWPerTH: number; selfDilution: boolean; fxManual: boolean; manualFX: number; rentEnabled: boolean; growthMode: "auto" | "manual"; sortKey?: "ownNet" | "rentNet" | "breakEvenRent" | "hash" | "efficiency"; selectedGPU?: string; rents: Record<string, RentSetting>; [key: string]: unknown };
export type CalculatorInput = {
  gpu: string;
  count: number;
  th: number;
  watts: number;
  hardware: number;
  hours: number;
  fee: number;
  electricity: number;
  rent: number;
  rented: boolean;
  rentCoversPower: boolean;
  growth: number;
  price: number | null;
  yield: number | null;
  networkHash?: number | null;
};
export type Network = {
  source: string;
  ts: number;
  difficulty: number | null;
  hashrate: number | null;
  blockTime: number | null;
  reward: number | null;
  prlPerTHDay: number | null;
  difficulty24h: number | null;
  difficulty3d: number | null;
  difficulty7d: number | null;
};
export type PoolOverview = {
  id: string;
  name: string;
  url: string;
  hashrate: number | null;
  share: number | null;
  miners: number | null;
  fee: number | null;
  scheme: string | null;
  solo: boolean;
  pps: boolean;
  blocksPerDay: number | null;
  blocksSample: number | null;
  sampleDays: number | null;
  earningsPerPH: number | null;
  trustworthy: boolean;
  source: string;
  hashFromPoolAPI: boolean;
  feeFromPoolAPI: boolean;
  devFee: number | null;
  theoreticalEarningsPerPH?: number | null;
  yieldRatio?: number | null;
  history?: { ts: number; hashrate: number | null }[];
  averageHashrate7d?: number | null;
  lastBlockTime?: number | null;
  lifetimeBlocks?: number | null;
  payouts?: PoolPayout[];
  realFeeMeasurement?: {
    pool: string; scheme: string; netPRL: number; expectedPRL: number;
    start: number; end: number; measuredAt: number; estimated: boolean;
    sampleCount: number; theoryBasis: string;
  } | null;
};
export type PoolPayout = {
  scheme: string | null;
  fee: number | null;
  grossPerPH: number | null;
  realFeePercent: number | null;
  realFeeEstimated?: boolean | null;
  estimated: boolean;
  solo: boolean;
};
export type Overview = {
  ok: boolean;
  ts: number;
  source: string;
  network: Network | null;
  rows: PoolOverview[];
  partial: boolean;
  stale: boolean;
};
export type Price = {
  usd: number;
  ts: number;
  source: string;
  change5m: number | null;
  change1h: number | null;
  change24h: number | null;
  stale: boolean;
};
export type Stats = {
  ok: boolean;
  missing?: boolean;
  windows: WindowName[];
  rates: Partial<Record<WindowName, number>>;
  pending: number;
  paid: number;
  pendingKind: "pending" | "withdrawableAndUnconfirmed" | "todayEstimate";
  workers: {
    name: string;
    online: boolean;
    last: number | null;
    rates: Partial<Record<WindowName, number>>;
  }[];
  partial: boolean;
};
export type Address = {
  balance: string;
  unconfirmed: string;
  txs: number;
  page?: number;
  hasMore?: boolean;
  history: {
    txid: string;
    time: number;
    confirmations: number;
    delta: string;
    amount?: string;
    fee?: string;
    sent?: boolean;
    address?: string;
  }[];
};
export type Income = { ok: boolean; ts: number; h24: number; d7: number; total: number };
export type Order = {
  id: string;
  address: string;
  amount: string;
  sats: number;
  usd: number;
  rate: number;
  created_at: number;
  expires_at: number;
  status: "pending" | "seen" | "paid";
  txid: string | null;
};
export type Availability = {
  pay: { enabled: boolean; usd: number };
  vapid_key: string | null;
  auth?: { enabled: boolean; site_key: string | null };
};
export type Me = Availability & {
  pro_scope?: "device" | "account";
  purchase?: {id:string;pro:boolean;linked:boolean}|null;
  pro: boolean;
  pro_at: number | null;
  pro_src: string | null;
  order: Order | null;
};
