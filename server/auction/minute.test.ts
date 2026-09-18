import { describe, expect, it } from 'vitest';
import {
  AUCTION_TREND_THRESHOLDS,
  fetchAuctionMinutes,
  parseAuctionMinuteTrends,
  summarizeAuctionMinute,
} from './minute.js';

/**
 * 固件取自 2026-09-18 华瓷股份（001216）的真实上游返回。
 * 该票当天快照（data/auction-snapshots.jsonl）里的竞价成交额 = 72735562、竞价价 = 20.98，
 * 与这里 09:26 落点的 `f56` / 收盘价完全一致 —— 这是「分时首个有量点 = 09:25 竞价」的证据。
 */
const HUACI_TRENDS = [
  '2026-09-18 09:15,19.88,19.88,19.88,19.88,0,0.00,19.880,0,0.00,0',
  '2026-09-18 09:16,21.87,21.87,21.87,21.87,0,0.00,19.880,67864,0.00,0',
  '2026-09-18 09:17,21.87,21.87,21.87,21.87,0,0.00,19.880,61787,0.00,0',
  '2026-09-18 09:18,21.87,21.87,21.87,21.87,0,0.00,19.880,42097,0.00,0',
  '2026-09-18 09:19,21.87,21.87,21.87,21.87,0,0.00,19.880,23503,0.00,0',
  '2026-09-18 09:20,21.87,21.87,21.87,21.87,0,0.00,19.880,9437,0.00,0',
  '2026-09-18 09:21,21.87,21.87,21.87,21.87,0,0.00,19.880,9659,0.00,0',
  '2026-09-18 09:22,21.87,21.87,21.87,21.87,0,0.00,19.880,10407,0.00,0',
  '2026-09-18 09:23,21.87,21.87,21.87,21.87,0,0.00,19.880,12270,0.00,0',
  '2026-09-18 09:24,21.87,21.87,21.87,21.87,0,0.00,19.880,16138,0.00,0',
  '2026-09-18 09:25,21.87,21.60,21.87,21.60,0,0.00,19.880,30018,0.00,0',
  '2026-09-18 09:26,20.98,20.98,20.98,20.98,34669,72735562.00,20.980,48,0.00,34669',
  '2026-09-18 09:27,20.98,20.98,20.98,20.98,0,0.00,20.980,48,0.00,34669',
  '2026-09-18 09:31,21.40,21.87,21.87,20.96,52603,113859079.00,21.381,126348,0.00,87272',
];

describe('parseAuctionMinuteTrends', () => {
  it('只保留竞价窗口内的点，且轨迹不含 09:25 的最终撮合价', () => {
    const parsed = parseAuctionMinuteTrends(HUACI_TRENDS);

    expect(parsed.tradeDate).toBe('2026-09-18');
    // 09:15~09:24 共 10 个点；09:25 归入尾段偏移的参照，09:31 在窗口外
    expect(parsed.points).toHaveLength(10);
    expect(parsed.points[0]).toEqual({ time: '09:15', matchPrice: 19.88, matchedVolume: 0 });
    expect(parsed.points.at(-1)).toEqual({ time: '09:24', matchPrice: 21.87, matchedVolume: 16138 });
  });

  it('用第一个成交量 > 0 的点作为 09:25 竞价成交', () => {
    const parsed = parseAuctionMinuteTrends(HUACI_TRENDS);

    expect(parsed.settlement).toEqual({
      price: 20.98,
      volume: 34669,
      amount: 72735562,
    });
  });

  it('上游没有成交落点时返回 null，而不是把 09:25 的 0 成交量当成交', () => {
    const parsed = parseAuctionMinuteTrends(HUACI_TRENDS.filter((row) => !row.startsWith('2026-09-18 09:26')));

    expect(parsed.settlement).toBeNull();
    expect(summarizeAuctionMinute('001216', 19.88, parsed)).toBeNull();
  });

  it('忽略格式异常的行', () => {
    const parsed = parseAuctionMinuteTrends([
      'garbage',
      '2026-09-18 09:16,21.87',
      '2026-09-18 09:16,21.87,21.87,21.87,21.87,0,0.00,19.880,67864,0.00,0',
      '2026-09-18 16:00,1,1,1,1,0,0,1,0,0,0',
      null,
      42,
    ]);

    expect(parsed.points).toHaveLength(1);
  });

  it('成交额缺失时用 成交量 × 价 兜底', () => {
    const parsed = parseAuctionMinuteTrends([
      '2026-09-18 09:20,10.00,10.00,10.00,10.00,0,0.00,10.000,0,0.00,0',
      '2026-09-18 09:26,12.00,12.00,12.00,12.00,1000,0.00,12.000,0,0.00,0',
    ]);

    expect(parsed.settlement).toEqual({ price: 12, volume: 1000, amount: 12000 });
  });
});

describe('summarizeAuctionMinute', () => {
  const summarize = () =>
    summarizeAuctionMinute('001216', 19.88, parseAuctionMinuteTrends(HUACI_TRENDS))!;

  it('算出竞价成交价与成交额（与快照一致）', () => {
    const { data } = summarize();

    expect(data.symbol).toBe('001216');
    expect(data.auctionPrice).toBe(20.98);
    expect(data.auctionAmount).toBe(72735562);
    expect(data.lastVirtualPrice).toBe(21.87);
    expect(data.preClose).toBe(19.88);
  });

  it('识别「竞价走高 + 尾段下砸」这种诱多形态', () => {
    const { features } = summarize();

    expect(features.trend).toBe('rising');
    expect(features.trendPct).toBeCloseTo(10.01, 1);
    // 09:24 虚拟匹配价 21.87 → 竞价成交 20.98
    expect(features.lateShiftPct).toBeCloseTo(-4.07, 1);
    expect(features.label).toContain('竞价走高');
    expect(features.label).toContain('尾段下砸');
  });

  it('匹配量峰值与后段放量判定', () => {
    const { features } = summarize();

    expect(features.maxMatchedVolume).toBe(67864);
    expect(features.peakMatchedTime).toBe('09:16');
    expect(features.lateRush).toBe(false);
    // 峰值匹配量 67864 相对竞价成交量 34669 的厚度
    expect(features.matchedSharePct).toBeCloseTo(195.75, 1);
  });

  it('峰值落在尾段时标记后段放量', () => {
    const latePeak = [
      '2026-09-18 09:16,10.00,10.00,10.00,10.00,0,0.00,10.000,100,0.00,0',
      '2026-09-18 09:24,10.20,10.20,10.20,10.20,0,0.00,10.200,900,0.00,0',
      '2026-09-18 09:26,10.20,10.20,10.20,10.20,1000,10200.00,10.200,0,0.00,0',
    ];
    const { features } = summarizeAuctionMinute('000001', 10, parseAuctionMinuteTrends(latePeak))!;

    expect(features.peakMatchedTime).toBe('09:24');
    expect(features.lateRush).toBe(true);
    expect(features.label).toContain('后段放量');
  });

  it('上抬幅度够大时标记尾段上抬', () => {
    const lift = [
      '2026-09-18 09:16,10.00,10.00,10.00,10.00,0,0.00,10.000,100,0.00,0',
      '2026-09-18 09:24,10.00,10.00,10.00,10.00,0,0.00,10.000,100,0.00,0',
      '2026-09-18 09:26,10.50,10.50,10.50,10.50,1000,10500.00,10.500,0,0.00,0',
    ];
    const { features } = summarizeAuctionMinute('000001', 10, parseAuctionMinuteTrends(lift))!;

    expect(features.lateShiftPct).toBe(5);
    expect(features.label).toContain('尾段上抬');
  });

  it('阈值来自统一配置，改一处即生效', () => {
    expect(AUCTION_TREND_THRESHOLDS.lateRushFrom).toBe('09:23');
    expect(AUCTION_TREND_THRESHOLDS.trendFlatPct).toBe(0.3);
  });

  it('竞价过程中摸过涨停价、但最终没封在上面时标记「竞价摸板未封」', () => {
    // 19.88 昨收 → 涨停价 21.87（10%）；09:16 起虚拟价就是 21.87，最终成交 20.98
    const { features } = summarizeAuctionMinute(
      '001216',
      19.88,
      parseAuctionMinuteTrends(HUACI_TRENDS),
      21.87,
    )!;

    expect(features.touchedLimitUp).toBe(true);
    expect(features.label).toContain('摸板未封');
  });

  it('虚拟价没到过涨停价、或最终就封在涨停价时都不算「摸板未封」', () => {
    const neverTouched = summarizeAuctionMinute(
      '001216',
      19.88,
      parseAuctionMinuteTrends(HUACI_TRENDS),
      22.5, // 涨停价高于竞价过程中的最高虚拟价
    )!;
    expect(neverTouched.features.touchedLimitUp).toBe(false);
    expect(neverTouched.features.label).not.toContain('摸板未封');

    const sealed = summarizeAuctionMinute(
      '001216',
      19.88,
      parseAuctionMinuteTrends([
        '2026-09-18 09:16,21.87,21.87,21.87,21.87,0,0.00,19.880,67864,0.00,0',
        '2026-09-18 09:24,21.87,21.87,21.87,21.87,0,0.00,19.880,16138,0.00,0',
        '2026-09-18 09:26,21.87,21.87,21.87,21.87,34669,75800000.00,21.870,0,0.00,34669',
      ]),
      21.87, // 最终就封在涨停价 → 已封板，不算摸板未封
    )!;
    expect(sealed.features.touchedLimitUp).toBe(false);
    expect(sealed.features.label).not.toContain('摸板未封');
  });

  it('拿不到涨停价时 touchedLimitUp 为 null，而不是猜成 false', () => {
    const { features } = summarize();

    expect(features.touchedLimitUp).toBeNull();
  });
});

describe('fetchAuctionMinutes', () => {
  const jsonResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response;

  it('请求里不能带 iscr / ndays，fields1 只能是 f1,f2（否则上游裁掉竞价段）', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return jsonResponse({ data: { prePrice: 19.88, trends: HUACI_TRENDS } });
    }) as unknown as typeof fetch;

    const result = await fetchAuctionMinutes(['001216'], fetchImpl);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('fields1=f1%2Cf2');
    expect(urls[0]).toContain('secid=0.001216');
    expect(urls[0]).not.toContain('iscr');
    expect(urls[0]).not.toContain('ndays');
    expect(result.get('001216')?.features.label).toContain('竞价走高');
  });

  it('上游失败 / 非 JSON 时该票直接缺失，不影响其它票', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes('001216')) {
        throw new Error('boom');
      }
      return jsonResponse({ data: { prePrice: 19.88, trends: HUACI_TRENDS } });
    }) as unknown as typeof fetch;

    const result = await fetchAuctionMinutes(['001216', '000920'], fetchImpl);

    expect(result.has('001216')).toBe(false);
    expect(result.has('000920')).toBe(true);
  });

  it('没有竞价成交的票不进结果表', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: {
          prePrice: 10,
          trends: ['2026-09-18 09:16,10.00,10.00,10.00,10.00,0,0.00,10.000,0,0.00,0'],
        },
      })) as unknown as typeof fetch;

    const result = await fetchAuctionMinutes(['000001'], fetchImpl);

    expect(result.size).toBe(0);
  });

  it('空输入不打上游', async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;

    expect((await fetchAuctionMinutes([], fetchImpl)).size).toBe(0);
    expect(called).toBe(0);
  });
});
