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
      updatedAt: null,
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

  it('filters invalid indices and errors from the response body', async () => {
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

    await expect(fetchMarketOverview(fetchImpl)).resolves.toEqual({
      indices: [
        marketResponse.indices[0],
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
      errors: [{ symbol: '399006', message: '上游不可用' }],
    });
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
    });
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
          price: 0,
          change: 0,
          pct: 0,
          updatedAt: null,
          status: 'unavailable',
        },
      ],
      fetchedAt: '2026-08-19T02:30:00.000Z',
      source: 'eastmoney',
      errors: [{ symbol: '000001', message: '网络错误' }],
    };

    expect(mergeMarketOverview(previous, next)).toEqual({
      '000001': {
        ...previous['000001'],
        status: 'stale',
      },
    });
  });
});
