/**
 * §6 · 主线评分表与分档。
 *
 * 十项条件逐条来自原方法，**分值不改**：
 *   涨停家数进入前三 +2    有市场最高连板或核心龙头 +2   有大成交趋势中军 +2
 *   板块成交额进入前五 +2   连续 3 天保持活跃 +2          分歧后出现回流 +2
 *   有持续政策或产业催化 +1 出现完整涨停梯队 +2
 *   大量冲高回落或炸板 −2   龙头断板后全板块退潮 −3
 *
 * 分档：≥10 市场主线 / 7~9 主线候选或次主线 / 4~6 支线题材 / ≤3 一日游概率较高
 *
 * **原方法的声明必须跟着走**：分数不是机械买卖信号，主要用于防止被当天涨幅迷惑。
 *
 * 实现上有一条纪律：**数据缺失时该项记 0 且 evidence 说明缺失原因，不给分也不扣分**
 * （除了断链/退潮这类「有证据才扣」的项）。这样缺失不会伪造出高分或低分。
 *
 * 本文件是纯函数，不碰网络。
 */
import type { BoardDay, BoardJudge, MainlineTier, ScoreCondition, ScoreConditionKey } from './types.js';

/** 各项分值（§6） */
export const SCORE_TABLE: Record<ScoreConditionKey, { label: string; score: number }> = {
  limitUpTop3: { label: '涨停家数进入前三', score: 2 },
  marketHeightBoard: { label: '有市场最高连板或核心龙头', score: 2 },
  coreTroop: { label: '有大成交趋势中军', score: 2 },
  amountTop5: { label: '板块成交额进入前五', score: 2 },
  streak3: { label: '连续 3 天保持活跃', score: 2 },
  capitalReturn: { label: '分歧后出现回流', score: 2 },
  catalyst: { label: '有持续政策或产业催化', score: 1 },
  fullLadder: { label: '出现完整涨停梯队', score: 2 },
  breakBoard: { label: '大量冲高回落或炸板', score: -2 },
  ebb: { label: '龙头断板后全板块退潮', score: -3 },
};

/** 分档门槛（§6） */
export const TIER_THRESHOLDS = {
  mainline: 10,
  candidate: 7,
  branch: 4,
} as const;

/** 炸板率超过该值算「大量冲高回落」 */
export const BREAK_RATE_FLOOR = 0.3;
/** 连续活跃门槛 */
export const STREAK_MIN = 3;

export type ScoreInput = {
  day: BoardDay;
  /** 市场（全市场涨停池）最高连板数；不可用时 null */
  marketMaxBoard: number | null;
  /** 手工催化表命中的说明；没有则 null */
  catalystNote: string | null;
};

const condition = (
  key: ScoreConditionKey,
  hit: boolean,
  evidence: string | null,
): ScoreCondition => ({
  key,
  label: SCORE_TABLE[key].label,
  hit,
  score: hit ? SCORE_TABLE[key].score : 0,
  evidence,
});

/**
 * 计算评分表。
 *
 * 注意「未命中」与「不可判定」都记 0 分，但 evidence 必须写明区别：
 *   「涨停家数第 7 名」= 未命中；「该榜当日不可用」= 不可判定。
 */
export const scoreBoard = ({ day, marketMaxBoard, catalystNote }: ScoreInput): BoardJudge => {
  const conditions: ScoreCondition[] = [];

  // ① 涨停家数进入前三
  const limitUpRank = day.rank.limitUp;
  conditions.push(
    condition(
      'limitUpTop3',
      limitUpRank !== null && limitUpRank <= 3,
      limitUpRank === null
        ? `涨停家数榜不可用（当日家数 ${day.limitUpCount}）`
        : `涨停家数 ${day.limitUpCount}，当日第 ${limitUpRank} 名`,
    ),
  );

  // ② 有市场最高连板或核心龙头
  const isMarketHeight = marketMaxBoard !== null && day.maxBoard >= marketMaxBoard && day.maxBoard >= 3;
  const hasLeader = day.ladder !== null && day.ladder.leader !== null && day.ladder.maxBoard >= 3;
  conditions.push(
    condition(
      'marketHeightBoard',
      isMarketHeight || hasLeader,
      marketMaxBoard === null
        ? day.ladder === null
          ? '梯队数据不可用'
          : `板块最高 ${day.maxBoard} 板（市场最高连板不可用）`
        : `板块最高 ${day.maxBoard} 板 / 市场最高 ${marketMaxBoard} 板`,
    ),
  );

  // ③ 有大成交趋势中军
  /*
   * 三种情况必须分开写，不能都叫「没有中军」：
   *   中军可判定且有 → 命中
   *   中军可判定但没有 → 未命中（这是真的没有）
   *   成员成交额/流通市值缺失 → **不可判定**（不能输出「没有中军」这种结论）
   * 实测踩到：block_top 只给成员的价格与连板，不给成交额与流通市值，
   * 于是历史回填里所有板块的中军都是「不可判定」。
   */
  const coreAvailable = day.ladder?.coreAvailable ?? false;
  conditions.push(
    condition(
      'coreTroop',
      coreAvailable && (day.ladder?.core.length ?? 0) > 0,
      day.ladder === null
        ? '梯队数据不可用'
        : !coreAvailable
          ? '成员成交额 / 流通市值缺失，中军不可判定'
          : day.ladder.core.length === 0
            ? '无满足「成交额 ≥5 亿 且 流通市值 ≥100 亿」的中军'
            : `中军 ${day.ladder.core.length} 只（${day.ladder.core.map((item) => item.name).join('/')}），中军支撑度 ${day.ladder.coreSupport}`,
    ),
  );

  // ④ 板块成交额进入前五
  const amountRank = day.rank.amount;
  conditions.push(
    condition(
      'amountTop5',
      amountRank !== null && amountRank <= 5,
      amountRank === null
        ? '成交额榜不可用'
        : `成交额 ${((day.amount ?? 0) / 1e8).toFixed(1)} 亿，当日第 ${amountRank} 名`,
    ),
  );

  // ⑤ 连续 3 天保持活跃
  conditions.push(
    condition(
      'streak3',
      day.streak >= STREAK_MIN,
      `连续计数 ${day.streak}（强势日 +1，分歧日不变，弱势日归零）`,
    ),
  );

  // ⑥ 分歧后出现回流（§5.2）
  const ret = day.capitalReturn;
  conditions.push(
    condition(
      'capitalReturn',
      ret === 1,
      ret === null
        ? '近 3 日未出现分歧日'
        : ret === 1
          ? '分歧后已确认回流'
          : ret === 0
            ? '出现过分歧日但窗口内未确认回流'
            : '分歧后退潮',
    ),
  );

  // ⑦ 有持续政策或产业催化（唯一的人工项）
  conditions.push(
    condition('catalyst', catalystNote !== null, catalystNote ?? '未录入催化（人工项）'),
  );

  // ⑧ 出现完整涨停梯队
  conditions.push(
    condition(
      'fullLadder',
      day.ladder !== null && day.ladder.full,
      day.ladder === null
        ? '梯队数据不可用'
        : day.ladder.full
          ? `完整梯队：${day.ladder.maxBoard} 板龙头 + 前排 ${day.ladder.frontRow.length} + 首板 ${day.ladder.firstBoard.length} + 中军 ${day.ladder.core.length}`
          : `梯队不完整：${day.ladder.maxBoard} 板龙头 + 前排 ${day.ladder.frontRow.length} + 首板 ${day.ladder.firstBoard.length} + 中军 ${day.ladder.core.length}`,
    ),
  );

  // ⑨ 大量冲高回落或炸板（有证据才扣）
  const breakRate = day.ladder?.breakRate ?? null;
  conditions.push(
    condition(
      'breakBoard',
      breakRate !== null && breakRate >= BREAK_RATE_FLOOR,
      breakRate === null
        ? '封板类型数据不可用，炸板率无法判定'
        : `炸板率 ${(breakRate * 100).toFixed(0)}%`,
    ),
  );

  // ⑩ 龙头断板后全板块退潮
  const ebb =
    ret === -1 ||
    (day.maxBoard > 0 &&
      day.maxBoard < 3 &&
      day.limitUpCount <= 2 &&
      day.streak === 0 &&
      day.dayKind === 'weak');
  conditions.push(
    condition(
      'ebb',
      ebb,
      ret === -1
        ? '最近一次分歧已判退潮'
        : ebb
          ? `最高板回落到 ${day.maxBoard} 板、涨停家数 ${day.limitUpCount}、连续计数归零`
          : '未见龙头断板后全板块退潮',
    ),
  );

  const total = conditions.reduce((sum, item) => sum + item.score, 0);
  const degraded =
    limitUpRank === null ||
    amountRank === null ||
    day.ladder === null ||
    marketMaxBoard === null ||
    day.mainNet === null;

  return {
    tier: toTier(total, ebb),
    total,
    conditions,
    ebb,
    degraded,
  };
};

/** 分档（§6）：退潮一律不进主线 */
export const toTier = (total: number, ebb: boolean): MainlineTier => {
  if (ebb) return total >= TIER_THRESHOLDS.branch ? 'branch' : 'one_day';
  if (total >= TIER_THRESHOLDS.mainline) return 'mainline';
  if (total >= TIER_THRESHOLDS.candidate) return 'candidate';
  if (total >= TIER_THRESHOLDS.branch) return 'branch';
  return 'one_day';
};

/** 面板直接显示的分档名 */
export const TIER_LABEL: Record<MainlineTier, string> = {
  mainline: '市场主线',
  candidate: '主线候选 / 次主线',
  branch: '支线题材',
  one_day: '一日游概率较高',
};
