import { describe, expect, it, vi } from 'vitest';
import { searchStocks } from './search';

describe('stock search client', () => {
  it('requests the normalized query and returns valid suggestions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          source: 'eastmoney',
          results: [
            { symbol: '600519', name: '贵州茅台' },
            { symbol: 'bad', name: '非法结果' },
          ],
        }),
      ),
    );

    await expect(searchStocks(' 贵州茅台 ', fetchImpl)).resolves.toEqual([
      { symbol: '600519', name: '贵州茅台' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/stock-search?query=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0');
  });

  it('does not request an empty query', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(searchStocks('  ', fetchImpl)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
