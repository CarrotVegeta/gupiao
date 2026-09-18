/**
 * 趋势「形态扫描」。
 *
 * ⚠️ 定位说明（重要，别当成选股信号）：
 * 这套形态（均线多头 + 连续站稳 5 日线 + 缩量 + 距 5 日线绝对偏离 ≤4% + 近期涨幅 ≤20%）
 * 在本项目既有样本里没有表现出收益优势。结论的适用范围受限，见
 * `docs/superpowers/plans/2026-09-17-screener-review-and-redesign.md` §8：
 *
 *   本项目既有样本中，原五条件组合的表现不支持收益优势。该研究存在历史归属和执行口径等限制，
 *   不代表所有趋势方法无效；当前页面用于形态与题材结构观察。
 *
 * 所以这个模块只输出「这些票现在长什么样」，并把命中 / 未命中逐条列出来，不做任何收益承诺。
 *
 * 第一期纠错（实施说明任务6）：
 *   1. 「回调缩量」改名「缩量（最近已完成日成交量/此前5日均量）」——量能比较不判断回调；
 *   2. 只用已完成交易日：最后一根日K的完成状态无法确认时不参与计算，不用本机日期盲猜；
 *   3. 去掉「当日成交额 ≥ 门槛×70%」的前置剔除，近5日均额改成日K算完后的独立门槛；
 *   4. 默认保留 260 只快速上限，但用 coverage / matchedTotal / returnedCount / truncated 如实披露覆盖；
 *      调用方可以用 `scanLimit` 把拉日K的范围放大到 1000 只或全市场（`scanLimit=0` / `all`），
 *      全市场扫描照样按成交额优先排序，扫不完时仍如实披露未扫描数。
 */
import type { QuoteError, TrendFilters, TrendPick, TrendScanResponse } from '../../src/types.js';
import { fetchMarketSnapshot, type BoardMember } from '../themes/eastmoney.js';
import { fetchStockKline, type KlineBar } from '../themes/tenjqka.js';

const KLINE_CONCURRENCY = 6;
/**
 * 大范围扫描（> LARGE_SCAN_THRESHOLD 只）时的并发。
 * 实测 2026-09-18：同花顺个股日K 在 12 并发下 80 只样本无一条因限流失败（失败的都是不存在的代码），
 * 吞吐从 6 并发的约 67 只/秒升到约 134 只/秒，所以全市场份额（约 5900 只）从约 90 秒降到约 45 秒。
 */
const KLINE_CONCURRENCY_LARGE = 12;
const LARGE_SCAN_THRESHOLD = 1000;
/** 默认快速扫描最多拉多少只日K；未扫描的部分在 coverage.unscanned 里披露，不假装全市场扫完 */
export const MAX_SCAN = 260;
/** `scanLimit` 的「不截断」哨兵值：拉完全部候选（全市场份额约 5900 只） */
export const SCAN_ALL = 0;
/** scanLimit 的参数上限，只用来挡住离谱入参，不是业务默认值 */
export const MAX_SCAN_CEILING = 20_000;
/** 单次响应最多返回多少行；被截掉的行数在 matchedTotal - returnedCount 里披露 */
export const MAX_ITEMS = 120;

/** 缩量条件的固定文案：只描述量能比，不再出现「回调」二字 */
const SHRINK_LABEL = '缩量（最近已完成日成交量/此前5日均量）';

const isPositive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
};

export const DEFAULT_FILTERS: TrendFilters = {
  // 2026-09-18：取消「板块范围」筛选，趋势一律全市场扫描。
  // 原因：题材分类的「主线」要求本轮驱动有依据，而一期没有可核查的细分映射，
  // 主线恒为 0 个，导致「仅主线题材」这一档永远是空结果。字段保留只为兼容旧调用方。
  themeScope: 'all',
  maxMa5Dist: 4,
  maxPct: 20,
  pctWindow: 10,
  minStableDays: 3,
  minAmountYi: 5,
  minScore: 5,
  mainOnly: false,
  excludeSt: false,
  // 默认快速扫描（260 只）；改成 0（或查询串 scanLimit=all）就是全市场拉日K
  scanLimit: MAX_SCAN,
};

export const parseTrendFilters = (query: Record<string, unknown>): TrendFilters => {
  const num = (value: unknown, fallback: number): number => {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  };
  const bool = (value: unknown, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    return value === 'true' || value === '1' || value === true;
  };
  /**
   * 拉日K上限：`all` / `0` = 不截断（全市场），正数按只数截断。
   * 默认仍是 260 只快速扫描，不传参数的老调用方行为不变。
   */
  const scanLimit = (value: unknown): number => {
    if (value === 'all' || value === 'ALL') return SCAN_ALL;
    const next = num(value, DEFAULT_FILTERS.scanLimit);
    if (next <= SCAN_ALL) return SCAN_ALL;
    return Math.min(Math.round(next), MAX_SCAN_CEILING);
  };

  return {
    // 不再接受调用方指定的板块范围：趋势一律全市场，忽略 themeScope 参数。
    themeScope: 'all',
    maxMa5Dist: Math.min(Math.max(num(query.maxMa5Dist, DEFAULT_FILTERS.maxMa5Dist), 0), 30),
    maxPct: Math.min(Math.max(num(query.maxPct, DEFAULT_FILTERS.maxPct), 0), 200),
    pctWindow: [5, 10, 20].includes(Number(query.pctWindow))
      ? Number(query.pctWindow)
      : DEFAULT_FILTERS.pctWindow,
    minStableDays: Math.min(Math.max(num(query.minStableDays, DEFAULT_FILTERS.minStableDays), 1), 10),
    minAmountYi: Math.min(Math.max(num(query.minAmountYi, DEFAULT_FILTERS.minAmountYi), 0), 500),
    minScore: Math.min(Math.max(Math.round(num(query.minScore, DEFAULT_FILTERS.minScore)), 1), 5),
    mainOnly: bool(query.mainOnly, DEFAULT_FILTERS.mainOnly),
    excludeSt: bool(query.excludeSt, DEFAULT_FILTERS.excludeSt),
    scanLimit: scanLimit(query.scanLimit),
  };
};

// ---------------------------------------------------------------------------
// v2 覆盖契约（趋势专用类型放在本模块内，src/types.ts 由并行改动负责，不在这里改）
// ---------------------------------------------------------------------------

/** 扫描覆盖：attempted = succeeded + failed；total = attempted + unscanned。只数唯一股票 */
export type TrendScanCoverage = {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unscanned: number;
};

export type TrendPickV2 = TrendPick & {
  /** 这只票参与计算的最近已完成交易日；null 表示没有可用的已完成日K */
  metricsTradeDate: string | null;
  /** 最后一根日K是否已完成；null = 无法确认（已按未完成处理，未参与计算） */
  lastBarCompleted: boolean | null;
  /** 数据说明（例如剔除了未完成日K），不参与 5 个形态条件的命中计数 */
  notes: string[];
};

/**
 * 注意 status 仍只用 `Quote['status']`（fresh / stale / unavailable）：
 * 「部分覆盖」不靠状态字段表达，而是靠 coverage / truncated 如实披露。
 */
export type TrendScanResponseV2 = TrendScanResponse & {
  items: TrendPickV2[];
  coverage: TrendScanCoverage;
  /** 已扫描范围内的匹配数（不是全市场匹配数） */
  matchedTotal: number;
  /** 本次实际返回的行数 */
  returnedCount: number;
  /** 是否没有覆盖全部候选范围（扫描上限或行数上限） */
  truncated: boolean;
  /** 日K截止日：参与计算的最近已完成交易日 */
  metricsTradeDate: string | null;
  /** 报价观察时间：行情快照的抓取时刻（上游 clist 快照不带逐条报价时间） */
  quoteAsOf: string | null;
};

// ---------------------------------------------------------------------------
// 已完成交易日的判定
// ---------------------------------------------------------------------------

export type BarContext = {
  /** 目标交易日 YYYYMMDD（路由已经确定的口径），只用来做「更早的交易日必然已收盘」这一步推断 */
  tradeDate?: string | null;
  /** 上游/调用方明确给出的「最后一根日K已完成」标记；未知就传 null/undefined */
  lastBarCompleted?: boolean | null;
};

type CompletedSeries = {
  bars: KlineBar[];
  lastBarCompleted: boolean | null;
  /** 被剔除的未完成日K日期 */
  excludedDate: string | null;
  note: string | null;
};

/**
 * 挑出可以参与形态计算的日K。
 *
 * 为什么这么保守：上游日K会把当日盘中那根也返回，盘中成交量只有半天。
 * 拿半天量和全天均量比出来的「缩量」是假的，所以完成状态不能确认时宁可少用一天。
 * 这里也不看本机日期——只用调用方给的目标交易日；最后一根就是目标交易日时，
 * 我们无法确认盘中还是盘后，按未完成处理。
 */
export const resolveCompletedBars = (bars: KlineBar[], context: BarContext = {}): CompletedSeries => {
  if (bars.length === 0) {
    return { bars, lastBarCompleted: null, excludedDate: null, note: '没有取得日K数据' };
  }

  const last = bars[bars.length - 1];

  if (context.lastBarCompleted === true) {
    return { bars, lastBarCompleted: true, excludedDate: null, note: null };
  }

  if (context.lastBarCompleted === false) {
    return {
      bars: bars.slice(0, -1),
      lastBarCompleted: false,
      excludedDate: last.date,
      note: `最后一根日K（${last.date}）未完成，不参与形态计算`,
    };
  }

  const tradeDate = context.tradeDate ?? null;
  if (tradeDate !== null && last.date < tradeDate) {
    // 最后一根严格早于目标交易日 ⇒ 它所属的交易日已经收盘
    return { bars, lastBarCompleted: true, excludedDate: null, note: null };
  }

  return {
    bars: bars.slice(0, -1),
    lastBarCompleted: null,
    excludedDate: last.date,
    note: `最后一根日K（${last.date}）完成状态无法确认（缺少可信交易日历/完成标记），未参与形态计算`,
  };
};

// ---------------------------------------------------------------------------
// 形态计算
// ---------------------------------------------------------------------------

export type ScanEvaluation = {
  matched: string[];
  unmatched: string[];
  /** 数据说明（不参与评分） */
  notes: string[];
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  distMa5: number | null;
  stableDays: number | null;
  shrink: number | null;
  pctWindow: number | null;
  avgAmount5d: number | null;
  /** 命中条数（只看 5 个核心条件） */
  score: number;
  /** 参与计算的最近已完成交易日 */
  metricsTradeDate: string;
  lastBarCompleted: boolean | null;
  /** 近5日均额是否达到门槛（独立门槛，不算 5 个形态条件之一） */
  amountOk: boolean;
};

const signedPercent = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const evaluateScanPattern = (
  bars: KlineBar[],
  filters: TrendFilters,
  context: BarContext = {},
): ScanEvaluation | null => {
  const window = filters.pctWindow;
  const resolved = resolveCompletedBars(bars, context);
  const series = resolved.bars;

  // 所有指标都只用已完成交易日，且至少够 20 日线与涨幅窗口
  if (series.length < Math.max(20, window + 1, 21)) return null;

  const closes = series.map((bar) => bar.close);
  const volumes = series.map((bar) => bar.volume);
  const last = closes.length - 1;
  const metricsTradeDate = series[last].date;

  const ma5 = mean(closes.slice(-5));
  const ma10 = mean(closes.slice(-10));
  const ma20 = mean(closes.slice(-20));

  const matched: string[] = [];
  const unmatched: string[] = [];
  const notes = resolved.note === null ? [] : [resolved.note];

  const maBull = ma5 > ma10 && ma10 > ma20;
  (maBull ? matched : unmatched).push(
    maBull ? '5/10/20 日线多头排列' : '未形成 5>10>20 多头排列',
  );

  let stableDays = 0;
  for (let index = last; index >= 4; index -= 1) {
    const value = mean(closes.slice(index - 4, index + 1));
    if (closes[index] >= value) stableDays += 1;
    else break;
  }
  const stableOk = stableDays >= filters.minStableDays;
  (stableOk ? matched : unmatched).push(
    stableOk
      ? `连续 ${stableDays} 日站稳 5 日线`
      : `仅连续 ${stableDays} 日站稳 5 日线（要求 ≥${filters.minStableDays}）`,
  );

  // 缩量：最近已完成日成交量 / 此前 5 日均量。只比较量能，不判断是不是「回调」
  const previous5 = volumes.slice(-6, -1);
  const avgPrevious5 = previous5.length === 5 ? mean(previous5) : null;
  const shrink = isPositive(avgPrevious5) ? volumes[last] / avgPrevious5 : null;
  const shrinkOk = shrink !== null && shrink < 1;
  (shrinkOk ? matched : unmatched).push(
    shrink === null
      ? `${SHRINK_LABEL}无法计算（缺少已完成日成交量或此前 5 日均量）`
      : shrinkOk
        ? `${SHRINK_LABEL}：${shrink.toFixed(2)}（最近已完成日 ${metricsTradeDate}）`
        : `未缩量（最近已完成日成交量/此前5日均量）：${shrink.toFixed(2)}（要求 <1，最近已完成日 ${metricsTradeDate}）`,
  );

  // 绝对距离规则保留，但结果给有向值，界面上明示「绝对偏离」
  const distMa5 = ma5 > 0 ? (closes[last] / ma5 - 1) * 100 : null;
  const distOk = distMa5 !== null && Math.abs(distMa5) <= filters.maxMa5Dist;
  (distOk ? matched : unmatched).push(
    distMa5 === null
      ? '距 5 日线绝对偏离无法计算'
      : distOk
        ? `距 5 日线 ${signedPercent(distMa5)}（绝对偏离 ≤${filters.maxMa5Dist}%）`
        : `距 5 日线 ${signedPercent(distMa5)}（绝对偏离 >${filters.maxMa5Dist}%）`,
  );

  const base = closes[last - window];
  const pctWindow = isPositive(base) ? (closes[last] / base - 1) * 100 : null;
  const pctOk = pctWindow !== null && pctWindow <= filters.maxPct;
  (pctOk ? matched : unmatched).push(
    pctWindow === null
      ? `近 ${window} 日涨幅无法计算`
      : pctOk
        ? `近 ${window} 日涨幅 ${pctWindow.toFixed(1)}%`
        : `近 ${window} 日涨幅 ${pctWindow.toFixed(1)}%（要求 ≤${filters.maxPct}%）`,
  );

  // 近5日均额：日K算完之后的独立门槛，不再用当日成交额做前置剔除
  const amounts = series
    .slice(-5)
    .map((bar) => bar.amount)
    .filter((value): value is number => value !== null && value > 0);
  const avgAmount5d = amounts.length === 5 ? mean(amounts) : null;

  return {
    matched,
    unmatched,
    notes,
    ma5: round(ma5, 2),
    ma10: round(ma10, 2),
    ma20: round(ma20, 2),
    distMa5: distMa5 === null ? null : round(distMa5),
    stableDays,
    shrink: shrink === null ? null : round(shrink, 4),
    pctWindow: pctWindow === null ? null : round(pctWindow),
    avgAmount5d: avgAmount5d === null ? null : round(avgAmount5d, 0),
    score: matched.length,
    metricsTradeDate,
    lastBarCompleted: resolved.lastBarCompleted,
    amountOk: avgAmount5d !== null && avgAmount5d >= filters.minAmountYi * 1e8,
  };
};

// ---------------------------------------------------------------------------
// 候选收集
// ---------------------------------------------------------------------------

type Candidate = {
  symbol: string;
  name: string;
  member: BoardMember;
  themes: Array<{ code: string; name: string }>;
  /** 所属行业板块（上游 clist 的 f100）；拿不到为 null */
  industry: string | null;
};

type CandidateCollection = {
  /** 已按快速上限截断、准备拉日K的候选 */
  candidates: Candidate[];
  /** 预筛后的唯一股票总数（截断前） */
  total: number;
  errors: QuoteError[];
  /** 行情快照的观察时间；没有取到成员时为 null */
  quoteAsOf: string | null;
};

const collectCandidates = async (
  tradeDate: string,
  filters: TrendFilters,
  fetchImpl: typeof fetch,
): Promise<CandidateCollection> => {
  void tradeDate;
  const errors: QuoteError[] = [];
  const seen = new Map<string, Candidate>();

  // 全市场口径：只按下面几条范围条件过滤（主板 / ST），不再按题材范围预筛成员。
  const members = await fetchMarketSnapshot(fetchImpl);
  for (const member of members) {
    seen.set(member.symbol, {
      symbol: member.symbol,
      name: member.name,
      member,
      themes: [],
      industry: member.industry,
    });
  }

  // 上游 clist 快照不带逐条报价时间，抓取时刻就是这份快照的观察时间
  const quoteAsOf = seen.size > 0 ? new Date().toISOString() : null;

  const candidates: Candidate[] = [];
  for (const candidate of seen.values()) {
    if (filters.mainOnly && !(candidate.symbol.startsWith('60') || candidate.symbol.startsWith('00'))) {
      continue;
    }
    if (filters.excludeSt && /ST/i.test(candidate.name)) continue;
    // 注意：这里不再按当日成交额剔除。近5日均额是否达标是日K算完后的独立门槛，
    // 用当日成交额（尤其盘中）预筛会把「5日均额达标但今天量小」的票整只删掉。
    candidates.push(candidate);
  }

  const total = candidates.length;
  // 按当日成交额优先取前 scanLimit 只拉日K。这只是排序优先级，不是门槛，
  // 被截掉的数量在 coverage.unscanned 里如实披露；scanLimit = 0 表示全市场不截断。
  candidates.sort((a, b) => (b.member.amount ?? 0) - (a.member.amount ?? 0));
  const limit =
    filters.scanLimit > SCAN_ALL
      ? Math.min(filters.scanLimit, MAX_SCAN_CEILING)
      : candidates.length;
  return { candidates: candidates.slice(0, limit), total, errors, quoteAsOf };
};

// ---------------------------------------------------------------------------
// 扫描入口
// ---------------------------------------------------------------------------

const emptyCoverage: TrendScanCoverage = {
  total: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
  unscanned: 0,
};

export const scanTrend = async (
  tradeDate: string,
  filters: TrendFilters,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendScanResponseV2> => {
  const fetchedAt = new Date().toISOString();

  try {
    const { candidates, total, errors, quoteAsOf } = await collectCandidates(
      tradeDate,
      filters,
      fetchImpl,
    );

    const concurrency =
      candidates.length > LARGE_SCAN_THRESHOLD ? KLINE_CONCURRENCY_LARGE : KLINE_CONCURRENCY;
    const evaluated = await mapLimit(candidates, concurrency, async (candidate) => {
      const bars = await fetchStockKline(candidate.symbol, fetchImpl);
      const evaluation = evaluateScanPattern(bars, filters, { tradeDate });
      return evaluation === null ? null : { candidate, evaluation };
    });

    // succeeded 指日K取到并能算出指标的数量（与是否命中条件无关），failed 才算数据失败
    let succeeded = 0;
    let metricsTradeDate: string | null = null;
    const picks: TrendPickV2[] = [];

    for (const entry of evaluated) {
      if (entry === null) continue;
      succeeded += 1;
      const { candidate, evaluation } = entry;
      if (metricsTradeDate === null || evaluation.metricsTradeDate > metricsTradeDate) {
        metricsTradeDate = evaluation.metricsTradeDate;
      }
      if (evaluation.score < filters.minScore) continue;
      if (!evaluation.amountOk) continue;

      picks.push({
        symbol: candidate.symbol,
        name: candidate.name,
        themes: candidate.themes,
        industry: candidate.industry,
        price: candidate.member.price,
        pct: candidate.member.pct,
        ma5: evaluation.ma5,
        ma10: evaluation.ma10,
        ma20: evaluation.ma20,
        distMa5: evaluation.distMa5,
        stableDays: evaluation.stableDays,
        shrink: evaluation.shrink,
        pctWindow: evaluation.pctWindow,
        avgAmount5d: evaluation.avgAmount5d,
        turnoverRate: candidate.member.turnoverRate,
        matched: evaluation.matched,
        unmatched: evaluation.unmatched,
        metricsTradeDate: evaluation.metricsTradeDate,
        lastBarCompleted: evaluation.lastBarCompleted,
        notes: evaluation.notes,
      });
    }

    const items = picks
      .slice()
      // 全市场口径下没有题材归属可比较，只按 5 日均额降序（与旧口径的次级排序项一致）
      .sort((a, b) => (b.avgAmount5d ?? 0) - (a.avgAmount5d ?? 0))
      .slice(0, MAX_ITEMS);

    const coverage: TrendScanCoverage = {
      total,
      attempted: candidates.length,
      succeeded,
      failed: candidates.length - succeeded,
      unscanned: Math.max(total - candidates.length, 0),
    };

    return {
      tradeDate,
      items,
      scanned: candidates.length,
      candidates: total,
      filters,
      fetchedAt,
      // 全市场口径只用东财行情快照
      source: 'eastmoney',
      status: 'fresh',
      error: errors.length > 0 ? (errors[0].message ?? null) : null,
      coverage,
      matchedTotal: picks.length,
      returnedCount: items.length,
      // 截断包括两种情况：候选超出 260 只快速上限，或命中行数超出 120 行显示上限
      truncated: coverage.unscanned > 0 || picks.length > items.length,
      metricsTradeDate,
      quoteAsOf,
    };
  } catch (error) {
    return {
      tradeDate,
      items: [],
      scanned: 0,
      candidates: 0,
      filters,
      fetchedAt,
      // 失败时也保持与实际口径一致的来源声明（全市场只用东财快照）
      source: 'eastmoney',
      status: 'unavailable',
      error: error instanceof Error ? error.message : '形态扫描失败',
      coverage: { ...emptyCoverage },
      matchedTotal: 0,
      returnedCount: 0,
      truncated: false,
      metricsTradeDate: null,
      quoteAsOf: null,
    };
  }
};
