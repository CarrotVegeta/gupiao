import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../src/types.js';
import {
  assignRoleTags,
  compareRank,
  isTied,
  ROLE_LIMITS,
  ROLE_RULE_VERSION,
  type RoleAssessment,
} from './assignRoles.js';

const ASSIGNED_AT = '2026-09-18T07:10:00Z';

const check = (
  key: string,
  state: CheckResult['state'],
  value: number | string | boolean | null = null,
): CheckResult => ({ key, state, value, reason: `${key} ${state}`, evidenceIds: [] });

const assessment = (overrides: Partial<RoleAssessment> = {}): RoleAssessment => ({
  symbol: '600001',
  role: 'leader',
  eligible: true,
  checks: [check('本轮关联', 'pass')],
  rank: [3, 2, 1],
  ...overrides,
});

describe('compareRank', () => {
  it('越大越优', () => {
    expect(compareRank([5, 1], [3, 9])).toBeLessThan(0);
  });

  it('缺失排在任意已知值之后', () => {
    expect(compareRank([null, 99], [1, 1])).toBeGreaterThan(0);
  });

  it('两个都缺失则继续比较下一项', () => {
    expect(compareRank([null, 5], [null, 3])).toBeLessThan(0);
  });

  it('完全并列时返回 0', () => {
    expect(isTied([2, null, 5], [2, null, 5])).toBe(true);
  });
});

describe('assignRoleTags', () => {
  it('未满足必要条件不能用高排序分补偿', () => {
    const output = assignRoleTags(
      [
        { symbol: '600001', role: 'leader', eligible: false, checks: [], rank: [9, 9, 9] },
        { symbol: '600002', role: 'leader', eligible: true, checks: [], rank: [3, 2, 1] },
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toBeUndefined();
    expect(output.tags['600002'][0].status).toBe('candidate');
  });

  it('同一股票多个角色合并成同一个数组（只出现一行）', () => {
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', role: 'leader', rank: [5, 5, 5] }),
        assessment({ symbol: '600001', role: 'trend', rank: [4, 4, 4] }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toHaveLength(2);
    expect(output.tags['600001'].map((tag) => tag.role).sort()).toEqual(['leader', 'trend']);
  });

  it('没有合格候选时标签留空并给出 warning', () => {
    const output = assignRoleTags([assessment({ eligible: false })], ASSIGNED_AT);
    expect(Object.keys(output.tags)).toHaveLength(0);
    expect(output.warnings.join(' ')).toContain('没有满足必要资格');
  });

  it('并列跨越上限时该组不发标签', () => {
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', rank: [5, 1, 1] }),
        assessment({ symbol: '600002', rank: [5, 1, 1] }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toBeUndefined();
    expect(output.tags['600002']).toBeUndefined();
    expect(output.warnings.join(' ')).toContain('并列待确认');
  });

  it('并列发生在入选名额之内时不受影响', () => {
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', role: 'laggard', rank: [5, 1] }),
        assessment({ symbol: '600002', role: 'laggard', rank: [5, 1] }),
        assessment({ symbol: '600003', role: 'laggard', rank: [1, 1] }),
      ],
      ASSIGNED_AT,
    );
    // laggard 上限 2：两只并列都在名额内，正常发标签；第三名更差
    expect(output.tags['600001']).toHaveLength(1);
    expect(output.tags['600002']).toHaveLength(1);
    expect(output.tags['600003']).toBeUndefined();
  });

  it('第一关键排序项缺失的候选不参与代表分配', () => {
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', rank: [null, 100, 100] }),
        assessment({ symbol: '600002', rank: [1, 0, 0] }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toBeUndefined();
    expect(output.tags['600002']).toHaveLength(1);
    expect(output.warnings.join(' ')).toContain('第一关键排序项缺失');
  });

  it('后续项缺失排在已知值之后，不当作 0', () => {
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', rank: [5, null, 9] }),
        assessment({ symbol: '600002', rank: [5, 1, 0] }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600002']).toHaveLength(1);
    expect(output.tags['600001']).toBeUndefined();
  });

  it('缺失的判定项进入 missingEvidence，不按通过处理', () => {
    const output = assignRoleTags(
      [
        assessment({
          checks: [check('本轮关联', 'pass'), check('连续板高度', 'missing'), check('量能', 'fail')],
        }),
      ],
      ASSIGNED_AT,
    );
    const tag = output.tags['600001'][0];
    expect(tag.missingEvidence.join(' ')).toContain('连续板高度');
    expect(tag.missingEvidence.join(' ')).toContain('量能');
    expect(tag.missingEvidence.join(' ')).not.toContain('本轮关联');
  });

  it('v1 只产出候选标签，并带上规则版本', () => {
    const output = assignRoleTags([assessment()], ASSIGNED_AT);
    const tag = output.tags['600001'][0];
    expect(tag.status).toBe('candidate');
    expect(tag.ruleVersion).toBe(ROLE_RULE_VERSION);
    expect(tag.assignedAt).toBe(ASSIGNED_AT);
  });

  it('每个题材默认上限：龙头/核心/中军各一只、补涨两只', () => {
    expect(ROLE_LIMITS).toEqual({ leader: 1, turnover: 1, trend: 1, laggard: 2 });
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', rank: [9, 9] }),
        assessment({ symbol: '600002', rank: [8, 8] }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toHaveLength(1);
    expect(output.tags['600002']).toBeUndefined();
  });

  it('风险未查 / 风险命中的候选不带上限例外地获得标签', () => {
    // 编排层把风险和关联检查都收进 eligible：这里验证 eligible=false 一律不发标签
    const output = assignRoleTags(
      [
        assessment({ symbol: '600001', eligible: false, checks: [check('风险核验', 'missing')] }),
        assessment({ symbol: '600002', eligible: true }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toBeUndefined();
    expect(output.tags['600002']).toHaveLength(1);
  });

  it('未涨停日不自动从候选全集删除：资格由 checks 决定，不由涨停状态决定', () => {
    const output = assignRoleTags(
      [
        assessment({
          symbol: '600001',
          checks: [check('本轮关联', 'pass'), check('近20日涨停记录', 'pass')],
          rank: [0, 1, 1],
        }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toHaveLength(1);
  });

  it('缺少本轮启动锚点时补涨资格不成立（eligible=false 即无标签）', () => {
    const output = assignRoleTags(
      [
        assessment({
          symbol: '600001',
          role: 'laggard',
          eligible: false,
          checks: [check('本轮启动时序', 'missing')],
          rank: [1, 1],
        }),
      ],
      ASSIGNED_AT,
    );
    expect(output.tags['600001']).toBeUndefined();
    expect(output.warnings.join(' ')).toContain('潜在低位补涨');
  });
});
