import type {
  MinuteSeriesItem,
  MinuteSeriesResponse,
  Quote,
  QuoteMap,
  QuotesResponse,
  QuoteSource,
} from '../types';

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

/**
 * 服务端 `/api/quotes` 单次最多接受 50 个代码（见 server/index.ts 的 parseSymbols），
 * 多出来的会被**静默丢掉**而不是报错，所以超过这个数必须分批。
 * 竞价列表的候选池有 80~90 只，不分批会让后几十只永远没有行情。
 */
export const QUOTES_BATCH_SIZE = 50;

const requestQuoteBatch = async (
  symbols: string[],
  fetchImpl: typeof fetch,
): Promise<QuotesResponse> => {
  const response = await fetchImpl(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);

  if (!response.ok) {
    throw new Error(`行情请求失败（${response.status}）`);
  }

  return (await response.json()) as QuotesResponse;
};

/** 多批合并时还原整体来源：都一样就用它，混着来就是「两家混用」 */
const mergeQuoteSources = (sources: QuoteSource[]): QuoteSource =>
  sources.every((source) => source === sources[0]) ? sources[0] : 'eastmoney+tencent';

export const fetchQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<QuotesResponse> => {
  const dedupedSymbols = uniqueSymbols(symbols);

  if (dedupedSymbols.length === 0) {
    return { quotes: [], fetchedAt: new Date().toISOString(), source: 'eastmoney', errors: [] };
  }

  const batches: string[][] = [];
  for (let offset = 0; offset < dedupedSymbols.length; offset += QUOTES_BATCH_SIZE) {
    batches.push(dedupedSymbols.slice(offset, offset + QUOTES_BATCH_SIZE));
  }

  const settled = await Promise.allSettled(
    batches.map((batch) => requestQuoteBatch(batch, fetchImpl)),
  );
  const fulfilled = settled.filter(
    (entry): entry is PromiseFulfilledResult<QuotesResponse> => entry.status === 'fulfilled',
  );

  // 全批都没拿到响应时保持老契约：直接抛错，由调用方决定怎么提示
  if (fulfilled.length === 0) {
    const failure = settled.find((entry) => entry.status === 'rejected');
    throw failure && failure.status === 'rejected' ? failure.reason : new Error('行情刷新失败');
  }

  const errors = fulfilled.flatMap((entry) => entry.value.errors);
  settled.forEach((entry, index) => {
    if (entry.status === 'rejected') {
      // 部分批次失败：只把这一批的代码标成失败，其它批的行情照常返回
      for (const symbol of batches[index]) {
        errors.push({
          symbol,
          message: entry.reason instanceof Error ? entry.reason.message : '行情刷新失败',
        });
      }
    }
  });

  return {
    quotes: fulfilled.flatMap((entry) => entry.value.quotes),
    errors,
    fetchedAt: fulfilled.reduce(
      (latest, entry) => (entry.value.fetchedAt > latest ? entry.value.fetchedAt : latest),
      fulfilled[0].value.fetchedAt,
    ),
    source: mergeQuoteSources(fulfilled.map((entry) => entry.value.source)),
  };
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

/**
 * 当日分时序列。服务端 `/api/minute` 与 `/api/quotes` 用同一个 `parseSymbols`，
 * 同样单次最多 50 个代码，所以这里按同一批次大小分批。
 *
 * 上游一次只给一只票，服务端要逐只抓，**不要在 10 秒行情轮询里调它**。
 */
export const fetchMinuteSeries = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<MinuteSeriesItem[]> => {
  const dedupedSymbols = uniqueSymbols(symbols);
  if (dedupedSymbols.length === 0) {
    return [];
  }

  const batches: string[][] = [];
  for (let offset = 0; offset < dedupedSymbols.length; offset += QUOTES_BATCH_SIZE) {
    batches.push(dedupedSymbols.slice(offset, offset + QUOTES_BATCH_SIZE));
  }

  const settled = await Promise.allSettled(
    batches.map(async (batch) => {
      const response = await fetchImpl(`/api/minute?symbols=${encodeURIComponent(batch.join(','))}`);
      if (!response.ok) {
        throw new Error(`分时请求失败（${response.status}）`);
      }
      return (await response.json()) as MinuteSeriesResponse;
    }),
  );

  // 分时是增强信息：部分批次失败就少画几行，不抛错、不阻塞行情
  return settled.flatMap((entry) => (entry.status === 'fulfilled' ? entry.value.series : []));
};
