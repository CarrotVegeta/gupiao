import { describe, expect, it, vi } from 'vitest';
import type { Quote, QuotesResponse } from '../types';
import { fetchQuotes, formatCurrency, formatPercent, formatQuoteTime, mergeQuotes } from './quotes';

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

const validQuotesResponse = (): QuotesResponse => ({
  quotes: [quote()],
  fetchedAt: '2026-08-18T10:30:00.000Z',
  source: 'eastmoney',
  errors: [],
});

describe('quote helpers', () => {
  it('requests deduplicated normalized symbols from the local API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(validQuotesResponse())));

    await fetchQuotes([' 600519 ', '600519', ' 000001 '], fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/quotes?symbols=600519%2C000001');
  });

  it('rejects invalid symbols before calling the local API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(validQuotesResponse())));

    await expect(fetchQuotes(['600519', 'sh600519', '000001'], fetchImpl)).rejects.toThrow(
      '股票代码必须是 6 位数字',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws a user-facing error for non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad', { status: 500 }));

    await expect(fetchQuotes(['600519'], fetchImpl)).rejects.toThrow(/行情请求失败/);
    await expect(fetchQuotes(['600519'], fetchImpl)).rejects.toThrow(/500/);
  });

  it('marks a previous quote stale when the refresh response reports an error', () => {
    const previous = { '600519': quote({ symbol: '600519', status: 'fresh' }) };
    const next = mergeQuotes(previous, {
      ...validQuotesResponse(),
      quotes: [],
      errors: [{ symbol: '600519', message: 'timeout' }],
    });

    expect(next['600519'].status).toBe('stale');
    expect(next['600519'].price).toBe(previous['600519'].price);
  });

  it('keeps previous numeric values when an unavailable quote is returned', () => {
    const previous = { '600519': quote({ price: 1297.99, change: 4.9, pct: 0.38 }) };
    const next = mergeQuotes(previous, {
      ...validQuotesResponse(),
      quotes: [
        quote({
          price: null,
          change: null,
          pct: null,
          preClose: null,
          updatedAt: null,
          status: 'unavailable',
        }),
      ],
    });

    expect(next['600519']).toMatchObject({
      price: 1297.99,
      change: 4.9,
      pct: 0.38,
      status: 'stale',
    });
  });

  it('keeps previous numeric values when a fresh quote is incomplete', () => {
    const previous = { '600519': quote({ price: 1297.99, change: 4.9, pct: 0.38 }) };
    const next = mergeQuotes(previous, {
      ...validQuotesResponse(),
      quotes: [quote({ change: null })],
    });

    expect(next['600519']).toMatchObject({
      price: 1297.99,
      change: 4.9,
      pct: 0.38,
      status: 'stale',
    });
  });

  it('formats missing values as an em dash', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatQuoteTime(null)).toBe('—');
  });

  it('formats currency and percent values consistently', () => {
    expect(formatCurrency(1234.5)).toBe('¥1,234.50');
    expect(formatPercent(12.345)).toBe('12.35%');
  });
});
