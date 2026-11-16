// The Real Cost detail page's text (zh / en): a technical explanation in standard terms, written to be read once.
// The figures on the page are the live ones from /v1/pools; these texts give each pool's method, the dated checks we
// made, how to verify the figure and its known limitations.
export type CostLanguage = "zh" | "en";
/** How a pool's figure is calculated (alerts/src/realfees.js, pplns.js, shareyield.js). */
export type CostMethod = "pps" | "effort" | "display" | "rolling";
export type CostStory = {
  method: CostMethod;
  summary: string;
  steps: string[];
  checked: string[];
  verify: string[];
  unsure: string[];
  sources: [string, string][];
};
/** The audit record's table: Real Cost by dated period, one set of figures for both languages. */
export type AuditColumn = "fee" | "factor" | "workRatio" | "published" | "interval" | "found" | "canonical" | "orphans" | "orphanCount" | "byDisplay" | "byShares";
export type AuditRow = {
  /** UTC days, both included (YYYY-MM-DD). */
  from: string; to: string;
  /** Real Cost in percent, a range of results, or null when the period has none. */
  cost: number | [number, number] | null;
  /** The days the cost was measured on, when fewer than the row's. */
  measured?: [string, string];
  /** A row combining the others. */
  total?: boolean;
  values: Partial<Record<AuditColumn, number | [number, number]>>;
};
export type AuditTable = { columns: AuditColumn[]; rows: AuditRow[] };
type AuditLabels = Record<"period" | "cost" | "total" | AuditColumn, string>;

export const costCopy = {
  zh: {
    title: "{pool} 真实费用计算说明", definition: "真实费用：相同算力下，实际收益相对理论收益的折损比例，已剔除出块运气。",
    language: "语言", choosePool: "选择矿池", scheme: "结算方式", tier: "费率档位", founding: "创始矿工地址", standard: "普通地址",
    realCost: "真实费用", period: "统计区间", updated: "数据更新于", noData: "该结算方式暂无真实费用数据。",
    vsFee: "高于公示费率 {gap} 个百分点", belowFee: "低于公示费率 {gap} 个百分点", atFee: "与公示费率一致",
    how: "计算方法", checked: "核查记录", verify: "复核方法", unsure: "局限与未确认项", sources: "数据来源",
    fee: "矿池费率", orphans: "孤块率", other: "其他损耗", total: "合计", orphanBlocks: "{orphans} / {blocks} 块",
    credited: "实际入账", theory: "理论收益", shortfall: "折损", sampleDays: "样本天数",
    shareRatio: "share 出块率", unusedShares: "未出块 share 损耗", formula: "计算式：",
    found: "主链区块", expected: "share 对应理论区块", blocksUnit: "{n} 块", foundOrphans: "{n} 块（另有 {o} 个孤块）",
    foundYield: "出块率（含孤块）",
    range: "95% 置信区间", rangeNote: "按泊松分布估计区块数的随机波动。区间只反映出块运气，不含数据本身的误差。",
    poolData: "矿池数据", poolHashrate: "矿池算力", average7d: "7 天平均算力", blocks24h: "24 小时出块", luck7d: "7 天出块运气",
    orphanRate: "孤块率（7 天）", earnings: "预估收益", perPHDay: "PRL/PH·天", luckValue: "{blocks} / {expected} 块（{ratio}）",
    orphanSource: { chain: "链上统计", pool: "矿池数据" },
    audit: { period: "时期（UTC）", cost: "真实费用", total: "合计", fee: "矿池费率", factor: "换算系数", workRatio: "share ÷ 显示算力",
      published: "首页价格低于理论", interval: "95% 置信区间", found: "实际出块", canonical: "主链出块", orphans: "孤块", orphanCount: "孤块",
      byDisplay: "按显示算力应出", byShares: "按 share 应出" } as AuditLabels,
    glossary: "术语",
    terms: [
      ["理论收益", "按全网难度与区块奖励，相同算力在没有任何损耗时应得的收益。"],
      ["effort", "找到一个区块实际消耗的工作量与网络难度之比，期望值为 100%。"],
      ["出块运气", "一段时间内实际出块数与理论出块数之比，短期内随机波动，长期趋近 100%。"],
      ["孤块率", "矿池找到但未被主链收录的区块占比：孤块数 ÷（主链区块 + 孤块）。孤块没有区块奖励。"],
      ["PPS / PPS+", "按提交的有效 share 固定结算，出块运气由矿池承担；PPS+ 另按比例分配交易手续费。"],
      ["PPLNS / PROP", "按矿池实际出块分配区块奖励，出块运气由矿工承担；两者的区别在于统计 share 的窗口。"],
    ] as [string, string][],
  },
  en: {
    title: "{pool}: How Real Cost Is Calculated", definition: "Real Cost: the shortfall of actual income against theoretical income for the same hashrate, with block luck removed.",
    language: "Language", choosePool: "Choose pool", scheme: "Payout scheme", tier: "Fee tier", founding: "Founding members", standard: "Other addresses",
    realCost: "Real Cost", period: "Period", updated: "Data as of", noData: "No Real Cost is available for this payout scheme yet.",
    vsFee: "{gap} percentage points above the stated fee", belowFee: "{gap} percentage points below the stated fee", atFee: "Equal to the stated fee",
    how: "Method", checked: "Audit record", verify: "How to verify", unsure: "Limitations", sources: "Sources",
    fee: "Pool fee", orphans: "Orphan rate", other: "Other losses", total: "Total", orphanBlocks: "{orphans} of {blocks} blocks",
    credited: "Credited", theory: "Theoretical income", shortfall: "Shortfall", sampleDays: "Sample days",
    shareRatio: "Share-to-block yield", unusedShares: "Shares not converted to blocks", formula: "Formula: ",
    found: "Canonical blocks", expected: "Blocks expected from shares", blocksUnit: "{n} blocks", foundOrphans: "{n} blocks (plus {o} orphans)",
    foundYield: "Block yield (incl. orphans)",
    range: "95% confidence interval", rangeNote: "Poisson estimate of random variation in the block count. It reflects block luck only, not errors in the data.",
    poolData: "Pool data", poolHashrate: "Pool hashrate", average7d: "7-day average hashrate", blocks24h: "Blocks in 24 hours", luck7d: "7-day block luck",
    orphanRate: "Orphan rate (7 days)", earnings: "Estimated income", perPHDay: "PRL/PH·day", luckValue: "{blocks} of {expected} blocks ({ratio})",
    orphanSource: { chain: "from chain data", pool: "from pool data" },
    audit: { period: "Period (UTC)", cost: "Real Cost", total: "Combined", fee: "Pool fee", factor: "Conversion factor", workRatio: "Shares ÷ displayed",
      published: "Published price below theory", interval: "95% confidence interval", found: "Blocks found", canonical: "Canonical blocks", orphans: "Orphans",
      orphanCount: "Orphans", byDisplay: "Expected from displayed hashrate", byShares: "Expected from shares" } as AuditLabels,
    glossary: "Glossary",
    terms: [
      ["Theoretical income", "What a given hashrate earns at the current network difficulty and block reward, with no losses of any kind."],
      ["Effort", "The work actually spent to find a block relative to the network difficulty; its expected value is 100%."],
      ["Block luck", "Blocks found over a period relative to blocks expected. It varies randomly in the short run and tends to 100% over time."],
      ["Orphan rate", "The share of a pool's blocks that the main chain did not include: orphans ÷ (canonical blocks + orphans). Orphans earn no block reward."],
      ["PPS / PPS+", "Fixed payment per valid share; the pool carries the block luck. PPS+ also distributes transaction fees pro rata."],
      ["PPLNS / PROP", "Rewards of the blocks the pool actually finds are distributed; participants carry the block luck. The two differ in the window over which shares are counted."],
    ] as [string, string][],
  },
};

const PPS_STEPS = {
  zh: ["每日采集一组地址的算力与当日入账。",
    "按同期全网难度与区块奖励，计算该算力的理论收益。",
    "汇总最近 5 个完整 UTC 日：真实费用 = 1 − 实际入账 ÷ 理论收益。"],
  en: ["We sample a set of addresses daily: hashrate and coins credited per day.",
    "From the network difficulty and block reward over the same period, we compute the theoretical income for that hashrate.",
    "Over the last 5 complete UTC days: Real Cost = 1 − credited ÷ theoretical income."],
};
const PPS_VERIFY = {
  zh: ["在矿池后台查询自己地址若干天的平均算力与入账。", "在 Pearl Hub 收益计算器中按相同算力计算理论收益。", "1 − 入账 ÷ 理论收益，即该地址的真实费用。"],
  en: ["In the pool dashboard, look up your address's average hashrate and credits over several days.", "Compute the theoretical income for the same hashrate in Pearl Hub's calculator.", "1 − credits ÷ theoretical income is that address's Real Cost."],
};
const PPS_SUMMARY = {
  zh: "PPS 按提交的有效 share 结算，收益与矿池是否出块无关，因此该结果本身不含出块运气。",
  en: "PPS pays per valid share regardless of whether the pool finds blocks, so this figure carries no block luck by construction.",
};
const EFFORT_STEPS = {
  zh: ["每 5 分钟采集矿池算力与链上出块，计算该算力在同期的理论收益。",
    "读取矿池公布的每个区块的 effort（找到该区块所用的工作量 ÷ 网络难度）。平均 effort 为 100% 表示运气中性，110% 表示运气偏差 10%。",
    "以同期平均 effort 修正实际收益，得到剔除运气后的收益。",
    "真实费用 = 1 − 剔除运气后的收益 ÷ 理论收益。要求最近 7 天内至少 5 天有数据，且理论区块数不少于 100。"],
  en: ["Every 5 minutes we record the pool's hashrate and its blocks on chain, and compute the theoretical income for that hashrate.",
    "We read the effort the pool publishes for each block (the work it took ÷ network difficulty). An average effort of 100% is neutral luck; 110% means 10% adverse luck.",
    "Correcting the actual income by the period's average effort gives the income with luck removed.",
    "Real Cost = 1 − income with luck removed ÷ theoretical income. It requires data on at least 5 of the last 7 days and at least 100 expected blocks."],
};

const zh: Record<string, CostStory> = {
  "pearl-fortune:PPS": { method: "pps", summary: PPS_SUMMARY.zh, steps: PPS_STEPS.zh,
    checked: ["PPS 费率于 10-21 至 10-23 间由 5% 降为 4%，10-26 至 11-02 临时降为 3%。",
      "11-04 至 11-08 共 1,440 条成熟入账与每小时收入逐条对平；抽查 10 条计价收据、55 组报价，均按 4%（400 基点）计费，取整方式与矿池说明一致。"],
    verify: PPS_VERIFY.zh,
    unsure: ["入账按到账时间归日，首尾两日存在少量错位，因此按 5 日汇总。"],
    sources: [["Pearl Fortune", "https://pearlfortune.org/"]] },
  "pearl-fortune:PPLNS": { method: "effort",
    summary: "PPLNS 按矿池实际出块分配收益，出块运气会直接反映在收益中。Pearl Fortune 公布每个区块的 effort，据此剔除运气后，剩余部分为矿池费率、孤块率与其他损耗。",
    steps: EFFORT_STEPS.zh,
    checked: ["11-01 至 11-09 每日抽取首尾两个分账窗口，共 18 个窗口、3,163 笔矿工分账逐笔核对至最小单位：扣除比例均为 2%。",
      "09-25 至 11-09 共 1,610 个区块逐一对照链上：Pearl Fortune 标为孤块的均不在主链，其余均在主链。",
      "Pearl Fortune 公布的 effort 与我们按链上数据计算的出块运气一致。"],
    verify: ["通过 https://pearlfortune.org/api/v1/blocks?page=1 分页获取每个区块的 effort 与孤块状态。", "计算 7 日平均 effort，即同期出块运气。", "按矿池算力计算理论收益，与「实际收益 × 平均 effort」比较。"],
    unsure: ["每周孤块仅数个，孤块率本身存在统计波动。"],
    sources: [["Pearl Fortune 区块列表", "https://pearlfortune.org/api/v1/blocks?page=1"], ["Pearl Fortune", "https://pearlfortune.org/"]] },
  "lucky:PROP": { method: "effort",
    summary: "Lucky Pool 采用 PROP，按矿池实际出块分配收益，计算方法同 PPLNS。其真实费用显著高于 1% 的矿池费率，差额来自「其他损耗」。",
    steps: EFFORT_STEPS.zh,
    checked: ["最近 120 笔奖励均按 99% 分配，扣除比例与 1% 费率一致。",
      "10-20 抽查 4 个大账户：Lucky 记账的 share 为其显示算力的 91%～92%。"],
    verify: ["https://pearl.luckypool.io/api/stats 的 pool.blocks 含最近 100 个区块的 share 与难度；https://pearl.luckypool.io/api/block-stats 提供每日汇总。", "累加 share ÷ 难度，得到这些区块消耗的工作量。", "与同期按显示算力计算的工作量比较：比值 10 月约为 0.85，11 月以来约为 0.91。"],
    unsure: ["计算以 Lucky 显示算力为基准。10-20 抽查时，挖矿软件自报算力高于 Lucky 显示值，实际损耗可能高于该结果。",
      "11-02 起 Lucky 每块记录的 share 增加约 6%，但实际出块与显示算力之比未变（两期均约 0.85）。若出块不随之回升，11 月以来的结果偏低。"],
    sources: [["Lucky Pool 统计接口", "https://pearl.luckypool.io/api/stats"], ["Lucky Pool 每日汇总", "https://pearl.luckypool.io/api/block-stats"]] },
  "kryptex:PPS+": { method: "pps",
    summary: "PPS+ 在按 share 结算区块奖励之外，另按比例分配交易手续费，结果同样不含出块运气。",
    steps: PPS_STEPS.zh,
    checked: ["公示费率于 10-13 前后由 2% 调为 3%。",
      "10-27 与 11-04 起的两期各用全部 720 个十分钟数据点独立重算，与当时总览中的数值一致。",
      "10-29 至 11-10 另取 25 个以上公开地址按 5 日重算：剔除过期 share 后均在 5.8%～6.2%。"],
    verify: PPS_VERIFY.zh,
    unsure: ["Kryptex 未公开逐笔计价明细，无法区分费率与其他扣减各自的占比。"],
    sources: [["Kryptex", "https://prl.kryptex.network/"]] },
  "f2pool:PPS": { method: "pps", summary: PPS_SUMMARY.zh + "F2Pool 另行发放的 NOCK 不计入。",
    steps: PPS_STEPS.zh,
    checked: ["09-30 至 10-04 的实测：5 天均有算力，逐日 5.49%～5.92%，两次独立计算结果一致。",
      "10-15 至 11-01 的实测为当时总览中 4 个 5 日窗口的结果范围。",
      "首页价格：F2Pool 首页公布的每 TH/s 日收益，按其标注的难度与理论收益比较。实测比同期首页价格高 0.5～0.7 个百分点。",
      "数据取自 F2Pool 只读页面的每日汇总，已核对其算力单位。"],
    verify: [...PPS_VERIFY.zh, "也可在 F2Pool 首页查看 PRL 每 TH/s 的日收益与难度，与按同一难度计算的 1 TH/s 理论收益比较。"],
    unsure: ["F2Pool 仅提供每日汇总，算力过低的日期会被剔除。", "实测比首页价格高出的 0.5～0.7 个百分点，来源尚未确认。"],
    sources: [["F2Pool PRL 页面", "https://www.f2pool.com/coin/pearl"], ["F2Pool", "https://www.f2pool.com/"]] },
  "peryn:PPS+": { method: "pps",
    summary: "Peryn 的 PPS+ 分两档费率：创始矿工地址 0.5%，其他地址 1%，两档分别计算。",
    steps: ["从 Peryn 公开付款记录中提取收款地址，读取各地址的公开页面。", "页面列出每日算力、实际入账及该地址的费率档位。", "按档位汇总最近 5 个完整 UTC 日：真实费用 = 1 − 实际入账 ÷ 理论收益。"],
    checked: ["仅采用 Peryn 自身预测与按同一算力计算的理论收益相差 3% 以内、且前一日已有入账的日期。"],
    verify: ["访问 https://app.peryn.ai/address/你的地址 查看每日算力与入账。", "按相同算力计算理论收益，1 − 入账 ÷ 理论收益即为真实费用。"],
    unsure: ["页面算力仅保留 3 位有效数字，单地址单日误差约为零点几个百分点。"],
    sources: [["Peryn 付款记录", "https://app.peryn.ai/api/v1/payments"], ["Peryn", "https://peryn.ai/"]] },
  "pearlhash:PROP": { method: "display",
    summary: "PearlHash 不公布每个区块的 effort，但其出块数与网站显示算力保持一致，而显示算力略低于其接收的有效 share。两者之差即未产出区块的 share，对应的收益损耗计入真实费用。",
    steps: ["每 5 分钟读取 https://pearlhash.xyz/api/stats 的有效 share 速率（hashrate_diff_5m）与显示算力（hashrate），并记录链上出块数。",
      "显示算力 ÷（share 速率 × 2^48）即 PearlHash 采用的换算系数：11-02 及之前为 0.915，11-03 起为 0.982。",
      "20 天的出块数据显示：实际出块与按显示算力计算的理论值基本一致，与按 share 计算的理论值明显偏离，说明只有显示算力对应的部分产出区块。",
      "真实费用 = 1 −（1 − 矿池费率 1%）× 换算系数，取最近 7 天；孤块损耗已包含在内。"],
    checked: ["每小时分账将该小时区块奖励的 99.9% 按 share 比例分配，入账与链上付款一致。"],
    verify: ["读取 https://pearlhash.xyz/api/stats，计算 hashrate ÷（hashrate_diff_5m × 2^48），得到当前换算系数。", "连续记录数日，比较 PearlHash 链上实际出块与按显示算力计算的理论出块。", "代入 1 − 0.99 × 换算系数。"],
    unsure: ["PearlHash 网站公示费率为 1%，但分账中仅可见 0.1% 的扣除。此处按公示的 1% 计算；若按 0.1%，结果约低 0.9 个百分点。",
      "11-09 对 6 个 WildRig 账户观察 6 小时：WildRig 自报算力较 PearlHash 接收的有效算力高约 1.3%。该差异属于挖矿软件侧，其他矿池同样存在，未计入。",
      "若 PearlHash 再次调整换算系数，结果随之变化；若出块不再与显示算力一致，将停止显示该结果。"],
    sources: [["PearlHash 统计接口", "https://pearlhash.xyz/api/stats"], ["PearlHash", "https://pearlhash.xyz/"]] },
  "herominers:PROP": { method: "rolling",
    summary: "HeroMiners 的 effort 基于其记账的 share 计算，若以此剔除运气，会把少出的区块一并当作运气抵消。因此改用最近 30 天的实际出块直接计算，并给出 95% 置信区间以反映残余的出块运气。",
    steps: ["读取 HeroMiners 公开区块列表：每个区块的 share、难度与孤块状态，剔除 SOLO 区块。",
      "累加最近 30 天（至少 5 天）各区块的 share ÷ 难度，得到这些 share 对应的理论区块数。",
      "真实费用 = 1 −（1 − 矿池费率）× 主链区块数 ÷ 理论区块数。HeroMiners 费率为 0。",
      "按泊松分布估计区块数的随机波动，给出 95% 置信区间。"],
    checked: ["11-01 以自有显卡在 HeroMiners 运行 6 小时：其记账 share 与显卡实际算力相差约 1%，记账无明显缺失。",
      "两期区间大部分重叠，差异在出块运气范围内，不代表趋势。"],
    verify: ["通过 https://pearl.herominers.com/api/get_blocks?height=区块高度 向前分页（每页 10 块）。", "剔除 score 以 s 开头的 SOLO 区块，累加 shares ÷ difficulty，与主链区块数比较。"],
    unsure: ["95% 置信区间约为 −3% 至 12%，包含 0，尚不能确认存在持续损耗；样本期越长，区间越窄。",
      "10-13 之前的区块明细 HeroMiners 已不再提供，更早的样本无法复核。"],
    sources: [["HeroMiners 统计接口", "https://pearl.herominers.com/api/stats"], ["HeroMiners 分账规则", "https://herominers.com/help/why-not-paid-for-every-block/"]] },
};

const en: Record<string, CostStory> = {
  "pearl-fortune:PPS": { method: "pps", summary: PPS_SUMMARY.en, steps: PPS_STEPS.en,
    checked: ["The PPS fee went from 5% to 4% between Oct 21 and Oct 23, and was cut to 3% temporarily from Oct 26 to Nov 2.",
      "Nov 4 – Nov 8: all 1,440 matured credits reconcile with the hourly income; a sample of 10 pricing receipts and 55 quotes all charge 4% (400 basis points), rounded as the pool documents."],
    verify: PPS_VERIFY.en,
    unsure: ["Credits are assigned to days by arrival time, so the first and last days are slightly misaligned; hence the 5-day aggregate."],
    sources: [["Pearl Fortune", "https://pearlfortune.org/"]] },
  "pearl-fortune:PPLNS": { method: "effort",
    summary: "PPLNS distributes the rewards of the blocks the pool actually finds, so block luck passes straight into income. Pearl Fortune publishes each block's effort; with luck removed on that basis, what remains is the pool fee, the orphan rate and other losses.",
    steps: EFFORT_STEPS.en,
    checked: ["From Nov 1 to Nov 9, the first and last payout window of each day were sampled: all 3,163 individual payouts in those 18 windows, checked to the smallest unit, are deducted exactly 2%.",
      "All 1,610 blocks from Sep 25 to Nov 9 were checked against the chain: those Pearl Fortune marks as orphaned are off the main chain and all others are on it.",
      "Pearl Fortune's published effort matches the luck we compute from chain data."],
    verify: ["Page through https://pearlfortune.org/api/v1/blocks?page=1 for each block's effort and orphan status.", "The 7-day average effort is that period's block luck.", "Compute the theoretical income for the pool's hashrate and compare it with actual income × average effort."],
    unsure: ["A week contains only a few orphans, so the orphan rate itself is subject to statistical variation."],
    sources: [["Pearl Fortune blocks", "https://pearlfortune.org/api/v1/blocks?page=1"], ["Pearl Fortune", "https://pearlfortune.org/"]] },
  "lucky:PROP": { method: "effort",
    summary: "Lucky Pool uses PROP, distributing the rewards of the blocks it actually finds; the method is the same as for PPLNS. Its Real Cost is well above its 1% pool fee, and the difference is in \"Other losses\".",
    steps: EFFORT_STEPS.en,
    checked: ["Its last 120 rewards were all distributed at 99%, consistent with the 1% fee.",
      "A spot check of 4 large accounts on Oct 20 found the shares Lucky credited were 91–92% of its displayed hashrate."],
    verify: ["https://pearl.luckypool.io/api/stats lists shares and difficulty for its last 100 blocks under pool.blocks; https://pearl.luckypool.io/api/block-stats gives daily totals.", "Sum shares ÷ difficulty for the work those blocks consumed.", "Compare with the work implied by the displayed hashrate over the same period: the ratio was about 0.85 in October and about 0.91 since."],
    unsure: ["The baseline is Lucky's displayed hashrate. In the Oct 20 spot check, client-reported hashrate exceeded Lucky's displayed figure, so the actual loss may be higher than this result.",
      "From Nov 2 Lucky records about 6% more shares per block, yet blocks found per displayed hashrate are unchanged (about 0.85 in both periods). If blocks do not rise accordingly, the result since November is understated."],
    sources: [["Lucky Pool stats API", "https://pearl.luckypool.io/api/stats"], ["Lucky Pool daily totals", "https://pearl.luckypool.io/api/block-stats"]] },
  "kryptex:PPS+": { method: "pps",
    summary: "PPS+ pays the block reward per share and additionally distributes transaction fees pro rata; the result likewise carries no block luck.",
    steps: PPS_STEPS.en,
    checked: ["The stated fee went from 2% to 3% around Oct 13.",
      "The Oct 27 and Nov 4 periods were each recomputed independently from all 720 ten-minute data points and match the overview at the time.",
      "From Oct 29 to Nov 10, 5-day recomputations for 25+ other public addresses gave 5.8%–6.2% with stale shares excluded."],
    verify: PPS_VERIFY.en,
    unsure: ["Kryptex does not publish per-payment pricing, so the fee and any other deductions cannot be separated."],
    sources: [["Kryptex", "https://prl.kryptex.network/"]] },
  "f2pool:PPS": { method: "pps", summary: PPS_SUMMARY.en + " The NOCK F2Pool pays separately is excluded.",
    steps: PPS_STEPS.en,
    checked: ["Sep 30 – Oct 4 measurement: hashrate on all 5 days, 5.49%–5.92% per day; two independent calculations agree.",
      "The Oct 15 – Nov 1 measurement is the range of four 5-day windows shown in the overview at the time.",
      "Published price: the daily revenue per TH/s on F2Pool's home page, compared with theoretical income at the difficulty it states. The measured figures are 0.5–0.7 percentage points above it for the same dates.",
      "Data are the daily totals on F2Pool's read-only page; its hashrate units were verified."],
    verify: [...PPS_VERIFY.en, "Alternatively, compare the daily revenue per TH/s and the difficulty on F2Pool's home page with the theoretical income for 1 TH/s at that difficulty."],
    unsure: ["F2Pool provides daily totals only; days with very low hashrate are excluded.", "The 0.5–0.7 percentage points by which the measured figures exceed the published price are not yet explained."],
    sources: [["F2Pool PRL page", "https://www.f2pool.com/coin/pearl"], ["F2Pool", "https://www.f2pool.com/"]] },
  "peryn:PPS+": { method: "pps",
    summary: "Peryn's PPS+ has two fee tiers, 0.5% for founding members' addresses and 1% for other addresses; each tier is calculated separately.",
    steps: ["We extract payee addresses from Peryn's public payment records and read each address's public page.", "The page lists daily hashrate, credited coins and the address's fee tier.", "Per tier, over the last 5 complete UTC days: Real Cost = 1 − credited ÷ theoretical income."],
    checked: ["Only days on which Peryn's own prediction is within 3% of the theoretical income for the same hashrate, and the address was credited the day before, are used."],
    verify: ["Open https://app.peryn.ai/address/<your address> for daily hashrate and credits.", "Compute the theoretical income for the same hashrate; 1 − credits ÷ theoretical income is the Real Cost."],
    unsure: ["The page reports hashrate to 3 significant figures, so a single address on a single day can be off by a few tenths of a percent."],
    sources: [["Peryn payments", "https://app.peryn.ai/api/v1/payments"], ["Peryn", "https://peryn.ai/"]] },
  "pearlhash:PROP": { method: "display",
    summary: "PearlHash publishes no per-block effort, but its block count tracks the hashrate shown on its site, which is slightly below the valid shares it receives. The difference is shares that produce no blocks; the corresponding loss of income is included in Real Cost.",
    steps: ["Every 5 minutes we read the valid-share rate (hashrate_diff_5m) and displayed hashrate (hashrate) from https://pearlhash.xyz/api/stats, and record its blocks on chain.",
      "Displayed hashrate ÷ (share rate × 2^48) is the conversion factor PearlHash applies: 0.915 through Nov 2, 0.982 from Nov 3.",
      "Over 20 days, actual blocks match the theoretical count from the displayed hashrate and deviate clearly from the count implied by shares, showing that only the displayed portion produces blocks.",
      "Real Cost = 1 − (1 − 1% pool fee) × conversion factor, over the last 7 days. Orphan losses are already included."],
    checked: ["Each hourly payout distributes 99.9% of that hour's block rewards by share, and credits match the payments on chain."],
    verify: ["Read https://pearlhash.xyz/api/stats and compute hashrate ÷ (hashrate_diff_5m × 2^48) for the current conversion factor.", "Record it over several days and compare PearlHash's blocks on chain with the count implied by its displayed hashrate.", "Apply 1 − 0.99 × conversion factor."],
    unsure: ["PearlHash states a 1% pool fee, but only a 0.1% deduction is visible in payouts. The stated 1% is used here; at 0.1% the result would be about 0.9 percentage points lower.",
      "On Nov 9, 6 WildRig accounts were observed for 6 hours: WildRig's self-reported hashrate was about 1.3% above the valid hashrate PearlHash received. That difference lies on the client-software side, applies at other pools as well, and is not included.",
      "If PearlHash changes its conversion factor again, the result follows; if its blocks stop tracking the displayed hashrate, the result will no longer be shown."],
    sources: [["PearlHash stats API", "https://pearlhash.xyz/api/stats"], ["PearlHash", "https://pearlhash.xyz/"]] },
  "herominers:PROP": { method: "rolling",
    summary: "HeroMiners computes effort from the shares it credits, so removing luck with that effort would also cancel out the blocks it fails to find. The last 30 days of actual blocks are therefore used directly, with a 95% confidence interval for the residual block luck.",
    steps: ["We read HeroMiners' public block list: each block's shares, difficulty and orphan status, excluding SOLO blocks.",
      "Shares ÷ difficulty, summed over the last 30 days (at least 5), gives the number of blocks those shares should have found.",
      "Real Cost = 1 − (1 − pool fee) × canonical blocks ÷ expected blocks. HeroMiners' fee is 0.",
      "The random variation in the block count is estimated with a Poisson model, giving a 95% confidence interval."],
    checked: ["On Nov 1 our own GPU ran at HeroMiners for 6 hours: the credited shares were within about 1% of the card's actual hashrate, so crediting shows no material shortfall.",
      "The two intervals largely overlap: the difference is within block luck, not a trend."],
    verify: ["Page back through https://pearl.herominers.com/api/get_blocks?height=<block height> (10 blocks per page).", "Exclude SOLO blocks (score beginning with s), sum shares ÷ difficulty and compare with the canonical block count."],
    unsure: ["The 95% confidence interval is about −3% to 12% and includes 0, so a persistent loss is not yet established; the interval narrows as the sample grows.",
      "HeroMiners no longer publishes block details before Oct 13, so earlier samples cannot be re-checked."],
    sources: [["HeroMiners stats API", "https://pearl.herominers.com/api/stats"], ["HeroMiners payout rules", "https://herominers.com/help/why-not-paid-for-every-block/"]] },
};

const stories: Record<CostLanguage, Record<string, CostStory>> = { zh, en };

// Figures recomputed on 2026-11-10 from the pools' and our own records (see each pool's notes below the table).
const auditTables: Record<string, AuditTable> = {
  "pearl-fortune:PPS": { columns: ["fee"], rows: [
    { from: "2026-10-01", to: "2026-10-05", cost: 5.01, values: { fee: 5 } },
    { from: "2026-10-27", to: "2026-11-01", cost: 3.01, values: { fee: 3 } },
    { from: "2026-11-03", to: "2026-11-08", cost: 4.01, values: { fee: 4 } }] },
  "pearl-fortune:PPLNS": { columns: ["fee", "orphans"], rows: [
    { from: "2026-10-26", to: "2026-11-01", cost: 2.98, values: { fee: 2, orphans: [3, 301] } },
    { from: "2026-11-02", to: "2026-11-08", cost: 2.29, values: { fee: 2, orphans: [1, 340] } }] },
  "lucky:PROP": { columns: ["workRatio", "found", "byDisplay", "byShares"], rows: [
    { from: "2026-10-13", to: "2026-10-30", cost: 15.51, values: { workRatio: 0.853, found: 555, byDisplay: 651, byShares: 555 } },
    { from: "2026-11-02", to: "2026-11-09", cost: 10.06, values: { workRatio: 0.909, found: 260, byDisplay: 306, byShares: 278 } }] },
  "kryptex:PPS+": { columns: ["fee"], rows: [
    { from: "2026-10-07", to: "2026-10-11", cost: 5.51, values: { fee: 2 } },
    { from: "2026-10-27", to: "2026-10-31", cost: 6.12, values: { fee: 3 } },
    { from: "2026-11-04", to: "2026-11-08", cost: 6.07, values: { fee: 3 } }] },
  "f2pool:PPS": { columns: ["published", "fee"], rows: [
    { from: "2026-09-30", to: "2026-10-08", cost: 5.72, measured: ["2026-09-30", "2026-10-04"], values: { published: 4.99, fee: 1 } },
    { from: "2026-10-09", to: "2026-11-02", cost: [3.45, 3.51], measured: ["2026-10-15", "2026-11-01"], values: { published: 2.94, fee: 1 } },
    { from: "2026-11-03", to: "2026-11-10", cost: null, values: { published: 3.99, fee: 1 } }] },
  "pearlhash:PROP": { columns: ["factor", "found", "byDisplay", "byShares"], rows: [
    { from: "2026-10-20", to: "2026-11-02", cost: 9.41, values: { factor: 0.915, found: 1358, byDisplay: 1363, byShares: 1489 } },
    { from: "2026-11-04", to: "2026-11-09", cost: 2.77, values: { factor: 0.982, found: 427, byDisplay: 421, byShares: 430 } }] },
  "herominers:PROP": { columns: ["interval", "canonical", "orphanCount", "byShares"], rows: [
    { from: "2026-10-13", to: "2026-10-26", cost: 5.37, values: { interval: [-5.1, 15.1], canonical: 347, orphanCount: 4, byShares: 366.7 } },
    { from: "2026-10-27", to: "2026-11-09", cost: 3.10, values: { interval: [-8.0, 13.3], canonical: 328, orphanCount: 0, byShares: 338.5 } },
    { from: "2026-10-13", to: "2026-11-09", cost: 4.28, total: true, values: { interval: [-3.2, 11.4], canonical: 675, orphanCount: 4, byShares: 705.2 } }] },
};
export function auditTable(slug: string, scheme: string): AuditTable | null {
  return auditTables[`${slug}:${scheme.toUpperCase()}`] || null;
}
export function costStory(slug: string, scheme: string, language: CostLanguage): CostStory | null {
  return stories[language][`${slug}:${scheme.toUpperCase()}`] || null;
}
/** The schemes a pool's page explains, in the order its switch shows them. */
export function costSchemes(slug: string): string[] {
  return Object.keys(zh).filter((k) => k.startsWith(slug + ":")).map((k) => k.slice(slug.length + 1));
}
