/**
 * 主线引擎 · 从「一天的原始数据」装配成 BoardDay（设计稿 §2~§5）。
 *
 * 数据流：
 *   block_top(当日)  ─┬─→ 板块涨幅 / 涨停家数 / 连板 / 最高板 / 涨停成员 + 涨停原因
 *                     └─→ 题材提取（L2）与梯队（L3）的原料
 *   板块年度日K       ──→ 成交额（AMT 榜）
 *   realhead(仅当日)  ──→ 成交额 + 主力净流入（FLW 榜）+ 涨停家数交叉验证
 *
 * 装配是**逐日**的；跨日的排名、连续上榜、连续性、题材连续性由
 * `buildBoardHistories` 在拿到多日数据后统一算，避免逐日调用时把未来信息带进来。
 */
import type { BlockTopMember, BlockTopRow } from '../themes/tenjqka.js';
import type { BoardDay, LadderMember, ThemeTag } from './types.js';
import { buildLadder, type LadderResult } from './ladder.js';
import { extractThemes, type ThemeMemberInput } from './theme-extract.js';
import { annotateStreaks, rankBoards, type RankInput, type RankSnapshot } from './ranks.js';
import { buildCapitalReturn, toBoardDayFields, isEbbing } from './continuity.js';
import { scoreBoard } from './score.js';

/** 装配一天所需的原始输入 */
export type DayRaw = {
  date: string;
  /** block_top 当日结果（固定 Top 20） */
  rows: BlockTopRow[];
  /** 板块 → 当日成交额（元）；来自年度日K（历史）或 realhead（当日） */
  amountByCode: Map<string, number>;
  /** 板块 → 当日主力净流入（元）；**只有当日有**，历史为 undefined */
  mainNetByCode?: Map<string, number>;
  /** 市场最高连板（全市场涨停池口径）；不可用时 null */
  marketMaxBoard: number | null;
  /** 板块 → 手工催化说明；缺省表示没录入 */
  catalystByCode?: Map<string, string>;
};

/** 跨日指标在装配阶段先留空，由 `buildBoardHistories` 回填 */
export type BoardDayBase = Omit<
  BoardDay,
  'rank' | 'hit' | 'streakHit' | 'streakRank' | 'streak' | 'dayKind' | 'capitalReturn' | 'judge'
>;

/** 一天的装配结果（未算跨日指标） */
export type DayPartial = {
  date: string;
  /** 用于排名的横截面输入 */
  rankInputs: RankInput[];
  /** code → 该板块当日快照（跨日字段未填） */
  byCode: Map<string, BoardDayBase>;
  /** code → 当日题材 */
  themesByCode: Map<string, ThemeTag[]>;
  /** code → 当日梯队 */
  ladderByCode: Map<string, LadderResult>;
};

const toLadderMember = (member: BlockTopMember): LadderMember => ({
  symbol: member.symbol,
  name: member.name,
  boardCount: member.boardCount ?? 1,
  highLabel: member.highLabel,
  firstSealTime: member.firstSealTime,
  // block_top 不给封单额 / 成交额 / 流通市值 → 一律 null（中军与炸板率按不可判定处理）
  sealAmount: null,
  amount: null,
  floatMarketCap: null,
  turnoverRate: null,
  pct: member.pct,
  changeTag: member.changeTag,
  limitUpIn60d: null,
  isSt: member.isSt,
  reasonTags: member.reasonTags,
});

const toThemeMember = (member: LadderMember): ThemeMemberInput => ({
  symbol: member.symbol,
  name: member.name,
  boardCount: member.boardCount,
  highLabel: member.highLabel,
  reasonTags: member.reasonTags,
});

/**
 * 装配某一天。
 *
 * 注意 `marketMaxBoard` 与 `catalystByCode` 必须由调用方提供——
 * 前者要全市场涨停池（block_top 只给 Top 20 板块的成员），后者是人工项，
 * 引擎**不猜**。
 */
export const buildDay = (raw: DayRaw): DayPartial => {
  const rankInputs: RankInput[] = [];
  const byCode = new Map<string, BoardDayBase>();
  const themesByCode = new Map<string, ThemeTag[]>();
  const ladderByCode = new Map<string, LadderResult>();

  for (const row of raw.rows) {
    const amount = raw.amountByCode.get(row.code) ?? null;
    const mainNet = raw.mainNetByCode?.get(row.code) ?? null;

    const ladderMembers = row.members.map(toLadderMember);
    const ladder = buildLadder(ladderMembers);
    const themes = extractThemes(ladderMembers.map(toThemeMember));

    rankInputs.push({
      code: row.code,
      pct: row.pct,
      limitUpCount: row.limitUpCount,
      mainNet,
      amount,
    });

    byCode.set(row.code, {
      date: raw.date,
      code: row.code,
      name: row.name,
      pct: row.pct,
      limitUpCount: row.limitUpCount ?? 0,
      continuousCount: row.continuousCount ?? 0,
      highLabel: row.highLabel,
      maxBoard: ladder.maxBoard,
      upstreamDays: row.days,
      amount,
      mainNet,
      ladder,
      themes,
    });
    themesByCode.set(row.code, themes);
    ladderByCode.set(row.code, ladder);
  }

  return { date: raw.date, rankInputs, byCode, themesByCode, ladderByCode };
};

export type BoardHistory = {
  code: string;
  name: string;
  /** 按日期升序的逐日快照 */
  days: BoardDay[];
  /** 该板块出现过的所有题材 key（按出现次数降序） */
  themeKeys: string[];
};

export type AssembleOptions = {
  /** 手工催化表：`${date}|${code}` → 说明 */
  catalystNotes?: Map<string, string>;
};

/**
 * 跨日装配：把多天的 `DayPartial` 合成每个板块的完整历史。
 *
 * 跨日指标全部在这里算，顺序不能乱：
 *   1. 逐日横截面排名（rankBoards）
 *   2. 每个板块的连续上榜（annotateStreaks，按前缀算、不引入未来信息）
 *   3. 每个板块的连续性与分歧回流（buildCapitalReturn）
 *   4. 题材连续性（同一 key 在这个板块内连续 cnt ≥ 2 的天数）
 *   5. 跨板块扩散（同一天里这个 key 出现在几个板块）
 *   6. 评分（scoreBoard）
 */
export const buildBoardHistories = (
  partials: DayPartial[],
  options: AssembleOptions = {},
): BoardHistory[] => {
  const ordered = [...partials].sort((a, b) => a.date.localeCompare(b.date));
  const snapshots: RankSnapshot[] = ordered.map((partial) => rankBoards(partial.date, partial.rankInputs));

  // 所有出现过的板块代码（并集）
  const codes = new Set<string>();
  for (const partial of ordered) for (const code of partial.byCode.keys()) codes.add(code);

  // 跨板块扩散：同一天里每个题材 key 出现在几个板块
  const spreadByDate = ordered.map((partial) => {
    const counter = new Map<string, number>();
    for (const themes of partial.themesByCode.values()) {
      for (const theme of themes) counter.set(theme.key, (counter.get(theme.key) ?? 0) + 1);
    }
    return counter;
  });

  const histories: BoardHistory[] = [];

  for (const code of codes) {
    /*
     * 关键：按**全序列**算跨日指标，不在榜的日子补空行。
     *
     * 实测踩到：如果只看「这个板块出现过的日子」，block_top 每天只给 20 个板块，
     * 板块一旦掉出 Top 20，它的连续天数与连续上榜就会被截断——
     * 「连续 3 天」会被算成「断链」，而事实只是那天没进前 20。
     *
     * 空行在连续性里判为 weak（`pct === null` → 断链）、在排名里名次为 null（不计数），
     * 语义正好是「今天它不在候选里」。
     */
    const baseSeries = ordered.map((partial) => partial.byCode.get(code));
    const rankInputs: RankInput[] = baseSeries.map((base) => ({
      code,
      pct: base?.pct ?? null,
      limitUpCount: base?.limitUpCount ?? null,
      mainNet: base?.mainNet ?? null,
      amount: base?.amount ?? null,
    }));
    const rankAnnotations = annotateStreaks(rankInputs, snapshots);
    const continuity = buildCapitalReturn(
      baseSeries.map((base, index) => ({
        date: ordered[index].date,
        pct: base?.pct ?? null,
        limitUpCount: base?.limitUpCount ?? 0,
        prevLimitUpCount: null,
        mainNet: base?.mainNet ?? null,
      })),
    );
    const continuityFields = toBoardDayFields(continuity);

    // 题材连续性：该 key 在这个板块内连续 cnt ≥ 2 的天数
    const themeKeyHistory: Array<Set<string>> = ordered.map(
      (partial) => new Set((partial.themesByCode.get(code) ?? []).map((theme) => theme.key)),
    );
    const themeCounter = new Map<string, number>();

    const days: BoardDay[] = [];
    ordered.forEach((partial, index) => {
      const base = baseSeries[index];
      if (base === undefined) return; // 该日不在榜：内部序列保留空行，但不产出快照

      const themes = (partial.themesByCode.get(code) ?? []).map((theme) => {
        let streak = 0;
        for (let cursor = index; cursor >= 0; cursor -= 1) {
          if (!themeKeyHistory[cursor].has(theme.key)) break;
          streak += 1;
        }
        const spread = spreadByDate[index].get(theme.key) ?? 1;
        themeCounter.set(theme.key, (themeCounter.get(theme.key) ?? 0) + 1);
        return {
          ...theme,
          streak,
          boardSpread: spread,
          marketCount: spread,
          outOfBoardRatio: spread <= 1 ? 0 : (spread - 1) / spread,
        };
      });

      const day: BoardDay = {
        ...base,
        ...rankAnnotations[index],
        ...continuityFields[index],
        themes,
        judge: null,
      };

      day.judge = scoreBoard({
        day,
        marketMaxBoard: maxBoardInRows(partial),
        catalystNote: options.catalystNotes?.get(`${partial.date}|${code}`) ?? null,
      });
      // 退潮标记：scoreBoard 与 L4 事件都判出来才算（任一命中即退潮）
      if (isEbbing(continuity)) {
        day.judge = { ...day.judge, ebb: true };
      }
      days.push(day);
    });

    if (days.length === 0) continue;

    const themeKeys = [...themeCounter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key]) => key);

    histories.push({
      code,
      name: days[days.length - 1].name || code,
      days,
      themeKeys,
    });
  }

  return histories.sort((a, b) => a.code.localeCompare(b.code));
};

/** 一天内 block_top 那 20 个板块里的最高板数；**不是市场最高板**（只是可得上界） */
const maxBoardInRows = (partial: DayPartial): number | null => {
  let max: number | null = null;
  for (const ladder of partial.ladderByCode.values()) {
    if (ladder.maxBoard > 0) max = Math.max(max ?? 0, ladder.maxBoard);
  }
  return max;
};
