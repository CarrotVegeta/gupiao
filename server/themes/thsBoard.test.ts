/**
 * 同花顺「板块」档（`/api/themes/ths` + `/api/ths-boards/:code/detail`）的编排测试。
 * 全部使用固定上游响应（`fetchImpl` 注入），不发真实网络请求。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearThsPoolCache } from '../limit-up/pool-cache.js';
import { clearThsBoardCaches, buildThsBoardDetail, buildThsBoards } from './thsBoard.js';

const TRADE_DATE = '20260918';

const blockRow = (
  code: string,
  name: string,
  limitUp: number,
  members: Array<Partial<Record<string, unknown>>>,
) => ({
  code,
  name,
  change: 3.21,
  limit_up_num: limitUp,
  continuous_plate_num: 2,
  high: '6天3板',
  days: 4,
  stock_list: members,
});

const member = (code: string, name: string, extra: Record<string, unknown> = {}) => ({
  code,
  name,
  latest: 12.34,
  change_rate: 10.01,
  high: '6天3板',
  // 上游的 continue_num 与 high 对不上（实测「6天3板」的票给 1），连板数按 high 解析
  continue_num: 1,
  reason_type: '光通信+AI赋能',
  reason_info: '据公告，公司拟收购光泰通信 100% 股权。',
  first_limit_up_time: 1789695855,
  last_limit_up_time: 1789698626,
  change_tag: 'FIRST_LIMIT',
  is_st: 0,
  ...extra,
});

/** 上游固定的 20 个板块：家数从 20 递减到 1，便于验证「主线取前 3 且 ≥5」 */
const blockTopPayload = {
  data: Array.from({ length: 20 }, (_, index) =>
    blockRow(`8850${String(index + 10)}`, `板块${index + 1}`, 20 - index, [
      member(`60000${index}`, `股票${index + 1}`),
    ]),
  ),
};

const installFetch = (payload: unknown, status = 200) => {
  const impl = async () => new Response(JSON.stringify(payload), { status });
  return impl as unknown as typeof fetch;
};

/** 同时伺候 block_top 与涨停池：按 URL 分流，用来验证成员被补上封单 / 开板 / 换手 / 流通 */
const installBothFetch = (blockPayload: unknown, poolRows: Array<Record<string, unknown>>) =>
  (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('block_top')) return new Response(JSON.stringify(blockPayload));
    if (url.includes('limit_up_pool')) {
      return new Response(
        JSON.stringify({ data: { info: poolRows, page: { total: poolRows.length } } }),
      );
    }
    throw new Error(`未预期的请求：${url}`);
  }) as unknown as typeof fetch;

beforeEach(() => {
  clearThsBoardCaches();
});

describe('buildThsBoards（同花顺板块总览）', () => {
  it('把上游 Top 20 拆成主线（家数前 3 且 ≥5）与支线，并如实标记 partial', async () => {
    const body = await buildThsBoards(TRADE_DATE, installFetch(blockTopPayload));

    expect(body.scope).toBe('ths');
    expect(body.source).toBe('10jqka');
    // 上游只给 Top 20，本身就是部分覆盖，不能报 fresh
    expect(body.status).toBe('partial');
    expect(body.main).toHaveLength(3);
    expect(body.branch).toHaveLength(17);
    expect(body.pending).toHaveLength(0);

    // 按涨停家数降序，主线就是家数最高的三个
    expect(body.main.map((item) => item.limitUpCount)).toEqual([20, 19, 18]);
    expect(body.main[0].code).toBe('THS:885010');
    expect(body.main[0].name).toBe('板块1');
    expect(body.main[0].source).toBe('ths');
    expect(body.main[0].maxBoardLabel).toBe('6天3板');
    expect(body.main[0].maxBoard).toBe(3);
    // 东财口径的三个家数在同花顺口径下必须是 null，不能填 0 冒充
    expect(body.main[0].conceptLimitUpCount).toBeNull();
    expect(body.main[0].supportedLimitUpCount).toBeNull();
    expect(body.main[0].unresolvedLimitUpCount).toBeNull();
  });

  it('把 Top 20 的覆盖限制写进 warnings，不能让人以为这是全部板块', async () => {
    const body = await buildThsBoards(TRADE_DATE, installFetch(blockTopPayload));

    expect(body.warnings.join('｜')).toContain('Top 20');
    expect(body.warnings.join('｜')).toContain('不是全部板块');
    expect(body.warnings.join('｜')).toContain('没有「驱动有依据');
  });

  it('家数不足 5 家时不硬凑主线（全部进支线）', async () => {
    const payload = {
      data: [
        blockRow('885010', '板块A', 4, [member('600001', '股票A')]),
        blockRow('885011', '板块B', 3, [member('600002', '股票B')]),
      ],
    };
    const body = await buildThsBoards(TRADE_DATE, installFetch(payload));

    expect(body.main).toHaveLength(0);
    expect(body.branch).toHaveLength(2);
  });

  it('上游挂掉时如实返回不可用 + 口径披露，而不是空榜冒充「今天没有板块」', async () => {
    const failing = (async () => {
      throw new Error('同花顺 502');
    }) as unknown as typeof fetch;

    const body = await buildThsBoards(TRADE_DATE, failing);

    expect(body.status).toBe('unavailable');
    expect(body.main).toHaveLength(0);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.error).toContain('502');
  });

  it('结果按交易日缓存（同一交易日的第二次调用不打上游）', async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(blockTopPayload));
    }) as unknown as typeof fetch;

    await buildThsBoards(TRADE_DATE, impl);
    await buildThsBoards(TRADE_DATE, impl);

    expect(calls).toBe(1);
  });
});

describe('buildThsBoardDetail（同花顺板块成员）', () => {
  it('成员来自上游那一次响应，字段按同花顺口径如实映射', async () => {
    const body = await buildThsBoardDetail(TRADE_DATE, '885010', installFetch(blockTopPayload));

    expect(body.theme).toEqual({ code: 'THS:885010', name: '板块1' });
    expect(body.status).toBe('partial');
    expect(body.items).toHaveLength(1);

    const stock = body.items[0];
    expect(stock.symbol).toBe('600000');
    expect(stock.name).toBe('股票1');
    expect(stock.price).toBe(12.34);
    expect(stock.pct).toBe(10.01);
    expect(stock.boardCount).toBe(3);
    expect(stock.highLabel).toBe('6天3板');
    expect(stock.reason).toBe('光通信+AI赋能');
    expect(stock.reasonText).toContain('光泰通信');
    expect(stock.firstSealTime).toBe('09:44:15');
    expect(stock.sealType).toBe('FIRST_LIMIT');
    // 没有判定的地方一律「缺失 / 未知」，不编角色，也不谎称核验过风险
    expect(stock.roles).toEqual([]);
    expect(stock.checks).toEqual({});
    expect(stock.relation.state).toBe('unknown');
    expect(stock.risksChecked).toBe(false);
    expect(stock.metricsState).toBe('missing');
  });

  it('成员数就是 coverage，没有「未扫描」这回事', async () => {
    const body = await buildThsBoardDetail(TRADE_DATE, '885010', installFetch(blockTopPayload));

    expect(body.coverage).toEqual({
      total: 1,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      unscanned: 0,
    });
  });

  it('不在 Top 20 里的板块码明确报不可用（而不是给个空表）', async () => {
    const body = await buildThsBoardDetail(TRADE_DATE, '999999', installFetch(blockTopPayload));

    expect(body.status).toBe('unavailable');
    expect(body.items).toHaveLength(0);
    expect(body.error).toContain('Top 20');
  });

  it('成员里坏行（缺代码 / 缺名称）直接丢掉，不占一行空壳', async () => {
    const payload = {
      data: [
        blockRow('885010', '板块A', 9, [
          member('600001', '股票A'),
          member('', '无代码'),
          member('600003', ''),
        ]),
      ],
    };
    const body = await buildThsBoardDetail(TRADE_DATE, '885010', installFetch(payload));

    expect(body.items.map((item) => item.symbol)).toEqual(['600001']);
  });

  it('从当天涨停池补上封单 / 开板 / 换手 / 流通市值，补不到就留 null', async () => {
    clearThsPoolCache();
    const poolRows = [
      {
        code: '600001',
        name: '股票A',
        latest: 10,
        change_rate: 10,
        high_days: '首板',
        first_limit_up_time: 1789695855,
        last_limit_up_time: 1789695855,
        limit_up_type: '换手板',
        open_num: 2,
        order_amount: 5e7,
        currency_value: 8e9,
        turnover_rate: 7.5,
        reason_type: '光通信',
        reason_info: '公告依据……',
      },
    ];
    const payload = {
      data: [
        blockRow('885010', '板块A', 9, [member('600001', '股票A'), member('600002', '股票B')]),
      ],
    };

    const body = await buildThsBoardDetail(
      TRADE_DATE,
      '885010',
      installBothFetch(payload, poolRows),
    );

    const [a, b] = body.items;
    expect(a.sealAmount).toBe(5e7);
    expect(a.openCount).toBe(2);
    expect(a.turnoverRate).toBe(7.5);
    expect(a.floatMarketCap).toBe(8e9);
    // 没进涨停池的那只：四个字段都是 null，不填 0 冒充
    expect(b.sealAmount).toBeNull();
    expect(b.openCount).toBeNull();
    expect(b.turnoverRate).toBeNull();
    expect(b.floatMarketCap).toBeNull();
  });

  it('成员按「连板高度 → 首封时间 → 封单额」排序，供龙头口径直接用', async () => {
    clearThsPoolCache();
    const payload = {
      data: [
        blockRow('885010', '板块A', 9, [
          member('600001', '首板晚封', { high: '首板', continue_num: 1, first_limit_up_time: 1789700000 }),
          member('600002', '高标', { high: '6天3板', continue_num: 3, first_limit_up_time: 1789699000 }),
          member('600003', '二板早封', { high: '2天2板', continue_num: 2, first_limit_up_time: 1789695000 }),
          member('600004', '二板晚封', { high: '2天2板', continue_num: 2, first_limit_up_time: 1789698000 }),
        ]),
      ],
    };

    const body = await buildThsBoardDetail(TRADE_DATE, '885010', installFetch(payload));

    expect(body.items.map((item) => item.name)).toEqual([
      '高标',
      '二板早封',
      '二板晚封',
      '首板晚封',
    ]);
  });

  it('口径披露里写明排序与「最高板只是机械口径」', async () => {
    const body = await buildThsBoardDetail(TRADE_DATE, '885010', installFetch(blockTopPayload));

    const warnings = body.warnings.join('｜');
    expect(warnings).toContain('连板高度 → 首封时间 → 封单额');
    expect(warnings).toContain('不是推荐');
  });
});
