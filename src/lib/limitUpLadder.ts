import type {
  LimitUpComparisonItem,
  LimitUpComparisonStock,
  LimitUpItem,
  LimitUpLadderGroup,
  LimitUpLadderResponse,
} from '../types';

const LADDER_ENDPOINT = '/api/limit-up-ladder';
const RESPONSE_FORMAT_ERROR = '连板天梯响应数据格式错误';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is LimitUpLadderResponse['status'] =>
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

const isLimitUpItem = (value: unknown): value is LimitUpItem => {
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
    isNullableInteger(value.boardCount) &&
    isNullableString(value.firstSealTime) &&
    isNullableString(value.lastSealTime) &&
    isNullableString(value.industry) &&
    isNullableInteger(value.breakCount)
  );
};

const isLadderGroup = (value: unknown): value is LimitUpLadderGroup => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNullableInteger(value.boardCount) &&
    Array.isArray(value.items) &&
    value.items.every(isLimitUpItem)
  );
};

const isComparisonStock = (value: unknown): value is LimitUpComparisonStock => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.symbol === 'string' &&
    /^\d{6}$/.test(value.symbol) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    isNullableInteger(value.boardCount) &&
    isNullableFiniteNumber(value.pct)
  );
};

const isComparisonItem = (value: unknown): value is LimitUpComparisonItem => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNullableInteger(value.boardCount) &&
    typeof value.total === 'number' &&
    Number.isInteger(value.total) &&
    value.total >= 0 &&
    Array.isArray(value.carried) &&
    value.carried.every(isComparisonStock) &&
    Array.isArray(value.fallen) &&
    value.fallen.every(isComparisonStock)
  );
};

const unavailableResponse = (
  fetchedAt: string,
  error: string = RESPONSE_FORMAT_ERROR,
): LimitUpLadderResponse => ({
  tradeDate: null,
  previousTradeDate: null,
  items: [],
  ladder: [],
  previousLadder: [],
  comparison: [],
  previousCount: 0,
  carriedCount: 0,
  promotionRate: null,
  previousAvailable: false,
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error,
});

const toLimitUpLadderResponse = (
  payload: unknown,
  fetchedAtFallback: string,
): LimitUpLadderResponse => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isLimitUpItem) ||
    !Array.isArray(payload.ladder) ||
    !payload.ladder.every(isLadderGroup) ||
    !Array.isArray(payload.previousLadder) ||
    !payload.previousLadder.every(isLadderGroup) ||
    !Array.isArray(payload.comparison) ||
    !payload.comparison.every(isComparisonItem) ||
    payload.source !== 'eastmoney' ||
    !isStatus(payload.status) ||
    !isTradeDate(payload.tradeDate) ||
    !isTradeDate(payload.previousTradeDate) ||
    typeof payload.previousCount !== 'number' ||
    typeof payload.carriedCount !== 'number' ||
    !isNullableFiniteNumber(payload.promotionRate) ||
    typeof payload.previousAvailable !== 'boolean' ||
    !isParseableDateTime(payload.fetchedAt) ||
    !(typeof payload.error === 'string' || payload.error === null)
  ) {
    return unavailableResponse(fetchedAtFallback);
  }

  // fresh 必须自洽：没有交易日，或者报了错，都说明这不是一份可用的新数据
  if (payload.status === 'fresh' && (payload.tradeDate === null || payload.error !== null)) {
    return unavailableResponse(fetchedAtFallback);
  }

  if (payload.status !== 'fresh' && payload.tradeDate === null) {
    return unavailableResponse(fetchedAtFallback);
  }

  return {
    tradeDate: payload.tradeDate,
    previousTradeDate: payload.previousTradeDate,
    items: payload.items,
    ladder: payload.ladder,
    previousLadder: payload.previousLadder,
    comparison: payload.comparison,
    previousCount: payload.previousCount,
    carriedCount: payload.carriedCount,
    promotionRate: payload.promotionRate,
    previousAvailable: payload.previousAvailable,
    fetchedAt: payload.fetchedAt,
    source: 'eastmoney',
    status: payload.status,
    error: payload.error,
  };
};

export const fetchLimitUpLadder = async (
  date?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LimitUpLadderResponse> => {
  const requestUrl =
    typeof date === 'string'
      ? `${LADDER_ENDPOINT}?date=${encodeURIComponent(date)}`
      : LADDER_ENDPOINT;
  const response = await fetchImpl(requestUrl);

  if (!response.ok) {
    throw new Error(`连板天梯请求失败（${response.status}）`);
  }

  const fetchedAtFallback = new Date().toISOString();

  try {
    return toLimitUpLadderResponse(await response.json(), fetchedAtFallback);
  } catch {
    throw new Error(RESPONSE_FORMAT_ERROR);
  }
};

/**
 * 合并语义和涨停池一致：只有 fresh 才顶掉旧数据，
 * 失败时保留上一份（标成 stale），免得一次抖动把整页清空。
 */
export const mergeLimitUpLadder = (
  previous: LimitUpLadderResponse | null | undefined,
  response: LimitUpLadderResponse,
): LimitUpLadderResponse => {
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
      ladder: [],
      previousLadder: [],
      comparison: [],
      previousCount: 0,
      carriedCount: 0,
      promotionRate: null,
      previousAvailable: false,
      status: 'unavailable',
    };
  }

  return {
    ...previous,
    status: 'stale',
    error: response.error,
  };
};
