import type { Quote, QuoteMap, QuotesResponse } from '../types';

const CURRENCY_FORMATTER = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PERCENT_FORMATTER = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const INVALID_SYMBOL_MESSAGE = '股票代码必须是 6 位数字';

const normalizeSymbol = (value: string): string => {
  const next = value.trim();

  if (!/^\d{6}$/.test(next)) {
    throw new Error(INVALID_SYMBOL_MESSAGE);
  }

  return next;
};

const uniqueSymbols = (symbols: string[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol)));

const formatDateParts = (value: string): string | null => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = TIME_FORMATTER.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

export const fetchQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<QuotesResponse> => {
  const dedupedSymbols = uniqueSymbols(symbols);
  const response = await fetchImpl(`/api/quotes?symbols=${encodeURIComponent(dedupedSymbols.join(','))}`);

  if (!response.ok) {
    throw new Error(`行情请求失败（${response.status}）`);
  }

  return (await response.json()) as QuotesResponse;
};

const isFiniteNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

const isUsableFreshQuote = (quote: Quote): boolean =>
  quote.status === 'fresh' &&
  /^\d{6}$/.test(quote.symbol) &&
  isFiniteNumber(quote.price) &&
  isFiniteNumber(quote.change) &&
  isFiniteNumber(quote.pct) &&
  isFiniteNumber(quote.preClose) &&
  quote.updatedAt !== null &&
  !Number.isNaN(new Date(quote.updatedAt).getTime());

export const mergeQuotes = (
  previous: QuoteMap,
  response: QuotesResponse,
): QuoteMap => {
  const next: QuoteMap = { ...previous };

  for (const quote of response.quotes) {
    if (isUsableFreshQuote(quote)) {
      next[quote.symbol] = quote;
      continue;
    }

    const existing = next[quote.symbol];

    if (existing) {
      next[quote.symbol] = { ...existing, status: 'stale' };
    }
  }

  for (const error of response.errors) {
    const existing = next[error.symbol];

    if (existing) {
      next[error.symbol] = {
        ...existing,
        status: 'stale',
      };
    }
  }

  return next;
};

export const formatCurrency = (value: number | null): string =>
  value === null ? '—' : `¥${CURRENCY_FORMATTER.format(value)}`;

/** 表格里的价格不显示货币符号（对齐 F 的 7.11 / +0.35） */
export const formatPrice = (value: number | null): string =>
  value === null ? '—' : CURRENCY_FORMATTER.format(value);

export const formatPercent = (value: number | null): string =>
  value === null ? '—' : `${PERCENT_FORMATTER.format(value)}%`;

export const formatQuoteTime = (value: string | null): string => {
  if (value === null) {
    return '—';
  }

  const formatted = formatDateParts(value);

  return formatted ?? '—';
};
