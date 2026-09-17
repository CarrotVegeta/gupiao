import { describe, expect, it, vi } from 'vitest';
import type { LimitUpItem, LimitUpLadderResponse } from '../types';
import { fetchLimitUpLadder, mergeLimitUpLadder } from './limitUpLadder';

const todayItem: LimitUpItem = {
  symbol: '605058',
  name: '澳弘电子',
  price: 28.1,
  pct: 9.99,
  boardCount: 5,
  firstSealTime: '09:25:00',
  lastSealTime: '09:25:00',
  industry: '元件',
  breakCount: 0,
};

const ladderResponse: LimitUpLadderResponse = {
  tradeDate: '20260917',
  previousTradeDate: '20260916',
  items: [todayItem],
  ladder: [{ boardCount: 5, items: [todayItem] }],
  previousLadder: [{ boardCount: 4, items: [{ ...todayItem, boardCount: 4 }] }],
  comparison: [
    {
      boardCount: 4,
      total: 2,
      carried: [{ symbol: '605058', name: '澳弘电子', boardCount: 5, pct: 9.99 }],
      fallen: [{ symbol: '600111', name: '北方稀土', boardCount: null, pct: 10.02 }],
    },
  ],
  previousCount: 2,
  carriedCount: 1,
  promotionRate: 50,
  previousAvailable: true,
  fetchedAt: '2026-09-17T07:32:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('fetchLimitUpLadder', () => {
  it('requests the ladder endpoint with the encoded date when one is provided', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(ladderResponse)));

    await fetchLimitUpLadder('20260917', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/limit-up-ladder?date=20260917');
  });

  it('requests the ladder endpoint without a date by default', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(ladderResponse)));

    await expect(fetchLimitUpLadder(undefined, fetchImpl)).resolves.toEqual(ladderResponse);
    expect(fetchImpl).toHaveBeenCalledWith('/api/limit-up-ladder');
  });

  it('keeps a valid response whose previous pool is missing but today is usable', async () => {
    const withoutPrevious: LimitUpLadderResponse = {
      ...ladderResponse,
      previousTradeDate: null,
      previousLadder: [],
      comparison: [],
      previousCount: 0,
      carriedCount: 0,
      promotionRate: null,
      previousAvailable: false,
      error: null,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(withoutPrevious)));

    await expect(fetchLimitUpLadder('20260917', fetchImpl)).resolves.toEqual(withoutPrevious);
  });

  it.each([
    ['source', { source: 'tencent' }],
    ['status', { status: 'ready' }],
    ['tradeDate', { tradeDate: '2026-09-17' }],
    ['previousTradeDate', { previousTradeDate: '2026-09-16' }],
    ['fetchedAt', { fetchedAt: 'not-a-date' }],
    ['ladder', { ladder: [{ boardCount: 5, items: [{ boardCount: 5 }] }] }],
    ['comparison', { comparison: [{ boardCount: 4, total: 1 }] }],
    ['previousCount', { previousCount: '2' }],
    ['promotionRate', { promotionRate: '50' }],
    ['previousAvailable', { previousAvailable: 'yes' }],
  ])('normalizes a response with an invalid %s field to unavailable', async (_field, override) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ...ladderResponse, ...override })),
    );

    const result = await fetchLimitUpLadder(undefined, fetchImpl);

    expect(result).toMatchObject({
      tradeDate: null,
      items: [],
      ladder: [],
      comparison: [],
      status: 'unavailable',
      error: '连板天梯响应数据格式错误',
    });
    expect(Number.isNaN(new Date(result.fetchedAt).getTime())).toBe(false);
  });

  it('rejects a fresh envelope that carries an error instead of silently showing it as usable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ...ladderResponse, error: '上游部分失败' })),
    );

    await expect(fetchLimitUpLadder(undefined, fetchImpl)).resolves.toMatchObject({
      status: 'unavailable',
      error: '连板天梯响应数据格式错误',
    });
  });

  it('throws when the response is not ok', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('busy', { status: 503 }));

    await expect(fetchLimitUpLadder('20260917', fetchImpl)).rejects.toThrowError(
      '连板天梯请求失败（503）',
    );
  });
});

describe('mergeLimitUpLadder', () => {
  const staleResponse: LimitUpLadderResponse = {
    ...ladderResponse,
    items: [],
    ladder: [],
    previousLadder: [],
    comparison: [],
    previousCount: 0,
    carriedCount: 0,
    promotionRate: null,
    previousAvailable: false,
    status: 'unavailable',
    error: '连板天梯刷新失败',
  };

  it('keeps the previous data as stale when the new response failed', () => {
    const merged = mergeLimitUpLadder(ladderResponse, staleResponse);

    expect(merged).toMatchObject({
      tradeDate: '20260917',
      status: 'stale',
      error: '连板天梯刷新失败',
    });
    expect(merged.ladder).toHaveLength(1);
  });

  it('drops everything when there is no previous successful snapshot to fall back on', () => {
    const merged = mergeLimitUpLadder(null, staleResponse);

    expect(merged).toMatchObject({
      tradeDate: null,
      items: [],
      ladder: [],
      comparison: [],
      status: 'unavailable',
    });
  });

  it('lets a fresh response replace the previous one wholesale', () => {
    const fresh: LimitUpLadderResponse = { ...ladderResponse, carriedCount: 3 };

    expect(mergeLimitUpLadder({ ...ladderResponse, status: 'stale' }, fresh)).toEqual(fresh);
  });
});
