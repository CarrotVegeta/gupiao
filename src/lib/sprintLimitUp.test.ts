import { describe, expect, it, vi } from 'vitest';
import type { SprintLimitUpResponse } from '../types';
import { fetchSprintLimitUp, mergeSprintLimitUp } from './sprintLimitUp';

const freshResponse = (overrides: Partial<SprintLimitUpResponse> = {}): SprintLimitUpResponse => ({
  tradeDate: '20260827',
  items: [
    {
      symbol: '600000',
      name: '浦发银行',
      price: 12.34,
      pct: 9.87,
      speed: 2.35,
      boardCount: 2,
      probability: null,
      reason: '60日新高',
    },
  ],
  fetchedAt: '2026-08-27T07:35:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...overrides,
});

describe('sprint limit-up client data', () => {
  it('fetches a validated official response for the selected trade date', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(freshResponse())),
    );

    await expect(fetchSprintLimitUp('20260827', fetchImpl)).resolves.toEqual(freshResponse());
    expect(fetchImpl).toHaveBeenCalledWith('/api/sprint-limit-up?date=20260827');
  });

  it('converts malformed payloads into a stable unavailable response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], source: 'eastmoney' })),
    );

    await expect(fetchSprintLimitUp(undefined, fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '冲刺涨停响应数据格式错误',
    });
  });

  it('keeps the last successful rows as stale after a later refresh failure', () => {
    const previous = freshResponse();
    const failed = freshResponse({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '冲刺涨停刷新失败',
    });

    expect(mergeSprintLimitUp(previous, failed)).toEqual({
      ...previous,
      status: 'stale',
      error: '冲刺涨停刷新失败',
    });
  });
});
