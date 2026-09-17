import { describe, expect, it, vi } from 'vitest';
import { fetchRiseFallCounts } from './breadth.js';

/** 沪市 1062/1205、深市 1466/1389，加总即全市场涨跌家数 */
const riseFallPayload = {
  data: {
    diff: [
      { f12: '000001', f104: 1062, f105: 1205 },
      { f12: '399001', f104: 1466, f105: 1389 },
    ],
  },
};

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body));

describe('market breadth rise/fall counts', () => {
  it('sums the Shanghai and Shenzhen rise/fall counts into a whole-market figure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(riseFallPayload));

    await expect(fetchRiseFallCounts(fetchImpl)).resolves.toEqual({
      riseCount: 2528,
      fallCount: 2594,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('secids=1.000001%2C0.399001');
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('fields=f12%2Cf104%2Cf105');
  });

  it('falls back to the delay mirror when the primary host rejects', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(riseFallPayload));

    await expect(fetchRiseFallCounts(fetchImpl)).resolves.toEqual({
      riseCount: 2528,
      fallCount: 2594,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns null instead of a partial total when only one market carries counts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { diff: [{ f12: '000001', f104: 1062, f105: 1205 }] },
      }),
    );

    // 只有沪市可算时加总会把深市漏掉，宁可不显示
    await expect(fetchRiseFallCounts(fetchImpl)).resolves.toBeNull();
  });

  it('returns null when both hosts fail or the payload has no usable rows', async () => {
    const failing = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    await expect(fetchRiseFallCounts(failing)).resolves.toBeNull();

    const empty = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: { diff: [] } }));
    await expect(fetchRiseFallCounts(empty)).resolves.toBeNull();

    const blank = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { diff: [{ f12: '000001', f104: '-', f105: '' }] } }));
    await expect(fetchRiseFallCounts(blank)).resolves.toBeNull();
  });
});
