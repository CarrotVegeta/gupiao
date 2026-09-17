import { describe, expect, it, vi } from 'vitest';
import type { ThemesResponse, ThemeStocksResponse, TrendScanResponse } from '../types';
import {
  fetchThemeStocks,
  fetchThemes,
  fetchTrendScan,
  mergeThemes,
  toThemeStocksResponse,
  toThemesResponse,
  toTrendScanResponse,
  TREND_EVIDENCE,
  unavailableThemes,
} from './screener';

const themeItem = {
  code: 'BK0900',
  name: '新能源车',
  kind: 'main',
  pct: 0.29,
  limitUpCount: 12,
  continuousCount: 4,
  maxBoard: 5,
  maxBoardLabel: '5 板',
  durationDays: 6,
  amount: 4.7e11,
  amountRatio: 25.85,
  catalysts: ['量产'],
  leader: { symbol: '605058', name: '澳弘电子', boardCount: 5, highLabel: '5 板' },
  metrics: [
    { key: 'duration', label: '持续时间', hit: true, value: '6 天', detail: '连续 6 个交易日' },
  ],
  score: 6,
};

const themesPayload = {
  tradeDate: '20260917',
  main: [themeItem],
  branch: [],
  fetchedAt: '2026-09-17T14:00:00.000Z',
  source: 'eastmoney+10jqka',
  status: 'fresh',
  error: null,
};

describe('TREND_EVIDENCE', () => {
  it('把回测结论写进页面常量，避免页头文案和实测数字脱节', () => {
    expect(TREND_EVIDENCE.headline).toContain('回测');
    expect(TREND_EVIDENCE.lines.join(' ')).toContain('t=−3.28');
    expect(TREND_EVIDENCE.lines.join(' ')).toContain('−2.426%');
    expect(TREND_EVIDENCE.footer).toContain('不构成任何买入建议');
  });
});

describe('toThemesResponse', () => {
  it('接受合法响应', () => {
    const result = toThemesResponse(themesPayload);
    expect(result.status).toBe('fresh');
    expect(result.main).toHaveLength(1);
    expect(result.main[0].name).toBe('新能源车');
  });

  it('板块代码不是 BKxxxx 时退回不可用', () => {
    const result = toThemesResponse({
      ...themesPayload,
      main: [{ ...themeItem, code: '900' }],
    });
    expect(result.status).toBe('unavailable');
  });

  it('indicator 缺字段时退回不可用', () => {
    const result = toThemesResponse({
      ...themesPayload,
      main: [{ ...themeItem, metrics: [{ key: 'duration', label: '持续时间', hit: true, value: '6 天' }] }],
    });
    expect(result.status).toBe('unavailable');
  });

  it('fresh 但 error 非空视为坏数据', () => {
    const result = toThemesResponse({ ...themesPayload, error: '上游失败' });
    expect(result.status).toBe('unavailable');
  });

  it('unavailable 时清空列表', () => {
    const result = toThemesResponse({
      ...themesPayload,
      main: [themeItem],
      status: 'unavailable',
      error: '上游失败',
    });
    expect(result.status).toBe('unavailable');
    expect(result.main).toEqual([]);
  });

  it('空对象退回不可用', () => {
    expect(toThemesResponse({}).status).toBe('unavailable');
    expect(toThemesResponse(null).status).toBe('unavailable');
  });
});

describe('mergeThemes', () => {
  it('fresh 直接替换', () => {
    const previous = unavailableThemes('旧');
    const next = toThemesResponse(themesPayload);
    expect(mergeThemes(previous, next)).toBe(next);
  });

  it('失败时保留上一轮并标记 stale', () => {
    const previous: ThemesResponse = toThemesResponse(themesPayload);
    const failure = unavailableThemes('上游挂了');
    const merged = mergeThemes(previous, failure);
    expect(merged.status).toBe('stale');
    expect(merged.main).toHaveLength(1);
    expect(merged.error).toBe('上游挂了');
  });

  it('没有上一轮成功数据时保持不可用', () => {
    const merged = mergeThemes(unavailableThemes('旧'), unavailableThemes('新'));
    expect(merged.status).toBe('unavailable');
    expect(merged.main).toEqual([]);
  });
});

describe('toThemeStocksResponse', () => {
  const item = {
    symbol: '605058',
    name: '澳弘电子',
    price: 48.76,
    pct: 9.99,
    boardCount: 5,
    firstSealTime: '09:31:01',
    sealType: '换手板',
    openCount: 1,
    sealAmount: 3e7,
    turnoverRate: 15.8,
    amount: 1.08e9,
    avgAmount3d: 7.63e8,
    avgAmount5d: 7.1e8,
    floatMarketCap: 6.97e9,
    reason: 'PCB + HDI板',
    precise: true,
    hits: ['首封时间早'],
    misses: ['开板 37 次（要求 ≤1）'],
    risks: [],
    ma5: 40.67,
    ma10: 34.8,
    ma20: 31.09,
    maBull: true,
    distMa5: 19.9,
    distMa10: 40.1,
    stableDays10: 9,
    pct10: 52.3,
    pct20: 78.1,
    limitUpIn60d: 3,
  };

  const payload = {
    tradeDate: '20260917',
    theme: { code: 'BK0900', name: '新能源车' },
    role: 'leader',
    items: [item],
    scanned: 12,
    fetchedAt: '2026-09-17T14:00:00.000Z',
    source: 'eastmoney+10jqka+tencent',
    status: 'fresh',
    error: null,
  };

  it('接受合法响应并保留 hits / misses', () => {
    const result: ThemeStocksResponse = toThemeStocksResponse(payload, 'leader');
    expect(result.status).toBe('fresh');
    expect(result.items[0].hits).toEqual(['首封时间早']);
    expect(result.items[0].misses).toEqual(['开板 37 次（要求 ≤1）']);
  });

  it('缺 misses 字段时退回不可用（不允许悄悄丢字段）', () => {
    const broken = { ...payload, items: [{ ...item, misses: undefined }] };
    expect(toThemeStocksResponse(broken, 'leader').status).toBe('unavailable');
  });
});

describe('toTrendScanResponse', () => {
  const pick = {
    symbol: '300499',
    name: '高澜股份',
    themes: [{ code: 'BK0900', name: '新能源车' }],
    price: 38.26,
    pct: 0.21,
    ma5: 37.18,
    ma10: 36.21,
    ma20: 33.68,
    distMa5: 2.9,
    stableDays: 4,
    shrink: 0.88,
    pctWindow: 13.06,
    avgAmount5d: 1.48e9,
    turnoverRate: 13.9,
    matched: ['5/10/20 日线多头排列'],
    unmatched: [],
  };

  const payload = {
    tradeDate: '20260917',
    items: [pick],
    scanned: 260,
    candidates: 294,
    filters: {
      themeScope: 'main',
      maxMa5Dist: 4,
      maxPct: 20,
      pctWindow: 10,
      minStableDays: 3,
      minAmountYi: 5,
      minScore: 5,
      mainOnly: false,
      excludeSt: false,
    },
    fetchedAt: '2026-09-17T14:00:00.000Z',
    source: 'eastmoney+10jqka',
    status: 'fresh',
    error: null,
  };

  it('接受合法响应并带回 filters', () => {
    const result: TrendScanResponse = toTrendScanResponse(payload);
    expect(result.items).toHaveLength(1);
    expect(result.scanned).toBe(260);
    expect(result.filters.minScore).toBe(5);
    expect(result.filters.pctWindow).toBe(10);
  });

  it('themeScope 非法时退回 main', () => {
    const result = toTrendScanResponse({
      ...payload,
      filters: { ...payload.filters, themeScope: 'weird' },
    });
    expect(result.filters.themeScope).toBe('main');
  });

  it('items 里混入坏行时整体退回不可用', () => {
    const result = toTrendScanResponse({ ...payload, items: [{ ...pick, symbol: 'abc' }] });
    expect(result.status).toBe('unavailable');
    expect(result.items).toEqual([]);
  });
});

describe('请求函数', () => {
  it('fetchThemes 拼上 date 参数', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(themesPayload)));
    await fetchThemes('20260917', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/themes?date=20260917');
  });

  it('fetchThemeStocks 带上 role', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tradeDate: '20260917',
            theme: { code: 'BK0900', name: '新能源车' },
            role: 'trend',
            items: [],
            scanned: 0,
            fetchedAt: '2026-09-17T14:00:00.000Z',
            source: 'eastmoney+10jqka+tencent',
            status: 'fresh',
            error: null,
          }),
        ),
    );
    await fetchThemeStocks('BK0900', 'trend', undefined, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/themes/BK0900/stocks?role=trend');
  });

  it('fetchTrendScan 把 filters 序列化成查询参数', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            tradeDate: '20260917',
            items: [],
            scanned: 0,
            candidates: 0,
            filters: {
              themeScope: 'all',
              maxMa5Dist: 6,
              maxPct: 30,
              pctWindow: 20,
              minStableDays: 4,
              minAmountYi: 3,
              minScore: 4,
              mainOnly: true,
              excludeSt: true,
            },
            fetchedAt: '2026-09-17T14:00:00.000Z',
            source: 'eastmoney',
            status: 'fresh',
            error: null,
          }),
        ),
    );
    await fetchTrendScan({ themeScope: 'all', minScore: 4 }, fetchImpl as unknown as typeof fetch);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('/api/screener/trend?');
    expect(url).toContain('themeScope=all');
    expect(url).toContain('minScore=4');
  });

  it('HTTP 失败时抛错而不是返回空数据', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));
    await expect(
      fetchThemes(undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('题材请求失败（502）');
  });
});
