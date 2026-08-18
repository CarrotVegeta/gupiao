export type StockGroup = {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt: string;
};

export type Holding = {
  id: string;
  symbol: string;
  name: string;
  groupId: string;
  openPrice: number | null;
  quantity: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type StorageState = {
  groups: StockGroup[];
  holdings: Holding[];
};

export type Quote = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  pct: number | null;
  preClose: number | null;
  updatedAt: string | null;
  source: "eastmoney";
  status: "fresh" | "stale" | "unavailable";
};

export type QuoteMap = Record<string, Quote>;

export type QuoteError = {
  symbol: string;
  message: string;
};

export type StockSearchResult = {
  symbol: string;
  name: string;
};

export type StockSearchResponse = {
  results: StockSearchResult[];
  source: 'eastmoney';
};

export type QuotesResponse = {
  quotes: Quote[];
  fetchedAt: string;
  source: "eastmoney";
  errors: QuoteError[];
};

export type HoldingPerformance = {
  profit: number | null;
  returnPct: number | null;
  hasQuote: boolean;
};

export type PortfolioSummary = {
  invested: number;
  marketValue: number;
  profit: number | null;
  returnPct: number | null;
  hasPartialQuotes: boolean;
  holdingCount: number;
};
