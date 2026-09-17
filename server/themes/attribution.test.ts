import { describe, expect, it } from 'vitest';
import type { Evidence } from '../../src/types.js';
import { resolveThemeRelation, validEvidenceFor, type AttributionInput } from './attribution.js';
import { normalizeTopicText, resolveTopicMatch } from './topicAliases.js';

const TRADE_DATE = '20260918';
const AS_OF = '2026-09-18T07:10:00Z';

const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({
  id: 'ev-1',
  themeCode: 'BK0001',
  symbol: '600001',
  sourceKind: 'limit_up_reason',
  sourceName: '同花顺涨停池',
  sourceUrl: null,
  text: '风电铸件',
  publishedAt: '2026-09-18T01:30:00Z',
  observedAt: '2026-09-18T07:00:00Z',
  validTradeDate: TRADE_DATE,
  topicKey: null,
  match: 'ambiguous',
  ...overrides,
});

const input = (overrides: Partial<AttributionInput> = {}): AttributionInput => ({
  themeCode: 'BK0001',
  symbol: '600001',
  isMember: true,
  evidence: [],
  evidenceFetchFailed: false,
  hasConflictingEvidence: false,
  alternativeThemeCodes: [],
  tradeDate: TRADE_DATE,
  asOf: AS_OF,
  ...overrides,
});

describe('resolveThemeRelation', () => {
  it('A1 F10归属不能单独确认本轮驱动', () => {
    const result = resolveThemeRelation({
      themeCode: 'BK0001',
      symbol: '600001',
      isMember: true,
      evidence: [],
      evidenceFetchFailed: false,
      hasConflictingEvidence: false,
      alternativeThemeCodes: [],
      tradeDate: '20260918',
      asOf: '2026-09-18T07:10:00Z',
    });
    expect(result.state).toBe('membership_only');
    expect(result.evidenceIds).toEqual([]);
  });

  it('A2 本日精确原因算驱动有依据', () => {
    const result = resolveThemeRelation(
      input({ evidence: [evidence({ id: 'ev-exact', match: 'exact', topicKey: 'wind-casting' })] }),
    );
    expect(result.state).toBe('supported');
    expect(result.evidenceIds).toEqual(['ev-exact']);
    expect(result.topicKeys).toEqual(['wind-casting']);
    expect(result.reasons.join('')).toContain('风电铸件');
  });

  it('A3 模糊关联只能是可能相关，不能升格为有依据', () => {
    const result = resolveThemeRelation(
      input({ evidence: [evidence({ id: 'ev-fuzzy', match: 'ambiguous' })] }),
    );
    expect(result.state).toBe('possible');
    expect(result.evidenceIds).toEqual(['ev-fuzzy']);
  });

  it('A4 证据获取失败是 unknown，不是仅概念归属', () => {
    const result = resolveThemeRelation(input({ evidenceFetchFailed: true }));
    expect(result.state).toBe('unknown');
    expect(result.state).not.toBe('membership_only');
  });

  it('A5 只有另一题材有依据时算存在其他驱动', () => {
    const result = resolveThemeRelation(
      input({
        alternativeThemeCodes: ['BK0002'],
        evidence: [
          evidence({ id: 'ev-other', themeCode: 'BK0002', match: 'exact', topicKey: 'other' }),
        ],
      }),
    );
    expect(result.state).toBe('other_driver');
    expect(result.alternativeThemeCodes).toEqual(['BK0002']);
  });

  it('A6 晚于 asOf 的证据不得支持历史结论', () => {
    const result = resolveThemeRelation(
      input({
        evidence: [
          evidence({
            id: 'ev-late',
            match: 'exact',
            observedAt: '2026-09-19T01:00:00Z',
            publishedAt: '2026-09-19T00:30:00Z',
          }),
        ],
      }),
    );
    expect(result.state).toBe('membership_only');
    expect(result.evidenceIds).toEqual([]);
  });

  it('不是本次交易日的证据不参与判定', () => {
    const result = resolveThemeRelation(
      input({ evidence: [evidence({ id: 'ev-old-date', match: 'exact', validTradeDate: '20260917' })] }),
    );
    expect(result.state).toBe('membership_only');
  });

  it('明确矛盾资料降为可能相关，但保留证据指向', () => {
    const result = resolveThemeRelation(
      input({
        hasConflictingEvidence: true,
        evidence: [evidence({ id: 'ev-conflict', match: 'exact' })],
      }),
    );
    expect(result.state).toBe('possible');
    expect(result.reasons.join('')).toContain('矛盾');
  });

  it('非成员且无证据是 unknown，不伪装成仅概念归属', () => {
    const result = resolveThemeRelation(input({ isMember: false }));
    expect(result.state).toBe('unknown');
  });

  it('只使用本人证据，不把同题材其它股票的证据算进来', () => {
    const result = resolveThemeRelation(
      input({ evidence: [evidence({ id: 'ev-other-symbol', symbol: '600002', match: 'exact' })] }),
    );
    expect(result.state).toBe('membership_only');
  });

  it('validEvidenceFor 过滤后保持同题材精确证据', () => {
    const valid = validEvidenceFor(
      input({ evidence: [evidence({ id: 'ev-ok', match: 'exact' })] }),
    );
    expect(valid.map((item) => item.id)).toEqual(['ev-ok']);
  });

  it('发布晚于 asOf 的证据即使观测时间合规也不采用', () => {
    const result = resolveThemeRelation(
      input({
        evidence: [
          evidence({
            id: 'ev-late-published',
            match: 'exact',
            observedAt: '2026-09-18T06:00:00Z',
            publishedAt: '2026-09-18T09:00:00Z',
          }),
        ],
      }),
    );
    expect(result.state).toBe('membership_only');
  });
});

describe('topicAliases', () => {
  it('规范化只去空格、统一全半角与明确别名', () => {
    expect(normalizeTopicText(' 风 电 铸 件 ')).toBe('风电铸件');
    expect(normalizeTopicText('ＡＩ＋算力')).toBe('AI+算力');
    expect(normalizeTopicText('新能源汽车')).toBe('新能源车');
  });

  it('一期没有配置映射时不猜精确匹配', () => {
    expect(resolveTopicMatch('BK1036', '半导体')).toEqual({
      match: 'ambiguous',
      topicKey: null,
    });
  });

  it('空文本不给精确匹配', () => {
    expect(resolveTopicMatch('BK1036', '   ')).toEqual({ match: 'ambiguous', topicKey: null });
  });
});
