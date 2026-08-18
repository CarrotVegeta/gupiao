import type { QuoteMap, QuotesResponse } from '../types';

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

const uniqueSymbols = (symbols: string[]): string[] =>
  Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean)));

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

export const mergeQuotes = (
  previous: QuoteMap,
  response: QuotesResponse,
): QuoteMap => {
  const next: QuoteMap = { ...previous };

  for (const quote of response.quotes) {
    next[quote.symbol] = quote;
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

export const formatPercent = (value: number | null): string =>
  value === null ? '—' : `${PERCENT_FORMATTER.format(value)}%`;

export const formatQuoteTime = (value: string | null): string => {
  if (value === null) {
    return '—';
  }

  const formatted = formatDateParts(value);

  return formatted ?? '—';
};
