import { describe, expect, it } from 'vitest';
import type { Holding, Quote } from '../types';
import { calculateHoldingPerformance, calculatePortfolioSummary } from './calculations';

const holding = (overrides: Partial<Holding> = {}): Holding => ({
  id: 'h-1',
  symbol: '600519',
  groupId: 'ungrouped',
  openPrice: 10,
  quantity: 100,
  note: '',
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  name: '贵州茅台',
  ...overrides,
});

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  symbol: '600519',
  name: '贵州茅台',
  price: 12,
  change: 2,
  pct: 20,
  preClose: 10,
  updatedAt: '2026-08-18T10:30:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  ...overrides,
});

describe('calculation helpers', () => {
  it('excludes an observation holding without position details from return totals', () => {
    const result = calculatePortfolioSummary(
      [holding({ openPrice: null, quantity: null })],
      { '600519': quote({ price: 12 }) },
    );

    expect(result).toMatchObject({
      invested: 0,
      marketValue: 0,
      profit: null,
      returnPct: null,
      hasPartialQuotes: false,
      holdingCount: 1,
    });
  });

  it('calculates one holding profit and return from the latest price', () => {
    const result = calculateHoldingPerformance(
      holding({ openPrice: 10, quantity: 100 }),
      quote({ price: 12 }),
    );

    expect(result).toEqual({ profit: 200, returnPct: 20, hasQuote: true });
  });

  it('calculates a weighted portfolio summary', () => {
    const result = calculatePortfolioSummary(
      [
        holding({ id: 'a', symbol: '600519', openPrice: 10, quantity: 100 }),
        holding({ id: 'b', symbol: '000001', openPrice: 20, quantity: 50, name: '平安银行' }),
      ],
      {
        '600519': quote({ symbol: '600519', price: 12 }),
        '000001': quote({ symbol: '000001', price: 18, name: '平安银行' }),
      },
    );

    expect(result).toMatchObject({
      invested: 2000,
      marketValue: 2100,
      profit: 100,
      returnPct: 5,
      hasPartialQuotes: false,
      holdingCount: 2,
    });
  });

  it('marks the summary partial instead of treating a missing quote as zero', () => {
    const result = calculatePortfolioSummary(
      [holding({ symbol: '600519' }), holding({ symbol: '000001', name: '平安银行' })],
      { '600519': quote({ symbol: '600519', price: 12 }) },
    );

    expect(result.marketValue).toBe(1200);
    expect(result.profit).toBeNull();
    expect(result.returnPct).toBeNull();
    expect(result.hasPartialQuotes).toBe(true);
  });

  it('rejects a non-positive opening price without returning a valid performance', () => {
    expect(() =>
      calculateHoldingPerformance(holding({ openPrice: 0 }), quote({ price: 12 })),
    ).toThrow('开仓价必须大于 0');
  });

  it('rejects a non-finite or non-positive quantity without returning a valid performance', () => {
    expect(() =>
      calculateHoldingPerformance(holding({ quantity: Number.POSITIVE_INFINITY }), quote({ price: 12 })),
    ).toThrow('持有数量必须大于 0');

    expect(() =>
      calculatePortfolioSummary(
        [holding({ symbol: '600519', quantity: 0 })],
        { '600519': quote({ symbol: '600519', price: 12 }) },
      ),
    ).toThrow('持有数量必须大于 0');
  });
});
