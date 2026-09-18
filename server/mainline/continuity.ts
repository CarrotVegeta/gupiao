/**
 * L4 · 时间层：连续性 + 分歧后回流（设计稿 §5）。
 *
 * 这一层是整套方法里**唯一的时间不对称项**。没有它，评分表就退化成
 * 「今天谁涨得多」。
 *
 * 规矩（§5.1）：
 *   P > 0 且 L ≥ 2                                → C += 1   强势日
 *   −3% ≤ P ≤ 0 且 L ≤ max(1, 0.3·L_prev)         → C 不变   分歧日，**不断链**
 *   P < −3%  或  (L = 0 且 P < 0)                 → C = 0    断链
 *
 * 「分歧日不断链」是本项目对原方法的补充：原方法只说「连续 2~3 天保持强势」，
 * 若把分歧日也算断链，会把真主线误杀（主线不会每天涨，缩量小幅调整是必要环节）。
 *
 * 本文件是纯函数，不碰网络。
 */
import type { BoardDay } from './types.js';

/** 分歧日的跌幅下限（%） */
export const DIVERGENCE_FLOOR = -3;
/** 断链的跌幅阈值（%） */
export const BREAK_FLOOR = -3;
/** 分歧日涨停家数的收缩比例：≤ 前一日 × 0.3（且至少留 1 家才算「还有票」） */
export const DIVERGENCE_LIMIT_UP_RATIO = 0.3;
/** 回流确认的涨幅门槛（%） */
export const RETURN_PCT_FLOOR = 1;
/** 回流确认的窗口（交易日） */
export const RETURN_WINDOW = 2;
/** 回流时涨停家数至少要恢复到前一日（分歧前）的比例 */
export const RETURN_LIMIT_UP_RATIO = 0.6;
/** 退潮：分歧后第 2 日仍跌破该涨幅（%）且家数继续下降 */
export const EBB_PCT = -2;

export type DayInput = {
  date: string;
  pct: number | null;
  limitUpCount: number;
  prevLimitUpCount: number | null;
};

export type DayKind = 'strong' | 'divergence' | 'weak';

/** 判定当日类型（§5.1 的三个分支） */
export const classifyDay = (day: DayInput): DayKind => {
  const pct = day.pct;
  if (pct === null) return 'weak';

  if (pct > 0 && day.limitUpCount >= 2) return 'strong';

  const prev = day.prevLimitUpCount ?? 0;
  const collapsed = day.limitUpCount <= Math.max(1, prev * DIVERGENCE_LIMIT_UP_RATIO);
  if (pct >= DIVERGENCE_FLOOR && pct <= 0 && collapsed) return 'divergence';

  if (pct < BREAK_FLOOR || (day.limitUpCount === 0 && pct < 0)) return 'weak';

  // 其余（例如小涨但家数没跟上）归为 weak，不涨计数也不断链
  return 'weak';
};

/**
 * 逐日算连续计数（§5.1）。
 *
 * 输入必须按日期升序、且只含交易日（调用方保证）。
 * `dayKind === 'divergence'` 时 streak 保持不变；`strong` +1；`weak` 归零。
 */
export const buildContinuity = (
  days: DayInput[],
): Array<{ dayKind: DayKind; streak: number }> => {
  let streak = 0;
  return days.map((day, index) => {
    const dayKind = classifyDay({
      ...day,
      prevLimitUpCount: index > 0 ? days[index - 1].limitUpCount : day.prevLimitUpCount,
    });
    if (dayKind === 'strong') streak += 1;
    else if (dayKind !== 'divergence') streak = 0;
    return { dayKind, streak };
  });
};

export type DivergenceEvent = {
  /** 分歧日 */
  date: string;
  /** 分歧前的强势日家数（用于回流判定） */
  prevLimitUpCount: number;
  /** 最终状态 */
  state: 'returned' | 'pending' | 'ebb';
  /** 确认回流的日期 */
  returnedOn: string | null;
};

/**
 * 分歧后回流（§5.2）。
 *
 * 分歧日 d0 三条件：
 *   ① −3% ≤ P ≤ 0
 *   ② L ≤ max(1, 0.3·L_prev)
 *   ③ 主力净流入 ≥ 0        ← **资金流没有历史**，历史回填时该条件按「不可判定」跳过，
 *                              并把 degraded 标为 true（面板与回测都要披露）
 *
 * 回流确认：d1 ∈ (d0, d0+2] 里出现  P ≥ +1%  且  (净流入 > 0 或 L ≥ 0.6·L_prev)
 * 退潮：d0 后第 2 日仍 P < −2% 且 L 继续下降
 */
export type FlowDayInput = DayInput & {
  /** 主力净流入（元）；无历史数据时为 null */
  mainNet: number | null;
};

export type ContinuityResult = {
  days: Array<{
    date: string;
    dayKind: DayKind;
    streak: number;
    /** 当日所处分歧事件的状态；不在分歧/回流窗口内为 null */
    capitalReturn: number | null;
    state: DivergenceEvent['state'] | null;
  }>;
  events: DivergenceEvent[];
  /** 是否因为缺资金流而降级判定 */
  degraded: boolean;
};

export const buildCapitalReturn = (days: FlowDayInput[]): ContinuityResult => {
  const continuity = buildContinuity(days);
  const events: DivergenceEvent[] = [];
  const state: Array<number | null> = new Array(days.length).fill(null);
  const stateName: Array<DivergenceEvent['state'] | null> = new Array(days.length).fill(null);
  let degraded = false;

  for (let index = 0; index < days.length; index += 1) {
    if (continuity[index].dayKind !== 'divergence') continue;

    const prevLimitUpCount = index > 0 ? days[index - 1].limitUpCount : 0;
    const mainNet = days[index].mainNet;
    // 条件③：资金流不可用时降级（不放行也不否决，而是标记 degraded 后跳过）
    if (mainNet === null) degraded = true;
    else if (mainNet < 0) continue;

    const event: DivergenceEvent = {
      date: days[index].date,
      prevLimitUpCount,
      state: 'pending',
      returnedOn: null,
    };

    for (let offset = 1; offset <= RETURN_WINDOW && index + offset < days.length; offset += 1) {
      const day = days[index + offset];
      const pct = day.pct;
      if (pct === null) continue;
      const flowOk = day.mainNet === null ? false : day.mainNet > 0;
      const countOk = day.limitUpCount >= prevLimitUpCount * RETURN_LIMIT_UP_RATIO;
      if (pct >= RETURN_PCT_FLOOR && (flowOk || countOk)) {
        event.state = 'returned';
        event.returnedOn = day.date;
        break;
      }
    }

    // 退潮：窗口走完仍未回流，且第 2 日跌幅与家数都不对
    if (event.state === 'pending') {
      const second = days[index + RETURN_WINDOW];
      const secondPct = second?.pct ?? null;
      if (
        second !== undefined &&
        secondPct !== null &&
        secondPct < EBB_PCT &&
        second.limitUpCount < days[index].limitUpCount
      ) {
        event.state = 'ebb';
      }
    }

    events.push(event);

    // 落状态：分歧日 d0 本身记 0，回流日及其后 3 日内记 +1，退潮记 −1
    state[index] = 0;
    stateName[index] = event.state;
    for (let offset = 1; offset <= RETURN_WINDOW + 1 && index + offset < days.length; offset += 1) {
      if (event.state === 'returned' && offset <= RETURN_WINDOW) {
        state[index + offset] = 1;
        stateName[index + offset] = 'returned';
      } else if (event.state === 'ebb' && offset === RETURN_WINDOW) {
        state[index + offset] = -1;
        stateName[index + offset] = 'ebb';
      }
    }
  }

  return {
    days: days.map((day, index) => ({
      date: day.date,
      dayKind: continuity[index].dayKind,
      streak: continuity[index].streak,
      capitalReturn: state[index],
      state: stateName[index],
    })),
    events,
    degraded,
  };
};

/** 退潮标记（§5.2 / §6 的 −3 分项）：最近一次分歧事件已判退潮 */
export const isEbbing = (result: ContinuityResult): boolean =>
  result.events.length > 0 && result.events[result.events.length - 1].state === 'ebb';

/** 把 L4 的结果并回 BoardDay 需要的三个字段 */
export const toBoardDayFields = (
  result: ContinuityResult,
): Array<Pick<BoardDay, 'streak' | 'dayKind' | 'capitalReturn'>> =>
  result.days.map((day) => ({
    streak: day.streak,
    dayKind: day.dayKind,
    capitalReturn: day.capitalReturn,
  }));
