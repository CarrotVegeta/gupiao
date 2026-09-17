import type { MarketIndex, MarketIndicesResponse, QuoteError } from '../../src/types.js';

type EastmoneyMarketRow = {
  f2?: unknown;
  f3?: unknown;
  f4?: unknown;
  f6?: unknown;
  f12?: unknown;
  f14?: unknown;
};

export type EastmoneyMarketPayload = {
  data?: {
    diff?: EastmoneyMarketRow[] | Record<string, EastmoneyMarketRow>;
  } | null;
};

const REQUEST_TIMEOUT_MS = 5_000;
const MARKET_PATH = '/api/qt/ulist.np/get';

/**
 * push2 在部分网络会被上游直接断连（实测 15/15 次 RemoteDisconnected），
 * push2delay 是同一份数据的实时镜像（时间戳与主站同秒）。仍把主站放前面：
 * 万一镜像哪天真的变成延时行情，也不该在盘中悄悄用上。
 * 大盘页的主源已经是腾讯（server/market/tencent.ts），这里只是第二道兜底。
 */
const MARKET_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
] as const;

const MARKET_INDEX_CONFIG = [
  { symbol: '000001', name: '上证指数', secid: '1.000001' },
  { symbol: '399001', name: '深证成指', secid: '0.399001' },
  { symbol: '399006', name: '创业板指', secid: '0.399006' },
] as const;

const MARKET_SYMBOLS = ['000001', '399001', '399006'] as const;
const MARKET_SECIDS = '1.000001,0.399001,0.399006';

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
    amount: null,
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
): MarketIndicesResponse => {
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
): MarketIndicesResponse => {
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
    // f6 是原始成交额（元），不参与 f2/f3/f4 的 100 倍缩放
    const amount = asNumber(row?.f6);
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
      amount,
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

const toRequestUrl = (host: string): string => {
  const params = new URLSearchParams({
    secids: MARKET_SECIDS,
    fields: 'f2,f3,f4,f6,f12,f14',
  });

  return `${host}${MARKET_PATH}?${params.toString()}`;
};

type MarketFetch =
  | { kind: 'ok'; payload: EastmoneyMarketPayload }
  | { kind: 'http'; status: number }
  | { kind: 'timeout' }
  | { kind: 'body' }
  | { kind: 'network' };

const failureMessage = (failure: Exclude<MarketFetch, { kind: 'ok' }>): string => {
  switch (failure.kind) {
    case 'timeout':
      return '大盘指数上游请求超时';
    case 'http':
      return `大盘指数上游请求失败（HTTP ${failure.status}）`;
    case 'body':
      return '大盘指数上游响应格式错误';
    default:
      return '大盘指数上游请求失败';
  }
};

/** 依次尝试镜像与主站，每次尝试各自计时；返回最后一次失败的类型 */
const fetchMarketPayload = async (fetchImpl: typeof fetch): Promise<MarketFetch> => {
  let failure: Exclude<MarketFetch, { kind: 'ok' }> = { kind: 'network' };

  for (const host of MARKET_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(toRequestUrl(host), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        failure = { kind: 'http', status: response.status };
        continue;
      }

      try {
        return { kind: 'ok', payload: (await response.json()) as EastmoneyMarketPayload };
      } catch (error) {
        failure =
          controller.signal.aborted || isAbortError(error) ? { kind: 'timeout' } : { kind: 'body' };
      }
    } catch (error) {
      failure = controller.signal.aborted || isAbortError(error) ? { kind: 'timeout' } : { kind: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return failure;
};

export const fetchEastmoneyMarket = async (
  fetchImpl: typeof fetch = fetch,
): Promise<MarketIndicesResponse> => {
  const fetchedAt = new Date().toISOString();

  try {
    const result = await fetchMarketPayload(fetchImpl);

    if (result.kind !== 'ok') {
      return buildUnavailableResponse(failureMessage(result), fetchedAt);
    }

    if (!isRecord(result.payload)) {
      return buildUnavailableResponse('大盘指数上游数据格式错误', fetchedAt);
    }

    return mapEastmoneyMarket(result.payload as EastmoneyMarketPayload, fetchedAt);
  } catch {
    return buildUnavailableResponse('大盘指数上游请求失败', fetchedAt);
  }
};
