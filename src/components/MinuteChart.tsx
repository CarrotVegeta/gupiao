import type { MinuteSeriesItem } from '../types';

/**
 * 表格内嵌的迷你分时图（当日 09:30~15:00）。
 *
 * ## 画法与取舍（为什么不是「按当日最高最低自适应」）
 *
 * 纵轴是**相对昨收的百分比**，昨收固定在纵向中点，并画一条虚线基准。
 * 不这么做的话，`8.20→8.25` 的横盘和 `8.00→8.80` 的主升浪会被自适应缩放画成
 * 一模一样的坡度 —— 一屏 20 行之间就没有可比性了，而这一列的价值恰恰在横向比较。
 *
 * 没画的东西（都是刻意的）：
 * - **均价线**：96×26 的高度下两条线会绞在一起；而且它需要每分钟累计成交额，当前数据没有
 * - **坐标轴/刻度/网格**：精确数值在右边的「最新价」「涨跌幅」列里，这里只负责形状
 * - **填充/渐变/阴影**：浅色背景下会糊成一块脏色，还会压低相邻数字的对比度
 * - **分段染色**：240 段在 96px 里平均不到 0.4px，会退化成一条红绿噪点带；
 *   颜色只表达「末点相对昨收的方向」，与右边涨跌幅列同一套语义
 *
 * 纵轴按行自适应但**量化到固定档位**：既保证 `scale` 恒大于 0（除零保护），
 * 又不会把 ±0.2% 的横盘噪声拉满整幅。
 */

const WIDTH = 96;
const HEIGHT = 26;
const PAD = 2;
/** 档位表按 A 股合法振幅排（北交所最大 ±30%） */
const SCALE_STEPS = [1, 2, 3, 5, 8, 10, 15, 20, 30];
/** 小于这个幅度视为「与昨收持平」，不染色 */
const FLAT_EPSILON_PCT = 0.005;

export type MinuteChartProps = {
  points: number[];
  preClose: number | null;
};

const niceScale = (maxAbs: number): number =>
  SCALE_STEPS.find((step) => maxAbs <= step) ?? maxAbs;

export const MinuteChart = ({ points, preClose }: MinuteChartProps) => {
  const prices = points.filter((value) => Number.isFinite(value) && value > 0);
  if (prices.length === 0) {
    return <span className="minute-chart minute-chart--empty">—</span>;
  }

  const hasBaseline = preClose !== null && Number.isFinite(preClose) && preClose > 0;
  const series = hasBaseline ? prices.map((price) => (price / preClose - 1) * 100) : prices;
  const last = series[series.length - 1] as number;
  const maxAbs = Math.max(...series.map((value) => Math.abs(value)));
  const scale = hasBaseline ? niceScale(maxAbs) : maxAbs || 1;
  /** 昨收疑似取错（振幅超出档位表）时不假装知道方向 */
  const abnormal = hasBaseline && maxAbs > 30;

  const half = HEIGHT / 2 - PAD;
  const stepX = series.length > 1 ? WIDTH / (series.length - 1) : 0;
  const yOf = (value: number): number => {
    const raw = hasBaseline
      ? HEIGHT / 2 - (value / scale) * half
      : HEIGHT - PAD - (value / scale) * (HEIGHT - 2 * PAD);
    // 脏数据兜底：宁可压在边界上，也不画到画布外
    return Math.min(HEIGHT - PAD, Math.max(PAD, raw));
  };

  const coordinates = series
    .map((value, index) => `${(index * stepX).toFixed(1)},${yOf(value).toFixed(1)}`)
    .join(' ');

  const tone = !hasBaseline || abnormal || Math.abs(last) < FLAT_EPSILON_PCT
    ? 'minute-chart--flat'
    : last > 0
      ? 'minute-chart--rise'
      : 'minute-chart--fall';

  const label = !hasBaseline
    ? '分时图（缺少昨收价，仅显示形状）'
    : abnormal
      ? '分时图（振幅异常，昨收疑似有误）'
      : `分时图：最新 ${last >= 0 ? '+' : ''}${last.toFixed(2)}%，${last >= 0 ? '高于' : '低于'}昨收`;

  return (
    <span className={`minute-chart ${tone}`} role="img" aria-label={label} title={label}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        {hasBaseline ? (
          <line
            className="minute-chart__baseline"
            x1={0}
            y1={HEIGHT / 2}
            x2={WIDTH}
            y2={HEIGHT / 2}
          />
        ) : null}
        {series.length === 1 ? (
          <circle className="minute-chart__dot" cx={WIDTH / 2} cy={yOf(last)} r={1.4} />
        ) : (
          <polyline
            className="minute-chart__line"
            points={coordinates}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  );
};

/** 从响应里建索引，供表格按代码取用 */
export const toMinuteSeriesMap = (
  series: MinuteSeriesItem[],
): Record<string, MinuteSeriesItem> => {
  const map: Record<string, MinuteSeriesItem> = {};
  for (const item of series) {
    map[item.symbol] = item;
  }
  return map;
};
