import { describe, expect, it } from 'vitest';
import {
  tierClassNames,
  tierOfChange,
  turnoverLevel,
  volumeRatioLevel,
  wordClassNames,
} from './valueTier';

describe('tierOfChange', () => {
  it('按涨跌幅分档：涨停 / 大涨 / 小涨 / 小跌 / 大跌 / 跌停', () => {
    expect(tierOfChange(10.02)).toBe('limit');
    expect(tierOfChange(9.9)).toBe('limit');
    expect(tierOfChange(9.89)).toBe('bigUp');
    expect(tierOfChange(5)).toBe('bigUp');
    expect(tierOfChange(4.99)).toBe('up');
    expect(tierOfChange(0.01)).toBe('up');
    expect(tierOfChange(-0.01)).toBe('down');
    expect(tierOfChange(-4.99)).toBe('down');
    expect(tierOfChange(-5)).toBe('bigDown');
    expect(tierOfChange(-9.89)).toBe('bigDown');
    expect(tierOfChange(-9.9)).toBe('limitDown');
    expect(tierOfChange(-10.01)).toBe('limitDown');
  });

  it('恰好 0 不分档：界面原本就是中性色，不为 +0.00% 多造改动', () => {
    expect(tierOfChange(0)).toBeNull();
  });

  it('缺值、非有限数都不分档', () => {
    expect(tierOfChange(null)).toBeNull();
    expect(tierOfChange(undefined)).toBeNull();
    expect(tierOfChange(Number.NaN)).toBeNull();
    expect(tierOfChange(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('turnoverLevel', () => {
  it('换手率档位词：冷清 / 正常 / 活跃 / 过热', () => {
    expect(turnoverLevel(0.14)).toEqual({ word: '冷清', tone: 'dim' });
    expect(turnoverLevel(0.99)).toEqual({ word: '冷清', tone: 'dim' });
    expect(turnoverLevel(1)).toEqual({ word: '正常', tone: 'ink' });
    expect(turnoverLevel(4.99)).toEqual({ word: '正常', tone: 'ink' });
    expect(turnoverLevel(5)).toEqual({ word: '活跃', tone: 'amber' });
    expect(turnoverLevel(14.99)).toEqual({ word: '活跃', tone: 'amber' });
    expect(turnoverLevel(15)).toEqual({ word: '过热', tone: 'rise' });
    expect(turnoverLevel(47.06)).toEqual({ word: '过热', tone: 'rise' });
  });

  it('缺值时不给词（那一格本来就显示「—」）', () => {
    expect(turnoverLevel(null)).toBeNull();
    expect(turnoverLevel(undefined)).toBeNull();
    expect(turnoverLevel(Number.NaN)).toBeNull();
  });
});

describe('volumeRatioLevel', () => {
  it('量比档位词：缩量 / 平量 / 温和放量 / 大幅放量', () => {
    expect(volumeRatioLevel(0.79)).toEqual({ word: '缩量', tone: 'fall' });
    expect(volumeRatioLevel(0.8)).toEqual({ word: '平量', tone: 'ink' });
    expect(volumeRatioLevel(1.5)).toEqual({ word: '平量', tone: 'ink' });
    expect(volumeRatioLevel(1.51)).toEqual({ word: '温和放量', tone: 'amber' });
    expect(volumeRatioLevel(2.5)).toEqual({ word: '温和放量', tone: 'amber' });
    expect(volumeRatioLevel(2.51)).toEqual({ word: '大幅放量', tone: 'rise' });
    expect(volumeRatioLevel(4.71)).toEqual({ word: '大幅放量', tone: 'rise' });
  });

  it('缺值时不给词', () => {
    expect(volumeRatioLevel(null)).toBeNull();
    expect(volumeRatioLevel(undefined)).toBeNull();
  });
});

describe('类名拼装', () => {
  it('档位类名带 pad 修饰，没有档位时是空串', () => {
    expect(tierClassNames('limit', { pad: true })).toBe('value-tier value-tier--limit value-tier--pad');
    expect(tierClassNames('bigDown', { pad: true })).toBe(
      'value-tier value-tier--bigDown value-tier--pad',
    );
    expect(tierClassNames('bigDown')).toBe('value-tier value-tier--bigDown');
    expect(tierClassNames(null, { pad: true })).toBe('');
  });

  it('纯变色的档不垫 padding：垫了也看不出，没必要多写', () => {
    expect(tierClassNames('up', { pad: true })).toBe('value-tier value-tier--up');
    expect(tierClassNames('down', { pad: true })).toBe('value-tier value-tier--down');
  });

  it('档位词类名跟着 tone 走，没有词时是空串', () => {
    expect(wordClassNames({ word: '活跃', tone: 'amber' })).toBe('value-word value-word--amber');
    expect(wordClassNames(null)).toBe('');
  });
});
