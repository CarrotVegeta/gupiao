import { describe, expect, it, vi } from 'vitest';
import type { LimitUpResponse } from '../types';
import { fetchLimitUp, mergeLimitUp } from './limitUp';

const limitUpResponse: LimitUpResponse = {
  tradeDate: '20260818',
  items: [
    {
      symbol: '002820',
      name: '桂发祥',
      price: 12.27,
      pct: 10.04,
      boardCount: 3,
      firstSealTime: null,
      lastSealTime: null,
      industry: null,
      breakCount: 0,
    },
  ],
  fetchedAt: '2026-08-18T08:00:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('limit-up fixture', () => {
  it('keeps the expected limit-up response shape', () => {
    expect(limitUpResponse.items[0].symbol).toBe('002820');
    expect(limitUpResponse.items[0].firstSealTime).toBeNull();
    expect(limitUpResponse.items[0].industry).toBeNull();
    expect(limitUpResponse.status).toBe('fresh');
  });

  it('requests the limit-up endpoint without a date by default', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(limitUpResponse)));

    await expect(fetchLimitUp(undefined, fetchImpl)).resolves.toEqual(limitUpResponse);
    expect(fetchImpl).toHaveBeenCalledWith('/api/limit-up');
  });

  it('requests the encoded trade date when one is provided', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(limitUpResponse)));

    await fetchLimitUp('2026/08/18', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/limit-up?date=2026%2F08%2F18');
  });

  it('filters invalid items and keeps a valid unavailable response shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          tradeDate: '20260818',
          items: [
            limitUpResponse.items[0],
            {
              symbol: '600000',
              name: '浦发银行',
              price: 'bad',
              pct: 10,
              boardCount: 1,
              firstSealTime: '09:25:00',
              lastSealTime: '13:12:01',
              industry: '银行',
              breakCount: 0,
            },
          ],
          fetchedAt: '2026-08-18T08:05:00.000Z',
          source: 'eastmoney',
          status: 'unavailable',
          error: {
            symbol: 'limit-up',
            message: '上游不可用',
          },
        }),
      ),
    );

    await expect(fetchLimitUp(undefined, fetchImpl)).resolves.toEqual({
      tradeDate: '20260818',
      items: [limitUpResponse.items[0]],
      fetchedAt: '2026-08-18T08:05:00.000Z',
      source: 'eastmoney',
      status: 'unavailable',
      error: {
        symbol: 'limit-up',
        message: '上游不可用',
      },
    });
  });

  it('throws a user-facing error for non-2xx responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad', { status: 502 }));

    await expect(fetchLimitUp('20260818', fetchImpl)).rejects.toThrow('涨停请求失败（502）');
  });

  it('replaces items when the next response is fresh', () => {
    const previous: LimitUpResponse = {
      ...limitUpResponse,
      items: [
        {
          symbol: '600000',
          name: '旧数据',
          price: 9.99,
          pct: 10,
          boardCount: 1,
          firstSealTime: '09:25:00',
          lastSealTime: '09:25:00',
          industry: '银行',
          breakCount: 0,
        },
      ],
    };

    expect(mergeLimitUp(previous, limitUpResponse)).toEqual(limitUpResponse);
  });

  it('keeps the last fresh limit-up response when the next response is unavailable', () => {
    const previous = { ...limitUpResponse, status: 'fresh' as const };
    const next: LimitUpResponse = {
      ...limitUpResponse,
      items: [],
      status: 'unavailable',
      error: { symbol: 'limit-up', message: '网络错误' },
    };

    expect(mergeLimitUp(previous, next)).toMatchObject({ status: 'stale', items: previous.items });
  });
});
