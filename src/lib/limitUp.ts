import type { LimitUpItem, LimitUpResponse, QuoteError } from '../types';

const LIMIT_UP_ENDPOINT = '/api/limit-up';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is LimitUpResponse['status'] =>
  value === 'fresh' || value === 'stale' || value === 'unavailable';

const isQuoteError = (value: unknown): value is QuoteError => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.symbol === 'string' && typeof value.message === 'string';
};

const isLimitUpItem = (value: unknown): value is LimitUpItem => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.symbol === 'string' &&
    /^\d{6}$/.test(value.symbol) &&
    typeof value.name === 'string' &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    typeof value.pct === 'number' &&
    Number.isFinite(value.pct) &&
    typeof value.boardCount === 'number' &&
    Number.isInteger(value.boardCount) &&
    (typeof value.firstSealTime === 'string' || value.firstSealTime === null) &&
    (typeof value.lastSealTime === 'string' || value.lastSealTime === null) &&
    (typeof value.industry === 'string' || value.industry === null) &&
    typeof value.breakCount === 'number' &&
    Number.isInteger(value.breakCount)
  );
};

const toLimitUpResponse = (
  payload: unknown,
  requestedDate: string | undefined,
  fetchedAtFallback: string,
): LimitUpResponse => {
  if (!isRecord(payload)) {
    return {
      tradeDate: requestedDate ?? '',
      items: [],
      fetchedAt: fetchedAtFallback,
      source: 'eastmoney',
      status: 'unavailable',
      error: null,
    };
  }

  return {
    tradeDate: typeof payload.tradeDate === 'string' ? payload.tradeDate : requestedDate ?? '',
    items: Array.isArray(payload.items) ? payload.items.filter(isLimitUpItem) : [],
    fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : fetchedAtFallback,
    source: payload.source === 'eastmoney' ? 'eastmoney' : 'eastmoney',
    status: isStatus(payload.status) ? payload.status : 'unavailable',
    error: isQuoteError(payload.error) ? payload.error : null,
  };
};

export const fetchLimitUp = async (
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LimitUpResponse> => {
  const requestUrl =
    typeof date === 'string' ? `${LIMIT_UP_ENDPOINT}?date=${encodeURIComponent(date)}` : LIMIT_UP_ENDPOINT;
  const response = await fetchImpl(requestUrl);

  if (!response.ok) {
    throw new Error(`涨停请求失败（${response.status}）`);
  }

  return toLimitUpResponse(await response.json(), date, new Date().toISOString());
};

export const mergeLimitUp = (
  previous: LimitUpResponse | null | undefined,
  response: LimitUpResponse,
): LimitUpResponse => {
  if (response.status === 'fresh') {
    return response;
  }

  if (!previous) {
    return response;
  }

  return {
    ...previous,
    tradeDate: response.tradeDate || previous.tradeDate,
    fetchedAt: response.fetchedAt,
    source: response.source,
    status: 'stale',
    error: response.error,
  };
};
