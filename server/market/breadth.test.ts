import { describe, expect, it, vi } from 'vitest';
import { fetchMarketBreadth, fetchRiseFallCounts } from './breadth.js';

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

// ---------------------------------------------------------------------------
// 晋级率：池子接口的 date 只是「不晚于」，真实日期在 qdate 里
// ---------------------------------------------------------------------------

const ztPoolPayload = (qdate: number, codes: string[]) => ({
  data: {
    qdate,
    tc: codes.length,
    pool: codes.map((code) => ({ c: code })),
  },
});

const zbPoolPayload = (qdate: number, codes: string[]) => ({
  data: {
    qdate,
    tc: codes.length,
    pool: codes.map((code) => ({ c: code })),
  },
});

/**
 * 固定上游：
 * - 涨停池/炸板池按请求日期返回「不晚于该日期的最近交易日」的数据（用 poolsByDate 表达）
 * - ulist 返回固定的涨跌家数
 * - poolFor 返回 null 表示这一路取数失败（响应不可用）
 */
const upstream = (
  poolFor: (endpoint: string, date: string) => { qdate: number; codes: string[] } | null,
): typeof fetch => {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('ulist')) {
      return jsonResponse(riseFallPayload);
    }
    const date = new URL(url).searchParams.get('date') ?? '';
    const isBroken = url.includes('getTopicZBPool');
    const snapshot = poolFor(isBroken ? 'broken' : 'limit-up', date);
    if (snapshot === null) {
      return new Response('', { status: 502 });
    }
    return jsonResponse(
      isBroken ? zbPoolPayload(snapshot.qdate, snapshot.codes) : ztPoolPayload(snapshot.qdate, snapshot.codes),
    );
  };
  return impl as unknown as typeof fetch;
};

describe('晋级率', () => {
  it('昨日池被上游回落到同一天时不给晋级率，而不是算成 100%', async () => {
    // 实测：请求 20260918（当天还没出数）与 20260917 返回同一份 47 只的池子
    const codes = ['600101', '600102', '600103'];
    const fetchImpl = upstream(() => ({ qdate: 20260917, codes }));

    const breadth = await fetchMarketBreadth('20260918', fetchImpl);

    expect(breadth.limitUpCount).toBe(3);
    // 关键断言：不能出现「交集=全集」导致的 100%
    expect(breadth.promotionRate).toBeNull();
    // 找不到「另一天」的池子时，昨日日期也不谎报
    expect(breadth.previousTradeDate).toBeNull();
    // 今日数据截至上游给出的最新交易日
    expect(breadth.tradeDate).toBe('20260917');
  });

  it('昨日池是另一份数据时，按「今日∩昨日 / 昨日家数」计算', async () => {
    // 今日(20260917) 3 只，其中 2 只出现在昨日(20260916) 的 4 只里 → 50%
    const fetchImpl = upstream((_endpoint, date) =>
      date >= '20260917'
        ? { qdate: 20260917, codes: ['600101', '600102', '600103'] }
        : { qdate: 20260917, codes: ['600101', '600102', '600104', '600105'] },
    );

    const breadth = await fetchMarketBreadth('20260917', fetchImpl);

    expect(breadth.tradeDate).toBe('20260917');
    expect(breadth.previousTradeDate).toBe('20260916');
    expect(breadth.promotionRate).toBeCloseTo(50, 5);
  });

  it('请求日当天已出数时，昨日取真正的上一个交易日', async () => {
    // 20260917 有数（qdate=20260917）；再往前一天的请求返回 20260916 自己的池子
    const fetchImpl = upstream((_endpoint, date) =>
      date >= '20260917'
        ? { qdate: 20260917, codes: ['600101'] }
        : { qdate: 20260917, codes: ['600101', '600202'] },
    );

    const breadth = await fetchMarketBreadth('20260917', fetchImpl);

    expect(breadth.previousTradeDate).toBe('20260916');
    expect(breadth.promotionRate).toBeCloseTo(50, 5);
  });

  it('今日池取不到时不给晋级率（不能把缺数据当成 0%）', async () => {
    const fetchImpl = upstream((endpoint) =>
      endpoint === 'limit-up' ? null : { qdate: 20260916, codes: ['600101'] },
    );

    const breadth = await fetchMarketBreadth('20260917', fetchImpl);

    expect(breadth.limitUpCount).toBeNull();
    expect(breadth.promotionRate).toBeNull();
  });
});
