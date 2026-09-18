/**
 * L1 · 板块层：四榜横截面排名 + 上榜广度 + 连续上榜（设计稿 §2）。
 *
 * 三条硬约束（设计稿 §9.4 / §13）：
 *   1. **不用绝对额比较**。板块互相重叠（504 个概念板块当日主力净流入求和 8757 亿，
 *      远超全市场真实值），所以任何「板块 A 比板块 B 强」都只能走**横截面名次**。
 *   2. 名次只在**同一天、同一个榜**内可比，跨日不可比（不同交易日的分布不同）。
 *   3. 该榜当日全部不可用（全 null）时，名次一律 null，**不拿别的数字顶**。
 *
 * 本文件是纯函数，不碰网络。
 */
import type { BoardDay } from './types.js';

/** 榜单标识 */
export type RankBoardKey = 'pct' | 'limitUp' | 'flow' | 'amount';

export const RANK_BOARD_KEYS: RankBoardKey[] = ['pct', 'limitUp', 'flow', 'amount'];

/** 原方法的「前 10」；板块总数 504 时 ceil(504×0.02)=11，取 10 */
export const TOP_N = 10;

/** 「反复出现」的门槛（设计稿 §2.2） */
export const REPEAT_STREAK_MIN = 3;

/** 上榜广度的门槛：当日至少进两个榜才算「多榜同时在榜」 */
export const HIT_MIN = 2;

/** 某一行的取值（null 表示该榜当日不可用） */
export type RankInput = {
  code: string;
  pct: number | null;
  limitUpCount: number | null;
  mainNet: number | null;
  amount: number | null;
};

const valueOf = (row: RankInput, key: RankBoardKey): number | null => {
  switch (key) {
    case 'pct':
      return row.pct;
    case 'limitUp':
      return row.limitUpCount;
    case 'flow':
      return row.mainNet;
    case 'amount':
      return row.amount;
  }
};

/**
 * 横截面名次（降序，1 起）。并列取相同名次（比赛排名法：1,2,2,4）。
 * 该榜全部为 null 时返回空 Map（调用方据此把名次全部置 null）。
 */
export const computeRanks = (rows: RankInput[], key: RankBoardKey): Map<string, number> => {
  const usable = rows
    .map((row) => ({ code: row.code, value: valueOf(row, key) }))
    .filter((item): item is { code: string; value: number } => item.value !== null && Number.isFinite(item.value));

  const result = new Map<string, number>();
  if (usable.length === 0) return result;

  usable.sort((a, b) => b.value - a.value);
  let lastValue: number | null = null;
  let lastRank = 0;
  usable.forEach((item, index) => {
    const rank = lastValue !== null && item.value === lastValue ? lastRank : index + 1;
    lastValue = item.value;
    lastRank = rank;
    result.set(item.code, rank);
  });
  return result;
};

export type RankSnapshot = {
  date: string;
  /** 每个榜的名次表 */
  ranks: Record<RankBoardKey, Map<string, number>>;
  /** 四榜各自的板块数（该榜可用的板块数量，面板要披露） */
  boardCounts: Record<RankBoardKey, number>;
  /**
   * 这一天的「上榜」名次门槛。
   *
   * 原方法说「前 10」，但那只适用于全市场几百个板块。同花顺 block_top 单日只给
   * **20 个板块**，固定前 10 会松到没有区分度（实测 8 个交易日里没有任何板块能
   * 连续 3 天进两个榜的前 10）。所以门槛按池子大小算：**前 25%，上限 10 名**。
   */
  topN: number;
};

/** 「上榜」门槛：池子的前 25%，上限 10 名 */
export const topNFor = (poolSize: number, cap = TOP_N): number =>
  poolSize <= 0 ? cap : Math.min(cap, Math.max(1, Math.ceil(poolSize * 0.25)));

/** 计算某一天的四个榜 */
export const rankBoards = (date: string, rows: RankInput[], options: { topN?: number } = {}): RankSnapshot => {
  const ranks = {
    pct: computeRanks(rows, 'pct'),
    limitUp: computeRanks(rows, 'limitUp'),
    flow: computeRanks(rows, 'flow'),
    amount: computeRanks(rows, 'amount'),
  };
  return {
    date,
    ranks,
    boardCounts: {
      pct: ranks.pct.size,
      limitUp: ranks.limitUp.size,
      flow: ranks.flow.size,
      amount: ranks.amount.size,
    },
    topN: options.topN ?? topNFor(rows.length),
  };
};

/** 某板块在某个榜的名次；未进榜或榜不可用 → null */
export const rankOf = (
  snapshot: RankSnapshot,
  code: string,
  key: RankBoardKey,
  topN = snapshot.topN,
): number | null => {
  const rank = snapshot.ranks[key].get(code);
  if (rank === undefined) return null;
  return rank <= topN ? rank : null;
};

/**
 * 上榜广度：当日进了几个榜的 TopN（0~4）。
 *
 * 默认门槛是展示用的 TOP_N=10；要按「反复出现」的口径算，
 * 传 `snapshot.topN`（池子的前 25%）——`annotateStreaks` 内部就是这么做的。
 */
export const hitCount = (snapshot: RankSnapshot, code: string, topN = TOP_N): number =>
  RANK_BOARD_KEYS.filter((key) => rankOf(snapshot, code, key, topN) !== null).length;

/**
 * 从按日期升序排列的序列里算「末尾连续满足条件的长度」。
 * `values[i]` 与 `dates[i]` 一一对应，且 dates 必须已经是**交易日序列**（调用方保证），
 * 所以这里不需要再处理跨周末/节假日。
 */
export const trailingStreak = <T>(values: T[], predicate: (value: T) => boolean): number => {
  let streak = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (!predicate(values[index])) break;
    streak += 1;
  }
  return streak;
};

/**
 * 给单个板块的逐日序列补上 rank / hit / streakHit / streakRank。
 *
 * `history` 必须按日期升序、且每个元素都已经算出 pct/limitUpCount/mainNet/amount。
 * `snapshots` 与 `history` 一一对应（同一天的四榜名次）。
 */
export const annotateStreaks = (
  history: RankInput[],
  snapshots: RankSnapshot[],
): Array<Pick<BoardDay, 'rank' | 'hit' | 'streakHit' | 'streakRank'>> => {
  if (history.length !== snapshots.length) {
    throw new Error('history 与 snapshots 长度必须一致');
  }

  // 先算出逐日的名次与上榜广度
  const perDay = history.map((row, index) => {
    const snapshot = snapshots[index];
    const rank: BoardDay['rank'] = {
      pct: rankOf(snapshot, row.code, 'pct'),
      limitUp: rankOf(snapshot, row.code, 'limitUp'),
      flow: rankOf(snapshot, row.code, 'flow'),
      amount: rankOf(snapshot, row.code, 'amount'),
    };
    return { rank, hit: RANK_BOARD_KEYS.filter((key) => rank[key] !== null).length };
  });

  // 逐日按**前缀**算连续天数：第 i 天的 streak 只看第 0..i 天，
  // 这样同一天算出来的值不依赖后面还没发生的事情（回填时不会引入未来信息）。
  return perDay.map((item, index) => {
    const prefix = perDay.slice(0, index + 1);
    const streakOf = (key: RankBoardKey): number =>
      trailingStreak(
        prefix.map((day) => day.rank[key]),
        (value) => value !== null,
      );
    return {
      rank: item.rank,
      hit: item.hit,
      streakHit: trailingStreak(
        prefix.map((day) => day.hit),
        (value) => value >= HIT_MIN,
      ),
      streakRank: {
        pct: streakOf('pct'),
        limitUp: streakOf('limitUp'),
        flow: streakOf('flow'),
        amount: streakOf('amount'),
      },
    };
  });
};

/**
 * 「反复出现的板块」：连续 hit ≥ 2 的天数达到门槛。
 * 输入是该板块**按日升序**的一系列 hit 值。
 *
 * 注意：同花顺口径下 `hit ≥ 2` 很难达成，因为这个池子只有 20 个板块，
 * 而且**涨停家数榜靠前的板块涨幅天然靠后**（成员大多封在涨停价上）。
 * 所以判定「反复出现」主要用 `maxRankStreak`（任一榜连续在榜），见 report.ts。
 */
export const isRepeatBoard = (hits: number[], min = REPEAT_STREAK_MIN): boolean =>
  trailingStreak(hits, (value) => value >= HIT_MIN) >= min;
