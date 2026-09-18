/**
 * topicAliases 表的回归测试。
 *
 * 重点不是「表里有多少条」，而是这张表必须**逐板块隔离**：
 * 「PCB」配给 BK0877 之后，不能让 BK0900（新能源车）的同一个标签也算成精确依据。
 * 2026-09-18 之前这张表是空的，导致 supportedCount 恒为 0、主线/支线永远为空。
 */
import { describe, expect, it } from 'vitest';
import { normalizeTopicText, resolveTopicMatch, TOPIC_ALIASES } from './topicAliases.js';

describe('TOPIC_ALIASES 表结构', () => {
  it('表非空，且每条都是真实的 BK 板块代码', () => {
    expect(TOPIC_ALIASES.length).toBeGreaterThan(0);
    for (const entry of TOPIC_ALIASES) {
      expect(entry.themeCode).toMatch(/^BK\d{4}$/);
    }
  });

  it('每条都有自己的细分逻辑键和至少一个精确词', () => {
    for (const entry of TOPIC_ALIASES) {
      expect(entry.topicKey.trim().length).toBeGreaterThan(0);
      expect(entry.exactPhrases.length).toBeGreaterThan(0);
      for (const phrase of entry.exactPhrases) {
        expect(phrase.trim().length).toBeGreaterThanOrEqual(2);
        // 自洽：配置的词必须能被自己全等命中
        expect(resolveTopicMatch(entry.themeCode, phrase)).toEqual({
          match: 'exact',
          topicKey: entry.topicKey,
        });
      }
    }
  });

  it('归一化后仍能命中（全角 / 空格不影响判定）', () => {
    const entry = TOPIC_ALIASES.find((item) => item.exactPhrases.includes('PCB'));
    expect(entry?.themeCode).toBe('BK0877');
    expect(resolveTopicMatch('BK0877', ' ＰＣＢ ')).toEqual({
      match: 'exact',
      topicKey: 'PCB',
    });
  });
});

describe('逐板块隔离', () => {
  it('同一个词配在别的板块上时不返回 exact', () => {
    // 「PCB」只配给了 BK0877；BK0900 的同名标签不能算精确依据
    expect(resolveTopicMatch('BK0877', 'PCB').match).toBe('exact');
    expect(resolveTopicMatch('BK0900', 'PCB')).toEqual({ match: 'ambiguous', topicKey: null });
  });

  it('业绩 / 资金类通用词一律 ambiguous，不被当成精确细分逻辑', () => {
    // 「国企改革」「并购重组」这类词只有在它就是某板块自己的名字/逻辑时才允许入表
    // （见 BK0683 央国企改革、BK1181 并购重组概念），对无关板块必须一律 ambiguous。
    const generic = ['业绩增长', '半年报增长', '中报增长', '业绩扭亏', '国企改革', '并购重组'];
    for (const phrase of generic) {
      for (const theme of ['BK0877', 'BK0900', 'BK0917', 'BK0800']) {
        expect(resolveTopicMatch(theme, phrase)).toEqual({ match: 'ambiguous', topicKey: null });
      }
    }
    // 纯业绩口径的词不该出现在表里
    const configured = new Set(TOPIC_ALIASES.flatMap((entry) => entry.exactPhrases));
    for (const phrase of ['业绩增长', '半年报增长', '中报增长', '业绩扭亏']) {
      expect(configured.has(phrase)).toBe(false);
    }
  });

  it('空文本不算依据', () => {
    expect(resolveTopicMatch('BK0877', '   ')).toEqual({ match: 'ambiguous', topicKey: null });
  });
});

describe('normalizeTopicText', () => {
  it('全角转半角、去空格、明确别名归一', () => {
    expect(normalizeTopicText(' ＰＣＢ ')).toBe('PCB');
    expect(normalizeTopicText('新能源汽车')).toBe('新能源车');
    expect(normalizeTopicText('储能')).toBe('储能概念');
  });
});
