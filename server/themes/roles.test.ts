import { describe, expect, it } from 'vitest';
import { daysBetween, judgeRole, ROLE_LABELS, type RoleStockInput } from './roles.js';

const build = (overrides: Partial<RoleStockInput> = {}): RoleStockInput => ({
  symbol: '600001',
  name: '测试股',
  inLimitUpPool: true,
  boardCount: 3,
  firstSealTime: '09:35:00',
  lastSealTime: '14:30:00',
  sealType: '换手板',
  openCount: 1,
  sealAmount: 8e7,
  turnoverRate: 15,
  amount: 8e8,
  floatMarketCap: 120e8,
  reasonTags: ['量产', '订单'],
  precise: true,
  isSt: false,
  risksChecked: true,
  risks: [],
  startRankInSector: 1,
  boardRankInSector: 1,
  followersAfterFirstSeal: 3,
  leaderTags: ['量产', '订单'],
  ma5: 10,
  ma10: 9.5,
  ma20: 9,
  distMa5: 2,
  distMa10: 5,
  stableDays10: 8,
  pct10: 12,
  pct20: 18,
  sectorPct20: 40,
  avgAmount3d: 8e8,
  avgAmount5d: 8e8,
  upDownVolumeRatio: 1.4,
  limitUpIn20d: 2,
  limitUpIn60d: 3,
  breakout20: true,
  breakout60: true,
  ownBreakoutDate: '20260910',
  leaderFirstSealDate: '20260907',
  resilientOnSectorDown: true,
  ...overrides,
});

describe('daysBetween', () => {
  it('计算两个 YYYYMMDD 的自然日差', () => {
    expect(daysBetween('20260907', '20260910')).toBe(3);
    expect(daysBetween('20260910', '20260907')).toBe(-3);
  });

  it('缺任一端或格式不对返回 null', () => {
    expect(daysBetween(null, '20260910')).toBeNull();
    expect(daysBetween('2026-09-07', '20260910')).toBeNull();
  });
});

describe('ROLE_LABELS', () => {
  it('四个标签名与需求一致', () => {
    expect(ROLE_LABELS.leader).toBe('主线龙头');
    expect(ROLE_LABELS.turnover).toBe('主线换手核心');
    expect(ROLE_LABELS.trend).toBe('主线趋势中军');
    expect(ROLE_LABELS.laggard).toBe('主线低位补涨');
  });
});

describe('judgeRole - 主线龙头', () => {
  it('全部条件齐备时只产出命中项', () => {
    const { hits, misses } = judgeRole('leader', build());
    expect(misses).toEqual([]);
    expect(hits.some((item) => item.includes('启动'))).toBe(true);
    expect(hits.some((item) => item.includes('带动作用'))).toBe(true);
  });

  it('最高板但没有板块号召力时，带动作用记为未确认而不是命中', () => {
    const { hits, misses } = judgeRole(
      'leader',
      build({ followersAfterFirstSeal: 0, startRankInSector: 9, boardRankInSector: 1 }),
    );
    expect(hits.some((item) => item.includes('带动作用'))).toBe(false);
    expect(misses.some((item) => item.includes('带动作用未确认'))).toBe(true);
  });

  it('减持 / 业绩风险进入 misses', () => {
    const { misses } = judgeRole('leader', build({ risks: ['近 3 月有减持公告'] }));
    expect(misses.some((item) => item.includes('减持'))).toBe(true);
  });

  it('封板时间晚于 10:00 不命中', () => {
    const { misses } = judgeRole('leader', build({ firstSealTime: '10:30:00' }));
    expect(misses.some((item) => item.includes('首封时间偏晚'))).toBe(true);
  });
});

describe('judgeRole - 主线换手核心', () => {
  it('全部条件齐备时只缺「次日竞价」这一条待验证项', () => {
    const { misses } = judgeRole('turnover', build());
    expect(misses).toHaveLength(1);
    expect(misses[0]).toContain('待次日验证');
  });

  it('换手率超出 8%~25% 不命中', () => {
    const { misses } = judgeRole('turnover', build({ turnoverRate: 32 }));
    expect(misses.some((item) => item.includes('8%~25%'))).toBe(true);
  });

  it('一字板不命中', () => {
    const { misses } = judgeRole('turnover', build({ sealType: '一字板' }));
    expect(misses.some((item) => item.includes('一字板'))).toBe(true);
  });

  it('近 3 日成交额不到 5 亿不命中', () => {
    const { misses } = judgeRole('turnover', build({ avgAmount3d: 3e8 }));
    expect(misses.some((item) => item.includes('>5 亿'))).toBe(true);
  });
});

describe('judgeRole - 主线趋势中军', () => {
  it('均线多头不进硬条件：命中与未命中里都不出现 MA5>MA10>MA20', () => {
    const bull = judgeRole('trend', build({ ma5: 12, ma10: 11, ma20: 10 }));
    const bear = judgeRole('trend', build({ ma5: 8, ma10: 9, ma20: 10 }));
    const joined = [...bull.hits, ...bull.misses].join(' ');
    expect(joined).not.toContain('MA5');
    expect(joined).not.toContain('均线多头');
    // 均线排列不同不应该改变判定结果
    expect(bull.hits).toEqual(bear.hits);
    expect(bull.misses).toEqual(bear.misses);
  });

  it('创业板不命中「沪深主板」这一条', () => {
    const { misses } = judgeRole('trend', build({ symbol: '300001' }));
    expect(misses.some((item) => item.includes('非沪深主板'))).toBe(true);
  });

  it('ST 不命中', () => {
    const { misses } = judgeRole('trend', build({ isSt: true }));
    expect(misses.some((item) => item.includes('ST'))).toBe(true);
  });

  it('10 日内站上 5 日线不足 7 天不命中', () => {
    const { misses } = judgeRole('trend', build({ stableDays10: 5 }));
    expect(misses.some((item) => item.includes('≥7'))).toBe(true);
  });

  it('近 10 日涨幅超出 5%~25% 不命中', () => {
    expect(judgeRole('trend', build({ pct10: 2 })).misses.some((i) => i.includes('5%~25%'))).toBe(true);
    expect(judgeRole('trend', build({ pct10: 40 })).misses.some((i) => i.includes('5%~25%'))).toBe(true);
  });

  it('跌破 10 日线不命中', () => {
    const { misses } = judgeRole('trend', build({ distMa10: -1.2 }));
    expect(misses.some((item) => item.includes('跌破 10 日线'))).toBe(true);
  });
});

describe('judgeRole - 主线低位补涨', () => {
  it('全部条件齐备时没有未命中项', () => {
    // 龙头 20260907 首板，本股 20260910 首次放量突破 → 晚 3 天
    const { misses } = judgeRole('laggard', build());
    expect(misses).toEqual([]);
  });

  it('与龙头没有共同题材标签不命中', () => {
    const { misses } = judgeRole('laggard', build({ reasonTags: ['参股银行'] }));
    expect(misses.some((item) => item.includes('没有共同标签'))).toBe(true);
  });

  it('流通市值超出区间不命中', () => {
    expect(judgeRole('laggard', build({ floatMarketCap: 20e8 })).misses.some((i) => i.includes('50~300 亿'))).toBe(true);
    expect(judgeRole('laggard', build({ floatMarketCap: 900e8 })).misses.some((i) => i.includes('50~300 亿'))).toBe(true);
  });

  it('板块与个股 20 日涨幅差不足 15% 不命中', () => {
    const { misses } = judgeRole('laggard', build({ sectorPct20: 25, pct20: 18 }));
    expect(misses.some((item) => item.includes('≥15%'))).toBe(true);
  });

  it('启动晚于龙头不足 2 天或超过 4 天都不命中', () => {
    expect(
      judgeRole('laggard', build({ ownBreakoutDate: '20260908' })).misses.some((i) =>
        i.includes('2~4 天'),
      ),
    ).toBe(true);
    expect(
      judgeRole('laggard', build({ ownBreakoutDate: '20260915' })).misses.some((i) =>
        i.includes('2~4 天'),
      ),
    ).toBe(true);
  });

  it('尾盘偷袭（首封 14:30）不命中主动性', () => {
    const { misses } = judgeRole('laggard', build({ firstSealTime: '14:30:00' }));
    expect(misses.some((item) => item.includes('尾盘偷袭'))).toBe(true);
  });
});

describe('judgeRole - 缺数据时的诚实处理', () => {
  it('完全没有行情与日K时，四个标签都给出未命中理由而不是抛错', () => {
    const blank = build({
      inLimitUpPool: false,
      boardCount: null,
      firstSealTime: null,
      lastSealTime: null,
      sealType: null,
      openCount: null,
      sealAmount: null,
      turnoverRate: null,
      amount: null,
      floatMarketCap: null,
      precise: null,
      reasonTags: [],
      leaderTags: [],
      risksChecked: false,
      startRankInSector: null,
      boardRankInSector: null,
      followersAfterFirstSeal: null,
      ma5: null,
      ma10: null,
      ma20: null,
      distMa5: null,
      distMa10: null,
      stableDays10: null,
      pct10: null,
      pct20: null,
      sectorPct20: null,
      avgAmount3d: null,
      avgAmount5d: null,
      upDownVolumeRatio: null,
      limitUpIn20d: null,
      limitUpIn60d: null,
      breakout20: false,
      breakout60: false,
      ownBreakoutDate: null,
      leaderFirstSealDate: null,
      resilientOnSectorDown: null,
    });

    // 只有「代码形态」这类不需要行情就能确定的事实才允许命中；
    // 任何依赖行情 / 日K / 涨停结构的条件都必须落到 misses 里
    const structuralOnly = new Set(['沪深主板且非 ST']);

    for (const role of ['leader', 'turnover', 'trend', 'laggard'] as const) {
      const verdict = judgeRole(role, blank);
      for (const hit of verdict.hits) expect(structuralOnly.has(hit)).toBe(true);
      expect(verdict.misses.length).toBeGreaterThan(0);
    }
  });
});
