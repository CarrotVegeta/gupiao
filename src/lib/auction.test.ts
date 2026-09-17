import { describe, expect, it, vi } from 'vitest';
import type { AuctionResponse } from '../types';
import { fetchAuction, mergeAuction } from './auction';

const response: AuctionResponse = {
  tradeDate: '20260819',
  previousTradeDate: '20260818',
  snapshotTime: '09:25:00',
  items: [
    {
      symbol: '603000',
      name: '人民网',
      boardCount: 2,
      firstSealTime: '09:35:00',
      lastSealTime: '10:00:00',
      breakCount: 0,
      previousAmount: 100_000_000,
      sealAmount: 15_000_000,
      floatMarketCap: 1_000_000_000,
      auctionPrice: 10.4,
      auctionPct: 4,
      auctionAmount: 5_200_000,
      auctionRatio: 5.2,
      auctionPremium: 'rich',
      turnoverRate: 8.5,
      limitUpProbability: 0.364,
      sealedAtAuction: false,
      probabilityMissing: 0,
      result: 'watch',
      reasons: ['竞价溢价 +4.00%（抬高概率）'],
    },
  ],
  fetchedAt: '2026-08-19T01:25:10.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('auction client adapter', () => {
  it('requests the fixed auction endpoint for the requested trade date', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(response)),
    );

    await expect(fetchAuction('20260819', fetchImpl)).resolves.toEqual(response);
    expect(fetchImpl).toHaveBeenCalledWith('/api/auction?date=20260819');
  });

  it('rejects a malformed score result instead of trusting partial rows', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...response,
          items: [{ ...response.items[0], result: 'maybe' }],
        }),
      ),
    );

    await expect(fetchAuction('20260819', fetchImpl)).resolves.toMatchObject({
      tradeDate: null,
      previousTradeDate: null,
      items: [],
      status: 'unavailable',
      error: '竞价响应数据格式错误',
    });
  });

  it('keeps the last successful 09:25 snapshot when a refresh fails', () => {
    expect(
      mergeAuction(response, {
        ...response,
        tradeDate: null,
        previousTradeDate: null,
        items: [],
        status: 'unavailable',
        error: '竞价刷新失败',
      }),
    ).toEqual({ ...response, status: 'stale', error: '竞价刷新失败' });
  });
});
