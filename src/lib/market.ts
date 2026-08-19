import type { MarketIndex, MarketOverviewResponse, QuoteError } from '../types';

const MARKET_ENDPOINT = '/api/market-overview';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is MarketIndex['status'] =>
  value === 'fresh' || value === 'stale' || value === 'unavailable';

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

  return (
    typeof value.symbol === 'string' &&
    typeof value.name === 'string' &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    typeof value.change === 'number' &&
    Number.isFinite(value.change) &&
    typeof value.pct === 'number' &&
    Number.isFinite(value.pct) &&
    (typeof value.updatedAt === 'string' || value.updatedAt === null) &&
    isStatus(value.status)
  );
};

const toMarketOverviewResponse = (
  payload: unknown,
  fetchedAtFallback: string,
): MarketOverviewResponse => {
  if (!isRecord(payload)) {
    return {
      indices: [],
      fetchedAt: fetchedAtFallback,
      source: 'eastmoney',
      errors: [],
    };
  }

  return {
    indices: Array.isArray(payload.indices) ? payload.indices.filter(isMarketIndex) : [],
    fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : fetchedAtFallback,
    source: payload.source === 'eastmoney' ? 'eastmoney' : 'eastmoney',
    errors: Array.isArray(payload.errors) ? payload.errors.filter(isQuoteError) : [],
  };
};

export const fetchMarketOverview = async (
  fetchImpl: typeof fetch = fetch,
): Promise<MarketOverviewResponse> => {
  const response = await fetchImpl(MARKET_ENDPOINT);

  if (!response.ok) {
    throw new Error(`大盘请求失败（${response.status}）`);
  }

  return toMarketOverviewResponse(await response.json(), new Date().toISOString());
};

export const mergeMarketOverview = (
  previous: Record<string, MarketIndex>,
  response: MarketOverviewResponse,
): Record<string, MarketIndex> => {
  const next = { ...previous };

  for (const index of response.indices) {
    if (index.status === 'fresh') {
      next[index.symbol] = index;
      continue;
    }

    const existing = next[index.symbol];

    if (existing) {
      next[index.symbol] = {
        ...existing,
        status: 'stale',
      };
      continue;
    }

    next[index.symbol] = index;
  }

  for (const error of response.errors) {
    const existing = next[error.symbol];

    if (!existing) {
      continue;
    }

    next[error.symbol] = {
      ...existing,
      status: 'stale',
    };
  }

  return next;
};
