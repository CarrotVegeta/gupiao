import { describe, expect, it } from 'vitest';
import type { Holding, Quote, QuoteMap } from '../types';
import {
  calculateWatchReturn,
  currentQuotePrice,
  formatWatchDate,
  formatWatchDateTime,
  formatWatchReturn,
  snapshotWatchPrices,
  watchDateSortValue,
} from './watchlist';

const holdingFixture = (overrides: Partial<Holding> = {}): Holding => ({
  id: 'h-1',
  symbol: '600519',
  name: '贵州茅台',
  groupId: '',
  openPrice: null,
  quantity: null,
  note: '',
  createdAt: '2026-09-18T01:40:00.000Z',
  updatedAt: '2026-09-18T01:40:00.000Z',
  watchPrice: null,
  watchPriceAt: null,
  ...overrides,
});

const quoteFixture = (overrides: Partial<Quote> = {}): Quote => ({
  symbol: '600519',
  name: '贵州茅台',
  price: 12,
  change: 0.5,
  pct: 4.35,
  turnover: 1.2,
  volumeRatio: 1.1,
  amount: 100_000_000,
  preClose: 11.5,
  updatedAt: '2026-09-18T02:00:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  ...overrides,
});

describe('currentQuotePrice', () => {
  it('takes the live price of a usable quote', () => {
    expect(currentQuotePrice(quoteFixture({ price: 12.27 }))).toBe(12.27);
  });

  it('refuses an unavailable quote or a missing price', () => {
    // 没取到行情 / 上游没给价：都不能当成「加入当时的价格」
    expect(currentQuotePrice(quoteFixture({ status: 'unavailable' }))).toBeNull();
    expect(currentQuotePrice(quoteFixture({ price: null }))).toBeNull();
    expect(currentQuotePrice(undefined)).toBeNull();
  });
});

describe('snapshotWatchPrices', () => {
  const takenAt = '2026-09-18T02:30:00.000Z';

  it('records the price for rows that have no baseline yet', () => {
    const { holdings, captured } = snapshotWatchPrices(
      [holdingFixture()],
      { '600519': quoteFixture({ price: 12.27 }) },
      takenAt,
    );

    expect(captured).toBe(1);
    expect(holdings[0].watchPrice).toBe(12.27);
    expect(holdings[0].watchPriceAt).toBe(takenAt);
    // 原对象不动：调用方靠返回值决定要不要落盘
    expect(holdingFixture().watchPrice).toBeNull();
  });

  it('never overwrites an existing baseline, so a later refresh cannot move 自选收益 的起点', () => {
    const holding = holdingFixture({ watchPrice: 10, watchPriceAt: '2026-09-01T01:00:00.000Z' });

    const { holdings, captured } = snapshotWatchPrices(
      [holding],
      { '600519': quoteFixture({ price: 99 }) },
      takenAt,
    );

    expect(captured).toBe(0);
    expect(holdings[0]).toBe(holding);
    expect(holdings[0].watchPrice).toBe(10);
  });

  it('leaves rows without a usable quote for the next round', () => {
    const { holdings, captured } = snapshotWatchPrices(
      [holdingFixture(), holdingFixture({ id: 'h-2', symbol: '000001' })],
      { '600519': quoteFixture({ status: 'stale' }) },
      takenAt,
    );

    expect(captured).toBe(1);
    expect(holdings[0].watchPrice).toBe(12);
    expect(holdings[1].watchPrice).toBeNull();
  });

  it('does not invent a baseline from another stock quote', () => {
    const quotes: QuoteMap = { '000001': quoteFixture({ symbol: '000001', price: 9.9 }) };

    const { holdings, captured } = snapshotWatchPrices([holdingFixture()], quotes, takenAt);

    expect(captured).toBe(0);
    expect(holdings[0].watchPrice).toBeNull();
  });
});

describe('calculateWatchReturn', () => {
  it('measures the move since the stock was added to the watchlist', () => {
    const holding = holdingFixture({ watchPrice: 10 });

    // (12 − 10) / 10 × 100
    expect(calculateWatchReturn(holding, quoteFixture({ price: 12 }))).toBeCloseTo(20, 10);
    expect(calculateWatchReturn(holding, quoteFixture({ price: 8 }))).toBeCloseTo(-20, 10);
    expect(calculateWatchReturn(holding, quoteFixture({ price: 10 }))).toBe(0);
  });

  it('uses the baseline, not the previous close, as the reference', () => {
    const holding = holdingFixture({ watchPrice: 10 });
    const quote = quoteFixture({ price: 12, preClose: 11, pct: 9.09 });

    // 拿昨收算会得到 9.09%（那是「涨跌幅」列），自选收益要的是 20%
    expect(calculateWatchReturn(holding, quote)).toBeCloseTo(20, 10);
  });

  it('returns null rather than 0% when the baseline or the quote is missing', () => {
    expect(calculateWatchReturn(holdingFixture({ watchPrice: null }), quoteFixture())).toBeNull();
    expect(calculateWatchReturn(holdingFixture(), undefined)).toBeNull();
    expect(
      calculateWatchReturn(holdingFixture({ watchPrice: 10 }), quoteFixture({ price: null })),
    ).toBeNull();
    expect(
      calculateWatchReturn(
        holdingFixture({ watchPrice: 10 }),
        quoteFixture({ status: 'unavailable' }),
      ),
    ).toBeNull();
  });
});

describe('formatWatchReturn', () => {
  it('signs the value and keeps two decimals', () => {
    expect(formatWatchReturn(20)).toBe('+20.00%');
    expect(formatWatchReturn(-3.456)).toBe('−3.46%');
    expect(formatWatchReturn(0)).toBe('+0.00%');
  });

  it('shows a dash instead of a fake zero', () => {
    expect(formatWatchReturn(null)).toBe('—');
  });
});

describe('自选日', () => {
  it('formats the baseline moment as a Beijing-time calendar day', () => {
    // 2026-09-18T01:40:00Z 就是北京时间 09:40
    expect(formatWatchDate('2026-09-18T01:40:00.000Z')).toBe('2026/09/18');
    // 跨日：UTC 还是 17 号，北京已经是 18 号
    expect(formatWatchDate('2026-09-17T16:30:00.000Z')).toBe('2026/09/18');
  });

  it('keeps the full moment for the hover title', () => {
    expect(formatWatchDateTime('2026-09-18T01:40:00.000Z')).toBe('2026/09/18 09:40:00');
  });

  it('shows a dash for an unparsable timestamp', () => {
    expect(formatWatchDate('not-a-date')).toBe('—');
    expect(formatWatchDateTime('not-a-date')).toBe('—');
  });

  it('uses the baseline moment when there is one, and the creation time otherwise', () => {
    expect(
      watchDateSortValue(
        holdingFixture({ watchPrice: 10, watchPriceAt: '2026-09-18T01:40:00.000Z' }),
      ),
    ).toBe('2026-09-18T01:40:00.000Z');
    expect(watchDateSortValue(holdingFixture())).toBe('2026-09-18T01:40:00.000Z');
  });
});
