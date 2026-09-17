/**
 * 题材分类：把用户给的 8 个判断指标翻译成可算口径，并判定主线 / 支线。
 *
 * 用户原表（主线 / 支线）：
 *   持续时间  ≥3 天 / 1~2 天
 *   涨停家数  连续 ≥5 只 / 2~4 只
 *   连板梯队  首板、二板、高标完整 / 不完整
 *   成交额    连续放大、占市场明显 / 规模较小
 *   催化强度  政策、产业、业绩 / 单一消息
 *   龙头表现  龙头持续打开高度 / 高度有限
 *   回流能力  分歧后能再次加强 / 分歧后消失
 *   市场影响力 能带动指数 / 局部活跃
 *
 * 判定规则刻意不做简单加权：
 *   主线 = 涨停家数 ≥5 且 8 项命中 ≥5
 *   支线 = 其余且涨停家数 ≥2
 * 因为「涨停家数」是必要条件——家数不到 5 只，其他项再好也不是主线。
 */
import type {
  ThemeItem,
  ThemeKind,
  ThemeLeader,
  ThemeMetric,
  ThemeMetricKey,
} from '../../src/types.js';

/** 连续期内每日涨停家数下限 */
export const DURATION_DAILY_FLOOR = 2;
/** 主线涨停家数下限 */
export const MAIN_MIN_LIMIT_UP = 5;
/** 主线需要命中的指标数 */
export const MAIN_MIN_SCORE = 5;
/** 成交额放大的倍数下限 */
export const AMOUNT_EXPAND_RATIO = 1.15;
/** 成交额占两市成交比下限（%） */
export const AMOUNT_RATIO_FLOOR = 1;
/** 市场影响力：占比下限（%） */
export const INFLUENCE_RATIO_FLOOR = 3;
/** 市场影响力：相对指数超额下限（%） */
export const INFLUENCE_EXCESS_FLOOR = 1;

const isPositive = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

/** 解析上游的「8天5板」／「3天2板」→ 连板高度；解析不出来返回 null */
export const parseHighDays = (label: string | null | undefined): number | null => {
  if (typeof label !== 'string') return null;
  const match = label.match(/(\d+)\s*板/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export type ThemeLimitUpRow = {
  symbol: string;
  name: string;
  boardCount: number | null;
  /** HH:mm:ss */
  firstSealTime: string | null;
  /** 涨停原因标签，如 ["风电铸件", "半年报增长"] */
  reasonTags: string[];
};

export type ThemeClassifyInput = {
  code: string;
  name: string;
  pct: number | null;
  /** 当日该板块的涨停股 */
  limitUpRows: ThemeLimitUpRow[];
  /**
   * 板块成交额序列，**最后一个为当日**（元）。
   * 来源：同花顺 bk 日K 的成交额列，或成分股成交额求和。
   */
  amounts: number[];
  /** 当日两市成交额（元） */
  marketAmount: number | null;
  /** 上证指数涨跌幅（%） */
  indexPct: number | null;
  /**
   * 历史涨停家数：**index 0 = 今天**，index 1 = 上一交易日，以此类推。
   * 由调用方用「该板块当前成分股 ∩ 历史涨停名单」算出。
   */
  historyCounts: number[];
};

export type ThemeClassification = {
  kind: ThemeKind | null;
  metrics: ThemeMetric[];
  score: number;
  limitUpCount: number;
  continuousCount: number;
  maxBoard: number | null;
  maxBoardLabel: string | null;
  durationDays: number;
  amountRatio: number | null;
  catalysts: string[];
  leader: ThemeLeader | null;
};

// 催化强度关键词：政策 / 产业 / 业绩 三类算「强」，单一事件不算
const CATALYST_GROUPS: Array<{ label: string; keywords: string[] }> = [
  {
    label: '政策',
    keywords: [
      '政策', '规划', '试点', '国资委', '央企', '国企', '国务院', '部委', '补贴',
      '减免', '税收', '标准', '立法', '十五五', '十四五', '专项', '招标', '采购',
    ],
  },
  {
    label: '产业',
    keywords: [
      '量产', '订单', '中标', '产能', '扩产', '涨价', '提价', '签约', '合作',
      '供货', '技术', '突破', '发布', '新品', '获批', '投产', '交付', '产业链',
    ],
  },
  {
    label: '业绩',
    keywords: [
      '业绩', '净利', '增长', '预增', '扭亏', '年报', '半年报', '季报', '营收',
      '毛利', '分红', '回购',
    ],
  },
];

const collectCatalysts = (rows: ThemeLimitUpRow[]): string[] => {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const tag of row.reasonTags) {
      const trimmed = tag.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen].slice(0, 12);
};

const matchCatalystGroups = (catalysts: string[]): string[] => {
  const text = catalysts.join(' ');
  return CATALYST_GROUPS.filter((group) =>
    group.keywords.some((keyword) => text.includes(keyword)),
  ).map((group) => group.label);
};

/** 连续满足「每日涨停家数 ≥ DURATION_DAILY_FLOOR」的天数（含今天） */
export const computeDurationDays = (historyCounts: number[]): number => {
  if (historyCounts.length === 0 || historyCounts[0] < DURATION_DAILY_FLOOR) return 0;
  let days = 1;
  for (let index = 1; index < historyCounts.length; index += 1) {
    if (historyCounts[index] >= DURATION_DAILY_FLOOR) days += 1;
    else break;
  }
  return days;
};

/**
 * 回流能力：近 5 日内出现过「家数环比腰斩」的分歧日，
 * 且分歧日之后（更近的某天）家数回升到分歧日的 1.5 倍以上。
 */
export const hasRevival = (historyCounts: number[]): boolean => {
  const window = historyCounts.slice(0, 6);
  for (let index = 1; index < window.length - 1; index += 1) {
    const current = window[index];
    const previous = window[index + 1];
    if (!(previous >= DURATION_DAILY_FLOOR)) continue;
    if (!(current <= previous * 0.5)) continue;
    const recovered = Math.max(...window.slice(0, index));
    if (recovered >= Math.max(current, 1) * 1.5) return true;
  }
  return false;
};

const buildMetrics = (input: ThemeClassifyInput): ThemeMetric[] => {
  const rows = input.limitUpRows;
  const limitUpCount = rows.length;
  const boards = rows.map((row) => row.boardCount ?? 1);
  const maxBoard = boards.length > 0 ? Math.max(...boards) : null;
  const firstBoardCount = boards.filter((count) => count === 1).length;
  const continuousCount = boards.filter((count) => count >= 2).length;

  const durationDays = computeDurationDays(input.historyCounts);

  const today = input.amounts.at(-1) ?? null;
  const previous = input.amounts.slice(-6, -1);
  const avgPrevious = previous.length >= 3 ? mean(previous.slice(-5)) : null;
  const expandRatio = isPositive(today) && isPositive(avgPrevious) ? today / avgPrevious : null;
  const amountRatio =
    isPositive(today) && isPositive(input.marketAmount)
      ? (today / input.marketAmount) * 100
      : null;

  const catalysts = collectCatalysts(rows);
  const catalystGroups = matchCatalystGroups(catalysts);

  const leader = pickLeader(rows, boards);

  const excess =
    input.pct !== null && input.indexPct !== null ? input.pct - input.indexPct : null;

  const metrics: Array<{
    key: ThemeMetricKey;
    label: string;
    hit: boolean;
    value: string;
    detail: string;
  }> = [
    {
      key: 'duration',
      label: '持续时间',
      hit: durationDays >= 3,
      value: `${durationDays} 天`,
      detail: `连续 ${durationDays} 个交易日涨停家数 ≥${DURATION_DAILY_FLOOR}（要求 ≥3 天）`,
    },
    {
      key: 'limitUpCount',
      label: '涨停家数',
      hit: limitUpCount >= MAIN_MIN_LIMIT_UP,
      value: `${limitUpCount} 只`,
      detail: `当日 ${limitUpCount} 只涨停（主线要求 ≥${MAIN_MIN_LIMIT_UP}，支线 2~4）`,
    },
    {
      key: 'ladder',
      label: '连板梯队',
      hit: maxBoard !== null && maxBoard >= 3 && continuousCount >= 2 && firstBoardCount >= 2,
      value: `最高 ${maxBoard ?? '—'} 板 / 连板 ${continuousCount} 只 / 首板 ${firstBoardCount} 只`,
      detail: '要求最高板 ≥3、连板 ≥2 只、首板 ≥2 只（梯队完整）',
    },
    {
      key: 'amount',
      label: '成交额',
      hit:
        expandRatio !== null &&
        expandRatio >= AMOUNT_EXPAND_RATIO &&
        amountRatio !== null &&
        amountRatio >= AMOUNT_RATIO_FLOOR,
      value:
        expandRatio === null
          ? '—'
          : `前 5 日均值 ${expandRatio.toFixed(2)} 倍${amountRatio === null ? '' : ` · 占两市 ${round(amountRatio)}%`}`,
      detail: `要求较前 5 日均值放大 ≥${AMOUNT_EXPAND_RATIO} 倍且占两市成交 ≥${AMOUNT_RATIO_FLOOR}%`,
    },
    {
      key: 'catalyst',
      label: '催化强度',
      hit: catalystGroups.length > 0,
      value: catalystGroups.length > 0 ? catalystGroups.join(' + ') : '未识别',
      detail:
        catalystGroups.length > 0
          ? `涨停原因命中 ${catalystGroups.join(' / ')} 类逻辑`
          : '涨停原因未命中政策 / 产业 / 业绩关键词（多为单一消息或短期事件）',
    },
    {
      key: 'leader',
      label: '龙头表现',
      hit: maxBoard !== null && maxBoard >= 3,
      value: leader ? `${leader.name}${leader.highLabel ? ` · ${leader.highLabel}` : ''}` : '—',
      detail: `板块最高板 ${maxBoard ?? '—'}（要求 ≥3 板）`,
    },
    {
      key: 'revival',
      label: '回流能力',
      hit: hasRevival(input.historyCounts),
      value: hasRevival(input.historyCounts) ? '分歧后回升' : '未观察到',
      detail: '近 5 日内出现「涨停家数环比腰斩」的分歧日后，家数是否回升到 1.5 倍以上',
    },
    {
      key: 'influence',
      label: '市场影响力',
      hit:
        (amountRatio !== null && amountRatio >= INFLUENCE_RATIO_FLOOR) ||
        (excess !== null && excess >= INFLUENCE_EXCESS_FLOOR),
      value:
        excess === null
          ? amountRatio === null
            ? '—'
            : `占两市 ${round(amountRatio)}%`
          : `较上证 ${excess >= 0 ? '+' : ''}${round(excess)}%`,
      detail: `要求占两市成交 ≥${INFLUENCE_RATIO_FLOOR}% 或跑赢上证 ≥${INFLUENCE_EXCESS_FLOOR}%`,
    },
  ];

  return metrics;
};

const pickLeader = (rows: ThemeLimitUpRow[], boards: number[]): ThemeLeader | null => {
  if (rows.length === 0) return null;
  let bestIndex = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const best = boards[bestIndex];
    const current = boards[index];
    if (current > best) {
      bestIndex = index;
      continue;
    }
    if (current === best) {
      const bestTime = rows[bestIndex]?.firstSealTime ?? '99:99:99';
      const currentTime = rows[index]?.firstSealTime ?? '99:99:99';
      if (currentTime < bestTime) bestIndex = index;
    }
  }
  const row = rows[bestIndex];
  return {
    symbol: row.symbol,
    name: row.name,
    boardCount: row.boardCount,
    highLabel: row.boardCount === null ? null : `${row.boardCount} 板`,
  };
};

export const classifyTheme = (input: ThemeClassifyInput): ThemeClassification => {
  const metrics = buildMetrics(input);
  const score = metrics.filter((metric) => metric.hit).length;
  const limitUpCount = input.limitUpRows.length;
  const boards = input.limitUpRows.map((row) => row.boardCount ?? 1);
  const maxBoard = boards.length > 0 ? Math.max(...boards) : null;

  const kind: ThemeKind | null =
    limitUpCount >= MAIN_MIN_LIMIT_UP && score >= MAIN_MIN_SCORE
      ? 'main'
      : limitUpCount >= DURATION_DAILY_FLOOR
        ? 'branch'
        : null;

  const leader = pickLeader(input.limitUpRows, boards);

  return {
    kind,
    metrics,
    score,
    limitUpCount,
    continuousCount: boards.filter((count) => count >= 2).length,
    maxBoard,
    maxBoardLabel: maxBoard === null ? null : `${maxBoard} 板`,
    durationDays: computeDurationDays(input.historyCounts),
    amountRatio:
      isPositive(input.amounts.at(-1) ?? null) && isPositive(input.marketAmount)
        ? ((input.amounts.at(-1) as number) / (input.marketAmount as number)) * 100
        : null,
    catalysts: collectCatalysts(input.limitUpRows),
    leader,
  };
};

/** 把分类结果组装成页面用的 ThemeItem */
export const toThemeItem = (input: ThemeClassifyInput): ThemeItem | null => {
  const classification = classifyTheme(input);
  if (classification.kind === null) return null;
  return {
    code: input.code,
    name: input.name,
    kind: classification.kind,
    pct: input.pct,
    limitUpCount: classification.limitUpCount,
    continuousCount: classification.continuousCount,
    maxBoard: classification.maxBoard,
    maxBoardLabel: classification.maxBoardLabel,
    durationDays: classification.durationDays,
    amount: input.amounts.at(-1) ?? null,
    amountRatio:
      classification.amountRatio === null ? null : round(classification.amountRatio),
    catalysts: classification.catalysts,
    leader: classification.leader,
    metrics: classification.metrics,
    score: classification.score,
  };
};
