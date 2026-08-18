import type { StockSearchResponse, StockSearchResult } from '../types';

const isSearchResult = (value: unknown): value is StockSearchResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as Partial<StockSearchResult>;
  return typeof result.symbol === 'string' && /^\d{6}$/.test(result.symbol) && typeof result.name === 'string';
};

export const searchStocks = async (
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockSearchResult[]> => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const response = await fetchImpl(`/api/stock-search?query=${encodeURIComponent(normalizedQuery)}`);

  if (!response.ok) {
    throw new Error(`股票搜索失败（${response.status}）`);
  }

  const payload = (await response.json()) as Partial<StockSearchResponse>;

  return Array.isArray(payload.results) ? payload.results.filter(isSearchResult).slice(0, 8) : [];
};
