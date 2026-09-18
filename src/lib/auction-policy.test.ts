import { describe, expect, it } from 'vitest';
import { AUCTION_POLICY, evaluateAuctionQualification } from './auction-policy';

describe('竞价合格判定（只两条）', () => {
  it('两个条件都满足才合格', () => {
    expect(evaluateAuctionQualification(4, 6).result).toBe('qualified');
  });

  it('区间边界都算合格', () => {
    expect(evaluateAuctionQualification(AUCTION_POLICY.gapMinPct, AUCTION_POLICY.ratioMinPct).result).toBe('qualified');
    expect(evaluateAuctionQualification(AUCTION_POLICY.gapMaxPct, AUCTION_POLICY.ratioMinPct).result).toBe('qualified');
  });

  it('高开幅度越界就不合格，量比再大也不算', () => {
    expect(evaluateAuctionQualification(1.9, 50).result).toBe('unqualified');
    expect(evaluateAuctionQualification(6.1, 50).result).toBe('unqualified');
    expect(evaluateAuctionQualification(-3, 50).result).toBe('unqualified');
  });

  it('量比不够就不合格，高开幅度再合适也不算', () => {
    expect(evaluateAuctionQualification(4, 4.99).result).toBe('unqualified');
    expect(evaluateAuctionQualification(4, 0).result).toBe('unqualified');
  });

  it('量比达到爆量档仍算合格，只是多一个标记', () => {
    const result = evaluateAuctionQualification(4, AUCTION_POLICY.ratioHeavyPct);
    expect(result.result).toBe('qualified');
    expect(result.heavyVolume).toBe(true);
    expect(result.reasons[1]).toContain('爆量');
  });

  it('缺任一输入都判数据不足，并说明缺哪一项', () => {
    expect(evaluateAuctionQualification(null, 6)).toMatchObject({ result: 'insufficient', heavyVolume: false });
    expect(evaluateAuctionQualification(null, 6).reasons[0]).toContain('竞价涨幅');
    expect(evaluateAuctionQualification(4, null).reasons[0]).toContain('竞价量比');
    expect(evaluateAuctionQualification(null, null).reasons[0]).toContain('竞价涨幅、竞价量比');
    expect(evaluateAuctionQualification(Number.NaN, 6).result).toBe('insufficient');
  });

  it('依据里写明两个条件各自过没过', () => {
    const pass = evaluateAuctionQualification(4, 6);
    expect(pass.reasons[0]).toContain('在');
    expect(pass.reasons[1]).toContain('达到');

    const fail = evaluateAuctionQualification(8, 1);
    expect(fail.reasons[0]).toContain('不在');
    expect(fail.reasons[1]).toContain('低于');
  });

  it('阈值本身保持区间有效', () => {
    expect(AUCTION_POLICY.gapMinPct).toBeLessThan(AUCTION_POLICY.gapMaxPct);
    expect(AUCTION_POLICY.ratioHeavyPct).toBeGreaterThanOrEqual(AUCTION_POLICY.ratioMinPct);
  });
});
