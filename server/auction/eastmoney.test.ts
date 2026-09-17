import { describe, expect, it, vi } from 'vitest';
import {
  createAuctionMarketContext,
  evaluateAuctionCandidate,
  fetchEastmoneyAuction,
  findPreviousTradeDate,
  isPreviousOneWord,
  mapEastmoneyAuctionDetail,
  mapEastmoneyAuctionPoolItem,
  mapTencentAuctionTick,
  sortAuctionItems,
} from './eastmoney.js';
import { classifyAuctionPremium, predictLimitUpProbability, toProbabilityTier } from './model.js';

const strongPoolRow = {
  c: '603000',
  n: '人民网',
  lbc: 2,
  fbt: 93500,
  lbt: 100000,
  zbc: 0,
  amount: 100_000_000,
  fund: 15_000_000,
  ltsz: 1_000_000_000,
  hs: 8.5,
};

const context = { previousLimitUpCount: 100, previousBrokenCount: 20, indexGapPct: 0 };

const referenceInputs = {
  gapPct: 4,
  board: 2,
  previousOneWord: false,
  previousTurnover: 8.5,
  floatMarketCapYi: 10,
  previousLimitUpCount: 100,
  previousBrokenCount: 20,
  indexGapPct: 0,
};

describe('eastmoney call-auction adapter', () => {
  it('finds the latest completed trading day strictly before the requested date', () => {
    expect(
      findPreviousTradeDate(['2026-08-14', '2026-08-17', '2026-08-18', '2026-08-19'], '20260819'),
    ).toBe('20260818');
  });

  it('maps the previous limit-up pool fields used by the model', () => {
    expect(mapEastmoneyAuctionPoolItem(strongPoolRow)).toEqual({
      symbol: '603000',
      name: '人民网',
      boardCount: 2,
      firstSealTime: '09:35:00',
      lastSealTime: '10:00:00',
      breakCount: 0,
      previousAmount: 100_000_000,
      sealAmount: 15_000_000,
      floatMarketCap: 1_000_000_000,
      turnoverRate: 8.5,
    });
  });

  it('uses the exact 09:25 match instead of a later intraday trade', () => {
    expect(
      mapEastmoneyAuctionDetail({
        prePrice: 10,
        details: ['09:24:57,10.20,800,0,4', '09:25:00,10.40,5000,0,4', '09:30:00,10.55,300,1,2'],
      }),
    ).toEqual({ auctionPrice: 10.4, auctionPct: 4, auctionAmount: 5_200_000 });
  });

  it('accepts an auction print stamped just after 09:25:00', () => {
    // 实测约三分之一个股的竞价成交戳在 09:25:01~09:25:59
    expect(
      mapEastmoneyAuctionDetail({
        prePrice: 10,
        details: [
          '09:24:58,9.60,800,0,4',
          '09:25:01,9.90,5000,2520,2',
          '09:30:00,10.05,300,1,2',
        ],
      }),
    ).toEqual({ auctionPrice: 9.9, auctionPct: -1, auctionAmount: 4_950_000 });
  });

  it('still ignores continuous-auction prints from 09:30 onward', () => {
    expect(
      mapEastmoneyAuctionDetail({
        prePrice: 10,
        details: ['09:30:00,10.05,300,1,2', '09:31:00,10.10,300,1,2'],
      }),
    ).toBeNull();
  });

  it('treats a 09:25 seal with no break as a one-word board', () => {
    expect(isPreviousOneWord('09:25:00', 0)).toBe(true);
    expect(isPreviousOneWord('09:25:00', 1)).toBe(false);
    expect(isPreviousOneWord('09:31:00', 0)).toBe(false);
    expect(isPreviousOneWord(null, 0)).toBeNull();
  });

  it('reproduces the trained logistic model on a reference candidate', () => {
    expect(predictLimitUpProbability(referenceInputs)).toMatchObject({
      probability: expect.closeTo(0.3637, 3),
      missingCount: 0,
    });
  });

  it('shows the real board count even though the model caps the feature at 5', () => {
    const six = predictLimitUpProbability({ ...referenceInputs, gapPct: -3, board: 6 });
    const capped = predictLimitUpProbability({ ...referenceInputs, gapPct: -3, board: 5 });

    // 概率口径不变：6 连板仍然按训练时的截断值 5 计算
    expect(six.probability).toBe(capped.probability);
    // 但展示要说真话：表格里写 6 连板，依据里就不能写 5 连板
    expect(six.reasons.some((reason) => reason.includes('昨日连板 6 连板'))).toBe(true);
    expect(six.reasons.some((reason) => reason.includes('昨日连板 5 连板'))).toBe(false);
    expect(capped.reasons.some((reason) => reason.includes('昨日连板 5 连板'))).toBe(true);
  });

  it('imputes missing features at the training mean instead of collapsing the probability', () => {
    const partial = predictLimitUpProbability({
      ...referenceInputs,
      previousOneWord: null,
      previousTurnover: null,
      floatMarketCapYi: null,
    });

    expect(partial.missingCount).toBe(3);
    expect(partial.probability).toBeGreaterThan(0.15);
    expect(partial.probability).toBeLessThan(0.75);
  });

  it('raises the probability as the auction premium rises', () => {
    const base = { ...referenceInputs, board: 1, floatMarketCapYi: 40 };
    const low = predictLimitUpProbability({ ...base, gapPct: -2 }).probability;
    const mid = predictLimitUpProbability({ ...base, gapPct: 1 }).probability;
    const high = predictLimitUpProbability({ ...base, gapPct: 7 }).probability;

    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });

  it('maps calibrated probabilities to tiers on the training base rate', () => {
    expect(toProbabilityTier(0.7)).toBe('qualified');
    expect(toProbabilityTier(0.55)).toBe('qualified');
    expect(toProbabilityTier(0.4)).toBe('watch');
    expect(toProbabilityTier(0.3)).toBe('watch');
    expect(toProbabilityTier(0.29)).toBe('unqualified');
  });

  it('classifies the auction premium by backtested bands', () => {
    expect(classifyAuctionPremium(7.2)).toMatchObject({ level: 'chase' });
    expect(classifyAuctionPremium(5)).toMatchObject({ level: 'chase' });
    expect(classifyAuctionPremium(4.9)).toMatchObject({ level: 'rich' });
    expect(classifyAuctionPremium(3)).toMatchObject({ level: 'rich' });
    expect(classifyAuctionPremium(1.2)).toMatchObject({ level: 'mild' });
    expect(classifyAuctionPremium(0)).toMatchObject({ level: 'mild' });
    expect(classifyAuctionPremium(-0.1)).toMatchObject({ level: 'discount' });
  });

  it('returns data-insufficient instead of guessing when the 09:25 match is missing', () => {
    const poolItem = mapEastmoneyAuctionPoolItem(strongPoolRow);
    expect(poolItem).not.toBeNull();

    expect(evaluateAuctionCandidate(poolItem!, null, context)).toMatchObject({
      limitUpProbability: null,
      probabilityMissing: 0,
      result: 'insufficient',
      auctionPremium: null,
      reasons: ['缺少 09:25 竞价成交数据'],
    });
  });

  it('evaluates a candidate into probability, tier, premium and explanations', () => {
    const result = evaluateAuctionCandidate(
      mapEastmoneyAuctionPoolItem(strongPoolRow)!,
      { auctionPrice: 10.4, auctionPct: 4, auctionAmount: 5_200_000 },
      context,
    );

    expect(result.limitUpProbability).toBeCloseTo(0.3637, 3);
    expect(result.result).toBe('watch');
    expect(result.auctionPremium).toBe('rich');
    expect(result.auctionRatio).toBe(5.2);
    expect(result.probabilityMissing).toBe(0);
    expect(result.reasons.at(-1)).toContain('竞价溢价偏高');
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  it('separates a weak low-open candidate from a strong high-open one', () => {
    const poolItem = mapEastmoneyAuctionPoolItem(strongPoolRow)!;
    const weak = evaluateAuctionCandidate(
      poolItem,
      { auctionPrice: 9.8, auctionPct: -2, auctionAmount: 1_000_000 },
      context,
    );
    const strong = evaluateAuctionCandidate(
      poolItem,
      { auctionPrice: 10.9, auctionPct: 9, auctionAmount: 5_200_000 },
      context,
    );

    expect(weak.limitUpProbability!).toBeLessThan(0.2);
    expect(strong.limitUpProbability!).toBeGreaterThan(0.6);
    expect(strong.limitUpProbability!).toBeGreaterThan(weak.limitUpProbability! * 4);
    expect(weak.result).toBe('unqualified');
    expect(strong.result).toBe('qualified');
  });

  it('sorts by previous board count first and probability second', () => {
    expect(
      sortAuctionItems([
        { symbol: '000001', boardCount: 2, limitUpProbability: 0.42 },
        { symbol: '000002', boardCount: 3, limitUpProbability: 0.31 },
        { symbol: '000003', boardCount: 2, limitUpProbability: 0.65 },
        { symbol: '000004', boardCount: null, limitUpProbability: null },
      ]),
    ).toEqual([
      { symbol: '000002', boardCount: 3, limitUpProbability: 0.31 },
      { symbol: '000003', boardCount: 2, limitUpProbability: 0.65 },
      { symbol: '000001', boardCount: 2, limitUpProbability: 0.42 },
      { symbol: '000004', boardCount: null, limitUpProbability: null },
    ]);
  });

  it('builds a fixed 09:25 response with market context from the previous day', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-17', '2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/getTopicZBPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [], tc: 20 } })));
      }
      if (url.includes('/api/qt/stock/get')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { f46: 390000, f60: 389000 } })));
      }
      if (url.includes('/stock/details/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:00,10.40,5000,0,4'] } })),
        );
      }
      throw new Error('unexpected URL: ' + url);
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(body).toMatchObject({
      tradeDate: '20260819',
      previousTradeDate: '20260818',
      snapshotTime: '09:25:00',
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    });
    expect(body.items[0]).toMatchObject({ symbol: '603000', result: 'watch', probabilityMissing: 0 });
    expect(body.items[0].limitUpProbability).toBeGreaterThan(0);
    expect(body.items[0].limitUpProbability).toBeLessThan(1);
  });

  it('reports missing context features instead of failing the whole response', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/getTopicZBPool') || url.includes('/api/qt/stock/get')) {
        return Promise.reject(new Error('context host closed'));
      }
      if (url.includes('/stock/details/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:00,10.40,5000,0,4'] } })),
        );
      }
      throw new Error('unexpected URL: ' + url);
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(body.status).toBe('fresh');
    expect(body.items[0].probabilityMissing).toBe(2);
    expect(body.items[0].limitUpProbability).toBeGreaterThan(0);
  });

  it('falls back to the dated limit-up pool when the trading-calendar host is unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.reject(new Error('calendar connection closed'));
      }
      if (url.includes('/getTopicZTPool') && url.includes('date=20260818')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/stock/details/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:00,10.40,5000,0,4'] } })),
        );
      }
      throw new Error('unexpected URL: ' + url);
    });

    await expect(fetchEastmoneyAuction('20260819', fetchImpl)).resolves.toMatchObject({
      status: 'fresh',
      previousTradeDate: '20260818',
      items: [{ symbol: '603000', result: 'watch' }],
    });
  });

  it('falls back to the official opening price when the tick-detail endpoint is unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/ulist.np/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { diff: [{ f12: '603000', f17: 10.4, f18: 10 }] } })),
        );
      }
      if (url.includes('/stock/details/get')) {
        return Promise.reject(new Error('tick connection closed'));
      }
      throw new Error('unexpected URL: ' + url);
    });

    await expect(fetchEastmoneyAuction('20260819', fetchImpl)).resolves.toMatchObject({
      status: 'fresh',
      items: [
        { symbol: '603000', auctionPrice: 10.4, auctionPct: 4, auctionAmount: null, result: 'watch' },
      ],
    });
  });

  it('uses the Tencent opening quote when Eastmoney quote hosts close connections', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('push2.eastmoney.com')) {
        return Promise.reject(new Error('eastmoney connection closed'));
      }
      if (url.includes('qt.gtimg.cn')) {
        return Promise.resolve(new Response('v_sh603000="1~人民网~603000~10.50~10.00~10.40~1000";'));
      }
      throw new Error('unexpected URL: ' + url);
    });

    await expect(fetchEastmoneyAuction('20260819', fetchImpl)).resolves.toMatchObject({
      source: 'eastmoney+tencent',
      items: [{ symbol: '603000', auctionPrice: 10.4, auctionPct: 4, result: 'watch' }],
    });
  });

  it('retries a transient tick-detail failure so the volume reference is not dropped', async () => {
    let detailCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/stock/details/get')) {
        detailCalls += 1;
        if (detailCalls < 3) {
          return Promise.reject(new Error('tick connection closed'));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:00,10.40,5000,0,4'] } })),
        );
      }
      throw new Error('unexpected URL: ' + url);
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(detailCalls).toBe(3);
    expect(body.items[0]).toMatchObject({
      symbol: '603000',
      auctionAmount: 5_200_000,
      auctionRatio: 5.2,
      result: 'watch',
    });
  });

  it('falls back to the mirror detail host when the primary is disconnected', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('push2delay.eastmoney.com')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:01,10.40,5000,0,4'] } })),
        );
      }
      if (url.includes('push2.eastmoney.com')) {
        return Promise.reject(new Error('other side closed'));
      }
      throw new Error('unexpected URL: ' + url);
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(body.items[0]).toMatchObject({
      symbol: '603000',
      auctionAmount: 5_200_000,
      auctionRatio: 5.2,
    });
  });

  it('stops hitting the detail source once it looks globally down', async () => {
    let detailCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        const pool = Array.from({ length: 40 }, (_value, index) => ({
          ...strongPoolRow,
          c: String(600000 + index),
        }));
        return Promise.resolve(new Response(JSON.stringify({ data: { pool, tc: pool.length } })));
      }
      if (url.includes('/stock/details/get')) {
        detailCalls += 1;
        return Promise.reject(new Error('other side closed'));
      }
      if (url.includes('qt.gtimg.cn')) {
        return Promise.resolve(new Response('v_sh600000="1~样本~600000~10.50~10.00~10.40~1000";'));
      }
      throw new Error('unexpected URL: ' + url);
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    // 40 只票，但熔断后不再继续尝试：远小于 40 × 尝试次数
    expect(detailCalls).toBeLessThan(40);
    expect(body.status).toBe('fresh');
    expect(body.items).toHaveLength(40);
  });

  it('reads the index auction gap from the stable quote host', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/getTopicZBPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [], tc: 20 } })));
      }
      if (url.includes('qt.gtimg.cn')) {
        return Promise.resolve(
          new Response('v_sh000001="1~上证指数~000001~3873.07~3891.60~3877.00~1000";'),
        );
      }
      if (url.includes('/stock/details/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:00,10.40,5000,0,4'] } })),
        );
      }
      throw new Error('unexpected URL: ' + url);
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    // 大盘缺口拿到了，就不该再有特征缺失
    expect(body.items[0].probabilityMissing).toBe(0);
  });

  it('does not retry when the upstream answers without a 09:25 match', async () => {
    let detailCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.includes('/stock/kline/get')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
        );
      }
      if (url.includes('/getTopicZTPool')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
      }
      if (url.includes('/stock/details/get')) {
        detailCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:30:00,10.55,300,1,2'] } })),
        );
      }
      return Promise.reject(new Error('quote host unavailable'));
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(detailCalls).toBe(1);
    expect(body.items[0]).toMatchObject({ result: 'insufficient', limitUpProbability: null });
  });

  it('exposes a default market context for callers without environment data', () => {
    expect(createAuctionMarketContext(80)).toEqual({
      previousLimitUpCount: 80,
      previousBrokenCount: null,
      indexGapPct: null,
    });
  });
});

/**
 * 88 字段的 gtimg 行情行：竞价链路只读今开 [5] 与昨收 [4]。
 *
 * 名字这里用 ASCII 占位：真实响应的名字是 GBK 字节，而 Response 从字符串构造会按 UTF-8 编码，
 * 中文再被 GBK 解码会吃掉后面的分隔符导致字段错位。名字不参与竞价计算（名称取自东财涨停池），
 * GBK 解码本身由 server/quotes/tencent.test.ts 用真实 GBK 字节覆盖。
 */
const tencentQuoteLine = (open: string, preClose: string): string => {
  const fields = new Array<string>(88).fill('0');
  fields[1] = 'TEST';
  fields[2] = '603000';
  fields[3] = open;
  fields[4] = preClose;
  fields[5] = open;
  fields[30] = '20260917150000';
  fields[31] = '0.40';
  fields[32] = '4.00';

  return `v_sh603000="${fields.join('~')}";`;
};

/** `序号/时间/价格/涨跌/成交量(手)/成交额(元)/方向` */
const tencentTick = (time: string, price: string, amount: string): string =>
  `v_detail_data_sh603000=[0,"0/${time}/${price}/0.40/5000/${amount}/S|1/09:30:02/${price}/0.00/10/100000/B"];`;

const createAuctionFetch = (options: { open: string; tick: string | null }) => {
  const calls = { details: 0, ticks: 0 };

  const fetchImpl = vi.fn<typeof fetch>((input) => {
    const url = String(input);
    if (url.includes('/stock/kline/get')) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { klines: ['2026-08-18', '2026-08-19'] } })),
      );
    }
    if (url.includes('/getTopicZTPool')) {
      return Promise.resolve(new Response(JSON.stringify({ data: { pool: [strongPoolRow], tc: 1 } })));
    }
    if (url.includes('/getTopicZBPool')) {
      return Promise.resolve(new Response(JSON.stringify({ data: { pool: [], tc: 20 } })));
    }
    if (url.includes('/api/qt/stock/get')) {
      return Promise.resolve(new Response(JSON.stringify({ data: { f46: 390000, f60: 389000 } })));
    }
    if (url.includes('qt.gtimg.cn')) {
      return Promise.resolve(new Response(tencentQuoteLine(options.open, '10.00')));
    }
    if (url.includes('stock.gtimg.cn')) {
      calls.ticks += 1;
      return options.tick === null
        ? Promise.reject(new Error('tick host closed'))
        : Promise.resolve(new Response(options.tick));
    }
    if (url.includes('/stock/details/get')) {
      calls.details += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ data: { prePrice: 10, details: ['09:25:00,10.40,5000,0,4'] } })),
      );
    }

    return Promise.reject(new Error('unexpected URL: ' + url));
  });

  return { fetchImpl, calls };
};

describe('tencent-first auction detail', () => {
  it('takes the auction price and volume from Tencent without touching the Eastmoney tick chain', async () => {
    const { fetchImpl, calls } = createAuctionFetch({
      open: '10.40',
      tick: tencentTick('09:25:02', '10.40', '5200000'),
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(calls.ticks).toBe(1);
    expect(calls.details).toBe(0);
    expect(body.source).toBe('eastmoney+tencent');
    expect(body.items[0]).toMatchObject({
      symbol: '603000',
      auctionPrice: 10.4,
      auctionPct: 4,
      auctionAmount: 5_200_000,
      auctionRatio: 5.2,
    });
  });

  it('prefers the Tencent tick amount over the Eastmoney estimate', async () => {
    // 东财口径是「价 × 手数 × 100」= 5 200 000，腾讯给的真实成交额略有差异，应当以腾讯为准
    const { fetchImpl } = createAuctionFetch({
      open: '10.40',
      tick: tencentTick('09:25:01', '10.40', '5199800'),
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    expect(body.items[0].auctionAmount).toBe(5_199_800);
  });

  it('keeps the price but marks volume missing when the Tencent tick is unavailable', async () => {
    const { fetchImpl, calls } = createAuctionFetch({ open: '10.40', tick: null });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    // 已经拿到价格就不再回头打东财明细，量能是展示项、不影响概率
    expect(calls.details).toBe(0);
    expect(body.source).toBe('eastmoney+tencent');
    expect(body.items[0]).toMatchObject({
      auctionPrice: 10.4,
      auctionPct: 4,
      auctionAmount: null,
      auctionRatio: null,
    });
  });

  it('falls back to the Eastmoney tick chain before the open, when 今开 is still 0', async () => {
    const { fetchImpl, calls } = createAuctionFetch({
      open: '0.00',
      tick: tencentTick('09:25:02', '10.40', '5200000'),
    });

    const body = await fetchEastmoneyAuction('20260819', fetchImpl);

    // 09:25 之前腾讯分笔还在吐上一交易日的数据，必须靠「今开 > 0」把它挡掉
    expect(calls.ticks).toBe(0);
    expect(calls.details).toBe(1);
    expect(body.source).toBe('eastmoney');
    expect(body.items[0]).toMatchObject({ auctionPrice: 10.4, auctionAmount: 5_200_000 });
  });
});

describe('tencent auction tick parsing', () => {
  it('takes the first print inside the 09:25 auction window', () => {
    expect(
      mapTencentAuctionTick(
        'v_detail_data_sh600000=[0,"0/09:25:02/9.10/0.00/2190/1992900/S|1/09:30:02/9.10/0.00/288/261646/B"];',
      ),
    ).toEqual({ auctionPrice: 9.1, auctionAmount: 1_992_900 });
  });

  it('accepts a print stamped a few seconds after 09:25:00', () => {
    expect(
      mapTencentAuctionTick('v_detail_data_sh600000=[0,"0/09:25:07/9.90/0.00/5000/4950000/S"];'),
    ).toEqual({ auctionPrice: 9.9, auctionAmount: 4_950_000 });
  });

  it('ignores continuous-auction prints from 09:30 onward', () => {
    expect(
      mapTencentAuctionTick('v_detail_data_sh600000=[0,"0/09:30:02/10.05/0.00/300/301500/B"];'),
    ).toBeNull();
  });

  it('returns null for an empty or malformed payload', () => {
    expect(mapTencentAuctionTick('v_detail_data_sh600000=[0,""];')).toBeNull();
    expect(mapTencentAuctionTick('{"code":11,"msg":"Can\'t load controller"}')).toBeNull();
    expect(mapTencentAuctionTick('v_detail_data_sh600000=[0,"0/09:25:02/0.00/0.00/0/0/S"];')).toBeNull();
  });
});
