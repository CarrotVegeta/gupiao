/**
 * 题材详情里 4 个标签的判定（全部是纯函数，便于单测和复用）。
 *
 *   1. 主线龙头
 *   2. 主线换手核心
 *   3. 主线趋势中军
 *   4. 主线低位补涨
 *
 * 两个刻意的设计决定（来自回测结论，见 docs/superpowers/specs/2026-09-17-stock-screener-design.md §2.4）：
 *
 * - **「MA5>MA10>MA20」不做硬条件**，只作为展示列。回测显示它是唯一的毒源：
 *   只加这一个条件，「主线池」的 T+10 超额就从 +0.084% 崩到 −2.426%（t=−2.25），
 *   硬筛掉等于主动挑最差的一档。
 * - 依赖盘中 / 次日数据、当前拿不到的条目（如「次日竞价强于板块平均」），
 *   统一进 `misses` 并标注「待次日验证」，**不假装已确认**。
 */
import type { ThemeStockRole } from '../../src/types.js';

export type RoleStockInput = {
  symbol: string;
  name: string;

  // ---- 涨停结构（同花顺 limit_up_pool） ----
  inLimitUpPool: boolean;
  boardCount: number | null;
  /** HH:mm:ss */
  firstSealTime: string | null;
  lastSealTime: string | null;
  /** 换手板 / 一字板 / T字板 */
  sealType: string | null;
  openCount: number | null;
  /** 封单额（元） */
  sealAmount: number | null;

  // ---- 行情快照 ----
  turnoverRate: number | null;
  /** 当日成交额（元） */
  amount: number | null;
  /** 流通市值（元） */
  floatMarketCap: number | null;

  // ---- 题材 ----
  reasonTags: string[];
  precise: boolean | null;
  isSt: boolean;
  /** 是否成功查过风险数据（减持 / 业绩 / ST）。没查过就不能说「未见风险」 */
  risksChecked: boolean;
  risks: string[];

  // ---- 板块内相对位置 ----
  /** 板块内首板时间名次，1 = 最早 */
  startRankInSector: number | null;
  /** 板块内连板高度名次，1 = 最高 */
  boardRankInSector: number | null;
  /** 板块内封板时间晚于该股首封的涨停家数（带动作用代理） */
  followersAfterFirstSeal: number | null;
  /** 板块龙头的涨停原因标签 */
  leaderTags: string[];

  // ---- 日K ----
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  distMa5: number | null;
  distMa10: number | null;
  /** 最近 10 日收盘站上 MA5 的天数 */
  stableDays10: number | null;
  pct10: number | null;
  pct20: number | null;
  /** 所属板块近 20 日涨幅（%） */
  sectorPct20: number | null;
  avgAmount3d: number | null;
  avgAmount5d: number | null;
  /** 近 10 日上涨日平均量 / 下跌日平均量 */
  upDownVolumeRatio: number | null;
  limitUpIn20d: number | null;
  limitUpIn60d: number | null;
  /** 首次放量突破 20 / 60 日平台 */
  breakout20: boolean;
  breakout60: boolean;
  /** 本股首次放量突破日（YYYYMMDD） */
  ownBreakoutDate: string | null;
  /** 板块龙头首板日（YYYYMMDD） */
  leaderFirstSealDate: string | null;
  /** 板块下跌 ≥1% 的日子里，该股是否相对抗跌 */
  resilientOnSectorDown: boolean | null;
};

export type RoleVerdict = { hits: string[]; misses: string[] };

// 阈值集中在这里，方便回测脚本与线上共用同一套口径
export const ROLE_THRESHOLDS = {
  /** 换手核心：近 3 日平均成交额下限（元） */
  turnoverMinAmount3d: 5e8,
  /** 换手核心：换手率区间（%） */
  turnoverRateMin: 8,
  turnoverRateMax: 25,
  /** 封单额下限（元） */
  minSealAmount: 5e7,
  /** 中军：日均成交额下限（元） */
  zhondunMinAmount5d: 5e8,
  /** 中军：距 5 日线上限（%） */
  zhondunMaxMa5Dist: 5,
  /** 中军：近 10 日涨幅区间（%） */
  zhondunPct10Min: 5,
  zhondunPct10Max: 25,
  /** 中军：10 日内至少几天站上 5 日线 */
  zhondunMinStableDays10: 7,
  /** 补涨：流通市值区间（元） */
  laggardCapMin: 50e8,
  laggardCapMax: 300e8,
  /** 补涨：板块与个股 20 日涨幅差下限（%） */
  laggardPctGap: 15,
  /** 补涨：启动晚于龙头的天数区间 */
  laggardDelayMin: 2,
  laggardDelayMax: 4,
} as const;

const num = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

const isMainBoard = (symbol: string): boolean =>
  symbol.startsWith('60') || symbol.startsWith('00');

const inRange = (value: number | null, low: number, high: number): boolean =>
  value !== null && value >= low && value <= high;

const yi = (value: number | null): string =>
  value === null ? '—' : `${(value / 1e8).toFixed(2)} 亿`;

/** YYYYMMDD 相差的自然日数（b - a） */
export const daysBetween = (a: string | null, b: string | null): number | null => {
  if (a === null || b === null) return null;
  if (!/^\d{8}$/.test(a) || !/^\d{8}$/.test(b)) return null;
  const parse = (value: string): number =>
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  const diff = (parse(b) - parse(a)) / 86_400_000;
  return Number.isFinite(diff) ? Math.round(diff) : null;
};

const timeBefore = (time: string | null, limit: string): boolean =>
  typeof time === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(time) && time <= limit;

const intersectTags = (left: string[], right: string[]): string[] => {
  const rightSet = new Set(right);
  return left.filter((tag) => rightSet.has(tag));
};

/** 1. 主线龙头 */
const judgeLeader = (input: RoleStockInput): RoleVerdict => {
  const hits: string[] = [];
  const misses: string[] = [];

  if (input.startRankInSector !== null && input.startRankInSector <= 3) {
    hits.push(`板块内第 ${input.startRankInSector} 早启动`);
  } else {
    misses.push(
      input.startRankInSector === null
        ? '无法判断启动早晚（缺历史涨停记录）'
        : `板块内启动名次第 ${input.startRankInSector}（要求前 3）`,
    );
  }

  if (input.boardRankInSector !== null && input.boardRankInSector <= 2) {
    hits.push(`连板高度板块第 ${input.boardRankInSector}`);
  } else {
    misses.push(
      input.boardRankInSector === null
        ? '没有连板高度'
        : `连板高度板块第 ${input.boardRankInSector}（要求前 2）`,
    );
  }

  if (timeBefore(input.firstSealTime, '10:00:00')) {
    hits.push(`首封时间早（${input.firstSealTime}）`);
  } else {
    misses.push(
      input.firstSealTime === null
        ? '非当日涨停，无首封时间'
        : `首封时间偏晚（${input.firstSealTime}，要求 ≤10:00）`,
    );
  }

  if (num(input.openCount) !== null && (input.openCount as number) <= 1) {
    hits.push(`封板质量好（开板 ${input.openCount} 次）`);
  } else {
    misses.push(`开板 ${input.openCount ?? '—'} 次（要求 ≤1）`);
  }

  const sealAmount = num(input.sealAmount);
  const amount = num(input.amount);
  if (
    (sealAmount !== null && sealAmount >= ROLE_THRESHOLDS.minSealAmount) ||
    (amount !== null && amount >= 5e8)
  ) {
    hits.push(`成交活跃（封单 ${yi(sealAmount)} / 成交 ${yi(amount)}）`);
  } else {
    misses.push(`成交与封单偏弱（封单 ${yi(sealAmount)}、成交 ${yi(amount)}）`);
  }

  if (input.followersAfterFirstSeal !== null && input.followersAfterFirstSeal >= 2) {
    hits.push(`首封后板块内又有 ${input.followersAfterFirstSeal} 只涨停（带动作用代理）`);
  } else {
    misses.push(
      '带动作用未确认（需盘中分时与次日验证，这里只是代理指标）',
    );
  }

  if (input.precise === true) {
    hits.push('东财 F10 判定为纯正题材');
  } else {
    misses.push('东财 F10 未标记为纯正题材');
  }

  if (!input.risksChecked) {
    misses.push('风险数据未取到（减持 / 业绩 / ST 未核验）');
  } else if (input.risks.length === 0) {
    hits.push('未见减持 / 业绩 / ST 风险');
  } else {
    misses.push(...input.risks.map((risk) => `风险：${risk}`));
  }

  return { hits, misses };
};

/** 2. 主线换手核心 */
const judgeTurnover = (input: RoleStockInput): RoleVerdict => {
  const hits: string[] = [];
  const misses: string[] = [];

  const avg3 = num(input.avgAmount3d);
  if (avg3 !== null && avg3 >= ROLE_THRESHOLDS.turnoverMinAmount3d) {
    hits.push(`近 3 日平均成交额 ${yi(avg3)}`);
  } else {
    misses.push(`近 3 日平均成交额 ${yi(avg3)}（要求 >5 亿）`);
  }

  if (inRange(num(input.turnoverRate), ROLE_THRESHOLDS.turnoverRateMin, ROLE_THRESHOLDS.turnoverRateMax)) {
    hits.push(`换手率 ${input.turnoverRate?.toFixed(1)}%`);
  } else {
    misses.push(
      `换手率 ${input.turnoverRate === null ? '—' : `${input.turnoverRate.toFixed(1)}%`}（要求 8%~25%）`,
    );
  }

  if (input.sealType !== null && input.sealType !== '一字板') {
    hits.push(`${input.sealType}（非连续一字板）`);
  } else if (input.inLimitUpPool) {
    misses.push('一字板，实际难以买入');
  } else {
    misses.push('当日未涨停，缺少封板类型');
  }

  if (input.openCount !== null && input.openCount >= 1 && input.inLimitUpPool) {
    hits.push(`炸板 ${input.openCount} 次后回封`);
  } else if (input.openCount === 0) {
    misses.push('未开板（不算「炸板后回封」）');
  } else {
    misses.push('未见炸板后回封');
  }

  if (
    input.lastSealTime !== null &&
    input.firstSealTime !== null &&
    input.lastSealTime > input.firstSealTime &&
    input.inLimitUpPool
  ) {
    hits.push('分时回落后尾盘仍封住（承接代理）');
  } else {
    misses.push('分时承接需盘中数据，当前只有首/末封时间这一代理口径');
  }

  if (
    input.turnoverRate !== null &&
    input.turnoverRate <= ROLE_THRESHOLDS.turnoverRateMax &&
    input.inLimitUpPool
  ) {
    hits.push('放量但未出现天量滞涨');
  } else {
    misses.push('量能已超出「放量但未滞涨」的范围');
  }

  if (input.resilientOnSectorDown === true) {
    hits.push('板块下跌日相对抗跌');
  } else {
    misses.push('板块分歧日抗跌性未确认（需多日板块与个股对照）');
  }

  misses.push('次日竞价强于板块平均：待次日验证');

  return { hits, misses };
};

/**
 * 3. 主线趋势中军
 *
 * 注意：「MA5>MA10>MA20」**不在硬条件里**，只作为展示列（见文件头注释）。
 * 因此这里也不产出它的 hit/miss，由页面单独展示。
 */
const judgeTrend = (input: RoleStockInput): RoleVerdict => {
  const hits: string[] = [];
  const misses: string[] = [];

  if (isMainBoard(input.symbol) && !input.isSt) {
    hits.push('沪深主板且非 ST');
  } else {
    misses.push(input.isSt ? 'ST 标的' : '非沪深主板');
  }

  const stable = num(input.stableDays10);
  if (stable !== null && stable >= ROLE_THRESHOLDS.zhondunMinStableDays10) {
    hits.push(`近 10 日有 ${stable} 天站上 5 日线`);
  } else {
    misses.push(
      `近 10 日仅 ${stable ?? '—'} 天站上 5 日线（要求 ≥${ROLE_THRESHOLDS.zhondunMinStableDays10}）`,
    );
  }

  const dist5 = num(input.distMa5);
  if (dist5 !== null && Math.abs(dist5) <= ROLE_THRESHOLDS.zhondunMaxMa5Dist) {
    hits.push(`距 5 日线 ${dist5.toFixed(2)}%`);
  } else {
    misses.push(
      `距 5 日线 ${dist5 === null ? '—' : `${dist5.toFixed(2)}%`}（要求 ≤${ROLE_THRESHOLDS.zhondunMaxMa5Dist}%）`,
    );
  }

  if (inRange(num(input.pct10), ROLE_THRESHOLDS.zhondunPct10Min, ROLE_THRESHOLDS.zhondunPct10Max)) {
    hits.push(`近 10 日涨幅 ${input.pct10?.toFixed(1)}%`);
  } else {
    misses.push(
      `近 10 日涨幅 ${input.pct10 === null ? '—' : `${input.pct10.toFixed(1)}%`}（要求 5%~25%）`,
    );
  }

  if (input.limitUpIn20d !== null && input.limitUpIn20d >= 1) {
    hits.push(`近 20 日出现过 ${input.limitUpIn20d} 次涨停`);
  } else {
    misses.push('近 20 日没有涨停');
  }

  const avg5 = num(input.avgAmount5d);
  if (avg5 !== null && avg5 >= ROLE_THRESHOLDS.zhondunMinAmount5d) {
    hits.push(`日均成交额 ${yi(avg5)}`);
  } else {
    misses.push(`日均成交额 ${yi(avg5)}（要求 >5 亿）`);
  }

  if (input.upDownVolumeRatio !== null && input.upDownVolumeRatio > 1) {
    hits.push(`上涨放量、回调缩量（量比 ${input.upDownVolumeRatio.toFixed(2)}）`);
  } else {
    misses.push(
      input.upDownVolumeRatio === null
        ? '量能结构无法计算'
        : `上涨量能未明显大于下跌（量比 ${input.upDownVolumeRatio.toFixed(2)}）`,
    );
  }

  const dist10 = num(input.distMa10);
  if (dist10 !== null && dist10 >= 0) {
    hits.push(`仍在 10 日线上方（${dist10.toFixed(2)}%）`);
  } else {
    misses.push(`已跌破 10 日线（${dist10 === null ? '—' : `${dist10.toFixed(2)}%`}）`);
  }

  return { hits, misses };
};

/** 4. 主线低位补涨 */
const judgeLaggard = (input: RoleStockInput): RoleVerdict => {
  const hits: string[] = [];
  const misses: string[] = [];

  const shared = intersectTags(input.reasonTags, input.leaderTags);
  if (shared.length > 0) {
    hits.push(`与龙头同源逻辑：${shared.slice(0, 3).join('、')}`);
  } else {
    misses.push('涨停原因与龙头没有共同标签');
  }

  const cap = num(input.floatMarketCap);
  if (inRange(cap, ROLE_THRESHOLDS.laggardCapMin, ROLE_THRESHOLDS.laggardCapMax)) {
    hits.push(`流通市值 ${yi(cap)}`);
  } else {
    misses.push(`流通市值 ${yi(cap)}（要求 50~300 亿）`);
  }

  if (input.limitUpIn60d !== null && input.limitUpIn60d >= 1) {
    hits.push(`近 60 日涨停 ${input.limitUpIn60d} 次（股性活跃）`);
  } else {
    misses.push('近 60 日没有涨停，股性偏冷');
  }

  const sectorPct = num(input.sectorPct20);
  const ownPct = num(input.pct20);
  if (sectorPct !== null && ownPct !== null && sectorPct - ownPct >= ROLE_THRESHOLDS.laggardPctGap) {
    hits.push(`板块 20 日 ${sectorPct.toFixed(1)}% vs 个股 ${ownPct.toFixed(1)}%（落后 ${(sectorPct - ownPct).toFixed(1)}%）`);
  } else {
    misses.push(
      sectorPct === null || ownPct === null
        ? '板块 / 个股 20 日涨幅无法比较'
        : `板块与个股 20 日涨幅差 ${(sectorPct - ownPct).toFixed(1)}%（要求 ≥${ROLE_THRESHOLDS.laggardPctGap}%）`,
    );
  }

  if (input.breakout20 || input.breakout60) {
    hits.push(input.breakout60 ? '首次放量突破 60 日平台' : '首次放量突破 20 日平台');
  } else {
    misses.push('尚未首次放量突破 20/60 日平台');
  }

  if (input.limitUpIn20d !== null && input.limitUpIn20d >= 1) {
    hits.push(`近 20 日涨停 ${input.limitUpIn20d} 次`);
  } else {
    misses.push('近 20 日没有涨停');
  }

  const delay = daysBetween(input.leaderFirstSealDate, input.ownBreakoutDate);
  if (delay !== null && delay >= ROLE_THRESHOLDS.laggardDelayMin && delay <= ROLE_THRESHOLDS.laggardDelayMax) {
    hits.push(`启动晚于龙头 ${delay} 天`);
  } else {
    misses.push(
      delay === null
        ? '启动时点无法比较（缺龙头首板日或本股突破日）'
        : `启动晚于龙头 ${delay} 天（要求 ${ROLE_THRESHOLDS.laggardDelayMin}~${ROLE_THRESHOLDS.laggardDelayMax} 天）`,
    );
  }

  if (timeBefore(input.firstSealTime, '13:30:00')) {
    hits.push(`启动有主动性（首封 ${input.firstSealTime}）`);
  } else if (input.firstSealTime === null) {
    misses.push('非当日涨停，主动性需看突破当天分时');
  } else {
    misses.push(`首封偏晚（${input.firstSealTime}），有尾盘偷袭嫌疑`);
  }

  return { hits, misses };
};

export const judgeRole = (role: ThemeStockRole, input: RoleStockInput): RoleVerdict => {
  switch (role) {
    case 'leader':
      return judgeLeader(input);
    case 'turnover':
      return judgeTurnover(input);
    case 'trend':
      return judgeTrend(input);
    case 'laggard':
      return judgeLaggard(input);
  }
};

/** 页面上的标签名 */
export const ROLE_LABELS: Record<ThemeStockRole, string> = {
  leader: '主线龙头',
  turnover: '主线换手核心',
  trend: '主线趋势中军',
  laggard: '主线低位补涨',
};
