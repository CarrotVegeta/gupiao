import type { Quote, QuoteError } from '../../src/types';

type EastmoneyQuoteData = {
  f43?: unknown;
  f57?: unknown;
  f58?: unknown;
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
  const raw = asString(value);
  if (!/^\d{14}$/.test(raw)) {
    return null;
  }

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const next = new Date(Date.UTC(year, month, day, hour, minute, second));

  return Number.isNaN(next.getTime()) ? null : next.toISOString();
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
  const price = asNumber(data?.f43);
  const pct = asNumber(data?.f170);

  return {
    symbol,
    name: asString(data?.f58),
    price,
    change: asNumber(data?.f169),
    pct,
    preClose: asNumber(data?.f60),
    updatedAt: parseVendorUpdatedAt(data?.f86) ?? fetchedAt,
    source: 'eastmoney',
    status: data === null ? 'unavailable' : price !== null && pct !== null ? 'fresh' : 'stale',
  };
};

const toRequestUrl = (symbol: string): string => {
  const secid = encodeURIComponent(toEastmoneySecId(symbol));
  return `${QUOTE_ENDPOINT}?secid=${secid}&fields=f43,f57,f58,f60,f169,f170,f86`;
};

const fetchSingleQuote = async (
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<{ quote?: Quote; error?: QuoteError }> => {
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
    return { quote: mapEastmoneyQuote(payload, fetchedAt) };
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
