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

const REQUEST_TIMEOUT_MS = 5_000;
const REQUEST_PAGE_SIZE = 100;
const MAX_PAGE_COUNT = 50;
const LIMIT_UP_ENDPOINT = 'https://push2ex.eastmoney.com/getTopicZTPool';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAbortError = (error: unknown): boolean =>
  isRecord(error) && error.name === 'AbortError';

const createAbortError = (): Error => {
  const error = new Error('request aborted');
  error.name = 'AbortError';
  return error;
};

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

const asInteger = (value: unknown): number | null => {
  const next = asNumber(value);
  return next !== null && Number.isInteger(next) ? next : null;
};

const asNonNegativeInteger = (value: unknown): number | null => {
  const next = asInteger(value);
  return next !== null && next >= 0 ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeLimitUpSymbol = (value: unknown): string => {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 999_999
      ? String(value).padStart(6, '0')
      : '';
  }

  if (typeof value !== 'string') {
    return '';
  }

  const raw = value.trim().toUpperCase();

  if (/^\d{1,6}$/.test(raw)) {
    return raw.padStart(6, '0');
  }

  const prefixed = raw.match(/^(?:SH|SZ|BJ)(\d{6})$/);
  if (prefixed) {
    return prefixed[1];
  }

  const quoteId = raw.match(/^(?:[01]\.)?(\d{6})(?:\.(?:SH|SZ|BJ))?$/);
  return quoteId?.[1] ?? '';
};

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
  message: string,
  fetchedAt = new Date().toISOString(),
): LimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: message,
});

export const mapEastmoneyLimitUpItem = (raw: EastmoneyLimitUpRow): LimitUpItem | null => {
  const symbol = normalizeLimitUpSymbol(raw.c);
  const name = asString(raw.n);

  if (!symbol || !name) {
    return null;
  }

  const rawPrice = asNumber(raw.p);

  return {
    symbol,
    name,
    price: rawPrice === null ? null : rawPrice / 1000,
    pct: asNumber(raw.zdp),
    boardCount: asInteger(raw.lbc),
    firstSealTime: formatTradeTime(raw.fbt),
    lastSealTime: formatTradeTime(raw.lbt),
    industry: asString(raw.hybk) || null,
    breakCount: asInteger(raw.zbc),
  };
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

type PageResult =
  | { kind: 'ok'; payload: unknown }
  | { kind: 'http-error'; status: number }
  | { kind: 'invalid-json' };

const fetchPage = async (
  tradeDate: string,
  pageIndex: number,
  fetchImpl: typeof fetch,
): Promise<PageResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(toRequestUrl(tradeDate, pageIndex), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { kind: 'http-error', status: response.status };
    }

    try {
      return { kind: 'ok', payload: await response.json() };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw createAbortError();
      }

      return { kind: 'invalid-json' };
    }
  } catch (error) {
    if (controller.signal.aborted && !isAbortError(error)) {
      throw createAbortError();
    }

    throw error;
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
  let receivedPoolRows = 0;
  let totalCount: number | null = null;
  let completed = false;

  try {
    for (let pageIndex = 0; pageIndex < MAX_PAGE_COUNT; pageIndex += 1) {
      const page = await fetchPage(tradeDate, pageIndex, fetchImpl);

      if (page.kind === 'http-error') {
        return buildUnavailableResponse(
          `涨停池上游请求失败（HTTP ${page.status}）`,
          fetchedAt,
        );
      }

      if (page.kind === 'invalid-json') {
        return buildUnavailableResponse('涨停池上游响应格式错误', fetchedAt);
      }

      if (!isRecord(page.payload) || !isRecord(page.payload.data)) {
        return buildUnavailableResponse('涨停池上游未返回有效数据', fetchedAt);
      }

      const data = page.payload.data;
      if (!('pool' in data) || !Array.isArray(data.pool)) {
        return buildUnavailableResponse('涨停池上游数据格式错误', fetchedAt);
      }

      const reportedTotal = asNonNegativeInteger(data.tc);
      if (reportedTotal !== null) {
        totalCount = totalCount === null ? reportedTotal : Math.max(totalCount, reportedTotal);
      }

      const pool = data.pool;
      if (pool.length === 0) {
        if (totalCount !== null && receivedPoolRows < totalCount) {
          return buildUnavailableResponse('涨停池分页数据不完整', fetchedAt);
        }

        completed = true;
        break;
      }

      receivedPoolRows += pool.length;

      for (const raw of pool) {
        const item = isRecord(raw) ? mapEastmoneyLimitUpItem(raw) : null;

        if (!item || seen.has(item.symbol)) {
          continue;
        }

        seen.add(item.symbol);
        items.push(item);
      }

      if (totalCount !== null && receivedPoolRows >= totalCount) {
        completed = true;
        break;
      }
    }

    if (!completed) {
      return buildUnavailableResponse('涨停池分页数据不完整', fetchedAt);
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
    return buildUnavailableResponse(
      isAbortError(error) ? '涨停池上游请求超时' : '涨停池上游请求失败',
      fetchedAt,
    );
  }
};
