/**
 * L3 · 阵容层：五档梯队与中军（设计稿 §4）。
 *
 * 原方法的五档（§4.1）：
 *   高度龙头  3 板、4 板以上，打开市场空间
 *   前排核心  2 板或强势反包，提供板块强度
 *   中军      大市值、大成交额，稳定板块容量
 *   首板助攻  涨停数量持续增加，说明资金扩散
 *   低位补涨  主线内部不断挖掘新分支
 *
 * 完整梯队模板（§4.2）：`5 板龙头 ＋ 2 只 2 板 ＋ 6 只首板 ＋ 大成交中军`
 *
 * **缺失一律按缺失处理**：算不出来的项返回 null 或 0 并置 available=false，
 * 不允许因为「数据没有」就输出「没有中军」这种结论。
 *
 * 本文件是纯函数，不碰网络。
 */
import type { LadderMember, LadderShape } from './types.js';

/** 中军门槛（§4.3）：没有「流通市值 ≥ 100 亿」这条会退化成「今天成交额最大的票」 */
export const CORE_MIN_AMOUNT = 5e8;
export const CORE_MIN_FLOAT_CAP = 1e10;
/** 中军数量上限：3 只算满配 */
export const CORE_FULL_COUNT = 3;
/** 完整梯队的最低要求（原方法模板的保守版） */
export const FULL_LADDER_MIN_FIRST = 3;
export const FULL_LADDER_MIN_FRONT = 2;
/** 低位补涨的「低位」定义：近 60 日涨停次数 ≤ 该值 */
export const LAGGARD_MAX_LIMIT_UP_60D = 1;

/**
 * 上游封板类型标记（同花顺 `change_tag`）。
 * 实测出现 `FIRST_LIMIT`（首封）、`LIMIT_BACK`（回封）。
 * **保守**：只有明确属于开板类的才计入炸板，不猜。
 */
const BREAK_TAGS = ['OPEN_LIMIT', 'OPEN_LIMIT_BACK', 'BREAK'];

export const isBreakTag = (changeTag: string | null): boolean =>
  changeTag !== null && BREAK_TAGS.some((token) => changeTag.toUpperCase().includes(token));

/** `LadderShape` 已经带上三个可判定标记，这里只是语义别名，方便调用方阅读 */
export type LadderResult = LadderShape;

const byStrength = (a: LadderMember, b: LadderMember): number =>
  b.boardCount - a.boardCount ||
  (a.firstSealTime ?? '99:99:99').localeCompare(b.firstSealTime ?? '99:99:99') ||
  (b.sealAmount ?? 0) - (a.sealAmount ?? 0) ||
  a.symbol.localeCompare(b.symbol);

export const buildLadder = (members: LadderMember[]): LadderResult => {
  if (members.length === 0) {
    return {
      maxBoard: 0,
      leader: null,
      frontRow: [],
      firstBoard: [],
      laggard: [],
      core: [],
      coreSupport: 0,
      breakRate: null,
      full: false,
      coreAvailable: false,
      laggardAvailable: false,
      breakRateAvailable: false,
    };
  }

  const sorted = [...members].sort(byStrength);

  const maxBoard = Math.max(...sorted.map((member) => member.boardCount));
  const leaders = sorted.filter((member) => member.boardCount === maxBoard);
  // 龙头取最强的那一只；高度相同的其它票归入前排核心
  const leader = leaders[0] ?? null;
  const frontRow = sorted.filter(
    (member) => member.boardCount >= 2 && member !== leader,
  );

  // --- 中军（§4.3）---
  /*
   * 中军按「每只票自己有没有这两项数据」判定，不是要求全部成员都有数据。
   * 关键：`coreAvailable` 的语义是「中军这一项能不能判定」——
   * 只要**至少一只票**有成交额与流通市值，就能判定（判不出来的那只票不参与，
   * 并在梯队里按「未参与判定」披露）。全部成员都没有这两项时才叫不可判定。
   */
  const judgedCore = members.filter(
    (item) => item.amount !== null && item.floatMarketCap !== null,
  );
  const coreAvailable = judgedCore.length > 0;
  const core = coreAvailable
    ? judgedCore.filter(
        (item) =>
          (item.amount ?? 0) >= CORE_MIN_AMOUNT &&
          (item.floatMarketCap ?? 0) >= CORE_MIN_FLOAT_CAP &&
          (item.pct === null || item.pct > 0),
      )
    : [];

  const amountOf = (item: LadderMember): number => item.amount ?? 0;
  const totalAmount = judgedCore.reduce((sum, item) => sum + amountOf(item), 0);
  const coreAmount = core.reduce((sum, item) => sum + amountOf(item), 0);
  const corePositiveRatio =
    core.length === 0
      ? 0
      : core.filter((item) => (item.pct ?? 0) > 0 || item.boardCount > 0).length / core.length;

  /*
   * coreSupport 四项相乘（§4.3）：
   *   数量（3 只为满配）× 容量占比（中军得真占住板块成交额）× 中军上涨比例
   * 只有可判定时才给分，否则 0 并让上层按 degraded 处理。
   */
  const coreSupport = coreAvailable
    ? Math.min(1, core.length / CORE_FULL_COUNT) *
      (totalAmount > 0 ? coreAmount / totalAmount : 0) *
      corePositiveRatio
    : 0;

  /*
   * 首板助攻（§4.1）：原方法模板里「首板」与「大成交中军」是并列的两档，
   * 所以首板**排除中军成员**——否则中军会被重复计进首板，把梯队形态算虚。
   */
  const coreSymbols = new Set(core.map((item) => item.symbol));
  const firstBoard = sorted.filter(
    (item) => item.boardCount === 1 && !coreSymbols.has(item.symbol),
  );

  // --- 低位补涨（§4.1）---
  const laggardAvailable = firstBoard.some((item) => item.limitUpIn60d !== null);
  const laggard = laggardAvailable
    ? firstBoard.filter(
        (item) => item.limitUpIn60d !== null && item.limitUpIn60d <= LAGGARD_MAX_LIMIT_UP_60D,
      )
    : [];

  // --- 炸板率 ---
  const breakRateAvailable = sorted.some((item) => item.changeTag !== null);
  const breakMembers = sorted.filter((item) => isBreakTag(item.changeTag));
  const breakRate = breakRateAvailable
    ? breakMembers.length / (sorted.length + breakMembers.length)
    : null;

  /*
   * 完整梯队（§4.2 模板）：
   *   高度龙头 ≥3 板  ＋  前排 2 板以上 ≥2 只  ＋  首板 ≥3 只  ＋  有中军
   * 中军不可判定时不要求中军（否则历史回填里所有板块都会被判成不完整）。
   */
  const full =
    maxBoard >= 3 &&
    frontRow.length >= FULL_LADDER_MIN_FRONT &&
    firstBoard.length >= FULL_LADDER_MIN_FIRST &&
    (!coreAvailable || core.length >= 1);

  return {
    maxBoard,
    leader,
    frontRow,
    firstBoard,
    laggard,
    core,
    coreSupport: Number(coreSupport.toFixed(4)),
    breakRate: breakRate === null ? null : Number(breakRate.toFixed(4)),
    full,
    coreAvailable,
    laggardAvailable,
    breakRateAvailable,
  };
};

/** 梯队形态的可读描述，面板直接显示 */
export const describeLadder = (ladder: LadderShape): string =>
  [
    `${ladder.maxBoard}板龙头×1`,
    `前排 ${ladder.frontRow.length}`,
    `首板 ${ladder.firstBoard.length}`,
    `补涨 ${ladder.laggard.length}`,
    `中军 ${ladder.core.length}`,
  ].join(' ＋ ');
