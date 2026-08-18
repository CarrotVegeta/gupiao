import type { Quote, QuoteError } from '../../src/types.js';

type EastmoneyQuoteData = {
  f43?: unknown;
  f57?: unknown;
  f58?: unknown;
  f59?: unknown;
  f60?: unknown;
  f169?: unknown;
  f170?: unknown;
  f86?: unknown;
} | null;

export type EastmoneyQuotePayload = {
  data: EastmoneyQuoteData;
};

const QUOTE_ENDPOINT = 'https://push2.eastmoney.com/api/qt/stock/get';
const REQUEST_TIMEOUT_MS = 5_000;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-') {
    return null;
  }

  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const parseVendorUpdatedAt = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();

  if (/^\d{10}$/.test(raw)) {
    const next = new Date(Number(raw) * 1_000);
    return Number.isNaN(next.getTime()) ? null : next.toISOString();
  }

  if (!/^\d{14}$/.test(raw)) {
    return null;
  }

  const year = Number(raw.slice(0, 4));
  const month = raw.slice(4, 6);
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const next = new Date(
    `${year}-${month}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(
      minute,
    ).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`,
  );

  return Number.isNaN(next.getTime()) ? null : next.toISOString();
};

const getPriceDivisor = (value: unknown): number => {
  const precision = asNumber(value);

  return precision !== null && Number.isInteger(precision) && precision >= 0 && precision <= 8
    ? 10 ** precision
    : 100;
};

const normalizeRawValue = (value: unknown, divisor: number): number | null => {
  const raw = asNumber(value);
  return raw === null ? null : raw / divisor;
};

export const normalizeSymbol = (value: string): string => {
  const next = value.trim();
  if (!/^\d{6}$/.test(next)) {
    throw new Error('股票代码必须是 6 位数字');
  }

  return next;
};

export const toEastmoneySecId = (symbol: string): string =>
  symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`;

export const mapEastmoneyQuote = (
  payload: EastmoneyQuotePayload,
  fetchedAt: string,
): Quote => {
  const data = payload.data;
  const symbol = asString(data?.f57);
  const divisor = getPriceDivisor(data?.f59);
  const price = normalizeRawValue(data?.f43, divisor);
  const change = normalizeRawValue(data?.f169, divisor);
  const pct = normalizeRawValue(data?.f170, 100);
  const preClose = normalizeRawValue(data?.f60, divisor);
  const vendorUpdatedAt = parseVendorUpdatedAt(data?.f86);
  const name = asString(data?.f58);
  const isComplete =
    data !== null &&
    symbol.length > 0 &&
    name.trim().length > 0 &&
    price !== null &&
    change !== null &&
    pct !== null &&
    preClose !== null &&
    vendorUpdatedAt !== null;

  return {
    symbol,
    name,
    price,
    change,
    pct,
    preClose,
    updatedAt: vendorUpdatedAt ?? fetchedAt,
    source: 'eastmoney',
    status: data === null ? 'unavailable' : isComplete ? 'fresh' : 'stale',
  };
};

const toRequestUrl = (symbol: string): string => {
  const secid = encodeURIComponent(toEastmoneySecId(symbol));
  return `${QUOTE_ENDPOINT}?secid=${secid}&fields=f43,f57,f58,f59,f60,f169,f170,f86`;
};

const fetchSingleQuote = async (
  rawSymbol: string,
  fetchImpl: typeof fetch,
): Promise<{ quote?: Quote; error?: QuoteError }> => {
  let symbol: string;
  try {
    symbol = normalizeSymbol(rawSymbol);
  } catch (error) {
    return {
      error: {
        symbol: rawSymbol.trim(),
        message: error instanceof Error ? error.message : '未知错误',
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(toRequestUrl(symbol), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        error: {
          symbol,
          message: `HTTP ${response.status}`,
        },
      };
    }

    const payload = (await response.json()) as EastmoneyQuotePayload;

    if (payload.data === null || payload.data === undefined) {
      return { error: { symbol, message: '上游未返回行情数据' } };
    }

    const quote = mapEastmoneyQuote(payload, fetchedAt);

    if (quote.status !== 'fresh' || quote.symbol !== symbol) {
      return { error: { symbol, message: '上游行情数据不完整' } };
    }

    return { quote };
  } catch (error) {
    return {
      error: {
        symbol,
        message: error instanceof Error ? error.message : '未知错误',
      },
    };
  } finally {
    clearTimeout(timer);
  }
};

export const fetchEastmoneyQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ quotes: Quote[]; errors: QuoteError[] }> => {
  const results = await Promise.all(symbols.map((symbol) => fetchSingleQuote(symbol, fetchImpl)));

  return results.reduce(
    (acc, result) => {
      if (result.quote) {
        acc.quotes.push(result.quote);
      }

      if (result.error) {
        acc.errors.push(result.error);
      }

      return acc;
    },
    { quotes: [] as Quote[], errors: [] as QuoteError[] },
  );
};
