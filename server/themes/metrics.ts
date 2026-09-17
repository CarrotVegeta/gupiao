/**
 * 从日K算个股指标。
 *
 * 数据源用同花顺 `hs_XXXXXX` 日K：它比腾讯 `ifzq` 多两列——**成交额**和**换手率**，
 * 而「近 3 日平均成交额 >5 亿」「日均成交额 >5 亿」这类条件正好需要成交额。
 * （腾讯日K只有成交量（手），只能估算。）
 *
 * 口径与 `server/watch/check.ts` 保持一致：判定用 t 日收盘，向前看窗口都含 t 日。
 *
 * 2026-09-18 修正（见实施说明 §5「metrics.ts 具体修正」）：
 *   1. 输入先按目标交易日截断，未完成的最后一根K线可以整体剔除（`lastBarComplete=false`）；
 *   2. 「最近突破日」记录**区间内最近一次**突破，而不是只判断最后一根K线；
 *   3. 「首次」用「突破日本身的前 20 根内没有同类突破」判定，与命名一致；
 *   4. 最近 3 个交易日窗口含信号日，且只取已完成的交易日；自然日差改为交易日历索引差；
 *   5. 涨跌日量能按 close 与前一日 close 比较，不再用 open（旧口径实际是阳线/阴线）；
 *   6. 连续板高度按逐日收盘是否达到当日涨停价重新计算，不使用上游「8天5板」。
 *
 * 所有窗口不足、数据缺失的情况一律返回 null / missing，不用 0 冒充。
 */
import { limitUpPct } from '../watch/check.js';
import type { KlineBar } from './tenjqka.js';

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** 指标计算的时间基准与数据可用性 */
export type MetricsOptions = {
  /** 指标截止日（YYYYMMDD）；给定时只使用该日及之前的K线 */
  asOfTradeDate?: string | null;
  /** 最后一根（asOf 当日）K线是否已完成；false 时把它整体剔除，不参与任何窗口 */
  lastBarComplete?: boolean;
  /** 交易日历（升序 YYYYMMDD），用于计算交易日间隔而不是自然日 */
  tradeDates?: string[] | null;
  /** 本轮启动锚点（如龙头启动日 YYYYMMDD），用于算「本股晚于锚点几个交易日」 */
  anchorDate?: string | null;
};

export type StockKlineMetrics = {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  maBull: boolean | null;
  distMa5: number | null;
  distMa10: number | null;
  /** 最近 10 个已完成交易日里收盘站上 MA5 的天数 */
  stableDays10: number | null;
  pct10: number | null;
  pct20: number | null;
  /** 近 3 日均额（元） */
  avgAmount3d: number | null;
  /** 近 5 日均额（元） */
  avgAmount5d: number | null;
  /** 近 10 个已完成交易日：收盘上涨日均量 / 收盘下跌日均量 */
  upDownVolumeRatioByClose: number | null;
  limitUpIn20d: number | null;
  limitUpIn60d: number | null;
  /** 最近一根已完成的K线是否为涨停 */
  isLimitUp: boolean;
  /** 区间内最近一次「放量突破 20/60 日平台」的日期（YYYYMMDD） */
  ownBreakoutDate: string | null;
  breakout20: boolean;
  breakout60: boolean;
  /** 最近一次突破是否为「首次」（此前 20 根内没有同类突破） */
  breakoutIsFirst: boolean | null;
  /** 连续涨停（连板）高度，按逐日收盘价重算 */
  consecutiveLimitUpDays: number | null;
  /** 连续「一字」天数：两日 OHLC 均相等且达到涨停价；缺任一日价格返回 null */
  onePriceSealDays: number | null;
  /** 近 5 日相对所属板块涨幅 = 个股近5日涨幅 − 板块同期涨幅（%） */
  relativePct5: number | null;
  /** 板块调整日相对表现（%）：最近 20 交易日板块跌幅 ≤−1% 各日「个股−板块」均值 */
  sectorAdjustedRelative: number | null;
  /** 距某个锚点（如龙头启动日）的交易日数 */
  tradingDaysSince: number | null;
  /** 板块下跌 ≥1% 的日子里，该股是否相对抗跌 */
  resilientOnSectorDown: boolean | null;
  /** 实际用于计算的截止交易日（YYYYMMDD） */
  tradeDate: string | null;
};

/** 按截止日截断，并按日期升序、去重（上游偶发乱序） */
export const alignBars = (bars: KlineBar[], asOfTradeDate?: string | null): KlineBar[] => {
  const filtered =
    typeof asOfTradeDate === 'string' && /^\d{8}$/.test(asOfTradeDate)
      ? bars.filter((bar) => bar.date <= asOfTradeDate)
      : bars;
  const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
  const result: KlineBar[] = [];
  for (const bar of sorted) {
    if (result.length > 0 && result[result.length - 1].date === bar.date) {
      result[result.length - 1] = bar;
      continue;
    }
    result.push(bar);
  }
  return result;
};

/** 交易日间隔：b 相对 a 的交易日数（用交易日历索引，缺日历时返回 null） */
export const tradingDayDiff = (
  a: string | null,
  b: string | null,
  tradeDates: string[] | null | undefined,
): number | null => {
  if (a === null || b === null) return null;
  if (!Array.isArray(tradeDates) || tradeDates.length === 0) return null;
  const indexA = tradeDates.indexOf(a);
  const indexB = tradeDates.indexOf(b);
  if (indexA < 0 || indexB < 0) return null;
  return indexB - indexA;
};

const maAt = (closes: number[], endExclusive: number, window: number): number | null =>
  endExclusive >= window ? mean(closes.slice(endExclusive - window, endExclusive)) : null;

/** 逐日涨停判定所需的涨停幅度 */
const limitRatio = (symbol: string, name: string): number => limitUpPct(symbol, name) / 100;

const isLimitUpAt = (
  bars: KlineBar[],
  index: number,
  ratio: number,
): boolean | null => {
  if (index < 1 || index >= bars.length) return null;
  const previous = bars[index - 1].close;
  if (!(previous > 0)) return null;
  return bars[index].close >= round2(previous * (1 + ratio)) - 0.001;
};

const countLimitUp = (
  bars: KlineBar[],
  ratio: number,
  within: number,
): number | null => {
  if (bars.length < 2) return null;
  const start = Math.max(1, bars.length - within);
  let count = 0;
  for (let index = start; index < bars.length; index += 1) {
    if (isLimitUpAt(bars, index, ratio) === true) count += 1;
  }
  return count;
};

/** 从最后一根K线往回数连续涨停天数；缺任一日价格/涨停口径返回 null */
const consecutiveLimitUp = (bars: KlineBar[], ratio: number): number | null => {
  if (bars.length < 2) return null;
  let days = 0;
  for (let index = bars.length - 1; index >= 1; index -= 1) {
    const hit = isLimitUpAt(bars, index, ratio);
    if (hit === null) return days > 0 ? days : null;
    if (!hit) break;
    days += 1;
  }
  return days;
};

/**
 * 连续「一字」天数：逐日 OHLC 四价相等且收盘达到涨停价。
 * 缺任一日价格 / 涨停口径返回 null —— 不能用当天的 sealType 替代历史检查。
 */
const onePriceSeal = (bars: KlineBar[], ratio: number): number | null => {
  if (bars.length < 2) return null;
  let days = 0;
  for (let index = bars.length - 1; index >= 1; index -= 1) {
    const bar = bars[index];
    const hit = isLimitUpAt(bars, index, ratio);
    if (hit === null) return days > 0 ? days : null;
    const flat =
      bar.high === bar.low &&
      bar.open === bar.close &&
      bar.open === bar.high;
    if (!(hit && flat)) break;
    days += 1;
  }
  return days;
};

/** 放量突破：收盘创 N 日新高，且量能 ≥ 前 5 日均量的 2 倍 */
const isBreakoutAt = (bars: KlineBar[], index: number, window: number): boolean => {
  if (index < window + 1) return false;
  const previousHighs = bars.slice(index - window, index).map((bar) => bar.high);
  const priorVolumes = bars.slice(Math.max(0, index - 5), index).map((bar) => bar.volume);
  if (previousHighs.length === 0 || priorVolumes.length === 0) return false;
  const avgVolume = mean(priorVolumes);
  if (!(avgVolume > 0)) return false;
  return bars[index].close > Math.max(...previousHighs) && bars[index].volume >= avgVolume * 2;
};
/** 在 [from, to) 区间内是否存在窗口突破 */
const hasBreakoutIn = (bars: KlineBar[], window: number, from: number, to: number): boolean => {
  for (let index = Math.max(window + 1, from); index < to; index += 1) {
    if (isBreakoutAt(bars, index, window)) return true;
  }
  return false;
};

/**
 * 区间内**最近一次**突破。返回突破日与是否「首次」：
 * 首次 = 该日之前 20 根里没有同类突破（不再要求区间内全部都没有，否则历史突破日永远查不到）。
 */
const findRecentBreakout = (
  bars: KlineBar[],
  window: number,
): { date: string | null; isFirst: boolean | null } => {
  const last = bars.length - 1;
  if (last < window + 1) return { date: null, isFirst: null };
  const from = Math.max(window + 1, last - 20);
  for (let index = last; index >= from; index -= 1) {
    if (!isBreakoutAt(bars, index, window)) continue;
    const isFirst = !hasBreakoutIn(bars, window, window + 1, index);
    return { date: bars[index].date, isFirst };
  }
  return { date: null, isFirst: null };
};

export const computeStockMetrics = (
  rawBars: KlineBar[],
  symbol: string,
  name: string,
  sectorBars: KlineBar[] | null = null,
  options: MetricsOptions = {},
): StockKlineMetrics => {
  const aligned = alignBars(rawBars, options.asOfTradeDate);
  // 未完成的当日K线整体剔除：半天量不能与全天均量比较
  const bars = options.lastBarComplete === false ? aligned.slice(0, -1) : aligned;

  const empty: StockKlineMetrics = {
    ma5: null,
    ma10: null,
    ma20: null,
    maBull: null,
    distMa5: null,
    distMa10: null,
    stableDays10: null,
    pct10: null,
    pct20: null,
    avgAmount3d: null,
    avgAmount5d: null,
    upDownVolumeRatioByClose: null,
    limitUpIn20d: null,
    limitUpIn60d: null,
    isLimitUp: false,
    ownBreakoutDate: null,
    breakout20: false,
    breakout60: false,
    breakoutIsFirst: null,
    consecutiveLimitUpDays: null,
    onePriceSealDays: null,
    relativePct5: null,
    sectorAdjustedRelative: null,
    tradingDaysSince: null,
    resilientOnSectorDown: null,
    tradeDate: bars.at(-1)?.date ?? null,
  };

  if (bars.length < 21) return empty;

  const closes = bars.map((bar) => bar.close);
  const last = closes.length - 1;
  const ma5 = maAt(closes, closes.length, 5);
  const ma10 = maAt(closes, closes.length, 10);
  const ma20 = maAt(closes, closes.length, 20);

  let stableDays10: number | null = null;
  if (closes.length >= 15) {
    let days = 0;
    for (let index = closes.length - 10; index < closes.length; index += 1) {
      const value = maAt(closes, index + 1, 5);
      if (value !== null && closes[index] >= value) days += 1;
    }
    stableDays10 = days;
  }

  const amounts = bars.map((bar) => bar.amount);
  const recentAmounts = amounts
    .slice(-3)
    .filter((value): value is number => value !== null && value > 0);
  const recent5Amounts = amounts
    .slice(-5)
    .filter((value): value is number => value !== null && value > 0);

  // 涨跌日量能：用 close 与前一交易日 close 比较（旧口径用 open，实际是阳线/阴线）
  const windowBars = bars.slice(-11, -1);
  const upVolumes: number[] = [];
  const downVolumes: number[] = [];
  for (let index = 1; index < windowBars.length; index += 1) {
    const previous = windowBars[index - 1].close;
    if (!(previous > 0)) continue;
    const bar = windowBars[index];
    if (bar.close > previous) upVolumes.push(bar.volume);
    else if (bar.close < previous) downVolumes.push(bar.volume);
  }
  const upDownVolumeRatioByClose =
    upVolumes.length > 0 && downVolumes.length > 0 && mean(downVolumes) > 0
      ? mean(upVolumes) / mean(downVolumes)
      : null;

  const breakout20 = findRecentBreakout(bars, 20);
  const breakout60 = findRecentBreakout(bars, 60);
  // 20 日突破优先，同日则取 60 日口径（更严格）；都没有则返回 null
  const ownBreakoutDate = breakout20.date ?? breakout60.date;
  const breakoutIsFirst =
    ownBreakoutDate === null
      ? null
      : breakout20.date === ownBreakoutDate
        ? breakout20.isFirst
        : breakout60.isFirst;

  const ratio = limitRatio(symbol, name);
  const isLimitUp = isLimitUpAt(bars, last, ratio) === true;

  const alignedSector = sectorBars ? alignBars(sectorBars, options.asOfTradeDate) : null;

  return {
    ma5: ma5 === null ? null : round(ma5, 3),
    ma10: ma10 === null ? null : round(ma10, 3),
    ma20: ma20 === null ? null : round(ma20, 3),
    maBull: ma5 !== null && ma10 !== null && ma20 !== null ? ma5 > ma10 && ma10 > ma20 : null,
    distMa5: ma5 === null || ma5 <= 0 ? null : round((closes[last] / ma5 - 1) * 100),
    distMa10: ma10 === null || ma10 <= 0 ? null : round((closes[last] / ma10 - 1) * 100),
    stableDays10,
    pct10: closes.length >= 11 ? round((closes[last] / closes[last - 10] - 1) * 100) : null,
    pct20: closes.length >= 21 ? round((closes[last] / closes[last - 20] - 1) * 100) : null,
    avgAmount3d: recentAmounts.length === 3 ? mean(recentAmounts) : null,
    avgAmount5d: recent5Amounts.length === 5 ? mean(recent5Amounts) : null,
    upDownVolumeRatioByClose:
      upDownVolumeRatioByClose === null ? null : round(upDownVolumeRatioByClose, 4),
    limitUpIn20d: countLimitUp(bars, ratio, 20),
    limitUpIn60d: countLimitUp(bars, ratio, 60),
    isLimitUp,
    ownBreakoutDate,
    breakout20: breakout20.date !== null,
    breakout60: breakout60.date !== null,
    breakoutIsFirst,
    consecutiveLimitUpDays: consecutiveLimitUp(bars, ratio),
    onePriceSealDays: onePriceSeal(bars, ratio),
    relativePct5: relativePct(bars, alignedSector, 5),
    sectorAdjustedRelative: sectorAdjustedRelative(bars, alignedSector),
    tradingDaysSince: tradingDayDiff(options.anchorDate ?? null, bars[last].date, options.tradeDates),
    resilientOnSectorDown: computeResilience(bars, alignedSector),
    tradeDate: bars[last].date,
  };
};

/** 个股近 N 日涨幅 − 板块同期涨幅（%）；缺板块日K返回 null（不填 0） */
export const relativePct = (
  bars: KlineBar[],
  sectorBars: KlineBar[] | null,
  window: number,
): number | null => {
  if (!sectorBars || sectorBars.length < window + 1) return null;
  if (bars.length < window + 1) return null;
  const ownBase = bars[bars.length - 1 - window].close;
  const sectorByDate = new Map(sectorBars.map((bar) => [bar.date, bar]));
  const sectorBar = sectorByDate.get(bars[bars.length - 1].date);
  const sectorBase = sectorByDate.get(bars[bars.length - 1 - window].date);
  if (!sectorBar || !sectorBase || !(ownBase > 0) || !(sectorBase.close > 0)) return null;
  const ownPct = (bars[bars.length - 1].close / ownBase - 1) * 100;
  const sectorPct = (sectorBar.close / sectorBase.close - 1) * 100;
  return round(ownPct - sectorPct);
};

/**
 * 板块调整日相对表现：最近 20 交易日内板块跌幅 ≤−1% 的各日「个股涨幅 − 板块涨幅」的均值。
 * 少于 2 个有效日返回 null（不假装确认）。
 */
export const sectorAdjustedRelative = (
  bars: KlineBar[],
  sectorBars: KlineBar[] | null,
): number | null => {
  if (!sectorBars || sectorBars.length < 5) return null;
  const sectorByDate = new Map(sectorBars.map((bar) => [bar.date, bar]));
  const values: number[] = [];
  for (let index = Math.max(1, bars.length - 20); index < bars.length; index += 1) {
    const sectorBar = sectorByDate.get(bars[index].date);
    const sectorPrevious = sectorBar ? sectorByDate.get(bars[index - 1].date) : undefined;
    if (!sectorBar || !sectorPrevious || sectorPrevious.close <= 0) continue;
    const sectorPctValue = (sectorBar.close / sectorPrevious.close - 1) * 100;
    if (sectorPctValue > -1) continue;
    const previous = bars[index - 1].close;
    if (!(previous > 0)) continue;
    const ownPct = (bars[index].close / previous - 1) * 100;
    values.push(ownPct - sectorPctValue);
  }
  if (values.length < 2) return null;
  return round(mean(values));
};

/**
 * 板块下跌 ≥1% 的日子里，该股跌幅是否更小。
 * 需要板块与个股都有日K；样本不足 2 天返回 null（不假装确认）。
 */
const computeResilience = (bars: KlineBar[], sectorBars: KlineBar[] | null): boolean | null => {
  if (!sectorBars || sectorBars.length < 5) return null;
  const sectorByDate = new Map(sectorBars.map((bar) => [bar.date, bar]));

  let checked = 0;
  let resilient = 0;
  for (let index = Math.max(1, bars.length - 20); index < bars.length; index += 1) {
    const sectorBar = sectorByDate.get(bars[index].date);
    const sectorPrevious = sectorBar ? sectorByDate.get(bars[index - 1].date) : undefined;
    if (!sectorBar || !sectorPrevious || sectorPrevious.close <= 0) continue;
    const sectorPctValue = (sectorBar.close / sectorPrevious.close - 1) * 100;
    if (sectorPctValue > -1) continue;
    const previous = bars[index - 1].close;
    if (!(previous > 0)) continue;
    const ownPct = (bars[index].close / previous - 1) * 100;
    checked += 1;
    if (ownPct > sectorPctValue) resilient += 1;
  }

  if (checked < 2) return null;
  return resilient / checked >= 0.6;
};

/** 板块近 20 日涨幅（%） */
export const sectorPct20 = (sectorBars: KlineBar[] | null): number | null => {
  if (!sectorBars || sectorBars.length < 21) return null;
  const closes = sectorBars.map((bar) => bar.close);
  const last = closes.length - 1;
  if (!(closes[last - 20] > 0)) return null;
  return round((closes[last] / closes[last - 20] - 1) * 100);
};

/** 板块成交额序列（元），最后一个是当日 */
export const sectorAmounts = (sectorBars: KlineBar[] | null): number[] => {
  if (!sectorBars) return [];
  return sectorBars
    .map((bar) => bar.amount)
    .filter((value): value is number => value !== null && value > 0);
};
