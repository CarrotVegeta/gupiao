import type { LimitUpItem, LimitUpResponse } from '../../src/types.js';

type EastmoneyLimitUpRow = {
  c?: unknown;
  n?: unknown;
  p?: unknown;
  zdp?: unknown;
  lbc?: unknown;
  fbt?: unknown;
  lbt?: unknown;
  hybk?: unknown;
  zbc?: unknown;
};

type EastmoneyLimitUpPayload = {
  data?: {
    pool?: EastmoneyLimitUpRow[];
    tc?: unknown;
    pagesize?: unknown;
  } | null;
};

const REQUEST_TIMEOUT_MS = 5_000;
const REQUEST_PAGE_SIZE = 100;
const LIMIT_UP_ENDPOINT = 'https://push2ex.eastmoney.com/getTopicZTPool';

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-') {
    return null;
  }

  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const asInteger = (value: unknown): number | null => {
  const next = asNumber(value);
  return next !== null && Number.isInteger(next) ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatTradeTime = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();

  if (!/^\d{1,6}$/.test(raw)) {
    return null;
  }

  const normalized = raw.padStart(6, '0');
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  const second = Number(normalized.slice(4, 6));

  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}:${normalized.slice(4, 6)}`;
};

const buildUnavailableResponse = (
  tradeDate: string,
  message: string,
  fetchedAt = new Date().toISOString(),
): LimitUpResponse => ({
  tradeDate,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: {
    symbol: 'limit-up',
    message,
  },
});

export const mapEastmoneyLimitUpItem = (raw: EastmoneyLimitUpRow): LimitUpItem | null => {
  const symbol = asString(raw.c);
  const name = asString(raw.n);
  const price = asNumber(raw.p);
  const pct = asNumber(raw.zdp);
  const boardCount = asInteger(raw.lbc);
  const breakCount = asInteger(raw.zbc);

  if (!symbol || !name || price === null || pct === null || boardCount === null || breakCount === null) {
    return null;
  }

  const normalized: LimitUpItem = {
    symbol,
    name,
    price: price / 1000,
    pct,
    boardCount,
    firstSealTime: formatTradeTime(raw.fbt),
    lastSealTime: formatTradeTime(raw.lbt),
    industry: asString(raw.hybk) || null,
    breakCount,
  };

  return normalized;
};

const toRequestUrl = (tradeDate: string, pageIndex: number): string => {
  const params = new URLSearchParams({
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    sort: 'fbt:asc',
    date: tradeDate,
    pagesize: String(REQUEST_PAGE_SIZE),
    Pageindex: String(pageIndex),
  });

  return `${LIMIT_UP_ENDPOINT}?${params.toString()}`;
};

const fetchPage = async (
  tradeDate: string,
  pageIndex: number,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetchImpl(toRequestUrl(tradeDate, pageIndex), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
};

export const fetchEastmoneyLimitUp = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LimitUpResponse> => {
  const fetchedAt = new Date().toISOString();
  const items: LimitUpItem[] = [];
  const seen = new Set<string>();
  let pageIndex = 0;
  let emptyPageCount = 0;
  let totalCount: number | null = null;
  let currentPageSize = REQUEST_PAGE_SIZE;

  try {
    while (pageIndex < 50) {
      const response = await fetchPage(tradeDate, pageIndex, fetchImpl);

      if (!response.ok) {
        return buildUnavailableResponse(tradeDate, `涨停池上游请求失败（HTTP ${response.status}）`, fetchedAt);
      }

      const payload = (await response.json()) as EastmoneyLimitUpPayload;
      const data = payload.data;

      if (!data || typeof data !== 'object') {
        return buildUnavailableResponse(tradeDate, '涨停池上游未返回有效数据', fetchedAt);
      }

      if (!('pool' in data) || !Array.isArray(data.pool)) {
        return buildUnavailableResponse(tradeDate, '涨停池上游数据格式错误', fetchedAt);
      }

      const pool = data.pool;
      totalCount = asInteger(data.tc) ?? totalCount;
      currentPageSize = asInteger(data.pagesize) ?? currentPageSize;

      if (pool.length === 0) {
        emptyPageCount += 1;
        break;
      }

      emptyPageCount = 0;

      for (const raw of pool) {
        const item = mapEastmoneyLimitUpItem(raw);

        if (!item || seen.has(item.symbol)) {
          continue;
        }

        seen.add(item.symbol);
        items.push(item);
      }

      pageIndex += 1;

      if (totalCount !== null && items.length >= totalCount) {
        break;
      }

      if (totalCount !== null && pageIndex * currentPageSize >= totalCount) {
        break;
      }

      if (pool.length < currentPageSize) {
        break;
      }
    }

    if (emptyPageCount > 1) {
      return buildUnavailableResponse(tradeDate, '涨停池分页响应异常', fetchedAt);
    }

    return {
      tradeDate,
      items,
      fetchedAt,
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '涨停池上游请求超时'
        : '涨停池上游请求失败';

    return buildUnavailableResponse(tradeDate, message, fetchedAt);
  }
};
