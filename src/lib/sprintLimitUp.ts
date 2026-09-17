import type { SprintLimitUpItem, SprintLimitUpResponse } from '../types';

const SPRINT_LIMIT_UP_ENDPOINT = '/api/sprint-limit-up';
const RESPONSE_FORMAT_ERROR = '冲刺涨停响应数据格式错误';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is SprintLimitUpResponse['status'] =>
  value === 'fresh' || value === 'stale' || value === 'unavailable';

const isParseableDateTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

const isNullableFiniteNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isNullableInteger = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value));

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isTradeDate = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && /^\d{8}$/.test(value));

const isSprintLimitUpItem = (value: unknown): value is SprintLimitUpItem => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.symbol === 'string' &&
    /^\d{6}$/.test(value.symbol) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    isNullableFiniteNumber(value.price) &&
    isNullableFiniteNumber(value.pct) &&
    isNullableFiniteNumber(value.speed) &&
    isNullableInteger(value.boardCount) &&
    isNullableFiniteNumber(value.probability) &&
    isNullableString(value.reason)
  );
};

const unavailableResponse = (fetchedAt: string): SprintLimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: RESPONSE_FORMAT_ERROR,
});

const toSprintLimitUpResponse = (
  payload: unknown,
  fetchedAtFallback: string,
): SprintLimitUpResponse => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isSprintLimitUpItem) ||
    payload.source !== 'eastmoney' ||
    !isStatus(payload.status) ||
    !isTradeDate(payload.tradeDate) ||
    !isParseableDateTime(payload.fetchedAt) ||
    !(typeof payload.error === 'string' || payload.error === null)
  ) {
    return unavailableResponse(fetchedAtFallback);
  }

  if (payload.status === 'fresh' && (payload.tradeDate === null || payload.error !== null)) {
    return unavailableResponse(fetchedAtFallback);
  }

  if (payload.status === 'stale' && payload.tradeDate === null) {
    return unavailableResponse(fetchedAtFallback);
  }

  if (payload.status === 'unavailable') {
    return {
      tradeDate: null,
      items: [],
      fetchedAt: payload.fetchedAt,
      source: 'eastmoney',
      status: 'unavailable',
      error: payload.error,
    };
  }

  return {
    tradeDate: payload.tradeDate,
    items: payload.items,
    fetchedAt: payload.fetchedAt,
    source: 'eastmoney',
    status: payload.status,
    error: payload.error,
  };
};

export const fetchSprintLimitUp = async (
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SprintLimitUpResponse> => {
  const requestUrl =
    typeof date === 'string'
      ? `${SPRINT_LIMIT_UP_ENDPOINT}?date=${encodeURIComponent(date)}`
      : SPRINT_LIMIT_UP_ENDPOINT;
  const response = await fetchImpl(requestUrl);

  if (!response.ok) {
    throw new Error(`冲刺涨停请求失败（${response.status}）`);
  }

  const fetchedAtFallback = new Date().toISOString();

  try {
    return toSprintLimitUpResponse(await response.json(), fetchedAtFallback);
  } catch {
    throw new Error(RESPONSE_FORMAT_ERROR);
  }
};

export const mergeSprintLimitUp = (
  previous: SprintLimitUpResponse | null | undefined,
  response: SprintLimitUpResponse,
): SprintLimitUpResponse => {
  if (response.status === 'fresh') {
    return response;
  }

  const hasPreviousSuccessfulData =
    previous !== null &&
    previous !== undefined &&
    previous.tradeDate !== null &&
    (previous.status === 'fresh' || previous.status === 'stale') &&
    isParseableDateTime(previous.fetchedAt);

  if (!hasPreviousSuccessfulData) {
    return {
      ...response,
      tradeDate: null,
      items: [],
      status: 'unavailable',
    };
  }

  return {
    ...previous,
    status: 'stale',
    error: response.error,
  };
};
