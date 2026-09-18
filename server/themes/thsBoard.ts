/**
 * 选股页「板块」档的同花顺口径（2026-09-18 起）。
 *
 * 数据全部来自同花顺 `block_top`（公开、无需 cookie、**支持历史日期**）：
 * 板块名 / 板块涨跌幅 / 涨停家数 / 连板家数 / 最高板 / 持续天数 / **该板块当日涨停成员**
 * （成员自带现价、涨跌幅、连板、首封时间、涨停原因），所以这一档不再需要
 * 东财 F10 归属、也不需要另外打行情或涨停池。
 *
 * ## 与东财口径的差别（页面必须如实披露，不能混着读）
 *
 * | | 同花顺（本文件） | 东财（`buildThemes`） |
 * | --- | --- | --- |
 * | 板块体系 | 同花顺概念（`885xxx` / `886xxx`） | 东财板块（`BK****`） |
 * | 覆盖 | **只有涨停板块 Top 20**（上游写死，参数无效） | 概念 504 + 行业 496，家数 ≥2 即列表 |
 * | 家数 | 上游 `limit_up_num` | 自算（涨停池 × F10 纯正归属） |
 * | 成员 | 该板块**当日涨停**成员 | 板块全部成员（含未涨停的） |
 * | 角色 / 本轮关联 / 风险 | **没有**，一律按缺失展示 | 有 |
 *
 * 所以「主线 / 支线」在这里只是把 Top 20 按涨停家数切一刀，
 * 不是东财口径那套「家数 + 持续性 + 名额」的判定，两者不可比。
 */
import type {
  ScreenerSource,
  ThemeDetailResponseV2,
  ThemeItem,
  ThemesResponse,
  ThemeStockV2,
} from '../../src/types.js';
import { getThsPoolRows } from '../limit-up/pool-cache.js';
import { fetchBlockTop, parseBoardCount, type BlockTopMember, type BlockTopRow } from './tenjqka.js';

/** 主线取涨停家数前几名（与东财口径的「名额前 3」保持一致，便于对照） */
const MAIN_SLOTS = 3;
/** 进主线的最低涨停家数 */
const MAIN_MIN_LIMIT_UP = 5;
/** 上游固定只给 Top 20，这里写进披露文案 */
const UPSTREAM_TOP_N = 20;

const RULE_VERSION = 'ths-block-top-v1';

/** 这一档的数据全部来自同花顺公开接口，不再是东财 + 同花顺混用 */
const THS_SOURCE: ScreenerSource = '10jqka';

const CACHE_TTL_MS = 5 * 60_000;

type Cached<T> = { value: T; expiresAt: number };

const boardsCache = new Map<string, Cached<ThemesResponse>>();
const detailCache = new Map<string, Cached<ThemeDetailResponseV2>>();

/** 测试用：清掉两个缓存 */
export const clearThsBoardCaches = (): void => {
  boardsCache.clear();
  detailCache.clear();
};

export const THS_BOARD_SCOPE_WARNINGS = [
  `上游（同花顺 block_top）固定只返回涨停板块 Top ${UPSTREAM_TOP_N}，参数无效：` +
    '第 20 名之后的板块（含只有 2~4 家涨停的支线）不在这里，看到的**不是全部板块**。',
  '家数 / 连板 / 最高板 / 持续天数都是同花顺口径，与东财板块、财联社概念不可直接对齐。',
  '该口径没有「驱动有依据 / 本轮关联 / 角色标签 / 风险核验」，这些字段一律按缺失展示。',
  '成员表按「连板高度 → 首封时间 → 封单额」排序，封单额 / 开板次数 / 换手率 / 流通市值来自当天同花顺涨停池。' +
    '这只是**描述谁更强**的机械口径，不是推荐，也不承诺收益。',
] as const;

const toItem = (row: BlockTopRow, rank: number, kind: 'main' | 'branch'): ThemeItem => {
  const reasons = [
    `同花顺涨停家数 ${row.limitUpCount ?? '—'}（当日第 ${rank} 名）`,
    kind === 'main'
      ? `涨停家数排在前 ${MAIN_SLOTS} 且 ≥${MAIN_MIN_LIMIT_UP}，进主线名额`
      : '在涨停家数排名之外，归入支线',
    '口径：同花顺概念板块（Top 20）',
  ];

  return {
    code: `THS:${row.code}`,
    name: row.name,
    kind,
    pct: row.pct,
    // 同花顺的 limit_up_num 就是涨停家数；缺了就如实给 0 而不是猜
    limitUpCount: row.limitUpCount ?? 0,
    continuousCount: row.continuousCount ?? 0,
    maxBoard: parseBoardCount(row.highLabel),
    maxBoardLabel: row.highLabel,
    durationDays: row.days ?? 0,
    amount: null,
    amountRatio: null,
    catalysts: [],
    leader: null,
    metrics: [],
    score: 0,
    classificationReasons: reasons,
    // 东财口径的三个家数在同花顺口径下没有对应值，保持 null（不是 0）
    conceptLimitUpCount: null,
    supportedLimitUpCount: null,
    unresolvedLimitUpCount: null,
    source: 'ths',
  };
};

const sortByLimitUp = (rows: BlockTopRow[]): BlockTopRow[] =>
  [...rows].sort((a, b) => (b.limitUpCount ?? 0) - (a.limitUpCount ?? 0) || a.code.localeCompare(b.code));

export const buildThsBoards = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemesResponse> => {
  const cacheKey = `${RULE_VERSION}|${tradeDate}`;
  const cached = boardsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fetchedAt = new Date().toISOString();
  const { rows, error } = await fetchBlockTop(tradeDate, fetchImpl);

  if (rows.length === 0) {
    const empty: ThemesResponse = {
      schemaVersion: 2,
      scope: 'ths',
      tradeDate,
      main: [],
      branch: [],
      pending: [],
      fetchedAt,
      source: THS_SOURCE,
      status: 'unavailable',
      warnings: [...THS_BOARD_SCOPE_WARNINGS],
      error: error?.message ?? '同花顺板块排行暂不可用',
    };
    return empty;
  }

  const sorted = sortByLimitUp(rows);
  const main: ThemeItem[] = [];
  const branch: ThemeItem[] = [];
  sorted.forEach((row, index) => {
    const rank = index + 1;
    const isMain = rank <= MAIN_SLOTS && (row.limitUpCount ?? 0) >= MAIN_MIN_LIMIT_UP;
    (isMain ? main : branch).push(toItem(row, rank, isMain ? 'main' : 'branch'));
  });

  const value: ThemesResponse = {
    schemaVersion: 2,
    scope: 'ths',
    tradeDate,
    main,
    branch,
    pending: [],
    fetchedAt,
    source: THS_SOURCE,
    // 上游只给 Top 20，本身就是「部分覆盖」：按 partial 处理，不假装是全市场板块榜
    status: 'partial',
    warnings: [...THS_BOARD_SCOPE_WARNINGS],
    error: null,
  };

  boardsCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
};

type PoolFields = {
  sealAmount: number | null;
  openCount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
};

const toMemberStock = (
  member: BlockTopMember,
  tradeDate: string,
  pool: PoolFields | undefined,
): ThemeStockV2 => ({
  symbol: member.symbol,
  name: member.name,
  price: member.price,
  pct: member.pct,
  boardCount: member.boardCount,
  firstSealTime: member.firstSealTime,
  sealType: member.changeTag,
  // 龙头口径要的四个字段：block_top 不给，从当天同花顺涨停池按代码 join（补不到就是 null）
  openCount: pool?.openCount ?? null,
  sealAmount: pool?.sealAmount ?? null,
  turnoverRate: pool?.turnoverRate ?? null,
  amount: null,
  avgAmount3d: null,
  avgAmount5d: null,
  floatMarketCap: pool?.floatMarketCap ?? null,
  reason: member.reasonTags.length > 0 ? member.reasonTags.join('+') : null,
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
  // 同花顺口径独有的两个展示字段：连板高度原文 + 涨停原因长文（AI 汇总稿）
  highLabel: member.highLabel,
  reasonText: member.reasonText,
  // 同花顺这个口径没有「本轮驱动」判定：一律 unknown，不编一个 supported/membership_only
  relation: {
    state: 'unknown',
    evidenceIds: [],
    reasons: ['同花顺板块口径不判定本轮驱动，只给「该板块当日涨停成员」'],
    alternativeThemeCodes: [],
    topicKeys: [],
    asOf: tradeDate,
  },
  roles: [],
  checks: {},
  // 形态 / 量能指标在这一档没有来源
  metricsState: 'missing',
  metricsTradeDate: null,
  risksChecked: false,
});

export const buildThsBoardDetail = async (
  tradeDate: string,
  rawCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemeDetailResponseV2> => {
  const code = rawCode.trim();
  const cacheKey = `${RULE_VERSION}|${tradeDate}|${code}`;
  const cached = detailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const asOf = new Date().toISOString();
  const { rows, error } = await fetchBlockTop(tradeDate, fetchImpl);
  const board = rows.find((row) => row.code === code) ?? null;

  if (board === null) {
    const missing: ThemeDetailResponseV2 = {
      schemaVersion: 2,
      ruleVersion: RULE_VERSION,
      tradeDate,
      asOf,
      theme: null,
      items: [],
      evidence: [],
      coverage: { total: 0, attempted: 0, succeeded: 0, failed: 0, unscanned: 0 },
      status: 'unavailable',
      warnings: [...THS_BOARD_SCOPE_WARNINGS],
      error:
        error?.message ??
        `该板块不在同花顺涨停板块 Top ${UPSTREAM_TOP_N} 内（上游只给前 ${UPSTREAM_TOP_N}）`,
    };
    return missing;
  }

  /*
   * 成员 = 该板块当日涨停股（上游 block_top 直接给）；
   * 再 join 当天同花顺涨停池补 封单额 / 开板次数 / 换手率 / 流通市值 —— 这四列是「谁更强」的
   * 判断依据（block_top 本身没有）。join 不上就留 null，不拿别的数字顶。
   */
  const { rows: poolRows } = await getThsPoolRows(tradeDate, fetchImpl);
  const poolBySymbol = new Map(poolRows.map((row) => [row.symbol, row]));

  const items = board.members
    .map((member) => {
      const row = poolBySymbol.get(member.symbol);
      return toMemberStock(
        member,
        tradeDate,
        row === undefined
          ? undefined
          : {
              sealAmount: row.sealAmount,
              openCount: row.openCount,
              turnoverRate: row.turnoverRate,
              floatMarketCap: row.floatMarketCap,
            },
      );
    })
    // 龙头口径的默认顺序：连板高度 → 首封时间 → 封单额（后面两项同级时比大小）
    .sort(
      (a, b) =>
        (b.boardCount ?? 0) - (a.boardCount ?? 0) ||
        (a.firstSealTime ?? '99:99:99').localeCompare(b.firstSealTime ?? '99:99:99') ||
        (b.sealAmount ?? 0) - (a.sealAmount ?? 0),
    );

  const value: ThemeDetailResponseV2 = {
    schemaVersion: 2,
    ruleVersion: RULE_VERSION,
    tradeDate,
    asOf,
    theme: { code: `THS:${board.code}`, name: board.name },
    items,
    evidence: [],
    // 成员 = 该板块当日涨停股，全部来自上游同一次响应，没有「未扫描」这回事
    coverage: {
      total: items.length,
      attempted: items.length,
      succeeded: items.length,
      failed: 0,
      unscanned: 0,
    },
    status: 'partial',
    warnings: [...THS_BOARD_SCOPE_WARNINGS],
    error: null,
  };

  detailCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
};
