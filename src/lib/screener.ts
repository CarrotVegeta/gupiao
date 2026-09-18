import type {
  CheckResult,
  CheckState,
  Evidence,
  Quote,
  RelationState,
  RoleTag,
  ScanCoverage,
  ScreenerDataStatus,
  ThemeDetailResponseV2,
  ThemeItem,
  ThemeMetric,
  ThemeRelation,
  ThemeStockV2,
  ThemesResponse,
  TrendPick,
  TrendScanResponse,
} from '../types';

const THEMES_ENDPOINT = '/api/themes';
const TREND_ENDPOINT = '/api/screener/trend';
const FORMAT_ERROR = '选股响应数据格式错误';

/**
 * 回测结论，固定显示在形态扫描页头。
 * 2026-09-18 修正：不再用「已被回测否定 / 毒源」这类确定性表述，
 * 改为审查报告第 8 节的受限结论——只说明本项目既有样本的观察结果与已知限制。
 */
export const TREND_EVIDENCE = {
  headline: '本项目既有样本中，原五条件组合未表现出收益优势',
  lines: [
    '全市场命中形态：次日开盘超额 −0.141%（t=−2.56），T+10 −1.440%（t=−3.28）',
    '主线板块 ∩ 形态：次日开盘 −0.162%（t=−2.60），T+10 −1.788%（t=−3.73）—— 加「主线」过滤反而更差',
    '归因线索：只加「MA5>MA10>MA20」这一步，主线池 T+10 超额从 +0.084% 到 −2.426%（t=−2.25）',
    '该研究存在历史归属、入场口径、样本重叠等限制，不代表所有趋势方法无效',
  ],
  footer:
    '样本 2026-02-26 ~ 2026-09-16，114 个交易日，超额口径为「相对当日全市场等权」。页面用于形态与题材结构观察，不构成任何买入建议。',
} as const;

export const THEME_EVIDENCE =
  '题材口径（2026-09-18 起）：题材单位是**涨停原因里的细分逻辑**（如「光通信」「先进封装」），' +
  '不是东财宽概念板块——宽概念的家数等于子题材并集，按家数排名必然选出「华为概念 / 人工智能」这种凑数的宽概念。' +
  '家数与持续性都按各日自己的涨停原因统计，没有「用当前成分股回算历史」的前视偏差；' +
  'K线形态 / 角色标签 / 风险核验尚未在题材口径接入，按缺失披露。' +
  '另外，原板块口径的「主线」回测只有微弱正超额（B 档 T+1 +0.059%，t=2.03）、样本外衰减且低于手续费，' +
  '细分逻辑口径本身尚未回测。以上都只是结构展示，不构成买入建议。';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is Quote['status'] =>
  value === 'fresh' || value === 'stale' || value === 'unavailable';

/** v2 的四态数据状态：partial 是「有可用结果但有缺失」，不能被当成空列表 */
const isDataStatus = (value: unknown): value is ScreenerDataStatus =>
  value === 'fresh' || value === 'partial' || value === 'stale' || value === 'unavailable';

const isCheckState = (value: unknown): value is CheckState =>
  value === 'pass' || value === 'fail' || value === 'pending' || value === 'missing';

const isRelationState = (value: unknown): value is RelationState =>
  value === 'supported' ||
  value === 'possible' ||
  value === 'membership_only' ||
  value === 'other_driver' ||
  value === 'unknown';

const isParseableDateTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isTradeDate = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && /^\d{8}$/.test(value));

const isMetric = (value: unknown): value is ThemeMetric =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  typeof value.label === 'string' &&
  typeof value.hit === 'boolean' &&
  typeof value.value === 'string' &&
  typeof value.detail === 'string';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isThemeItem = (value: unknown): value is ThemeItem =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  // 板块口径是 BK 代码；细分逻辑口径是 TP: + 涨停原因标签
  /^(BK\d{4}|TP:.+)$/.test(value.code) &&
  (value.source === undefined || value.source === 'board' || value.source === 'topic') &&
  typeof value.name === 'string' &&
  (value.kind === 'main' || value.kind === 'branch') &&
  isNullableNumber(value.pct) &&
  typeof value.limitUpCount === 'number' &&
  typeof value.continuousCount === 'number' &&
  isNullableNumber(value.maxBoard) &&
  (value.maxBoardLabel === null || typeof value.maxBoardLabel === 'string') &&
  typeof value.durationDays === 'number' &&
  isNullableNumber(value.amount) &&
  isNullableNumber(value.amountRatio) &&
  Array.isArray(value.catalysts) &&
  (value.leader === null || isRecord(value.leader)) &&
  Array.isArray(value.metrics) &&
  value.metrics.every(isMetric) &&
  typeof value.score === 'number' &&
  // v2 新增：分类依据与三个口径的家数（缺失必须是 null，不能是 0）
  isStringArray(value.classificationReasons) &&
  isNullableNumber(value.conceptLimitUpCount) &&
  isNullableNumber(value.supportedLimitUpCount) &&
  isNullableNumber(value.unresolvedLimitUpCount);

const isScanCoverage = (value: unknown): value is ScanCoverage =>
  isRecord(value) &&
  typeof value.total === 'number' &&
  typeof value.attempted === 'number' &&
  typeof value.succeeded === 'number' &&
  typeof value.failed === 'number' &&
  typeof value.unscanned === 'number' &&
  value.attempted === value.succeeded + value.failed &&
  value.total === value.attempted + value.unscanned;

const isEvidence = (value: unknown): value is Evidence =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.themeCode === 'string' &&
  typeof value.symbol === 'string' &&
  (value.sourceKind === 'limit_up_reason' ||
    value.sourceKind === 'announcement' ||
    value.sourceKind === 'event' ||
    value.sourceKind === 'manual') &&
  typeof value.sourceName === 'string' &&
  (value.sourceUrl === null || typeof value.sourceUrl === 'string') &&
  typeof value.text === 'string' &&
  (value.publishedAt === null || typeof value.publishedAt === 'string') &&
  typeof value.observedAt === 'string' &&
  typeof value.validTradeDate === 'string' &&
  (value.topicKey === null || typeof value.topicKey === 'string') &&
  (value.match === 'exact' || value.match === 'ambiguous' || value.match === 'unrelated');

const isRelation = (value: unknown): value is ThemeRelation =>
  isRecord(value) &&
  isRelationState(value.state) &&
  isStringArray(value.evidenceIds) &&
  isStringArray(value.reasons) &&
  isStringArray(value.alternativeThemeCodes) &&
  isStringArray(value.topicKeys) &&
  typeof value.asOf === 'string';

const isCheckResult = (value: unknown): value is CheckResult =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  isCheckState(value.state) &&
  (value.value === null ||
    typeof value.value === 'number' ||
    typeof value.value === 'string' ||
    typeof value.value === 'boolean') &&
  typeof value.reason === 'string' &&
  isStringArray(value.evidenceIds);

const isRoleTag = (value: unknown): value is RoleTag =>
  isRecord(value) &&
  (value.role === 'leader' ||
    value.role === 'turnover' ||
    value.role === 'trend' ||
    value.role === 'laggard') &&
  (value.status === 'candidate' || value.status === 'confirmed') &&
  isStringArray(value.reasons) &&
  isStringArray(value.missingEvidence) &&
  typeof value.assignedAt === 'string' &&
  typeof value.ruleVersion === 'string';

const isThemeStockV2 = (value: unknown): value is ThemeStockV2 =>
  isRecord(value) &&
  typeof value.symbol === 'string' &&
  /^\d{6}$/.test(value.symbol) &&
  typeof value.name === 'string' &&
  value.name.trim().length > 0 &&
  isNullableNumber(value.price) &&
  isNullableNumber(value.pct) &&
  isNullableNumber(value.boardCount) &&
  isNullableNumber(value.turnoverRate) &&
  isNullableNumber(value.amount) &&
  isNullableNumber(value.floatMarketCap) &&
  isRelation(value.relation) &&
  Array.isArray(value.roles) &&
  value.roles.every(isRoleTag) &&
  isRecord(value.checks) &&
  Object.values(value.checks).every(
    (list) => Array.isArray(list) && list.every(isCheckResult),
  ) &&
  (value.metricsState === 'ready' ||
    value.metricsState === 'missing' ||
    value.metricsState === 'failed') &&
  isTradeDate(value.metricsTradeDate) &&
  typeof value.risksChecked === 'boolean';

const isTrendPick = (value: unknown): value is TrendPick =>
  isRecord(value) &&
  typeof value.symbol === 'string' &&
  /^\d{6}$/.test(value.symbol) &&
  typeof value.name === 'string' &&
  Array.isArray(value.themes) &&
  isNullableNumber(value.price) &&
  isNullableNumber(value.pct) &&
  isNullableNumber(value.ma5) &&
  isNullableNumber(value.ma10) &&
  isNullableNumber(value.ma20) &&
  isNullableNumber(value.distMa5) &&
  isNullableNumber(value.stableDays) &&
  isNullableNumber(value.shrink) &&
  isNullableNumber(value.pctWindow) &&
  isNullableNumber(value.avgAmount5d) &&
  isNullableNumber(value.turnoverRate) &&
  Array.isArray(value.matched) &&
  Array.isArray(value.unmatched);

// ---------------------------------------------------------------------------
// 题材总览
// ---------------------------------------------------------------------------

export const unavailableThemes = (error: string | null = FORMAT_ERROR): ThemesResponse => ({
  schemaVersion: 2,
  scope: 'topic',
  tradeDate: null,
  main: [],
  branch: [],
  pending: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney+10jqka',
  status: 'unavailable',
  warnings: [],
  error,
});

export const toThemesResponse = (payload: unknown): ThemesResponse => {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== 2 ||
    !Array.isArray(payload.main) ||
    !payload.main.every(isThemeItem) ||
    !Array.isArray(payload.branch) ||
    !payload.branch.every(isThemeItem) ||
    !Array.isArray(payload.pending) ||
    !payload.pending.every(isThemeItem) ||
    !isDataStatus(payload.status) ||
    !isTradeDate(payload.tradeDate) ||
    !isParseableDateTime(payload.fetchedAt) ||
    !isStringArray(payload.warnings) ||
    !(typeof payload.error === 'string' || payload.error === null) ||
    !(payload.scope === undefined || payload.scope === 'board' || payload.scope === 'topic')
  ) {
    return unavailableThemes(FORMAT_ERROR);
  }

  // fresh 不允许带 error；partial 允许（有可用结果 + 明确缺口）
  if (payload.status === 'fresh' && (payload.tradeDate === null || payload.error !== null)) {
    return unavailableThemes(FORMAT_ERROR);
  }

  if (payload.status === 'unavailable') {
    return { ...unavailableThemes(payload.error), fetchedAt: payload.fetchedAt };
  }

  return {
    schemaVersion: 2,
    // 缺省按 board 处理：没有 scope 的响应都是题材页切到 TP 口径之前的旧板块快照
    scope: payload.scope === 'topic' ? 'topic' : 'board',
    tradeDate: payload.tradeDate,
    main: payload.main,
    branch: payload.branch,
    pending: payload.pending,
    fetchedAt: payload.fetchedAt,
    source: 'eastmoney+10jqka',
    status: payload.status,
    warnings: payload.warnings,
    error: payload.error,
  };
};

export const fetchThemes = async (
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemesResponse> => {
  const url =
    typeof date === 'string' ? `${THEMES_ENDPOINT}?date=${encodeURIComponent(date)}` : THEMES_ENDPOINT;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`题材请求失败（${response.status}）`);

  try {
    return toThemesResponse(await response.json());
  } catch {
    throw new Error(FORMAT_ERROR);
  }
};

export const mergeThemes = (
  previous: ThemesResponse | null | undefined,
  response: ThemesResponse,
): ThemesResponse => {
  if (response.status === 'fresh' || response.status === 'partial') return response;
  const usable =
    previous != null &&
    previous.tradeDate !== null &&
    (previous.status === 'fresh' || previous.status === 'partial' || previous.status === 'stale');
  if (!usable) {
    return {
      ...response,
      tradeDate: null,
      main: [],
      branch: [],
      pending: [],
      status: 'unavailable',
    };
  }
  return { ...previous, status: 'stale', error: response.error };
};

// ---------------------------------------------------------------------------
// 题材详情（v2：一张表 + 角色标签）
// ---------------------------------------------------------------------------

export const unavailableThemeDetail = (
  error: string | null = FORMAT_ERROR,
): ThemeDetailResponseV2 => ({
  schemaVersion: 2,
  ruleVersion: 'unknown',
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

export const toThemeDetailResponse = (payload: unknown): ThemeDetailResponseV2 => {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== 2 ||
    typeof payload.ruleVersion !== 'string' ||
    !isTradeDate(payload.tradeDate) ||
    !isParseableDateTime(payload.asOf) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isThemeStockV2) ||
    !Array.isArray(payload.evidence) ||
    !payload.evidence.every(isEvidence) ||
    !isScanCoverage(payload.coverage) ||
    !isDataStatus(payload.status) ||
    !isStringArray(payload.warnings) ||
    !(typeof payload.error === 'string' || payload.error === null) ||
    !(payload.theme === null || isRecord(payload.theme))
  ) {
    return unavailableThemeDetail(FORMAT_ERROR);
  }

  if (payload.status === 'fresh' && (payload.tradeDate === null || payload.error !== null)) {
    return unavailableThemeDetail(FORMAT_ERROR);
  }

  if (payload.status === 'unavailable') {
    return { ...unavailableThemeDetail(payload.error), asOf: payload.asOf };
  }

  const theme = isRecord(payload.theme) ? payload.theme : null;
  return {
    schemaVersion: 2,
    ruleVersion: payload.ruleVersion,
    tradeDate: payload.tradeDate,
    asOf: payload.asOf,
    theme:
      theme && typeof theme.code === 'string' && typeof theme.name === 'string'
        ? { code: theme.code, name: theme.name }
        : null,
    items: payload.items,
    evidence: payload.evidence,
    coverage: payload.coverage,
    status: payload.status,
    warnings: payload.warnings,
    error: payload.error,
  };
};

/** 题材详情请求：支持 AbortSignal，用于「最新请求保护」 */
export const fetchThemeDetail = async (
  code: string,
  date?: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemeDetailResponseV2> => {
  const params = new URLSearchParams();
  if (typeof date === 'string') params.set('date', date);
  const query = params.toString();
  // 细分逻辑题材走 /api/topics/:key/detail；板块口径走 /api/themes/:code/detail
  const endpoint = code.startsWith('TP:')
    ? `/api/topics/${encodeURIComponent(code.slice(3))}/detail`
    : `${THEMES_ENDPOINT}/${encodeURIComponent(code)}/detail`;
  const response = await fetchImpl(
    `${endpoint}${query ? `?${query}` : ''}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error(`题材详情请求失败（${response.status}）`);

  try {
    return toThemeDetailResponse(await response.json());
  } catch {
    throw new Error(FORMAT_ERROR);
  }
};

// ---------------------------------------------------------------------------
// 趋势形态扫描
// ---------------------------------------------------------------------------

/**
 * 趋势扫描响应在基础契约之上带覆盖披露字段（coverage / matchedTotal / returnedCount /
 * truncated / metricsTradeDate / quoteAsOf）。这些字段缺失时降级为「未披露」，
 * 但不会因此把响应整体判为格式错误。
 */
export type TrendCoverage = {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unscanned: number;
};

export type TrendScanResponseV2 = TrendScanResponse & {
  coverage: TrendCoverage | null;
  matchedTotal: number | null;
  returnedCount: number | null;
  truncated: boolean;
  metricsTradeDate: string | null;
  quoteAsOf: string | null;
};

/** 拉日K上限：默认 260 只快速扫描，0 表示全市场不截断（与服务端 SCAN_ALL 对应） */
export const DEFAULT_TREND_SCAN_LIMIT = 260;
const TREND_SCAN_ALL = 0;

/** 读服务端回显的 scanLimit：只接受非负有限数，其它一律回落到默认档 */
const readScanLimit = (value: unknown): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < TREND_SCAN_ALL) return DEFAULT_TREND_SCAN_LIMIT;
  return Math.round(next);
};

export const unavailableTrend = (error: string | null = FORMAT_ERROR): TrendScanResponseV2 => ({
  tradeDate: null,
  items: [],
  scanned: 0,
  candidates: 0,
  filters: {
    // 板块范围已取消：趋势一律全市场
    themeScope: 'all',
    maxMa5Dist: 4,
    maxPct: 20,
    pctWindow: 10,
    minStableDays: 3,
    minAmountYi: 5,
    minScore: 5,
    mainOnly: false,
    excludeSt: false,
    // 与服务端 DEFAULT_FILTERS 一致：默认 260 只快速扫描（0 = 全市场）
    scanLimit: DEFAULT_TREND_SCAN_LIMIT,
  },
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney+10jqka',
  status: 'unavailable',
  error,
  coverage: null,
  matchedTotal: null,
  returnedCount: null,
  truncated: false,
  metricsTradeDate: null,
  quoteAsOf: null,
});

const readCoverage = (value: unknown): TrendCoverage | null =>
  isRecord(value) &&
  typeof value.total === 'number' &&
  typeof value.attempted === 'number' &&
  typeof value.succeeded === 'number' &&
  typeof value.failed === 'number' &&
  typeof value.unscanned === 'number'
    ? {
        total: value.total,
        attempted: value.attempted,
        succeeded: value.succeeded,
        failed: value.failed,
        unscanned: value.unscanned,
      }
    : null;

export const toTrendScanResponse = (payload: unknown): TrendScanResponseV2 => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isTrendPick) ||
    !isStatus(payload.status) ||
    !isTradeDate(payload.tradeDate) ||
    !isParseableDateTime(payload.fetchedAt) ||
    !(typeof payload.error === 'string' || payload.error === null) ||
    typeof payload.scanned !== 'number' ||
    typeof payload.candidates !== 'number' ||
    !isRecord(payload.filters)
  ) {
    return unavailableTrend(FORMAT_ERROR);
  }

  if (payload.status === 'unavailable') return unavailableTrend(payload.error);

  return {
    tradeDate: payload.tradeDate,
    items: payload.items,
    scanned: payload.scanned,
    candidates: payload.candidates,
    filters: {
      themeScope: payload.filters.themeScope === 'all' ? 'all' : 'main',
      maxMa5Dist: Number(payload.filters.maxMa5Dist ?? 4),
      maxPct: Number(payload.filters.maxPct ?? 20),
      pctWindow: Number(payload.filters.pctWindow ?? 10),
      minStableDays: Number(payload.filters.minStableDays ?? 3),
      minAmountYi: Number(payload.filters.minAmountYi ?? 5),
      minScore: Number(payload.filters.minScore ?? 5),
      mainOnly: payload.filters.mainOnly === true,
      excludeSt: payload.filters.excludeSt === true,
      scanLimit: readScanLimit(payload.filters.scanLimit ?? DEFAULT_TREND_SCAN_LIMIT),
    },
    fetchedAt: payload.fetchedAt,
    source: payload.status === 'fresh' ? 'eastmoney+10jqka' : 'eastmoney',
    status: payload.status,
    error: payload.error,
    coverage: readCoverage(payload.coverage),
    matchedTotal: isNullableNumber(payload.matchedTotal) ? payload.matchedTotal : null,
    returnedCount: isNullableNumber(payload.returnedCount) ? payload.returnedCount : null,
    truncated: payload.truncated === true,
    metricsTradeDate:
      typeof payload.metricsTradeDate === 'string' ? payload.metricsTradeDate : null,
    quoteAsOf: typeof payload.quoteAsOf === 'string' ? payload.quoteAsOf : null,
  };
};

export const fetchTrendScan = async (
  filters: Partial<TrendScanResponse['filters']>,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TrendScanResponseV2> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const response = await fetchImpl(`${TREND_ENDPOINT}?${params.toString()}`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`形态扫描请求失败（${response.status}）`);

  try {
    return toTrendScanResponse(await response.json());
  } catch {
    throw new Error(FORMAT_ERROR);
  }
};
