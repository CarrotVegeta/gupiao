import { describe, expect, it } from 'vitest';
import type { LimitUpResponse } from '../types';

const limitUpResponse: LimitUpResponse = {
  tradeDate: '20260818',
  items: [
    {
      symbol: '002820',
      name: '桂发祥',
      price: 12.27,
      pct: 10.04,
      boardCount: 3,
      firstSealTime: '09:25:00',
      lastSealTime: '09:25:00',
      industry: '休闲食品',
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
    expect(limitUpResponse.status).toBe('fresh');
  });
});
