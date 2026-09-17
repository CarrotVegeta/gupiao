import { beforeEach, describe, expect, it } from 'vitest';
import type { TrendFilters } from '../../src/types.js';
import { clearThemeKlineCache, type KlineBar } from '../themes/tenjqka.js';
import {
  DEFAULT_FILTERS,
  evaluateScanPattern,
  parseTrendFilters,
  resolveCompletedBars,
  scanTrend,
} from './trend.js';

// ---------------------------------------------------------------------------
// 夹具：完全不发真实网络请求，日K用固定 JSONP 文本喂给适配器
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** 2026-08-03 起按自然日排；只要求日期是有序的 8 位数字 */
const dateAt = (index: number): string => {
  const date = new Date(Date.UTC(2026, 7, 3) + index * DAY_MS);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
};

const LAST_INDEX = 29;
/** 目标交易日比最后一根日K晚一天：按「更早的交易日必然已收盘」这条规则算已完成 */
const NEXT_TRADE_DATE = dateAt(LAST_INDEX + 1);

type BarOptions = {
  count?: number;
  /** 最后 shrinkCount 根已完成日的成交量倍率（相对此前 5 日均量） */
  shrink?: number;
  shrinkCount?: number;
  /** 每根日K的成交额（元） */
  amount?: number;
};

/** 缓涨序列：MA5>MA10>MA20、10 日涨幅约 4.6%、距 MA5 约 +0.9% */
const makeBars = (options: BarOptions = {}): KlineBar[] => {
  const count = options.count ?? 30;
  const amount = options.amount ?? 600_000_000;
  const shrink = options.shrink ?? 0.8;
  const shrinkCount = options.shrinkCount ?? 1;

  const bars: KlineBar[] = [];
  for (let index = 0; index < count; index += 1) {
    const close = 10 + index * 0.05;
    bars.push({
      date: dateAt(index),
      open: close - 0.02,
      high: close + 0.05,
      low: close - 0.05,
      close,
      volume: 1_000_000,
      amount,
      turnoverRate: 3,
    });
  }
  for (let index = count - shrinkCount; index < count; index += 1) {
    bars[index].volume = Math.round(1_000_000 * shrink);
  }
  return bars;
};

const klineText = (bars: KlineBar[]): string =>
  bars
    .map((bar) =>
      [
        bar.date,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.amount ?? 0,
        bar.turnoverRate ?? 0,
      ].join(','),
    )
    .join(';');

const jsonpResponse = (payload: unknown): Response =>
  new Response(`jsonp(${JSON.stringify(payload)})`, {
    status: 200,
    headers: { 'Content-Type': 'text/javascript' },
  });

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

type StockFixture = {
  symbol: string;
  name?: string;
  /** 当日成交额（元），只影响快速扫描的排序优先级 */
  amount?: number;
  /** 上游行情快照给的所属行业板块（clist f100） */
  industry?: string;
  /** null / 省略 = 取不到日K */
  bars?: KlineBar[] | null;
};

const PAGE_SIZE = 100;

/** 全市场行情快照 + 个股日K 的固定上游 */
const marketFetch = (stocks: StockFixture[]): typeof fetch => {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const kline = url.match(/\/v6\/line\/hs_(\d{6})\//);
    if (kline) {
      const stock = stocks.find((item) => item.symbol === kline[1]);
      return jsonpResponse({ data: stock?.bars ? klineText(stock.bars) : '' });
    }

    const page = Number(new URL(url).searchParams.get('pn') ?? '1');
    const slice = stocks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return jsonResponse({
      data: {
        diff: slice.map((item) => ({
          f12: item.symbol,
          f14: item.name ?? `测试${item.symbol}`,
          f2: 10,
          f3: 1,
          f6: item.amount ?? 100_000_000,
          f8: 3,
          f10: 1,
          f21: 5_000_000_000,
          // f100 = 所属行业板块；夹具里没给就留空，和上游缺字段时的表现一致
          f100: item.industry ?? '',
        })),
      },
    });
  };
  return impl as unknown as typeof fetch;
};

const allScope: TrendFilters = { ...DEFAULT_FILTERS, themeScope: 'all' };

beforeEach(() => {
  // 日K适配器有 10 分钟内存缓存，测试之间必须清掉，否则拿到上一组夹具
  clearThemeKlineCache();
});

// ---------------------------------------------------------------------------
// 1. 缩量条件改名：只比较量能，不再说「回调」
// ---------------------------------------------------------------------------

describe('缩量条件文案', () => {
  it('只缩量但上涨的K线，文案里不出现「回调」', () => {
    const bars = makeBars({ shrink: 0.8 });
    const last = bars[bars.length - 1];
    // 这根日K是上涨的（收 > 前收），所以谈不上「回调」，文案也不该这么说
    expect(last.close).toBeGreaterThan(bars[bars.length - 2].close);

    const evaluation = evaluateScanPattern(bars, DEFAULT_FILTERS, { tradeDate: NEXT_TRADE_DATE });
    expect(evaluation).not.toBeNull();
    if (evaluation === null) return;

    const text = [...evaluation.matched, ...evaluation.unmatched].join(' ');
    expect(text).not.toContain('回调');
    expect(text).toContain('缩量（最近已完成日成交量/此前5日均量）');
    expect(evaluation.shrink).toBeCloseTo(0.8, 4);
    expect(evaluation.score).toBe(5);
    expect(evaluation.notes.join(' ')).not.toContain('回调');
  });

  it('距 5 日线用绝对偏离口径，结果是有向值', () => {
    const evaluation = evaluateScanPattern(makeBars(), DEFAULT_FILTERS, {
      tradeDate: NEXT_TRADE_DATE,
    });
    expect(evaluation).not.toBeNull();
    if (evaluation === null) return;

    const text = [...evaluation.matched, ...evaluation.unmatched].join(' ');
    expect(text).toContain('绝对偏离');
    expect(text).toMatch(/距 5 日线 \+\d+\.\d+%/);
    expect(evaluation.distMa5).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 未完成日K不参与计算
// ---------------------------------------------------------------------------

describe('已完成交易日的判定', () => {
  it('最后一根严格早于目标交易日 → 可以当已完成', () => {
    const bars = makeBars();
    const resolved = resolveCompletedBars(bars, { tradeDate: NEXT_TRADE_DATE });
    expect(resolved.bars).toHaveLength(bars.length);
    expect(resolved.lastBarCompleted).toBe(true);
  });

  it('没有可信完成信息时不拿本机日期猜，按未完成处理', () => {
    const bars = makeBars();
    const resolved = resolveCompletedBars(bars, {});
    expect(resolved.bars).toHaveLength(bars.length - 1);
    expect(resolved.lastBarCompleted).toBeNull();
    expect(resolved.excludedDate).toBe(bars[bars.length - 1].date);
  });

  it('上游明确标记未完成 → 剔除最后一根', () => {
    const bars = makeBars();
    const resolved = resolveCompletedBars(bars, { lastBarCompleted: false });
    expect(resolved.bars).toHaveLength(bars.length - 1);
    expect(resolved.lastBarCompleted).toBe(false);
  });
});

describe('盘中未完成日K', () => {
  it('不参与全天量比较：拿半天量比全天均量会算出一个假的缩量', () => {
    const bars = makeBars({ shrink: 0.8, shrinkCount: 2 });
    const lastIndex = bars.length - 1;
    // 最后一根就是目标交易日，且只有半天量
    bars[lastIndex].volume = 200_000;

    const evaluation = evaluateScanPattern(bars, DEFAULT_FILTERS, {
      tradeDate: bars[lastIndex].date,
    });
    expect(evaluation).not.toBeNull();
    if (evaluation === null) return;

    expect(evaluation.lastBarCompleted).toBeNull();
    expect(evaluation.metricsTradeDate).toBe(bars[lastIndex - 1].date);
    // 半天量/全天均量 = 0.2 会得出「缩量」，这是错的；正确口径是上一根已完成日
    expect(evaluation.shrink).toBeCloseTo(0.8, 4);
    expect(evaluation.shrink).not.toBeCloseTo(0.2, 2);
    expect(evaluation.notes.join(' ')).toContain('未参与形态计算');
  });

  it('上游明确标记已完成时，最后一根才参与计算', () => {
    const bars = makeBars({ shrink: 0.8, shrinkCount: 2 });
    const lastIndex = bars.length - 1;
    bars[lastIndex].volume = 200_000;

    const evaluation = evaluateScanPattern(bars, DEFAULT_FILTERS, { lastBarCompleted: true });
    expect(evaluation).not.toBeNull();
    if (evaluation === null) return;
    expect(evaluation.metricsTradeDate).toBe(bars[lastIndex].date);
    expect(evaluation.lastBarCompleted).toBe(true);
    expect(evaluation.shrink).toBeCloseTo(200_000 / 960_000, 4);
  });
});

// ---------------------------------------------------------------------------
// 3. 成交额：预筛不再剔除，近5日均额是日K之后的独立门槛
// ---------------------------------------------------------------------------

describe('成交额门槛', () => {
  it('近5日均额达标但当天成交额小的股票不会被预筛删掉', async () => {
    const fetchImpl = marketFetch([
      // 当天成交额 1 亿（低于旧预筛的 3.5 亿），但近5日均额 6 亿达标
      { symbol: '600001', name: '小量达标', amount: 100_000_000, bars: makeBars({ amount: 600_000_000 }) },
      // 当天成交额 10 亿很大，但近5日均额只有 1 亿，不达标
      { symbol: '600002', name: '大量不达标', amount: 1_000_000_000, bars: makeBars({ amount: 100_000_000 }) },
    ]);

    const result = await scanTrend(NEXT_TRADE_DATE, allScope, fetchImpl);

    expect(result.items.map((item) => item.symbol)).toEqual(['600001']);
    // 两只都真的拉了日K并算出指标：不达标的只是没过独立门槛，不是「扫描失败」
    expect(result.coverage).toEqual({
      total: 2,
      attempted: 2,
      succeeded: 2,
      failed: 0,
      unscanned: 0,
    });
    expect(result.matchedTotal).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('日K取不到的股票计入 failed，不算 succeeded', async () => {
    const fetchImpl = marketFetch([
      { symbol: '600001', bars: makeBars() },
      { symbol: '600002', bars: null },
    ]);

    const result = await scanTrend(NEXT_TRADE_DATE, allScope, fetchImpl);

    expect(result.coverage).toEqual({
      total: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      unscanned: 0,
    });
    expect(result.items.map((item) => item.symbol)).toEqual(['600001']);
    expect(result.metricsTradeDate).toBe(dateAt(LAST_INDEX));
    expect(Number.isNaN(new Date(result.quoteAsOf ?? '').getTime())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3.5 所属板块：用上游快照给的真实行业归属，不再拿空题材冒充
// ---------------------------------------------------------------------------

describe('所属板块字段', () => {
  it('把上游快照的行业归属原样带出来', async () => {
    const result = await scanTrend(
      NEXT_TRADE_DATE,
      allScope,
      marketFetch([
        { symbol: '600001', industry: '通信设备', bars: makeBars() },
        { symbol: '600002', industry: '银行', bars: makeBars() },
      ]),
    );

    const bySymbol = new Map(result.items.map((item) => [item.symbol, item]));
    expect(bySymbol.get('600001')?.industry).toBe('通信设备');
    expect(bySymbol.get('600002')?.industry).toBe('银行');
  });

  it('上游没有板块归属时给 null，不用空字符串冒充', async () => {
    const result = await scanTrend(
      NEXT_TRADE_DATE,
      allScope,
      marketFetch([{ symbol: '600001', bars: makeBars() }]),
    );

    expect(result.items[0]?.industry).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 260 / 120 上限的覆盖披露
// ---------------------------------------------------------------------------

describe('快速扫描的覆盖披露', () => {
  it('261 个候选只扫 260：披露未扫描 1 只、命中数与显示截断', async () => {
    const stocks: StockFixture[] = Array.from({ length: 261 }, (_, index) => ({
      symbol: String(600000 + index + 1),
      amount: 1_000_000_000 - index,
      bars: makeBars({ amount: 600_000_000 }),
    }));

    const result = await scanTrend(NEXT_TRADE_DATE, allScope, marketFetch(stocks));

    expect(result.candidates).toBe(261);
    expect(result.scanned).toBe(260);
    expect(result.coverage).toEqual({
      total: 261,
      attempted: 260,
      succeeded: 260,
      failed: 0,
      unscanned: 1,
    });
    // 命中 260 只是「已扫描范围内」的数字，不能当成全市场命中
    expect(result.matchedTotal).toBe(260);
    expect(result.returnedCount).toBe(120);
    expect(result.items).toHaveLength(120);
    expect(result.truncated).toBe(true);
  });

  it('覆盖数与截止日期随响应一起返回', async () => {
    const result = await scanTrend(
      NEXT_TRADE_DATE,
      allScope,
      marketFetch([{ symbol: '600001', bars: makeBars() }]),
    );

    expect(result.coverage.attempted).toBe(result.coverage.succeeded + result.coverage.failed);
    expect(result.coverage.total).toBe(result.coverage.attempted + result.coverage.unscanned);
    expect(result.metricsTradeDate).toBe(dateAt(LAST_INDEX));
    expect(result.items[0]?.metricsTradeDate).toBe(dateAt(LAST_INDEX));
    expect(result.items[0]?.lastBarCompleted).toBe(true);
    expect(result.quoteAsOf).not.toBeNull();
  });

  it('目标交易日就是最后一根日K时，行内标注计算截止到上一根已完成日', async () => {
    const bars = makeBars({ shrink: 0.8, shrinkCount: 2 });
    const tradeDate = bars[bars.length - 1].date;

    const result = await scanTrend(tradeDate, allScope, marketFetch([{ symbol: '600001', bars }]));

    expect(result.metricsTradeDate).toBe(dateAt(LAST_INDEX - 1));
    expect(result.items[0]?.metricsTradeDate).toBe(dateAt(LAST_INDEX - 1));
    expect(result.items[0]?.lastBarCompleted).toBeNull();
    expect(result.items[0]?.notes.join(' ')).toContain('完成状态无法确认');
  });

  it('没有候选时不夸大扫描范围', async () => {
    const result = await scanTrend(NEXT_TRADE_DATE, allScope, marketFetch([]));

    expect(result.coverage).toEqual({
      total: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      unscanned: 0,
    });
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.metricsTradeDate).toBeNull();
    expect(result.quoteAsOf).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. 取消「板块范围」筛选：一律全市场
// ---------------------------------------------------------------------------

describe('板块范围筛选已取消', () => {
  it('默认条件就是全市场口径', () => {
    expect(DEFAULT_FILTERS.themeScope).toBe('all');
  });

  it('即使查询参数写了 themeScope=main，也一律按全市场返回', async () => {
    const fetchImpl = marketFetch([{ symbol: '600001', bars: makeBars() }]);
    const filters = parseTrendFilters({ themeScope: 'main' });

    expect(filters.themeScope).toBe('all');

    const result = await scanTrend(NEXT_TRADE_DATE, filters, fetchImpl);
    expect(result.filters.themeScope).toBe('all');
    expect(result.candidates).toBe(1);
    // 全市场口径只吃东财行情快照，不再声明同花顺来源
    expect(result.source).toBe('eastmoney');
  });
});
