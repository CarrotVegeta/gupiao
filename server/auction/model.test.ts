import { describe, expect, it } from 'vitest';
import { isSealedAtAuction, limitUpPct, predictLimitUpProbability, toProbabilityTier } from './model.js';

const base = {
  gapPct: 5, board: 2, previousOneWord: false, previousTurnover: 8,
  floatMarketCapYi: 50, previousLimitUpCount: 100, previousBrokenCount: 20, indexGapPct: 0,
  limitPct: 10, sealedAtAuction: false,
};

describe('竞价分组模型与价格边界', () => {
  it('创业板和科创板的ST仍按20%，只对主板ST使用5%', () => {
    expect(limitUpPct('688033', '*ST天宜')).toBe(20);
    expect(limitUpPct('300000', 'ST样本')).toBe(20);
    expect(limitUpPct('600000', 'ST样本')).toBe(5);
  });
  it('同等相对涨停幅度获得相同强度，不把20%板的高开当作10%板', () => {
    const main = predictLimitUpProbability(base);
    const growth = predictLimitUpProbability({ ...base, gapPct: 10, limitPct: 20 });
    expect(main.probability).toBeCloseTo(growth.probability, 12);
  });

  it('已封板和未封板使用各自的模型', () => {
    const open = predictLimitUpProbability({ ...base, gapPct: 10 });
    const sealed = predictLimitUpProbability({ ...base, gapPct: 10, sealedAtAuction: true });
    expect(open.probability).not.toBe(sealed.probability);
  });

  it('不使用旧训练集里口径错误的大盘及重建市场家数', () => {
    expect(predictLimitUpProbability(base).probability).toBe(
      predictLimitUpProbability({ ...base, indexGapPct: 9, previousLimitUpCount: 500, previousBrokenCount: 300 }).probability,
    );
  });

  it('近涨停但差一分钱仍属未封板，低价股按分币涨停价判定', () => {
    expect(isSealedAtAuction('600000', '样本', 10.99, 10)).toBe(false);
    expect(isSealedAtAuction('600000', '样本', 11, 10)).toBe(true);
    expect(isSealedAtAuction('000001', '样本', 2.88, 2.63)).toBe(false);
    expect(isSealedAtAuction('000001', '样本', 2.89, 2.63)).toBe(true);
    expect(isSealedAtAuction('920001', '样本', 13, 10)).toBe(true);
    expect(isSealedAtAuction('600000', '样本', 11, null)).toBeNull();
  });

  it('分档使用新模型阈值，边界保持一致', () => {
    expect(toProbabilityTier(0.4)).toBe('qualified');
    expect(toProbabilityTier(0.3999)).toBe('watch');
    expect(toProbabilityTier(0.3)).toBe('watch');
    expect(toProbabilityTier(0.2999)).toBe('unqualified');
  });
});
