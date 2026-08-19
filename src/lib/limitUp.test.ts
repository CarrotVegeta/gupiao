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

  it('normalizes a fresh response with a non-array items field to unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          tradeDate: '20260818',
          items: {},
          fetchedAt: '2026-08-18T08:05:00.000Z',
          source: 'eastmoney',
          status: 'fresh',
          error: null,
        }),
      ),
    );

    await expect(fetchLimitUp(undefined, fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '涨停响应数据格式错误',
    });
  });

  it.each([
    ['source', { source: 'unknown' }],
    ['status', { status: 'ready' }],
    ['tradeDate', { tradeDate: '2026-08-18' }],
    ['fetchedAt', { fetchedAt: 'not-a-date' }],
    ['error', { error: { symbol: 'limit-up', message: '旧对象错误' } }],
  ])('does not accept a fresh response with an invalid %s field', async (_field, override) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ...limitUpResponse, ...override })),
    );

    const result = await fetchLimitUp(undefined, fetchImpl);

    expect(result).toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '涨停响应数据格式错误',
    });
    expect(Number.isNaN(new Date(result.fetchedAt).getTime())).toBe(false);
  });

  it('rejects the whole fresh envelope instead of filtering malformed item rows', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...limitUpResponse,
          items: [limitUpResponse.items[0], { ...limitUpResponse.items[0], price: 'bad' }],
        }),
      ),
    );

    await expect(fetchLimitUp(undefined, fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '涨停响应数据格式错误',
    });
  });

  it('accepts nullable numeric fields in otherwise valid limit-up rows', async () => {
    const nullableResponse = {
      ...limitUpResponse,
      items: [
        {
          ...limitUpResponse.items[0],
          price: null,
          pct: null,
          boardCount: null,
          breakCount: null,
        },
      ],
    } as LimitUpResponse;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(nullableResponse)));

    await expect(fetchLimitUp(undefined, fetchImpl)).resolves.toEqual(nullableResponse);
  });

  it('throws a user-facing error for non-2xx responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad', { status: 502 }));

    await expect(fetchLimitUp('20260818', fetchImpl)).rejects.toThrow('涨停请求失败（502）');
  });

  it('throws a stable Chinese error when the response body is not valid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{bad json'));

    await expect(fetchLimitUp(undefined, fetchImpl)).rejects.toThrow('涨停响应数据格式错误');
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
      tradeDate: null,
      items: [],
      fetchedAt: '2026-08-19T08:00:00.000Z',
      status: 'unavailable',
      error: '网络错误',
    };

    expect(mergeLimitUp(previous, next)).toEqual({
      ...previous,
      status: 'stale',
      error: '网络错误',
    });
  });

  it('keeps the previous successful trade date and fetchedAt across a later trading-day failure', () => {
    const previous = { ...limitUpResponse, status: 'fresh' as const };
    const next = {
      ...limitUpResponse,
      tradeDate: '20260819',
      items: [],
      fetchedAt: '2026-08-19T08:00:00.000Z',
      status: 'unavailable' as const,
      error: '涨停池刷新失败',
    };

    expect(mergeLimitUp(previous, next)).toEqual({
      ...previous,
      status: 'stale',
      error: '涨停池刷新失败',
    });
  });

  it('keeps an initial failed load unavailable with no trade date', () => {
    const initial = {
      tradeDate: null,
      items: [],
      fetchedAt: '2026-08-19T08:00:00.000Z',
      source: 'eastmoney' as const,
      status: 'unavailable' as const,
      error: null,
    };
    const failure = {
      ...initial,
      fetchedAt: '2026-08-19T08:01:00.000Z',
      error: '涨停池刷新失败',
    };

    expect(mergeLimitUp(initial, failure)).toEqual(failure);
  });
});
