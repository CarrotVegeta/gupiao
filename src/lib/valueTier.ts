/**
 * 字段值的分档展示：涨跌幅/收益按档变色（极端档加底），换手与量比各带一个档位词。
 *
 * 这里只算「档位」，不碰 DOM、类名和样式；类名由组件拼、颜色在 styles.css 的 .value-tier 里。
 *
 * 口径：
 *   涨跌幅/收益  涨停 ≥9.9%、大涨 ≥5%、小涨 >0、小跌 >−5%、大跌 >−9.9%、跌停 ≤−9.9%
 *   换手        冷清 <1%、正常 1~5%、活跃 5~15%、过热 >15%
 *   量比        缩量 <0.8、平量 0.8~1.5、温和放量 1.5~2.5、大幅放量 >2.5
 *
 * 恰好 0 不参与分档（返回 null）：界面原本就是中性色，不为「+0.00%」多造一处改动。
 */

export type ValueTier = 'limit' | 'bigUp' | 'up' | 'bigDown' | 'down' | 'limitDown';

/** 档位词的颜色档：dim 最弱，rise/fall 跟涨跌同色，amber 用于「活跃/放量」这类需要提醒的 */
export type ValueWordTone = 'dim' | 'ink' | 'amber' | 'rise' | 'fall';

export type ValueWord = {
  word: string;
  tone: ValueWordTone;
};

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 涨跌幅分档；缺值或恰好 0 时返回 null（不加档位样式） */
export const tierOfChange = (pct: number | null | undefined): ValueTier | null => {
  if (!isFiniteNumber(pct) || pct === 0) {
    return null;
  }

  if (pct >= 9.9) {
    return 'limit';
  }

  if (pct >= 5) {
    return 'bigUp';
  }

  if (pct > 0) {
    return 'up';
  }

  if (pct > -5) {
    return 'down';
  }

  if (pct > -9.9) {
    return 'bigDown';
  }

  return 'limitDown';
};

/** 换手率档位词：冷清 / 正常 / 活跃 / 过热 */
export const turnoverLevel = (turnover: number | null | undefined): ValueWord | null => {
  if (!isFiniteNumber(turnover)) {
    return null;
  }

  if (turnover < 1) {
    return { word: '冷清', tone: 'dim' };
  }

  if (turnover < 5) {
    return { word: '正常', tone: 'ink' };
  }

  if (turnover < 15) {
    return { word: '活跃', tone: 'amber' };
  }

  return { word: '过热', tone: 'rise' };
};

/** 量比档位词：缩量 / 平量 / 温和放量 / 大幅放量 */
export const volumeRatioLevel = (volumeRatio: number | null | undefined): ValueWord | null => {
  if (!isFiniteNumber(volumeRatio)) {
    return null;
  }

  if (volumeRatio < 0.8) {
    return { word: '缩量', tone: 'fall' };
  }

  if (volumeRatio <= 1.5) {
    return { word: '平量', tone: 'ink' };
  }

  if (volumeRatio <= 2.5) {
    return { word: '温和放量', tone: 'amber' };
  }

  return { word: '大幅放量', tone: 'rise' };
};

/**
 * 档位对应的类名；没有档位时返回空串，方便直接塞进模板字符串。
 *
 * `pad` 只在「值本身就是纯文字」的地方用（自选页的 .watch-pct、持仓收益里的文字）：
 * 那一层没有内边距，加底会糊住数字；持仓页涨跌幅的 .quote-row__chg 自带 padding，不用再垫。
 * 只有带底色的档（涨停/跌停/大涨/大跌）才真的需要垫——纯变色的档垫了也看不出，
 * 多出来的 padding 配对负 margin 虽然不影响布局，但没必要写进去。
 */
const SURFACE_TIERS: readonly ValueTier[] = ['limit', 'bigUp', 'bigDown', 'limitDown'];

export const tierClassNames = (
  tier: ValueTier | null,
  { pad = false }: { pad?: boolean } = {},
): string => {
  if (tier === null) {
    return '';
  }

  const surface = pad && SURFACE_TIERS.includes(tier) ? ' value-tier--pad' : '';

  return `value-tier value-tier--${tier}${surface}`;
};

/** 档位词的类名；没有档位词时返回空串 */
export const wordClassNames = (level: ValueWord | null): string =>
  level === null ? '' : `value-word value-word--${level.tone}`;
