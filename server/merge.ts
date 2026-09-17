/**
 * 行情聚合：腾讯优先，缺口交给东财补。
 *
 * 抽成纯函数是为了能直接测三件容易出错的事：
 * 1. 两家结果怎么合（同一只票不能被覆盖成空）
 * 2. `source` 怎么标（谁真的贡献了数据）
 * 3. 已经补上的票不能把它的错误留在 errors 里 —— 前端 mergeQuotes 见到 error 会把行情标成 stale
 */
import type {
  MarketIndex,
  MarketIndicesResponse,
  Quote,
  QuoteError,
  QuoteSource,
  QuotesResponse,
} from '../src/types.js';

export type QuoteBundle = { quotes: Quote[]; errors: QuoteError[] };

export const toQuoteSource = (primaryOk: boolean, fallbackOk: boolean): QuoteSource => {
  if (primaryOk && fallbackOk) {
    return 'eastmoney+tencent';
  }

  return fallbackOk ? 'eastmoney' : 'tencent';
};

export const keepUnresolvedErrors = (errors: QuoteError[], resolved: Set<string>): QuoteError[] =>
  errors.filter((error) => !resolved.has(error.symbol));

export const mergeQuoteBundles = (
  primary: QuoteBundle,
  fallback: QuoteBundle,
  fetchedAt: string,
): QuotesResponse => {
  const quotes = [...primary.quotes, ...fallback.quotes];
  const resolved = new Set(quotes.map((quote) => quote.symbol));

  return {
    quotes,
    fetchedAt,
    source: toQuoteSource(primary.quotes.length > 0, fallback.quotes.length > 0),
    errors: keepUnresolvedErrors([...primary.errors, ...fallback.errors], resolved),
  };
};

export const mergeMarketIndices = (
  primary: MarketIndicesResponse,
  fallback: MarketIndicesResponse,
): MarketIndicesResponse => {
  const fallbackBySymbol = new Map(fallback.indices.map((index) => [index.symbol, index]));
  let usedFallback = false;

  const indices: MarketIndex[] = primary.indices.map((index) => {
    if (index.status === 'fresh') {
      return index;
    }

    const replacement = fallbackBySymbol.get(index.symbol);
    if (replacement && replacement.status === 'fresh') {
      usedFallback = true;
      return replacement;
    }

    return index;
  });

  const resolved = new Set(
    indices.filter((index) => index.status === 'fresh').map((index) => index.symbol),
  );

  return {
    indices,
    fetchedAt: primary.fetchedAt,
    source: toQuoteSource(
      primary.indices.some((index) => index.status === 'fresh'),
      usedFallback,
    ),
    errors: keepUnresolvedErrors([...primary.errors, ...fallback.errors], resolved),
  };
};
