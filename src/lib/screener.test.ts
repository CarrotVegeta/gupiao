import { describe, expect, it, vi } from 'vitest';
import type { ThemesResponse } from '../types';
import {
  fetchThemeDetail,
  fetchThemes,
  fetchTrendScan,
  mergeThemes,
  toThemeDetailResponse,
  toThemesResponse,
  toTrendScanResponse,
  TREND_EVIDENCE,
  unavailableThemeDetail,
  unavailableThemes,
  type TrendScanResponseV2,
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
  classificationReasons: ['最近 3 个交易日驱动有依据家数 5/2/2'],
  conceptLimitUpCount: 12,
  supportedLimitUpCount: 5,
  unresolvedLimitUpCount: 7,
};

const themesPayload = {
  schemaVersion: 2,
  tradeDate: '20260917',
  main: [themeItem],
  branch: [],
  pending: [],
  fetchedAt: '2026-09-17T14:00:00.000Z',
  source: 'eastmoney+10jqka',
  status: 'fresh',
  warnings: [],
  error: null,
};

/** 细分逻辑题材条目（TP: 前缀）：题材页主口径 */
const topicItem = {
  code: 'TP:光通信',
  name: '光通信',
  kind: 'main',
  pct: 6.3,
  limitUpCount: 5,
  continuousCount: 1,
  maxBoard: 2,
  maxBoardLabel: '2 板',
  durationDays: 3,
  amount: null,
  amountRatio: null,
  catalysts: ['光通信', '光通信测试'],
  leader: { symbol: '002161', name: '远望谷', boardCount: 2, highLabel: '2天2板' },
  metrics: [
    { key: 'amount', label: '成交额', hit: false, value: '—', detail: '题材口径下没有板块成交额来源' },
  ],
  score: 1,
  classificationReasons: ['最近 3 个交易日带同一涨停逻辑的家数 5/2/2', '满足当日 ≥5 且前两日各 ≥2，判主线'],
  conceptLimitUpCount: 5,
  supportedLimitUpCount: null,
  unresolvedLimitUpCount: null,
  source: 'topic',
};

const topicsPayload = {
  schemaVersion: 2,
  scope: 'topic',
  tradeDate: '20260918',
  main: [topicItem],
  branch: [],
  pending: [],
  fetchedAt: '2026-09-18T08:00:00.000Z',
  source: 'eastmoney+10jqka',
  status: 'fresh',
  warnings: ['题材口径：细分逻辑 = 涨停原因标签'],
  error: null,
};

const stockItem = {
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
  hits: [],
  misses: [],
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
  quoteAsOf: '2026-09-17T14:00:00.000Z',
  relation: {
    state: 'supported',
    evidenceIds: ['ev-1'],
    reasons: ['本轮有明确依据：PCB'],
    alternativeThemeCodes: [],
    topicKeys: [],
    asOf: '2026-09-17T14:00:00.000Z',
  },
  roles: [
    {
      role: 'leader',
      status: 'candidate',
      reasons: ['题材内龙头候选比较排名第 1'],
      missingEvidence: ['分时带动证据：缺少分钟级带动证据'],
      assignedAt: '2026-09-17T14:00:00.000Z',
      ruleVersion: 'roles-v1-2026-09-18',
    },
  ],
  checks: {
    leader: [
      { key: '本轮关联', state: 'pass', value: 'supported', reason: '驱动有依据', evidenceIds: [] },
      {
        key: '分时带动证据',
        state: 'pending',
        value: null,
        reason: '缺少分钟级带动证据',
        evidenceIds: [],
      },
    ],
  },
  metricsState: 'ready',
  metricsTradeDate: '20260917',
  risksChecked: true,
};

const detailPayload = {
  schemaVersion: 2,
  ruleVersion: 'roles-v1-2026-09-18+classify-v2',
  tradeDate: '20260917',
  asOf: '2026-09-17T14:00:00.000Z',
  theme: { code: 'BK0900', name: '新能源车' },
  items: [stockItem],
  evidence: [
    {
      id: 'ev-1',
      themeCode: 'BK0900',
      symbol: '605058',
      sourceKind: 'limit_up_reason',
      sourceName: '同花顺涨停池',
      sourceUrl: null,
      text: 'PCB',
      publishedAt: null,
      observedAt: '2026-09-17T14:00:00.000Z',
      validTradeDate: '20260917',
      topicKey: null,
      match: 'ambiguous',
    },
  ],
  coverage: { total: 30, attempted: 25, succeeded: 24, failed: 1, unscanned: 5 },
  status: 'partial',
  warnings: ['1 只成员日K取数失败'],
  error: null,
};

describe('TREND_EVIDENCE', () => {
  it('用受限结论替代「已被否定」这类确定性表述', () => {
    expect(TREND_EVIDENCE.headline).not.toContain('否定');
    expect(TREND_EVIDENCE.headline).toContain('未表现出收益优势');
    expect(TREND_EVIDENCE.lines.join(' ')).toContain('t=−3.28');
    expect(TREND_EVIDENCE.lines.join(' ')).toContain('−2.426%');
    expect(TREND_EVIDENCE.footer).toContain('不构成任何买入建议');
  });
});

describe('toThemesResponse', () => {
  it('接受 v2 合法响应（含 pending 与 warnings）', () => {
    const result = toThemesResponse({ ...themesPayload, pending: [{ ...themeItem, kind: 'branch' }] });
    expect(result.status).toBe('fresh');
    expect(result.main).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
  });

  it('partial 是「有可用结果但有缺失」，不返回空列表', () => {
    const result = toThemesResponse({ ...themesPayload, status: 'partial', error: '部分上游失败' });
    expect(result.status).toBe('partial');
    expect(result.main).toHaveLength(1);
    expect(result.error).toBe('部分上游失败');
  });

  it('schemaVersion 不是 2 时退回不可用', () => {
    expect(toThemesResponse({ ...themesPayload, schemaVersion: 1 }).status).toBe('unavailable');
  });

  it('缺 v2 口径家数字段时退回不可用（不允许悄悄丢字段）', () => {
    const broken = {
      ...themesPayload,
      main: [{ ...themeItem, supportedLimitUpCount: undefined }],
    };
    expect(toThemesResponse(broken).status).toBe('unavailable');
  });

  it('家数缺失必须是 null；null 可以接受', () => {
    const result = toThemesResponse({
      ...themesPayload,
      main: [{ ...themeItem, supportedLimitUpCount: null }],
    });
    expect(result.status).toBe('fresh');
    expect(result.main[0].supportedLimitUpCount).toBeNull();
  });

  it('fresh 但 error 非空视为坏数据', () => {
    expect(toThemesResponse({ ...themesPayload, error: '上游失败' }).status).toBe('unavailable');
  });

  it('空对象退回不可用', () => {
    expect(toThemesResponse({}).status).toBe('unavailable');
    expect(toThemesResponse(null).status).toBe('unavailable');
  });
});

describe('mergeThemes', () => {
  it('partial 也算有效结果，直接替换而不是标 stale', () => {
    const next = toThemesResponse({ ...themesPayload, status: 'partial' });
    expect(mergeThemes(unavailableThemes('旧'), next)).toBe(next);
  });

  it('失败时保留上一轮并标记 stale', () => {
    const previous: ThemesResponse = toThemesResponse(themesPayload);
    const merged = mergeThemes(previous, unavailableThemes('上游挂了'));
    expect(merged.status).toBe('stale');
    expect(merged.main).toHaveLength(1);
  });

  it('没有上一轮成功数据时保持不可用', () => {
    const merged = mergeThemes(unavailableThemes('旧'), unavailableThemes('新'));
    expect(merged.status).toBe('unavailable');
    expect(merged.main).toEqual([]);
  });
});

describe('toThemeDetailResponse', () => {
  it('接受合法 v2 响应并保留角色、关联、覆盖', () => {
    const result = toThemeDetailResponse(detailPayload);
    expect(result.status).toBe('partial');
    expect(result.items[0].roles[0].role).toBe('leader');
    expect(result.items[0].relation.state).toBe('supported');
    expect(result.coverage.unscanned).toBe(5);
    expect(result.evidence).toHaveLength(1);
  });

  it('覆盖数不满足 attempted = succeeded + failed 时退回不可用', () => {
    const result = toThemeDetailResponse({
      ...detailPayload,
      coverage: { total: 30, attempted: 25, succeeded: 20, failed: 1, unscanned: 5 },
    });
    expect(result.status).toBe('unavailable');
  });

  it('覆盖数不满足 total = attempted + unscanned 时退回不可用', () => {
    const result = toThemeDetailResponse({
      ...detailPayload,
      coverage: { total: 30, attempted: 25, succeeded: 24, failed: 1, unscanned: 9 },
    });
    expect(result.status).toBe('unavailable');
  });

  it('checks 里的状态下发非法值（如任意字符串）时退回不可用', () => {
    const result = toThemeDetailResponse({
      ...detailPayload,
      items: [
        {
          ...stockItem,
          checks: { leader: [{ key: 'x', state: 'ok', value: 1, reason: 'r', evidenceIds: [] }] },
        },
      ],
    });
    expect(result.status).toBe('unavailable');
  });

  it('缺 relation 的股票行会让整体退回不可用', () => {
    const result = toThemeDetailResponse({
      ...detailPayload,
      items: [{ ...stockItem, relation: undefined }],
    });
    expect(result.status).toBe('unavailable');
  });

  it('unavailable 时清空明细', () => {
    const result = toThemeDetailResponse({
      ...detailPayload,
      status: 'unavailable',
      error: '上游失败',
    });
    expect(result.status).toBe('unavailable');
    expect(result.items).toEqual([]);
  });

  it('缺 schemaVersion 时退回不可用', () => {
    const { schemaVersion: _removed, ...rest } = detailPayload;
    void _removed;
    expect(toThemeDetailResponse(rest).status).toBe('unavailable');
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
    coverage: { total: 294, attempted: 260, succeeded: 255, failed: 5, unscanned: 34 },
    matchedTotal: 12,
    returnedCount: 1,
    truncated: true,
    metricsTradeDate: '20260917',
    quoteAsOf: '2026-09-17T14:00:00.000Z',
  };

  it('接受合法响应并带回 filters 与覆盖披露', () => {
    const result: TrendScanResponseV2 = toTrendScanResponse(payload);
    expect(result.items).toHaveLength(1);
    expect(result.scanned).toBe(260);
    expect(result.filters.minScore).toBe(5);
    expect(result.coverage?.unscanned).toBe(34);
    expect(result.truncated).toBe(true);
    expect(result.metricsTradeDate).toBe('20260917');
  });

  it('扫描深度：老响应没有 scanLimit 时按默认 260 回显，0 表示全部', () => {
    // 老服务端不带 scanLimit：降级成默认快速档，不显示成「全部」
    expect(toTrendScanResponse(payload).filters.scanLimit).toBe(260);
    expect(
      toTrendScanResponse({ ...payload, filters: { ...payload.filters, scanLimit: 0 } }).filters
        .scanLimit,
    ).toBe(0);
    expect(
      toTrendScanResponse({ ...payload, filters: { ...payload.filters, scanLimit: 1000 } }).filters
        .scanLimit,
    ).toBe(1000);
    // 非法值（负数）回落到默认档，不把「-1」当深度用
    expect(
      toTrendScanResponse({ ...payload, filters: { ...payload.filters, scanLimit: -1 } }).filters
        .scanLimit,
    ).toBe(260);
  });

  it('老版本服务端没有覆盖字段时降级为「未披露」而不是整体判坏', () => {    const { coverage: _coverage, matchedTotal: _matched, truncated: _truncated, ...rest } = payload;
    void _coverage;
    void _matched;
    void _truncated;
    const result = toTrendScanResponse(rest);
    expect(result.status).toBe('fresh');
    expect(result.coverage).toBeNull();
    expect(result.matchedTotal).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.returnedCount).toBe(1);
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

  it('fetchThemeDetail 走新的 detail 路由并带上 date 与 signal', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(detailPayload)),
    );
    const controller = new AbortController();
    await fetchThemeDetail(
      'BK0900',
      '20260917',
      controller.signal,
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/themes/BK0900/detail?date=20260917');
    expect((init as RequestInit).signal).toBe(controller.signal);
  });

  it('fetchThemeDetail 不传 role（角色不再是请求维度）', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(detailPayload)),
    );
    await fetchThemeDetail('BK0900', undefined, undefined, fetchImpl as unknown as typeof fetch);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('/api/themes/BK0900/detail');
  });

  it('fetchTrendScan 把 filters 序列化成查询参数', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
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
    await expect(fetchThemes(undefined, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      '题材请求失败（502）',
    );
    await expect(
      fetchThemeDetail('BK0900', undefined, undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('题材详情请求失败（502）');
  });

  it('unavailableThemeDetail 是可用的空壳，便于加载态展示', () => {
    const blank = unavailableThemeDetail('加载中');
    expect(blank.status).toBe('unavailable');
    expect(blank.coverage.total).toBe(0);
  });
});

describe('细分逻辑题材（TP: 口径）', () => {
  it('接受 TP: 前缀的题材条目，并保留 scope', () => {
    const result = toThemesResponse(topicsPayload);
    expect(result.status).toBe('fresh');
    expect(result.scope).toBe('topic');
    expect(result.main).toHaveLength(1);
    expect(result.main[0].code).toBe('TP:光通信');
    expect(result.main[0].source).toBe('topic');
  });

  it('拒绝既不是 BK 代码也不是 TP: 前缀的条目', () => {
    const bad = {
      ...topicsPayload,
      main: [{ ...topicItem, code: 'XX:光通信' }],
    };
    expect(toThemesResponse(bad).status).toBe('unavailable');
  });

  it('题材详情请求打到 /api/topics/:key/detail（中文 key 要编码）', async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ schemaVersion: 2 }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchThemeDetail('TP:光通信', '20260918', undefined, impl);
    expect(calls[0]).toBe(`/api/topics/${encodeURIComponent('光通信')}/detail?date=20260918`);
  });

  it('板块口径仍然打到 /api/themes/:code/detail', async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ schemaVersion: 2 }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchThemeDetail('BK0900', undefined, undefined, impl);
    expect(calls[0]).toBe('/api/themes/BK0900/detail');
  });

  it('缺省 scope 的旧板块响应按 board 处理', () => {
    expect(toThemesResponse(themesPayload).scope).toBe('board');
  });
});
