import { describe, expect, it, vi } from 'vitest';
import { fetchEastmoneyMarket, mapEastmoneyMarket } from './eastmoney.js';

const fetchedAt = '2026-08-19T01:30:00.000Z';

const marketDiffFixture = [
  { f2: 345678, f3: 123, f4: 4198, f12: '000688', f14: '科创50' },
  { f2: 321012, f3: -56, f4: -1811, f12: '000001', f14: '上证指数' },
  { f2: 1109876, f3: 89, f4: 9765, f12: '399001', f14: '深证成指' },
  { f2: 223456, f3: 234, f4: 5111, f12: '399006', f14: '创业板指' },
];

describe('eastmoney market adapter', () => {
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
          updatedAt: fetchedAt,
          status: 'fresh',
        },
        {
          symbol: '399001',
          name: '深证成指',
          price: 11098.76,
          pct: 0.89,
          change: 97.65,
          updatedAt: fetchedAt,
          status: 'fresh',
        },
        {
          symbol: '399006',
          name: '创业板指',
          price: 2234.56,
          pct: 2.34,
          change: 51.11,
          updatedAt: fetchedAt,
          status: 'fresh',
        },
        {
          symbol: '000688',
          name: '科创50',
          price: 3456.78,
          pct: 1.23,
          change: 41.98,
          updatedAt: fetchedAt,
          status: 'fresh',
        },
      ],
      fetchedAt,
      source: 'eastmoney',
      errors: [],
    });
  });

  it('requests all four fixed market secids from the upstream endpoint', async () => {
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
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('secids=1.000001%2C0.399001%2C0.399006%2C1.000688');
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('fields=f2%2Cf3%2Cf4%2Cf12%2Cf14');
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
        status: 'unavailable',
      },
      { symbol: '399006', status: 'fresh' },
      { symbol: '000688', status: 'fresh' },
    ]);
    expect(result.errors).toEqual([{ symbol: '399001', message: '上游指数数据不完整' }]);
  });
});
