/**
 * 角色资格与代表分配（纯函数）。
 *
 * 设计要点（见实施说明 §5）：
 *   1. **资格与排序分离**：必要资格（eligible）不满足的候选，排序值再高也不发标签；
 *   2. **比较用「越大越优」的一维数组**，缺失项是 null 而不是 0，不引入未经解释的百分制权重；
 *   3. 第一项排序值缺失的候选不参与代表分配；后续项缺失排在任意已知值之后，两个缺失继续比下一项；
 *   4. 全部关键排序值相同（并列）且跨越选取上限时，这一组都不发标签并给出 warning；
 *   5. v1 只产出 `candidate`（候选）标签，「confirmed」留给未来有明确确认规则的版本。
 */
import type { CheckResult, RoleTag, ThemeStockRole } from '../../src/types.js';

export type RoleAssessment = {
  symbol: string;
  role: ThemeStockRole;
  eligible: boolean;
  checks: CheckResult[];
  /** 已全部转换为「越大越优」；不可计算为 null（不得填 0） */
  rank: Array<number | null>;
};

/** v1 每个题材各角色最多几名代表；laggard 允许 2 名 */
export const ROLE_LIMITS: Record<ThemeStockRole, number> = {
  leader: 1,
  turnover: 1,
  trend: 1,
  laggard: 2,
};

/** 规则版本：缓存键、页面展示、后续回测都要带上它 */
export const ROLE_RULE_VERSION = 'roles-v1-2026-09-18';

const ROLE_DISPLAY: Record<ThemeStockRole, string> = {
  leader: '龙头',
  turnover: '核心',
  trend: '趋势中军',
  laggard: '潜在低位补涨',
};

/** v1 只给候选标签：没有分钟级带动证据时不能输出「确认龙头」 */
export const CANDIDATE_LABELS: Record<ThemeStockRole, string> = {
  leader: '龙头候选',
  turnover: '核心候选',
  trend: '趋势中军候选',
  laggard: '潜在低位补涨',
};

export const ROLE_TAG_STATUS = 'candidate' as const;

const isMissing = (value: number | null | undefined): boolean =>
  value === null || value === undefined || !Number.isFinite(value);

/**
 * 比较两个排序向量（越大越优）。返回负数表示 a 更优。
 * 规则：缺失（null）排在任意已知值之后；两个都缺失则继续比较下一项。
 */
export const compareRank = (
  a: Array<number | null>,
  b: Array<number | null>,
): number => {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? null;
    const right = b[index] ?? null;
    if (isMissing(left) && isMissing(right)) continue;
    if (isMissing(left)) return 1;
    if (isMissing(right)) return -1;
    if ((left as number) !== (right as number)) return (right as number) - (left as number);
  }
  return 0;
};

/** 排序向量是否完全并列（用于「并列待确认」判定） */
export const isTied = (a: Array<number | null>, b: Array<number | null>): boolean =>
  compareRank(a, b) === 0;

const missingChecksOf = (checks: CheckResult[]): string[] =>
  checks
    .filter((check) => check.state === 'missing' || check.state === 'pending')
    .map((check) => `${check.key}：${check.reason}`);

const failedChecksOf = (checks: CheckResult[]): string[] =>
  checks.filter((check) => check.state === 'fail').map((check) => `${check.key}：${check.reason}`);

const passedReasonsOf = (checks: CheckResult[]): string[] =>
  checks
    .filter((check) => check.state === 'pass')
    .map((check) => `${check.key}：${check.reason}`);

/**
 * 分配角色标签。返回 `tags` 只包含**实际获得标签**的股票（symbol → RoleTag[]），
 * 同一股票多个角色合并到同一个数组。
 */
export const assignRoleTags = (
  assessments: RoleAssessment[],
  assignedAt: string,
  limits: Record<ThemeStockRole, number> = ROLE_LIMITS,
): { tags: Record<string, RoleTag[]>; warnings: string[] } => {
  const tags: Record<string, RoleTag[]> = {};
  const warnings: string[] = [];

  const roles = Object.keys(limits) as ThemeStockRole[];

  for (const role of roles) {
    const pool = assessments.filter((item) => item.role === role);
    if (pool.length === 0) continue;

    // 先过滤资格：未通过必要资格的候选即使排序值更高也不参与代表分配
    const eligible = pool.filter((item) => item.eligible);
    if (eligible.length === 0) {
      warnings.push(`${ROLE_DISPLAY[role]}：本轮没有满足必要资格的候选，标签留空`);
      continue;
    }

    // 第一关键排序项缺失的不参与代表分配（不能靠后续项补）
    const comparable = eligible.filter((item) => !isMissing(item.rank[0]));
    const dropped = eligible.filter((item) => isMissing(item.rank[0]));
    for (const item of dropped) {
      warnings.push(
        `${item.symbol} ${ROLE_DISPLAY[role]}：第一关键排序项缺失，不参与代表比较`,
      );
    }
    if (comparable.length === 0) {
      warnings.push(`${ROLE_DISPLAY[role]}：关键排序项全部缺失，标签留空`);
      continue;
    }

    const sorted = [...comparable].sort((a, b) => compareRank(a.rank, b.rank));
    const limit = limits[role];
    const selected = sorted.slice(0, limit);
    const rest = sorted.slice(limit);

    // 并列处理：与最后一名入选者完全同分、且被上限截断的候选不强行取舍。
    // 注意：并列双方都在名额内时照常发标签，只有「并列跨越上限」才留空。
    const boundary = selected[selected.length - 1];
    const tiedOutside = rest.filter((item) => isTied(item.rank, boundary.rank));

    if (tiedOutside.length > 0) {
      warnings.push(
        `${[boundary, ...tiedOutside].map((item) => item.symbol).join('、')} ` +
          `在「${ROLE_DISPLAY[role]}」关键排序值完全并列且跨越选取上限（${limit} 名），` +
          '本角色不发标签（并列待确认）',
      );
      continue;
    }

    selected.forEach((item, index) => {
      const missingEvidence = missingChecksOf(item.checks);
      const failures = failedChecksOf(item.checks);
      const tag: RoleTag = {
        role,
        status: ROLE_TAG_STATUS,
        reasons: [
          `题材内${ROLE_DISPLAY[role]}候选比较排名第 ${index + 1}`,
          ...passedReasonsOf(item.checks),
        ],
        missingEvidence: [...missingEvidence, ...failures],
        assignedAt,
        ruleVersion: ROLE_RULE_VERSION,
      };
      const list = tags[item.symbol] ?? [];
      list.push(tag);
      tags[item.symbol] = list;
    });
  }

  return { tags, warnings };
};

/** 页面显示用：标签文案（v1 全部是候选） */
export const roleTagLabel = (tag: RoleTag): string => CANDIDATE_LABELS[tag.role];
