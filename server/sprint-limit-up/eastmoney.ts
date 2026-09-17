import type { SprintLimitUpItem, SprintLimitUpResponse } from '../../src/types.js';

type EastmoneySprintLimitUpRow = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 5_000;
const REQUEST_PAGE_SIZE = 100;
const MAX_PAGE_COUNT = 50;
const SPRINT_LIMIT_UP_ENDPOINT = 'https://push2ex.eastmoney.com/getTopicQSPool';
const EASTMONEY_UT = '7eea3edcaed734bea9cbfc24409ed989';
const EASTMONEY_DPT = 'wz.ztzt';
const MIN_SPRINT_GAIN_PCT = 7;
const MIN_SPRINT_SPEED_PCT = 0.1;
const MAX_SPRINT_GAP_PCT = 3;

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
    (typeof value === 'string' &&
      (value.trim() === '' || value.trim() === '-' || value.trim() === '--'))
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

const normalizeSymbol = (value: unknown): string => {
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

const formatReason = (value: unknown): string | null => {
  const code = asInteger(value);

  switch (code) {
    case 1:
      return '60日新高';
    case 2:
      return '近期多次涨停';
    case 3:
      return '60日新高且近期多次涨停';
    default: {
      const text = asString(value);
      return text && !/^\d+$/.test(text) ? text : null;
    }
  }
};

const getLimitUpCount = (raw: EastmoneySprintLimitUpRow): number | null => {
  if (isRecord(raw.zttj)) {
    return asInteger(raw.zttj.ct);
  }

  return asInteger(raw.lbc);
};

const isAlreadyLimitUp = (raw: EastmoneySprintLimitUpRow): boolean => {
  const price = asNumber(raw.p);
  const limitUpPrice = asNumber(raw.ztp);

  return price !== null && limitUpPrice !== null && price >= limitUpPrice;
};

const isSprintCandidate = (raw: EastmoneySprintLimitUpRow): boolean => {
  const price = asNumber(raw.p);
  const limitUpPrice = asNumber(raw.ztp);
  const pct = asNumber(raw.zdp);
  const speed = asNumber(raw.zs);

  if (
    price === null ||
    limitUpPrice === null ||
    limitUpPrice <= 0 ||
    pct === null ||
    speed === null ||
    isAlreadyLimitUp(raw)
  ) {
    return false;
  }

  const gapPct = ((limitUpPrice - price) / limitUpPrice) * 100;

  return pct >= MIN_SPRINT_GAIN_PCT && speed >= MIN_SPRINT_SPEED_PCT && gapPct <= MAX_SPRINT_GAP_PCT;
};

const buildUnavailableResponse = (
  message: string,
  fetchedAt = new Date().toISOString(),
): SprintLimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: message,
});

export const mapEastmoneySprintLimitUpItem = (
  raw: EastmoneySprintLimitUpRow,
): SprintLimitUpItem | null => {
  const symbol = normalizeSymbol(raw.c);
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
    speed: asNumber(raw.zs),
    boardCount: getLimitUpCount(raw),
    probability: null,
    reason: formatReason(raw.cc),
  };
};

const toRequestUrl = (tradeDate: string, pageIndex: number): string => {
  const params = new URLSearchParams({
    ut: EASTMONEY_UT,
    dpt: EASTMONEY_DPT,
    Pageindex: String(pageIndex),
    pagesize: String(REQUEST_PAGE_SIZE),
    sort: 'zdp:desc',
    date: tradeDate,
  });

  return `${SPRINT_LIMIT_UP_ENDPOINT}?${params.toString()}`;
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
      headers: {
        Accept: 'application/json',
        Referer: 'https://quote.eastmoney.com/ztb/?from=center',
        'User-Agent': 'Mozilla/5.0',
      },
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

export const fetchEastmoneySprintLimitUp = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SprintLimitUpResponse> => {
  const fetchedAt = new Date().toISOString();
  const items: SprintLimitUpItem[] = [];
  const seen = new Set<string>();
  let receivedPoolRows = 0;
  let totalCount: number | null = null;
  let completed = false;

  try {
    for (let pageIndex = 0; pageIndex < MAX_PAGE_COUNT; pageIndex += 1) {
      const page = await fetchPage(tradeDate, pageIndex, fetchImpl);

      if (page.kind === 'http-error') {
        return buildUnavailableResponse(
          `冲刺涨停上游请求失败（HTTP ${page.status}）`,
          fetchedAt,
        );
      }

      if (page.kind === 'invalid-json') {
        return buildUnavailableResponse('冲刺涨停上游响应格式错误', fetchedAt);
      }

      if (!isRecord(page.payload)) {
        return buildUnavailableResponse('冲刺涨停上游数据格式错误', fetchedAt);
      }

      const responseCode = asInteger(page.payload.rc);
      if (responseCode !== null && responseCode !== 0) {
        return buildUnavailableResponse(
          `冲刺涨停上游请求失败（rc ${responseCode}）`,
          fetchedAt,
        );
      }

      if (!isRecord(page.payload.data) || !Array.isArray(page.payload.data.pool)) {
        return buildUnavailableResponse('冲刺涨停上游数据格式错误', fetchedAt);
      }

      const data = page.payload.data;
      const pool = data.pool;
      if (!Array.isArray(pool)) {
        return buildUnavailableResponse('冲刺涨停上游数据格式错误', fetchedAt);
      }

      const reportedTotal = asNonNegativeInteger(data.tc);
      if (reportedTotal !== null) {
        totalCount = totalCount === null ? reportedTotal : Math.max(totalCount, reportedTotal);
      }

      if (pool.length === 0) {
        if (totalCount !== null && receivedPoolRows < totalCount) {
          return buildUnavailableResponse('冲刺涨停分页数据不完整', fetchedAt);
        }

        completed = true;
        break;
      }

      receivedPoolRows += pool.length;

      for (const raw of pool) {
        const item =
          isRecord(raw) && isSprintCandidate(raw) ? mapEastmoneySprintLimitUpItem(raw) : null;

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
      return buildUnavailableResponse('冲刺涨停分页数据不完整', fetchedAt);
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
      isAbortError(error) ? '冲刺涨停上游请求超时' : '冲刺涨停上游请求失败',
      fetchedAt,
    );
  }
};
