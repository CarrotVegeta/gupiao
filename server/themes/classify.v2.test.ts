import { describe, expect, it } from 'vitest';
import type { ThemeKindV2 } from '../../src/types.js';
import { classifyThemeV2, isNextCalendarDay, type ThemeDayEvidence } from './classify.js';

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
      name: '4/2/2 且今天有 1 只未决可能补足 → pending',
      days: [day(D1, 4, 1), day(D0, 2, 0), day(DM1, 2, 0)],
      expected: 'pending',
      expectReason: /可能补足/,
    },
    {
      name: '4/2/2 且数据完整 → branch',
      days: [day(D1, 4, 0), day(D0, 2, 0), day(DM1, 2, 0)],
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

  it('日期不连续（跳过缺口）时判 pending，不把缺口当连续', () => {
    const result = classifyThemeV2([day(D1, 5, 0), day('20260911', 2, 0), day('20260910', 2, 0)]);
    expect(result.kind).toBe('pending');
  });

  it('main 也记录覆盖不足的 warning，但不取消正面资格', () => {
    const result = classifyThemeV2([day(D1, 6, 2), day(D0, 3, 0), day(DM1, 2, 0, 2, false)]);
    expect(result.kind).toBe('main');
    expect(result.reasons.join(' ')).toContain('覆盖不足');
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
