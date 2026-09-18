/**
 * 涨停池补字段（同花顺 join）的测试：全部注入 fetchImpl，不发真实网络请求。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { LimitUpResponse } from '../../src/types.js';
import { clearThsPoolCache } from './pool-cache.js';
import { enrichLimitUpWithThs, joinThsFieldsForTest } from './ths-fields.js';

const TRADE_DATE = '20260918';

const eastmoneyResponse = (symbols: string[]): LimitUpResponse => ({
  tradeDate: TRADE_DATE,
  items: symbols.map((symbol) => ({
    symbol,
    name: `股票${symbol.slice(-2)}`,
    price: 10,
    pct: 10.01,
    boardCount: 1,
    firstSealTime: '09:35:00',
    lastSealTime: '09:35:00',
    industry: '半导体',
    breakCount: 0,
  })),
  fetchedAt: '2026-09-18T08:00:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
});

const poolPayload = (rows: Array<{ code: string; reason: string }>) => ({
  data: {
    info: rows.map((row) => ({
      code: row.code,
      name: `股票${row.code.slice(-2)}`,
      latest: 10,
      change_rate: 10,
      high_days: '首板',
      first_limit_up_time: 1789695855,
      last_limit_up_time: 1789695855,
      limit_up_type: '换手板',
      open_num: 1,
      order_amount: 5e7,
      currency_value: 8e9,
      turnover_rate: 7.5,
      reason_type: row.reason,
      reason_info: `${row.reason} 的公告依据……`,
    })),
    page: { total: rows.length },
  },
});

const installFetch = (payload: unknown) =>
  (async () => new Response(JSON.stringify(payload))) as unknown as typeof fetch;

beforeEach(() => {
  clearThsPoolCache();
});

describe('joinThsFieldsForTest', () => {
  it('按代码把涨停原因 / 封单 / 开板 / 换手 / 流通市值补到东财池的行上', () => {
    const { items, joined } = joinThsFieldsForTest(eastmoneyResponse(['600001']).items, [
      {
        symbol: '600001',
        name: '股票01',
        price: 10,
        pct: 10,
        boardCount: 1,
        highLabel: '首板',
        firstSealTime: '09:35:00',
        lastSealTime: '09:35:00',
        sealType: '换手板',
        openCount: 1,
        sealAmount: 5e7,
        floatMarketCap: 8e9,
        turnoverRate: 7.5,
        reasonTags: ['光通信', 'AI赋能'],
        reasonText: '公告依据……',
        intraday: [],
      },
    ]);

    expect(joined).toBe(1);
    expect(items[0].reason).toBe('光通信+AI赋能');
    expect(items[0].reasonText).toBe('公告依据……');
    expect(items[0].sealAmount).toBe(5e7);
    expect(items[0].openCount).toBe(1);
    expect(items[0].turnoverRate).toBe(7.5);
    expect(items[0].floatMarketCap).toBe(8e9);
  });

  it('join 不上的行原样保留（不填 0、不改已有字段）', () => {
    const { items, joined } = joinThsFieldsForTest(eastmoneyResponse(['600001']).items, []);

    expect(joined).toBe(0);
    expect(items[0].reason).toBeUndefined();
    expect(items[0].boardCount).toBe(1);
    expect(items[0].industry).toBe('半导体');
  });
});

describe('enrichLimitUpWithThs', () => {
  it('正常路径：结果被补上同花顺字段，主结果（家数 / 连板）不动', async () => {
    const enriched = await enrichLimitUpWithThs(
      TRADE_DATE,
      eastmoneyResponse(['600001', '600002']),
      installFetch(poolPayload([{ code: '600001', reason: '光通信+AI赋能' }])),
    );

    expect(enriched.items).toHaveLength(2);
    expect(enriched.items[0].reason).toBe('光通信+AI赋能');
    // 没补上的那一只：字段缺省，其它字段照旧
    expect(enriched.items[1].reason).toBeUndefined();
    expect(enriched.items[1].industry).toBe('半导体');
    expect(enriched.tradeDate).toBe(TRADE_DATE);
    expect(enriched.status).toBe('fresh');
    // fresh 不能带 error：补充失败也不写 error（前端会把 fresh+error 判成坏数据）
    expect(enriched.error).toBeNull();
  });

  it('同花顺挂掉时原样返回，不让整页变成不可用', async () => {
    const failing = (async () => {
      throw new Error('同花顺 502');
    }) as unknown as typeof fetch;

    const response = eastmoneyResponse(['600001']);
    const enriched = await enrichLimitUpWithThs(TRADE_DATE, response, failing);

    expect(enriched).toBe(response);
    expect(enriched.status).toBe('fresh');
  });

  it('池子本身不可用时不做无谓的上游请求', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response('{}');
    }) as unknown as typeof fetch;

    const unavailable: LimitUpResponse = {
      ...eastmoneyResponse([]),
      status: 'unavailable',
      error: '上游失败',
    };
    const enriched = await enrichLimitUpWithThs(TRADE_DATE, unavailable, counting);

    expect(enriched).toBe(unavailable);
    expect(calls).toBe(0);
  });

  it('同一交易日第二次补充走缓存，不重复打上游', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(poolPayload([{ code: '600001', reason: '光通信' }])));
    }) as unknown as typeof fetch;

    await enrichLimitUpWithThs(TRADE_DATE, eastmoneyResponse(['600001']), counting);
    await enrichLimitUpWithThs(TRADE_DATE, eastmoneyResponse(['600001']), counting);

    expect(calls).toBe(1);
  });
});
