import { describe, expect, it } from 'vitest';
import type { MarketIndex, Quote } from '../src/types.js';
import { keepUnresolvedErrors, mergeMarketIndices, mergeQuoteBundles, toQuoteSource } from './merge.js';

const quote = (symbol: string, source: Quote['source']): Quote => ({
  symbol,
  name: `票${symbol}`,
  price: 10,
  change: 0.1,
  pct: 1,
  turnover: 1,
  volumeRatio: 1.2,
  amount: 640_000_000,
  preClose: 9.9,
  updatedAt: '2026-09-17T06:30:00.000Z',
  source,
  status: 'fresh',
});

const index = (symbol: string, status: MarketIndex['status']): MarketIndex => ({
  symbol,
  name: `指数${symbol}`,
  price: status === 'fresh' ? 3000 : null,
  change: status === 'fresh' ? 10 : null,
  amount: status === 'fresh' ? 868_773_070_000 : null,
  pct: status === 'fresh' ? 0.3 : null,
  updatedAt: status === 'fresh' ? '2026-09-17T06:30:00.000Z' : null,
  status,
});

describe('quote source merge', () => {
  it('labels the source by who actually contributed data', () => {
    expect(toQuoteSource(true, false)).toBe('tencent');
    expect(toQuoteSource(false, true)).toBe('eastmoney');
    expect(toQuoteSource(true, true)).toBe('eastmoney+tencent');
    expect(toQuoteSource(false, false)).toBe('tencent');
  });

  it('keeps only the errors of symbols still missing a quote', () => {
    const errors = [
      { symbol: '600519', message: '腾讯未返回行情数据' },
      { symbol: '300750', message: '腾讯未返回行情数据' },
    ];

    expect(keepUnresolvedErrors(errors, new Set(['600519']))).toEqual([
      { symbol: '300750', message: '腾讯未返回行情数据' },
    ]);
  });

  it('clears the primary error once the fallback filled the symbol', () => {
    const result = mergeQuoteBundles(
      {
        quotes: [quote('600519', 'tencent')],
        errors: [{ symbol: '300750', message: '腾讯未返回行情数据' }],
      },
      {
        quotes: [quote('300750', 'eastmoney')],
        errors: [],
      },
      '2026-09-17T06:30:00.000Z',
    );

    // 前端见到 error 就会把该票标成 stale，所以补齐后必须把错误去掉
    expect(result.errors).toEqual([]);
    expect(result.quotes.map((item) => item.symbol)).toEqual(['600519', '300750']);
    expect(result.source).toBe('eastmoney+tencent');
  });

  it('keeps the error when neither source returned the symbol', () => {
    const result = mergeQuoteBundles(
      { quotes: [], errors: [{ symbol: '600519', message: '腾讯未返回行情数据' }] },
      { quotes: [], errors: [{ symbol: '600519', message: 'mirror unreachable' }] },
      '2026-09-17T06:30:00.000Z',
    );

    expect(result.quotes).toEqual([]);
    expect(result.source).toBe('tencent');
    expect(result.errors).toEqual([
      { symbol: '600519', message: '腾讯未返回行情数据' },
      { symbol: '600519', message: 'mirror unreachable' },
    ]);
  });

  it('fills only the indices the primary could not provide', () => {
    const merged = mergeMarketIndices(
      {
        indices: [index('000001', 'fresh'), index('399001', 'unavailable')],
        fetchedAt: '2026-09-17T06:30:00.000Z',
        source: 'tencent',
        errors: [{ symbol: '399001', message: '腾讯指数数据不完整' }],
      },
      {
        indices: [index('000001', 'fresh'), index('399001', 'fresh')],
        fetchedAt: '2026-09-17T06:30:00.000Z',
        source: 'eastmoney',
        errors: [],
      },
    );

    expect(merged.indices.map((item) => [item.symbol, item.status])).toEqual([
      ['000001', 'fresh'],
      ['399001', 'fresh'],
    ]);
    // 000001 仍来自腾讯，399001 由东财补上
    expect(merged.source).toBe('eastmoney+tencent');
    expect(merged.errors).toEqual([]);
    expect(merged.fetchedAt).toBe('2026-09-17T06:30:00.000Z');
  });

  it('keeps an index unavailable when both sources fail', () => {
    const merged = mergeMarketIndices(
      {
        indices: [index('000001', 'unavailable')],
        fetchedAt: '2026-09-17T06:30:00.000Z',
        source: 'tencent',
        errors: [{ symbol: '000001', message: '腾讯指数数据不完整' }],
      },
      {
        indices: [index('000001', 'unavailable')],
        fetchedAt: '2026-09-17T06:30:01.000Z',
        source: 'eastmoney',
        errors: [{ symbol: '000001', message: '大盘指数上游请求超时' }],
      },
    );

    expect(merged.indices[0]).toMatchObject({ symbol: '000001', status: 'unavailable' });
    // 两家都没数据时标主源，避免把「全部失败」说成东财提供
    expect(merged.source).toBe('tencent');
    expect(merged.errors).toHaveLength(2);
  });
});
