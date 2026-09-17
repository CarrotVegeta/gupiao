import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitUpItem } from '../../src/types.js';
import { clearThemeServiceCache } from '../themes/service.js';
import { buildComparison, buildLadder, fetchLimitUpLadder } from './ladder.js';

const item = (overrides: Partial<LimitUpItem> = {}): LimitUpItem => ({
  symbol: '600000',
  name: '样本股',
  price: 12.34,
  pct: 10.01,
  boardCount: 2,
  firstSealTime: '09:25:00',
  lastSealTime: '14:59:59',
  industry: '传媒',
  breakCount: 0,
  ...overrides,
});

const poolResponse = (pool: unknown[]) =>
  new Response(JSON.stringify({ data: { pool, tc: pool.length, pagesize: 100 } }));

const poolRow = (symbol: string, name: string, boardCount: number, pct = 10.01) => ({
  c: symbol,
  n: name,
  p: 12340,
  zdp: pct,
  lbc: boardCount,
  fbt: 92500,
  lbt: 145959,
  hybk: '传媒',
  zbc: 0,
});

/** 腾讯上证日K：这个用例只关心它返回了哪些交易日 */
const calendarResponse = (dates: string[]) =>
  new Response(
    JSON.stringify({
      data: {
        sh000001: {
          qfqday: dates.map((date) => [
            `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
            '3300.00',
          ]),
        },
      },
    }),
  );

describe('buildLadder', () => {
  it('groups by board count, sorts tiers desc and keeps the unknown tier last', () => {
    const ladder = buildLadder([
      item({ symbol: '600001', name: '一板', boardCount: 1 }),
      item({ symbol: '600002', name: '三板', boardCount: 3 }),
      item({ symbol: '600003', name: '未知', boardCount: null }),
      item({ symbol: '600004', name: '二板', boardCount: 2 }),
      item({ symbol: '600005', name: '一板乙', boardCount: 1 }),
    ]);

    expect(ladder.map((group) => group.boardCount)).toEqual([3, 2, 1, null]);
    expect(ladder[2].items.map((entry) => entry.name)).toEqual(['一板', '一板乙']);
  });

  it('returns an empty ladder for an empty pool', () => {
    expect(buildLadder([])).toEqual([]);
  });
});

describe('buildComparison', () => {
  it('splits each previous tier into carried and fallen stocks', () => {
    const today = [
      item({ symbol: '600002', name: '晋级三板', boardCount: 3 }),
      item({ symbol: '600004', name: '今日首板', boardCount: 1 }),
    ];
    const previous = [
      item({ symbol: '600001', name: '断了三板', boardCount: 3 }),
      item({ symbol: '600002', name: '晋级二板', boardCount: 2 }),
      item({ symbol: '600003', name: '断了二板', boardCount: 2 }),
    ];

    const comparison = buildComparison(today, previous);

    expect(comparison.map((bucket) => bucket.boardCount)).toEqual([3, 2]);
    expect(comparison[0]).toMatchObject({
      total: 1,
      carried: [],
      fallen: [{ symbol: '600001' }],
    });
    expect(comparison[1].total).toBe(2);
    // 晋级的那只票带的是**今天**的连板数和今天的名字，不是昨天的 2
    expect(comparison[1].carried).toEqual([
      { symbol: '600002', name: '晋级三板', boardCount: 3, pct: 10.01 },
    ]);
    expect(comparison[1].fallen).toEqual([
      { symbol: '600003', name: '断了二板', boardCount: null, pct: 10.01 },
    ]);
    // 今天新进池子的票不进对比：对比只回答「昨天的票今天怎么样了」
    expect(JSON.stringify(comparison)).not.toContain('今日首板');
  });

  it('keeps an unknown board-count bucket for rows the upstream did not label', () => {
    const comparison = buildComparison(
      [],
      [item({ symbol: '600009', name: '未知板', boardCount: null })],
    );

    expect(comparison).toEqual([
      {
        boardCount: null,
        total: 1,
        carried: [],
        fallen: [{ symbol: '600009', name: '未知板', boardCount: null, pct: 10.01 }],
      },
    ]);
  });
});

describe('fetchLimitUpLadder', () => {
  // 交易日历在 themes/service 里缓存 5 分钟，测试之间必须清掉，否则第二个用例根本不会发日历请求
  beforeEach(() => {
    clearThemeServiceCache();
  });

  it('uses the trade calendar for the previous session and computes the promotion rate', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('ifzq.gtimg.cn')) {
        return calendarResponse(['20260915', '20260916', '20260917']);
      }

      const date = new URL(url).searchParams.get('date');

      if (date === '20260916') {
        return poolResponse([
          poolRow('600666', '断板样本', 4),
          poolRow('605058', '澳弘电子', 4),
          poolRow('603186', '华瓷股份', 2),
          poolRow('600111', '北方稀土', 2),
        ]);
      }

      return poolResponse([poolRow('605058', '澳弘电子', 5), poolRow('603186', '华瓷股份', 3)]);
    }) as unknown as typeof fetch;

    const body = await fetchLimitUpLadder('20260917', fetchImpl);

    expect(body).toMatchObject({
      tradeDate: '20260917',
      previousTradeDate: '20260916',
      previousCount: 4,
      carriedCount: 2,
      previousAvailable: true,
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    });
    expect(body.items).toHaveLength(2);
    expect(body.promotionRate).toBeCloseTo((2 / 4) * 100, 6);
    expect(body.ladder.map((group) => group.boardCount)).toEqual([5, 3]);
    expect(body.previousLadder.map((group) => group.boardCount)).toEqual([4, 2]);
    expect(body.comparison.map((bucket) => bucket.boardCount)).toEqual([4, 2]);
    // 4 板那一档：澳弘电子晋级到 5 板，断板样本留在昨日板位
    expect(body.comparison[0].carried).toEqual([
      { symbol: '605058', name: '澳弘电子', boardCount: 5, pct: 10.01 },
    ]);
    expect(body.comparison[0].fallen).toEqual([
      { symbol: '600666', name: '断板样本', boardCount: null, pct: 10.01 },
    ]);
    // 2 板那一档：华瓷股份晋级，北方稀土断了
    expect(body.comparison[1].carried.map((entry) => entry.name)).toEqual(['华瓷股份']);
    expect(body.comparison[1].fallen.map((entry) => entry.name)).toEqual(['北方稀土']);
  });

  it('falls back to the previous session when the requested day has no pool yet', async () => {
    /*
     * 09-18 还没开盘：上游把 09-17 的池子原样返回（tradeDate 只是请求日期的回显）。
     * 如果照原样比，就是「09-17 比自己」，结果是假的 100% 晋级。
     */
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('ifzq.gtimg.cn')) {
        return calendarResponse(['20260915', '20260916', '20260917']);
      }

      const date = new URL(url).searchParams.get('date');

      if (date === '20260916') {
        return poolResponse([
          poolRow('600666', '断板样本', 4),
          poolRow('605058', '澳弘电子', 4),
        ]);
      }

      // 09-17 与 09-18 请求到的是同一份快照
      return poolResponse([poolRow('605058', '澳弘电子', 5), poolRow('603186', '华瓷股份', 3)]);
    }) as unknown as typeof fetch;

    const body = await fetchLimitUpLadder('20260918', fetchImpl);

    expect(body).toMatchObject({
      // 交易日落到最近那个真有数据的交易日，昨日再往前一天
      tradeDate: '20260917',
      previousTradeDate: '20260916',
      previousCount: 2,
      carriedCount: 1,
      previousAvailable: true,
      status: 'fresh',
    });
    expect(body.promotionRate).toBe(50);
    expect(body.items.map((entry) => entry.symbol)).toEqual(['605058', '603186']);
    expect(body.comparison.map((bucket) => bucket.boardCount)).toEqual([4]);
  });

  it('falls back to scanning back by natural day when the calendar is unavailable', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('ifzq.gtimg.cn')) {
        throw new Error('calendar down');
      }

      const date = new URL(url).searchParams.get('date');

      // 09-16 是节假日（池子为空），必须继续往前找到 09-15
      if (date === '20260916') {
        return poolResponse([]);
      }

      if (date === '20260915') {
        return poolResponse([poolRow('605058', '澳弘电子', 4)]);
      }

      return poolResponse([poolRow('605058', '澳弘电子', 5)]);
    }) as unknown as typeof fetch;

    const body = await fetchLimitUpLadder('20260917', fetchImpl);

    expect(body.previousTradeDate).toBe('20260915');
    expect(body.previousCount).toBe(1);
    expect(body.carriedCount).toBe(1);
    expect(body.promotionRate).toBe(100);
  });

  it('marks the previous session unavailable instead of reporting a zero promotion rate', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('ifzq.gtimg.cn')) {
        return new Response('busy', { status: 503 });
      }

      const date = new URL(url).searchParams.get('date');

      if (date === '20260917') {
        return poolResponse([poolRow('605058', '澳弘电子', 5)]);
      }

      // 之前每一天都拿不到池子
      return new Response('busy', { status: 503 });
    }) as unknown as typeof fetch;

    const body = await fetchLimitUpLadder('20260917', fetchImpl);

    expect(body).toMatchObject({
      tradeDate: '20260917',
      previousTradeDate: null,
      previousAvailable: false,
      previousCount: 0,
      carriedCount: 0,
      promotionRate: null,
      // 部分可用不是坏数据：error 只留给「这份响应本身有问题」，昨日缺失走 previousAvailable
      status: 'fresh',
      error: null,
    });
    // 今日天梯照常给出，缺的只是对比
    expect(body.ladder.map((group) => group.boardCount)).toEqual([5]);
    expect(body.comparison).toEqual([]);
    expect(body.previousLadder).toEqual([]);
  });

  it('returns an unavailable body when the today pool itself fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('ifzq.gtimg.cn')) {
        return calendarResponse(['20260916', '20260917']);
      }

      return new Response('busy', { status: 503 });
    }) as unknown as typeof fetch;

    const body = await fetchLimitUpLadder('20260917', fetchImpl);

    expect(body).toMatchObject({
      tradeDate: null,
      ladder: [],
      status: 'unavailable',
      error: '涨停池上游请求失败（HTTP 503）',
    });
    expect(body.fetchedAt).toEqual(expect.any(String));
  });
});
