/**
 * 主线引擎（mainline）的类型定义。
 *
 * 设计依据见 `docs/mainline-engine-design.md`：
 *   L1 板块层 §2   四榜排名 + 连续多日上榜
 *   L2 题材层 §3   从板块里提取题材（涨停原因标签 → 通用词过滤 → 同义归一 → 成题）
 *   L3 阵容层 §4   五档梯队 + 中军
 *   L4 时间层 §5   连续计数（分歧不断链）+ 分歧后回流
 *   §6             评分表与分档
 *
 * 数据源只用同花顺（`block_top` / `limit_up_pool` / `realhead` / 板块年度日K）。
 * **资金流（527198）没有历史**，所以历史快照里它是 null，回测阶段用不含资金流的并行口径。
 */

/** 评分表的十个条件（§6 原方法的十项） */
export type ScoreConditionKey =
  | 'limitUpTop3'
  | 'marketHeightBoard'
  | 'coreTroop'
  | 'amountTop5'
  | 'streak3'
  | 'capitalReturn'
  | 'catalyst'
  | 'fullLadder'
  | 'breakBoard'
  | 'ebb';

export type ScoreCondition = {
  key: ScoreConditionKey;
  /** 条件原文（面板直接显示这一句） */
  label: string;
  /** 是否命中 */
  hit: boolean;
  /** 该项得分（含负数） */
  score: number;
  /** 命中的依据数字，面板显示「为什么命中」；缺失时 null */
  evidence: string | null;
};

/** 分档：§6 的四档 */
export type MainlineTier = 'mainline' | 'candidate' | 'branch' | 'one_day';

export type BoardJudge = {
  tier: MainlineTier;
  /** 评分总分（0~15 区间，含负分） */
  total: number;
  conditions: ScoreCondition[];
  /** 退潮标记：龙头断板 + 家数腰斩，出现即不进主线 */
  ebb: boolean;
  /**
   * 回测口径标记：历史快照没有资金流时，`capitalReturn` 与 `coreTroop`
   * 的部分依据不可用，此时为 true，面板与回测都要如实披露。
   */
  degraded: boolean;
};

/** 一个板块在某个交易日的完整快照 */
export type BoardDay = {
  date: string;
  code: string;
  name: string;
  /** 板块涨幅 %（realhead.199112 / block_top.change） */
  pct: number | null;
  /** 涨停家数（block_top.limit_up_num，同花顺口径） */
  limitUpCount: number;
  /** 连板家数（block_top.continuous_plate_num） */
  continuousCount: number;
  /** 最高板原文，如「6天3板」 */
  highLabel: string | null;
  /** 最高板数（由 highLabel 解析） */
  maxBoard: number;
  /** 上游给的持续天数（block_top.days，语义不完全明确，只作参考） */
  upstreamDays: number | null;
  /** 成交额（元）；realhead.19 或板块年度日K 第 7 列 */
  amount: number | null;
  /** 主力净流入（元）；realhead.527198。**无历史，历史快照为 null** */
  mainNet: number | null;

  /** 四榜名次（1 起；未进 TopN 或该榜不可用为 null） */
  rank: {
    pct: number | null;
    limitUp: number | null;
    flow: number | null;
    amount: number | null;
  };
  /** 当日进入 TopN 的榜单数 0~4 */
  hit: number;
  /** 连续「hit ≥ 2」的交易日数（含当日） */
  streakHit: number;
  /** 分榜连续在榜天数 */
  streakRank: {
    pct: number;
    limitUp: number;
    flow: number;
    amount: number;
  };

  /** 连续性（§5.1；分歧日不断链） */
  streak: number;
  /** 当日类型 */
  dayKind: 'strong' | 'divergence' | 'weak';
  /** 分歧后回流（§5.2）：+1 确认回流 / 0 未确认 / -1 退潮 / null 未出现分歧日 */
  capitalReturn: number | null;

  /** L3 阵容（当日涨停成员的形态；null 表示该日没有成员数据） */
  ladder: LadderShape | null;
  /** L2 题材（当日该板块提取出的题材；[] 表示没提取出来） */
  themes: ThemeTag[];

  judge: BoardJudge | null;
};

/** L3 五档阵容 */
export type LadderMember = {
  symbol: string;
  name: string;
  boardCount: number;
  highLabel: string | null;
  firstSealTime: string | null;
  /** 封单额（元），来自涨停池；block_top 不给 */
  sealAmount: number | null;
  /** 当日成交额（元），来自涨停池；block_top 不给 */
  amount: number | null;
  /** 流通市值（元），来自涨停池；block_top 不给 */
  floatMarketCap: number | null;
  /** 换手率 %，来自涨停池；block_top 不给 */
  turnoverRate: number | null;
  /** 当日涨跌幅 %；实时口径下是当日，历史口径下可能为 null */
  pct: number | null;
  /** 上游封板类型标记（`change_tag`），用于炸板判定 */
  changeTag: string | null;
  /**
   * 近 60 日涨停次数；用于「低位补涨」判定（此前没炒过 = 低位）。
   * block_top 与涨停池不直接给，缺省 null（此时低位补涨判定按不可用处理）。
   */
  limitUpIn60d: number | null;
  /** 是否 ST */
  isSt: boolean;
  /** 涨停原因标签（原始，未归一） */
  reasonTags: string[];
};

export type LadderShape = {
  /** 最高板数 */
  maxBoard: number;
  /** 最高板成员 */
  leader: LadderMember | null;
  /** 2~3 板（前排核心） */
  frontRow: LadderMember[];
  /** 首板（助攻） */
  firstBoard: LadderMember[];
  /** 低位补涨：首板且此前 N 日未在该板块涨停 */
  laggard: LadderMember[];
  /** 中军：大市值 + 大成交 + 上涨（§4.3） */
  core: LadderMember[];
  /** 中军支撑度 0~1（§4.3） */
  coreSupport: number;
  /** 炸板率 0~1；没有炸板数据时为 null */
  breakRate: number | null;
  /** 是否为完整梯队（原方法模板：高度 + 2板前排 + 首板助攻 + 中军） */
  full: boolean;
  /**
   * 三个「可判定」标记。数据缺失时对应的量是 0/null，**不能当成「没有」**——
   * 面板与评分表必须按不可判定披露（实测：block_top 不给成员成交额与流通市值，
   * 所以历史回填里中军一律不可判定）。
   */
  coreAvailable: boolean;
  laggardAvailable: boolean;
  breakRateAvailable: boolean;
};

/** L2 题材（一个标签在一个板块内的一天） */
export type ThemeTag = {
  /** 归一的 key，如「先进封装」 */
  key: string;
  /** 原始标签里出现最多的那个写法，用于显示 */
  display: string;
  /** 被归一并入的原始标签（去重后） */
  variants: string[];
  /** 该板块内带此标签的涨停家数 */
  count: number;
  /** 成员 */
  members: Array<{ symbol: string; name: string; boardCount: number; highLabel: string | null }>;
  /** 成员中的最高板 */
  maxBoard: number;
  /** 板块外家数 / 全市场家数（0~1）；无全市场数据时 null */
  outOfBoardRatio: number | null;
  /** 全市场当日家数（含本板块）；无数据时 null */
  marketCount: number | null;
  /** 连续多少个交易日在这个板块内 cnt ≥ 2（含当日） */
  streak: number;
  /** 该标签当日在多少个板块的题材里出现（跨板块扩散） */
  boardSpread: number;
};

/** 板块宇宙条目（靠 block_top 历史累积） */
export type UniverseEntry = {
  code: string;
  name: string;
  /** 在拉取窗口内进过涨停板块 Top 20 的天数 */
  days: number;
  /** 窗口内最高涨停家数 */
  maxLimitUpCount: number;
  firstSeen: string;
  lastSeen: string;
};

/** realhead 解析结果 */
export type BoardRealtime = {
  code: string;
  name: string;
  /** 19 成交额（元） */
  amount: number | null;
  /** 199112 涨跌幅 % */
  pct: number | null;
  /** 527198 主力净流入（元） */
  mainNet: number | null;
  /** 271 涨停家数（同花顺口径，可能含涨停打开） */
  limitUpCount: number | null;
  /** 37/38/39 涨/跌/平家数 */
  riseCount: number | null;
  fallCount: number | null;
  flatCount: number | null;
};
