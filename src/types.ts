export type StockGroup = {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt: string;
};

export type Holding = {
  id: string;
  symbol: string;
  name: string;
  groupId: string;
  openPrice: number | null;
  quantity: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 加入自选当时记下的参考价，用来算「自选收益」（自选以来的涨跌幅）。
   * null = 加入时拿不到当时现价（含本功能上线前的旧记录），这一列如实显示「—」而不是拿现价冒充。
   */
  watchPrice?: number | null;
  /** 参考价的取价时刻；老的本地数据可能缺失，展示时退回 createdAt */
  watchPriceAt?: string | null;
};

export type StorageState = {
  groups: StockGroup[];
  holdings: Holding[];
};

/** 单条行情来自哪家上游 */
export type VendorSource = 'eastmoney' | 'tencent';

/**
 * 聚合响应的来源：优先腾讯，缺口交给东财补，因此可能是「两家混用」。
 * 与 AuctionResponse 的 `eastmoney+tencent` 是同一套语义。
 */
export type QuoteSource = VendorSource | 'eastmoney+tencent';

export type Quote = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  pct: number | null;
  /** 换手率 % */
  turnover: number | null;
  /** 量比 */
  volumeRatio: number | null;
  /** 成交额（元） */
  amount: number | null;
  preClose: number | null;
  updatedAt: string | null;
  source: VendorSource;
  status: "fresh" | "stale" | "unavailable";
};

export type QuoteMap = Record<string, Quote>;

export type QuoteError = {
  symbol: string;
  message: string;
};

export type MarketIndex = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  pct: number | null;
  /** 成交额（元） */
  amount: number | null;
  updatedAt: string | null;
  status: Quote["status"];
};

/** 市场情绪：两市涨跌停与晋级情况 */
export type MarketBreadth = {
  tradeDate: string | null;
  previousTradeDate: string | null;
  /** 今日涨停家数 */
  limitUpCount: number | null;
  /** 今日炸板家数 */
  brokenCount: number | null;
  /** 晋级率 %：昨日涨停今日再涨停 / 昨日涨停 */
  promotionRate: number | null;
  /** 沪深两市上涨家数合计 */
  riseCount: number | null;
  /** 沪深两市下跌家数合计 */
  fallCount: number | null;
  status: Quote["status"];
};

/** 指数部分：各数据源适配器统一返回这个形状 */
export type MarketIndicesResponse = {
  indices: MarketIndex[];
  fetchedAt: string;
  source: QuoteSource;
  errors: QuoteError[];
};

export type MarketOverviewResponse = MarketIndicesResponse & {
  /** 两市成交额（元）= 沪市 + 深市 */
  turnover: number | null;
  breadth: MarketBreadth | null;
};

export type LimitUpItem = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  boardCount: number | null;
  firstSealTime: string | null;
  lastSealTime: string | null;
  industry: string | null;
  breakCount: number | null;
};

export type LimitUpResponse = {
  tradeDate: string | null;
  items: LimitUpItem[];
  fetchedAt: string;
  source: "eastmoney";
  status: Quote["status"];
  error: string | null;
};

/** 连板天梯里的一档：`boardCount` 为 null 表示上游没给连板数的那部分 */
export type LimitUpLadderGroup = {
  boardCount: number | null;
  items: LimitUpItem[];
};

/** 昨日某个板位在今天的去向，用于「今/昨对比」 */
export type LimitUpComparisonItem = {
  /** 昨日连板数；null 归到「连板未知」一档 */
  boardCount: number | null;
  /** 昨日这一档的涨停家数 */
  total: number;
  /** 今天继续涨停（晋级）的部分，同时带上今天的连板数 */
  carried: LimitUpComparisonStock[];
  /** 昨天的这一档里今天没能继续涨停的部分 */
  fallen: LimitUpComparisonStock[];
};

export type LimitUpComparisonStock = {
  symbol: string;
  name: string;
  /** 今天封板后的连板数；`fallen` 里的票没有连板（今天没涨停） */
  boardCount: number | null;
  /**
   * 涨跌幅（%）：`carried` 是今天封板当刻的涨停幅；`fallen` 是它**昨天**涨停当天那根，
   * 不是今天的 —— 断板那批今天的涨幅只能另走行情接口（`comparisonQuotes`）。
   */
  pct: number | null;
};

/**
 * 涨停聚焦里「连板天梯」和「今/昨对比」两个视图的共用响应。
 *
 * 两个视图看的是同一份数据：今天按连板数分层就是天梯，
 * 拿昨天的池子按板位对齐就是今/昨对比。所以一次请求同时给出两天的池子。
 */
export type LimitUpLadderResponse = {
  /** 今天的交易日；上游没给出用请求日期兜底，均不可用时为 null */
  tradeDate: string | null;
  /** 实际取到的上一交易日；取不到时为 null（对比视图会如实标成「昨日数据暂不可用」） */
  previousTradeDate: string | null;
  /** 今日涨停池的原始条目，供页面头部展示家数等口径 */
  items: LimitUpItem[];
  /** 今天涨停池的连板天梯：板位数从高到低，`null` 档排最后 */
  ladder: LimitUpLadderGroup[];
  /** 昨日涨停池的连板天梯，口径同上 */
  previousLadder: LimitUpLadderGroup[];
  /** 今/昨对比：昨日板位从高到低 */
  comparison: LimitUpComparisonItem[];
  /** 昨日涨停家数（= comparison 的 total 之和） */
  previousCount: number;
  /** 今日涨停家数（= comparison 的 carried 之和） */
  carriedCount: number;
  /** 晋级率（%）= 今日涨停 ∩ 昨日涨停 / 昨日涨停 */
  promotionRate: number | null;
  /** 昨日池子是否取到；false 时 comparison 为空、页面必须说明原因而不是显示成「零晋级」 */
  previousAvailable: boolean;
  fetchedAt: string;
  source: 'eastmoney';
  status: Quote['status'];
  /**
   * 只描述「这份响应本身有没有问题」。
   * 昨日池子缺失是**部分可用**、不是坏数据，走 `previousAvailable=false`，这里保持 null；
   * 否则前端会把整份今日天梯一起当成不可用。
   */
  error: string | null;
};

export type SprintLimitUpItem = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  speed: number | null;
  boardCount: number | null;
  probability: number | null;
  reason: string | null;
};

export type SprintLimitUpResponse = {
  tradeDate: string | null;
  items: SprintLimitUpItem[];
  fetchedAt: string;
  source: "eastmoney";
  status: Quote["status"];
  error: string | null;
};

export type DragonTigerItem = {
  symbol: string;
  name: string;
  closePrice: number | null;
  changePct: number | null;
  reason: string | null;
  buyAmount: number | null;
  sellAmount: number | null;
  netAmount: number | null;
};

export type DragonTigerResponse = {
  tradeDate: string | null;
  items: DragonTigerItem[];
  fetchedAt: string;
  source: "eastmoney";
  status: Quote["status"];
  error: string | null;
};

export type AuctionResult = 'qualified' | 'watch' | 'unqualified' | 'insufficient';

/**
 * 竞价溢价分档：衡量「按竞价价买入」的性价比，与「连板概率」是两个独立维度。
 * 140 个交易日回测显示：竞价溢价越高，当日涨停率越高，
 * 但「按竞价价买入」的平均收益越低，因此单独展示而不是混进概率档位。
 */
export type AuctionPremium = 'discount' | 'mild' | 'rich' | 'chase';

export type AuctionItem = {
  symbol: string;
  name: string;
  boardCount: number | null;
  firstSealTime: string | null;
  lastSealTime: string | null;
  breakCount: number | null;
  previousAmount: number | null;
  sealAmount: number | null;
  floatMarketCap: number | null;
  /** 昨日换手率（%），涨停池直接给出 */
  turnoverRate: number | null;
  auctionPrice: number | null;
  auctionPct: number | null;
  auctionAmount: number | null;
  auctionRatio: number | null;
  auctionPremium: AuctionPremium | null;
  /** 09:25 时点信息算出的「今日收盘继续涨停」概率，0~1 */
  limitUpProbability: number | null;
  /** 竞价价是否达到实际涨停价；false不保证成交，null表示价格数据不足 */
  sealedAtAuction: boolean | null;
  /** 五项有效特征中的缺失数；缺1项按均值代入，缺2项及以上暂停分档 */
  probabilityMissing: number;
  result: AuctionResult;
  reasons: string[];
};

export type AuctionResponse = {
  tradeDate: string | null;
  previousTradeDate: string | null;
  snapshotTime: '09:25:00';
  items: AuctionItem[];
  fetchedAt: string;
  source: 'eastmoney' | 'eastmoney+tencent';
  status: Quote['status'];
  error: string | null;
};

/**
 * 买入风险判定。注意这里没有「可买」这一档：
 * 39.5 万样本 × T+1/T+2/T+3 检验下来，日K没有任何可靠的买入信号，
 * 能可靠识别的只有「容易亏钱的形态」，所以分级按风险强弱来分。
 */
export type WatchVerdict = 'edge' | 'neutral' | 'caution' | 'avoid' | 'insufficient';

/** 「观察」板块的当日买入判定结果 */
export type WatchCheckItem = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  preClose: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  distMa20: number | null;
  distHigh60: number | null;
  pct5: number | null;
  pct20: number | null;
  /** 埋伏分：越高越符合「安静、冷门、没涨过、小盘、低价」的埋伏特征 */
  ambushScore: number | null;
  /** 埋伏分的市场分位（0~100） */
  ambushPercentile: number | null;
  verdict: WatchVerdict;
  reasons: string[];
};

export type WatchCheckResponse = {
  items: WatchCheckItem[];
  fetchedAt: string;
  source: 'tencent';
  errors: QuoteError[];
};

/** 选股页的数据来源：板块骨架来自东财，涨停结构来自同花顺，行情来自腾讯 */
export type ScreenerSource = 'eastmoney+10jqka' | 'eastmoney+10jqka+tencent' | 'eastmoney';

/** 题材分类：主线 / 支线 */
export type ThemeKind = 'main' | 'branch';

/** 用户给的 8 个判断指标 */
export type ThemeMetricKey =
  | 'duration'
  | 'limitUpCount'
  | 'ladder'
  | 'amount'
  | 'catalyst'
  | 'leader'
  | 'revival'
  | 'influence';

export type ThemeMetric = {
  key: ThemeMetricKey;
  label: string;
  hit: boolean;
  /** 展示值，如「5 天」「12 只」 */
  value: string;
  /** 判定依据，如「连续 5 个交易日涨停家数 ≥2」 */
  detail: string;
};

export type ThemeLeader = {
  symbol: string;
  name: string;
  boardCount: number | null;
  /** 原样保留上游的「8天5板」 */
  highLabel: string | null;
};

export type ThemeItem = {
  /** 东财板块代码，如 BK0900 */
  code: string;
  name: string;
  kind: ThemeKind;
  pct: number | null;
  /** 当日涨停家数（自算：涨停股按 F10 纯正板块归属分组） */
  limitUpCount: number;
  /** 连板家数 */
  continuousCount: number;
  maxBoard: number | null;
  maxBoardLabel: string | null;
  /** 持续天数：连续满足「每日涨停家数 ≥2」的交易日数 */
  durationDays: number;
  /** 板块成交额（元） */
  amount: number | null;
  /** 板块成交额占两市成交比（%） */
  amountRatio: number | null;
  /** 涨停原因标签 */
  catalysts: string[];
  leader: ThemeLeader | null;
  metrics: ThemeMetric[];
  /** 命中指标数（旧 8 项口径，只作观察展示，不再决定主线资格） */
  score: number;
  /** v2 分类依据（classifyThemeV2 产出） */
  classificationReasons: string[];
  /** 概念成员涨停数（口径：当日涨停股 ∩ 该板块概念归属） */
  conceptLimitUpCount: number | null;
  /** 驱动有依据涨停数；基础数据缺失时为已知下界 */
  supportedLimitUpCount: number | null;
  /** 待确认关联涨停数（证据缺失 / 未决） */
  unresolvedLimitUpCount: number | null;
};

export type ThemesResponse = {
  schemaVersion: 2;
  tradeDate: string | null;
  main: ThemeItem[];
  branch: ThemeItem[];
  /** 待确认：证据不足，既不能算主线也不能自动降为支线 */
  pending: ThemeItem[];
  fetchedAt: string;
  source: ScreenerSource;
  status: ScreenerDataStatus;
  warnings: string[];
  error: string | null;
};

/** 题材详情里的 4 个标签 */
export type ThemeStockRole = 'leader' | 'turnover' | 'trend' | 'laggard';

export const THEME_STOCK_ROLES: ThemeStockRole[] = ['leader', 'turnover', 'trend', 'laggard'];

export type ThemeStockItem = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  boardCount: number | null;
  firstSealTime: string | null;
  /** 换手板 / 一字板 / T字板 */
  sealType: string | null;
  /** 开板次数 */
  openCount: number | null;
  /** 封单额（元） */
  sealAmount: number | null;
  turnoverRate: number | null;
  amount: number | null;
  avgAmount3d: number | null;
  avgAmount5d: number | null;
  floatMarketCap: number | null;
  reason: string | null;
  /** 题材纯正度（东财 F10 IS_PRECISE） */
  precise: boolean | null;
  hits: string[];
  misses: string[];
  risks: string[];
  // ---- 展示列：均线相关只展示，不作为硬条件 ----
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  maBull: boolean | null;
  distMa5: number | null;
  distMa10: number | null;
  /** 最近 10 日收盘站上 MA5 的天数 */
  stableDays10: number | null;
  pct10: number | null;
  pct20: number | null;
  limitUpIn60d: number | null;
};

export type ThemeStocksResponse = {
  tradeDate: string | null;
  theme: { code: string; name: string } | null;
  role: ThemeStockRole;
  items: ThemeStockItem[];
  scanned: number;
  fetchedAt: string;
  source: ScreenerSource;
  status: Quote['status'];
  error: string | null;
};

// ---------------------------------------------------------------------------
// 选股重构 v2 契约（见 docs/superpowers/plans/2026-09-18-screener-ai-implementation.md）
// ---------------------------------------------------------------------------

/**
 * 单个判定项的四态。四态不能混淆：
 * 普通未涨停、明确不满足阈值是 fail；数据没取到是 missing；需要次日或分时确认是 pending。
 */
export type CheckState = 'pass' | 'fail' | 'pending' | 'missing';

/**
 * 响应整体数据状态。partial = 有可用结果但有缺失；
 * stale = 返回的是同查询键的旧快照；fresh 允许 warnings 但不允许 error。
 */
export type ScreenerDataStatus = 'fresh' | 'partial' | 'stale' | 'unavailable';

/** 题材分类：主线 / 支线 / 待确认 */
export type ThemeKindV2 = 'main' | 'branch' | 'pending';

/**
 * 本轮关联状态（与静态概念归属分开）：
 * - supported：有对应日期的可追溯证据支持本轮驱动
 * - possible：业务相关且有响应迹象，但证据不足或有冲突
 * - membership_only：只查到静态归属，没有本轮驱动依据
 * - other_driver：当前证据更支持另一逻辑（保留替代解释）
 * - unknown：证据获取失败或无法判断（不能自动当成 membership_only）
 */
export type RelationState =
  | 'supported'
  | 'possible'
  | 'membership_only'
  | 'other_driver'
  | 'unknown';

export type Evidence = {
  id: string;
  themeCode: string;
  symbol: string;
  sourceKind: 'limit_up_reason' | 'announcement' | 'event' | 'manual';
  sourceName: string;
  sourceUrl: string | null;
  text: string;
  publishedAt: string | null;
  observedAt: string;
  validTradeDate: string;
  topicKey: string | null;
  /** 只有明确语义映射才为 exact；模糊关联不能作为强证据 */
  match: 'exact' | 'ambiguous' | 'unrelated';
};

export type ThemeRelation = {
  state: RelationState;
  evidenceIds: string[];
  reasons: string[];
  alternativeThemeCodes: string[];
  topicKeys: string[];
  asOf: string;
};

export type CheckResult = {
  key: string;
  state: CheckState;
  value: number | string | boolean | null;
  reason: string;
  evidenceIds: string[];
};

export type RoleTag = {
  role: ThemeStockRole;
  status: 'candidate' | 'confirmed';
  reasons: string[];
  missingEvidence: string[];
  assignedAt: string;
  ruleVersion: string;
};

/** 扫描覆盖：attempted = succeeded + failed；total = attempted + unscanned。只数唯一股票 */
export type ScanCoverage = {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unscanned: number;
};

export type ThemeStockV2 = ThemeStockItem & {
  quoteAsOf: string | null;
  relation: ThemeRelation;
  roles: RoleTag[];
  checks: Partial<Record<ThemeStockRole, CheckResult[]>>;
  metricsState: 'ready' | 'missing' | 'failed';
  metricsTradeDate: string | null;
  risksChecked: boolean;
};

export type ThemeDetailResponseV2 = {
  schemaVersion: 2;
  ruleVersion: string;
  tradeDate: string | null;
  asOf: string;
  theme: { code: string; name: string } | null;
  /**
   * 只包含**参与过本轮计算的成员**（最多 THEME_SCAN_LIMIT 只），不是板块的全部成员。
   * 未扫描成员的数量在 coverage.unscanned / coverage.total 里，界面必须按 coverage 说明覆盖情况，
   * 不能把 items.length 当成板块成员总数。
   */
  items: ThemeStockV2[];
  evidence: Evidence[];
  coverage: ScanCoverage;
  status: ScreenerDataStatus;
  warnings: string[];
  error: string | null;
};

export type TrendFilters = {
  themeScope: 'main' | 'all';
  maxMa5Dist: number;
  maxPct: number;
  pctWindow: number;
  minStableDays: number;
  minAmountYi: number;
  /** 5 个形态条件里至少命中几个（扫描器用它放宽门槛，看「差一点」的票） */
  minScore: number;
  mainOnly: boolean;
  excludeSt: boolean;
};

export type TrendPick = {
  symbol: string;
  name: string;
  themes: Array<{ code: string; name: string }>;
  /**
   * 所属行业板块名称（上游行情快照给的归属，不是本项目自算的题材）。
   * 拿不到时为 null，界面按「—」显示，不用空题材冒充。
   */
  industry: string | null;
  price: number | null;
  pct: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  distMa5: number | null;
  stableDays: number | null;
  /** 量能比：当日量 / 前 5 日均量，<1 即缩量 */
  shrink: number | null;
  pctWindow: number | null;
  avgAmount5d: number | null;
  turnoverRate: number | null;
  /** 命中的条件 */
  matched: string[];
  /** 未命中的条件（形态扫描器要把两边都列出来） */
  unmatched: string[];
};

export type TrendScanResponse = {
  tradeDate: string | null;
  items: TrendPick[];
  /** 漏斗里实际拉过日K的股票数 */
  scanned: number;
  /** 参与预筛的成分股数 */
  candidates: number;
  filters: TrendFilters;
  fetchedAt: string;
  source: ScreenerSource;
  status: Quote['status'];
  error: string | null;
};

export type StockSearchResult = {
  symbol: string;
  name: string;
};

export type StockSearchResponse = {
  results: StockSearchResult[];
  source: 'eastmoney';
};

export type QuotesResponse = {
  quotes: Quote[];
  fetchedAt: string;
  source: QuoteSource;
  errors: QuoteError[];
};

export type HoldingPerformance = {
  profit: number | null;
  returnPct: number | null;
  hasQuote: boolean;
};

export type PortfolioSummary = {
  invested: number;
  marketValue: number;
  profit: number | null;
  returnPct: number | null;
  hasPartialQuotes: boolean;
  holdingCount: number;
};
