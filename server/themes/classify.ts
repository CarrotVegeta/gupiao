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
 *
 * 上面这套 8 项凑分的 v1 口径**只保留为观察指标**（页面上仍逐项展示），
 * 主线/支线/待确认的资格改由 `classifyThemeV2` 判定：只用明确的家数与持续性，
 * 且数据缺失一律 pending，不用其它项把缺口补上。
 */
import type {
  ThemeItem,
  ThemeKind,
  ThemeKindV2,
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
    // 旧的 8 项凑分只作观察：v2 资格由 classifyThemeV2 覆盖
    classificationReasons: [
      `旧口径 8 项命中 ${classification.score}/8（仅观察，不决定主线资格）`,
    ],
    conceptLimitUpCount: classification.limitUpCount,
    supportedLimitUpCount: null,
    unresolvedLimitUpCount: null,
  };
};

/**
 * 在旧口径 ThemeItem 的基础上写入 v2 分类结果。
 * `kind` 保留旧枚举（pending 归到 branch），v2 的三分类以 `classificationReasons`
 * 与总览的 pending 列表表达，避免为一个展示字段引入第二套结构。
 */
export const toThemeItemV2 = (
  input: ThemeClassifyInput,
  classification: ThemeClassificationV2,
  counts: { concept: number | null; supported: number | null; unresolved: number | null },
): ThemeItem | null => {
  const legacy = toThemeItem(input);
  if (legacy === null) return null;
  return {
    ...legacy,
    kind: classification.kind === 'pending' ? 'branch' : classification.kind,
    classificationReasons: classification.reasons,
    conceptLimitUpCount: counts.concept,
    supportedLimitUpCount: counts.supported,
    unresolvedLimitUpCount: counts.unresolved,
  };
};

// ---------------------------------------------------------------------------
// v2：主线 / 支线 / 待确认
// ---------------------------------------------------------------------------

/** 主线资格：当日驱动有依据家数下限 */
export const MAIN_SUPPORTED_TODAY_FLOOR = 5;
/** 主线资格：前两个有效交易日各自的下限 */
export const MAIN_SUPPORTED_PREVIOUS_FLOOR = 2;
/** 支线资格：当日驱动有依据家数下限 */
export const BRANCH_SUPPORTED_TODAY_FLOOR = 2;
/** 概念活跃下限：只有当天概念涨停 ≥2 才进入列表（避免把全目录都显示为待确认） */
export const CONCEPT_ACTIVE_FLOOR = 2;

export type ThemeDayEvidence = {
  /** YYYYMMDD */
  date: string;
  conceptCount: number | null;
  supportedCount: number | null;
  unresolvedCount: number | null;
  /** 该日基础数据是否完整；不完整不能据此排除主线 */
  complete: boolean;
};

export type ThemeClassificationV2 = {
  kind: ThemeKindV2;
  reasons: string[];
  /** 今天没到活跃门槛（家数不足），但题材仍值得保留展示 */
  belowActiveFloor: boolean;
  /** 是否进入列表（当日概念活跃，或昨日已跟踪的题材） */
  listed: boolean;
};

const formatCount = (value: number | null): string => (value === null ? '缺失' : `${value}`);

/** YYYYMMDD 之间是否只差一个自然日（周末缺口也会被识别出来） */
export const isNextCalendarDay = (older: string, newer: string): boolean => {
  if (!/^\d{8}$/.test(older) || !/^\d{8}$/.test(newer)) return false;
  const toTime = (value: string): number =>
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.round((toTime(newer) - toTime(older)) / 86_400_000) === 1;
};

/**
 * v2 分类规则（v1 建议默认值，只用明确的家数与持续性）：
 *   - 使用最近 3 个有效交易日（不是自然日），日期缺口不能跳过；
 *   - 今天驱动有依据 ≥5 且前两日各 ≥2 → main；
 *   - 数据不足以证明 main（不足 3 日、计数缺失，或未决成员可能补足）→ pending；
 *   - 数据足以排除 main 且今天 ≥2 → branch；
 *   - 其它 → pending；只有当日概念活跃或已跟踪的题材才进入列表。
 *
 * `daysNewestFirst[0]` 必须是当天。历史日的 supportedCount 目前只能给出概念口径下界时，
 * 调用方应把 `complete` 置 false，函数会因此判 pending 而不是假装达标。
 */
export const classifyThemeV2 = (
  daysNewestFirst: ThemeDayEvidence[],
  options: { previouslyTracked?: boolean } = {},
): ThemeClassificationV2 => {
  const [today, ...previous] = daysNewestFirst;
  const reasons: string[] = [];

  if (!today) {
    return {
      kind: 'pending',
      reasons: ['没有当日数据，无法分类'],
      belowActiveFloor: true,
      listed: options.previouslyTracked === true,
    };
  }

  const todayConcept = today.conceptCount;
  const todaySupported = today.supportedCount;
  const todayUnresolved = today.unresolvedCount ?? 0;
  const belowActiveFloor = todayConcept !== null && todayConcept < CONCEPT_ACTIVE_FLOOR;
  const listed =
    options.previouslyTracked === true ||
    (todayConcept !== null && todayConcept >= CONCEPT_ACTIVE_FLOOR);

  if (belowActiveFloor) {
    reasons.push(
      `今日概念涨停 ${formatCount(todayConcept)} 只，未达活跃门槛 ≥${CONCEPT_ACTIVE_FLOOR}（今日未达活跃门槛，不据此判断阶段）`,
    );
  }

  const window = daysNewestFirst.slice(0, 3);
  if (window.length < 3) {
    reasons.push(`只有 ${window.length} 个有效交易日数据，不足 3 日（不足以证明主线）`);
  }

  const datesContinuous =
    window.length === 3 &&
    isNextCalendarDay(window[1].date, window[0].date) &&
    isNextCalendarDay(window[2].date, window[1].date);
  const countsKnown =
    window.length === 3 &&
    window.every((day) => day.supportedCount !== null && day.unresolvedCount !== null);
  const countsComplete = window.length === 3 && window.every((day) => day.complete);

  const mainTodayOk =
    todaySupported !== null && todaySupported >= MAIN_SUPPORTED_TODAY_FLOOR;
  const mainPreviousOk =
    previous.length >= 2 &&
    previous[0].supportedCount !== null &&
    previous[1].supportedCount !== null &&
    previous[0].supportedCount >= MAIN_SUPPORTED_PREVIOUS_FLOOR &&
    previous[1].supportedCount >= MAIN_SUPPORTED_PREVIOUS_FLOOR;

  if (datesContinuous && countsKnown && mainTodayOk && mainPreviousOk) {
    reasons.push(
      `最近 3 个交易日驱动有依据家数 ${window.map((day) => day.supportedCount).join('/')}，` +
        `满足当日 ≥${MAIN_SUPPORTED_TODAY_FLOOR} 且前两日各 ≥${MAIN_SUPPORTED_PREVIOUS_FLOOR}`,
    );
    if (!countsComplete || todayUnresolved > 0) {
      reasons.push('仍有未决 / 数据缺失成员，覆盖不足（不改变已达成的正面资格）');
    }
    return { kind: 'main', reasons, belowActiveFloor, listed: true };
  }

  // 还不能证明 main：证据不足，或未决成员有可能补足门槛
  const missingData =
    !datesContinuous || !countsKnown || window.some((day) => !day.complete);
  const todayCouldReach =
    todaySupported !== null && todaySupported + todayUnresolved >= MAIN_SUPPORTED_TODAY_FLOOR;

  if (missingData || todayCouldReach) {
    if (
      todaySupported !== null &&
      todaySupported + todayUnresolved >= MAIN_SUPPORTED_TODAY_FLOOR &&
      todaySupported < MAIN_SUPPORTED_TODAY_FLOOR
    ) {
      reasons.push(
        `当日驱动有依据 ${todaySupported} 只 + 未决 ${todayUnresolved} 只可能补足 ≥${MAIN_SUPPORTED_TODAY_FLOOR}，暂不能排除主线`,
      );
    }
    for (const day of previous.slice(0, 2)) {
      if (
        day.supportedCount !== null &&
        day.supportedCount < MAIN_SUPPORTED_PREVIOUS_FLOOR &&
        day.supportedCount + (day.unresolvedCount ?? 0) >= MAIN_SUPPORTED_PREVIOUS_FLOOR
      ) {
        reasons.push(
          `${day.date} 驱动有依据 ${day.supportedCount} 只 + 未决 ${day.unresolvedCount ?? 0} 只` +
            `可能补足 ≥${MAIN_SUPPORTED_PREVIOUS_FLOOR}，暂不能排除主线`,
        );
      }
    }
    if (missingData) reasons.push('历史覆盖或计数缺失，暂不能证明也不能排除主线');
    return { kind: 'pending', reasons, belowActiveFloor, listed };
  }

  if (todaySupported !== null && todaySupported >= BRANCH_SUPPORTED_TODAY_FLOOR) {
    reasons.push(
      `当日驱动有依据 ${todaySupported} 只（≥${BRANCH_SUPPORTED_TODAY_FLOOR}），` +
        `样本足够排除主线要求（当日 ≥${MAIN_SUPPORTED_TODAY_FLOOR} 且前两日各 ≥${MAIN_SUPPORTED_PREVIOUS_FLOOR}）`,
    );
    return { kind: 'branch', reasons, belowActiveFloor, listed: true };
  }

  reasons.push('家数与持续性都不足以给出分支判断');
  return { kind: 'pending', reasons, belowActiveFloor, listed };
};
