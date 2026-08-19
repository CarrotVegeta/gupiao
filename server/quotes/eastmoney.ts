import type { Quote, QuoteError, StockSearchResult } from '../../src/types.js';

type EastmoneySearchItem = {
  Code?: unknown;
  Name?: unknown;
  MktNum?: unknown;
  QuoteID?: unknown;
};

export type EastmoneySearchPayload = {
  QuotationCodeTable?: {
    Data?: EastmoneySearchItem[];
  };
};

type EastmoneyQuoteData = {
  f2?: unknown;
  f3?: unknown;
  f4?: unknown;
  f8?: unknown;
  f12?: unknown;
  f14?: unknown;
  f18?: unknown;
  f43?: unknown;
  f57?: unknown;
  f58?: unknown;
  f59?: unknown;
  f60?: unknown;
  f168?: unknown;
  f169?: unknown;
  f170?: unknown;
  f86?: unknown;
} | null;

export type EastmoneyQuotePayload = {
  data: EastmoneyQuoteData | {
    diff?: EastmoneyQuoteData[];
  } | null;
};

const QUOTE_ENDPOINT = 'https://push2.eastmoney.com/api/qt/stock/get';
const QUOTE_LIST_ENDPOINT = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const SEARCH_ENDPOINT = 'https://searchapi.eastmoney.com/api/suggest/get';
const SEARCH_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const REQUEST_TIMEOUT_MS = 8_000;

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

const getSearchCode = (item: EastmoneySearchItem): string => {
  const code = typeof item.Code === 'string' ? item.Code : '';

  if (/^\d{6}$/.test(code)) {
    return code;
  }

  const quoteId = typeof item.QuoteID === 'string' ? item.QuoteID : '';
  const fallbackCode = quoteId.split('.')[1] ?? '';

  return /^\d{6}$/.test(fallbackCode) ? fallbackCode : '';
};

export const mapEastmoneySearch = (payload: EastmoneySearchPayload): StockSearchResult[] => {
  const results: StockSearchResult[] = [];
  const seen = new Set<string>();
  const items = payload.QuotationCodeTable?.Data ?? [];

  for (const item of items) {
    const symbol = getSearchCode(item);
    const name = typeof item.Name === 'string' ? item.Name.trim() : '';

    if (!symbol || !name || seen.has(symbol)) {
      continue;
    }

    seen.add(symbol);
    results.push({ symbol, name });
  }

  return results.slice(0, 8);
};

const toSearchUrl = (query: string): string => {
  const params = new URLSearchParams({
    input: query,
    type: '14',
    token: SEARCH_TOKEN,
    count: '8',
  });

  return `${SEARCH_ENDPOINT}?${params.toString()}`;
};

export const fetchEastmoneySearch = async (
  rawQuery: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockSearchResult[]> => {
  const query = rawQuery.trim();

  if (!query) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(toSearchUrl(query), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return mapEastmoneySearch((await response.json()) as EastmoneySearchPayload);
  } finally {
    clearTimeout(timer);
  }
};

export const toEastmoneySecId = (symbol: string): string =>
  symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`;

const getQuoteData = (payload: EastmoneyQuotePayload): EastmoneyQuoteData => {
  const data = payload.data;

  if (data && typeof data === 'object' && 'diff' in data) {
    return Array.isArray(data.diff) ? data.diff[0] ?? null : null;
  }

  return data ?? null;
};

export const mapEastmoneyQuote = (
  payload: EastmoneyQuotePayload,
  fetchedAt: string,
): Quote => {
  const data = getQuoteData(payload);
  const symbol = asString(data?.f57 || data?.f12);
  const hasScaledFields = data?.f43 !== undefined || data?.f57 !== undefined;
  const divisor = hasScaledFields ? getPriceDivisor(data?.f59) : 1;
  const price = hasScaledFields
    ? normalizeRawValue(data?.f43, divisor)
    : asNumber(data?.f2);
  const change = hasScaledFields
    ? normalizeRawValue(data?.f169, divisor)
    : asNumber(data?.f4);
  const pct = hasScaledFields
    ? normalizeRawValue(data?.f170, 100)
    : asNumber(data?.f3);
  const turnover = hasScaledFields
    ? normalizeRawValue(data?.f168, 100)
    : asNumber(data?.f8);
  const preClose = hasScaledFields
    ? normalizeRawValue(data?.f60, divisor)
    : asNumber(data?.f18);
  const vendorUpdatedAt = parseVendorUpdatedAt(data?.f86);
  const name = asString(data?.f58 || data?.f14);
  const isComplete =
    data !== null &&
    symbol.length > 0 &&
    name.trim().length > 0 &&
    price !== null &&
    change !== null &&
    pct !== null &&
    preClose !== null;

  return {
    symbol,
    name,
    price,
    change,
    pct,
    turnover,
    preClose,
    updatedAt: vendorUpdatedAt ?? fetchedAt,
    source: 'eastmoney',
    status: data === null ? 'unavailable' : isComplete ? 'fresh' : 'stale',
  };
};

const toRequestUrl = (symbol: string): string => {
  const secid = encodeURIComponent(toEastmoneySecId(symbol));
  return `${QUOTE_ENDPOINT}?secid=${secid}&fields=f43,f57,f58,f59,f60,f168,f169,f170,f86`;
};

const toBatchRequestUrl = (symbols: string[]): string => {
  const secids = symbols.map(toEastmoneySecId).join(',');
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    fields: 'f12,f14,f2,f3,f4,f8,f18',
    secids,
  });

  return `${QUOTE_LIST_ENDPOINT}?${params.toString()}`;
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

const fetchBatchQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch,
): Promise<{ quotes: Quote[]; errors: QuoteError[] } | null> => {
  if (symbols.length === 0) {
    return { quotes: [], errors: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(toBatchRequestUrl(symbols), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as EastmoneyQuotePayload;
    const rows =
      payload.data && typeof payload.data === 'object' && 'diff' in payload.data
        ? payload.data.diff ?? []
        : [];
    const quotes: Quote[] = [];
    const found = new Set<string>();

    for (const row of rows) {
      const quote = mapEastmoneyQuote({ data: row }, fetchedAt);

      if (quote.status === 'fresh' && symbols.includes(quote.symbol)) {
        quotes.push(quote);
        found.add(quote.symbol);
      }
    }

    return {
      quotes,
      errors: symbols
        .filter((symbol) => !found.has(symbol))
        .map((symbol) => ({ symbol, message: '上游未返回行情数据' })),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchEastmoneyQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ quotes: Quote[]; errors: QuoteError[] }> => {
  const validSymbols: string[] = [];
  const errors: QuoteError[] = [];

  for (const rawSymbol of symbols) {
    try {
      validSymbols.push(normalizeSymbol(rawSymbol));
    } catch (error) {
      errors.push({
        symbol: rawSymbol.trim(),
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  }

  const uniqueSymbols = Array.from(new Set(validSymbols));
  const batch = await fetchBatchQuotes(uniqueSymbols, fetchImpl);
  const quotes = batch?.quotes ?? [];
  const missing = batch
    ? batch.errors.map((error) => error.symbol)
    : uniqueSymbols;

  const retries = await Promise.all(missing.map((symbol) => fetchSingleQuote(symbol, fetchImpl)));

  for (const result of retries) {
    if (result.quote) {
      quotes.push(result.quote);
    }

    if (result.error) {
      errors.push(result.error);
    }
  }

  return { quotes, errors };
};
