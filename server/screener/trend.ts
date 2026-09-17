/**
 * 趋势「形态扫描」。
 *
 * ⚠️ 定位说明（重要，别当成选股信号）：
 * 这套形态（均线多头 + 连续站稳 5 日线 + 回调缩量 + 距 5 日线 ≤4% + 近期涨幅 ≤20%）
 * 已经被本项目回测否定，而且方向是反的。见
 * `docs/superpowers/specs/2026-09-17-stock-screener-design.md` §2.4，
 * 复现脚本 `scripts/screener-trend-backtest.ts`：
 *
 *   全市场命中形态     次日开盘 −0.141%（t=−2.56）  T+10 −1.440%（t=−3.28）
 *   主线板块 ∩ 形态    次日开盘 −0.162%（t=−2.60）  T+10 −1.788%（t=−3.73）
 *   配对检验（加主线过滤）  T+1 −0.173%（t=−2.53）
 *   归因：只加「MA5>MA10>MA20」这一步，主线池 T+10 超额从 +0.084% 崩到 −2.426%
 *
 * 所以这个模块只输出「这些票现在长这样」，并把命中 / 未命中逐条列出来，
 * 不做任何收益承诺。前端会把上面的结论固定显示在页头。
 */
import type { QuoteError, TrendFilters, TrendPick, TrendScanResponse } from '../../src/types.js';
import { buildThemes } from '../themes/service.js';
import { fetchMarketSnapshot, fetchBoardMembers, type BoardMember } from '../themes/eastmoney.js';
import { fetchStockKline, type KlineBar } from '../themes/tenjqka.js';

const KLINE_CONCURRENCY = 6;
/** 漏斗第一级之后最多拉多少只日K */
const MAX_SCAN = 260;
const MAX_ITEMS = 120;

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
  themeScope: 'main',
  maxMa5Dist: 4,
  maxPct: 20,
  pctWindow: 10,
  minStableDays: 3,
  minAmountYi: 5,
  minScore: 5,
  mainOnly: false,
  excludeSt: false,
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

  return {
    themeScope: query.themeScope === 'all' ? 'all' : 'main',
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
  };
};

type ScanEvaluation = {
  matched: string[];
  unmatched: string[];
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
};

export const evaluateScanPattern = (bars: KlineBar[], filters: TrendFilters): ScanEvaluation | null => {
  const window = filters.pctWindow;
  if (bars.length < Math.max(20, window + 1, 21)) return null;

  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const last = closes.length - 1;

  const ma5 = mean(closes.slice(-5));
  const ma10 = mean(closes.slice(-10));
  const ma20 = mean(closes.slice(-20));

  const matched: string[] = [];
  const unmatched: string[] = [];

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

  const previous5 = volumes.slice(-6, -1);
  const avgPrevious5 = previous5.length === 5 ? mean(previous5) : null;
  const shrink = isPositive(avgPrevious5) ? volumes[last] / avgPrevious5 : null;
  const shrinkOk = shrink !== null && shrink < 1;
  (shrinkOk ? matched : unmatched).push(
    shrink === null
      ? '量能比无法计算'
      : shrinkOk
        ? `回调缩量（量能比 ${shrink.toFixed(2)}）`
        : `未缩量（量能比 ${shrink.toFixed(2)}，要求 <1）`,
  );

  const distMa5 = ma5 > 0 ? (closes[last] / ma5 - 1) * 100 : null;
  const distOk = distMa5 !== null && Math.abs(distMa5) <= filters.maxMa5Dist;
  (distOk ? matched : unmatched).push(
    distMa5 === null
      ? '距 5 日线无法计算'
      : distOk
        ? `距 5 日线 ${distMa5.toFixed(2)}%`
        : `距 5 日线 ${distMa5.toFixed(2)}%（要求 ≤${filters.maxMa5Dist}%）`,
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

  const amounts = bars
    .slice(-5)
    .map((bar) => bar.amount)
    .filter((value): value is number => value !== null && value > 0);

  return {
    matched,
    unmatched,
    ma5: round(ma5, 2),
    ma10: round(ma10, 2),
    ma20: round(ma20, 2),
    distMa5: distMa5 === null ? null : round(distMa5),
    stableDays,
    shrink: shrink === null ? null : round(shrink, 4),
    pctWindow: pctWindow === null ? null : round(pctWindow),
    avgAmount5d: amounts.length === 5 ? round(mean(amounts), 0) : null,
    score: matched.length,
  };
};

type Candidate = {
  symbol: string;
  name: string;
  member: BoardMember;
  themes: Array<{ code: string; name: string }>;
};

const collectCandidates = async (
  tradeDate: string,
  filters: TrendFilters,
  fetchImpl: typeof fetch,
): Promise<{ candidates: Candidate[]; total: number; errors: QuoteError[] }> => {
  const errors: QuoteError[] = [];
  const candidates: Candidate[] = [];
  const seen = new Map<string, Candidate>();

  if (filters.themeScope === 'all') {
    const members = await fetchMarketSnapshot(fetchImpl);
    for (const member of members) {
      seen.set(member.symbol, { symbol: member.symbol, name: member.name, member, themes: [] });
    }
  } else {
    const themes = await buildThemes(tradeDate, fetchImpl);
    if (themes.error) errors.push({ symbol: tradeDate, message: themes.error });

    const mainBoards = themes.main.map((theme) => ({ code: theme.code, name: theme.name }));
    if (mainBoards.length === 0) {
      return { candidates: [], total: 0, errors };
    }

    const perBoard = await mapLimit(mainBoards, 4, async (board) => ({
      board,
      members: await fetchBoardMembers(board.code, fetchImpl),
    }));

    for (const { board, members } of perBoard) {
      for (const member of members) {
        const existing = seen.get(member.symbol);
        if (existing) {
          if (!existing.themes.some((theme) => theme.code === board.code)) {
            existing.themes.push(board);
          }
          continue;
        }
        seen.set(member.symbol, {
          symbol: member.symbol,
          name: member.name,
          member,
          themes: [board],
        });
      }
    }
  }

  const amountFloor = filters.minAmountYi * 1e8;

  for (const candidate of seen.values()) {
    if (filters.mainOnly && !(candidate.symbol.startsWith('60') || candidate.symbol.startsWith('00'))) {
      continue;
    }
    if (filters.excludeSt && /ST/i.test(candidate.name)) continue;
    // 日K口径的日均成交额要 5 亿，今天的成交额先按 70% 放行做预筛
    if ((candidate.member.amount ?? 0) < amountFloor * 0.7) continue;
    candidates.push(candidate);
  }

  const total = candidates.length;
  candidates.sort((a, b) => (b.member.amount ?? 0) - (a.member.amount ?? 0));
  return { candidates: candidates.slice(0, MAX_SCAN), total, errors };
};

export const scanTrend = async (
  tradeDate: string,
  filters: TrendFilters,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendScanResponse> => {
  const fetchedAt = new Date().toISOString();

  try {
    const { candidates, total, errors } = await collectCandidates(tradeDate, filters, fetchImpl);

    const evaluated = await mapLimit(candidates, KLINE_CONCURRENCY, async (candidate) => {
      const bars = await fetchStockKline(candidate.symbol, fetchImpl);
      const evaluation = evaluateScanPattern(bars, filters);
      if (!evaluation) return null;
      if (evaluation.score < filters.minScore) return null;
      if (
        evaluation.avgAmount5d === null ||
        evaluation.avgAmount5d < filters.minAmountYi * 1e8
      ) {
        return null;
      }

      const pick: TrendPick = {
        symbol: candidate.symbol,
        name: candidate.name,
        themes: candidate.themes,
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
      };
      return pick;
    });

    const items = evaluated
      .filter((pick): pick is TrendPick => pick !== null)
      .sort((a, b) => {
        const themeDiff = b.themes.length - a.themes.length;
        if (themeDiff !== 0) return themeDiff;
        return (b.avgAmount5d ?? 0) - (a.avgAmount5d ?? 0);
      })
      .slice(0, MAX_ITEMS);

    return {
      tradeDate,
      items,
      scanned: candidates.length,
      candidates: total,
      filters,
      fetchedAt,
      source: filters.themeScope === 'main' ? 'eastmoney+10jqka' : 'eastmoney',
      status: 'fresh',
      error: errors.length > 0 ? (errors[0].message ?? null) : null,
    };
  } catch (error) {
    return {
      tradeDate,
      items: [],
      scanned: 0,
      candidates: 0,
      filters,
      fetchedAt,
      source: 'eastmoney+10jqka',
      status: 'unavailable',
      error: error instanceof Error ? error.message : '形态扫描失败',
    };
  }
};
