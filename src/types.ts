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
  /** 竞价就封在涨停价（一字/秒板），实际上买不到 */
  sealedAtAuction: boolean | null;
  /** 概率计算中缺失的特征个数（按均值代入） */
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
