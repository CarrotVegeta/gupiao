import { describe, expect, it } from 'vitest';
import type { KlineBar } from './tenjqka.js';
import { alignBars, computeStockMetrics, tradingDayDiff } from './metrics.js';

/**
 * 造一段**只含交易日（跳过周末）**的日K。
 * 之所以跳过周末：`alignBars` 会按截止日筛掉未来日期，若夹具里混入周末，
 * 按 index 定位的假设就会整体错位。
 */
const weekdays = (count: number, startDate = '20250801'): string[] => {
  const result: string[] = [];
  let cursor = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(4, 6)) - 1,
    Number(startDate.slice(6, 8)),
  );
  while (result.length < count) {
    const date = new Date(cursor);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      result.push(
        `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
          date.getUTCDate(),
        ).padStart(2, '0')}`,
      );
    }
    cursor += 86_400_000;
  }
  return result;
};

const buildBars = (
  count: number,
  options: {
    startDate?: string;
    closes?: (index: number) => number;
    volumes?: (index: number) => number;
    amounts?: (index: number) => number;
    openAboveClose?: boolean;
  } = {},
): KlineBar[] =>
  weekdays(count, options.startDate).map((date, index) => {
    const close = options.closes ? options.closes(index) : 10;
    const open = options.openAboveClose ? close + 0.5 : close * 0.995;
    return {
      date,
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      volume: options.volumes ? options.volumes(index) : 1_000_000,
      amount: options.amounts ? options.amounts(index) : 1e8,
      turnoverRate: 5,
    } satisfies KlineBar;
  });

describe('alignBars', () => {
  it('按截止日截断，未给出截止日时全部保留', () => {
    const bars = buildBars(5, { startDate: '20260101' });
    // 20260101=周四，其后是周五、周一、周二、周三
    expect(bars.map((bar) => bar.date)).toEqual([
      '20260101',
      '20260102',
      '20260105',
      '20260106',
      '20260107',
    ]);
    expect(alignBars(bars, '20260106')).toHaveLength(4);
    expect(alignBars(bars, null)).toHaveLength(5);
  });

  it('乱序与重复日期被规范化（按日期升序、同日取后者）', () => {
    const bars = buildBars(3, { startDate: '20260101' });
    const shuffled = [bars[2], bars[0], bars[1], { ...bars[1], close: 99 }];
    const aligned = alignBars(shuffled, null);
    expect(aligned.map((bar) => bar.date)).toEqual(['20260101', '20260102', '20260105']);
    expect(aligned[1].close).toBe(99);
  });
});

describe('tradingDayDiff', () => {
  const tradeDates = ['20260911', '20260914', '20260915', '20260916', '20260917', '20260918'];

  it('按交易日历索引算间隔而不是自然日', () => {
    // 9/11（周五）到 9/14（周一）自然日差 3 天，交易日差 1 天
    expect(tradingDayDiff('20260911', '20260914', tradeDates)).toBe(1);
    expect(tradingDayDiff('20260911', '20260918', tradeDates)).toBe(5);
  });

  it('缺交易日历时返回 null，不猜一个数', () => {
    expect(tradingDayDiff('20260911', '20260918', null)).toBeNull();
    expect(tradingDayDiff('20260911', '20260918', [])).toBeNull();
  });

  it('日期不在日历里返回 null', () => {
    expect(tradingDayDiff('20260912', '20260918', tradeDates)).toBeNull();
  });
});

describe('computeStockMetrics', () => {
  it('历史突破日：不只看最后一根，记录区间内最近一次突破', () => {
    // 25 根横盘，倒数第二根放量突破（收盘创 20 日新高、量 ≥ 前 5 日均量 2 倍）
    const bars = buildBars(25, {
      volumes: (index) => (index === 23 ? 3_000_000 : 1_000_000),
      closes: (index) => (index === 23 ? 12 : 10),
    });
    const metrics = computeStockMetrics(bars, '600001', '测试股');
    expect(metrics.breakout20).toBe(true);
    expect(metrics.ownBreakoutDate).toBe(bars[23].date);
    // 突破日之前 20 根里没有同类突破 → 首次
    expect(metrics.breakoutIsFirst).toBe(true);
  });

  it('区间内更晚的突破优先，且不是首次时如实标记', () => {
    // 22 号（第一个突破日）先放量突破，27 号再次突破且更高
    const bars = buildBars(30, {
      volumes: (index) => (index === 22 || index === 27 ? 3_000_000 : 1_000_000),
      closes: (index) => (index === 22 ? 10.5 : index === 27 ? 12 : 10),
    });
    const metrics = computeStockMetrics(bars, '600001', '测试股');
    expect(metrics.ownBreakoutDate).toBe(bars[27].date);
    expect(metrics.breakoutIsFirst).toBe(false);
  });

  it('横盘没有突破时不瞎报突破日', () => {
    const bars = buildBars(25);
    const metrics = computeStockMetrics(bars, '600001', '测试股');
    expect(metrics.ownBreakoutDate).toBeNull();
    expect(metrics.breakout20).toBe(false);
    expect(metrics.breakoutIsFirst).toBeNull();
  });

  it('涨跌日量能用 close 与前一交易日 close 比较（不是阳线/阴线）', () => {
    // 全部收阴线（open > close）但收盘价逐日上涨：若按旧口径会算成「下跌日」，新口径应无下跌样本
    const bars = buildBars(15, {
      closes: (index) => 10 + index * 0.1,
      volumes: (index) => (index % 2 === 0 ? 2_000_000 : 1_000_000),
      openAboveClose: true,
    });
    const metrics = computeStockMetrics(bars, '600001', '测试股');
    expect(metrics.upDownVolumeRatioByClose).toBeNull();
  });

  it('连续板高度按逐日收盘是否达到涨停价重算', () => {
    // 收盘单调递增：...10, 11, 12.1, 13.31 → 最后 3 天各自相对前收盘都是涨停
    const bars = buildBars(25, {
      closes: (index) => (index <= 21 ? 10 : index === 22 ? 11 : index === 23 ? 12.1 : 13.31),
    });
    const metrics = computeStockMetrics(bars, '600001', '测试股');
    expect(metrics.consecutiveLimitUpDays).toBe(3);
  });

  it('最后一根未完成时整体剔除，不拿半天量与全天均量比较', () => {
    const bars = buildBars(25, { amounts: (index) => (index === 24 ? 1e7 : 1e8) });
    const completed = computeStockMetrics(bars, '600001', '测试股', null, {
      lastBarComplete: false,
    });
    expect(completed.avgAmount5d).toBeCloseTo(1e8, 0);
    expect(completed.tradeDate).toBe(bars[23].date);

    const untrimmed = computeStockMetrics(bars, '600001', '测试股');
    expect(untrimmed.avgAmount5d).toBeLessThan(1e8);
  });

  it('按截止日截断后再算窗口', () => {
    const bars = buildBars(30);
    const metrics = computeStockMetrics(bars, '600001', '测试股', null, {
      asOfTradeDate: bars[24].date,
    });
    expect(metrics.tradeDate).toBe(bars[24].date);
  });

  it('缺少板块日K时相对指标为 null，不填 0', () => {
    const bars = buildBars(30);
    const metrics = computeStockMetrics(bars, '600001', '测试股', null);
    expect(metrics.relativePct5).toBeNull();
    expect(metrics.sectorAdjustedRelative).toBeNull();
  });

  it('板块调整日相对表现需要至少 2 个有效日', () => {
    const bars = buildBars(30);
    // 板块只有 1 天下跌超过 1%（另一天持平）→ 样本不足返回 null
    const sectorOne = buildBars(30, { closes: (index) => (index === 27 || index === 28 ? 9.5 : 10) });
    expect(computeStockMetrics(bars, '600001', '测试股', sectorOne).sectorAdjustedRelative).toBeNull();

    // 连续两天板块各跌约 5% → 2 个有效日，个股横盘故相对表现为正
    const sectorTwo = buildBars(30, {
      closes: (index) => (index >= 27 ? (index === 29 ? 9 : 9.5) : 10),
    });
    const metrics = computeStockMetrics(bars, '600001', '测试股', sectorTwo);
    expect(metrics.sectorAdjustedRelative).not.toBeNull();
    expect(metrics.sectorAdjustedRelative ?? 0).toBeGreaterThan(0);
    expect(metrics.relativePct5 ?? 0).toBeGreaterThan(0);
  });

  it('距锚点的交易日间隔只在有日历时才成立', () => {
    const bars = buildBars(30);
    const tradeDates = bars.map((bar) => bar.date);
    const metrics = computeStockMetrics(bars, '600001', '测试股', null, {
      tradeDates,
      anchorDate: bars[25].date,
    });
    expect(metrics.tradingDaysSince).toBe(4);
  });

  it('K线不足 21 根时全部返回缺失', () => {
    const metrics = computeStockMetrics(buildBars(10), '600001', '测试股');
    expect(metrics.ma5).toBeNull();
    expect(metrics.avgAmount5d).toBeNull();
    expect(metrics.limitUpIn20d).toBeNull();
  });
});
