import { describe, expect, it } from 'vitest';
import {
  AMOUNT_EXPAND_RATIO,
  classifyTheme,
  computeDurationDays,
  DURATION_DAILY_FLOOR,
  hasRevival,
  parseHighDays,
  toThemeItem,
  type ThemeClassifyInput,
  type ThemeLimitUpRow,
} from './classify.js';

const row = (
  symbol: string,
  boardCount: number | null,
  firstSealTime: string | null,
  reasonTags: string[] = [],
): ThemeLimitUpRow => ({
  symbol,
  name: `股票${symbol}`,
  boardCount,
  firstSealTime,
  reasonTags,
});

/** 一个「标准主线」输入：8 项全中 */
const buildMainInput = (overrides: Partial<ThemeClassifyInput> = {}): ThemeClassifyInput => ({
  code: 'BK0900',
  name: '新能源车',
  pct: 3.2,
  limitUpRows: [
    row('600001', 4, '09:32:00', ['量产', '订单']),
    row('600002', 2, '09:41:00', ['量产']),
    row('600003', 1, '10:05:00', ['订单']),
    row('600004', 1, '10:20:00', ['政策']),
    row('600005', 1, '13:10:00', ['半年报增长']),
  ],
  amounts: [400e8, 300e8, 320e8, 350e8, 380e8, 500e8],
  marketAmount: 20_000e8,
  indexPct: 0.5,
  // 既满足「连续 ≥3 天」，又含一个「分歧后回升」
  historyCounts: [6, 3, 8, 7, 5],
  ...overrides,
});

describe('parseHighDays', () => {
  it('解析「8天5板」', () => {
    expect(parseHighDays('8天5板')).toBe(5);
  });

  it('解析「3天2板」', () => {
    expect(parseHighDays('3天2板')).toBe(2);
  });

  it('无「板」字返回 null', () => {
    expect(parseHighDays('首板')).toBeNull();
    expect(parseHighDays(null)).toBeNull();
    expect(parseHighDays('')).toBeNull();
  });
});

describe('computeDurationDays', () => {
  it('从今天往回数连续满足下限的天数', () => {
    expect(computeDurationDays([5, 6, 4, 3, 1])).toBe(4);
  });

  it('今天不到下限则为 0', () => {
    expect(computeDurationDays([1, 9, 9])).toBe(0);
  });

  it('空数组为 0', () => {
    expect(computeDurationDays([])).toBe(0);
  });

  it('刚好等于下限算命中', () => {
    expect(computeDurationDays([DURATION_DAILY_FLOOR, DURATION_DAILY_FLOOR])).toBe(2);
  });
});

describe('hasRevival', () => {
  it('分歧日腰斩后回升算回流', () => {
    // 今天 6，昨天 3（相比前天 8 腰斩），更近的一天回到 6 ≥ 3*1.5
    expect(hasRevival([6, 3, 8, 7, 5])).toBe(true);
  });

  it('一路衰减不算回流', () => {
    expect(hasRevival([1, 2, 5, 8, 9])).toBe(false);
  });

  it('没有分歧日不算回流', () => {
    expect(hasRevival([6, 6, 6, 6, 6])).toBe(false);
  });
});

describe('classifyTheme', () => {
  it('满足全部指标判为主线', () => {
    const result = classifyTheme(buildMainInput());
    expect(result.kind).toBe('main');
    expect(result.score).toBe(8);
    expect(result.limitUpCount).toBe(5);
    expect(result.maxBoard).toBe(4);
    expect(result.continuousCount).toBe(2);
    expect(result.durationDays).toBe(5);
  });

  it('涨停家数不到 5 只时即使 8 项全中也不是主线', () => {
    const input = buildMainInput({
      limitUpRows: [
        row('600001', 4, '09:32:00', ['量产']),
        row('600002', 2, '09:41:00', ['量产']),
        row('600003', 1, '10:05:00', ['订单']),
        row('600004', 1, '10:20:00', ['政策']),
      ],
    });
    const result = classifyTheme(input);
    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.kind).toBe('branch');
  });

  it('涨停家数够但命中项不足 5 时算支线（不硬算成主线）', () => {
    const input = buildMainInput({
      pct: -2,
      indexPct: 1,
      amounts: [500e8, 500e8, 500e8, 500e8, 500e8, 400e8],
      historyCounts: [6, 1, 0],
      limitUpRows: [
        row('600001', 1, '14:50:00', ['传闻']),
        row('600002', 1, '14:52:00', ['传闻']),
        row('600003', 1, '14:53:00'),
        row('600004', 1, '14:55:00'),
        row('600005', 1, '14:56:00'),
      ],
    });
    const result = classifyTheme(input);
    expect(result.score).toBeLessThan(5);
    expect(result.kind).toBe('branch');
  });

  it('涨停家数少于 2 只不归类', () => {
    const result = classifyTheme(buildMainInput({ limitUpRows: [row('600001', 1, '09:35:00')] }));
    expect(result.kind).toBeNull();
    expect(toThemeItem(buildMainInput({ limitUpRows: [row('600001', 1, '09:35:00')] }))).toBeNull();
  });

  it('成交额未放大时该指标不命中', () => {
    const input = buildMainInput({
      amounts: [400e8, 410e8, 400e8, 405e8, 400e8, 400e8],
    });
    const result = classifyTheme(input);
    const metric = result.metrics.find((item) => item.key === 'amount');
    expect(metric?.hit).toBe(false);
    expect(metric?.detail).toContain(String(AMOUNT_EXPAND_RATIO));
  });

  it('单一消息型涨停原因不算强催化', () => {
    const input = buildMainInput({
      limitUpRows: [
        row('600001', 4, '09:32:00', ['股东重组']),
        row('600002', 2, '09:41:00', ['股东重组']),
        row('600003', 1, '10:05:00', ['股东重组']),
        row('600004', 1, '10:20:00', ['股东重组']),
        row('600005', 1, '13:10:00', ['股东重组']),
      ],
    });
    const metric = classifyTheme(input).metrics.find((item) => item.key === 'catalyst');
    expect(metric?.hit).toBe(false);
  });

  it('龙头取最高板，同板取首封更早的', () => {
    const result = classifyTheme(
      buildMainInput({
        limitUpRows: [
          row('600001', 3, '10:30:00'),
          row('600002', 3, '09:35:00'),
          row('600003', 1, '11:00:00'),
        ],
      }),
    );
    expect(result.leader?.symbol).toBe('600002');
  });

  it('每个指标都带 value 与 detail，便于页面逐项展示', () => {
    const result = classifyTheme(buildMainInput());
    expect(result.metrics).toHaveLength(8);
    for (const metric of result.metrics) {
      expect(metric.value).not.toBe('');
      expect(metric.detail).not.toBe('');
      expect(typeof metric.hit).toBe('boolean');
    }
  });

  it('toThemeItem 组装字段完整', () => {
    const item = toThemeItem(buildMainInput());
    expect(item).not.toBeNull();
    expect(item?.code).toBe('BK0900');
    expect(item?.name).toBe('新能源车');
    expect(item?.kind).toBe('main');
    expect(item?.amount).toBe(500e8);
    expect(item?.amountRatio).toBeCloseTo(2.5, 4);
    expect(item?.leader?.symbol).toBe('600001');
  });
});
