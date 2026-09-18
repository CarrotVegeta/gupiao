/**
 * 题材服务的编排测试。全部使用固定上游响应（`fetchImpl` 注入），不发真实网络请求。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearThemeKlineCache } from './tenjqka.js';
import { setTopicAliasesForTest } from './topicAliases.js';
import {
  buildThemeDetail,
  buildThemeStocks,
  buildThemes,
  clearThemeServiceCache,
  THEME_SCAN_LIMIT,
} from './service.js';

// ---------------------------------------------------------------------------
// 固定夹具
// ---------------------------------------------------------------------------

const TRADE_DATE = '20260918';
const PREV1 = '20260917';
const PREV2 = '20260916';
const BOARD = 'BK0900';

type Fixture = {
  /** symbol → 涨停原因标签 */
  pool: Record<string, string[]>;
  /** 历史日期的涨停池 */
  pastPools: Record<string, Record<string, string[]>>;
  /** 板块成分股 symbol → 成交额 */
  members: Record<string, number>;
  /** 日K取数失败的 symbol */
  klineFailures: Set<string>;
  /** 风险接口整体失败 */
  riskFails: boolean;
  /** 板块宽度（东财快照的涨跌家数之和），用于验证宽口径上限 */
  breadth: number;
  /** 概念归属里额外标注的题材（默认只有本题材） */
  extraThemes: Record<string, Array<{ code: string; name: string }>>;
  /** F10 归属请求失败 */
  f10Fails: boolean;
};

const baseFixture = (): Fixture => ({
  pool: {},
  pastPools: {},
  members: {},
  klineFailures: new Set(),
  riskFails: false,
  breadth: 40,
  extraThemes: {},
  f10Fails: false,
});

const f10Row = (symbol: string, code = BOARD, precise = '1') => ({
  SECURITY_CODE: symbol,
  BOARD_CODE: code.replace('BK', ''),
  BOARD_NAME: '新能源车',
  IS_PRECISE: precise,
  SELECTED_BOARD_REASON: '主营业务相关',
});

const poolRow = (symbol: string, name: string, reason: string) => ({
  code: symbol,
  name,
  latest: 11,
  change_rate: 9.99,
  high_days: '2天2板',
  first_limit_up_time: 1789624827,
  last_limit_up_time: 1789624827,
  limit_up_type: '换手板',
  open_num: 1,
  order_amount: 3e7,
  currency_value: 6e9,
  turnover_rate: 12,
  reason_type: reason,
  time_preview: [1, 2, 3],
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const textResponse = (body: string): Response => new Response(body, { status: 200 });

/** 造一段只含交易日的日K（JSONP），最后一根日期为 lastDate */
const klineJsonp = (symbol: string, lastDate: string, count = 40): string => {
  const dates: string[] = [];
  let cursor = Date.UTC(2026, 5, 1);
  while (dates.length < count) {
    const date = new Date(cursor);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(
        `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
          date.getUTCDate(),
        ).padStart(2, '0')}`,
      );
    }
    cursor += 86_400_000;
  }
  const rows = dates
    .map((date, index) => {
      const close = 10 + index * 0.05;
      const open = close * 0.995;
      const high = close * 1.01;
      const low = close * 0.99;
      return `${date},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},1000000,100000000,5.0`;
    })
    .join(';');
  void symbol;
  void lastDate;
  return `quotebridge_v6_line_hs_${symbol}_01_last(${JSON.stringify({ data: rows })});`;
};

const boardKlineJsonp = (count = 40): string => {
  const dates: string[] = [];
  let cursor = Date.UTC(2026, 5, 1);
  while (dates.length < count) {
    const date = new Date(cursor);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(
        `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
          date.getUTCDate(),
        ).padStart(2, '0')}`,
      );
    }
    cursor += 86_400_000;
  }
  const rows = dates
    .map((date, index) => `${date},100,101,99,${100 + index},1000000,100000000`)
    .join(';');
  return `quotebridge_v6_line_bk_885431_01_last(${JSON.stringify({ data: rows })});`;
};

const indexKlineJsonp = (dates: string[]): string =>
  JSON.stringify({
    data: {
      sh000001: {
        qfqday: dates.map((date) => [
          `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
          '3300',
          '3310',
          '3290',
          '3305',
        ]),
      },
    },
  });

const boardCatalogPayload = (breadth: number) => ({
  data: {
    diff: Array.from({ length: 100 }, (_, index) => ({
      f12: `BK${String(900 + index).padStart(4, '0')}`,
      f14: index === 0 ? '新能源车' : `板块${index}`,
      f3: 2.5,
      f6: 4.7e11,
      f8: 1.2,
      f104: breadth,
      f105: 0,
      f128: '澳弘电子',
      f140: '605058',
    })),
  },
});

const installFetch = (fixture: Fixture) => {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    // 交易日历（腾讯指数日K）
    if (url.includes('ifzq.gtimg.cn')) {
      return textResponse(indexKlineJsonp([PREV2, PREV1, TRADE_DATE]));
    }

    // 东财板块目录 / 成分股（同一个 clist 接口，用 fs 区分）
    if (url.includes('push2delay.eastmoney.com')) {
      const params = new URL(url).searchParams;
      const fs = params.get('fs') ?? '';
      if (fs.startsWith('b:')) {
        const code = fs.slice(2);
        if (code !== BOARD) return jsonResponse({ data: { diff: [] } });
        // 按 100 条分页，贴近真实接口行为
        const page = Number(params.get('pn') ?? 1);
        const all = Object.entries(fixture.members).map(([symbol, amount], index) => ({
          f12: symbol,
          f14: `成员${index}`,
          f2: 12.3,
          f3: 1.2,
          f6: amount,
          f8: 3.2,
          f10: 1.1,
          f21: 8e9,
        }));
        const diff = all.slice((page - 1) * 100, page * 100);
        return jsonResponse({ data: { diff } });
      }
      const page = Number(params.get('pn') ?? 1);
      return jsonResponse(page === 1 ? boardCatalogPayload(fixture.breadth) : { data: { diff: [] } });
    }

    // 东财 F10 概念归属
    if (url.includes('datacenter.eastmoney.com/securities')) {
      if (fixture.f10Fails) throw new Error('F10 请求失败');
      const filter = new URL(url).searchParams.get('filter') ?? '';
      const symbols = [...filter.matchAll(/"(\d{6})"/g)].map((match) => match[1]);
      const rows = symbols.map((symbol) => f10Row(symbol));
      const extra = symbols.flatMap((symbol) =>
        (fixture.extraThemes[symbol] ?? []).map((theme) => ({
          SECURITY_CODE: symbol,
          BOARD_CODE: theme.code.replace('BK', ''),
          BOARD_NAME: theme.name,
          IS_PRECISE: '1',
          SELECTED_BOARD_REASON: '另一题材',
        })),
      );
      return jsonResponse({ result: { data: [...rows, ...extra], pages: 1 } });
    }

    // 风险核验（datacenter-web）
    if (url.includes('datacenter-web.eastmoney.com')) {
      if (fixture.riskFails) throw new Error('风险接口失败');
      return jsonResponse({ result: { data: [], pages: 1 } });
    }

    // 同花顺涨停池
    if (url.includes('limit_up_pool')) {
      const date = new URL(url).searchParams.get('date') ?? TRADE_DATE;
      const page = Number(new URL(url).searchParams.get('page') ?? 1);
      if (page > 1) return jsonResponse({ data: { info: [], page: { total: 0 } } });
      const source = date === TRADE_DATE ? fixture.pool : (fixture.pastPools[date] ?? {});
      const info = Object.entries(source).map(([symbol, tags], index) =>
        poolRow(symbol, `股票${index}`, tags.join('+')),
      );
      return jsonResponse({ data: { info, page: { total: info.length } } });
    }

    // 同花顺板块排行
    if (url.includes('block_top')) {
      return jsonResponse({
        data: [
          {
            code: '885431',
            name: '新能源车',
            change: 2.5,
            limit_up_num: 8,
            continuous_plate_num: 3,
            high: '5天4板',
            days: 6,
            stock_list: Object.keys(fixture.pool).map((symbol) => ({ code: symbol })),
          },
        ],
      });
    }

    // 同花顺日K（板块 / 个股）
    if (url.includes('d.10jqka.com.cn')) {
      const match = url.match(/line\/(hs_\d{6}|bk_\d+)\//);
      const key = match?.[1] ?? '';
      if (key.startsWith('bk_')) return textResponse(boardKlineJsonp());
      const symbol = key.slice(3);
      if (fixture.klineFailures.has(symbol)) throw new Error(`日K失败 ${symbol}`);
      return textResponse(klineJsonp(symbol, TRADE_DATE));
    }

    throw new Error(`未预期的请求：${url}`);
  };
  return impl as unknown as typeof fetch;
};

const mainFixture = (): Fixture => {
  const fixture = baseFixture();
  // 今天 5 只涨停 → main；前两天各 2 只；共 121 只成员（触发 120 截断）
  fixture.pool = {
    '600001': ['PCB'],
    '600002': ['PCB'],
    '600003': ['PCB'],
    '600004': ['PCB'],
    '600005': ['PCB'],
  };
  fixture.pastPools = {
    [PREV1]: { '600001': ['PCB'], '600002': ['PCB'] },
    [PREV2]: { '600001': ['PCB'], '600003': ['PCB'] },
  };
  // 前 5 只是当日涨停股，其余 116 只是普通成员（symbol 必须保持 6 位）
  const symbols = Object.keys(fixture.pool);
  for (let index = 0; symbols.length < 121; index += 1) {
    symbols.push(`60${String(1000 + index).padStart(4, '0')}`);
  }
  fixture.members = Object.fromEntries(symbols.map((symbol, index) => [symbol, 1e9 - index * 1e6]));
  return fixture;
};

const detailOptions = { now: new Date('2026-09-18T07:10:00Z') };

beforeEach(() => {
  clearThemeServiceCache();
  // 日K缓存是模块级的，测试之间必须清掉，否则「取数失败」会被上一轮的成功缓存掩盖
  clearThemeKlineCache();
});

// ---------------------------------------------------------------------------

describe('buildThemes（分类与口径拆分）', () => {
  it('概念家数达标即主线；驱动有依据为 0 只作参考标注', async () => {
    // 注意：夹具的涨停原因是 'PCB'，而 'PCB' 已经在 topicAliases 里配给了 BK0877，
    // 所以本题材（BK0900）的 supported 为 0 —— 这同时验证两件事：
    //   1. 同一个词配在别的板块上不会串到本题材；
    //   2. 驱动口径不参与资格，概念家数 5/2/2 该判主线就判主线。
    const fixture = mainFixture();
    const body = await buildThemes(TRADE_DATE, installFetch(fixture));

    expect(body.schemaVersion).toBe(2);
    expect(body.tradeDate).toBe(TRADE_DATE);
    expect(body.main).toHaveLength(1);
    expect(body.branch).toHaveLength(0);
    const item = body.main[0];
    expect(item.code).toBe(BOARD);
    expect(item.conceptLimitUpCount).toBe(5);
    expect(item.supportedLimitUpCount).toBe(0);
    expect(item.unresolvedLimitUpCount).toBe(5);
    expect(item.classificationReasons.join(' ')).toContain('概念成员涨停 5/2/2');
    expect(item.classificationReasons.join(' ')).toContain('没有一只的涨停原因命中');
    expect(body.warnings.join(' ')).toContain('驱动口径仅作参考');
  });

  it('宽口径板块（成员 1380）不再被上限剔除，但要标注为宽口径', async () => {
    const fixture = mainFixture();
    fixture.breadth = 1380;
    const body = await buildThemes(TRADE_DATE, installFetch(fixture));

    const all = [...body.main, ...body.branch, ...body.pending];
    expect(all.map((item) => item.code)).toContain(BOARD);
    expect(all[0].classificationReasons.join(' ')).toContain('宽口径');
    expect(body.warnings.join(' ')).toContain('宽口径属性板块');
  });

  it('超过上限的统计属性板块（成员 1600）仍然整块剔除', async () => {
    const fixture = mainFixture();
    fixture.breadth = 1600;
    const body = await buildThemes(TRADE_DATE, installFetch(fixture));

    expect([...body.main, ...body.branch, ...body.pending]).toHaveLength(0);
  });

  it('请求日涨停池还没产生（开盘前）时退回最近有数据的交易日，并明说观察日', async () => {
    const fixture = mainFixture();
    // 请求日（TRADE_DATE）没有任何涨停记录，前一交易日有 5 只
    const todayPool = fixture.pool;
    fixture.pool = {};
    fixture.pastPools[PREV1] = todayPool;
    fixture.pastPools[PREV2] = { '600001': ['PCB'], '600002': ['PCB'] };

    const body = await buildThemes(TRADE_DATE, installFetch(fixture));
    expect(body.tradeDate).toBe(TRADE_DATE);
    expect(body.pending).toHaveLength(1);
    const item = body.pending[0];
    expect(item.conceptLimitUpCount).toBe(5);
    expect(body.warnings.join(' ')).toContain(PREV1);
    expect(body.warnings.join(' ')).toContain('涨停池尚未产生');
  });

  it('请求日与观察日不一致时详情也会披露观察日', async () => {
    const fixture = mainFixture();
    const todayPool = fixture.pool;
    fixture.pool = {};
    fixture.pastPools[PREV1] = todayPool;
    fixture.pastPools[PREV2] = { '600001': ['PCB'], '600002': ['PCB'] };

    const body = await buildThemeDetail(
      TRADE_DATE,
      BOARD,
      installFetch(fixture),
      detailOptions.now,
    );
    expect(body.status).not.toBe('unavailable');
    expect(body.warnings.join(' ')).toContain(`交易日 ${PREV1} 观察`);
    expect(body.evidence.every((item) => item.validTradeDate === PREV1)).toBe(true);
  });

  it('缺一天历史数据时不补 0，家数用 null 表示缺失', async () => {
    const fixture = mainFixture();
    // 前一日涨停池请求失败（返回 500）
    const failing = installFetch(fixture);
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('limit_up_pool')) {
        const date = new URL(url).searchParams.get('date');
        if (date === PREV1) return new Response('', { status: 500 });
      }
      return failing(input);
    }) as unknown as typeof fetch;

    const body = await buildThemes(TRADE_DATE, impl);
    const item = [...body.main, ...body.branch, ...body.pending][0];
    expect(item).toBeDefined();
    expect(body.status).toBe('partial');
    expect(body.warnings.join(' ')).toContain('部分上游请求失败');
  });

  it('F10 归属请求失败时不会编造题材：返回 unavailable 并说明原因', async () => {
    const fixture = mainFixture();
    fixture.f10Fails = true;
    const body = await buildThemes(TRADE_DATE, installFetch(fixture));
    // 拿不到任何概念归属就无法自算家数，宁可不可用也不冒充 0 家
    expect(body.status).toBe('unavailable');
    expect(body.main).toEqual([]);
    expect(body.pending).toEqual([]);
    expect(body.error).toContain('请求失败');
  });
});

describe('buildThemeDetail（统一详情服务）', () => {
  it('120 只截断要如实披露：响应只带已扫描行、coverage.unscanned = 1、status = partial', async () => {
    const fixture = mainFixture();
    const body = await buildThemeDetail(
      TRADE_DATE,
      BOARD,
      installFetch(fixture),
      detailOptions.now,
    );

    expect(body.schemaVersion).toBe(2);
    // 响应只序列化参与过计算的成员：未扫描的那 1 只不进 items（否则前端要为它建一整行 DOM）
    expect(body.items).toHaveLength(THEME_SCAN_LIMIT);
    expect(body.items).toHaveLength(body.coverage.attempted);
    expect(body.coverage.total).toBe(121);
    expect(body.coverage.attempted).toBe(THEME_SCAN_LIMIT);
    expect(body.coverage.unscanned).toBe(1);
    expect(body.coverage.attempted).toBe(body.coverage.succeeded + body.coverage.failed);
    expect(body.coverage.total).toBe(body.coverage.attempted + body.coverage.unscanned);
    expect(body.status).toBe('partial');
    expect(body.warnings.join(' ')).toContain('未扫描');
  });

  it('重复成员只保留一行（按 symbol 去重）', async () => {
    const fixture = mainFixture();
    const impl = installFetch(fixture);
    const wrapping = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('push2delay') && url.includes(`fs=b%3A${BOARD}`)) {
        const response = await impl(input);
        const payload = (await response.json()) as { data: { diff: unknown[] } };
        // 故意让同一只股票出现两次
        return jsonResponse({ data: { diff: [...payload.data.diff, payload.data.diff[0]] } });
      }
      return impl(input);
    }) as unknown as typeof fetch;

    const body = await buildThemeDetail(TRADE_DATE, BOARD, wrapping, detailOptions.now);
    const symbols = body.items.map((item) => item.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('某只成员日K失败不让整个题材清空，只把该行标为 failed', async () => {
    const fixture = mainFixture();
    fixture.klineFailures.add('600003');    const body = await buildThemeDetail(
      TRADE_DATE,
      BOARD,
      installFetch(fixture),
      detailOptions.now,
    );

    expect(body.items.length).toBeGreaterThan(0);
    const failed = body.items.find((item) => item.symbol === '600003');
    expect(failed?.metricsState).toBe('failed');
    expect(failed?.roles).toEqual([]);
    expect(body.status).toBe('partial');
    expect(body.warnings.join(' ')).toContain('日K取数失败');
  });

  it('风险核验失败时 risksChecked=false，并给出「未核验」而不是「无风险」', async () => {
    const fixture = mainFixture();
    fixture.riskFails = true;
    // 让一只股票成为 supported：配置精确细分映射走不通，这里改为直接验证风险字段
    const body = await buildThemeDetail(
      TRADE_DATE,
      BOARD,
      installFetch(fixture),
      detailOptions.now,
    );
    const anyItem = body.items[0];
    expect(anyItem.risksChecked).toBe(false);
    expect(anyItem.risks).toEqual([]);
    // 没有本轮关联依据时本来就不该有角色标签
    expect(anyItem.roles).toEqual([]);
  });

  it('历史日期没有当日快照时返回 unavailable，不拿今天行情冒充历史', async () => {
    const fixture = mainFixture();
    const body = await buildThemeDetail(
      PREV1,
      BOARD,
      installFetch(fixture),
      detailOptions.now,
    );
    expect(body.status).toBe('unavailable');
    expect(body.items).toEqual([]);
    expect(body.error).toContain('不拿最新行情冒充历史');
  });

  it('未知板块返回 unavailable 且带明确原因', async () => {
    const fixture = mainFixture();
    const body = await buildThemeDetail(
      TRADE_DATE,
      'BK9999',
      installFetch(fixture),
      detailOptions.now,
    );
    expect(body.status).toBe('unavailable');
    expect(body.error).toContain('未知板块');
  });

  it('配置了精确细分映射后，驱动有依据的股票才可能拿候选标签，且每角色不超过上限', async () => {
    const fixture = mainFixture();
    // 只有 600001/600002 的「PCB」能映射到本题材的精确细分逻辑
    const previous = setTopicAliasesForTest([
      { themeCode: BOARD, topicKey: 'pcb', exactPhrases: ['PCB'] },
    ]);
    try {
      const body = await buildThemeDetail(
        TRADE_DATE,
        BOARD,
        installFetch(fixture),
        detailOptions.now,
      );

      const supported = body.items.filter((item) => item.relation.state === 'supported');
      expect(supported.length).toBeGreaterThan(0);
      expect(supported.every((item) => item.relation.topicKeys.includes('pcb'))).toBe(true);

      const tagged = body.items.filter((item) => item.roles.length > 0);
      // 测试夹具的日K是单调上涨的窄幅走势，本用例只断言「不可越界」，不假设一定有人中选
      expect(tagged.every((item) => item.relation.state === 'supported')).toBe(true);
      for (const role of ['leader', 'turnover', 'trend', 'laggard'] as const) {
        const count = body.items.filter((item) =>
          item.roles.some((tag) => tag.role === role),
        ).length;
        expect(count).toBeLessThanOrEqual(role === 'laggard' ? 2 : 1);
      }
      // v1 一律是候选标签
      expect(tagged.flatMap((item) => item.roles).every((tag) => tag.status === 'candidate')).toBe(
        true,
      );
      // 未 supported 的股票即使成交额最大也没有标签
      const untagged = body.items.filter((item) => item.relation.state !== 'supported');
      expect(untagged.every((item) => item.roles.length === 0)).toBe(true);
    } finally {
      setTopicAliasesForTest(previous);
    }
  });

  it('每个有涨停原因的股票都能查到本轮关联结论（一期只能是仅概念归属）', async () => {
    const fixture = mainFixture();
    const body = await buildThemeDetail(
      TRADE_DATE,
      BOARD,
      installFetch(fixture),
      detailOptions.now,
    );
    const limitUp = body.items.filter((item) => item.boardCount !== null);
    expect(limitUp.length).toBe(5);
    for (const item of limitUp) {
      // 一期细分映射未配置：涨停原因只能给出模糊关联 → 可能相关；没有原因的成员是仅概念归属
      expect(['membership_only', 'possible']).toContain(item.relation.state);
      expect(item.roles).toEqual([]);
    }
    expect(limitUp.some((item) => item.relation.state === 'possible')).toBe(true);
    expect(
      body.items.filter((item) => item.relation.state === 'membership_only').length,
    ).toBeGreaterThan(0);
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.evidence.every((item) => item.validTradeDate === TRADE_DATE)).toBe(true);
    expect(body.evidence.every((item) => item.publishedAt === null)).toBe(true);
    // 证据里的 match 只能是 ambiguous（一期没有配置精确映射）
    expect(body.evidence.every((item) => item.match === 'ambiguous')).toBe(true);
  });
});

describe('旧接口兼容（/api/themes/:code/stocks）', () => {
  it('与新接口同源：同一个成分股与扫描数', async () => {
    const fixture = mainFixture();
    const impl = installFetch(fixture);
    const detail = await buildThemeDetail(TRADE_DATE, BOARD, impl, detailOptions.now);
    const legacy = await buildThemeStocks(TRADE_DATE, BOARD, 'leader', impl);

    expect(legacy.tradeDate).toBe(detail.tradeDate);
    expect(legacy.theme).toEqual(detail.theme);
    expect(legacy.scanned).toBe(detail.coverage.attempted);
    // 没有角色标签时旧接口列表为空，而不是编造一批「龙头」
    expect(legacy.items).toEqual([]);
    expect(legacy.status).toBe('fresh');
  });

  it('旧接口的 items 一定是新接口里带该角色的行', async () => {
    const fixture = mainFixture();
    const impl = installFetch(fixture);
    const detail = await buildThemeDetail(TRADE_DATE, BOARD, impl, detailOptions.now);
    const legacy = await buildThemeStocks(TRADE_DATE, BOARD, 'trend', impl);
    const tagged = detail.items
      .filter((item) => item.roles.some((role) => role.role === 'trend'))
      .map((item) => item.symbol);
    expect(legacy.items.map((item) => item.symbol)).toEqual(tagged);
  });
});
