import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROTATION_DAYS,
  clsSign,
  fetchClsEmotion,
  fetchClsSectorRotation,
  isRotationDays,
  parseEmotion,
  parseLadder,
  parseRotation,
  summarizeRotation,
} from './cls.js';

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body));

/**
 * 真实响应形状（2026-09-18 实测）：row3[0] 是表头文字「连板率」，
 * 真实连板率从 row3[1] 开始 —— 这个错位是最容易写错的地方。
 */
const emotionPayload = {
  code: 200,
  data: {
    market_degree: 70,
    shsz_balance: '2.08万亿',
    up_ratio: '76.00%',
    up_ratio_num: 78,
    up_open_num: 25,
    up_open_ratio: '62%',
    profit_ratio: '68%',
    performance: '2.81%',
    up_down_dis: { rise_num: 4234, fall_num: 1152 },
    limit_up_board: {
      row1: ['一板', '二板', '三板', '高度板'],
      row2: ['66', '8', '2', '2'],
      row3: ['连板率', '21%', '40%', '50%'],
    },
  },
};

describe('clsSign', () => {
  it('sorts params by key and chains sha1 into md5', () => {
    // 同一组参数、不同插入顺序必须给出同一个签名
    const a = clsSign({ b: '2', a: '1' });
    const b = clsSign({ a: '1', b: '2' });
    expect(a).toBe(b);
    // 对固定输入锁定取值：改了排序或哈希链会立刻失败
    // 算法：sha1("a=1&b=2") 的 hex → md5 → hex
    expect(a).toBe('4e13ecb1934db939e390065a9b63ecd8');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces the live-verified signature for the 财联社 公共参数', () => {
    // 与线上实测值一致：改签名算法会破坏所有财联社接口
    expect(
      clsSign({
        app: 'cailianpress',
        sv: '8.7.4',
        os: 'android',
        mb: 'Xiaomi-2206123SC',
        ov: '32',
        channel: '8',
        motif: '0',
        net: '',
        province_code: '3205',
        token: '',
        uid: '',
      }),
    ).toBe('32ded21a28fa0fdb686f846d9fb714fa');
  });
});

describe('isRotationDays', () => {
  it('only accepts the two windows the upstream supports', () => {
    expect(isRotationDays(4)).toBe(true);
    expect(isRotationDays(30)).toBe(true);
    expect(isRotationDays(15)).toBe(false);
    expect(isRotationDays('30')).toBe(false);
    expect(isRotationDays(null)).toBe(false);
  });
});

describe('parseLadder', () => {
  it('offsets row3 by one so the 连板率 header is not read as 一板 data', () => {
    expect(parseLadder(emotionPayload.data.limit_up_board)).toEqual([
      { key: 'yiban', name: '一板', count: 66, promotionRate: 21 },
      { key: 'erban', name: '二板', count: 8, promotionRate: 40 },
      { key: 'sanban', name: '三板', count: 2, promotionRate: 50 },
      // 高度板没有下一板可晋级，上游不给连板率 → null，不能算成 0
      { key: 'gaoduban', name: '高度板', count: 2, promotionRate: null },
    ]);
  });

  it('returns an empty ladder for malformed input instead of throwing', () => {
    expect(parseLadder(null)).toEqual([]);
    expect(parseLadder({})).toEqual([]);
    expect(parseLadder({ row1: '一板' })).toEqual([]);
  });

  it('falls back to a positional key for unknown 板位 names', () => {
    const rungs = parseLadder({ row1: ['五板'], row2: ['1'], row3: ['连板率', '-'] });
    expect(rungs).toEqual([{ key: 'rung0', name: '五板', count: 1, promotionRate: null }]);
  });
});

describe('parseEmotion', () => {
  it('converts unit-bearing strings into plain numbers', () => {
    const emotion = parseEmotion(emotionPayload, '20260918');
    expect(emotion).not.toBeNull();
    // "2.08万亿" 必须换算成元，否则会被当成 2.08
    expect(emotion?.turnover).toBe(2_080_000_000_000);
    expect(emotion?.sealRate).toBe(76);
    expect(emotion?.openRate).toBe(62);
    expect(emotion?.profitRate).toBe(68);
    expect(emotion?.yesterdayLimitUpPerformance).toBe(2.81);
    expect(emotion?.marketDegree).toBe(70);
    expect(emotion?.status).toBe('fresh');
    expect(emotion?.ladder).toHaveLength(4);
  });

  it('returns null when the upstream reports a non-200 code', () => {
    expect(parseEmotion({ code: 9004, msg: 'not found', data: null }, '20260918')).toBeNull();
    expect(parseEmotion(null, '20260918')).toBeNull();
    expect(parseEmotion({ code: 200, data: 'nope' }, '20260918')).toBeNull();
  });

  it('keeps missing metrics as null rather than 0', () => {
    const emotion = parseEmotion({ code: 200, data: { market_degree: '-' } }, '20260918');
    expect(emotion?.marketDegree).toBeNull();
    expect(emotion?.sealRate).toBeNull();
    expect(emotion?.ladder).toEqual([]);
  });
});

describe('summarizeRotation', () => {
  it('aggregates appearances, max change and first/last seen per plate', () => {
    const items = summarizeRotation([
      { tradeDate: '20260916', plates: [{ plateCode: 'cls1', plateName: '芯片', change: 2 }] },
      { tradeDate: '20260917', plates: [{ plateCode: 'cls2', plateName: '医药', change: 5 }] },
      {
        tradeDate: '20260918',
        plates: [
          { plateCode: 'cls1', plateName: '芯片', change: 4.5 },
          { plateCode: 'cls2', plateName: '医药', change: 1 },
        ],
      },
    ]);

    // 两个板块都上榜 2 次、最近一次都是 20260918 → 按最近涨幅降序：芯片 4.5% > 医药 1%
    expect(items.map((item) => item.plateCode)).toEqual(['cls1', 'cls2']);

    const chip = items.find((item) => item.plateCode === 'cls1');
    expect(chip).toMatchObject({
      appearCount: 2,
      latestChange: 4.5,
      maxChange: 4.5,
      avgChange: 3.25,
      firstSeen: '20260916',
      lastSeen: '20260918',
      days: ['20260916', '20260918'],
    });
  });

  it('ranks a more recently seen plate above an equally frequent but staler one', () => {
    const items = summarizeRotation([
      { tradeDate: '20260910', plates: [{ plateCode: 'old', plateName: '旧', change: 9 }] },
      { tradeDate: '20260911', plates: [{ plateCode: 'old', plateName: '旧', change: 9 }] },
      { tradeDate: '20260917', plates: [{ plateCode: 'new', plateName: '新', change: 1 }] },
      { tradeDate: '20260918', plates: [{ plateCode: 'new', plateName: '新', change: 1 }] },
    ]);

    // 同为 2 次，但 new 最近上榜在 20260918 → 排在 old（20260911）前面
    expect(items.map((item) => item.plateCode)).toEqual(['new', 'old']);
  });

  it('returns an empty list for an empty window', () => {
    expect(summarizeRotation([])).toEqual([]);
  });
});

describe('parseRotation', () => {
  const rotationPayload = {
    code: 200,
    data: [
      {
        trade_date: '2026-09-18',
        plates: [
          { plate_code: 'cls80361', plate_name: '次新股', change: 5.91 },
          { plate_code: 'cls80457', plate_name: '芯片产业链', change: 2.77 },
        ],
      },
      {
        trade_date: '2026-09-17',
        plates: [{ plate_code: 'cls80189', plate_name: '光通信', change: 2.57 }],
      },
    ],
  };

  it('normalizes dashed dates and sorts days ascending', () => {
    const parsed = parseRotation(rotationPayload);
    expect(parsed?.tradeDates).toEqual(['20260917', '20260918']);
    expect(parsed?.items).toHaveLength(3);
  });
  it('treats the unsupported-days reply as no data instead of an empty-but-fresh window', () => {
    // 上游对 days=15 会回 {days: "支持 4/30"}，data 不是数组
    expect(parseRotation({ code: 200, data: { days: '支持 4/30' } })).toBeNull();
    expect(parseRotation({ code: 9004, data: null })).toBeNull();
    expect(parseRotation({ code: 200, data: [] })).toBeNull();
  });

  it('skips rows without a usable date, plate code or change', () => {
    const parsed = parseRotation(
      {
        code: 200,
        data: [
          { trade_date: 'not-a-date', plates: [{ plate_code: 'x', plate_name: 'x', change: 1 }] },
          { trade_date: '20260918', plates: [{ plate_code: '', plate_name: 'x', change: 1 }] },
          { trade_date: '20260918', plates: [{ plate_code: 'cls1', plate_name: 'ok', change: null }] },
          { trade_date: '20260918', plates: [{ plate_code: 'cls2', plate_name: 'ok', change: 3 }] },
        ],
      },
    );
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.plateCode).toBe('cls2');
  });
});

describe('fetchClsSectorRotation', () => {
  it('requests the supported window and reports fresh data', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: 200,
        data: [
          { trade_date: '2026-09-18', plates: [{ plate_code: 'c', plate_name: 'n', change: 1 }] },
        ],
      }),
    );

    const result = await fetchClsSectorRotation(DEFAULT_ROTATION_DAYS, fetchImpl);
    expect(result.status).toBe('fresh');
    expect(result.days).toBe(30);
    expect(result.items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('days=30');
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('sign=');
  });

  it('degrades to unavailable when the upstream is unreachable or unsupported', async () => {
    const failing = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    const failed = await fetchClsSectorRotation(30, failing);
    expect(failed.status).toBe('unavailable');
    expect(failed.items).toEqual([]);
    expect(failed.tradeDates).toEqual([]);
    expect(failed.error).not.toBeNull();

    const unsupported = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: 200, data: { days: '支持 4/30' } }));
    const skipped = await fetchClsSectorRotation(30, unsupported);
    expect(skipped.status).toBe('unavailable');
  });
});

describe('fetchClsEmotion', () => {
  it('returns the parsed emotion on success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(emotionPayload));
    const emotion = await fetchClsEmotion('20260918', fetchImpl);
    expect(emotion?.sealRate).toBe(76);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/v2/quote/a/stock/emotion');
  });

  it('returns null when the request fails so the caller can keep breadth alone', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('boom'));
    await expect(fetchClsEmotion('20260918', fetchImpl)).resolves.toBeNull();
  });
});
