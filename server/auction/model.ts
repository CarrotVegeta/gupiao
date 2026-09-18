/**
 * 分组封板概率：竞价已封板与未封板分别拟合，相对竞价强度按涨停幅度归一化。
 * 固定留出验证与参数来源见 docs/auction-model-v2.md。
 */
import type { AuctionPremium } from '../../src/types.js';
import { auctionProbabilityTier } from '../../src/lib/auction-policy.js';
import { auctionFeatures, FEATURE_LABELS, type ProbabilityInputs } from './model-features.js';
import { SEGMENTED_MODELS } from './model-parameters.js';
import { predictLogistic } from './training.js';
export { isSealedAtAuction, limitUpPct } from './model-features.js';
export type { ProbabilityInputs } from './model-features.js';
export const toProbabilityTier = auctionProbabilityTier;

export type ProbabilityResult = { probability: number; missingCount: number; reasons: string[] };

export const predictLimitUpProbability = (inputs: ProbabilityInputs): ProbabilityResult => {
  const model = inputs.sealedAtAuction ? SEGMENTED_MODELS.sealed : SEGMENTED_MODELS.unsealed;
  const values = auctionFeatures(inputs);
  const missingCount = values.filter(v => v === null || !Number.isFinite(v)).length;
  const descriptions = [
    `竞价 ${inputs.gapPct?.toFixed(2)}% / 涨停幅度 ${inputs.limitPct ?? 10}%`,
    `${inputs.board} 连板`, inputs.previousOneWord ? '是' : '否',
    `${inputs.previousTurnover?.toFixed(2)}%`, `${inputs.floatMarketCapYi?.toFixed(1)} 亿`,
  ];
  const contributions = values.flatMap((v, j) => v === null || !Number.isFinite(v) ? [] : [{
    j, contribution: model.weights[j] * ((v - model.means[j]) / model.stds[j]),
  }]).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return {
    probability: predictLogistic(model, values), missingCount,
    reasons: [
      inputs.sealedAtAuction ? '竞价已封板组模型；不代表能够买入' : '竞价未封板组模型；预测收盘封板，不是盘中触板',
      ...contributions.slice(0, 3).map(({ j, contribution }) =>
        `${FEATURE_LABELS[j]} ${descriptions[j]}（${contribution >= 0 ? '提高' : '降低'}封板概率）`),
    ],
  };
};

/** 只描述价格位置；旧全样本收益统计不能代表当前候选的买入性价比。 */
export const classifyAuctionPremium = (gapPct: number): { level: AuctionPremium; reason: string } => {
  if (gapPct >= 5) return { level: 'chase', reason: '竞价追高：高开不等于高收益，需另看成交与回撤风险' };
  if (gapPct >= 3) return { level: 'rich', reason: '竞价溢价偏高：仅表示价格位置，不作为合格条件' };
  if (gapPct >= 0) return { level: 'mild', reason: '竞价温和高开：仅表示价格位置' };
  return { level: 'discount', reason: '竞价低开：不代表低风险或适合买入' };
};
