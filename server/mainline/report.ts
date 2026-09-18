/**
 * 主线复盘报告（多日模式）——把「单日面板」补成原方法真正要的东西。
 *
 * 为什么必须多日：原方法的核心是「**反复出现**」与「**分歧后回流**」，
 * 这两件事单日算不出来。所以这里拉最近 N 个交易日，做四件事：
 *   ① 累积板块宇宙（block_top 历史并集），横截面排名在**全宇宙**里算
 *   ② 每个板块的上榜广度 Hit 与连续上榜天数（掉出 Top 20 的日子补空行，不断链）
 *   ③ 每个板块的连续计数与分歧回流（分歧日不断链）
 *   ④ 题材的连续出现天数与跨板块扩散
 *
 * 纪律：**资金流只有当日有**（realhead 没有历史），所以历史日的 `主力净流入榜`
 * 与 `分歧后回流` 的资金条件不可判定，全部按缺失披露，不拿别的数字顶。
 */
import type { BlockTopRow, LimitUpPoolRow } from '../themes/tenjqka.js';
import type { BoardRealtime } from './types.js';
import { buildUniverse } from './universe.js';
import { joinMembers, buildPanelLadder, type PanelMember } from './panel.js';
import { extractThemes, type ThemeMemberInput } from './theme-extract.js';
import { annotateStreaks, rankBoards, rankOf, type RankBoardKey, type RankInput, type RankSnapshot } from './ranks.js';
import { buildCapitalReturn, type FlowDayInput } from './continuity.js';
import { scoreBoard, TIER_LABEL } from './score.js';
import type { BoardDay } from './types.js';
import { fetchBlockTop, fetchLimitUpPool } from '../themes/tenjqka.js';
import { fetchBoardRealtime } from './client.js';

/** 一个板块在整个窗口里的逐日轨迹 + 最新一天的全量信息 */
export type BoardReport = {
  code: string;
  name: string;
  /** 逐日快照（只含该板块在榜的日子） */
  days: BoardDay[];
  /** 最新交易日的成员明细 */
  members: PanelMember[];
  /** 最新交易日的题材 */
  themes: Array<{ key: string; count: number; maxBoard: number; members: string[]; variants: string[]; streak: number; boardSpread: number }>;
  /** 最新交易日的五档阵容 */
  ladder: ReturnType<typeof buildPanelLadder>;
  /** 窗口内进过 Top 20 的天数 */
  appearDays: number;
  /** 最新一天的连续上榜天数（Hit ≥ 2） */
  streakHit: number;
  /**
   * 最新一天的「连续在榜」天数 = 四个榜里最长的那个连续在榜天数。
   *
   * 为什么不用 `streakHit`（两个榜同时上榜）做「反复出现」的判据：
   * 同花顺 block_top 单日只有 20 个板块，而**涨停家数榜靠前的板块涨幅天然靠后**
   * （成员大多封在涨停价上），两个榜同时进前 5 几乎不可能。
   * 实测 10 个交易日里，没有任何板块达成「连续 3 天 hit ≥ 2」。
   */
  maxRankStreak: number;
  /** 最长连续在榜对应的是哪个榜（用于面板说明） */
  maxRankKey: RankBoardKey | null;
  /** 窗口内是否有分歧后回流 */
  capitalReturn: number | null;
  /** 最新一天的评分 */
  score: BoardDay['judge'];
};

export type MainlineReport = {
  /** 窗口内的交易日（升序） */
  tradeDates: string[];
  latestDate: string;
  /** 四榜（最新交易日） */
  ranks: Array<{ key: RankBoardKey; label: string; rows: BoardReport[] }>;
  /** 全部板块（按最新一天得分降序） */
  boards: BoardReport[];
  warnings: string[];
  /** 当日主力净流入榜不可用时为空表 */
  flowAvailable: boolean;
};

const RANK_LABELS: Record<RankBoardKey, string> = {
  pct: '涨幅榜',
  limitUp: '涨停家数榜',
  flow: '主力净流入榜',
  amount: '成交额榜',
};

/** 四榜表最多显示多少个（「上榜」门槛由 ranks.ts 的 topNFor 按池子大小算） */
const TOP_N = 10;

export type ReportOptions = {
  /** 回看多少个交易日（含最新） */
  days: number;
  /** 结束日期（交易日）；缺省用今天，会自动回退到最近有数据的日子 */
  endDate?: string;
  fetchImpl?: typeof fetch;
  /** 手工催化表：`${date}|${code}` → 说明 */
  catalystNotes?: Map<string, string>;
  /** 并发 */
  concurrency?: number;
};

/** 生成 [from, to] 的自然日序列（接口对非交易日返回空，由宇宙累积过滤） */
const naturalDays = (from: string, to: string): string[] => {
  const dates: string[] = [];
  const cursor = new Date(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}T00:00:00Z`);
  const last = new Date(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(
      `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`,
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const shiftDays = (date: string, delta: number): string => {
  const cursor = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  return `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`;
};

/**
 * 生成主线复盘报告。
 *
 * 多拉 2 倍自然日作为缓冲：回看 N 个交易日大约需要 N×1.5 个自然日，
 * 设成 2 倍是为了跨长假也不至于不够。
 */
export const buildReport = async (options: ReportOptions): Promise<MainlineReport> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];

  // ---- 找到最近一批交易日 ----
  const end = options.endDate ?? todayInBeijing();
  const probeFrom = shiftDays(end, -Math.max(30, options.days * 3));
  const probeDates = naturalDays(probeFrom, end);
  const universe = await buildUniverse(probeDates, fetchImpl, options.concurrency ?? 6);
  const tradeDates = universe.hitDates.slice(-options.days);
  if (tradeDates.length === 0) {
    throw new Error(`在 ${probeFrom}~${end} 之间没有取到任何交易日数据`);
  }
  const latestDate = tradeDates[tradeDates.length - 1];

  // ---- 逐日取 block_top + 涨停池 + realhead(仅最新日) ----
  const rowsByDate = new Map<string, BlockTopRow[]>();
  const poolByDate = new Map<string, LimitUpPoolRow[]>();
  const poolIndexByDate = new Map<string, Map<string, LimitUpPoolRow>>();
  for (const date of tradeDates) {
    const { rows } = await fetchBlockTop(date, fetchImpl);
    const { rows: pool } = await fetchLimitUpPool(date, fetchImpl);
    rowsByDate.set(date, rows);
    poolByDate.set(date, pool);
    poolIndexByDate.set(date, new Map(pool.map((item) => [item.symbol, item])));
  }

  /**
   * 预先算好「每一天 × 每一个板块」的题材 key 集合。
   * 后面算题材连续天数与跨板块扩散都从它查，避免重复解析涨停原因。
   */
  const themeKeysByDateCode = new Map<string, Set<string>>();
  const themeDetailByDateCode = new Map<string, ReturnType<typeof extractThemes>>();
  for (const date of tradeDates) {
    for (const row of rowsByDate.get(date) ?? []) {
      const members = joinMembers(row, poolIndexByDate.get(date) ?? new Map());
      const themes = extractThemes(
        members.map<ThemeMemberInput>((member) => ({
          symbol: member.symbol,
          name: member.name,
          boardCount: member.boardCount,
          highLabel: member.highLabel,
          reasonTags: member.reasonTags,
        })),
      );
      themeKeysByDateCode.set(`${date}|${row.code}`, new Set(themes.map((theme) => theme.key)));
      themeDetailByDateCode.set(`${date}|${row.code}`, themes);
    }
  }

  /** 最新一天每个题材 key 出现在多少个板块（跨板块扩散） */
  const spreadOnLatest = new Map<string, number>();
  for (const row of rowsByDate.get(latestDate) ?? []) {
    for (const key of themeKeysByDateCode.get(`${latestDate}|${row.code}`) ?? []) {
      spreadOnLatest.set(key, (spreadOnLatest.get(key) ?? 0) + 1);
    }
  }

  // realhead 只能取当前 —— 历史日没有资金流，按缺失处理
  const realtimeByCode = new Map<string, BoardRealtime>();
  const latestRows = rowsByDate.get(latestDate) ?? [];
  await Promise.all(
    latestRows.map(async (row) => {
      const { realtime } = await fetchBoardRealtime(row.code, fetchImpl);
      if (realtime) realtimeByCode.set(row.code, realtime);
    }),
  );
  const flowAvailable = [...realtimeByCode.values()].some((item) => item.mainNet !== null);
  if (!flowAvailable) {
    warnings.push('主力净流入（realhead.527198）当日全部取数失败，该榜与「分歧回流」的资金条件按不可判定处理。');
  }
  if (latestDate !== end) {
    warnings.push(`请求日 ${end} 无数据（非交易日或数据未生成），已回退到最近交易日 ${latestDate}。`);
  }

  // ---- 板块宇宙：所有日期出现过的板块并集 ----
  const codes = new Set<string>();
  const nameByCode = new Map<string, string>();
  for (const date of tradeDates) {
    for (const row of rowsByDate.get(date) ?? []) {
      codes.add(row.code);
      nameByCode.set(row.code, row.name);
    }
  }

  // ---- 逐日横截面排名（在**全宇宙**里算，缺席 = null） ----
  // 「上榜」门槛按当天池子大小算（topNFor：前 25%，上限 10），由 rankBoards 落在快照里
  const snapshots: RankSnapshot[] = tradeDates.map((date) => {
    const rows = rowsByDate.get(date) ?? [];
    const inputs: RankInput[] = [...codes].map((code) => {
      const row = rows.find((item) => item.code === code);
      const realtime = realtimeByCode.get(code);
      return {
        code,
        pct: row?.pct ?? null,
        limitUpCount: row?.limitUpCount ?? null,
        // 资金流只有最新日有
        mainNet: date === latestDate ? (realtime?.mainNet ?? null) : null,
        amount: date === latestDate ? (realtime?.amount ?? null) : null,
      };
    });
    return rankBoards(date, inputs);
  });

  // ---- 逐板块组装 ----
  const reports: BoardReport[] = [];

  for (const code of codes) {
    const series: RankInput[] = tradeDates.map((date) => {
      const row = (rowsByDate.get(date) ?? []).find((item) => item.code === code);
      const realtime = realtimeByCode.get(code);
      return {
        code,
        pct: row?.pct ?? null,
        limitUpCount: row?.limitUpCount ?? null,
        mainNet: date === latestDate ? (realtime?.mainNet ?? null) : null,
        amount: date === latestDate ? (realtime?.amount ?? null) : null,
      };
    });
    const annotations = annotateStreaks(series, snapshots);

    const flowSeries: FlowDayInput[] = tradeDates.map((date) => {
      const row = (rowsByDate.get(date) ?? []).find((item) => item.code === code);
      const realtime = realtimeByCode.get(code);
      return {
        date,
        pct: row?.pct ?? null,
        limitUpCount: row?.limitUpCount ?? 0,
        prevLimitUpCount: null,
        mainNet: date === latestDate ? (realtime?.mainNet ?? null) : null,
      };
    });
    const continuity = buildCapitalReturn(flowSeries);

    const days: BoardDay[] = [];
    tradeDates.forEach((date, index) => {
      const row = (rowsByDate.get(date) ?? []).find((item) => item.code === code);
      if (row === undefined) return; // 该日不在榜

      const pool = poolByDate.get(date) ?? [];
      const marketMaxBoard =
        pool.length === 0 ? null : Math.max(...pool.map((item) => item.boardCount ?? 1));
      const realtime = realtimeByCode.get(code);
      const annotation = annotations[index];
      const continuityField = continuity.days[index];

      const day: BoardDay = {
        date,
        code,
        name: row.name,
        pct: row.pct,
        limitUpCount: row.limitUpCount ?? 0,
        continuousCount: row.continuousCount ?? 0,
        highLabel: row.highLabel,
        maxBoard: 0,
        upstreamDays: row.days,
        amount: date === latestDate ? (realtime?.amount ?? null) : null,
        mainNet: date === latestDate ? (realtime?.mainNet ?? null) : null,
        rank: annotation.rank,
        hit: annotation.hit,
        streakHit: annotation.streakHit,
        streakRank: annotation.streakRank,
        streak: continuityField.streak,
        dayKind: continuityField.dayKind,
        capitalReturn: continuityField.capitalReturn,
        ladder: null,
        themes: [],
        judge: null,
      };

      if (date === latestDate) {
        const members = joinMembers(row, new Map(pool.map((item) => [item.symbol, item])));
        const ladder = buildPanelLadder(members);
        day.ladder = ladder;
        day.maxBoard = ladder.maxBoard;
        day.judge = scoreBoard({
          day,
          marketMaxBoard,
          catalystNote: options.catalystNotes?.get(`${date}|${code}`) ?? null,
        });
      } else {
        // 历史日只做连续性判定，不评分（评分需要成交额榜等当日字段）
        const ladder = buildPanelLadder(
          joinMembers(row, new Map(pool.map((item) => [item.symbol, item]))),
        );
        day.ladder = ladder;
        day.maxBoard = ladder.maxBoard;
      }

      days.push(day);
    });

    if (days.length === 0) continue;

    const latestRow = (rowsByDate.get(latestDate) ?? []).find((item) => item.code === code);
    const members =
      latestRow === undefined
        ? []
        : joinMembers(latestRow, poolIndexByDate.get(latestDate) ?? new Map());
    const themes = themeDetailByDateCode.get(`${latestDate}|${code}`) ?? [];

    // 题材连续天数：从窗口末尾往前数，哪几天这个板块里有该题材（≥2 家）
    const themeSeries = tradeDates.map(
      (date) => themeKeysByDateCode.get(`${date}|${code}`) ?? new Set<string>(),
    );

    const themeDetails = themes.map((theme) => {
      let streak = 0;
      for (let cursor = themeSeries.length - 1; cursor >= 0; cursor -= 1) {
        if (!themeSeries[cursor].has(theme.key)) break;
        streak += 1;
      }
      return {
        key: theme.key,
        count: theme.count,
        maxBoard: theme.maxBoard,
        members: theme.members.map((item) => item.name),
        variants: theme.variants,
        streak,
        boardSpread: spreadOnLatest.get(theme.key) ?? 1,
      };
    });

    const latestDay = days[days.length - 1];
    // 「连续在榜」取四个榜里最长的那个（任一榜连续在榜即算资金反复做这个方向）
    const rankKeys: RankBoardKey[] = ['pct', 'limitUp', 'flow', 'amount'];
    let maxRankKey: RankBoardKey | null = null;
    let maxRankStreak = 0;
    for (const key of rankKeys) {
      const streak = latestDay.streakRank[key];
      if (streak > maxRankStreak) {
        maxRankStreak = streak;
        maxRankKey = key;
      }
    }

    reports.push({
      code,
      name: nameByCode.get(code) ?? code,
      days,
      members,
      themes: themeDetails,
      ladder: latestDay.ladder ?? buildPanelLadder([]),
      appearDays: days.length,
      streakHit: latestDay.streakHit,
      maxRankStreak,
      maxRankKey,
      capitalReturn: latestDay.capitalReturn,
      score: latestDay.judge,
    });
  }

  // ---- 排序：最新一天得分降序；没评分的（当日不在榜）沉底 ----
  const sorted = [...reports].sort((a, b) => {
    const scoreDiff = (b.score?.total ?? -99) - (a.score?.total ?? -99);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.days[b.days.length - 1]?.streakHit ?? 0) - (a.days[a.days.length - 1]?.streakHit ?? 0);
  });

  // ---- 四榜（最新交易日） ----
  const latestSnapshot = snapshots[snapshots.length - 1];
  const rankTables = (Object.keys(RANK_LABELS) as RankBoardKey[]).map((key) => ({
    key,
    label: RANK_LABELS[key],
    rows: reports
      .map((report) => ({ report, rank: rankOf(latestSnapshot, report.code, key) }))
      .filter((item): item is { report: BoardReport; rank: number } => item.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, TOP_N)
      .map((item) => item.report),
  }));

  warnings.push(
    '板块宇宙来自同花顺涨停板块 Top 20 的历史并集，未进过 Top 20 的板块不在本表内——这是口径限制，不是「今天没有主线」。',
  );
  warnings.push(
    '「上榜」门槛 = 当日池子的前 25%（上限 10 名）。20 个板块时为前 5 名；原方法的「前 10」是按全市场几百个板块说的，直接套用会松到没有区分度。',
  );
  warnings.push('历史日没有资金流（realhead 无历史接口），所以「分歧后回流」的历史判定只用了涨幅与涨停家数。');
  warnings.push('中军的「大成交」用「流通市值 × 换手率」近似（涨停池不给成员成交额），属代理口径。');
  warnings.push('评分不是买卖信号，用于防止被当天涨幅迷惑。');

  return {
    tradeDates,
    latestDate,
    ranks: rankTables,
    boards: sorted,
    warnings,
    flowAvailable,
  };
};

/** 北京时间的今天（YYYYMMDD） */
export const todayInBeijing = (): string => {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
};

const yi = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${(value / 1e8).toFixed(1)}亿`;

const pctText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const DAY_KIND: Record<string, string> = {
  strong: '强势',
  divergence: '分歧',
  weak: '弱',
};

/** 渲染成 markdown */
export const renderReport = (report: MainlineReport): string => {
  const lines: string[] = [];
  lines.push(`# 主线复盘 · ${report.latestDate}`);
  lines.push('');
  lines.push(
    `> 窗口 ${report.tradeDates[0]} ~ ${report.latestDate}（${report.tradeDates.length} 个交易日）。` +
      '口径：同花顺涨停板块 Top 20。分数不是买卖信号。',
  );
  lines.push('');

  // 一、四榜
  lines.push('## 一、四榜并列（最新交易日）');
  lines.push('');
  for (const table of report.ranks) {
    lines.push(`### ${table.label}`);
    lines.push('');
    lines.push('| 名次 | 板块 | 涨幅 | 涨停家数 | 主力净流入 | 成交额 | 上榜榜数 | 连榜 |');
    lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    table.rows.forEach((board, index) => {
      const latest = board.days[board.days.length - 1];
      lines.push(
        `| ${index + 1} | ${board.name} | ${pctText(latest?.pct)} | ${latest?.limitUpCount ?? '—'} | ${yi(latest?.mainNet)} | ${yi(latest?.amount)} | ${latest?.hit ?? 0}/4 | ${board.streakHit} |`,
      );
    });
    lines.push('');
  }

  // 二、反复出现的板块
  const rankLabelOf: Record<RankBoardKey, string> = {
    pct: '涨幅榜',
    limitUp: '涨停家数榜',
    flow: '主力净流入榜',
    amount: '成交额榜',
  };
  const repeat = report.boards.filter((board) => board.score !== null && board.maxRankStreak >= 3);
  lines.push('## 二、反复出现的板块（连续 3 天以上在同一个榜的前列）');
  lines.push('');
  if (repeat.length === 0) {
    lines.push('（窗口内没有板块达成连续 3 天在任一榜的前列）');
  } else {
    lines.push('| 板块 | 连榜天数 | 在哪个榜 | 涨停 | 最高板 | 涨幅 | 得分 | 分档 | 回流 |');
    lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | --- | :---: |');
    for (const board of repeat) {
      const latest = board.days[board.days.length - 1];
      const ret = board.capitalReturn;
      lines.push(
        `| ${board.name} | ${board.maxRankStreak} | ${board.maxRankKey ? rankLabelOf[board.maxRankKey] : '—'} | ` +
          `${latest?.limitUpCount ?? '—'} | ${latest?.maxBoard ?? '—'} | ${pctText(latest?.pct)} | ` +
          `${board.score?.total ?? '—'} | ${board.score ? TIER_LABEL[board.score.tier] : '—'} | ` +
          `${ret === 1 ? '✔ 已回流' : ret === -1 ? '✘ 退潮' : ret === 0 ? '未确认' : '—'} |`,
      );
    }
  }
  lines.push('');

  // 三、全部板块（当日 Top 20）
  lines.push('## 三、当日板块总览（按得分排序）');
  lines.push('');
  lines.push('| 板块 | 得分 | 分档 | 涨停 | 连板 | 最高板 | 涨幅 | 主力净流入 | 成交额 | 四榜名次(涨/停/资/额) | 连榜 | 连续 |');
  lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |');
  for (const board of report.boards) {
    if (board.score === null) continue; // 当日不在榜
    const latest = board.days[board.days.length - 1];
    const rank = `${latest?.rank.pct ?? '—'}/${latest?.rank.limitUp ?? '—'}/${latest?.rank.flow ?? '—'}/${latest?.rank.amount ?? '—'}`;
    lines.push(
      `| ${board.name} | ${board.score.total} | ${TIER_LABEL[board.score.tier]} | ${latest?.limitUpCount ?? '—'} | ${latest?.continuousCount ?? '—'} | ` +
        `${latest?.maxBoard ?? '—'} | ${pctText(latest?.pct)} | ${yi(latest?.mainNet)} | ${yi(latest?.amount)} | ${rank} | ${board.streakHit} | ${latest?.streak ?? '—'} |`,
    );
  }
  lines.push('');

  // 四、重点板块明细
  lines.push('## 四、重点板块明细');
  lines.push('');
  for (const board of report.boards.filter((item) => item.score !== null).slice(0, 5)) {
    lines.push(`### ${board.name}（${board.code}）—— ${board.score?.total} 分，${board.score ? TIER_LABEL[board.score.tier] : '—'}`);
    lines.push('');
    lines.push(
      `**梯队**：高度龙头 ${board.ladder.leader ? `${board.ladder.leader.name}（${board.ladder.leader.highLabel ?? `${board.ladder.leader.boardCount}板`}）` : '—'}` +
        ` ｜ 前排核心 ${board.ladder.frontRow.length} 只 ｜ 首板助攻 ${board.ladder.firstBoard.length} 只 ｜ 中军 ${board.ladder.core.length} 只` +
        ` ｜ 完整梯队：${board.ladder.full ? '是' : '否'}`,
    );
    if (board.ladder.frontRow.length > 0) {
      lines.push(`- 前排：${board.ladder.frontRow.map((item) => `${item.name}(${item.highLabel ?? `${item.boardCount}板`})`).join('、')}`);
    }
    if (board.ladder.core.length > 0) {
      lines.push(
        `- 中军（代理口径）：${board.ladder.core.map((item) => `${item.name}（流通${yi(item.floatMarketCap)}/换手${item.turnoverRate?.toFixed(1) ?? '—'}%）`).join('、')}`,
      );
    }
    if (board.ladder.firstBoard.length > 0) {
      lines.push(`- 首板：${board.ladder.firstBoard.map((item) => item.name).join('、')}`);
    }
    lines.push('');

    lines.push('**题材**（涨停原因归一后 ≥2 家成题）：');
    if (board.themes.length === 0) {
      lines.push('- （无 ≥2 家的题材——这个板块的涨停股各炒各的，属宽概念）');
    } else {
      for (const theme of board.themes) {
        const variants = theme.variants.length > 1 ? `（归一自：${theme.variants.join(' / ')}）` : '';
        lines.push(
          `- **${theme.key}** ${theme.count} 家，最高 ${theme.maxBoard} 板，连续 ${theme.streak} 天，蔓延 ${theme.boardSpread} 个板块：${theme.members.join('、')}${variants}`,
        );
      }
    }
    lines.push('');

    lines.push('**逐日轨迹**：');
    lines.push('');
    lines.push('| 日期 | 涨幅 | 涨停 | 最高板 | 类型 | 连续 | 连榜 | 上榜 | 回流 |');
    lines.push('| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | :---: |');
    for (const day of board.days) {
      lines.push(
        `| ${day.date} | ${pctText(day.pct)} | ${day.limitUpCount} | ${day.maxBoard} | ${DAY_KIND[day.dayKind] ?? day.dayKind} | ${day.streak} | ${day.streakHit} | ${day.hit}/4 | ` +
          `${day.capitalReturn === 1 ? '✔' : day.capitalReturn === -1 ? '✘' : '—'} |`,
      );
    }
    lines.push('');

    lines.push('**评分明细**：');
    lines.push('');
    lines.push('| 条件 | 命中 | 分 | 依据 |');
    lines.push('| --- | :---: | ---: | --- |');
    for (const condition of board.score?.conditions ?? []) {
      lines.push(`| ${condition.label} | ${condition.hit ? '✔' : '✘'} | ${condition.score} | ${condition.evidence ?? '—'} |`);
    }
    lines.push('');
  }

  lines.push('## 五、口径与限制');
  lines.push('');
  for (const warning of report.warnings) lines.push(`- ${warning}`);
  lines.push('');
  return lines.join('\n');
};
