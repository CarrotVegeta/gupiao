/**
 * 细分逻辑题材（topic）：**以涨停原因标签为题材单位**，替代「东财宽概念板块」当题材。
 *
 * 为什么换：
 *   宽概念的家数 = 子题材并集。2026-09-18 实测「半导体概念 11 家」里，国产芯片 8、
 *   存储芯片 5、先进封装 4、汽车芯片 2——11 家不是 11 只票在炒同一个东西，而是更细的
 *   题材加起来的总数；而当天「华为概念 13 家」的涨停原因分别是 800G交换机 / 液冷服务器 /
 *   清洁机器人 / AI安全 / 抗量子密码…，彼此无关。按板块家数排名必然选出这种凑数的宽概念。
 *
 * 口径：
 *   - 题材 = 归一化后的涨停原因标签（同一只票同一标签只算一次），家数 ≥2 才成题；
 *   - **不做同族合并**：合并会把「清洁机器人 + 机器人结构件 + 环卫机器人」凑成
 *     「机器人 6 家」，等于在标签层再造一次宽概念；
 *   - 通用词（业绩 / 定增 / 回购 / 控制权变更…）不算题材，见 `GENERIC_TOPIC_WORDS`；
 *   - 持续性用**各交易日自己的涨停原因**算，不再用「当前成分股回算历史」，
 *     所以没有板块口径的前视偏差；
 *   - 主线 = 当日 ≥`MAIN_TOPIC_FLOOR` 且前两日各 ≥2；支线 = 当日 ≥2。
 *
 * 成交额 / 板块涨幅这类依赖板块日K的指标在题材口径下没有来源，一律按「不可用」披露，
 * 不用别的数字顶替。
 */
import type {
  QuoteError,
  ScreenerDataStatus,
  ThemeDetailResponseV2,
  ThemeItem,
  ThemeMetric,
  ThemesResponse,
  ThemeStockV2,
} from '../../src/types.js';
import { normalizeTopicText } from './topicAliases.js';
import { fetchLimitUpPool, type LimitUpPoolRow } from './tenjqka.js';
import { fetchTradeDatesUpTo } from './service.js';

/** 主线资格：当日成题家数下限 */
export const MAIN_TOPIC_FLOOR = 5;
/** 主线资格：前两个有效交易日各自的家数下限 */
export const MAIN_TOPIC_PREVIOUS_FLOOR = 2;
/** 成题下限：少于这个家数不成题材（1 家只是个股故事） */
export const TOPIC_MIN_COUNT = 2;
/** 历史窗口（含当日） */
export const TOPIC_HISTORY_DAYS = 3;

/**
 * 非题材的「通用词」：业绩 / 资金 / 公司行为 / 泛指。
 * 用子串包含判定，所以表里的词要写得足够具体（例如用「增持」而不是「持」）。
 */
export const GENERIC_TOPIC_WORDS: string[] = [
  // 业绩口径
  '业绩', '增长', '扭亏', '预增', '预减', '减亏', '收窄', '扣非', '净利', '营收',
  '半年报', '中报', '年报', '季报', '高增', '改善', '暴增',
  // 资金与股东行为
  '回购', '增持', '减持', '股权激励', '员工持股', '举牌', '解禁', '质押', '分红',
  '定增', '可转债', '转债', '配股', '募投', '募资',
  // 公司行为 / 事件
  '控制权', '控股股东', '实控人', '股权转让', '协议转让', '溢价转让', '股权收购',
  '资产收购', '资产重组', '资产剥离', '重大重组', '并购重组', '重组', '重整',
  '摘帽', '风险澄清', '异常波动', '复牌', '停牌', '上市', '拟收购', '拟投资',
  '拟购', '拟参投', '战略入股', '参股', '增资', '设立', '成立', '产业基金',
  '项目投资', '投资', '合作', '签约', '中标', '订单', '产能', '扩产', '投产',
  '量产', '销量', '产量', '价格', '涨价', '提价', '降价',
  // 泛指 / 统计属性
  '次新', '题材股', '趋势股', '高送转', '预盈', '预亏', '指数', '板块',
];

const isGenericTopic = (tag: string): boolean =>
  GENERIC_TOPIC_WORDS.some((word) => tag.includes(word));

export type TopicMember = {
  symbol: string;
  name: string;
  boardCount: number | null;
  highLabel: string | null;
  firstSealTime: string | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  sealAmount: number | null;
  pct: number | null;
  /** 原始涨停原因标签（该票在该题材下的写法，可能多个） */
  tags: string[];
};

export type TopicDayCount = {
  date: string;
  /** 当日带该逻辑的涨停股数；数据取不到时为 null（不补 0） */
  count: number | null;
};

export type TopicAggregate = {
  /** 归一化后的题材键 */
  key: string;
  /** 展示名：样本里出现次数最多的原始写法 */
  name: string;
  /** 原始写法变体 */
  variants: string[];
  todayCount: number;
  members: TopicMember[];
  days: TopicDayCount[];
  durationDays: number;
  continuousCount: number;
  maxBoard: number | null;
  avgPct: number | null;
};

export type TopicDay = {
  date: string;
  rows: LimitUpPoolRow[];
  error: QuoteError | null;
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** 连续（含当日）满足「每日家数 ≥2」的交易日数 */
export const computeTopicDuration = (counts: Array<number | null>): number => {
  if (counts.length === 0 || (counts[0] ?? 0) < TOPIC_MIN_COUNT) return 0;
  let days = 1;
  for (let index = 1; index < counts.length; index += 1) {
    if ((counts[index] ?? 0) >= TOPIC_MIN_COUNT) days += 1;
    else break;
  }
  return days;
};

/**
 * 把若干交易日的涨停池聚合成题材。`days[0]` 必须是最新交易日。
 * 同一天同一标签，同一只票只计一次。
 */
export const aggregateTopics = (days: TopicDay[]): TopicAggregate[] => {
  const buckets = new Map<
    string,
    { variants: Map<string, number>; members: TopicMember[]; perDay: Array<{ date: string; symbols: Set<string> }> }
  >();

  days.forEach((day, dayIndex) => {
    if (day.error) return;
    for (const row of day.rows) {
      const seenTags = new Set<string>();
      for (const raw of row.reasonTags) {
        const key = normalizeTopicText(raw);
        if (key.length < 2 || isGenericTopic(key) || seenTags.has(key)) continue;
        seenTags.add(key);
        const bucket =
          buckets.get(key) ??
          { variants: new Map<string, number>(), members: [], perDay: days.map((item) => ({ date: item.date, symbols: new Set<string>() })) };
        bucket.variants.set(raw.trim(), (bucket.variants.get(raw.trim()) ?? 0) + 1);
        bucket.perDay[dayIndex].symbols.add(row.symbol);
        if (dayIndex === 0) {
          bucket.members.push({
            symbol: row.symbol,
            name: row.name,
            boardCount: row.boardCount,
            highLabel: row.highLabel,
            firstSealTime: row.firstSealTime,
            turnoverRate: row.turnoverRate,
            floatMarketCap: row.floatMarketCap,
            sealAmount: row.sealAmount,
            pct: row.pct,
            tags: row.reasonTags.map((tag) => tag.trim()).filter(Boolean),
          });
        }
        buckets.set(key, bucket);
      }
    }
  });

  const topics: TopicAggregate[] = [];
  for (const [key, bucket] of buckets) {
    const counts = bucket.perDay.map((item, index) =>
      days[index].error ? null : item.symbols.size,
    );
    const todayCount = counts[0] ?? 0;
    if (todayCount < TOPIC_MIN_COUNT) continue;
    const variants = [...bucket.variants.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const boards = bucket.members.map((member) => member.boardCount ?? 1);
    topics.push({
      key,
      name: variants[0] ?? key,
      variants,
      todayCount,
      members: bucket.members,
      days: bucket.perDay.map((item, index) => ({ date: item.date, count: counts[index] })),
      durationDays: computeTopicDuration(counts),
      continuousCount: boards.filter((count) => count >= 2).length,
      maxBoard: boards.length > 0 ? Math.max(...boards) : null,
      avgPct: mean(bucket.members.map((member) => member.pct).filter((value): value is number => value !== null)),
    });
  }

  topics.sort((a, b) => b.todayCount - a.todayCount || b.durationDays - a.durationDays || a.key.localeCompare(b.key));
  return topics;
};

export type TopicClassification = {
  kind: 'main' | 'branch';
  reasons: string[];
};

/** 题材分类：当日 ≥5 且前两日各 ≥2 → 主线；否则家数 ≥2 → 支线 */
export const classifyTopic = (topic: TopicAggregate): TopicClassification => {
  const [today, ...previous] = topic.days;
  const reasons: string[] = [];
  const todayCount = today?.count ?? 0;
  const history = previous.slice(0, 2);
  const historyKnown = history.length === 2 && history.every((day) => day.count !== null);
  const mainOk =
    historyKnown &&
    todayCount >= MAIN_TOPIC_FLOOR &&
    history.every((day) => (day.count ?? 0) >= MAIN_TOPIC_PREVIOUS_FLOOR);

  reasons.push(
    `最近 ${topic.days.length} 个交易日带同一涨停逻辑的家数 ` +
      `${topic.days.map((day) => day.count ?? '缺失').join('/')}`,
  );

  if (mainOk) {
    reasons.push(
      `满足当日 ≥${MAIN_TOPIC_FLOOR} 且前两日各 ≥${MAIN_TOPIC_PREVIOUS_FLOOR}，判主线`,
    );
    return { kind: 'main', reasons };
  }

  if (!historyKnown) {
    reasons.push('历史家数有缺口，按支线展示（不足以证明主线）');
  } else if (todayCount < MAIN_TOPIC_FLOOR) {
    reasons.push(`当日 ${todayCount} 家，不足主线门槛 ≥${MAIN_TOPIC_FLOOR}`);
  } else {
    reasons.push(`前两日家数未达各 ≥${MAIN_TOPIC_PREVIOUS_FLOOR}，不足以证明持续性`);
  }
  return { kind: 'branch', reasons };
};

/** 龙头：最高板，同高度取首封更早 */
export const pickTopicLeader = (members: TopicMember[]): TopicMember | null => {
  let best: TopicMember | null = null;
  for (const member of members) {
    const count = member.boardCount ?? 1;
    if (best === null) {
      best = member;
      continue;
    }
    const bestCount = best.boardCount ?? 1;
    if (count > bestCount) {
      best = member;
      continue;
    }
    if (count === bestCount) {
      const bestTime = best.firstSealTime ?? '99:99:99';
      const time = member.firstSealTime ?? '99:99:99';
      if (time < bestTime) best = member;
    }
  }
  return best;
};

const metric = (
  key: ThemeMetric['key'],
  label: string,
  hit: boolean,
  value: string,
  detail: string,
): ThemeMetric => ({ key, label, hit, value, detail });

/**
 * 题材口径的指标：只保留涨停池能支撑的项；依赖板块日K的（成交额 / 市场影响力）
 * 与「催化强度」（题材本身就是催化）明确标「题材口径下不适用」，不拿别的数字顶。
 */
export const buildTopicMetrics = (topic: TopicAggregate): ThemeMetric[] => {
  const firstBoard = topic.members.filter((member) => (member.boardCount ?? 1) === 1).length;
  return [
    metric(
      'duration',
      '持续时间',
      topic.durationDays >= 3,
      `${topic.durationDays} 天`,
      `连续 ${topic.durationDays} 个交易日带该逻辑的涨停 ≥${TOPIC_MIN_COUNT}（要求 ≥3 天）`,
    ),
    metric(
      'limitUpCount',
      '涨停家数',
      topic.todayCount >= MAIN_TOPIC_FLOOR,
      `${topic.todayCount} 只`,
      `当日 ${topic.todayCount} 只涨停的涨停原因含「${topic.name}」（主线要求 ≥${MAIN_TOPIC_FLOOR}）`,
    ),
    metric(
      'ladder',
      '连板梯队',
      topic.maxBoard !== null && topic.maxBoard >= 3 && topic.continuousCount >= 2 && firstBoard >= 2,
      `最高 ${topic.maxBoard ?? '—'} 板 / 连板 ${topic.continuousCount} 只 / 首板 ${firstBoard} 只`,
      '要求最高板 ≥3、连板 ≥2 只、首板 ≥2 只（梯队完整）',
    ),
    metric(
      'catalyst',
      '催化强度',
      true,
      topic.variants.slice(0, 3).join(' / '),
      '题材口径下，题材本身就是本轮涨停原因，不再另做关键词分类',
    ),
    metric(
      'leader',
      '龙头表现',
      topic.maxBoard !== null && topic.maxBoard >= 3,
      (() => {
        const leader = pickTopicLeader(topic.members);
        return leader ? `${leader.name}${leader.highLabel ? ` · ${leader.highLabel}` : ''}` : '—';
      })(),
      `题材内最高板 ${topic.maxBoard ?? '—'}（要求 ≥3 板）`,
    ),
    metric(
      'amount',
      '成交额',
      false,
      '—',
      '题材口径下没有板块成交额来源（成分股成交额未接入），不做判断',
    ),
    metric(
      'influence',
      '市场影响力',
      false,
      '—',
      '题材口径下没有板块成交额 / 指数超额来源，不做判断',
    ),
    metric(
      'revival',
      '回流能力',
      (() => {
        const counts = topic.days.map((day) => day.count ?? 0);
        const window = counts.slice(0, 6);
        for (let index = 1; index < window.length - 1; index += 1) {
          const current = window[index];
          const previous = window[index + 1];
          if (previous < TOPIC_MIN_COUNT) continue;
          if (current > previous * 0.5) continue;
          if (Math.max(...window.slice(0, index)) >= Math.max(current, 1) * 1.5) return true;
        }
        return false;
      })(),
      '近 5 日内出现「家数环比腰斩」后是否回升到 1.5 倍以上',
      '按各日涨停原因统计的家数比较（口径与板块一致，样本更短）',
    ),
  ];
};

export const toTopicItem = (topic: TopicAggregate): ThemeItem => {
  const classification = classifyTopic(topic);
  const metrics = buildTopicMetrics(topic);
  const leader = pickTopicLeader(topic.members);
  return {
    code: `TP:${topic.key}`,
    name: topic.name,
    kind: classification.kind,
    pct: topic.avgPct === null ? null : Number(topic.avgPct.toFixed(2)),
    limitUpCount: topic.todayCount,
    continuousCount: topic.continuousCount,
    maxBoard: topic.maxBoard,
    maxBoardLabel: topic.maxBoard === null ? null : `${topic.maxBoard} 板`,
    durationDays: topic.durationDays,
    amount: null,
    amountRatio: null,
    catalysts: topic.variants,
    leader: leader
      ? {
          symbol: leader.symbol,
          name: leader.name,
          boardCount: leader.boardCount,
          highLabel: leader.highLabel,
        }
      : null,
    metrics,
    score: metrics.filter((item) => item.hit).length,
    classificationReasons: classification.reasons,
    conceptLimitUpCount: topic.todayCount,
    supportedLimitUpCount: null,
    unresolvedLimitUpCount: null,
    source: 'topic',
  };
};

// ---------------------------------------------------------------------------
// 编排：题材总览 / 题材详情
// ---------------------------------------------------------------------------

/** 规则版本：缓存键与前端展示都要带上它 */
export const TOPIC_RULE_VERSION = 'topic-v1';

const CACHE_TTL_MS = 5 * 60 * 1000;
const topicCache = new Map<string, { value: ThemesResponse; expiresAt: number }>();
const topicDetailCache = new Map<string, { value: ThemeDetailResponseV2; expiresAt: number }>();

export const clearTopicCache = (): void => {
  topicCache.clear();
  topicDetailCache.clear();
};

const emptyTopics = (tradeDate: string, error: string | null): ThemesResponse => ({
  schemaVersion: 2,
  scope: 'topic',
  tradeDate,
  main: [],
  branch: [],
  pending: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney+10jqka',
  status: error === null ? 'fresh' : 'unavailable',
  warnings: [],
  error,
});

/**
 * 取观察窗口的涨停池（新到旧）。今天的池在开盘前是空的，退回到最近有数据的交易日，
 * 和板块口径一样用 warnings 说明，不假装今天已有数据。
 */
export const loadTopicDays = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ days: TopicDay[]; poolDate: string; warnings: string[]; errors: QuoteError[] }> => {
  const warnings: string[] = [];
  const errors: QuoteError[] = [];
  const window = await fetchTradeDatesUpTo(tradeDate, TOPIC_HISTORY_DAYS, fetchImpl);
  const dates = window.length > 0 ? window : [tradeDate];

  const pools = await Promise.all(dates.map((date) => fetchLimitUpPool(date, fetchImpl)));
  const byDate = new Map(dates.map((date, index) => [date, pools[index]]));

  // 观察日：从最新往回找第一个有涨停数据的交易日
  const poolDate = [...dates].reverse().find((date) => (byDate.get(date)?.rows.length ?? 0) > 0) ?? tradeDate;
  if (poolDate !== tradeDate) {
    warnings.push(
      `请求交易日 ${tradeDate} 的涨停池尚未产生，本次按最近有数据的交易日 ${poolDate} 观察`,
    );
  }

  // 以观察日为最新，往前取 TOPIC_HISTORY_DAYS 天（新到旧）
  const ordered = dates.filter((date) => date <= poolDate).slice(-TOPIC_HISTORY_DAYS).reverse();
  const days: TopicDay[] = ordered.map((date) => {
    const pool = byDate.get(date);
    if (!pool) return { date, rows: [], error: { symbol: date, message: '涨停池未取到' } };
    if (pool.error) {
      errors.push(pool.error);
    }
    return { date, rows: pool.rows, error: pool.error };
  });

  return { days, poolDate, warnings, errors };
};

export const buildTopics = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemesResponse> => {
  const cacheKey = `${TOPIC_RULE_VERSION}|${tradeDate}`;
  const cached = topicCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const { days, poolDate, warnings, errors } = await loadTopicDays(tradeDate, fetchImpl);
    const topics = aggregateTopics(days);
    const main: ThemeItem[] = [];
    const branch: ThemeItem[] = [];
    for (const topic of topics) {
      const item = toTopicItem(topic);
      if (item.kind === 'main') main.push(item);
      else branch.push(item);
    }

    const failedDays = days.filter((day) => day.error).length;
    if (failedDays > 0) {
      warnings.push(`有 ${failedDays} 个交易日的涨停池未取到，这些天的家数显示为「缺失」而不是 0`);
    }
    if (topics.length === 0) {
      warnings.push('当日没有 ≥2 家涨停股共享同一涨停逻辑，即没有成型的细分题材');
    }
    warnings.push(
      `题材口径：细分逻辑 = 涨停原因标签（已剔除业绩 / 定增 / 回购这类通用词），` +
        `家数 ≥${TOPIC_MIN_COUNT} 才成题；主线要求当日 ≥${MAIN_TOPIC_FLOOR} 且前两日各 ≥${MAIN_TOPIC_PREVIOUS_FLOOR}`,
    );
    warnings.push(
      '持续性按各交易日**当日**的涨停原因统计（不用当前成分股回算历史），没有板块口径的前视偏差',
    );

    const status: ScreenerDataStatus =
      topics.length === 0 && errors.length > 0 ? 'unavailable' : errors.length > 0 ? 'partial' : 'fresh';

    const body: ThemesResponse = {
      schemaVersion: 2,
      scope: 'topic',
      tradeDate: poolDate,
      main,
      branch,
      pending: [],
      fetchedAt: new Date().toISOString(),
      source: 'eastmoney+10jqka',
      status,
      warnings,
      error: errors.length > 0 ? (errors[0].message ?? null) : null,
    };
    if (status !== 'unavailable') {
      topicCache.set(cacheKey, { value: body, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return body;
  } catch (error) {
    return {
      ...emptyTopics(tradeDate, error instanceof Error ? error.message : '题材数据构建失败'),
      error: error instanceof Error ? error.message : '题材数据构建失败',
    };
  }
};

/** 题材详情：成员就是当日带该逻辑的涨停股；K线 / 角色 / 风险核验尚未接入，按缺失披露 */
export const buildTopicDetail = async (
  topicCode: string,
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemeDetailResponseV2> => {
  const cacheKey = `${TOPIC_RULE_VERSION}|${tradeDate}|${topicCode}`;
  const cached = topicDetailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const blank = (error: string | null): ThemeDetailResponseV2 => ({
    schemaVersion: 2,
    ruleVersion: TOPIC_RULE_VERSION,
    tradeDate: null,
    asOf: new Date().toISOString(),
    theme: null,
    items: [],
    evidence: [],
    coverage: { total: 0, attempted: 0, succeeded: 0, failed: 0, unscanned: 0 },
    status: 'unavailable',
    warnings: [],
    error,
  });

  const key = topicCode.startsWith('TP:') ? topicCode.slice(3) : topicCode;
  try {
    const { days, poolDate } = await loadTopicDays(tradeDate, fetchImpl);
    const topic = aggregateTopics(days).find((item) => item.key === key);
    if (!topic) {
      return { ...blank(`题材「${key}」在 ${poolDate} 没有 ≥${TOPIC_MIN_COUNT} 家的涨停成员`), tradeDate: poolDate };
    }

    const classification = classifyTopic(topic);
    const items: ThemeStockV2[] = topic.members
      .slice()
      .sort((a, b) => (b.boardCount ?? 1) - (a.boardCount ?? 1) || (a.firstSealTime ?? '99:99:99').localeCompare(b.firstSealTime ?? '99:99:99'))
      .map((member) => ({
        symbol: member.symbol,
        name: member.name,
        price: null,
        pct: member.pct,
        boardCount: member.boardCount,
        firstSealTime: member.firstSealTime,
        sealType: null,
        openCount: null,
        sealAmount: member.sealAmount,
        turnoverRate: member.turnoverRate,
        amount: null,
        avgAmount3d: null,
        avgAmount5d: null,
        floatMarketCap: member.floatMarketCap,
        reason: member.tags.join(' + '),
        precise: null,
        hits: [],
        misses: [],
        risks: [],
        ma5: null,
        ma10: null,
        ma20: null,
        maBull: null,
        distMa5: null,
        distMa10: null,
        stableDays10: null,
        pct10: null,
        pct20: null,
        limitUpIn60d: null,
        quoteAsOf: null,
        // 题材口径下「本轮关联」由涨停原因直接给出，不需要二次判定
        relation: {
          state: 'supported',
          evidenceIds: [],
          reasons: [`涨停原因含「${topic.name}」`],
          alternativeThemeCodes: [],
          topicKeys: [topic.key],
          asOf: new Date().toISOString(),
        },
        roles: [],
        checks: {},
        metricsState: 'missing',
        metricsTradeDate: null,
        risksChecked: false,
      }));

    const body: ThemeDetailResponseV2 = {
      schemaVersion: 2,
      ruleVersion: TOPIC_RULE_VERSION,
      tradeDate: poolDate,
      asOf: new Date().toISOString(),
      theme: { code: `TP:${topic.key}`, name: topic.name },
      items,
      evidence: [],
      coverage: {
        total: topic.todayCount,
        attempted: topic.todayCount,
        succeeded: topic.todayCount,
        failed: 0,
        unscanned: 0,
      },
      status: 'fresh',
      warnings: [
        `分类：${classification.kind === 'main' ? '主线' : '支线'}`,
        ...classification.reasons.map((reason) => `分类依据：${reason}`),
        '题材口径：成员 = 当日涨停原因含该逻辑的股票；K线形态 / 角色标签 / 风险核验尚未接入，显示为缺失',
        topic.variants.length > 1 ? `同一逻辑的写法：${topic.variants.join(' / ')}` : '',
      ].filter((line) => line.length > 0),
      error: null,
    };
    topicDetailCache.set(cacheKey, { value: body, expiresAt: Date.now() + CACHE_TTL_MS });
    return body;
  } catch (error) {
    return blank(error instanceof Error ? error.message : '题材详情构建失败');
  }
};
