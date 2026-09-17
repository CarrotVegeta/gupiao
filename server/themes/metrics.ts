/**
 * 从日K算个股指标。
 *
 * 数据源用同花顺 `hs_XXXXXX` 日K：它比腾讯 `ifzq` 多两列——**成交额**和**换手率**，
 * 而「近 3 日平均成交额 >5 亿」「日均成交额 >5 亿」这类条件正好需要成交额。
 * （腾讯日K只有成交量（手），只能估算。）
 *
 * 口径与 `server/watch/check.ts` 保持一致：判定用 t 日收盘，向前看窗口都含 t 日。
 */
import { limitUpPct } from '../watch/check.js';
import type { KlineBar } from './tenjqka.js';

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export type StockKlineMetrics = {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  maBull: boolean | null;
  distMa5: number | null;
  distMa10: number | null;
  /** 最近 10 日收盘站上 MA5 的天数 */
  stableDays10: number | null;
  pct10: number | null;
  pct20: number | null;
  /** 近 3 日平均成交额（元） */
  avgAmount3d: number | null;
  /** 近 5 日平均成交额（元） */
  avgAmount5d: number | null;
  /** 近 10 日上涨日平均量 / 下跌日平均量 */
  upDownVolumeRatio: number | null;
  limitUpIn20d: number | null;
  limitUpIn60d: number | null;
  /** 最近一根K线是否为涨停 */
  isLimitUp: boolean;
  /** 最近一次「放量突破 20/60 日平台」的日期（YYYYMMDD） */
  ownBreakoutDate: string | null;
  breakout20: boolean;
  breakout60: boolean;
  /** 板块下跌 ≥1% 的日子里，该股是否相对抗跌 */
  resilientOnSectorDown: boolean | null;
};

const maAt = (closes: number[], endExclusive: number, window: number): number | null =>
  endExclusive >= window ? mean(closes.slice(endExclusive - window, endExclusive)) : null;

const countLimitUp = (bars: KlineBar[], symbol: string, name: string, within: number): number | null => {
  if (bars.length < 2) return null;
  const limit = limitUpPct(symbol, name) / 100;
  const start = Math.max(1, bars.length - within);
  let count = 0;
  for (let index = start; index < bars.length; index += 1) {
    const previous = bars[index - 1].close;
    if (previous > 0 && bars[index].close >= round2(previous * (1 + limit)) - 0.001) count += 1;
  }
  return count;
};

/** 放量突破：收盘创 N 日新高，且量能 ≥ 前 5 日均量的 2 倍 */
const isBreakoutAt = (bars: KlineBar[], index: number, window: number): boolean => {
  if (index < window + 1) return false;
  const previousHighs = bars.slice(index - window, index).map((bar) => bar.high);
  const priorVolumes = bars.slice(Math.max(0, index - 5), index).map((bar) => bar.volume);
  if (previousHighs.length === 0 || priorVolumes.length === 0) return false;
  const avgVolume = mean(priorVolumes);
  if (!(avgVolume > 0)) return false;
  return (
    bars[index].close > Math.max(...previousHighs) && bars[index].volume >= avgVolume * 2
  );
};

const findBreakout = (
  bars: KlineBar[],
  window: number,
): { hit: boolean; date: string | null } => {
  const last = bars.length - 1;
  if (last < window + 1) return { hit: false, date: null };
  if (!isBreakoutAt(bars, last, window)) return { hit: false, date: null };
  // 「首次」：前 20 根里不能再有同类突破
  for (let index = Math.max(window + 1, last - 20); index < last; index += 1) {
    if (isBreakoutAt(bars, index, window)) return { hit: false, date: null };
  }
  return { hit: true, date: bars[last].date };
};

export const computeStockMetrics = (
  bars: KlineBar[],
  symbol: string,
  name: string,
  sectorBars: KlineBar[] | null = null,
): StockKlineMetrics => {
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
    upDownVolumeRatio: null,
    limitUpIn20d: null,
    limitUpIn60d: null,
    isLimitUp: false,
    ownBreakoutDate: null,
    breakout20: false,
    breakout60: false,
    resilientOnSectorDown: null,
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

  const windowBars = bars.slice(-11, -1);
  const upVolumes = windowBars.filter((bar) => bar.close > bar.open).map((bar) => bar.volume);
  const downVolumes = windowBars.filter((bar) => bar.close < bar.open).map((bar) => bar.volume);
  const upDownVolumeRatio =
    upVolumes.length > 0 && downVolumes.length > 0 && mean(downVolumes) > 0
      ? mean(upVolumes) / mean(downVolumes)
      : null;

  const breakout20 = findBreakout(bars, 20);
  const breakout60 = findBreakout(bars, 60);
  const ownBreakoutDate = breakout20.date ?? breakout60.date;

  const limit = limitUpPct(symbol, name) / 100;
  const isLimitUp =
    bars.length >= 2 &&
    bars[last - 1].close > 0 &&
    closes[last] >= round2(bars[last - 1].close * (1 + limit)) - 0.001;

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
    upDownVolumeRatio: upDownVolumeRatio === null ? null : round(upDownVolumeRatio, 4),
    limitUpIn20d: countLimitUp(bars, symbol, name, 20),
    limitUpIn60d: countLimitUp(bars, symbol, name, 60),
    isLimitUp,
    ownBreakoutDate,
    breakout20: breakout20.hit,
    breakout60: breakout60.hit,
    resilientOnSectorDown: computeResilience(bars, sectorBars),
  };
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
    if (!sectorBar) continue;
    const sectorPrevious = sectorByDate.get(bars[index - 1].date);
    if (!sectorPrevious || sectorPrevious.close <= 0) continue;
    const sectorPct = (sectorBar.close / sectorPrevious.close - 1) * 100;
    if (sectorPct > -1) continue;
    const previous = bars[index - 1].close;
    if (previous <= 0) continue;
    const ownPct = (bars[index].close / previous - 1) * 100;
    checked += 1;
    if (ownPct > sectorPct) resilient += 1;
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
