/**
 * 角色资格与排序输入（纯函数）。
 *
 * 2026-09-18 重构：**取消「命中 N 项就入选」的做法**。
 * 这里只做两件事：
 *   1. 用 `ROLE_RULES_V1` 里的必要资格逐项判定（pass / fail / pending / missing）；
 *   2. 把排序项统一转换成「越大越优」的一维数组（缺失为 null，不得填 0）。
 * 代表分配与并列处理在 `assignRoles.ts`。
 *
 * 公共前置条件（v1 保守产品规则）：
 *   本轮 relation = supported、指标可计算、非 ST、风险成功查询且无风险命中。
 *   风险未知保留观察信息但不发确定标签；仅概念归属的股票可以留在表里，但拿不到角色。
 */
import type { CheckResult, ThemeRelation, ThemeStockRole } from '../../src/types.js';
import type { BoardMember } from './eastmoney.js';
import type { StockKlineMetrics } from './metrics.js';
import type { LimitUpPoolRow } from './tenjqka.js';

/** 与 assignRoles 的规则版本保持同一份来源 */
export const ASSIGN_ROLE_VERSION = 'roles-v1-2026-09-18';

export type RoleCandidate = {
  symbol: string;
  name: string;
  relation: ThemeRelation;
  metricsState: 'ready' | 'missing' | 'failed';
  metrics: StockKlineMetrics | null;
  metricsTradeDate: string | null;
  /** 板块近 20 日涨幅（%） */
  sectorPct20: number | null;
  /** 本轮细分逻辑键（用于「与龙头同源逻辑」的比较） */
  topicKeys: string[];
  isSt: boolean;
  /** 风险是否成功查询过 */
  risksChecked: boolean;
  risks: string[];
  member: BoardMember;
  /** 当日涨停池行；未涨停时为 null（不等于自动排除） */
  poolRow: LimitUpPoolRow | null;
};

/**
 * v1 建议默认值，集中在这里便于追溯与后续调整。
 * 这些阈值是「避免执行时自由发挥」的建议值，不是已验证的盈利参数。
 */
export const ROLE_RULES_V1 = {
  leader: {
    label: '龙头候选',
    /** 近 20 交易日至少一次涨停记录 */
    minLimitUpIn20d: 1,
  },
  turnover: {
    label: '核心候选',
    /** 近 3 日均额下限（元） */
    minAvgAmount3d: 5e8,
    /** 当日换手率区间（%） */
    turnoverRateMin: 8,
    turnoverRateMax: 25,
  },
  trend: {
    label: '趋势中军候选',
    /** 近 5 日均额下限（元） */
    minAvgAmount5d: 5e8,
    /** 近 10 日站上 MA5 的最少天数 */
    minStableDays10: 7,
    /** 距 MA5 的允许区间（%） */
    ma5DistMin: -5,
    ma5DistMax: 5,
    /** 近 10 日涨幅区间（%） */
    pct10Min: 5,
    pct10Max: 25,
  },
  laggard: {
    label: '潜在低位补涨',
    /** 板块 20 日涨幅减个股的差额下限（百分点） */
    minPctGap: 15,
    /** 流通市值区间（元） */
    capMin: 50e8,
    capMax: 300e8,
    /** 本轮启动要晚于龙头 2~4 个交易日 */
    delayMin: 2,
    delayMax: 4,
  },
} as const;

const fmtAmount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value / 1e8).toFixed(2)} 亿`;

const fmtPct = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const check = (
  key: string,
  state: CheckResult['state'],
  value: CheckResult['value'],
  reason: string,
): CheckResult => ({ key, state, value, reason, evidenceIds: [] });

/** 公共前置：本轮关联必须 supported，否则不参加确定角色分配 */
const relationCheck = (candidate: RoleCandidate): CheckResult => {
  const label: Record<ThemeRelation['state'], string> = {
    supported: '驱动有依据',
    possible: '可能相关',
    membership_only: '仅概念归属',
    other_driver: '存在其他驱动',
    unknown: '关联未知',
  };
  return check(
    '本轮关联',
    candidate.relation.state === 'supported' ? 'pass' : 'fail',
    candidate.relation.state,
    `${label[candidate.relation.state]}${candidate.relation.reasons[0] === undefined ? '' : `：${candidate.relation.reasons[0]}`}`,
  );
};

const metricsCheck = (candidate: RoleCandidate): CheckResult => {
  if (candidate.metricsState === 'ready' && candidate.metrics !== null) {
    return check('指标可计算', 'pass', candidate.metricsTradeDate, `截止 ${candidate.metricsTradeDate ?? '—'}`);
  }
  return check(
    '指标可计算',
    candidate.metricsState === 'failed' ? 'missing' : 'missing',
    null,
    candidate.metricsState === 'failed' ? '日K取数失败，不能评估' : '日K不足或缺失，不能评估',
  );
};

const stCheck = (candidate: RoleCandidate): CheckResult =>
  check('非 ST', candidate.isSt ? 'fail' : 'pass', !candidate.isSt, candidate.isSt ? 'ST 标的不给角色' : '非 ST');

const riskCheck = (candidate: RoleCandidate): CheckResult => {
  if (!candidate.risksChecked) {
    return check('风险核验', 'missing', null, '风险数据未取到（不能说「未见风险」）');
  }
  if (candidate.risks.length > 0) {
    return check('风险核验', 'fail', candidate.risks.length, `风险命中：${candidate.risks.join('；')}`);
  }
  return check('风险核验', 'pass', 0, '已核验，未见减持 / 业绩 / ST 风险');
};

const commonChecks = (candidate: RoleCandidate): CheckResult[] => [
  relationCheck(candidate),
  metricsCheck(candidate),
  stCheck(candidate),
  riskCheck(candidate),
];

const num = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

const rankValue = (value: number | null): number | null => num(value);

/** 龙头：近 20 日涨停记录 + 本轮可确认的连续板高度 */
const leaderChecks = (candidate: RoleCandidate): CheckResult[] => {
  const metrics = candidate.metrics;
  const rules = ROLE_RULES_V1.leader;
  const limitUpIn20d = metrics?.limitUpIn20d ?? null;
  return [
    ...commonChecks(candidate),
    check(
      '近20日涨停记录',
      limitUpIn20d === null
        ? 'missing'
        : limitUpIn20d >= rules.minLimitUpIn20d
          ? 'pass'
          : 'fail',
      limitUpIn20d,
      limitUpIn20d === null
        ? '缺日K，无法确认近 20 日涨停记录'
        : `近 20 日涨停 ${limitUpIn20d} 次（要求 ≥${rules.minLimitUpIn20d}）`,
    ),
    check(
      '连续板高度',
      metrics?.consecutiveLimitUpDays === null || metrics?.consecutiveLimitUpDays === undefined
        ? 'missing'
        : 'pass',
      metrics?.consecutiveLimitUpDays ?? null,
      metrics?.consecutiveLimitUpDays === null || metrics?.consecutiveLimitUpDays === undefined
        ? '逐日收盘不足以重算连续板高度'
        : `按逐日收盘重算连续 ${metrics.consecutiveLimitUpDays} 板（不使用上游「几天几板」）`,
    ),
    check(
      '分时带动证据',
      'pending',
      null,
      '缺少分钟级带动证据，v1 只能给「龙头候选」，不能输出确认龙头',
    ),
  ];
};

const leaderRank = (candidate: RoleCandidate): Array<number | null> => [
  rankValue(candidate.metrics?.consecutiveLimitUpDays ?? null),
  rankValue(candidate.metrics?.relativePct5 ?? null),
  rankValue(candidate.metrics?.avgAmount5d ?? null),
];

/** 核心（换手核心）：近3日均额 + 换手率区间 + 不是连续两日一字板 */
const turnoverChecks = (candidate: RoleCandidate): CheckResult[] => {
  const rules = ROLE_RULES_V1.turnover;
  const avg3 = candidate.metrics?.avgAmount3d ?? null;
  const rate = candidate.member.turnoverRate ?? candidate.poolRow?.turnoverRate ?? null;
  const twoSeal = longestLimitUpStreak(candidate);
  return [
    ...commonChecks(candidate),
    check(
      '近3日均额',
      avg3 === null ? 'missing' : avg3 >= rules.minAvgAmount3d ? 'pass' : 'fail',
      avg3,
      `近 3 日均额 ${fmtAmount(avg3)}（要求 ≥${fmtAmount(rules.minAvgAmount3d)}）`,
    ),
    check(
      '当日换手率',
      rate === null
        ? 'missing'
        : rate >= rules.turnoverRateMin && rate <= rules.turnoverRateMax
          ? 'pass'
          : 'fail',
      rate,
      `当日换手率 ${rate === null ? '—' : `${rate.toFixed(1)}%`}（要求 ${rules.turnoverRateMin}%~${rules.turnoverRateMax}%）`,
    ),
    check(
      '非连续两日一字涨停',
      twoSeal === null
        ? 'missing'
        : twoSeal >= 2
          ? 'fail'
          : 'pass',
      twoSeal,
      twoSeal === null
        ? '缺日K，无法核对连续一字涨停'
        : twoSeal >= 2
          ? '连续两日一字涨停，实际难以买入'
          : '当日不是连续一字涨停',
    ),
  ];
};

const turnoverRank = (candidate: RoleCandidate): Array<number | null> => [
  rankValue(candidate.metrics?.avgAmount3d ?? null),
  rankValue(candidate.metrics?.sectorAdjustedRelative ?? null),
];

/**
 * 连续一字涨停天数：按逐日 OHLC 四价相等且达到涨停价判定（metrics 里算好）。
 * 缺任一日价格 / 涨停口径返回 null → 该 check 为 pending，不拿当天 sealType 替代历史检查。
 */
export const longestLimitUpStreak = (candidate: RoleCandidate): number | null =>
  candidate.metrics?.onePriceSealDays ?? null;

/** 趋势中军：主板 + 量能 + 趋势结构 + 位置 */
const trendChecks = (candidate: RoleCandidate): CheckResult[] => {
  const rules = ROLE_RULES_V1.trend;
  const metrics = candidate.metrics;
  const isMainBoard =
    candidate.symbol.startsWith('60') || candidate.symbol.startsWith('00');
  return [
    ...commonChecks(candidate),
    check('沪深主板', isMainBoard ? 'pass' : 'fail', isMainBoard, isMainBoard ? '沪深主板' : '非沪深主板'),
    check(
      '近5日均额',
      metrics?.avgAmount5d === null || metrics?.avgAmount5d === undefined
        ? 'missing'
        : metrics.avgAmount5d >= rules.minAvgAmount5d
          ? 'pass'
          : 'fail',
      metrics?.avgAmount5d ?? null,
      `近 5 日均额 ${fmtAmount(metrics?.avgAmount5d ?? null)}（要求 ≥${fmtAmount(rules.minAvgAmount5d)}）`,
    ),
    check(
      '近10日站上MA5天数',
      metrics?.stableDays10 === null || metrics?.stableDays10 === undefined
        ? 'missing'
        : metrics.stableDays10 >= rules.minStableDays10
          ? 'pass'
          : 'fail',
      metrics?.stableDays10 ?? null,
      `近 10 日站上 MA5 ${metrics?.stableDays10 ?? '—'} 天（要求 ≥${rules.minStableDays10}）`,
    ),
    check(
      '距MA5区间',
      metrics?.distMa5 === null || metrics?.distMa5 === undefined
        ? 'missing'
        : metrics.distMa5 >= rules.ma5DistMin && metrics.distMa5 <= rules.ma5DistMax
          ? 'pass'
          : 'fail',
      metrics?.distMa5 ?? null,
      `距 MA5 ${fmtPct(metrics?.distMa5 ?? null)}（要求 ${rules.ma5DistMin}%~+${rules.ma5DistMax}%）`,
    ),
    check(
      '近10日涨幅区间',
      metrics?.pct10 === null || metrics?.pct10 === undefined
        ? 'missing'
        : metrics.pct10 >= rules.pct10Min && metrics.pct10 <= rules.pct10Max
          ? 'pass'
          : 'fail',
      metrics?.pct10 ?? null,
      `近 10 日涨幅 ${fmtPct(metrics?.pct10 ?? null)}（要求 ${rules.pct10Min}%~${rules.pct10Max}%）`,
    ),
    check(
      '收盘不低于MA10',
      metrics?.distMa10 === null || metrics?.distMa10 === undefined
        ? 'missing'
        : metrics.distMa10 >= 0
          ? 'pass'
          : 'fail',
      metrics?.distMa10 ?? null,
      `距 MA10 ${fmtPct(metrics?.distMa10 ?? null)}（要求 ≥0）`,
    ),
  ];
};

const trendRank = (candidate: RoleCandidate): Array<number | null> => [
  rankValue(candidate.metrics?.avgAmount5d ?? null),
  rankValue(candidate.metrics?.stableDays10 ?? null),
  candidate.metrics?.distMa5 === null || candidate.metrics?.distMa5 === undefined
    ? null
    : -Math.abs(candidate.metrics.distMa5),
];

/** 低位补涨：同源细分逻辑 + 相对低位 + 首次放量突破 + 启动晚于龙头 */
const laggardChecks = (candidate: RoleCandidate): CheckResult[] => {
  const rules = ROLE_RULES_V1.laggard;
  const metrics = candidate.metrics;
  const cap = candidate.member.floatMarketCap ?? candidate.poolRow?.floatMarketCap ?? null;
  const sectorPct = num(candidate.sectorPct20);
  const ownPct = num(metrics?.pct20 ?? null);
  const gap = sectorPct !== null && ownPct !== null ? sectorPct - ownPct : null;
  const delay = num(metrics?.tradingDaysSince ?? null);
  const sharedTopic = candidate.topicKeys.length > 0;
  return [
    ...commonChecks(candidate),
    check(
      '同源细分逻辑',
      sharedTopic ? 'pass' : 'pending',
      sharedTopic ? candidate.topicKeys.join('、') : null,
      sharedTopic
        ? `与龙头同源细分逻辑：${candidate.topicKeys.join('、')}`
        : '没有可确认的同源细分逻辑（一期细分映射未配置，只有宽泛概念不足以判补涨）',
    ),
    check(
      '板块20日相对涨幅差',
      gap === null ? 'missing' : gap >= rules.minPctGap ? 'pass' : 'fail',
      gap,
      gap === null
        ? '板块 / 个股 20 日涨幅无法比较（缺板块日K）'
        : `板块减个股 ${gap.toFixed(1)} 个百分点（要求 ≥${rules.minPctGap}）`,
    ),
    check(
      '流通市值区间',
      cap === null ? 'missing' : cap >= rules.capMin && cap <= rules.capMax ? 'pass' : 'fail',
      cap,
      `流通市值 ${fmtAmount(cap)}（要求 ${fmtAmount(rules.capMin)}~${fmtAmount(rules.capMax)}）`,
    ),
    check(
      '近3交易日首次放量突破',
      metrics?.ownBreakoutDate === null || metrics?.ownBreakoutDate === undefined
        ? 'missing'
        : metrics.breakoutIsFirst === true && (metrics.tradingDaysSince ?? 99) <= 3
          ? 'pass'
          : 'fail',
      metrics?.ownBreakoutDate ?? null,
      metrics?.ownBreakoutDate === null || metrics?.ownBreakoutDate === undefined
        ? '近期没有放量突破 20/60 日平台'
        : `${metrics.breakoutIsFirst === true ? '首次' : '非首次'}突破 ${metrics.ownBreakoutDate}`,
    ),
    check(
      '本轮启动晚于龙头',
      delay === null ? 'missing' : delay >= rules.delayMin && delay <= rules.delayMax ? 'pass' : 'fail',
      delay,
      delay === null
        ? '缺少本轮启动锚点（没有可确认的龙头启动日），不给补涨标签'
        : `晚于龙头 ${delay} 个交易日（要求 ${rules.delayMin}~${rules.delayMax}）`,
    ),
  ];
};

const laggardRank = (candidate: RoleCandidate): Array<number | null> => [
  rankValue(candidate.metrics?.tradingDaysSince === null || candidate.metrics?.tradingDaysSince === undefined
    ? null
    : -candidate.metrics.tradingDaysSince),
  rankValue(candidate.metrics?.ownBreakoutDate === null || candidate.metrics?.ownBreakoutDate === undefined
    ? null
    : Number(candidate.metrics.ownBreakoutDate)),
  rankValue(candidate.metrics?.avgAmount5d ?? null),
];

const CHECK_BUILDERS: Record<ThemeStockRole, (candidate: RoleCandidate) => CheckResult[]> = {
  leader: leaderChecks,
  turnover: turnoverChecks,
  trend: trendChecks,
  laggard: laggardChecks,
};

const RANK_BUILDERS: Record<ThemeStockRole, (candidate: RoleCandidate) => Array<number | null>> = {
  leader: leaderRank,
  turnover: turnoverRank,
  trend: trendRank,
  laggard: laggardRank,
};

export type RoleAssessmentInput = {
  symbol: string;
  role: ThemeStockRole;
  eligible: boolean;
  checks: CheckResult[];
  rank: Array<number | null>;
};

/** 所有必要 checks 都 pass 才 eligible=true（missing / pending 都不能当通过） */
export const isEligible = (checks: CheckResult[]): boolean =>
  checks.length > 0 && checks.every((item) => item.state === 'pass');

export const buildRoleAssessments = (
  candidates: RoleCandidate[],
  ruleVersion: string = ASSIGN_ROLE_VERSION,
): RoleAssessmentInput[] => {
  void ruleVersion;
  const roles: ThemeStockRole[] = ['leader', 'turnover', 'trend', 'laggard'];
  const result: RoleAssessmentInput[] = [];
  for (const role of roles) {
    for (const candidate of candidates) {
      const checks = CHECK_BUILDERS[role](candidate);
      result.push({
        symbol: candidate.symbol,
        role,
        eligible: isEligible(checks),
        checks,
        rank: RANK_BUILDERS[role](candidate),
      });
    }
  }
  return result;
};

/** 旧的角色名（页面文案） */
export const ROLE_LABELS: Record<ThemeStockRole, string> = {
  leader: '龙头候选',
  turnover: '核心候选',
  trend: '趋势中军候选',
  laggard: '潜在低位补涨',
};
