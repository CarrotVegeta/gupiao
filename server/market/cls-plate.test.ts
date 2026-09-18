import { describe, expect, it, vi } from 'vitest';
import {
  clsPlateSign,
  clearPlateStocksCache,
  exchangeOf,
  fetchPlateStocks,
  normalizeStockCode,
  parseAmountText,
} from './cls-plate.js';

/** 真实响应片段（2026-09-19 实测，财联社 plate/stocks?plate_code=cls80457） */
const fixture = {
  code: 200,
  msg: '',
  data: {
    has_core: 1,
    stocks: [
      {
        stock_code: '920298.BJ',
        stock_name: '腾信精密',
        assoc_desc: '公司半导体设备零部件包括真空泵腔体…',
        is_core: 0,
        last_px: '90.48',
        change: '+30.00%',
        change_px: 20.88,
        col1: '0',
        col2: '13.8亿',
      },
      {
        stock_code: 'sz301583',
        stock_name: '托伦斯',
        assoc_desc: '公司专注于为半导体设备提供精密金属零部件产品。',
        is_core: 1,
        last_px: '142.56',
        change: '+20.00%',
        change_px: 23.76,
        col1: '1',
        col2: '44.0亿',
      },
      {
        stock_code: 'sh688200',
        stock_name: '华峰测控',
        assoc_desc: '',
        is_core: 1,
        last_px: '407.93',
        change: '-1.50%',
        change_px: -6.21,
        col1: '0',
        col2: null,
      },
    ],
  },
};

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('clsPlateSign', () => {
  it('参数按 key 排序后 SHA1 再 MD5，且覆盖除 sign 外的全部参数', () => {
    const a = clsPlateSign({ b: '2', a: '1' });
    const b = clsPlateSign({ a: '1', b: '2' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('normalizeStockCode', () => {
  it('三种前缀写法都归一成 6 位数字', () => {
    expect(normalizeStockCode('920298.BJ')).toBe('920298');
    expect(normalizeStockCode('sz301583')).toBe('301583');
    expect(normalizeStockCode('sh688200')).toBe('688200');
    expect(normalizeStockCode('')).toBeNull();
  });
});

describe('exchangeOf', () => {
  it('北交所 92 段不能被误判成上交所（实测踩到过）', () => {
    expect(exchangeOf('920298')).toBe('BJ');
    expect(exchangeOf('830799')).toBe('BJ');
    expect(exchangeOf('430139')).toBe('BJ');
  });

  it('沪市与深市', () => {
    expect(exchangeOf('600519')).toBe('SH');
    expect(exchangeOf('688200')).toBe('SH');
    expect(exchangeOf('301583')).toBe('SZ');
    expect(exchangeOf('002161')).toBe('SZ');
  });
});

describe('parseAmountText', () => {
  it('解析「亿」「万」并取整到元（避免浮点尾数）', () => {
    expect(parseAmountText('13.8亿')).toBe(1_380_000_000);
    expect(parseAmountText('44.0亿')).toBe(4_400_000_000);
    expect(parseAmountText('3120万')).toBe(31_200_000);
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText(null)).toBeNull();
    expect(parseAmountText('--')).toBeNull();
  });
});

describe('fetchPlateStocks', () => {
  it('正常路径：行情与入选理由都解析出来，核心票计数正确', async () => {
    clearPlateStocksCache();
    const fetchImpl = vi.fn(async () => jsonResponse(fixture));
    const result = await fetchPlateStocks('cls80457', fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe('fresh');
    expect(result.stocks).toHaveLength(3);
    expect(result.coreCount).toBe(2);
    expect(result.hasCore).toBe(true);

    const first = result.stocks[0];
    expect(first).toMatchObject({
      symbol: '920298',
      name: '腾信精密',
      exchange: 'BJ',
      isCore: false,
      price: 90.48,
      pct: 30,
      amount: 1_380_000_000,
    });

    const second = result.stocks[1];
    expect(second).toMatchObject({ symbol: '301583', exchange: 'SZ', isCore: true });
    // 负涨幅也要能解析
    expect(result.stocks[2].pct).toBe(-1.5);
    // col2 为 null 时成交额按缺失处理，不给 0
    expect(result.stocks[2].amount).toBeNull();
  });

  it('请求带上 plate_code 与 sign', async () => {
    clearPlateStocksCache();
    const fetchImpl = vi.fn(async (_input: unknown) => jsonResponse(fixture));
    await fetchPlateStocks('cls80189', fetchImpl as unknown as typeof fetch);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('plate_code=cls80189');
    expect(url).toContain('sign=');
    expect(url).toContain('app=cailianpress');
  });

  it('上游 code 非 200 时按不可用处理，不抛异常', async () => {
    clearPlateStocksCache();
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 9004, msg: 'not found', data: null }));
    const result = await fetchPlateStocks('cls99999', fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe('unavailable');
    expect(result.stocks).toHaveLength(0);
    expect(result.error?.message).toContain('9004');
  });

  it('HTTP 失败与网络异常都不抛，返回错误说明', async () => {
    clearPlateStocksCache();
    const bad = vi.fn(async () => new Response('boom', { status: 502 }));
    expect((await fetchPlateStocks('cls80457', bad as unknown as typeof fetch)).status).toBe('unavailable');

    clearPlateStocksCache();
    const boom = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await fetchPlateStocks('cls80457', boom as unknown as typeof fetch);
    expect(result.status).toBe('unavailable');
    expect(result.error?.message).toContain('socket hang up');
  });

  it('空成员按不可用处理，不冒充「0 只股票的正常结果」', async () => {
    clearPlateStocksCache();
    const empty = vi.fn(async () => jsonResponse({ code: 200, msg: '', data: { has_core: 0, stocks: [] } }));
    const result = await fetchPlateStocks('cls80361', empty as unknown as typeof fetch);
    expect(result.status).toBe('unavailable');
    expect(result.error?.message).toContain('为空');
  });

  it('成功结果会短时缓存：第二次不再打上游', async () => {
    clearPlateStocksCache();
    const fetchImpl = vi.fn(async () => jsonResponse(fixture));
    await fetchPlateStocks('cls80457', fetchImpl as unknown as typeof fetch);
    await fetchPlateStocks('cls80457', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
