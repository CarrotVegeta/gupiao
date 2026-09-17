import { describe, expect, it, vi } from 'vitest';
import { createAuctionCache } from './cache.js';
import type { AuctionResponse } from '../../src/types.js';

const responseOf = (tradeDate: string): AuctionResponse => ({
  tradeDate,
  previousTradeDate: '20260818',
  snapshotTime: '09:25:00',
  items: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'fresh',
  error: null,
});

describe('auction cache', () => {
  it('returns the same body for repeated reads inside the TTL', () => {
    const cache = createAuctionCache(60_000, 6);
    const body = responseOf('20260819');

    cache.set('20260819', body);

    expect(cache.get('20260819')).toBe(body);
  });

  it('expires entries once the TTL passes', () => {
    vi.useFakeTimers();
    try {
      const cache = createAuctionCache(1_000, 6);
      cache.set('20260819', responseOf('20260819'));

      vi.advanceTimersByTime(1_001);

      expect(cache.get('20260819')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the oldest entry instead of growing without bound', () => {
    const cache = createAuctionCache(60_000, 2);

    cache.set('20260817', responseOf('20260817'));
    cache.set('20260818', responseOf('20260818'));
    cache.set('20260819', responseOf('20260819'));

    expect(cache.size()).toBe(2);
    expect(cache.get('20260817')).toBeNull();
    expect(cache.get('20260819')).not.toBeNull();
  });
});
