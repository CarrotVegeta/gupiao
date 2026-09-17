import type { Holding, QuoteMap } from '../types';

/**
 * 自选列表后加的两列：「自选日」和「自选收益」。
 *
 * 自选收益的口径是「自选以来的涨跌幅」＝（最新价 − 加入自选当时的参考价）÷ 参考价 × 100%，
 * 参考价在加入自选那一刻落到 Holding.watchPrice 上（见 snapshotWatchPrice）。
 * 它**不等于**持仓收益：后者按开仓价算，这里按「当时看到的价格」算，
 * 也不等于当天的涨跌幅：后者拿昨收当基准。
 */

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 收益率的小数位：和行情列一致 */
const PERCENT_DIGITS = 2;

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * 只有拿到真正可用的现价才算数：status 为 unavailable（这一轮没取到行情）
 * 或者价格不是有限数的，都不能当成基准价写进自选记录。
 */
export const currentQuotePrice = (quote: QuoteMap[string] | undefined): number | null =>
  quote && quote.status !== 'unavailable' && isFiniteNumber(quote.price) ? quote.price : null;

/** 记下参考价那一行；times 是取价时刻，同一批用同一个时间戳 */
const withWatchPrice = (holding: Holding, price: number, times: string): Holding => ({
  ...holding,
  watchPrice: price,
  watchPriceAt: times,
});

/**
 * 建立「自选收益」的基准：只给还缺参考价的行记账，已经有基准的行原样不动。
 * 加入自选时就拿到了现价的，走这里时价格一样，等于是幂等的补记；
 * 加入时没拿到行情（或本功能上线前的旧记录）的，会在拿到行情的这一轮补上。
 */
export const snapshotWatchPrices = (
  holdings: Holding[],
  quotes: QuoteMap,
  takenAt: string,
): { holdings: Holding[]; captured: number } => {
  let captured = 0;

  const nextHoldings = holdings.map((holding) => {
    if (isFiniteNumber(holding.watchPrice)) {
      return holding;
    }

    const price = currentQuotePrice(quotes[holding.symbol]);

    if (price === null) {
      return holding;
    }

    captured += 1;

    return withWatchPrice(holding, price, takenAt);
  });

  return { holdings: nextHoldings, captured };
};

/**
 * 自选收益（%）。缺参考价或缺行情时返回 null，由调用方显示「—」：
 * 拿现价冒充基准会算出 0%，看着像个合法数字，其实是在骗人。
 */
export const calculateWatchReturn = (
  holding: Holding,
  quote: QuoteMap[string] | undefined,
): number | null => {
  const baseline = holding.watchPrice;

  if (!isFiniteNumber(baseline) || baseline <= 0) {
    return null;
  }

  const price = currentQuotePrice(quote);

  if (price === null) {
    return null;
  }

  return ((price - baseline) / baseline) * 100;
};

/** 自选收益的展示值（带正负号）；没有基准或行情时是「—」 */
export const formatWatchReturn = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(PERCENT_DIGITS)}%`;

/** 自选日取哪一刻：优先参考价的取价时刻，老数据缺它才退回创建时间 */
const watchDateSource = (holding: Holding): string =>
  holding.watchPriceAt ?? holding.createdAt;

/** 自选日：年月日（按北京时间，和页脚的时间口径一致） */
export const formatWatchDate = (value: string): string => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMATTER.format(date);
};

/** 悬停提示里的完整时刻，带秒 */
export const formatWatchDateTime = (value: string): string => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMATTER.format(date);
};

/** 排序值：时间是 ISO 串，直接按字典序比就是时间序 */
export const watchDateSortValue = (holding: Holding): string => watchDateSource(holding);
