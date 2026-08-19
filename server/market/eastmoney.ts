import type { MarketIndex, MarketOverviewResponse, QuoteError } from '../../src/types.js';

type EastmoneyMarketRow = {
  f2?: unknown;
  f3?: unknown;
  f4?: unknown;
  f12?: unknown;
  f14?: unknown;
};

export type EastmoneyMarketPayload = {
  data?: {
    diff?: EastmoneyMarketRow[] | Record<string, EastmoneyMarketRow>;
  } | null;
};

const REQUEST_TIMEOUT_MS = 5_000;
const MARKET_ENDPOINT = 'https://push2.eastmoney.com/api/qt/ulist.np/get';

const MARKET_INDEX_CONFIG = [
  { symbol: '000001', name: '上证指数', secid: '1.000001' },
  { symbol: '399001', name: '深证成指', secid: '0.399001' },
  { symbol: '399006', name: '创业板指', secid: '0.399006' },
  { symbol: '000688', name: '科创 50', secid: '1.000688' },
] as const;

const MARKET_SYMBOLS = ['000001', '399001', '399006', '000688'] as const;
const MARKET_SECIDS = '1.000001,0.399001,0.399006,1.000688';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAbortError = (error: unknown): boolean =>
  isRecord(error) && error.name === 'AbortError';

const asNumber = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && (value.trim() === '' || value.trim() === '-'))
  ) {
    return null;
  }

  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeScaledNumber = (value: unknown): number | null => {
  const next = asNumber(value);
  return next === null ? null : next / 100;
};

const toUnavailableIndex = (
  symbol: string,
  fallbackName: string,
  message: string,
): { index: MarketIndex; error: QuoteError } => ({
  index: {
    symbol,
    name: fallbackName,
    price: null,
    pct: null,
    change: null,
    updatedAt: null,
    status: 'unavailable',
  },
  error: {
    symbol,
    message,
  },
});

const buildUnavailableResponse = (
  message: string,
  fetchedAt: string,
): MarketOverviewResponse => {
  const fallback = MARKET_INDEX_CONFIG.map(({ symbol, name }) =>
    toUnavailableIndex(symbol, name, message),
  );

  return {
    indices: fallback.map((item) => item.index),
    fetchedAt,
    source: 'eastmoney',
    errors: fallback.map((item) => item.error),
  };
};

const toMarketRows = (payload: EastmoneyMarketPayload): EastmoneyMarketRow[] => {
  const diff = payload.data?.diff;

  if (Array.isArray(diff)) {
    return diff;
  }

  if (diff && typeof diff === 'object') {
    return Object.values(diff);
  }

  return [];
};

export const mapEastmoneyMarket = (
  payload: EastmoneyMarketPayload,
  fetchedAt: string,
): MarketOverviewResponse => {
  if (payload.data === null || payload.data === undefined) {
    const fallback = MARKET_INDEX_CONFIG.map(({ symbol, name }) =>
      toUnavailableIndex(symbol, name, '上游未返回指数数据'),
    );

    return {
      indices: fallback.map((item) => item.index),
      fetchedAt,
      source: 'eastmoney',
      errors: fallback.map((item) => item.error),
    };
  }

  const rowsBySymbol = new Map(
    toMarketRows(payload)
      .map((row) => [asString(row.f12), row] as const)
      .filter(([symbol]) => MARKET_SYMBOLS.includes(symbol as (typeof MARKET_SYMBOLS)[number])),
  );

  const indices: MarketIndex[] = [];
  const errors: QuoteError[] = [];

  for (const { symbol, name } of MARKET_INDEX_CONFIG) {
    const row = rowsBySymbol.get(symbol);
    const price = normalizeScaledNumber(row?.f2);
    const pct = normalizeScaledNumber(row?.f3);
    const change = normalizeScaledNumber(row?.f4);
    const upstreamName = asString(row?.f14);

    if (!row || price === null || pct === null || change === null || !upstreamName) {
      const unavailable = toUnavailableIndex(symbol, name, '上游指数数据不完整');
      indices.push(unavailable.index);
      errors.push(unavailable.error);
      continue;
    }

    indices.push({
      symbol,
      name,
      price,
      pct,
      change,
      updatedAt: fetchedAt,
      status: 'fresh',
    });
  }

  return {
    indices,
    fetchedAt,
    source: 'eastmoney',
    errors,
  };
};

const toRequestUrl = (): string => {
  const params = new URLSearchParams({
    secids: MARKET_SECIDS,
    fields: 'f2,f3,f4,f12,f14',
  });

  return `${MARKET_ENDPOINT}?${params.toString()}`;
};

export const fetchEastmoneyMarket = async (
  fetchImpl: typeof fetch = fetch,
): Promise<MarketOverviewResponse> => {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(toRequestUrl(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return buildUnavailableResponse(
        `大盘指数上游请求失败（HTTP ${response.status}）`,
        fetchedAt,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return buildUnavailableResponse(
        controller.signal.aborted || isAbortError(error)
          ? '大盘指数上游请求超时'
          : '大盘指数上游响应格式错误',
        fetchedAt,
      );
    }

    if (!isRecord(payload)) {
      return buildUnavailableResponse('大盘指数上游数据格式错误', fetchedAt);
    }

    return mapEastmoneyMarket(payload as EastmoneyMarketPayload, fetchedAt);
  } catch (error) {
    return buildUnavailableResponse(
      controller.signal.aborted || isAbortError(error)
        ? '大盘指数上游请求超时'
        : '大盘指数上游请求失败',
      fetchedAt,
    );
  } finally {
    clearTimeout(timer);
  }
};
