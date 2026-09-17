import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  hadRecentLimitUp,
  judgeWatchItem,
  type WatchBar,
} from './check.js';

const bar = (date: string, close: number, volume = 1000): WatchBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  symbol: '600519',
  name: '贵州茅台',
  price: 11,
  preClose: 10,
  open: 10,
  high: 11,
  low: 10,
  pct: 10,
  turnoverRate: 5,
  volumeRatio: 1,
  floatMarketCapYi: 60,
  ...overrides,
});

describe('watch buy-risk verdict', () => {
  it('detects a limit-up inside the recent window', () => {
    const bars = [bar('20260910', 10), bar('20260911', 11), bar('20260914', 11), bar('20260915', 11.5)];
    // 10 → 11 是主板涨停
    expect(hadRecentLimitUp(bars, 10, 3)).toBe(true);
    expect(hadRecentLimitUp(bars, 10, 1)).toBe(false);
  });

  it('computes moving averages from the kline tail', () => {
    const bars = Array.from({ length: 25 }, (_value, index) => bar(`202609${index}`, 10 + index));
    const metrics = computeMetrics(bars, 34, 10);
    expect(metrics.ma5).toBeCloseTo(32, 5);
    expect(metrics.ma20).toBeCloseTo(24.5, 5);
    expect(metrics.distMa20).toBeCloseTo(((34 / 24.5 - 1) * 100), 1);
  });

  it('gives the only positive-expectancy verdict when the stock is sealed', () => {
    const judged = judgeWatchItem(quote({ pct: 10, price: 11, preClose: 10 }), computeMetrics([], null, 10));
    expect(judged.verdict).toBe('edge');
    expect(judged.reasons[0]).toContain('+1.27%');
  });

  it('flags a limit-up in the last 3 days that failed to seal today', () => {
    const bars = [
      ...Array.from({ length: 20 }, (_value, index) => bar(`2026080${index}`, 10)),
      bar('20260910', 11),
      bar('20260911', 11.2),
      bar('20260914', 11),
    ];
    const metrics = computeMetrics(bars, 10.5, 10);
    expect(metrics.hadLimitUpWithin3Days).toBe(true);

    const judged = judgeWatchItem(
      quote({ price: 10.5, preClose: 11, pct: -4.5, open: 10.8, turnoverRate: 8, volumeRatio: 1.1 }),
      metrics,
    );

    expect(judged.verdict).toBe('avoid');
    expect(judged.reasons[0]).toContain('-1.36%');
  });

  it('flags heavy volume without a seal over the 3-day horizon', () => {
    const judged = judgeWatchItem(
      quote({ price: 10.2, preClose: 10, pct: 2, open: 10.1, turnoverRate: 8, volumeRatio: 1.9 }),
      computeMetrics([], 10.2, 10),
    );
    expect(judged.verdict).toBe('caution');
    expect(judged.reasons.join(' ')).toContain('放量');
  });

  it('reports no edge rather than pretending there is a buy signal', () => {
    const judged = judgeWatchItem(
      quote({ price: 10.1, preClose: 10, pct: 1, open: 10.05, turnoverRate: 4, volumeRatio: 1 }),
      computeMetrics([], 10.1, 10),
    );
    expect(judged.verdict).toBe('neutral');
    expect(judged.reasons.join(' ')).toContain('埋伏分');
  });

  it('turns a quiet, small-cap, low-turnover stock into an ambush candidate', () => {
    const bars = [
      ...Array.from({ length: 90 }, (_value, index) => bar(`2026010${index % 10}`, 10)),
    ];
    const metrics = computeMetrics(bars, 10, 10, { turnoverRate: 0.8, floatMarketCapYi: 18 });
    expect(metrics.ambushScore).not.toBeNull();

    const judged = judgeWatchItem(
      quote({ price: 10, preClose: 10, pct: 0, open: 10, turnoverRate: 0.8, volumeRatio: 0.9 }),
      metrics,
    );
    expect(judged.verdict).toBe('edge');
    expect(judged.reasons.join(' ')).toContain('埋伏分');
  });

  it('penalises an over-turned seal', () => {
    const judged = judgeWatchItem(
      quote({ price: 11, preClose: 10, pct: 10, turnoverRate: 29.8, volumeRatio: 1 }),
      computeMetrics([], 11, 10),
    );
    expect(judged.verdict).toBe('avoid');
    expect(judged.reasons[0]).toContain('-2.07%');
  });
});
