import { describe, expect, it } from 'vitest';
import type { LimitUpItem, LimitUpResponse } from '../types';
import { formatLimitUpTag, toLimitUpInfoMap } from './limitUpInfo';

const item = (overrides: Partial<LimitUpItem> = {}): LimitUpItem => ({
  symbol: '003026',
  name: '中晶科技',
  price: 37,
  pct: 9.99,
  boardCount: 3,
  firstSealTime: '09:25:00',
  lastSealTime: '09:59:39',
  industry: '半导体',
  breakCount: 2,
  ...overrides,
});

const response = (overrides: Partial<LimitUpResponse> = {}): LimitUpResponse => ({
  tradeDate: '20260917',
  items: [item()],
  fetchedAt: '2026-09-17T07:00:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...overrides,
});

describe('toLimitUpInfoMap', () => {
  it('把涨停池按代码收成标签查询表', () => {
    const map = toLimitUpInfoMap(
      response({
        items: [item(), item({ symbol: '600519', name: '贵州茅台', boardCount: 1 })],
      }),
    );

    expect(map).toEqual({
      '003026': { boardCount: 3 },
      '600519': { boardCount: 1 },
    });
  });

  it('连板数缺失的票不进表，避免渲染出空标签', () => {
    const map = toLimitUpInfoMap(response({ items: [item({ boardCount: null })] }));

    expect(map).toEqual({});
  });

  it('涨停池不可用时返回空表（不清空上游已有的标签）', () => {
    const map = toLimitUpInfoMap(
      response({ items: [], status: 'unavailable', tradeDate: null, error: '涨停池上游请求失败' }),
    );

    expect(map).toEqual({});
  });

  it('stale 的池子仍然可用：标签比没有强', () => {
    const map = toLimitUpInfoMap(response({ status: 'stale' }));

    expect(map).toEqual({ '003026': { boardCount: 3 } });
  });
});

describe('formatLimitUpTag', () => {
  it('首板写「涨停」，连板写「N 连板」', () => {
    expect(formatLimitUpTag({ boardCount: 1 })).toBe('涨停');
    expect(formatLimitUpTag({ boardCount: 2 })).toBe('2 连板');
    expect(formatLimitUpTag({ boardCount: 5 })).toBe('5 连板');
  });

  it('没有涨停状态就不显示标签', () => {
    expect(formatLimitUpTag(undefined)).toBeNull();
    expect(formatLimitUpTag({ boardCount: null })).toBeNull();
  });
});
