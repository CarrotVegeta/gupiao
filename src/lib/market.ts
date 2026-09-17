import type {
  MarketBreadth,
  MarketIndex,
  MarketOverviewResponse,
  QuoteError,
  QuoteSource,
} from '../types';

const MARKET_ENDPOINT = '/api/market-overview';
const RESPONSE_FORMAT_ERROR = '大盘响应数据格式错误';

const MARKET_INDEX_CONFIG = [
  { symbol: '000001', name: '上证指数' },
  { symbol: '399001', name: '深证成指' },
  { symbol: '399006', name: '创业板指' },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is MarketIndex['status'] =>
  value === 'fresh' || value === 'stale' || value === 'unavailable';

/** 与后端 QuoteSource 同步：腾讯优先，缺口由东财补 */
const isQuoteSource = (value: unknown): value is QuoteSource =>
  value === 'eastmoney' || value === 'tencent' || value === 'eastmoney+tencent';

const isParseableDateTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

const isNullableFiniteNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isQuoteError = (value: unknown): value is QuoteError => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.symbol === 'string' && typeof value.message === 'string';
};

const isMarketIndex = (value: unknown): value is MarketIndex => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.symbol !== 'string' ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    !isNullableFiniteNumber(value.price) ||
    !isNullableFiniteNumber(value.change) ||
    !isNullableFiniteNumber(value.pct) ||
    !(value.updatedAt === null || isParseableDateTime(value.updatedAt)) ||
    !isStatus(value.status)
  ) {
    return false;
  }

  if (value.status === 'fresh') {
    return (
      value.price !== null &&
      value.change !== null &&
      value.pct !== null &&
      isParseableDateTime(value.updatedAt)
    );
  }

  return true;
};

const unavailableIndex = (symbol: string, name: string): MarketIndex => ({
  symbol,
  name,
  price: null,
  change: null,
  pct: null,
  amount: null,
  updatedAt: null,
  status: 'unavailable',
});

export const createUnavailableMarketIndices = (): Record<string, MarketIndex> =>
  Object.fromEntries(
    MARKET_INDEX_CONFIG.map(({ symbol, name }) => [symbol, unavailableIndex(symbol, name)]),
  );

export const marketIndicesInDisplayOrder = (
  indices: Record<string, MarketIndex>,
): MarketIndex[] =>
  MARKET_INDEX_CONFIG.map(({ symbol, name }) => indices[symbol] ?? unavailableIndex(symbol, name));

export const createUnavailableMarketOverviewResponse = (
  fetchedAt: string,
  message: string,
): MarketOverviewResponse => ({
  turnover: null,
  breadth: null,
  indices: MARKET_INDEX_CONFIG.map(({ symbol, name }) => unavailableIndex(symbol, name)),
  fetchedAt: isParseableDateTime(fetchedAt) ? fetchedAt : new Date().toISOString(),
  source: 'eastmoney',
  errors: MARKET_INDEX_CONFIG.map(({ symbol }) => ({ symbol, message })),
});

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isMarketBreadth = (value: unknown): value is MarketBreadth =>
  isRecord(value) &&
  (value.tradeDate === null || typeof value.tradeDate === 'string') &&
  (value.previousTradeDate === null || typeof value.previousTradeDate === 'string') &&
  isNullableNumber(value.limitUpCount) &&
  isNullableNumber(value.brokenCount) &&
  isNullableNumber(value.promotionRate) &&
  isNullableNumber(value.riseCount) &&
  isNullableNumber(value.fallCount) &&
  isStatus(value.status);

const toMarketOverviewResponse = (
  payload: unknown,
  fetchedAtFallback: string,
): MarketOverviewResponse => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.indices) ||
    !Array.isArray(payload.errors) ||
    !isQuoteSource(payload.source) ||
    !isParseableDateTime(payload.fetchedAt)
  ) {
    return createUnavailableMarketOverviewResponse(fetchedAtFallback, RESPONSE_FORMAT_ERROR);
  }

  const payloadRows = new Map<string, unknown>();
  for (const row of payload.indices) {
    if (isRecord(row) && typeof row.symbol === 'string' && !payloadRows.has(row.symbol)) {
      payloadRows.set(row.symbol, row);
    }
  }

  const errors = payload.errors.filter(isQuoteError);
  const indices = MARKET_INDEX_CONFIG.map(({ symbol, name }) => {
    const row = payloadRows.get(symbol);

    if (!isMarketIndex(row)) {
      if (!errors.some((error) => error.symbol === symbol)) {
        errors.push({ symbol, message: '大盘指数数据不完整' });
      }
      return unavailableIndex(symbol, name);
    }

    return {
      ...row,
      symbol,
      name,
    };
  });

  return {
    turnover: typeof payload.turnover === 'number' ? payload.turnover : null,
    breadth: isMarketBreadth(payload.breadth) ? payload.breadth : null,
    indices,
    fetchedAt: payload.fetchedAt,
    source: payload.source,
    errors,
  };
};

export const fetchMarketOverview = async (
  fetchImpl: typeof fetch = fetch,
): Promise<MarketOverviewResponse> => {
  const response = await fetchImpl(MARKET_ENDPOINT);

  if (!response.ok) {
    throw new Error(`大盘请求失败（${response.status}）`);
  }

  const fetchedAtFallback = new Date().toISOString();

  try {
    return toMarketOverviewResponse(await response.json(), fetchedAtFallback);
  } catch {
    return createUnavailableMarketOverviewResponse(fetchedAtFallback, RESPONSE_FORMAT_ERROR);
  }
};

export const mergeMarketOverview = (
  previous: Record<string, MarketIndex>,
  response: MarketOverviewResponse,
): Record<string, MarketIndex> => {
  const next = createUnavailableMarketIndices();
  const responseBySymbol = new Map(response.indices.map((index) => [index.symbol, index]));

  for (const { symbol, name } of MARKET_INDEX_CONFIG) {
    const existing = previous[symbol];
    const incoming = responseBySymbol.get(symbol);

    if (incoming?.status === 'fresh') {
      next[symbol] = { ...incoming, symbol, name };
      continue;
    }

    if (existing && (existing.status === 'fresh' || existing.status === 'stale')) {
      next[symbol] = {
        ...existing,
        symbol,
        name,
        status: 'stale',
      };
      continue;
    }

    if (incoming) {
      next[symbol] = { ...incoming, symbol, name };
    }
  }

  for (const error of response.errors) {
    const existing = next[error.symbol];

    if (existing?.status === 'fresh') {
      next[error.symbol] = {
        ...existing,
        status: 'stale',
      };
    }
  }

  return next;
};
