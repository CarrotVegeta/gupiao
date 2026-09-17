/**
 * 选股页的编排层：把三家上游缝成 `/api/themes` 与题材详情。
 *
 * 关键设计（2026-09-18 重构版）：
 * - **题材骨架用东财板块**（BK 代码），家数自算，但拆成三个口径：
 *   `conceptCount`（概念成员涨停，仅静态归属）、`supportedCount`（本轮驱动有依据）、
 *   `unresolvedCount`（有概念归属但本轮关联未确认）。角色资格只看 supported。
 * - **本轮驱动证据**来自同花顺涨停池的涨停原因（当天涨停原因只能支持当天观察），
 *   细分逻辑匹配走 `topicAliases.ts`（一期没配置映射时不猜精确匹配）。
 *   东财 F10 只设置 `isMember` 与业务背景，**不**生成本轮强证据。
 * - 一次的成员指标计算结果同时供题材总览与详情使用，避免两处对「龙头」给不同答案。
 * - 数据状态区分 fresh / partial / stale / unavailable；历史请求没有当日快照时返回
 *   unavailable，不拿最新行情冒充历史。
 */
import type {
  CheckResult,
  CheckState,
  Evidence,
  Quote,
  QuoteError,
  RoleTag,
  ScanCoverage,
  ScreenerDataStatus,
  ThemeDetailResponseV2,
  ThemeItem,
  ThemeStockItem,
  ThemeStockRole,
  ThemeStockV2,
  ThemeStocksResponse,
  ThemesResponse,
} from '../../src/types.js';
import { fetchTencentMarket } from '../market/tencent.js';
import { assignRoleTags, ROLE_RULE_VERSION } from './assignRoles.js';
import { resolveThemeRelation } from './attribution.js';
import {
  classifyThemeV2,
  CONCEPT_ACTIVE_FLOOR,
  DURATION_DAILY_FLOOR,
  toThemeItemV2,
  type ThemeClassifyInput,
  type ThemeDayEvidence,
} from './classify.js';
import {
  fetchBoardCatalog,
  fetchBoardMembers,
  fetchRiskFlags,
  fetchSymbolThemes,
  type BoardCatalog,
  type BoardMember,
  type RiskCheck,
  type SymbolTheme,
} from './eastmoney.js';
import { computeStockMetrics, sectorAmounts, sectorPct20 } from './metrics.js';
import { buildRoleAssessments, type RoleCandidate } from './roles.js';
import { resolveTopicMatch } from './topicAliases.js';
import {
  fetchBlockTop,
  fetchBoardKline,
  fetchLimitUpPool,
  fetchStockKline,
  type BlockTopRow,
  type LimitUpPoolRow,
} from './tenjqka.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
/** 失败的详情只保留「同键成功快照」用于 stale，不把失败固化 */
const STALE_GRACE_MS = CACHE_TTL_MS * 4;
const KLINE_CONCURRENCY = 6;
/** 详情页最多拉日K的股票数；超过的部分记为「未扫描」，不宣称全题材排名 */
export const THEME_SCAN_LIMIT = 120;
/** 旧兼容接口每个角色最多返回多少行 */
const MAX_ITEMS = 60;
/** 用于分类与总览的历史交易日数（含当日） */
export const THEME_HISTORY_DAYS = 3;
/**
 * 板块规模上限：纯正成员数超过这个规模的「板块」是宽口径属性题材
 * （如「央国企改革」1444 只），不是主线。用东财快照的涨跌家数之和做运行时代理，
 * 与回测脚本里 `MAX_BOARD_SIZE = 800` 对齐。
 */
export const THEME_MAX_BOARD_SIZE = 800;

/** 规则版本：缓存键必须带它，规则变化时旧缓存自动失效 */
export const THEME_RULE_VERSION = `${ROLE_RULE_VERSION}+classify-v2`;

const MARKET_INDEX_SYMBOLS = { shanghai: '000001', shenzhen: '399001' } as const;

/** 板块名称别名表：上游口径不一致时兜底（主要用于拿板块日K） */
const BOARD_NAME_ALIASES: Record<string, string> = {
  新能源汽车: '新能源车',
  储能: '储能概念',
  芯片概念: '半导体概念',
  券商概念: '证券',
};

const isPositive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

// ---------------------------------------------------------------------------
// 缓存（键 = 规则版本 + 交易日 + 板块，A 题材结果不能填到 B 题材）
// ---------------------------------------------------------------------------

type Cached<T> = { value: T; expiresAt: number };
const catalogCache = new Map<string, Cached<{ catalog: BoardCatalog; errors: QuoteError[] }>>();
const themesCache = new Map<string, Cached<ThemesResponse>>();
const detailCache = new Map<string, Cached<ThemeDetailResponseV2>>();
const tradeDateCache = new Map<string, Cached<string[]>>();

export const clearThemeServiceCache = (): void => {
  catalogCache.clear();
  themesCache.clear();
  detailCache.clear();
  tradeDateCache.clear();
};

const detailCacheKey = (tradeDate: string, boardCode: string): string =>
  `${THEME_RULE_VERSION}|${tradeDate}|${boardCode}`;

const getCatalog = async (
  fetchImpl: typeof fetch,
): Promise<{ catalog: BoardCatalog; errors: QuoteError[] }> => {
  const cached = catalogCache.get('all');
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchBoardCatalog(fetchImpl);
  // 目录取到就缓存（哪怕有个别分页失败），否则一次抖动会让所有题材消失
  if (value.catalog.size > 0) {
    catalogCache.set('all', { value, expiresAt: Date.now() + 60_000 });
  }
  return value;
};

// ---------------------------------------------------------------------------
// 交易日历（腾讯上证指数日K）
// ---------------------------------------------------------------------------

export const fetchRecentTradeDates = async (
  count: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> => {
  const key = `dates-${count}`;
  const cached = tradeDateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const params = new URLSearchParams({ param: `sh000001,day,,,${Math.max(count + 10, 40)},qfq` });
    const response = await fetchImpl(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params.toString()}`,
    );
    const payload: unknown = await response.json();
    const root =
      typeof payload === 'object' && payload !== null && 'data' in payload
        ? (payload as { data?: unknown }).data
        : null;
    const entry =
      typeof root === 'object' && root !== null && 'sh000001' in root
        ? (root as Record<string, unknown>).sh000001
        : null;
    const rows =
      entry && typeof entry === 'object'
        ? ((entry as Record<string, unknown>).qfqday ?? (entry as Record<string, unknown>).day)
        : null;

    const dates = (Array.isArray(rows) ? rows : [])
      .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 1)
      .map((row) => String(row[0]).replaceAll('-', ''))
      .filter((date) => /^\d{8}$/.test(date))
      .slice(-count);

    if (dates.length > 0) {
      tradeDateCache.set(key, { value: dates, expiresAt: Date.now() + CACHE_TTL_MS });
      return dates;
    }
  } catch {
    // 拿不到交易日历时退化为「只有今天」，指标会因此缺失，页面会如实显示
  }

  return [];
};

/** 截止到 tradeDate（含）的最近 count 个交易日：历史请求必须用「当时」的日历 */
export const fetchTradeDatesUpTo = async (
  tradeDate: string,
  count: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> => {
  const dates = await fetchRecentTradeDates(Math.max(count + 10, 40), fetchImpl);
  const upTo = dates.filter((date) => date <= tradeDate);
  if (upTo.length > 0) return upTo.slice(-count);
  return [tradeDate];
};

// ---------------------------------------------------------------------------
// 同花顺板块代码反查（成员重叠）
// ---------------------------------------------------------------------------

const resolveBoardCodeByName = (
  name: string,
  boardTopRows: BlockTopRow[],
): string | null => {
  const target = BOARD_NAME_ALIASES[name] ?? name;
  const exact = boardTopRows.find((row) => row.name === target || row.name === name);
  if (exact) return exact.code;
  const fuzzy = boardTopRows.find(
    (row) => row.name.includes(target) || target.includes(row.name),
  );
  return fuzzy?.code ?? null;
};

const mapBoardTopByMembership = (
  boardTopRows: BlockTopRow[],
  symbolThemes: Map<string, SymbolTheme[]>,
): Map<string, string> => {
  const votes = new Map<string, Map<string, number>>();

  for (const row of boardTopRows) {
    if (row.memberSymbols.length === 0) continue;
    const perBoard = new Map<string, number>();
    for (const symbol of row.memberSymbols) {
      for (const theme of symbolThemes.get(symbol) ?? []) {
        perBoard.set(theme.code, (perBoard.get(theme.code) ?? 0) + 1);
      }
    }
    let bestCode: string | null = null;
    let bestCount = 0;
    for (const [code, count] of perBoard) {
      if (count > bestCount) {
        bestCode = code;
        bestCount = count;
      }
    }
    const threshold = Math.max(2, Math.ceil(row.memberSymbols.length * 0.4));
    if (bestCode && bestCount >= threshold) {
      const existing = votes.get(bestCode) ?? new Map<string, number>();
      existing.set(row.code, (existing.get(row.code) ?? 0) + bestCount);
      votes.set(bestCode, existing);
    }
  }

  const resolved = new Map<string, string>();
  for (const [boardCode, candidates] of votes) {
    const [tonghuashunCode] = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
    resolved.set(boardCode, tonghuashunCode);
  }
  return resolved;
};

// ---------------------------------------------------------------------------
// 证据：涨停原因 → Evidence
// ---------------------------------------------------------------------------

type DayPool = {
  date: string;
  rows: LimitUpPoolRow[];
  error: QuoteError | null;
};

const cell = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('|', '\\|');

const reasonTopicKey = (themeCode: string, tag: string): string | null => {
  const result = resolveTopicMatch(themeCode, tag);
  return result.match === 'exact' ? result.topicKey : null;
};

/**
 * 把一天的涨停池转成「相关题材」的证据集合。
 * `validTradeDate` 就是该交易日（涨停原因只能支持当天观察）；
 * `observedAt` 是抓取时刻，**不冒充**发布时间；一期没有可靠来源，`publishedAt` 为 null。
 */
export const buildEvidenceForDay = (
  day: DayPool,
  symbolThemes: Map<string, SymbolTheme[]>,
  boardCodes: Set<string> | null,
  observedAt: string,
): Evidence[] => {
  const result: Evidence[] = [];
  for (const row of day.rows) {
    for (const theme of symbolThemes.get(row.symbol) ?? []) {
      if (boardCodes !== null && !boardCodes.has(theme.code)) continue;
      row.reasonTags.forEach((tag, index) => {
        result.push({
          id: `${cell(day.date)}|${cell(row.symbol)}|${cell(theme.code)}|${index}|${cell(tag)}`,
          themeCode: theme.code,
          symbol: row.symbol,
          sourceKind: 'limit_up_reason',
          sourceName: '同花顺涨停池',
          sourceUrl: null,
          text: tag,
          publishedAt: null,
          observedAt,
          validTradeDate: day.date,
          topicKey: reasonTopicKey(theme.code, tag),
          // 细分映射只有配置过才是 exact，这里先按 ambiguous 记录原文
          match: 'ambiguous',
        });
      });
    }
  }
  return result;
};

/** 按 topicKey 定档：配置过精确映射才算 exact，否则只能是 ambiguous */
export const toAttributionEvidence = (evidence: Evidence[]): Evidence[] =>
  evidence.map((item) => ({
    ...item,
    match: item.topicKey === null ? 'ambiguous' : 'exact',
  }));

// ---------------------------------------------------------------------------
// 共享上下文
// ---------------------------------------------------------------------------

type SharedContext = {
  tradeDate: string;
  /** 实际用于观察的交易日：请求日涨停池未产生时退回到最近有数据的交易日 */
  poolDate: string;
  catalog: BoardCatalog;
  boardTopRows: BlockTopRow[];
  /** 东财板块代码 → 同花顺板块代码（用于取板块日K） */
  boardCodeMap: Map<string, string>;
  /** 最近 THEME_HISTORY_DAYS 个交易日，从旧到新 */
  windowDates: string[];
  poolsByDate: Map<string, DayPool>;
  /** 今天每个板块的「概念成员涨停」symbol 集合 */
  conceptLimitUpByBoard: Map<string, Set<string>>;
  /** 交易日 → symbol → 该日涨停股的概念归属 */
  themesByDate: Map<string, Map<string, SymbolTheme[]>>;
  todayThemes: Map<string, SymbolTheme[]>;
  marketAmount: number | null;
  indexPct: number | null;
  /** 证据获取失败时不能把关联自动当作「仅概念归属」 */
  evidenceFetchFailed: boolean;
  errors: QuoteError[];
  /** 口径说明类提示（不是失败），如「开盘前退回最近有数据的交易日」 */
  warnings: string[];
  observedAt: string;
};

const loadSharedContext = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
  observedAt: string,
): Promise<SharedContext> => {
  const errors: QuoteError[] = [];
  const contextWarnings: string[] = [];

  const catalogResult = await getCatalog(fetchImpl);
  const catalog = catalogResult.catalog;
  errors.push(...catalogResult.errors);
  // 历史请求：日历里这个日期已经不是最近交易日，说明没有当日快照可用。
  // 明确抛出而不是退回最新行情，避免把今天的数据当成历史。
  const calendarDates = await fetchRecentTradeDates(120, fetchImpl);
  const lastCalendarDate = calendarDates.at(-1) ?? null;
  if (lastCalendarDate === null) {
    throw new Error('交易日历不可用，无法确认该日期是否为最近交易日（不猜）');
  }
  if (tradeDate < lastCalendarDate) {
    throw new Error('没有该交易日的快照数据，无法做历史精确重建（不拿最新行情冒充历史）');
  }
  const baseWindow = await fetchTradeDatesUpTo(tradeDate, THEME_HISTORY_DAYS, fetchImpl);
  // 请求日的涨停池在开盘前是空的（同花顺按自然交易日给数据），
  // 这时退回到最近有涨停数据的交易日观察，并用 warnings 明说，绝不假装今天已有数据。
  const requestedPool = await fetchLimitUpPool(tradeDate, fetchImpl);
  const orderedDates: string[] = [...baseWindow].reverse();
  const seenDates = new Set(orderedDates);
  let fallback = requestedPool.rows.length > 0 ? null : requestedPool;
  while ((fallback === null || fallback.rows.length === 0) && orderedDates.length < THEME_HISTORY_DAYS) {
    const oldest = orderedDates[orderedDates.length - 1];
    const previousDates = await fetchTradeDatesUpTo(oldest, 2, fetchImpl);
    const older = previousDates.filter((date) => !seenDates.has(date)).at(-1);
    if (older === undefined) break;
    seenDates.add(older);
    orderedDates.push(older);
    fallback = await fetchLimitUpPool(older, fetchImpl);
  }

  const poolDate =
    requestedPool.rows.length > 0
      ? tradeDate
      : (orderedDates.find((date) => date !== tradeDate) ?? tradeDate);
  const poolByDate = new Map<string, Awaited<ReturnType<typeof fetchLimitUpPool>>>([
    [tradeDate, requestedPool],
  ]);
  const missingDates = orderedDates.filter(
    (date) => date !== tradeDate && !poolByDate.has(date),
  );
  const fetchedPools = await mapLimit(missingDates, 3, async (date) => ({
    date,
    pool: await fetchLimitUpPool(date, fetchImpl),
  }));
  for (const item of fetchedPools) poolByDate.set(item.date, item.pool);

  const [boardTop, market] = await Promise.all([
    fetchBlockTop(poolDate, fetchImpl),
    fetchTencentMarket().catch(() => null),
  ]);
  if (requestedPool.error) errors.push(requestedPool.error);
  if (boardTop.error) errors.push(boardTop.error);

  const poolsByDate = new Map<string, DayPool>();
  for (const date of orderedDates) {
    const item = poolByDate.get(date);
    if (!item) continue;
    poolsByDate.set(date, { date, rows: item.rows, error: item.error });
    if (date !== tradeDate && item.error) errors.push(item.error);
  }
  const windowDates = [...orderedDates].reverse();

  let marketAmount: number | null = null;
  let indexPct: number | null = null;
  if (market) {
    const shanghai = market.indices.find((index) => index.symbol === MARKET_INDEX_SYMBOLS.shanghai);
    const shenzhen = market.indices.find((index) => index.symbol === MARKET_INDEX_SYMBOLS.shenzhen);
    indexPct = shanghai?.pct ?? null;
    const sh = shanghai?.amount ?? null;
    const sz = shenzhen?.amount ?? null;
    marketAmount = sh !== null && sz !== null ? sh + sz : (sh ?? sz);
  }

  // 观察日涨停股的题材归属：这是「概念成员涨停」自算的基础
  const observedPool = poolByDate.get(poolDate) ?? requestedPool;
  let todayThemes = new Map<string, SymbolTheme[]>();
  let themeFetchFailed = false;
  try {
    todayThemes = await fetchSymbolThemes(
      observedPool.rows.map((row) => row.symbol),
      catalog,
      fetchImpl,
    );
  } catch (error) {
    themeFetchFailed = true;
    errors.push({
      symbol: poolDate,
      message: error instanceof Error ? error.message : '题材归属请求失败',
    });
  }

  // 其它交易日：只要当时涨停股的归属（用于持续性），缺失就不补 0
  const themesByDate = new Map<string, Map<string, SymbolTheme[]>>();
  themesByDate.set(poolDate, todayThemes);
  for (const date of windowDates) {
    if (date === poolDate) continue;
    const dayPool = poolsByDate.get(date);
    if (!dayPool || dayPool.error) {
      themesByDate.set(date, new Map());
      continue;
    }
    const symbols = dayPool.rows.map((row) => row.symbol);
    const missing = symbols.filter((symbol) => !todayThemes.has(symbol));
    let extra = new Map<string, SymbolTheme[]>();
    if (missing.length > 0) {
      try {
        extra = await fetchSymbolThemes(missing, catalog, fetchImpl);
      } catch (error) {
        themeFetchFailed = true;
        errors.push({
          symbol: date,
          message: error instanceof Error ? error.message : '历史题材归属请求失败',
        });
      }
    }
    const perDate = new Map<string, SymbolTheme[]>();
    for (const symbol of symbols) {
      const themes = todayThemes.get(symbol) ?? extra.get(symbol);
      if (themes) perDate.set(symbol, themes);
    }
    themesByDate.set(date, perDate);
  }

  const conceptLimitUpByBoard = new Map<string, Set<string>>();
  for (const row of observedPool.rows) {
    for (const theme of todayThemes.get(row.symbol) ?? []) {
      const set = conceptLimitUpByBoard.get(theme.code) ?? new Set<string>();
      set.add(row.symbol);
      conceptLimitUpByBoard.set(theme.code, set);
    }
  }

  if (poolDate !== tradeDate) {
    // 这是「口径说明」不是失败：放进 warnings，error 只留给不可恢复的失败
    contextWarnings.push(
      `请求交易日 ${tradeDate} 的涨停池尚未产生（同花顺按自然交易日给数据），` +
        `本次按最近有数据的交易日 ${poolDate} 观察；交易日口径是当日收盘后的口径`,
    );
  }

  return {
    tradeDate,
    poolDate,
    catalog,
    boardTopRows: boardTop.rows,
    boardCodeMap: mapBoardTopByMembership(boardTop.rows, todayThemes),
    windowDates,
    poolsByDate,
    conceptLimitUpByBoard,
    themesByDate,
    todayThemes,
    marketAmount,
    indexPct,
    evidenceFetchFailed: themeFetchFailed || observedPool.error !== null,
    errors,
    warnings: contextWarnings,
    observedAt,
  };
};

// ---------------------------------------------------------------------------
// 分类计数（总览与详情共用同一次计算）
// ---------------------------------------------------------------------------

export type BoardDayCounts = {
  date: string;
  conceptCount: number | null;
  supportedCount: number | null;
  unresolvedCount: number | null;
  supportedSymbols: Set<string>;
  /** 该日基础数据是否完整；不完整就不能据此排除主线 */
  complete: boolean;
  evidence: Evidence[];
};

const dayThemes = (
  date: string,
  context: SharedContext,
): Map<string, SymbolTheme[]> => context.themesByDate.get(date) ?? new Map();

const countBoardSymbolsForDay = (
  boardCode: string,
  day: DayPool,
  themes: Map<string, SymbolTheme[]>,
): Set<string> | null => {
  if (day.error) return null;
  const symbols = new Set<string>();
  for (const row of day.rows) {
    if ((themes.get(row.symbol) ?? []).some((theme) => theme.code === boardCode)) {
      symbols.add(row.symbol);
    }
  }
  return symbols;
};

/**
 * 某板块在窗口内每天的三个家数口径（从新到旧，days[0] = 今天）。
 * 概念口径 = 当日涨停池 ∩ 该板块概念归属；驱动口径只认本轮证据；
 * 拿不到数据时为 null（不补 0），并把该日标为不完整。
 */
export const computeBoardDayCounts = (
  boardCode: string,
  context: SharedContext,
): { days: ThemeDayEvidence[]; byDate: Map<string, BoardDayCounts> } => {
  const byDate = new Map<string, BoardDayCounts>();
  const days: ThemeDayEvidence[] = [];
  const ordered = [...context.windowDates].reverse();

  for (const date of ordered) {
    const day = context.poolsByDate.get(date);
    const themes = dayThemes(date, context);
    const symbols = day ? countBoardSymbolsForDay(boardCode, day, themes) : null;

    if (!day || symbols === null) {
      byDate.set(date, {
        date,
        conceptCount: null,
        supportedCount: null,
        unresolvedCount: null,
        supportedSymbols: new Set(),
        complete: false,
        evidence: [],
      });
      days.push({
        date,
        conceptCount: null,
        supportedCount: null,
        unresolvedCount: null,
        complete: false,
      });
      continue;
    }

    const evidence = toAttributionEvidence(
      buildEvidenceForDay(day, themes, new Set([boardCode]), context.observedAt),
    );
    const supportedSymbols = new Set<string>();
    for (const symbol of symbols) {
      const relation = resolveThemeRelation({
        themeCode: boardCode,
        symbol,
        isMember: true,
        evidence,
        evidenceFetchFailed: context.evidenceFetchFailed,
        hasConflictingEvidence: false,
        alternativeThemeCodes: [],
        tradeDate: date,
        asOf: context.observedAt,
      });
      if (relation.state === 'supported') supportedSymbols.add(symbol);
    }

    const unresolvedCount = Math.max(0, symbols.size - supportedSymbols.size);
    const complete = day.error === null && !context.evidenceFetchFailed;
    byDate.set(date, {
      date,
      conceptCount: symbols.size,
      supportedCount: supportedSymbols.size,
      unresolvedCount,
      supportedSymbols,
      complete,
      evidence,
    });
    days.push({
      date,
      conceptCount: symbols.size,
      supportedCount: supportedSymbols.size,
      unresolvedCount,
      complete,
    });
  }

  return { days, byDate };
};

/** 候选板块：当日概念活跃，或此前有家数（已跟踪）的题材 */
const isCandidateBoard = (days: ThemeDayEvidence[]): boolean => {
  const [today] = days;
  if ((today?.conceptCount ?? 0) >= CONCEPT_ACTIVE_FLOOR) return true;
  return days.slice(1).some((day) => (day.conceptCount ?? 0) > 0);
};

// ---------------------------------------------------------------------------
// /api/themes
// ---------------------------------------------------------------------------

export const buildThemes = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemesResponse> => {
  const cacheKey = `${THEME_RULE_VERSION}|${tradeDate}`;
  const cached = themesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fetchedAt = new Date().toISOString();
  const empty: ThemesResponse = {
    schemaVersion: 2,
    tradeDate,
    main: [],
    branch: [],
    pending: [],
    fetchedAt,
    source: 'eastmoney+10jqka',
    status: 'unavailable',
    warnings: [],
    error: null,
  };

  try {
    const context = await loadSharedContext(tradeDate, fetchImpl, fetchedAt);
    const warnings: string[] = [...context.warnings];
    const main: ThemeItem[] = [];
    const branch: ThemeItem[] = [];
    const pending: ThemeItem[] = [];

    for (const [code, conceptSymbols] of context.conceptLimitUpByBoard) {
      const snapshot = context.catalog.get(code);
      if (!snapshot || conceptSymbols.size === 0) continue;
      const breadth = (snapshot.upCount ?? 0) + (snapshot.downCount ?? 0);
      if (breadth !== 0 && breadth > THEME_MAX_BOARD_SIZE) continue;

      const { days, byDate } = computeBoardDayCounts(code, context);
      if (!isCandidateBoard(days)) continue;

      const classification = classifyThemeV2(days, {
        previouslyTracked: days.slice(1).some((day) => (day.conceptCount ?? 0) > 0),
      });
      if (!classification.listed) continue;

      const dayPool = context.poolsByDate.get(context.poolDate);
      const limitUpRows =
        dayPool?.rows
          .filter((row) => conceptSymbols.has(row.symbol))
          .map((row) => ({
            symbol: row.symbol,
            name: row.name,
            boardCount: row.boardCount,
            firstSealTime: row.firstSealTime,
            reasonTags: row.reasonTags,
          })) ?? [];

      let amounts: number[] = [];
      const tonghuashunCode =
        context.boardCodeMap.get(code) ??
        resolveBoardCodeByName(snapshot.name, context.boardTopRows);
      if (tonghuashunCode) {
        const bars = await fetchBoardKline(tonghuashunCode, fetchImpl);
        amounts = sectorAmounts(bars);
      }
      if (amounts.length === 0 && isPositive(snapshot.amount)) amounts = [snapshot.amount];

      const input: ThemeClassifyInput = {
        code,
        name: snapshot.name,
        pct: snapshot.pct,
        limitUpRows,
        amounts,
        marketAmount: context.marketAmount,
        indexPct: context.indexPct,
        historyCounts: days.map((day) => day.conceptCount ?? 0),
      };

      const today = byDate.get(context.poolDate);
      const item = toThemeItemV2(input, classification, {
        concept: today?.conceptCount ?? null,
        supported: today?.supportedCount ?? null,
        unresolved: today?.unresolvedCount ?? null,
      });
      if (!item) continue;

      if (classification.kind === 'main') main.push(item);
      else if (classification.kind === 'branch') branch.push(item);
      else pending.push(item);
    }

    const poolFailed = context.errors.length > 0;
    if (poolFailed) warnings.push('部分上游请求失败，家数与覆盖可能不完整');
    if ([...main, ...branch, ...pending].some((item) => item.conceptLimitUpCount === null)) {
      warnings.push('部分题材缺少当日概念家数（数据缺失，不按 0 处理）');
    }
    if ([...main, ...branch, ...pending].some((item) => item.supportedLimitUpCount === 0)) {
      warnings.push(
        '部分题材当日「驱动有依据」为 0：静态概念归属不能单独确认本轮驱动，家数按概念口径展示',
      );
    }

    const status: ScreenerDataStatus =
      context.conceptLimitUpByBoard.size === 0 && poolFailed
        ? 'unavailable'
        : poolFailed
          ? 'partial'
          : 'fresh';

    const body: ThemesResponse = {
      schemaVersion: 2,
      tradeDate,
      main: sortMain(main),
      branch: sortBranch(branch),
      pending: sortBranch(pending),
      fetchedAt,
      source: 'eastmoney+10jqka',
      status,
      warnings,
      error: context.errors.length > 0 ? (context.errors[0].message ?? null) : null,
    };

    if (body.status !== 'unavailable') {
      themesCache.set(cacheKey, { value: body, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return body;
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : '题材数据构建失败',
    };
  }
};

const sortMain = (items: ThemeItem[]): ThemeItem[] =>
  [...items].sort(
    (a, b) =>
      (b.supportedLimitUpCount ?? 0) - (a.supportedLimitUpCount ?? 0) ||
      (b.conceptLimitUpCount ?? 0) - (a.conceptLimitUpCount ?? 0),
  );

const sortBranch = (items: ThemeItem[]): ThemeItem[] =>
  [...items].sort(
    (a, b) =>
      b.durationDays - a.durationDays ||
      (b.conceptLimitUpCount ?? 0) - (a.conceptLimitUpCount ?? 0) ||
      b.score - a.score,
  );

// ---------------------------------------------------------------------------
// 题材详情
// ---------------------------------------------------------------------------

const blankDetail = (
  tradeDate: string,
  asOf: string,
  error: string | null,
  status: ScreenerDataStatus = 'unavailable',
): ThemeDetailResponseV2 => ({
  schemaVersion: 2,
  ruleVersion: THEME_RULE_VERSION,
  tradeDate,
  asOf,
  theme: null,
  items: [],
  evidence: [],
  coverage: { total: 0, attempted: 0, succeeded: 0, failed: 0, unscanned: 0 },
  status,
  warnings: [],
  error,
});

/**
 * 最后一根日K是否属于已完成交易日。
 * 无法确认「已过收盘」时返回 false，该根K线不参与形态与量能计算（不猜）。
 */
export const isLastBarComplete = (
  barDate: string | null,
  tradeDate: string,
  now: Date,
): boolean => {
  if (barDate === null) return false;
  if (barDate < tradeDate) return true;
  if (barDate > tradeDate) return false;
  // 东八区 15:00 之后才算当日收盘完成
  const shanghai = new Date(now.getTime() + 8 * 3600 * 1000);
  const hours = shanghai.getUTCHours();
  const minutes = shanghai.getUTCMinutes();
  return hours > 15 || (hours === 15 && minutes >= 0);
};

/** 风险核验：只对可能拿标签的候选查询；失败时 checked=false（不谎报「未见风险」） */
const loadRiskFlags = async (
  symbols: string[],
  fetchImpl: typeof fetch,
): Promise<Map<string, RiskCheck>> => {
  if (symbols.length === 0) return new Map();
  try {
    return await fetchRiskFlags(symbols, fetchImpl);
  } catch {
    return new Map();
  }
};

export const buildThemeDetail = async (
  tradeDate: string,
  boardCode: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<ThemeDetailResponseV2> => {
  const requestedAt = now.toISOString();
  const cached = detailCache.get(detailCacheKey(tradeDate, boardCode));
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const context = await loadSharedContext(tradeDate, fetchImpl, requestedAt);
    const snapshot = context.catalog.get(boardCode);
    if (!snapshot) {
      return blankDetail(tradeDate, requestedAt, `未知板块 ${boardCode}`, 'unavailable');
    }

    const dayPool = context.poolsByDate.get(context.poolDate);
    if (!dayPool) {
      return {
        ...blankDetail(
          tradeDate,
          requestedAt,
          '没有该交易日的快照数据，无法做历史精确重建（不拿最新行情冒充历史）',
          'unavailable',
        ),
        theme: { code: boardCode, name: snapshot.name },
      };
    }

    const { days, byDate } = computeBoardDayCounts(boardCode, context);
    const todayCounts = byDate.get(context.poolDate);
    const classification = classifyThemeV2(days, {
      previouslyTracked: days.slice(1).some((day) => (day.conceptCount ?? 0) > 0),
    });

    const members = await fetchBoardMembers(boardCode, fetchImpl);
    if (members.length === 0) {
      return {
        ...blankDetail(tradeDate, requestedAt, '板块没有成分股数据', 'unavailable'),
        theme: { code: boardCode, name: snapshot.name },
      };
    }

    const warnings: string[] = [
      ...context.warnings,
      `分类：${classification.kind === 'main' ? '主线' : classification.kind === 'branch' ? '支线' : '待确认'}`,
      ...classification.reasons.map((reason) => `分类依据：${reason}`),
    ];

    // 板块日K（相对涨幅 / 抗跌性 / 补涨滞后度）
    const tonghuashunCode =
      context.boardCodeMap.get(boardCode) ??
      resolveBoardCodeByName(snapshot.name, context.boardTopRows);
    const sectorBars = tonghuashunCode ? await fetchBoardKline(tonghuashunCode, fetchImpl) : [];
    const sectorPct = sectorPct20(sectorBars);

    const todayEvidence = todayCounts?.evidence ?? [];
    const supportedSymbols = todayCounts?.supportedSymbols ?? new Set<string>();

    // 扫描顺序：已有有效标签（同日同版本缓存）→ 观察日 supported → 其余按成交额降序
    const taggedSymbols = new Set(
      (cached?.value.items ?? [])
        .filter((item) => item.roles.length > 0 && item.metricsTradeDate === context.poolDate)
        .map((item) => item.symbol),
    );
    const ordered = [...members].sort((a, b) => {
      const taggedDiff = Number(taggedSymbols.has(b.symbol)) - Number(taggedSymbols.has(a.symbol));
      if (taggedDiff !== 0) return taggedDiff;
      const supportedDiff =
        Number(supportedSymbols.has(b.symbol)) - Number(supportedSymbols.has(a.symbol));
      if (supportedDiff !== 0) return supportedDiff;
      return (b.amount ?? 0) - (a.amount ?? 0);
    });

    const targets = ordered.slice(0, THEME_SCAN_LIMIT);
    const klines = await mapLimit(targets, KLINE_CONCURRENCY, async (member) => ({
      symbol: member.symbol,
      bars: await fetchStockKline(member.symbol, fetchImpl),
    }));
    const barsBySymbol = new Map(klines.map((item) => [item.symbol, item.bars]));
    const failedSymbols = new Set(
      klines.filter((item) => item.bars.length === 0).map((item) => item.symbol),
    );

    // 本轮龙头锚点：有驱动依据的涨停股 → 启动日就是观察日（v1 只用当日可观察事件）
    const leaderAnchorDate = supportedSymbols.size > 0 ? context.poolDate : null;

    const roleCandidates: RoleCandidate[] = [];
    for (const member of targets) {
      const bars = barsBySymbol.get(member.symbol) ?? [];
      const lastBar = bars.at(-1)?.date ?? null;
      const metrics = computeStockMetrics(bars, member.symbol, member.name, sectorBars, {
        asOfTradeDate: context.poolDate,
        lastBarComplete: isLastBarComplete(lastBar, context.poolDate, now),
        tradeDates: context.windowDates,
        anchorDate: leaderAnchorDate,
      });

      const relation = resolveThemeRelation({
        themeCode: boardCode,
        symbol: member.symbol,
        isMember: true,
        evidence: todayEvidence,
        evidenceFetchFailed: context.evidenceFetchFailed,
        hasConflictingEvidence: false,
        alternativeThemeCodes: [],
        tradeDate: context.poolDate,
        asOf: requestedAt,
      });

      roleCandidates.push({
        symbol: member.symbol,
        name: member.name,
        relation,
        metricsState: failedSymbols.has(member.symbol) ? 'failed' : 'ready',
        metrics,
        metricsTradeDate: metrics.tradeDate,
        sectorPct20: sectorPct,
        topicKeys: relation.topicKeys,
        isSt: /ST/i.test(member.name),
        risksChecked: false,
        risks: [],
        member,
        poolRow: dayPool.rows.find((row) => row.symbol === member.symbol) ?? null,
      });
    }

    // 先算资格，再只对「本轮关联有依据」的候选查风险，然后用同一份结果分配标签
    const riskChecked = await loadRiskFlags(
      roleCandidates
        .filter((candidate) => candidate.relation.state === 'supported')
        .map((candidate) => candidate.symbol),
      fetchImpl,
    );
    for (const candidate of roleCandidates) {
      const risk = riskChecked.get(candidate.symbol);
      candidate.risksChecked = risk?.checked ?? false;
      candidate.risks = risk?.flags ?? [];
    }

    const assessments = buildRoleAssessments(roleCandidates);
    const assigned = assignRoleTags(assessments, requestedAt);
    warnings.push(...assigned.warnings);

    const checksBySymbol = new Map<string, Partial<Record<ThemeStockRole, CheckResult[]>>>();
    for (const item of assessments) {
      const entry = checksBySymbol.get(item.symbol) ?? {};
      entry[item.role] = item.checks;
      checksBySymbol.set(item.symbol, entry);
    }
    const candidateBySymbol = new Map(roleCandidates.map((item) => [item.symbol, item]));

    /*
     * 响应只带**参与过计算的成员**（targets = ordered 的前 THEME_SCAN_LIMIT 只）。
     *
     * 之前这里是 `ordered.map(...)`：把整个板块的成员（宽基概念动辄 700+ 只）全部序列化回前端，
     * 而其中绝大多数行的指标/角色/关联必然是空的（本轮根本没扫），前端却要为每一行都建
     * DOM 并反复重渲染。实测新能源车 717 行 → 2 万个 DOM 节点、1.1MB JSON、首屏布局约 670ms、
     * 每次交互还要整棵重渲染。未扫描成员的数量没有丢：仍在 coverage.unscanned / total 里，
     * 由 coverage 自洽校验保证 total === attempted + unscanned，界面据此如实说明。
     */
    const items: ThemeStockV2[] = targets.map((member) => {
      // targets ⊆ ordered，而 candidateBySymbol 覆盖 ordered 全部成员，这里必然命中
      const candidate = candidateBySymbol.get(member.symbol);
      const relation =
        candidate?.relation ??
        resolveThemeRelation({
          themeCode: boardCode,
          symbol: member.symbol,
          isMember: true,
          evidence: todayEvidence,
          evidenceFetchFailed: context.evidenceFetchFailed,
          hasConflictingEvidence: false,
          alternativeThemeCodes: [],
          tradeDate: context.poolDate,
          asOf: requestedAt,
        });
      const metrics = candidate?.metrics ?? null;
      const risk = riskChecked.get(member.symbol);
      const roles: RoleTag[] = assigned.tags[member.symbol] ?? [];

      return {
        ...buildBaseItem(member, boardCode, context, dayPool, todayEvidence),
        ma5: metrics?.ma5 ?? null,
        ma10: metrics?.ma10 ?? null,
        ma20: metrics?.ma20 ?? null,
        maBull: metrics?.maBull ?? null,
        distMa5: metrics?.distMa5 ?? null,
        distMa10: metrics?.distMa10 ?? null,
        stableDays10: metrics?.stableDays10 ?? null,
        pct10: metrics?.pct10 ?? null,
        pct20: metrics?.pct20 ?? null,
        avgAmount3d: metrics?.avgAmount3d ?? null,
        avgAmount5d: metrics?.avgAmount5d ?? null,
        limitUpIn60d: metrics?.limitUpIn60d ?? null,
        quoteAsOf: member.price === null ? null : requestedAt,
        relation,
        roles,
        checks: checksBySymbol.get(member.symbol) ?? {},
        metricsState: failedSymbols.has(member.symbol) ? 'failed' : candidate ? 'ready' : 'missing',
        metricsTradeDate: metrics?.tradeDate ?? null,
        risksChecked: risk?.checked ?? false,
      };
    });

    const coverage: ScanCoverage = {
      total: ordered.length,
      attempted: targets.length,
      succeeded: targets.length - failedSymbols.size,
      failed: failedSymbols.size,
      unscanned: ordered.length - targets.length,
    };
    if (coverage.unscanned > 0) {
      warnings.push(
        `题材共 ${coverage.total} 只成员，本次扫描 ${coverage.attempted} 只（快速上限 ${THEME_SCAN_LIMIT}），` +
          `还有 ${coverage.unscanned} 只未扫描：角色只在已扫描范围内比较`,
      );
    }
    if (coverage.failed > 0) {
      warnings.push(`${coverage.failed} 只成员日K取数失败，按「数据缺失」展示，不当作不达标`);
    }
    warnings.push(
      `已扫描范围内 ${items.filter((item) => item.roles.length > 0).length} 只获得角色标签`,
    );
    if (context.evidenceFetchFailed) {
      warnings.push('本轮证据获取失败：关联标注为「关联未知」，不自动视为仅概念归属');
    }
    if (sectorBars.length === 0) {
      warnings.push('板块日K取不到：相对涨幅 / 抗跌性 / 补涨滞后度按缺失处理');
    }

    const status: ScreenerDataStatus =
      coverage.failed > 0 || coverage.unscanned > 0 || context.errors.length > 0
        ? 'partial'
        : 'fresh';

    const body: ThemeDetailResponseV2 = {
      schemaVersion: 2,
      ruleVersion: THEME_RULE_VERSION,
      tradeDate,
      asOf: requestedAt,
      theme: { code: boardCode, name: snapshot.name },
      items,
      evidence: todayEvidence,
      coverage,
      status,
      warnings,
      error: null,
    };

    detailCache.set(detailCacheKey(tradeDate, boardCode), {
      value: body,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : '题材详情构建失败';
    // 有同键成功快照时保留它并标 stale；没有就是 unavailable
    const stale = detailCache.get(detailCacheKey(tradeDate, boardCode));
    if (stale && stale.expiresAt > Date.now() - STALE_GRACE_MS) {
      return { ...stale.value, status: 'stale', error: message };
    }
    return blankDetail(tradeDate, requestedAt, message, 'unavailable');
  }
};

/** 基本行情行（东财成分股快照 + 涨停池结构） */
const buildBaseItem = (
  member: BoardMember,
  boardCode: string,
  context: SharedContext,
  dayPool: DayPool,
  evidence: Evidence[],
): ThemeStockItem => {
  const poolRow = dayPool.rows.find((row) => row.symbol === member.symbol) ?? null;
  const selfTheme = (context.todayThemes.get(member.symbol) ?? []).find(
    (theme) => theme.code === boardCode,
  );
  const ownEvidence = evidence.filter((item) => item.symbol === member.symbol);
  return {
    symbol: member.symbol,
    name: member.name,
    price: member.price,
    pct: member.pct,
    boardCount: poolRow?.boardCount ?? null,
    firstSealTime: poolRow?.firstSealTime ?? null,
    sealType: poolRow?.sealType ?? null,
    openCount: poolRow?.openCount ?? null,
    sealAmount: poolRow?.sealAmount ?? null,
    turnoverRate: member.turnoverRate ?? poolRow?.turnoverRate ?? null,
    amount: member.amount,
    avgAmount3d: null,
    avgAmount5d: null,
    floatMarketCap: member.floatMarketCap ?? poolRow?.floatMarketCap ?? null,
    reason: ownEvidence.length > 0 ? ownEvidence.map((item) => item.text).join(' + ') : null,
    precise: selfTheme?.precise ?? null,
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
  };
};

// ---------------------------------------------------------------------------
// 旧接口兼容：/api/themes/:code/stocks?role=
// ---------------------------------------------------------------------------

/**
 * 兼容包装：调用同一个 `buildThemeDetail`，再按 roles 是否包含指定角色筛选。
 * **不保留第二套判定逻辑**；若已无调用方，可在后续单独清理。
 */
export const buildThemeStocks = async (
  tradeDate: string,
  boardCode: string,
  role: ThemeStockRole,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemeStocksResponse> => {
  const detail = await buildThemeDetail(tradeDate, boardCode, fetchImpl);
  const items: ThemeStockItem[] = detail.items
    .filter((item) => item.roles.some((entry) => entry.role === role))
    .map((item) => {
      const tag = item.roles.find((entry) => entry.role === role);
      const checks = item.checks[role] ?? [];
      const hits = checks.filter((check) => check.state === 'pass').map((check) => check.reason);
      const misses = checks
        .filter((check) => check.state !== 'pass')
        .map((check) => `${check.reason}（${checkStateLabel(check.state)}）`);
      return {
        ...item,
        hits: [...(tag?.reasons ?? []), ...hits],
        misses: [...(tag?.missingEvidence ?? []), ...misses],
      };
    })
    .slice(0, MAX_ITEMS);

  const status: Quote['status'] =
    detail.status === 'unavailable' ? 'unavailable' : detail.status === 'stale' ? 'stale' : 'fresh';

  return {
    tradeDate: detail.tradeDate,
    theme: detail.theme,
    role,
    items,
    scanned: detail.coverage.attempted,
    fetchedAt: detail.asOf,
    source: 'eastmoney+10jqka+tencent',
    status,
    error: detail.error,
  };
};

const checkStateLabel = (state: CheckState): string => {
  switch (state) {
    case 'pass':
      return '通过';
    case 'fail':
      return '不满足';
    case 'pending':
      return '待确认';
    case 'missing':
      return '数据缺失';
  }
};

export const THEME_DURATION_FLOOR = DURATION_DAILY_FLOOR;
