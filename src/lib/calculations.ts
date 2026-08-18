import type { Holding, HoldingPerformance, PortfolioSummary, Quote } from '../types';

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const assertOptionalPositiveNumber = (value: number | null, message: string): void => {
  if (value !== null && (!isFiniteNumber(value) || value <= 0)) {
    throw new Error(message);
  }
};

const hasPositionDetails = (holding: Holding): holding is Holding & {
  openPrice: number;
  quantity: number;
} => holding.openPrice !== null && holding.quantity !== null;

const getUsablePrice = (quote: Quote | undefined): number | null =>
  quote && quote.status !== 'unavailable' && isFiniteNumber(quote.price) ? quote.price : null;

export const calculateHoldingPerformance = (
  holding: Holding,
  quote: Quote | undefined,
): HoldingPerformance => {
  assertOptionalPositiveNumber(holding.openPrice, '开仓价必须大于 0');
  assertOptionalPositiveNumber(holding.quantity, '持有数量必须大于 0');

  if (!hasPositionDetails(holding)) {
    return {
      profit: null,
      returnPct: null,
      hasQuote: false,
    };
  }

  const price = getUsablePrice(quote);

  if (price === null) {
    return {
      profit: null,
      returnPct: null,
      hasQuote: false,
    };
  }

  const profit = (price - holding.openPrice) * holding.quantity;
  const returnPct = ((price - holding.openPrice) / holding.openPrice) * 100;

  return {
    profit,
    returnPct,
    hasQuote: true,
  };
};

export const calculatePortfolioSummary = (
  holdings: Holding[],
  quotes: Record<string, Quote>,
): PortfolioSummary => {
  let invested = 0;
  let marketValue = 0;
  let hasPartialQuotes = false;

  for (const holding of holdings) {
    assertOptionalPositiveNumber(holding.openPrice, '开仓价必须大于 0');
    assertOptionalPositiveNumber(holding.quantity, '持有数量必须大于 0');

    if (!hasPositionDetails(holding)) {
      continue;
    }

    invested += holding.openPrice * holding.quantity;

    const quote = quotes[holding.symbol];
    const price = getUsablePrice(quote);

    if (price === null) {
      hasPartialQuotes = true;
      continue;
    }

    marketValue += price * holding.quantity;
  }

  const profitValue = marketValue - invested;
  const profit = hasPartialQuotes || invested === 0 ? null : profitValue;
  const returnPct = hasPartialQuotes || invested === 0 ? null : (profitValue / invested) * 100;

  return {
    invested,
    marketValue,
    profit,
    returnPct,
    hasPartialQuotes,
    holdingCount: holdings.length,
  };
};
