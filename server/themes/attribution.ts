/**
 * 本轮题材关联（attribution）：判断「某股票今天是不是在走这个题材」。
 *
 * 与静态概念归属（东财 F10）严格分开：F10 只说明公司业务归属，**不能**单独确认
 * 本轮驱动（见审查报告 §5.2）。因此这里的输入里 `isMember` 只影响最终兜底分支，
 * 走不到「supported」。
 *
 * 本模块是纯函数，不发任何网络请求。
 */
import type { Evidence, RelationState, ThemeRelation } from '../../src/types.js';

export type AttributionInput = {
  themeCode: string;
  symbol: string;
  /** 是否在 F10 静态概念归属里（背景信息，不能独立确认本轮驱动） */
  isMember: boolean;
  /** 候选证据；调用方负责给出 observedAt / validTradeDate / match */
  evidence: Evidence[];
  /** 证据整体获取失败：不能自动当成「仅概念归属」或「不相关」 */
  evidenceFetchFailed: boolean;
  /** 是否存在明确矛盾的资料（注意：「同时有 A/B 两条逻辑」不算冲突） */
  hasConflictingEvidence: boolean;
  /** 当前证据更支持的其它题材代码 */
  alternativeThemeCodes: string[];
  /** YYYYMMDD */
  tradeDate: string;
  /** 观察截止时间（ISO），用于过滤「晚于 asOf」的证据 */
  asOf: string;
};

/** 把 ISO 或 YYYYMMDD 归一到可比较的数值（YYYYMMDDHHmmss） */
const toComparable = (value: string): number | null => {
  if (/^\d{8}$/.test(value)) return Number(`${value}000000`);
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isAfter = (value: string, asOf: string): boolean => {
  const left = toComparable(value);
  const right = toComparable(asOf);
  if (left === null || right === null) return false;
  // asOf 是 ISO（毫秒），YYYYMMDD 是秒级数值，统一到毫秒比较
  const normalizedLeft = String(left).length >= 13 ? left : left * 1000;
  const normalizedRight = String(right).length >= 13 ? right : right * 1000;
  return normalizedLeft > normalizedRight;
};

/**
 * 日期过滤：晚于 asOf 的观测/发布、以及不是本次交易日的证据一律不参与判定。
 * 没有历史快照时，不能把当前证据用于历史请求。
 */
export const validEvidenceFor = (input: AttributionInput): Evidence[] =>
  input.evidence.filter((item) => {
    if (item.validTradeDate !== input.tradeDate) return false;
    if (isAfter(item.observedAt, input.asOf)) return false;
    if (item.publishedAt !== null && isAfter(item.publishedAt, input.asOf)) return false;
    if (item.symbol !== input.symbol) return false;
    return true;
  });

/**
 * 状态判定优先级（顺序是契约，不要调整）：
 *   冲突证据 → possible
 *   本题材 exact → supported
 *   证据获取失败 → unknown
 *   本题材 ambiguous → possible
 *   只有其它题材有依据 → other_driver
 *   其余按是否静态成员兜底
 */
export function resolveThemeRelation(input: AttributionInput): ThemeRelation {
  const valid = validEvidenceFor(input);
  const own = valid.filter((item) => item.themeCode === input.themeCode);
  const asOf = input.asOf;

  if (input.hasConflictingEvidence) {
    return {
      state: 'possible',
      evidenceIds: own.map((item) => item.id),
      reasons: ['存在明确矛盾的资料，只能判为可能相关'],
      alternativeThemeCodes: input.alternativeThemeCodes,
      topicKeys: unique(own.map((item) => item.topicKey)),
      asOf,
    };
  }

  const exact = own.filter((item) => item.match === 'exact');
  if (exact.length > 0) {
    return {
      state: 'supported',
      evidenceIds: exact.map((item) => item.id),
      reasons: [`本轮有明确依据：${exact.map((item) => item.text).join('；')}`],
      alternativeThemeCodes: input.alternativeThemeCodes,
      topicKeys: unique(exact.map((item) => item.topicKey)),
      asOf,
    };
  }

  if (input.evidenceFetchFailed) {
    return {
      state: 'unknown',
      evidenceIds: [],
      reasons: ['证据获取失败，无法判断本轮关联（不等于仅概念归属）'],
      alternativeThemeCodes: input.alternativeThemeCodes,
      topicKeys: [],
      asOf,
    };
  }

  const ambiguous = own.filter((item) => item.match === 'ambiguous');
  if (ambiguous.length > 0) {
    return {
      state: 'possible',
      evidenceIds: ambiguous.map((item) => item.id),
      reasons: [`只有模糊关联依据：${ambiguous.map((item) => item.text).join('；')}`],
      alternativeThemeCodes: input.alternativeThemeCodes,
      topicKeys: unique(ambiguous.map((item) => item.topicKey)),
      asOf,
    };
  }

  if (input.alternativeThemeCodes.length > 0) {
    return {
      state: 'other_driver',
      evidenceIds: [],
      reasons: [`当前证据更支持其它题材：${input.alternativeThemeCodes.join('、')}`],
      alternativeThemeCodes: input.alternativeThemeCodes,
      topicKeys: [],
      asOf,
    };
  }

  return {
    state: input.isMember ? 'membership_only' : 'unknown',
    evidenceIds: [],
    reasons: [
      input.isMember
        ? '只有静态概念归属，没有本轮驱动依据'
        : '既无静态归属也无本轮证据',
    ],
    alternativeThemeCodes: [],
    topicKeys: [],
    asOf,
  };
}

const unique = (values: Array<string | null>): string[] => [
  ...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)),
];

/** 中文状态名，前端与日志共用，避免各写一套 */
export const RELATION_STATE_LABELS: Record<RelationState, string> = {
  supported: '驱动有依据',
  possible: '可能相关',
  membership_only: '仅概念归属',
  other_driver: '存在其他驱动',
  unknown: '关联未知',
};
