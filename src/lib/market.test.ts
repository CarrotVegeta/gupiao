import { describe, expect, it, vi } from 'vitest';
import type { MarketIndex, MarketOverviewResponse } from '../types';
import { fetchMarketOverview, mergeMarketOverview } from './market';

const marketResponse: MarketOverviewResponse = {
  indices: [
    {
      symbol: '000001',
      name: '上证指数',
      price: 3990.29,
      change: -0.01,
      pct: 0,
      updatedAt: '2026-08-19T02:00:00.000Z',
      status: 'fresh',
    },
    {
      symbol: '399001',
      name: '深证成指',
      price: 12500.1,
      change: 18.2,
      pct: 0.15,
      updatedAt: '2026-08-19T02:00:00.000Z',
      status: 'fresh',
    },
    {
      symbol: '399006',
      name: '创业板指',
      price: 2800.2,
      change: -9.5,
      pct: -0.34,
      updatedAt: '2026-08-19T02:00:00.000Z',
      status: 'fresh',
    },
    {
      symbol: '000688',
      name: '科创 50',
      price: 1100.3,
      change: 2.1,
      pct: 0.19,
      updatedAt: '2026-08-19T02:00:00.000Z',
      status: 'fresh',
    },
  ],
  fetchedAt: '2026-08-19T02:00:00.000Z',
  source: 'eastmoney',
  errors: [],
};

describe('market overview fixture', () => {
  it('keeps the expected market response shape', () => {
    expect(marketResponse.indices[0].symbol).toBe('000001');
    expect(marketResponse.source).toBe('eastmoney');
  });

  it('requests the market overview endpoint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(marketResponse)));

    await expect(fetchMarketOverview(fetchImpl)).resolves.toEqual(marketResponse);
    expect(fetchImpl).toHaveBeenCalledWith('/api/market-overview');
  });

  it('keeps four fixed slots when rows are malformed or missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          indices: [
            marketResponse.indices[0],
            {
              symbol: '399001',
              name: '深证成指',
              price: 'bad',
              change: 12.3,
              pct: 0.52,
              updatedAt: '2026-08-19T02:00:00.000Z',
              status: 'fresh',
            },
            {
              symbol: '399006',
              name: '创业板指',
              price: 2501.18,
              change: 10.2,
              pct: 0.41,
              updatedAt: null,
              status: 'unavailable',
            },
          ],
          fetchedAt: '2026-08-19T02:05:00.000Z',
          source: 'eastmoney',
          errors: [
            { symbol: '399006', message: '上游不可用' },
            { symbol: 123, message: '坏数据' },
          ],
        }),
      ),
    );

    const result = await fetchMarketOverview(fetchImpl);

    expect(result.indices).toEqual([
      marketResponse.indices[0],
      {
        symbol: '399001',
        name: '深证成指',
        price: null,
        change: null,
        pct: null,
        updatedAt: null,
        status: 'unavailable',
      },
      {
        symbol: '399006',
        name: '创业板指',
        price: 2501.18,
        change: 10.2,
        pct: 0.41,
        updatedAt: null,
        status: 'unavailable',
      },
      {
        symbol: '000688',
        name: '科创 50',
        price: null,
        change: null,
        pct: null,
        updatedAt: null,
        status: 'unavailable',
      },
    ]);
    expect(result.errors).toContainEqual({ symbol: '399006', message: '上游不可用' });
  });

  it('normalizes a malformed payload to four unavailable null placeholders', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          indices: {},
          fetchedAt: '2026-08-19T02:05:00.000Z',
          source: 'eastmoney',
          errors: [],
        }),
      ),
    );

    const result = await fetchMarketOverview(fetchImpl);

    expect(result.indices.map(({ symbol, name, price, change, pct, status }) => ({
      symbol,
      name,
      price,
      change,
      pct,
      status,
    }))).toEqual([
      { symbol: '000001', name: '上证指数', price: null, change: null, pct: null, status: 'unavailable' },
      { symbol: '399001', name: '深证成指', price: null, change: null, pct: null, status: 'unavailable' },
      { symbol: '399006', name: '创业板指', price: null, change: null, pct: null, status: 'unavailable' },
      { symbol: '000688', name: '科创 50', price: null, change: null, pct: null, status: 'unavailable' },
    ]);
  });

  it('rejects an invalid fetchedAt instead of passing an Invalid Date to the UI', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ...marketResponse, fetchedAt: 'not-a-date' })),
    );

    const result = await fetchMarketOverview(fetchImpl);

    expect(result.indices).toHaveLength(4);
    expect(result.indices.every((index) => index.status === 'unavailable')).toBe(true);
    expect(result.indices.every((index) => index.price === null)).toBe(true);
    expect(Number.isNaN(new Date(result.fetchedAt).getTime())).toBe(false);
  });

  it('throws a user-facing error for non-2xx responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad', { status: 503 }));

    await expect(fetchMarketOverview(fetchImpl)).rejects.toThrow('大盘请求失败（503）');
  });

  it('merges fresh indices by symbol', () => {
    const previous: Record<string, MarketIndex> = {
      '000001': {
        symbol: '000001',
        name: '旧上证指数',
        price: 3980.12,
        change: -12.1,
        pct: -0.3,
        updatedAt: '2026-08-19T01:50:00.000Z',
        status: 'fresh',
      },
    };

    expect(mergeMarketOverview(previous, marketResponse)).toEqual({
      '000001': marketResponse.indices[0],
      '399001': marketResponse.indices[1],
      '399006': marketResponse.indices[2],
      '000688': marketResponse.indices[3],
    });
  });

  it('creates four unavailable null placeholders when the first response has no rows', () => {
    const merged = mergeMarketOverview({}, {
      indices: [],
      fetchedAt: '2026-08-19T02:30:00.000Z',
      source: 'eastmoney',
      errors: [],
    });

    expect(['000001', '399001', '399006', '000688'].map((symbol) => merged[symbol].symbol)).toEqual([
      '000001',
      '399001',
      '399006',
      '000688',
    ]);
    expect(Object.values(merged).every((index) => index.status === 'unavailable')).toBe(true);
    expect(Object.values(merged).every((index) => index.price === null)).toBe(true);
  });

  it('keeps previous numeric values when the next market response is unavailable', () => {
    const previous: Record<string, MarketIndex> = {
      '000001': {
        symbol: '000001',
        name: '上证指数',
        price: 3990.29,
        change: -0.01,
        pct: 0,
        updatedAt: '2026-08-19T02:00:00.000Z',
        status: 'fresh',
      },
    };

    const next: MarketOverviewResponse = {
      indices: [
        {
          symbol: '000001',
          name: '上证指数',
          price: null,
          change: null,
          pct: null,
          updatedAt: null,
          status: 'unavailable',
        },
      ],
      fetchedAt: '2026-08-19T02:30:00.000Z',
      source: 'eastmoney',
      errors: [{ symbol: '000001', message: '网络错误' }],
    };

    const merged = mergeMarketOverview(previous, next);

    expect(merged['000001']).toEqual({
      ...previous['000001'],
      status: 'stale',
    });
    expect(Object.values(merged)).toHaveLength(4);
    expect(merged['399001']).toMatchObject({ status: 'unavailable', price: null });
  });
});
