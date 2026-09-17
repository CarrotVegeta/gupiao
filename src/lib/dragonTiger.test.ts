import { describe, expect, it, vi } from 'vitest';
import type { DragonTigerResponse } from '../types';
import { fetchDragonTiger, mergeDragonTiger } from './dragonTiger';

const freshResponse = (overrides: Partial<DragonTigerResponse> = {}): DragonTigerResponse => ({
  tradeDate: '20260819',
  items: [
    {
      symbol: '600000',
      name: '浦发银行',
      closePrice: 12.34,
      changePct: 5.67,
      reason: '日涨幅偏离值达到7%的前5只证券',
      buyAmount: 234_567_890.12,
      sellAmount: 123_456_789.01,
      netAmount: 111_111_101.11,
    },
  ],
  fetchedAt: '2026-08-19T07:35:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...overrides,
});

describe('dragon-tiger client data', () => {
  it('fetches a validated response for the selected trade date', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(freshResponse())),
    );

    await expect(fetchDragonTiger('20260819', fetchImpl)).resolves.toEqual(freshResponse());
    expect(fetchImpl).toHaveBeenCalledWith('/api/dragon-tiger?date=20260819');
  });

  it('converts malformed payloads into a stable unavailable response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], source: 'other' })),
    );

    await expect(fetchDragonTiger(undefined, fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '龙虎榜响应数据格式错误',
    });
  });

  it('keeps the last successful items as stale after a later refresh failure', () => {
    const previous = freshResponse();
    const failed: DragonTigerResponse = {
      ...freshResponse({
        tradeDate: null,
        items: [],
        status: 'unavailable',
        error: '龙虎榜刷新失败',
      }),
    };

    expect(mergeDragonTiger(previous, failed)).toEqual({
      ...previous,
      status: 'stale',
      error: '龙虎榜刷新失败',
    });
  });
});
