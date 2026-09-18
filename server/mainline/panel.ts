/**
 * 主线面板（设计稿 §13~§17）。
 *
 * 把原方法那套收盘后动作序列，做成一次调用就出结果的复盘报告：
 *   ① 四榜并列（涨幅 / 涨停家数 / 主力净流入 / 成交额）
 *   ② 反复出现的板块（连续 Hit ≥ 2 达 3 天）
 *   ③ 梯队体检（五档阵容 + 中军）
 *   ④ 从板块里找题材（归一后 ≥2 家成题，带连续天数与跨板块扩散）
 *   ⑤ 评分表逐项（命中/得分/依据）+ 分档
 *
 * 面板纪律（设计稿 §13）：**口径必须可见、缺失就留白、分数要能拆。**
 * 所以每一项都带依据数字，算不出来的写「不可判定」而不是「没有」。
 */
import type { BlockTopRow, LimitUpPoolRow } from '../themes/tenjqka.js';
import type { BoardRealtime, BoardDay, LadderMember } from './types.js';
import type { LadderResult } from './ladder.js';
import { buildLadder } from './ladder.js';
import { extractThemes, type ThemeMemberInput } from './theme-extract.js';
import { rankBoards, rankOf, type RankBoardKey, type RankInput } from './ranks.js';
import { scoreBoard, TIER_LABEL } from './score.js';

/** 中军判定的「大成交」替代口径：涨停池不给成交额，只有换手率与流通市值 */
export const CORE_MIN_FLOAT_CAP = 1e10;
export const CORE_MIN_TURNOVER = 3;

export type PanelMember = {
  symbol: string;
  name: string;
  boardCount: number;
  highLabel: string | null;
  firstSealTime: string | null;
  price: number | null;
  pct: number | null;
  /** 封单额（元） */
  sealAmount: number | null;
  /** 换手率 % */
  turnoverRate: number | null;
  /** 流通市值（元） */
  floatMarketCap: number | null;
  /** 是否属于中军候选（大市值 + 有换手 = 大成交的可得代理） */
  isCoreCandidate: boolean;
  reasonTags: string[];
  reasonText: string | null;
};

export type PanelBoard = {
  code: string;
  name: string;
  pct: number | null;
  limitUpCount: number | null;
  continuousCount: number | null;
  highLabel: string | null;
  upstreamDays: number | null;
  amount: number | null;
  mainNet: number | null;
  /** 四榜名次 */
  rank: Record<RankBoardKey, number | null>;
  hit: number;
  /** 连续 Hit ≥ 2 的天数（只能从历史算，单日调用时为 1 或 0） */
  repeatDays: number;
  ladder: LadderResult;
  themes: Array<{
    key: string;
    display: string;
    count: number;
    maxBoard: number;
    members: string[];
    variants: string[];
  }>;
  members: PanelMember[];
  score: BoardDay['judge'];
};

export type PanelInput = {
  tradeDate: string;
  /** block_top 当日结果 */
  rows: BlockTopRow[];
  /** 涨停池（补封单额 / 换手率 / 流通市值）+ 市场最高连板 */
  pool: LimitUpPoolRow[];
  /** 板块实时行情（成交额 + 主力净流入） */
  realtime: Map<string, BoardRealtime>;
  /** 手工催化表 */
  catalystByCode?: Map<string, string>;
};

export type PanelResult = {
  tradeDate: string;
  /** 四榜各自的前 N 名 */
  ranks: Array<{ key: RankBoardKey; label: string; rows: PanelBoard[] }>;
  /** 反复出现的板块（这里按 Hit 降序；跨日连续由 repeatDays 体现） */
  boards: PanelBoard[];
  /** 分档结果 */
  tiers: Record<string, PanelBoard[]>;
  warnings: string[];
};

const RANK_LABELS: Record<RankBoardKey, string> = {
  pct: '涨幅榜',
  limitUp: '涨停家数榜',
  flow: '主力净流入榜',
  amount: '成交额榜',
};

const RANK_TOP_N = 10;

/**
 * 把 block_top 的成员与涨停池 join，补上封单额 / 换手率 / 流通市值。
 * join 不上的票这些字段是 null，**按缺口处理**，不拿别的数字顶。
 */
export const joinMembers = (row: BlockTopRow, poolBySymbol: Map<string, LimitUpPoolRow>): PanelMember[] =>
  row.members.map((member) => {
    const pooled = poolBySymbol.get(member.symbol);
    const floatMarketCap = pooled?.floatMarketCap ?? null;
    const turnoverRate = pooled?.turnoverRate ?? null;
    const isCoreCandidate =
      floatMarketCap !== null &&
      floatMarketCap >= CORE_MIN_FLOAT_CAP &&
      (turnoverRate === null || turnoverRate >= CORE_MIN_TURNOVER);
    return {
      symbol: member.symbol,
      name: member.name,
      boardCount: member.boardCount ?? 1,
      highLabel: member.highLabel,
      firstSealTime: member.firstSealTime,
      price: member.price,
      pct: member.pct,
      sealAmount: pooled?.sealAmount ?? null,
      turnoverRate,
      floatMarketCap,
      isCoreCandidate,
      reasonTags: member.reasonTags,
      reasonText: member.reasonText,
    };
  });

/**
 * 中军判定（设计稿 §4.3）。
 *
 * 涨停池不给成员的当日成交额，所以「大成交」用 **大市值 + 有换手** 做代理，
 * 并在返回值里标明这是代理口径 —— 面板上必须写清楚，不能让用户以为是精确判定。
 */
export const buildPanelLadder = (members: PanelMember[]): LadderResult => {
  const asLadderMember: LadderMember[] = members.map((member) => ({
    symbol: member.symbol,
    name: member.name,
    boardCount: member.boardCount,
    highLabel: member.highLabel,
    firstSealTime: member.firstSealTime,
    sealAmount: member.sealAmount,
    // 成交额不可得：用「流通市值 × 换手率」近似当日成交额（两者都有才算）
    amount:
      member.floatMarketCap !== null && member.turnoverRate !== null
        ? (member.floatMarketCap * member.turnoverRate) / 100
        : null,
    floatMarketCap: member.floatMarketCap,
    turnoverRate: member.turnoverRate,
    pct: member.pct,
    changeTag: null,
    limitUpIn60d: null,
    isSt: /ST/.test(member.name),
    reasonTags: member.reasonTags,
  }));
  return buildLadder(asLadderMember);
};

/** 生成当日面板 */
export const buildPanel = (input: PanelInput): PanelResult => {
  const { tradeDate, rows, pool, realtime } = input;
  const poolBySymbol = new Map(pool.map((row) => [row.symbol, row]));
  const marketMaxBoard =
    pool.length === 0 ? null : Math.max(...pool.map((item) => item.boardCount ?? 1));

  const rankInputs: RankInput[] = rows.map((row) => {
    const rt = realtime.get(row.code);
    return {
      code: row.code,
      pct: rt?.pct ?? row.pct,
      limitUpCount: row.limitUpCount,
      mainNet: rt?.mainNet ?? null,
      amount: rt?.amount ?? null,
    };
  });

  const rankSnapshot = rankBoards(tradeDate, rankInputs);

  const boards: PanelBoard[] = rows.map((row) => {
    const rt = realtime.get(row.code);
    const members = joinMembers(row, poolBySymbol);
    const ladder = buildPanelLadder(members);
    const themeMembers: ThemeMemberInput[] = members.map((member) => ({
      symbol: member.symbol,
      name: member.name,
      boardCount: member.boardCount,
      highLabel: member.highLabel,
      reasonTags: member.reasonTags,
    }));
    const themes = extractThemes(themeMembers).map((theme) => ({
      key: theme.key,
      display: theme.display,
      count: theme.count,
      maxBoard: theme.maxBoard,
      members: theme.members.map((item) => item.name),
      variants: theme.variants,
    }));

    const rank: Record<RankBoardKey, number | null> = {
      pct: rankOf(rankSnapshot, row.code, 'pct'),
      limitUp: rankOf(rankSnapshot, row.code, 'limitUp'),
      flow: rankOf(rankSnapshot, row.code, 'flow'),
      amount: rankOf(rankSnapshot, row.code, 'amount'),
    };

    return {
      code: row.code,
      name: row.name,
      pct: rt?.pct ?? row.pct,
      limitUpCount: row.limitUpCount,
      continuousCount: row.continuousCount,
      highLabel: row.highLabel,
      upstreamDays: row.days,
      amount: rt?.amount ?? null,
      mainNet: rt?.mainNet ?? null,
      rank,
      hit: (Object.keys(rank) as RankBoardKey[]).filter((key) => rank[key] !== null).length,
      repeatDays: 0,
      ladder,
      themes,
      members,
      score: null,
    };
  });

  // 评分（需要 BoardDay 形状；跨日字段单日调用时按「不可判定」给 0/null）
  for (const board of boards) {
    const day: BoardDay = {
      date: tradeDate,
      code: board.code,
      name: board.name,
      pct: board.pct,
      limitUpCount: board.limitUpCount ?? 0,
      continuousCount: board.continuousCount ?? 0,
      highLabel: board.highLabel,
      maxBoard: board.ladder.maxBoard,
      upstreamDays: board.upstreamDays,
      amount: board.amount,
      mainNet: board.mainNet,
      rank: board.rank,
      hit: board.hit,
      streakHit: board.hit >= 2 ? 1 : 0,
      streakRank: { pct: 0, limitUp: 0, flow: 0, amount: 0 },
      streak: board.ladder.maxBoard >= 3 && (board.limitUpCount ?? 0) >= 2 ? 1 : 0,
      dayKind: (board.pct ?? 0) > 0 ? 'strong' : 'weak',
      capitalReturn: null,
      ladder: board.ladder,
      themes: [],
      judge: null,
    };
    board.score = scoreBoard({
      day,
      marketMaxBoard,
      catalystNote: input.catalystByCode?.get(board.code) ?? null,
    });
  }

  const sortedByHit = [...boards].sort(
    (a, b) => b.hit - a.hit || (b.limitUpCount ?? 0) - (a.limitUpCount ?? 0) || a.code.localeCompare(b.code),
  );

  const rankList = (Object.keys(RANK_LABELS) as RankBoardKey[]).map((key) => ({
    key,
    label: RANK_LABELS[key],
    rows: [...boards]
      .filter((board) => board.rank[key] !== null)
      .sort((a, b) => (a.rank[key] ?? 99) - (b.rank[key] ?? 99))
      .slice(0, RANK_TOP_N),
  }));

  const tiers: Record<string, PanelBoard[]> = {
    mainline: [],
    candidate: [],
    branch: [],
    one_day: [],
  };
  for (const board of sortedByHit) {
    const tier = board.score?.tier ?? 'one_day';
    tiers[tier].push(board);
  }

  const warnings = [
    '板块宇宙来自同花顺涨停板块 Top 20（单日只给 20 个），未进 Top 20 的板块不在本表内——这是口径限制，不是「今天没有主线」。',
    '成交额与主力净流入来自同花顺 realhead（板块级），部分板块会返回 502/504，缺失即留白。',
    '中军的「大成交」用「流通市值 × 换手率」近似（涨停池不给成员成交额），属代理口径。',
    '「连续上榜天数 / 分歧后回流」需要多日历史，单日调用时不可判定（显示为 —），由 report 的多日模式补齐。',
    '评分表不是买卖信号，用于防止被当天涨幅迷惑。',
  ];

  return { tradeDate, ranks: rankList, boards: sortedByHit, tiers, warnings };
};

const yi = (value: number | null): string =>
  value === null ? '—' : `${(value / 1e8).toFixed(1)}亿`;

const pct = (value: number | null): string =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/** 渲染成 markdown 复盘报告（面板的文本形态，可直接落到 data/ 或贴进笔记） */
export const renderPanel = (panel: PanelResult): string => {
  const lines: string[] = [];
  lines.push(`# 主线面板 · ${panel.tradeDate}`);
  lines.push('');
  lines.push('> 口径：同花顺涨停板块 Top 20（单日上限）。分数不是买卖信号，用于防止被当天涨幅迷惑。');
  lines.push('');

  // ① 四榜
  lines.push('## 一、四榜并列');
  lines.push('');
  for (const table of panel.ranks) {
    lines.push(`### ${table.label}`);
    lines.push('');
    lines.push('| 名次 | 板块 | 涨幅 | 涨停 | 主力净流入 | 成交额 | 上榜榜数 |');
    lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
    table.rows.forEach((board, index) => {
      lines.push(
        `| ${index + 1} | ${board.name} | ${pct(board.pct)} | ${board.limitUpCount ?? '—'} | ${yi(board.mainNet)} | ${yi(board.amount)} | ${board.hit}/4 |`,
      );
    });
    lines.push('');
  }

  // ② 反复出现 / 全部候选
  lines.push('## 二、板块总览（按上榜广度排序）');
  lines.push('');
  lines.push('| 板块 | 涨停 | 连板 | 最高板 | 上游持续天数 | 涨幅 | 主力净流入 | 四榜名次(涨/停/资/额) | 得分 | 分档 |');
  lines.push('| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: | --- |');
  for (const board of panel.boards) {
    lines.push(
      `| ${board.name} | ${board.limitUpCount ?? '—'} | ${board.continuousCount ?? '—'} | ${board.highLabel ?? '—'} | ${board.upstreamDays ?? '—'} | ` +
        `${pct(board.pct)} | ${yi(board.mainNet)} | ${board.rank.pct ?? '—'}/${board.rank.limitUp ?? '—'}/${board.rank.flow ?? '—'}/${board.rank.amount ?? '—'} | ` +
        `${board.score?.total ?? '—'} | ${board.score ? TIER_LABEL[board.score.tier] : '—'} |`,
    );
  }
  lines.push('');

  // ③ 梯队 + A 题材 + 评分明细：给前 6 个板块
  lines.push('## 三、重点板块明细');
  lines.push('');
  for (const board of panel.boards.slice(0, 6)) {
    lines.push(`### ${board.name}（${board.code}）`);
    lines.push('');
    const ladderParts = [
      `高度龙头 ${board.ladder.leader ? `${board.ladder.leader.name}（${board.ladder.leader.highLabel ?? `${board.ladder.leader.boardCount}板`}）` : '—'}`,
      `前排核心 ${board.ladder.frontRow.length} 只`,
      `首板助攻 ${board.ladder.firstBoard.length} 只`,
      `中军 ${board.ladder.core.length} 只`,
    ];
    lines.push(`**梯队**：${ladderParts.join(' ｜ ')}`);
    if (board.ladder.frontRow.length > 0) {
      lines.push(
        `- 前排：${board.ladder.frontRow.map((item) => `${item.name}(${item.highLabel ?? `${item.boardCount}板`})`).join('、')}`,
      );
    }
    if (board.ladder.core.length > 0) {
      lines.push(
        `- 中军（代理口径：流通市值×换手率）：${board.ladder.core
          .map((item) => `${item.name}（流通${yi(item.floatMarketCap)}，换手${item.turnoverRate?.toFixed(1) ?? '—'}%）`)
          .join('、')}`,
      );
    }
    if (board.ladder.firstBoard.length > 0) {
      lines.push(`- 首板：${board.ladder.firstBoard.map((item) => item.name).join('、')}`);
    }
    lines.push(
      `- 完整梯队：${board.ladder.full ? '是' : '否'}（模板：≥3板龙头 + 前排≥2 + 首板≥3 + 中军）`,
    );
    lines.push('');

    lines.push('**题材**（涨停原因归一后 ≥2 家成题）：');
    if (board.themes.length === 0) {
      lines.push('- （无 ≥2 家的题材——说明这个板块的涨停股各炒各的，是宽概念）');
    } else {
      for (const theme of board.themes) {
        const variants = theme.variants.length > 1 ? `（归一自：${theme.variants.join(' / ')}）` : '';
        lines.push(`- **${theme.key}** ${theme.count} 家，最高 ${theme.maxBoard} 板：${theme.members.join('、')}${variants}`);
      }
    }
    lines.push('');

    lines.push('**评分明细**：');
    lines.push('');
    lines.push('| 条件 | 命中 | 分 | 依据 |');
    lines.push('| --- | :---: | ---: | --- |');
    for (const condition of board.score?.conditions ?? []) {
      lines.push(
        `| ${condition.label} | ${condition.hit ? '✔' : '✘'} | ${condition.score} | ${condition.evidence ?? '—'} |`,
      );
    }
    lines.push('');
    lines.push(
      `**总分 ${board.score?.total ?? '—'} → ${board.score ? TIER_LABEL[board.score.tier] : '—'}**` +
        (board.score?.degraded ? '（部分字段不可用，已按缺失处理）' : '') +
        (board.score?.ebb ? ' ⚠ 退潮' : ''),
    );
    lines.push('');
  }

  // ④ 口径与限制
  lines.push('## 四、口径与限制');
  lines.push('');
  for (const warning of panel.warnings) lines.push(`- ${warning}`);
  lines.push('');
  return lines.join('\n');
};
