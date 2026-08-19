import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEastmoneyLimitUp, mapEastmoneyLimitUpItem } from './eastmoney.js';

const validPoolItem = {
  c: '603000',
  n: '人民网',
  p: 12340,
  zdp: 10.01,
  lbc: 2,
  fbt: 92500,
  lbt: 145959,
  hybk: '传媒',
  zbc: 1,
};

describe('eastmoney limit-up adapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps Eastmoney pool fields into a normalized limit-up item', () => {
    expect(mapEastmoneyLimitUpItem(validPoolItem)).toEqual({
      symbol: '603000',
      name: '人民网',
      price: 12.34,
      pct: 10.01,
      boardCount: 2,
      firstSealTime: '09:25:00',
      lastSealTime: '14:59:59',
      industry: '传媒',
      breakCount: 1,
    });
  });

  it('returns null for rows missing code or name while keeping valid rows intact', async () => {
    expect(mapEastmoneyLimitUpItem({ ...validPoolItem, c: '' })).toBeNull();
    expect(mapEastmoneyLimitUpItem({ ...validPoolItem, n: '' })).toBeNull();

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            pool: [{ ...validPoolItem, c: '' }, validPoolItem],
            tc: 2,
            pagesize: 100,
          },
        }),
      ),
    );

    const result = await fetchEastmoneyLimitUp('20260818', fetchImpl);

    expect(result.items).toEqual([
      {
        symbol: '603000',
        name: '人民网',
        price: 12.34,
        pct: 10.01,
        boardCount: 2,
        firstSealTime: '09:25:00',
        lastSealTime: '14:59:59',
        industry: '传媒',
        breakCount: 1,
      },
    ]);
  });

  it('keeps rows with missing numeric fields as null and normalizes symbols to six digits', () => {
    expect(
      mapEastmoneyLimitUpItem({
        ...validPoolItem,
        c: 17,
        p: '',
        zdp: ' ',
        lbc: undefined,
        zbc: '-',
      }),
    ).toEqual({
      symbol: '000017',
      name: '人民网',
      price: null,
      pct: null,
      boardCount: null,
      firstSealTime: '09:25:00',
      lastSealTime: '14:59:59',
      industry: '传媒',
      breakCount: null,
    });
    expect(mapEastmoneyLimitUpItem({ ...validPoolItem, c: '1.600000' })?.symbol).toBe('600000');
  });

  it('continues pagination when the first page indicates more pool rows', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              pool: [validPoolItem],
              tc: 3,
              pagesize: 100,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              pool: [
                { ...validPoolItem, c: '002594', n: '比亚迪', p: 265430, hybk: '' },
                { ...validPoolItem, c: '300750', n: '宁德时代', p: 198760, fbt: 93001 },
              ],
              tc: 3,
              pagesize: 100,
            },
          }),
        ),
      );

    const result = await fetchEastmoneyLimitUp('20260818', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('Pageindex=1');
    expect(result.items).toEqual([
      {
        symbol: '603000',
        name: '人民网',
        price: 12.34,
        pct: 10.01,
        boardCount: 2,
        firstSealTime: '09:25:00',
        lastSealTime: '14:59:59',
        industry: '传媒',
        breakCount: 1,
      },
      {
        symbol: '002594',
        name: '比亚迪',
        price: 265.43,
        pct: 10.01,
        boardCount: 2,
        firstSealTime: '09:25:00',
        lastSealTime: '14:59:59',
        industry: null,
        breakCount: 1,
      },
      {
        symbol: '300750',
        name: '宁德时代',
        price: 198.76,
        pct: 10.01,
        boardCount: 2,
        firstSealTime: '09:30:01',
        lastSealTime: '14:59:59',
        industry: '传媒',
        breakCount: 1,
      },
    ]);
  });

  it('returns an empty fresh pool when the upstream pool is empty', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            pool: [],
            tc: 0,
            pagesize: 100,
          },
        }),
      ),
    );

    await expect(fetchEastmoneyLimitUp('20260818', fetchImpl)).resolves.toMatchObject({
      tradeDate: '20260818',
      items: [],
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    });
  });

  it('returns an unavailable response with a Chinese error for upstream failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('busy', { status: 503 }));

    await expect(fetchEastmoneyLimitUp('20260818', fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '涨停池上游请求失败（HTTP 503）',
    });
  });

  it('returns unavailable when upstream payload misses the pool array', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            tc: 1,
            pagesize: 100,
          },
        }),
      ),
    );

    await expect(fetchEastmoneyLimitUp('20260818', fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '涨停池上游数据格式错误',
    });
  });

  it('returns unavailable when upstream payload has a non-array pool', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            pool: {},
            tc: 1,
            pagesize: 100,
          },
        }),
      ),
    );

    await expect(fetchEastmoneyLimitUp('20260818', fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '涨停池上游数据格式错误',
    });
  });

  it('returns unavailable when the upstream request aborts', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(abortError);

    await expect(fetchEastmoneyLimitUp('20260818', fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '涨停池上游请求超时',
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

    const resultPromise = fetchEastmoneyLimitUp('20260818', fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'unavailable',
      error: '涨停池上游请求超时',
    });
  });

  it('maps bad JSON and ordinary request failures to stable Chinese errors', async () => {
    const invalidJsonFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{bad json'));
    const rejectedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('socket hang up with upstream details'));

    await expect(fetchEastmoneyLimitUp('20260818', invalidJsonFetch)).resolves.toMatchObject({
      status: 'unavailable',
      error: '涨停池上游响应格式错误',
    });
    const rejected = await fetchEastmoneyLimitUp('20260818', rejectedFetch);
    expect(rejected).toMatchObject({
      status: 'unavailable',
      error: '涨停池上游请求失败',
    });
    expect(JSON.stringify(rejected)).not.toContain('socket hang up');
  });

  it('returns unavailable when an empty page arrives before the reported total is received', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { pool: [validPoolItem], tc: 2, pagesize: 1 } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { pool: [], tc: 2, pagesize: 1 } })),
      );

    await expect(fetchEastmoneyLimitUp('20260818', fetchImpl)).resolves.toMatchObject({
      status: 'unavailable',
      items: [],
      error: '涨停池分页数据不完整',
    });
  });

  it('returns unavailable instead of incomplete fresh data at the pagination safety limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ data: { pool: [validPoolItem], tc: 51, pagesize: 1 } })),
    );

    const result = await fetchEastmoneyLimitUp('20260818', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(50);
    expect(result).toMatchObject({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '涨停池分页数据不完整',
    });
  });
});
