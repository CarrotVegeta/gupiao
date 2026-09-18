import type { AuctionItem, AuctionResponse } from '../types';

const ENDPOINT = '/api/auction';
const FORMAT_ERROR = '竞价响应数据格式错误';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isNullableInteger = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value));

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isTradeDate = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && /^\d{8}$/.test(value));

const isAuctionItem = (value: unknown): value is AuctionItem => {
  if (!isRecord(value)) {
    return false;
  }

  const result = value.result;
  const hasValidResult =
    result === 'qualified' || result === 'unqualified' || result === 'insufficient';
  const sealedAtAuction = value.sealedAtAuction;
  const hasValidSealedAtAuction =
    sealedAtAuction === null || typeof sealedAtAuction === 'boolean';
  const premium = value.auctionPremium;
  const hasValidPremium =
    premium === null ||
    premium === 'discount' ||
    premium === 'mild' ||
    premium === 'rich' ||
    premium === 'chase';

  return (
    typeof value.symbol === 'string' &&
    /^\d{6}$/.test(value.symbol) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    isNullableInteger(value.boardCount) &&
    isNullableString(value.firstSealTime) &&
    isNullableString(value.lastSealTime) &&
    isNullableInteger(value.breakCount) &&
    isNullableNumber(value.previousAmount) &&
    isNullableNumber(value.sealAmount) &&
    isNullableNumber(value.floatMarketCap) &&
    isNullableNumber(value.turnoverRate) &&
    isNullableNumber(value.auctionPrice) &&
    isNullableNumber(value.auctionPct) &&
    isNullableNumber(value.auctionAmount) &&
    isNullableNumber(value.auctionRatio) &&
    hasValidResult &&
    hasValidSealedAtAuction &&
    hasValidPremium &&
    (result !== 'insufficient' || premium === null) &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === 'string')
  );
};

const unavailableResponse = (fetchedAt: string): AuctionResponse => ({
  tradeDate: null,
  previousTradeDate: null,
  snapshotTime: '09:25:00',
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: FORMAT_ERROR,
});

const normalizeResponse = (payload: unknown, fetchedAt: string): AuctionResponse => {
  if (
    !isRecord(payload) ||
    !isTradeDate(payload.tradeDate) ||
    !isTradeDate(payload.previousTradeDate) ||
    payload.snapshotTime !== '09:25:00' ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isAuctionItem) ||
    typeof payload.fetchedAt !== 'string' ||
    Number.isNaN(new Date(payload.fetchedAt).getTime()) ||
    (payload.source !== 'eastmoney' && payload.source !== 'eastmoney+tencent') ||
    (payload.status !== 'fresh' && payload.status !== 'stale' && payload.status !== 'unavailable') ||
    !(typeof payload.error === 'string' || payload.error === null)
  ) {
    return unavailableResponse(fetchedAt);
  }

  if (
    (payload.status === 'fresh' || payload.status === 'stale') &&
    (payload.tradeDate === null || payload.previousTradeDate === null)
  ) {
    return unavailableResponse(fetchedAt);
  }

  if (payload.status === 'unavailable') {
    return {
      tradeDate: null,
      previousTradeDate: null,
      snapshotTime: '09:25:00',
      items: [],
      fetchedAt: payload.fetchedAt,
      source: 'eastmoney',
      status: 'unavailable',
      error: payload.error,
    };
  }

  return payload as unknown as AuctionResponse;
};

export const fetchAuction = async (
  tradeDate?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuctionResponse> => {
  const url = tradeDate ? `${ENDPOINT}?date=${encodeURIComponent(tradeDate)}` : ENDPOINT;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`竞价请求失败（${response.status}）`);
  }

  const fetchedAt = new Date().toISOString();
  try {
    return normalizeResponse(await response.json(), fetchedAt);
  } catch {
    throw new Error(FORMAT_ERROR);
  }
};

export const mergeAuction = (
  previous: AuctionResponse | null | undefined,
  response: AuctionResponse,
): AuctionResponse => {
  if (response.status === 'fresh') {
    return response;
  }

  if (
    previous &&
    previous.tradeDate !== null &&
    previous.previousTradeDate !== null &&
    (previous.status === 'fresh' || previous.status === 'stale')
  ) {
    return { ...previous, status: 'stale', error: response.error };
  }

  return { ...response, tradeDate: null, previousTradeDate: null, items: [], status: 'unavailable' };
};
