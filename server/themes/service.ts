/**
 * 选股页的编排层：把三家上游缝成 /api/themes 与 /api/themes/:code/stocks。
 *
 * 关键设计：
 * - **题材骨架用东财板块**（BK 代码），「涨停家数」自己算：当日涨停股按 F10 纯正板块归属分组。
 *   这么做是因为同花顺 `block_top` 只给 Top 20，2~4 只涨停的支线题材根本不在里面。
 * - **同花顺板块代码用「成员重叠」反查**，不做中文名模糊匹配：
 *   `block_top` 每个板块带着它的涨停成员，而每个涨停成员在东财 F10 里的板块归属是已知的，
 *   谁的重叠最多就认谁。这比按名字匹配稳得多（同花顺「新能源汽车」vs 东财「新能源车」）。
 * - 已知偏差：F10 给的是**当前**题材归属，用在历史日期上有前视偏差。回测里也是这样，
 *   三档阈值方向一致，但页面上不该把这当成精确复现。
 */
import type {
  QuoteError,
  ThemeItem,
  ThemesResponse,
  ThemeStockItem,
  ThemeStockRole,
  ThemeStocksResponse,
} from '../../src/types.js';
import { fetchTencentMarket } from '../market/tencent.js';
import { limitUpPct } from '../watch/check.js';
import {
  DURATION_DAILY_FLOOR,
  toThemeItem,
  type ThemeClassifyInput,
  type ThemeLimitUpRow,
} from './classify.js';
import {
  fetchBoardCatalog,
  fetchBoardMembers,
  fetchRiskFlags,
  fetchSymbolThemes,
  type BoardCatalog,
  type BoardMember,
  type SymbolTheme,
} from './eastmoney.js';
import { computeStockMetrics, sectorAmounts, sectorPct20 } from './metrics.js';
import { judgeRole, type RoleStockInput } from './roles.js';
import {
  fetchBlockTop,
  fetchBoardKline,
  fetchLimitUpPool,
  fetchStockKline,
  type BlockTopRow,
  type KlineBar,
  type LimitUpPoolRow,
} from './tenjqka.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const KLINE_CONCURRENCY = 6;
/** 趋势/补涨标签需要拉日K的最大只数（漏斗第一级之后再截断） */
const MAX_SCAN = 120;
/** 每个标签最多返回多少只 */
const MAX_ITEMS = 60;
/** 历史回看天数（含当日） */
const HISTORY_DAYS = 6;
/**
 * 板块规模上限：纯正成员数超过这个规模的「板块」是宽口径属性题材
 * （如「央国企改革」1444 只），不是主线。用东财快照的涨跌家数之和做运行时代理，
 * 与回测脚本里 `MAX_BOARD_SIZE = 800` 对齐。
 */
const MAX_BOARD_SIZE = 800;

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
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
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
// 缓存
// ---------------------------------------------------------------------------

type Cached<T> = { value: T; expiresAt: number };
const catalogCache = new Map<string, Cached<BoardCatalog>>();
const themesCache = new Map<string, Cached<ThemesResponse>>();
const tradeDateCache = new Map<string, Cached<string[]>>();

export const clearThemeServiceCache = (): void => {
  catalogCache.clear();
  themesCache.clear();
  tradeDateCache.clear();
};

const getCatalog = async (fetchImpl: typeof fetch): Promise<BoardCatalog> => {
  const cached = catalogCache.get('all');
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchBoardCatalog(fetchImpl);
  catalogCache.set('all', { value, expiresAt: Date.now() + 60_000 });
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
// /api/themes
// ---------------------------------------------------------------------------

type SharedContext = {
  catalog: BoardCatalog;
  boardTopRows: BlockTopRow[];
  /** 东财板块代码 → 同花顺板块代码（用于取板块日K） */
  boardCodeMap: Map<string, string>;
  poolRows: LimitUpPoolRow[];
  poolBySymbol: Map<string, LimitUpPoolRow>;
  symbolThemes: Map<string, SymbolTheme[]>;
  /** 交易日列表，从旧到新，最后一个是 tradeDate */
  historyDates: string[];
  /** 每个历史日期的涨停股 → 题材归属 */
  historyThemes: Map<string, Map<string, SymbolTheme[]>>;
  marketAmount: number | null;
  indexPct: number | null;
  errors: QuoteError[];
};

const loadSharedContext = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<SharedContext> => {
  const errors: QuoteError[] = [];

  const catalog = await getCatalog(fetchImpl);

  const [pool, boardTop, market] = await Promise.all([
    fetchLimitUpPool(tradeDate, fetchImpl),
    fetchBlockTop(tradeDate, fetchImpl),
    fetchTencentMarket().catch(() => null),
  ]);
  if (pool.error) errors.push(pool.error);
  if (boardTop.error) errors.push(boardTop.error);

  const poolBySymbol = new Map(pool.rows.map((row) => [row.symbol, row]));

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

  // 今日涨停股的题材归属：这是「涨停家数」自算的基础
  const todaySymbols = pool.rows.map((row) => row.symbol);
  let symbolThemes = new Map<string, SymbolTheme[]>();
  try {
    symbolThemes = await fetchSymbolThemes(todaySymbols, catalog, fetchImpl);
  } catch (error) {
    errors.push({
      symbol: tradeDate,
      message: error instanceof Error ? error.message : '题材归属请求失败',
    });
  }

  // 历史日期：用于「持续时间」与「回流能力」
  const recentDates = await fetchRecentTradeDates(HISTORY_DAYS, fetchImpl);
  const historyDates = recentDates.length > 0 ? recentDates : [tradeDate];
  const historyThemes = new Map<string, Map<string, SymbolTheme[]>>();
  historyThemes.set(tradeDate, symbolThemes);

  const pastDates = historyDates.filter((date) => date !== tradeDate).slice(-(HISTORY_DAYS - 1));
  const pastPools = await mapLimit(pastDates, 3, async (date) => ({
    date,
    pool: await fetchLimitUpPool(date, fetchImpl),
  }));

  const pastSymbols = new Set<string>();
  for (const item of pastPools) {
    for (const row of item.pool.rows) pastSymbols.add(row.symbol);
  }
  const missing = [...pastSymbols].filter((symbol) => !symbolThemes.has(symbol));

  let pastThemes = new Map<string, SymbolTheme[]>();
  try {
    pastThemes = missing.length > 0 ? await fetchSymbolThemes(missing, catalog, fetchImpl) : new Map();
  } catch (error) {
    errors.push({
      symbol: tradeDate,
      message: error instanceof Error ? error.message : '历史题材归属请求失败',
    });
  }

  for (const item of pastPools) {
    const perDate = new Map<string, SymbolTheme[]>();
    for (const row of item.pool.rows) {
      const themes = symbolThemes.get(row.symbol) ?? pastThemes.get(row.symbol);
      if (themes) perDate.set(row.symbol, themes);
    }
    historyThemes.set(item.date, perDate);
  }

  return {
    catalog,
    boardTopRows: boardTop.rows,
    boardCodeMap: mapBoardTopByMembership(boardTop.rows, symbolThemes),
    poolRows: pool.rows,
    poolBySymbol,
    symbolThemes,
    historyDates,
    historyThemes,
    marketAmount,
    indexPct,
    errors,
  };
};

/**
 * 每个板块在最近若干交易日的涨停家数（index 0 = 今天）。
 * 用当前 F10 题材归属去套历史涨停名单，存在前视偏差（已在文档里写明）。
 */
const buildHistoryCounts = (
  boardCode: string,
  context: SharedContext,
  tradeDate: string,
): number[] => {
  const ordered = [...context.historyDates];
  const todayIndex = ordered.indexOf(tradeDate);
  const series: string[] = todayIndex >= 0 ? ordered.slice(0, todayIndex + 1) : [tradeDate];
  series.reverse(); // index 0 = 今天

  return series.map((date) => {
    const themes = context.historyThemes.get(date);
    if (!themes) return 0;
    let count = 0;
    for (const list of themes.values()) {
      if (list.some((theme) => theme.code === boardCode)) count += 1;
    }
    return count;
  });
};

const buildBoardLimitUpRows = (
  boardCode: string,
  context: SharedContext,
): ThemeLimitUpRow[] =>
  context.poolRows
    .filter((row) =>
      (context.symbolThemes.get(row.symbol) ?? []).some((theme) => theme.code === boardCode),
    )
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      boardCount: row.boardCount,
      firstSealTime: row.firstSealTime,
      reasonTags: row.reasonTags,
    }));

export const buildThemes = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemesResponse> => {
  const cached = themesCache.get(tradeDate);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fetchedAt = new Date().toISOString();
  const empty: ThemesResponse = {
    tradeDate,
    main: [],
    branch: [],
    fetchedAt,
    source: 'eastmoney+10jqka',
    status: 'unavailable',
    error: null,
  };

  try {
    const context = await loadSharedContext(tradeDate, fetchImpl);

    // 候选板块：当日涨停家数 ≥2（支线也要能出现，所以不用 Top 20 截断）
    const counts = new Map<string, number>();
    for (const row of context.poolRows) {
      for (const theme of context.symbolThemes.get(row.symbol) ?? []) {
        counts.set(theme.code, (counts.get(theme.code) ?? 0) + 1);
      }
    }

    const candidates = [...counts.entries()]
      .filter(([, count]) => count >= DURATION_DAILY_FLOOR)
      .map(([code]) => code)
      .filter((code) => {
        const snapshot = context.catalog.get(code);
        if (!snapshot) return false;
        const breadth = (snapshot.upCount ?? 0) + (snapshot.downCount ?? 0);
        // 快照没给涨跌家数时不做规模过滤，避免误杀
        return breadth === 0 || breadth <= MAX_BOARD_SIZE;
      });

    const items: ThemeItem[] = [];
    for (const code of candidates) {
      const snapshot = context.catalog.get(code);
      if (!snapshot) continue;

      const limitUpRows = buildBoardLimitUpRows(code, context);
      const historyCounts = buildHistoryCounts(code, context, tradeDate);

      // 板块成交额历史：同花顺 bk 日K（需要同花顺板块代码）
      let amounts: number[] = [];
      const tonghuashunCode =
        context.boardCodeMap.get(code) ?? resolveBoardCodeByName(snapshot.name, context.boardTopRows);
      if (tonghuashunCode) {
        const bars = await fetchBoardKline(tonghuashunCode, fetchImpl);
        amounts = sectorAmounts(bars);
      }
      // 历史成交额取不到时，至少把当日成交额（东财，精确）补上
      if (amounts.length === 0 && isPositive(snapshot.amount)) amounts = [snapshot.amount];

      const input: ThemeClassifyInput = {
        code,
        name: snapshot.name,
        pct: snapshot.pct,
        limitUpRows,
        amounts,
        marketAmount: context.marketAmount,
        indexPct: context.indexPct,
        historyCounts,
      };

      const item = toThemeItem(input);
      if (item) items.push(item);
    }

    const main = items
      .filter((item) => item.kind === 'main')
      .sort((a, b) => b.score - a.score || b.limitUpCount - a.limitUpCount);
    const branch = items
      .filter((item) => item.kind === 'branch')
      .sort((a, b) => b.limitUpCount - a.limitUpCount || b.score - a.score);

    const body: ThemesResponse = {
      tradeDate,
      main,
      branch,
      fetchedAt,
      source: 'eastmoney+10jqka',
      status: resolvePoolStatus(context),
      error: context.errors.length > 0 ? context.errors[0].message : null,
    };

    if (body.status !== 'unavailable') {
      themesCache.set(tradeDate, { value: body, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return body;
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : '题材数据构建失败',
    };
  }
};

const resolvePoolStatus = (context: SharedContext): ThemesResponse['status'] =>
  context.poolRows.length > 0 ? 'fresh' : context.errors.length > 0 ? 'unavailable' : 'fresh';

// ---------------------------------------------------------------------------
// /api/themes/:code/stocks
// ---------------------------------------------------------------------------

type RoleMinimum = Record<ThemeStockRole, number>;
const ROLE_MIN_HITS: RoleMinimum = { leader: 4, turnover: 4, trend: 6, laggard: 4 };

const toRoleInput = (
  symbol: string,
  name: string,
  isSt: boolean,
  member: BoardMember | null,
  poolRow: LimitUpPoolRow | null,
  metrics: ReturnType<typeof computeStockMetrics>,
  sectorPct: number | null,
  extras: {
    startRankInSector: number | null;
    boardRankInSector: number | null;
    followersAfterFirstSeal: number | null;
    leaderTags: string[];
    precise: boolean | null;
    risksChecked: boolean;
    risks: string[];
  },
): RoleStockInput => ({
  symbol,
  name,
  inLimitUpPool: poolRow !== null,
  boardCount: poolRow?.boardCount ?? null,
  firstSealTime: poolRow?.firstSealTime ?? null,
  lastSealTime: poolRow?.lastSealTime ?? null,
  sealType: poolRow?.sealType ?? null,
  openCount: poolRow?.openCount ?? null,
  sealAmount: poolRow?.sealAmount ?? null,
  turnoverRate: member?.turnoverRate ?? poolRow?.turnoverRate ?? null,
  amount: member?.amount ?? null,
  floatMarketCap: member?.floatMarketCap ?? poolRow?.floatMarketCap ?? null,
  reasonTags: poolRow?.reasonTags ?? [],
  precise: extras.precise,
  isSt,
  risksChecked: extras.risksChecked,
  risks: extras.risks,
  startRankInSector: extras.startRankInSector,
  boardRankInSector: extras.boardRankInSector,
  followersAfterFirstSeal: extras.followersAfterFirstSeal,
  leaderTags: extras.leaderTags,
  ma5: metrics.ma5,
  ma10: metrics.ma10,
  ma20: metrics.ma20,
  distMa5: metrics.distMa5,
  distMa10: metrics.distMa10,
  stableDays10: metrics.stableDays10,
  pct10: metrics.pct10,
  pct20: metrics.pct20,
  sectorPct20: sectorPct,
  avgAmount3d: metrics.avgAmount3d,
  avgAmount5d: metrics.avgAmount5d,
  upDownVolumeRatio: metrics.upDownVolumeRatio,
  limitUpIn20d: metrics.limitUpIn20d,
  limitUpIn60d: metrics.limitUpIn60d,
  breakout20: metrics.breakout20,
  breakout60: metrics.breakout60,
  ownBreakoutDate: metrics.ownBreakoutDate,
  leaderFirstSealDate: null,
  resilientOnSectorDown: metrics.resilientOnSectorDown,
});

export const buildThemeStocks = async (
  tradeDate: string,
  boardCode: string,
  role: ThemeStockRole,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemeStocksResponse> => {
  const fetchedAt = new Date().toISOString();
  const blank: ThemeStocksResponse = {
    tradeDate,
    theme: null,
    role,
    items: [],
    scanned: 0,
    fetchedAt,
    source: 'eastmoney+10jqka+tencent',
    status: 'unavailable',
    error: null,
  };

  try {
    const context = await loadSharedContext(tradeDate, fetchImpl);
    const snapshot = context.catalog.get(boardCode);
    if (!snapshot) {
      return { ...blank, error: `未知板块 ${boardCode}` };
    }

    const members = await fetchBoardMembers(boardCode, fetchImpl);
    if (members.length === 0) {
      return { ...blank, theme: { code: boardCode, name: snapshot.name }, error: '板块没有成分股数据' };
    }

    const memberBySymbol = new Map(members.map((member) => [member.symbol, member]));

    // 板块日K（用于 sectorPct20 / 抗跌性 / 补涨滞后度）
    const tonghuashunCode =
      context.boardCodeMap.get(boardCode) ?? resolveBoardCodeByName(snapshot.name, context.boardTopRows);
    const sectorBars = tonghuashunCode ? await fetchBoardKline(tonghuashunCode, fetchImpl) : [];
    const sectorPct = sectorPct20(sectorBars);

    // 本板块今日涨停股
    const boardLimitUp = context.poolRows.filter((row) =>
      (context.symbolThemes.get(row.symbol) ?? []).some((theme) => theme.code === boardCode),
    );
    const boardLimitUpBySymbol = new Map(boardLimitUp.map((row) => [row.symbol, row]));

    // 龙头标签与首板时间，用于补涨/龙头的相对判断
    const leader = [...boardLimitUp].sort(
      (a, b) => (b.boardCount ?? 1) - (a.boardCount ?? 1) ||
        (a.firstSealTime ?? '99:99:99').localeCompare(b.firstSealTime ?? '99:99:99'),
    )[0];

    // 选出要拉日K的股票
    let targets: BoardMember[];
    if (role === 'leader' || role === 'turnover') {
      targets = boardLimitUp
        .map((row) => memberBySymbol.get(row.symbol))
        .filter((member): member is BoardMember => member !== undefined);
    } else if (role === 'trend') {
      targets = members
        .filter(
          (member) =>
            (member.symbol.startsWith('60') || member.symbol.startsWith('00')) &&
            !/ST/i.test(member.name) &&
            (member.amount ?? 0) >= 3.5e8,
        )
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, MAX_SCAN);
    } else {
      targets = members
        .filter(
          (member) =>
            !/ST/i.test(member.name) &&
            (member.floatMarketCap ?? 0) >= 45e8 &&
            (member.floatMarketCap ?? 0) <= 320e8 &&
            (member.amount ?? 0) >= 5e7,
        )
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, MAX_SCAN);
    }

    const klines = await mapLimit(targets, KLINE_CONCURRENCY, async (member) => ({
      symbol: member.symbol,
      bars: await fetchStockKline(member.symbol, fetchImpl),
    }));
    const barsBySymbol = new Map(klines.map((item) => [item.symbol, item.bars]));

    // 板块内「首次启动」名次：用近 20 日内最早一次涨停日排序
    const startDates = new Map<string, string>();
    for (const row of boardLimitUp) {
      const bars = barsBySymbol.get(row.symbol) ?? [];
      const firstDate = firstLimitUpDate(bars, row.symbol, row.name);
      if (firstDate) startDates.set(row.symbol, firstDate);
    }
    const startRank = new Map<string, number>();
    [...startDates.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([symbol], index) => startRank.set(symbol, index + 1));

    const boardRank = new Map<string, number>();
    [...boardLimitUp]
      .sort((a, b) => (b.boardCount ?? 1) - (a.boardCount ?? 1))
      .forEach((row, index) => boardRank.set(row.symbol, index + 1));

    const leaderTags = leader?.reasonTags ?? [];

    const candidates: Array<{ member: BoardMember; input: RoleStockInput }> = [];
    for (const member of targets) {
      const bars = barsBySymbol.get(member.symbol) ?? [];
      if (bars.length < 21) continue;
      const poolRow = boardLimitUpBySymbol.get(member.symbol) ?? null;
      const metrics = computeStockMetrics(bars, member.symbol, member.name, sectorBars);
      const themes = context.symbolThemes.get(member.symbol) ?? [];
      const selfTheme = themes.find((theme) => theme.code === boardCode);

      const followers =
        poolRow?.firstSealTime == null
          ? null
          : boardLimitUp.filter(
              (row) =>
                row.firstSealTime !== null &&
                row.firstSealTime > (poolRow.firstSealTime as string),
            ).length;

      const input = toRoleInput(
        member.symbol,
        member.name,
        /ST/i.test(member.name),
        member,
        poolRow,
        metrics,
        sectorPct,
        {
          startRankInSector: startRank.get(member.symbol) ?? null,
          boardRankInSector: boardRank.get(member.symbol) ?? null,
          followersAfterFirstSeal: followers,
          leaderTags,
          precise: selfTheme?.precise ?? null,
          risksChecked: false,
          risks: [],
        },
      );
      candidates.push({ member, input });
    }

    // 先判定，再只对进入结果集的股票查风险（避免几百次上游请求）
    const judged = candidates
      .map(({ member, input }) => {
        const verdict = judgeRole(role, input);
        return { member, input, verdict, score: verdict.hits.length };
      })
      .filter((item) => item.score >= ROLE_MIN_HITS[role])
      .sort((a, b) => b.score - a.score || (b.member.amount ?? 0) - (a.member.amount ?? 0))
      .slice(0, MAX_ITEMS);

    let riskMap = new Map<string, { checked: boolean; flags: string[] }>();
    try {
      riskMap = await fetchRiskFlags(
        judged.map((item) => item.member.symbol),
        fetchImpl,
      );
    } catch {
      riskMap = new Map();
    }

    const items: ThemeStockItem[] = judged.map(({ member, input, verdict }) => {
      const risk = riskMap.get(member.symbol);
      const risks = risk?.flags ?? [];
      // 风险核验结果要回填到判定里：没查到风险数据时不能说「未见风险」
      const finalVerdict = risk
        ? judgeRole(role, { ...input, risksChecked: risk.checked, risks })
        : verdict;
      return {
        symbol: member.symbol,
        name: member.name,
        price: member.price,
        pct: member.pct,
        boardCount: input.boardCount,
        firstSealTime: input.firstSealTime,
        sealType: input.sealType,
        openCount: input.openCount,
        sealAmount: input.sealAmount,
        turnoverRate: input.turnoverRate,
        amount: input.amount,
        avgAmount3d: input.avgAmount3d,
        avgAmount5d: input.avgAmount5d,
        floatMarketCap: input.floatMarketCap,
        reason: input.reasonTags.length > 0 ? input.reasonTags.join(' + ') : null,
        precise: input.precise,
        hits: finalVerdict.hits,
        misses: finalVerdict.misses,
        risks,
        ma5: input.ma5,
        ma10: input.ma10,
        ma20: input.ma20,
        maBull: input.ma5 !== null && input.ma10 !== null && input.ma20 !== null
          ? input.ma5 > input.ma10 && input.ma10 > input.ma20
          : null,
        distMa5: input.distMa5,
        distMa10: input.distMa10,
        stableDays10: input.stableDays10,
        pct10: input.pct10,
        pct20: input.pct20,
        limitUpIn60d: input.limitUpIn60d,
      };
    });

    return {
      tradeDate,
      theme: { code: boardCode, name: snapshot.name },
      role,
      items,
      scanned: targets.length,
      fetchedAt,
      source: 'eastmoney+10jqka+tencent',
      status: 'fresh',
      error: null,
    };
  } catch (error) {
    return {
      ...blank,
      error: error instanceof Error ? error.message : '题材详情构建失败',
    };
  }
};

/** 近 20 日内最早一次涨停的日期 */
const firstLimitUpDate = (
  bars: KlineBar[],
  symbol: string,
  name: string,
): string | null => {
  if (bars.length < 2) return null;
  const limit = limitUpPct(symbol, name) / 100;
  const start = Math.max(1, bars.length - 20);
  for (let index = start; index < bars.length; index += 1) {
    const previous = bars[index - 1].close;
    if (previous > 0 && bars[index].close >= Math.round(previous * (1 + limit) * 100) / 100 - 0.001) {
      return bars[index].date;
    }
  }
  return null;
};

