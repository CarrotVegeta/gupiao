import { describe, expect, it } from 'vitest';
import type { BoardDay, LadderMember, ScoreConditionKey } from './types.js';
import { annotateStreaks, computeRanks, hitCount, isRepeatBoard, rankBoards, rankOf, TOP_N } from './ranks.js';
import { annotateSpread, extractThemes, isGenericTag, normalizeTag, themeStreak, toThemeKey } from './theme-extract.js';
import { buildLadder, describeLadder } from './ladder.js';
import { buildCapitalReturn, buildContinuity, classifyDay, isEbbing } from './continuity.js';
import { scoreBoard, TIER_LABEL, toTier } from './score.js';
import type { RankInput } from './ranks.js';

// ---------------------------------------------------------------------------
// L1 四榜排名
// ---------------------------------------------------------------------------

describe('computeRanks', () => {
  const rows: RankInput[] = [
    { code: 'A', pct: 3.0, limitUpCount: 18, mainNet: 100, amount: 900 },
    { code: 'B', pct: 2.0, limitUpCount: 16, mainNet: 300, amount: 800 },
    { code: 'C', pct: 1.0, limitUpCount: 18, mainNet: null, amount: 700 },
    { code: 'D', pct: null, limitUpCount: 5, mainNet: -50, amount: 600 },
  ];

  it('降序给名次，并列同名次（比赛排名法）', () => {
    const pct = computeRanks(rows, 'pct');
    expect(pct.get('A')).toBe(1);
    expect(pct.get('B')).toBe(2);
    expect(pct.get('C')).toBe(3);
    // pct 为 null 的 D 不进榜
    expect(pct.has('D')).toBe(false);

    // 涨停家数：A 与 C 都是 18，应并列第 1，B 第 3
    const limitUp = computeRanks(rows, 'limitUp');
    expect(limitUp.get('A')).toBe(1);
    expect(limitUp.get('C')).toBe(1);
    expect(limitUp.get('B')).toBe(3);
  });

  it('null 不参与排名，也不会被当成 0', () => {
    const flow = computeRanks(rows, 'flow');
    expect(flow.get('B')).toBe(1);
    expect(flow.get('A')).toBe(2);
    expect(flow.get('D')).toBe(3);
    expect(flow.has('C')).toBe(false);
  });

  it('整榜不可用时返回空表（不拿别的数字顶）', () => {
    const empty = rows.map((row) => ({ ...row, amount: null }));
    expect(computeRanks(empty, 'amount').size).toBe(0);
  });
});

describe('rankOf / hitCount / repeat', () => {
  const rows: RankInput[] = Array.from({ length: 12 }, (_, index) => ({
    code: `B${index}`,
    pct: 12 - index,
    limitUpCount: 12 - index,
    mainNet: 12 - index,
    amount: 12 - index,
  }));
  const snapshot = rankBoards('20260918', rows);

  it('TopN 之外的榜名次返回 null', () => {
    // 12 个板块 → 门槛 = ceil(12×0.25) = 3
    expect(snapshot.topN).toBe(3);
    expect(rankOf(snapshot, 'B0', 'pct')).toBe(1);
    expect(rankOf(snapshot, 'B2', 'pct')).toBe(3);
    expect(rankOf(snapshot, 'B3', 'pct')).toBeNull();

    // 显式传 topN 可以放宽（四榜表展示用 10）
    expect(rankOf(snapshot, 'B9', 'pct', 10)).toBe(10);
    expect(TOP_N).toBe(10);
  });

  it('门槛按池子大小算：前 25%，上限 10', () => {
    const wide = Array.from({ length: 100 }, (_, index) => ({
      code: `C${index}`,
      pct: 100 - index,
      limitUpCount: 100 - index,
      mainNet: null,
      amount: null,
    }));
    expect(rankBoards('d', wide).topN).toBe(10); // min(10, 25) = 10
    expect(rankBoards('d', rows.slice(0, 4)).topN).toBe(1); // ceil(4×0.25) = 1
  });

  it('上榜广度：默认门槛是展示用的 10，可传 snapshot.topN 用「反复出现」口径', () => {
    // 默认 topN=10：12 个板块里 B0~B9 各榜都进前 10
    expect(hitCount(snapshot, 'B0')).toBe(4);
    expect(hitCount(snapshot, 'B9')).toBe(4);
    // 按池子口径 topN=3：B0~B2 各榜进前 3；B3 各榜第 4
    expect(hitCount(snapshot, 'B0', snapshot.topN)).toBe(4);
    expect(hitCount(snapshot, 'B3', snapshot.topN)).toBe(0);
  });

  it('连续 hit ≥ 2 达到 3 天才算「反复出现」', () => {
    expect(isRepeatBoard([3, 3, 2])).toBe(true);
    expect(isRepeatBoard([3, 3, 1])).toBe(false);
    expect(isRepeatBoard([2, 2, 2])).toBe(true);
    expect(isRepeatBoard([4, 4])).toBe(false);
  });
});

describe('annotateStreaks', () => {
  it('逐日按前缀算连续天数，不引入未来信息', () => {
    // X 第一天各项都排在 TopN 之外（只进 pct 榜的第 11 名 → 其实也不进），第二三天四个榜都进
    const xOn = (date: string): RankInput => ({
      code: 'X',
      pct: date === '20260916' ? 1 : 99,
      limitUpCount: date === '20260916' ? 1 : 99,
      mainNet: date === '20260916' ? 1 : 99,
      amount: date === '20260916' ? 1 : 99,
    });
    // 榜单要有足够多的板块，「前 10」才有意义（只有 2 个板块时个个都在前 10）
    const crowd = (): RankInput[] =>
      Array.from({ length: 12 }, (_, index) => ({
        code: `C${index}`,
        pct: 50 - index,
        limitUpCount: 50 - index,
        mainNet: 50 - index,
        amount: 50 - index,
      }));

    const days = ['20260916', '20260917', '20260918'];
    const snapshots = days.map((date) => rankBoards(date, [xOn(date), ...crowd()]));
    const annotated = annotateStreaks(days.map((date) => xOn(date)), snapshots);

    expect(annotated[0].hit).toBe(0); // 全部落在 TopN 之外
    expect(annotated[0].streakHit).toBe(0);
    expect(annotated[1].hit).toBe(4);
    expect(annotated[1].streakHit).toBe(1);
    expect(annotated[2].streakHit).toBe(2); // 连续两天 hit ≥ 2
  });
});

// ---------------------------------------------------------------------------
// L2 题材提取
// ---------------------------------------------------------------------------

describe('通用词过滤', () => {
  it('业绩/增长/次新/定增 等不构成题材', () => {
    for (const word of ['业绩增长', '半年报增长', '次新股', '定增', '控制权变更', '净利润增长']) {
      expect(isGenericTag(word), word).toBe(true);
      expect(toThemeKey(word), word).toBeNull();
    }
  });

  it('具体逻辑保留', () => {
    for (const word of ['先进封装', '存储芯片', '光通信', '人形机器人', '上海国资']) {
      expect(isGenericTag(word), word).toBe(false);
      expect(toThemeKey(word), word).not.toBeNull();
    }
  });

  it('全角字母数字归一', () => {
    expect(normalizeTag('ＡＩ手机')).toBe('ai手机');
  });
});

describe('同义归一', () => {
  it('半导体存储 / 存储芯片 折成同一个 key', () => {
    expect(toThemeKey('存储芯片')).toBe('存储');
    expect(toThemeKey('半导体存储')).toBe('存储');
    expect(toThemeKey('高带宽内存')).toBe('存储');
  });

  it('芯片扩产 / 产能扩张 折成同一个 key', () => {
    expect(toThemeKey('芯片扩产')).toBe('芯片扩产');
    expect(toThemeKey('产能扩张')).toBe('芯片扩产');
  });

  it('先进封装 / 半导体封测 折成同一个 key', () => {
    expect(toThemeKey('先进封装')).toBe('先进封装');
    expect(toThemeKey('半导体封测')).toBe('先进封装');
  });
});

describe('extractThemes（用 2026-09-18 国产芯片真实样本）', () => {
  // 实测：10 只严格涨停股，原始标签如下
  const members = [
    { symbol: '301583', name: '托伦斯', boardCount: 1, highLabel: '首板', reasonTags: ['半导体设备', '精密零部件', '存储芯片', '次新股'] },
    { symbol: '002453', name: '华软科技', boardCount: 2, highLabel: '2天2板', reasonTags: ['光引发剂', '并购莱恩光电', '造纸化学品'] },
    { symbol: '603353', name: '和顺石油', boardCount: 2, highLabel: '4天2板', reasonTags: ['半导体IP', '奎芯科技', '成品油', '业绩增长'] },
    { symbol: '603120', name: '肯特催化', boardCount: 1, highLabel: '首板', reasonTags: ['光刻胶', '电子化学品', '相转移催化剂'] },
    { symbol: '603316', name: '诚邦股份', boardCount: 1, highLabel: '首板', reasonTags: ['半导体存储', '芯片扩产', '业绩增长'] },
    { symbol: '603068', name: '博通集成', boardCount: 1, highLabel: '首板', reasonTags: ['无线芯片', '端侧AI', '业绩增长'] },
    { symbol: '002185', name: '华天科技', boardCount: 1, highLabel: '首板', reasonTags: ['半导体封测', '先进封装', '拟收购华羿微电'] },
    { symbol: '603232', name: '格尔软件', boardCount: 1, highLabel: '首板', reasonTags: ['AI安全', '抗量子密码', 'PKI安全'] },
    { symbol: '603375', name: '盛景微', boardCount: 1, highLabel: '首板', reasonTags: ['模拟芯片', '电子雷管', '低空经济'] },
    { symbol: '601026', name: '道生天合', boardCount: 1, highLabel: '首板', reasonTags: ['次新股', '环氧塑封材料', '封装材料', '海外风电'] },
  ];

  const themes = extractThemes(members);

  it('通用词被剔除，不进题材', () => {
    const keys = themes.map((theme) => theme.key);
    expect(keys).not.toContain('次新');
    expect(keys).not.toContain('业绩增长');
    expect(keys).not.toContain('净利润增长');
  });

  it('不足 2 家的不成题', () => {
    // 「无线芯片」「AI安全」「光引发剂」各 1 家，不成题
    const keys = themes.map((theme) => theme.key);
    expect(keys).not.toContain('无线芯片');
    expect(keys).not.toContain('光引发剂');
  });

  it('归一后 存储 成题（托伦斯 + 诚邦股份）', () => {
    const byKey = new Map(themes.map((theme) => [theme.key, theme]));
    // 「存储芯片」（托伦斯）+「半导体存储」（诚邦股份）归一成同一件事
    expect(byKey.get('存储')?.count).toBe(2);
    expect(byKey.get('存储')?.members.map((item) => item.name).sort()).toEqual(['托伦斯', '诚邦股份']);
  });

  it('同一只票的多个同义标签只算一次，所以跨板块才凑得够家数', () => {
    const byKey = new Map(themes.map((theme) => [theme.key, theme]));
    // 华天科技的「半导体封测」与「先进封装」同义 → 归成一个 key，但同一只票只算一次 → 1 家
    // 道生天合的「封装材料」也被归到同一个 key → 合计 2 家，成题
    expect(byKey.get('先进封装')?.count).toBe(2);
    expect(byKey.get('先进封装')?.members.map((item) => item.name).sort()).toEqual(['华天科技', '道生天合']);
    expect([...(byKey.get('先进封装')?.variants ?? [])].sort()).toEqual(['半导体封测', '封装材料'].sort());
  });

  it('同一个 key 下保留原始写法，便于面板展开', () => {
    const cunchu = themes.find((theme) => theme.key === '存储');
    expect([...(cunchu?.variants ?? [])].sort()).toEqual(['存储芯片', '半导体存储'].sort());
  });

  it('排序：家数 → 最高板', () => {
    const counts = themes.map((theme) => theme.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

describe('同一只票同一标签只算一次', () => {
  it('重复标签不会把家数刷高', () => {
    const themes = extractThemes([
      { symbol: '000001', name: 'A', boardCount: 1, highLabel: '首板', reasonTags: ['光通信', '光通信'] },
      { symbol: '000002', name: 'B', boardCount: 1, highLabel: '首板', reasonTags: ['光模块'] },
    ]);
    expect(themes.find((theme) => theme.key === '光通信')?.count).toBe(2);
  });
});

describe('annotateSpread', () => {
  it('跨板块扩散与板块外占比', () => {
    const byBoard = new Map([
      ['BK1', extractThemes([
        { symbol: '1', name: 'a', boardCount: 1, highLabel: '首板', reasonTags: ['先进封装'] },
        { symbol: '2', name: 'b', boardCount: 1, highLabel: '首板', reasonTags: ['先进封装'] },
      ])],
      ['BK2', extractThemes([
        { symbol: '3', name: 'c', boardCount: 1, highLabel: '首板', reasonTags: ['先进封装'] },
        { symbol: '4', name: 'd', boardCount: 1, highLabel: '首板', reasonTags: ['先进封装'] },
      ])],
    ]);
    annotateSpread(byBoard);
    const first = byBoard.get('BK1')?.[0];
    expect(first?.boardSpread).toBe(2);
    expect(first?.outOfBoardRatio).toBe(0.5);
  });
});

describe('themeStreak', () => {
  it('只算末尾连续', () => {
    const history = [new Set(['存储']), new Set(['存储', '算力']), new Set(['存储'])];
    expect(themeStreak(history, '存储')).toBe(3);
    expect(themeStreak(history, '算力')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// L3 阵容
// ---------------------------------------------------------------------------

const member = (over: Partial<LadderMember> & { symbol: string }): LadderMember => ({
  symbol: over.symbol,
  name: over.name ?? over.symbol,
  boardCount: over.boardCount ?? 1,
  highLabel: over.highLabel ?? '首板',
  firstSealTime: over.firstSealTime ?? '09:35:00',
  sealAmount: over.sealAmount ?? null,
  amount: over.amount ?? null,
  floatMarketCap: over.floatMarketCap ?? null,
  turnoverRate: over.turnoverRate ?? null,
  pct: over.pct ?? 10,
  changeTag: over.changeTag ?? null,
  limitUpIn60d: over.limitUpIn60d ?? null,
  isSt: over.isSt ?? false,
  reasonTags: over.reasonTags ?? [],
});

describe('buildLadder', () => {
  it('原方法模板：5 板龙头 + 2 只 2 板 + 6 只首板 + 大成交中军 → 完整梯队', () => {
    const members: LadderMember[] = [
      member({ symbol: '600001', name: '龙头', boardCount: 5, highLabel: '5天5板' }),
      member({ symbol: '600002', boardCount: 2, highLabel: '2天2板' }),
      member({ symbol: '600003', boardCount: 2, highLabel: '2天2板' }),
      ...Array.from({ length: 6 }, (_, index) =>
        member({ symbol: `61000${index}`, boardCount: 1 }),
      ),
      member({ symbol: '600010', name: '中军', boardCount: 1, amount: 1.5e9, floatMarketCap: 5e10, pct: 5 }),
    ];
    const ladder = buildLadder(members);
    expect(ladder.maxBoard).toBe(5);
    expect(ladder.leader?.symbol).toBe('600001');
    expect(ladder.frontRow).toHaveLength(2);
    // 6 只首板；中军单独成档，不重复计进首板
    expect(ladder.firstBoard).toHaveLength(6);
    expect(ladder.core.map((item) => item.symbol)).toEqual(['600010']);
    expect(ladder.full).toBe(true);
    expect(describeLadder(ladder)).toContain('5板龙头×1');
  });

  it('只有一只龙头涨停 → 不算板块行情（梯队不完整）', () => {
    const ladder = buildLadder([member({ symbol: '600001', boardCount: 5, highLabel: '5天5板' })]);
    expect(ladder.full).toBe(false);
    expect(ladder.firstBoard).toHaveLength(0);
  });

  it('中军必须同时满足大成交与大市值（防做假）', () => {
    const ladder = buildLadder([
      member({ symbol: '600001', boardCount: 5, highLabel: '5天5板' }),
      member({ symbol: '600002', boardCount: 2 }),
      member({ symbol: '600003', boardCount: 2 }),
      member({ symbol: '600004' }),
      member({ symbol: '600005' }),
      member({ symbol: '600006' }),
      // 成交额够但市值不够 → 不是中军
      member({ symbol: '600007', amount: 2e9, floatMarketCap: 3e9 }),
      // 市值够但成交额不够 → 不是中军
      member({ symbol: '600008', amount: 1e8, floatMarketCap: 5e10 }),
    ]);
    // 有票带这两项数据 → 中军可判定；但都不达标 → 中军为空
    expect(ladder.coreAvailable).toBe(true);
    expect(ladder.core).toHaveLength(0);
  });

  it('成交额与流通市值缺失时中军按不可判定处理，不输出「没有中军」', () => {
    const ladder = buildLadder([
      member({ symbol: '600001', boardCount: 5, highLabel: '5天5板' }),
      member({ symbol: '600002', boardCount: 2 }),
      member({ symbol: '600003', boardCount: 2 }),
      member({ symbol: '600004' }),
      member({ symbol: '600005' }),
      member({ symbol: '600006' }),
    ]);
    expect(ladder.coreAvailable).toBe(false);
    expect(ladder.coreSupport).toBe(0);
    // 中军不可判定时不因为缺中军把梯队判成不完整
    expect(ladder.full).toBe(true);
  });

  it('炸板率只在有封板类型数据时可判定', () => {
    const noData = buildLadder([member({ symbol: '600001', boardCount: 2 })]);
    expect(noData.breakRateAvailable).toBe(false);
    expect(noData.breakRate).toBeNull();

    const withBreak = buildLadder([
      member({ symbol: '600001', boardCount: 2, changeTag: 'FIRST_LIMIT' }),
      member({ symbol: '600002', boardCount: 1, changeTag: 'FIRST_LIMIT' }),
      member({ symbol: '600003', boardCount: 1, changeTag: 'OPEN_LIMIT' }),
    ]);
    expect(withBreak.breakRateAvailable).toBe(true);
    expect(withBreak.breakRate).toBeCloseTo(1 / 4, 5);
  });

  it('低位补涨需要近 60 日涨停次数', () => {
    const unavailable = buildLadder([member({ symbol: '600001' })]);
    expect(unavailable.laggardAvailable).toBe(false);
    expect(unavailable.laggard).toHaveLength(0);

    const available = buildLadder([
      member({ symbol: '600001', limitUpIn60d: 0 }),
      member({ symbol: '600002', limitUpIn60d: 3 }),
    ]);
    expect(available.laggardAvailable).toBe(true);
    expect(available.laggard.map((item) => item.symbol)).toEqual(['600001']);
  });
});

// ---------------------------------------------------------------------------
// L4 连续性与回流
// ---------------------------------------------------------------------------

describe('classifyDay', () => {
  it('强势日：上涨且涨停 ≥2 家', () => {
    expect(classifyDay({ date: 'd', pct: 2.5, limitUpCount: 10, prevLimitUpCount: 8 })).toBe('strong');
  });

  it('分歧日：跌幅在 −3%~0 且家数明显收缩', () => {
    expect(classifyDay({ date: 'd', pct: -1.5, limitUpCount: 2, prevLimitUpCount: 10 })).toBe('divergence');
    expect(classifyDay({ date: 'd', pct: 0, limitUpCount: 1, prevLimitUpCount: 10 })).toBe('divergence');
  });

  it('跌破 −3% 断链', () => {
    expect(classifyDay({ date: 'd', pct: -4, limitUpCount: 2, prevLimitUpCount: 10 })).toBe('weak');
  });

  it('上涨但家数没跟上 → weak（不断链也不算强势）', () => {
    expect(classifyDay({ date: 'd', pct: 1.2, limitUpCount: 1, prevLimitUpCount: 2 })).toBe('weak');
  });
});

describe('buildContinuity', () => {
  it('分歧日不断链（关键补充）', () => {
    const days = [
      { date: 'd1', pct: 2.0, limitUpCount: 8, prevLimitUpCount: null },
      { date: 'd2', pct: 1.5, limitUpCount: 10, prevLimitUpCount: 8 },
      { date: 'd3', pct: -1.0, limitUpCount: 2, prevLimitUpCount: 10 }, // 分歧
      { date: 'd4', pct: 2.5, limitUpCount: 9, prevLimitUpCount: 2 },
    ];
    const result = buildContinuity(days);
    expect(result.map((item) => item.dayKind)).toEqual(['strong', 'strong', 'divergence', 'strong']);
    expect(result.map((item) => item.streak)).toEqual([1, 2, 2, 3]);
  });

  it('弱势日归零', () => {
    const days = [
      { date: 'd1', pct: 2.0, limitUpCount: 8, prevLimitUpCount: null },
      { date: 'd2', pct: -4.0, limitUpCount: 1, prevLimitUpCount: 8 },
      { date: 'd3', pct: 2.0, limitUpCount: 6, prevLimitUpCount: 1 },
    ];
    expect(buildContinuity(days).map((item) => item.streak)).toEqual([1, 0, 1]);
  });
});

describe('buildCapitalReturn', () => {
  it('分歧后 2 日内回流 → +1，并标出确认日', () => {
    const days = [
      { date: 'd1', pct: 2.0, limitUpCount: 10, prevLimitUpCount: null, mainNet: 1e9 },
      { date: 'd2', pct: -1.2, limitUpCount: 2, prevLimitUpCount: 10, mainNet: 1e8 }, // 分歧
      { date: 'd3', pct: 2.0, limitUpCount: 7, prevLimitUpCount: 2, mainNet: 2e9 },   // 回流
    ];
    const result = buildCapitalReturn(days);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].state).toBe('returned');
    expect(result.events[0].returnedOn).toBe('d3');
    expect(result.days[1].capitalReturn).toBe(0);
    expect(result.days[2].capitalReturn).toBe(1);
    expect(isEbbing(result)).toBe(false);
  });

  it('分歧后第 2 日继续跌破 → 退潮 −1', () => {
    const days = [
      { date: 'd1', pct: 2.0, limitUpCount: 10, prevLimitUpCount: null, mainNet: 1e9 },
      { date: 'd2', pct: -1.0, limitUpCount: 2, prevLimitUpCount: 10, mainNet: 5e7 }, // 分歧
      { date: 'd3', pct: -3.0, limitUpCount: 1, prevLimitUpCount: 2, mainNet: -1e8 },
      { date: 'd4', pct: -4.0, limitUpCount: 0, prevLimitUpCount: 1, mainNet: -2e8 },
    ];
    const result = buildCapitalReturn(days);
    expect(result.events[0].state).toBe('ebb');
    expect(result.days[3].capitalReturn).toBe(-1);
    expect(isEbbing(result)).toBe(true);
  });

  it('分歧日主力净流出 → 不构成分歧事件', () => {
    const days = [
      { date: 'd1', pct: 2.0, limitUpCount: 10, prevLimitUpCount: null, mainNet: 1e9 },
      { date: 'd2', pct: -1.0, limitUpCount: 2, prevLimitUpCount: 10, mainNet: -3e8 },
    ];
    const result = buildCapitalReturn(days);
    expect(result.events).toHaveLength(0);
  });

  it('资金流缺历史时降级标记为 degraded，而不是判成退潮', () => {
    const days = [
      { date: 'd1', pct: 2.0, limitUpCount: 10, prevLimitUpCount: null, mainNet: null },
      { date: 'd2', pct: -1.0, limitUpCount: 2, prevLimitUpCount: 10, mainNet: null },
      { date: 'd3', pct: 2.5, limitUpCount: 8, prevLimitUpCount: 2, mainNet: null },
    ];
    const result = buildCapitalReturn(days);
    expect(result.degraded).toBe(true);
    // 家数恢复到 0.6×10=6 以上，所以仍能确认回流
    expect(result.events[0].state).toBe('returned');
  });
});

// ---------------------------------------------------------------------------
// §6 评分表
// ---------------------------------------------------------------------------

const baseDay = (over: Partial<BoardDay> = {}): BoardDay => ({
  date: '20260918',
  code: '885756',
  name: '芯片概念',
  pct: 2.707,
  limitUpCount: 18,
  continuousCount: 3,
  highLabel: '6天3板',
  maxBoard: 3,
  upstreamDays: 10,
  amount: 9.3748e11,
  mainNet: 1.14e10,
  rank: { pct: 1, limitUp: 1, flow: 1, amount: 1 },
  hit: 4,
  streakHit: 5,
  streakRank: { pct: 3, limitUp: 3, flow: 2, amount: 3 },
  streak: 3,
  dayKind: 'strong',
  capitalReturn: 1,
  ladder: null,
  themes: [],
  judge: null,
  ...over,
});

describe('scoreBoard', () => {
  it('六项命中 + 无扣分 → 市场主线', () => {
    const judge = scoreBoard({
      day: baseDay(),
      marketMaxBoard: 3,
      catalystNote: '国产替代政策持续',
    });
    const byKey = new Map<ScoreConditionKey, number>(
      judge.conditions.map((item) => [item.key, item.score]),
    );
    expect(byKey.get('limitUpTop3')).toBe(2);
    expect(byKey.get('marketHeightBoard')).toBe(2);
    expect(byKey.get('amountTop5')).toBe(2);
    expect(byKey.get('streak3')).toBe(2);
    expect(byKey.get('capitalReturn')).toBe(2);
    expect(byKey.get('catalyst')).toBe(1);
    expect(judge.total).toBe(11);
    expect(judge.tier).toBe('mainline');
    expect(TIER_LABEL[judge.tier]).toBe('市场主线');
  });

  it('退潮触发时即便分数够也不进主线', () => {
    const judge = scoreBoard({
      day: baseDay({ capitalReturn: -1, maxBoard: 1, limitUpCount: 2, streak: 0, dayKind: 'weak' }),
      marketMaxBoard: 5,
      catalystNote: null,
    });
    expect(judge.ebb).toBe(true);
    expect(judge.tier).not.toBe('mainline');
  });

  it('数据缺失记 0 分，但 evidence 说明是不可判定而不是未命中', () => {
    const judge = scoreBoard({
      day: baseDay({
        rank: { pct: null, limitUp: null, flow: null, amount: null },
        amount: null,
        mainNet: null,
      }),
      marketMaxBoard: null,
      catalystNote: null,
    });
    const limitUp = judge.conditions.find((item) => item.key === 'limitUpTop3');
    expect(limitUp?.score).toBe(0);
    expect(limitUp?.evidence).toContain('不可用');
    expect(judge.degraded).toBe(true);
  });

  it('炸板率高扣 2 分', () => {
    const judge = scoreBoard({
      day: baseDay({
        ladder: {
          maxBoard: 3,
          leader: null,
          frontRow: [],
          firstBoard: [],
          laggard: [],
          core: [],
          coreSupport: 0,
          breakRate: 0.5,
          full: false,
          coreAvailable: false,
          laggardAvailable: false,
          breakRateAvailable: true,
        },
      }),
      marketMaxBoard: 3,
      catalystNote: null,
    });
    expect(judge.conditions.find((item) => item.key === 'breakBoard')?.score).toBe(-2);
  });
});

describe('toTier', () => {
  it('四档边界', () => {
    expect(toTier(10, false)).toBe('mainline');
    expect(toTier(9, false)).toBe('candidate');
    expect(toTier(7, false)).toBe('candidate');
    expect(toTier(6, false)).toBe('branch');
    expect(toTier(4, false)).toBe('branch');
    expect(toTier(3, false)).toBe('one_day');
  });

  it('退潮时降档', () => {
    expect(toTier(12, true)).toBe('branch');
    expect(toTier(3, true)).toBe('one_day');
  });
});
