import type {
  Quote,
  ThemeItem,
  ThemeMetric,
  ThemeStockItem,
  ThemeStocksResponse,
  ThemeStockRole,
  ThemesResponse,
  TrendPick,
  TrendScanResponse,
} from '../types';

const THEMES_ENDPOINT = '/api/themes';
const TREND_ENDPOINT = '/api/screener/trend';
const FORMAT_ERROR = '选股响应数据格式错误';

/**
 * 回测结论，固定显示在形态扫描页头。
 * 来源：scripts/screener-trend-backtest.ts（114 个交易日 / 5532 只票）。
 * 这不是装饰文案——回测结论对不上实际用法时，页面就是在误导人。
 */
export const TREND_EVIDENCE = {
  headline: '这套形态已被本项目回测否定，方向与直觉相反',
  lines: [
    '全市场命中形态：次日开盘超额 −0.141%（t=−2.56），T+10 −1.440%（t=−3.28）',
    '主线板块 ∩ 形态：次日开盘 −0.162%（t=−2.60），T+10 −1.788%（t=−3.73）—— 加「主线」过滤反而更差',
    '配对检验（加主线过滤）：T+1 −0.173%（t=−2.53）',
    '归因：只加「MA5>MA10>MA20」这一步，主线池 T+10 超额从 +0.084% 崩到 −2.426%（t=−2.25）',
    '唯一有正面作用的是「回调缩量」，但救不回整体',
  ],
  footer: '样本 2026-02-26 ~ 2026-09-16，114 个交易日，超额口径为「相对当日全市场等权」。本页只展示形态分布，不构成任何买入建议。',
} as const;

export const THEME_EVIDENCE =
  '题材分类是结构展示：主线板块本身在回测里有微弱正超额（B 档 T+1 +0.059%，t=2.03），但样本外衰减且低于手续费，同样不构成买入建议。';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is Quote['status'] =>
  value === 'fresh' || value === 'stale' || value === 'unavailable';

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

const isThemeItem = (value: unknown): value is ThemeItem =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  /^BK\d{4}$/.test(value.code) &&
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
  typeof value.score === 'number';

const isThemeStockItem = (value: unknown): value is ThemeStockItem =>
  isRecord(value) &&
  typeof value.symbol === 'string' &&
  /^\d{6}$/.test(value.symbol) &&
  typeof value.name === 'string' &&
  value.name.trim().length > 0 &&
  isNullableNumber(value.price) &&
  isNullableNumber(value.pct) &&
  isNullableNumber(value.boardCount) &&
  (value.firstSealTime === null || typeof value.firstSealTime === 'string') &&
  (value.sealType === null || typeof value.sealType === 'string') &&
  isNullableNumber(value.openCount) &&
  isNullableNumber(value.sealAmount) &&
  isNullableNumber(value.turnoverRate) &&
  isNullableNumber(value.amount) &&
  isNullableNumber(value.avgAmount3d) &&
  isNullableNumber(value.avgAmount5d) &&
  isNullableNumber(value.floatMarketCap) &&
  (value.reason === null || typeof value.reason === 'string') &&
  (value.precise === null || typeof value.precise === 'boolean') &&
  Array.isArray(value.hits) &&
  Array.isArray(value.misses) &&
  Array.isArray(value.risks) &&
  isNullableNumber(value.ma5) &&
  isNullableNumber(value.ma10) &&
  isNullableNumber(value.ma20) &&
  (value.maBull === null || typeof value.maBull === 'boolean') &&
  isNullableNumber(value.distMa5) &&
  isNullableNumber(value.distMa10) &&
  isNullableNumber(value.stableDays10) &&
  isNullableNumber(value.pct10) &&
  isNullableNumber(value.pct20) &&
  isNullableNumber(value.limitUpIn60d);

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
  tradeDate: null,
  main: [],
  branch: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney+10jqka',
  status: 'unavailable',
  error,
});

export const toThemesResponse = (payload: unknown): ThemesResponse => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.main) ||
    !payload.main.every(isThemeItem) ||
    !Array.isArray(payload.branch) ||
    !payload.branch.every(isThemeItem) ||
    !isStatus(payload.status) ||
    !isTradeDate(payload.tradeDate) ||
    !isParseableDateTime(payload.fetchedAt) ||
    !(typeof payload.error === 'string' || payload.error === null)
  ) {
    return unavailableThemes(FORMAT_ERROR);
  }

  if (payload.status === 'fresh' && (payload.tradeDate === null || payload.error !== null)) {
    return unavailableThemes(FORMAT_ERROR);
  }

  if (payload.status === 'unavailable') {
    return { ...unavailableThemes(payload.error), fetchedAt: payload.fetchedAt };
  }

  return {
    tradeDate: payload.tradeDate,
    main: payload.main,
    branch: payload.branch,
    fetchedAt: payload.fetchedAt,
    source: 'eastmoney+10jqka',
    status: payload.status,
    error: payload.error,
  };
};

export const fetchThemes = async (
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemesResponse> => {
  const url = typeof date === 'string' ? `${THEMES_ENDPOINT}?date=${encodeURIComponent(date)}` : THEMES_ENDPOINT;
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
  if (response.status === 'fresh') return response;
  const usable =
    previous != null &&
    previous.tradeDate !== null &&
    (previous.status === 'fresh' || previous.status === 'stale');
  if (!usable) return { ...response, tradeDate: null, main: [], branch: [], status: 'unavailable' };
  return { ...previous, status: 'stale', error: response.error };
};

// ---------------------------------------------------------------------------
// 题材详情
// ---------------------------------------------------------------------------

export const unavailableThemeStocks = (
  role: ThemeStockRole,
  error: string | null = FORMAT_ERROR,
): ThemeStocksResponse => ({
  tradeDate: null,
  theme: null,
  role,
  items: [],
  scanned: 0,
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney+10jqka+tencent',
  status: 'unavailable',
  error,
});

export const toThemeStocksResponse = (
  payload: unknown,
  role: ThemeStockRole,
): ThemeStocksResponse => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isThemeStockItem) ||
    !isStatus(payload.status) ||
    !isTradeDate(payload.tradeDate) ||
    !isParseableDateTime(payload.fetchedAt) ||
    !(typeof payload.error === 'string' || payload.error === null) ||
    !(payload.theme === null || isRecord(payload.theme)) ||
    typeof payload.scanned !== 'number'
  ) {
    return unavailableThemeStocks(role, FORMAT_ERROR);
  }

  if (payload.status === 'unavailable') {
    return unavailableThemeStocks(role, payload.error);
  }

  const themeRecord = isRecord(payload.theme) ? payload.theme : null;
  return {
    tradeDate: payload.tradeDate,
    theme:
      themeRecord && typeof themeRecord.code === 'string' && typeof themeRecord.name === 'string'
        ? { code: themeRecord.code, name: themeRecord.name }
        : null,
    role,
    items: payload.items,
    scanned: payload.scanned,
    fetchedAt: payload.fetchedAt,
    source: 'eastmoney+10jqka+tencent',
    status: payload.status,
    error: payload.error,
  };
};

export const fetchThemeStocks = async (
  code: string,
  role: ThemeStockRole,
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThemeStocksResponse> => {
  const params = new URLSearchParams({ role });
  if (typeof date === 'string') params.set('date', date);
  const response = await fetchImpl(
    `${THEMES_ENDPOINT}/${encodeURIComponent(code)}/stocks?${params.toString()}`,
  );
  if (!response.ok) throw new Error(`题材详情请求失败（${response.status}）`);

  try {
    return toThemeStocksResponse(await response.json(), role);
  } catch {
    throw new Error(FORMAT_ERROR);
  }
};

// ---------------------------------------------------------------------------
// 趋势形态扫描
// ---------------------------------------------------------------------------

export const unavailableTrend = (error: string | null = FORMAT_ERROR): TrendScanResponse => ({
  tradeDate: null,
  items: [],
  scanned: 0,
  candidates: 0,
  filters: {
    themeScope: 'main',
    maxMa5Dist: 4,
    maxPct: 20,
    pctWindow: 10,
    minStableDays: 3,
    minAmountYi: 5,
    minScore: 5,
    mainOnly: false,
    excludeSt: false,
  },
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney+10jqka',
  status: 'unavailable',
  error,
});

export const toTrendScanResponse = (payload: unknown): TrendScanResponse => {
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
    },
    fetchedAt: payload.fetchedAt,
    source: payload.status === 'fresh' ? 'eastmoney+10jqka' : 'eastmoney',
    status: payload.status,
    error: payload.error,
  };
};

export const fetchTrendScan = async (
  filters: Partial<TrendScanResponse['filters']>,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendScanResponse> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const response = await fetchImpl(`${TREND_ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`形态扫描请求失败（${response.status}）`);

  try {
    return toTrendScanResponse(await response.json());
  } catch {
    throw new Error(FORMAT_ERROR);
  }
};
