import { describe, expect, it } from 'vitest';
import type { MarketOverviewResponse } from '../types';

const marketResponse: MarketOverviewResponse = {
  indices: [
    {
      symbol: '000001',
      name: '上证指数',
      price: 3990.29,
      change: -0.01,
      pct: 0,
      updatedAt: null,
      status: 'fresh',
    },
  ],
  fetchedAt: '2026-08-19T02:00:00.000Z',
  source: 'eastmoney',
  errors: [],
};

describe('market overview fixture', () => {
  it('keeps the expected market response shape', () => {
    expect(marketResponse.indices[0].symbol).toBe('000001');
    expect(marketResponse.source).toBe('eastmoney');
  });
});
