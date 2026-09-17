import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEastmoneyMarket, mapEastmoneyMarket } from './eastmoney.js';

const fetchedAt = '2026-08-19T01:30:00.000Z';

const marketDiffFixture = [
  { f2: 345678, f3: 123, f4: 4198, f6: 100_000_000, f12: '000688', f14: '科创50' },
  { f2: 321012, f3: -56, f4: -1811, f6: 100_000_000, f12: '000001', f14: '上证指数' },
  { f2: 1109876, f3: 89, f4: 9765, f6: 100_000_000, f12: '399001', f14: '深证成指' },
  { f2: 223456, f3: 234, f4: 5111, f6: 100_000_000, f12: '399006', f14: '创业板指' },
];

describe('eastmoney market adapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps index quote fields from the Eastmoney diff payload', () => {
    const result = mapEastmoneyMarket(
      {
        data: {
          diff: marketDiffFixture,
        },
      },
      fetchedAt,
    );

    expect(result).toEqual({
      indices: [
        {
          symbol: '000001',
          name: '上证指数',
          price: 3210.12,
          pct: -0.56,
          change: -18.11,
          amount: 100_000_000,
          updatedAt: fetchedAt,
          status: 'fresh',
        },
        {
          symbol: '399001',
          name: '深证成指',
          price: 11098.76,
          pct: 0.89,
          change: 97.65,
          amount: 100_000_000,
          updatedAt: fetchedAt,
          status: 'fresh',
        },
        {
          symbol: '399006',
          name: '创业板指',
          price: 2234.56,
          pct: 2.34,
          change: 51.11,
          amount: 100_000_000,
          updatedAt: fetchedAt,
          status: 'fresh',
        },
      ],
      fetchedAt,
      source: 'eastmoney',
      errors: [],
    });
  });

  it('requests all three fixed market secids from the upstream endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            diff: marketDiffFixture,
          },
        }),
      ),
    );

    const result = await fetchEastmoneyMarket(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('secids=1.000001%2C0.399001%2C0.399006');
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('fields=f2%2Cf3%2Cf4%2Cf6%2Cf12%2Cf14');
    expect(result.errors).toEqual([]);
  });

  it('marks a malformed single index row as unavailable without breaking others', () => {
    const result = mapEastmoneyMarket(
      {
        data: {
          diff: marketDiffFixture.map((item) =>
            item.f12 === '399001' ? { ...item, f2: '-' } : item,
          ),
        },
      },
      fetchedAt,
    );

    expect(result.indices).toMatchObject([
      { symbol: '000001', status: 'fresh' },
      {
        symbol: '399001',
        name: '深证成指',
        price: null,
        change: null,
        pct: null,
        amount: null,
        status: 'unavailable',
      },
      { symbol: '399006', status: 'fresh' },
    ]);
    expect(result.errors).toEqual([{ symbol: '399001', message: '上游指数数据不完整' }]);
  });

  it('does not coerce an empty numeric field to a fresh zero value', () => {
    const result = mapEastmoneyMarket(
      {
        data: {
          diff: marketDiffFixture.map((item) =>
            item.f12 === '000001' ? { ...item, f2: '' } : item,
          ),
        },
      },
      fetchedAt,
    );

    expect(result.indices[0]).toEqual({
      symbol: '000001',
      name: '上证指数',
      price: null,
      change: null,
      pct: null,
      amount: null,
      updatedAt: null,
      status: 'unavailable',
    });
  });

  it('keeps the five-second timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const signal = init?.signal as AbortSignal;

      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                const error = new Error('body read aborted');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          }),
      } as Response;
    });

    const resultPromise = fetchEastmoneyMarket(fetchImpl);
    // 主站 + 镜像各 5 秒，两次都要能被超时打断
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.indices).toHaveLength(3);
    expect(result.indices.every((index) => index.status === 'unavailable')).toBe(true);
    expect(result.errors.every((error) => error.message === '大盘指数上游请求超时')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps bad JSON and ordinary request failures to stable Chinese errors', async () => {
    const invalidJsonFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{bad json'));
    const rejectedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('socket hang up with upstream details'));

    const invalidJson = await fetchEastmoneyMarket(invalidJsonFetch);
    const rejected = await fetchEastmoneyMarket(rejectedFetch);

    expect(invalidJson.errors.every((error) => error.message === '大盘指数上游响应格式错误')).toBe(true);
    expect(rejected.errors.every((error) => error.message === '大盘指数上游请求失败')).toBe(true);
    expect(JSON.stringify(rejected)).not.toContain('socket hang up');
  });
});
