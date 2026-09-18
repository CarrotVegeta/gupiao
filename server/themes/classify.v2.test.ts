import { describe, expect, it } from 'vitest';
import type { ThemeKindV2 } from '../../src/types.js';
import {
  classifyThemeV2,
  isAdjacentTradingDay,
  isNextCalendarDay,
  MAIN_QUOTA,
  type ThemeDayEvidence,
} from './classify.js';

/** 造一天的证据；默认「完整」——计数都已知且基础数据无缺口 */
const day = (
  date: string,
  supported: number | null,
  unresolved: number | null,
  concept: number | null = supported,
  complete = true,
): ThemeDayEvidence => ({
  date,
  conceptCount: concept,
  supportedCount: supported,
  unresolvedCount: unresolved,
  complete,
});

// 连续 3 个交易日（周三 / 周四 / 周五），周二周三之间没有自然日缺口
const D1 = '20260918';
const D0 = '20260917';
const DM1 = '20260916';

describe('isNextCalendarDay', () => {
  it('只认相差一个自然日', () => {
    expect(isNextCalendarDay('20260916', '20260917')).toBe(true);
    expect(isNextCalendarDay('20260917', '20260918')).toBe(true);
    expect(isNextCalendarDay('20260911', '20260914')).toBe(false);
    expect(isNextCalendarDay('20260917', '20260917')).toBe(false);
  });
});

describe('isAdjacentTradingDay', () => {
  // 周四 20260910 / 周五 20260911 / 周一 20260914：跨周末但日历相邻
  const calendar = ['20260910', '20260911', '20260914'];

  it('给了交易日历时，跨周末的两个交易日算相邻', () => {
    expect(isAdjacentTradingDay('20260911', '20260914', calendar)).toBe(true);
    expect(isAdjacentTradingDay('20260910', '20260911', calendar)).toBe(true);
  });

  it('给了交易日历时，日历中间隔了别的交易日不算相邻', () => {
    expect(isAdjacentTradingDay('20260910', '20260914', calendar)).toBe(false);
    expect(isAdjacentTradingDay('20260914', '20260911', calendar)).toBe(false);
  });

  it('日期不在日历里不算相邻（不猜）', () => {
    expect(isAdjacentTradingDay('20260909', '20260910', calendar)).toBe(false);
  });

  it('没给交易日历时退化为自然日口径（周末会被当成缺口）', () => {
    expect(isAdjacentTradingDay('20260911', '20260914')).toBe(false);
    expect(isAdjacentTradingDay('20260917', '20260918')).toBe(true);
  });
});

describe('classifyThemeV2', () => {
  const cases: Array<{
    name: string;
    days: ThemeDayEvidence[];
    previouslyTracked?: boolean;
    expected: ThemeKindV2;
    expectReason?: RegExp;
    expectListed?: boolean;
  }> = [
    {
      name: 'supported 5/2/2、unresolved 0/0/0、日期连续 → main',
      days: [day(D1, 5, 0), day(D0, 2, 0), day(DM1, 2, 0)],
      expected: 'main',
    },
    {
      name: '只有首日 5 家 → pending（不足 3 日不能证明主线）',
      days: [day(D1, 5, 0)],
      expected: 'pending',
      expectReason: /不足 3 日/,
    },
    {
      name: '4/2/2 且数据完整 → branch（概念家数 4 家不够主线）',
      days: [day(D1, 4, 0), day(D0, 2, 0), day(DM1, 2, 0)],
      expected: 'branch',
    },
    {
      name: '当日 6 家已达标、前一日只有 1 家 → branch',
      days: [day(D1, 6, 3), day(D0, 2, 0), day(DM1, 1, 0)],
      expected: 'branch',
    },
    {
      name: '概念家数达标但驱动有依据为 0 → 仍是 main（驱动只作参考）',
      // day(日期, supported, unresolved, concept)：当日概念 6 家、驱动 0 家
      days: [day(D1, 0, 6, 6), day(D0, 3, 0), day(DM1, 2, 0)],
      expected: 'main',
      expectReason: /没有一只的涨停原因命中/,
    },
    {
      name: '驱动有依据很高但概念家数只有 2 → branch（资格看概念家数）',
      days: [day(D1, 2, 2), day(D0, 2, 2), day(DM1, 2, 2)],
      expected: 'branch',
    },
    {
      name: '前一日计数缺失 → pending，不补 0',
      days: [day(D1, 5, 0), day(D0, null, null, null, false), day(DM1, 2, 0)],
      expected: 'pending',
      expectReason: /缺失/,
    },
    {
      name: '已跟踪题材今天只有 1 家 → pending 且标注今日未达活跃门槛',
      days: [day(D1, 1, 0), day(D0, 2, 0), day(DM1, 2, 0)],
      previouslyTracked: true,
      expected: 'pending',
      expectReason: /今日未达活跃门槛/,
      expectListed: true,
    },
  ];

  it.each(cases)('$name', ({ days, previouslyTracked, expected, expectReason, expectListed }) => {
    const result = classifyThemeV2(days, { previouslyTracked });
    expect(result.kind).toBe(expected);
    if (expectReason) expect(result.reasons.join(' ')).toMatch(expectReason);
    if (expectListed !== undefined) expect(result.listed).toBe(expectListed);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('家数达标但排名在名额外 → 归支线，并说明排名', () => {
    const days = [day(D1, 13, 0), day(D0, 6, 0), day(DM1, 6, 0)];
    const inside = classifyThemeV2(days, { mainRank: MAIN_QUOTA });
    expect(inside.kind).toBe('main');
    expect(inside.reasons.join(' ')).toContain(`排名第 ${MAIN_QUOTA}`);

    const outside = classifyThemeV2(days, { mainRank: MAIN_QUOTA + 1 });
    expect(outside.kind).toBe('branch');
    expect(outside.reasons.join(' ')).toContain('超出主线名额');
    expect(outside.listed).toBe(true);
  });

  it('宽口径属性板块不占主线名额（mainEligible=false）', () => {
    const days = [day(D1, 21, 0), day(D0, 20, 0), day(DM1, 23, 0)];
    const broad = classifyThemeV2(days, { mainRank: 1, mainEligible: false });
    expect(broad.kind).toBe('branch');
    expect(broad.reasons.join(' ')).toContain('不占主线名额');
    expect(broad.listed).toBe(true);

    // 同样家数、有资格时就是主线
    expect(classifyThemeV2(days, { mainRank: 1 }).kind).toBe('main');
  });

  it('不给排名时不设名额（单板块纯函数用法）', () => {
    const days = [day(D1, 13, 0), day(D0, 6, 0), day(DM1, 6, 0)];
    expect(classifyThemeV2(days).kind).toBe('main');
  });

  it('名额可覆盖（mainQuota）', () => {
    const days = [day(D1, 13, 0), day(D0, 6, 0), day(DM1, 6, 0)];
    expect(classifyThemeV2(days, { mainRank: 5, mainQuota: 5 }).kind).toBe('main');
    expect(classifyThemeV2(days, { mainRank: 5, mainQuota: 4 }).kind).toBe('branch');
  });

  it('日期不连续（跳过缺口）时判 pending，不把缺口当连续', () => {
    const result = classifyThemeV2([day(D1, 5, 0), day('20260911', 2, 0), day('20260910', 2, 0)]);
    expect(result.kind).toBe('pending');
  });

  it('跨周末的 3 个交易日（周一/周五/周四）给了日历后算连续 → main', () => {
    const monday = [day('20260914', 5, 0), day('20260911', 2, 0), day('20260910', 2, 0)];
    const calendar = ['20260910', '20260911', '20260914'];
    expect(classifyThemeV2(monday, { tradingDates: calendar }).kind).toBe('main');
  });

  it('同样 3 天但不给日历（自然日口径）→ 周五到周一被当缺口，只能 pending', () => {
    const monday = [day('20260914', 5, 0), day('20260911', 2, 0), day('20260910', 2, 0)];
    expect(classifyThemeV2(monday).kind).toBe('pending');
  });

  it('家数基础数据不完整时仍可 main，但要披露不完整', () => {
    const result = classifyThemeV2([day(D1, 6, 2), day(D0, 3, 0), day(DM1, 2, 0, 2, false)]);
    expect(result.kind).toBe('main');
    expect(result.reasons.join(' ')).toContain('基础数据不完整');
  });

  it('驱动证据取不到（supported 为 0）不再把题材拖成待确认', () => {
    // day(日期, supported, unresolved, concept)：这里 concept 8 家、supported 0 家
    const result = classifyThemeV2([day(D1, 0, 8, 8), day(D0, 3, 0), day(DM1, 3, 0)]);
    expect(result.kind).toBe('main');
    expect(result.reasons.join(' ')).toContain('驱动口径仅作参考');
  });

  it('当日概念家数不足时标注今日未达活跃门槛，但不直接判退潮', () => {
    const result = classifyThemeV2([day(D1, 2, 0, 1), day(D0, 2, 0), day(DM1, 2, 0)]);
    expect(result.belowActiveFloor).toBe(true);
    expect(result.reasons.join(' ')).toContain('今日未达活跃门槛');
    expect(result.reasons.join(' ')).not.toContain('退潮');
  });

  it('当日概念不活跃且未跟踪的题材不进列表', () => {
    const result = classifyThemeV2([day(D1, 1, 0, 1), day(D0, 1, 0, 1), day(DM1, 1, 0, 1)]);
    expect(result.listed).toBe(false);
  });

  it('没有当日数据时不假装可分类', () => {
    const result = classifyThemeV2([]);
    expect(result.kind).toBe('pending');
    expect(result.listed).toBe(false);
  });
});
