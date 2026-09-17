/**
 * 竞价连板概率模型（逻辑回归）
 *
 * 目标：昨日涨停池里的票，今天收盘仍然涨停的概率。
 * 训练：scripts/auction-model.ts，2026-02-26 ~ 2026-09-16 共 140 个交易日、12100 个样本，
 *       走前验证（只用历史交易日拟合），样本外 AUC 0.813、Brier 0.116。
 *
 * 特征全部来自 09:25 竞价时刻即可得的信息，服务器不需要额外抓个股数据：
 *   今日竞价溢价%、昨日连板数、昨日是否一字板、昨日换手率%、流通市值、
 *   昨日涨停家数、昨日炸板家数、大盘竞价缺口%
 *
 * 重要提醒：本模型预测的是「涨停概率」，不是「买入收益」。回测显示概率越高往往
 * 对应越高的竞价溢价，按竞价价买入的期望收益并不随概率上升，二者必须分开看。
 */
import type { AuctionPremium } from '../../src/types.js';

export type ProbabilityInputs = {
  /** 今日竞价溢价（%），即 09:25 竞价价相对昨收 */
  gapPct: number | null;
  /** 昨日连板数 */
  board: number | null;
  /** 昨日是否一字板 */
  previousOneWord: boolean | null;
  /** 昨日换手率（%） */
  previousTurnover: number | null;
  /** 流通市值（亿元） */
  floatMarketCapYi: number | null;
  /** 昨日涨停家数 */
  previousLimitUpCount: number | null;
  /** 昨日炸板家数 */
  previousBrokenCount: number | null;
  /** 大盘（上证）竞价缺口（%） */
  indexGapPct: number | null;
};

type FeatureKey = keyof typeof MODEL;

/** 标准化系数：features 顺序与 weights/means/stds 一一对应 */
const MODEL = {
  gapPct: {
    weight: 0.9469394476940711,
    mean: 1.5340744425101518,
    std: 3.7997462386544605,
  },
  board: {
    weight: 0.2003209453635301,
    mean: 1.2908065986902097,
    std: 0.7185242396495436,
  },
  prevOneWord: {
    weight: 0.13563822884131727,
    mean: 0.058691867694603335,
    std: 0.23504708541292244,
  },
  prevTurnover: {
    weight: -0.0973307068337641,
    mean: 7.8185078338721485,
    std: 6.921803122247277,
  },
  logFloatCap: {
    weight: -0.24056225459952557,
    mean: 4.3228682413413635,
    std: 1.0443105595764677,
  },
  prevLimitCount: {
    weight: 0.0030228322360308594,
    mean: 10.286868938075317,
    std: 3.9361455954655145,
  },
  prevBrokenCount: {
    weight: 0.050398223717078555,
    mean: 4.487888584929173,
    std: 2.1137419917878106,
  },
  indexGapPct: {
    weight: 0.04496441262421249,
    mean: -0.12429660946696151,
    std: 0.3939653178912962,
  },
} as const;

const INTERCEPT = -1.748074672248267;

const LABELS: Record<FeatureKey, string> = {
  gapPct: '竞价溢价',
  board: '昨日连板',
  prevOneWord: '昨日一字板',
  prevTurnover: '昨日换手率',
  logFloatCap: '流通市值',
  prevLimitCount: '昨日涨停家数',
  prevBrokenCount: '昨日炸板家数',
  indexGapPct: '大盘竞价缺口',
};

/** 与训练时完全一致的取数方式（未做变换以外的任何处理） */
const featureValues = (inputs: ProbabilityInputs): Record<FeatureKey, number | null> => ({
  gapPct: inputs.gapPct,
  board: inputs.board === null ? null : Math.min(inputs.board, 5),
  prevOneWord: inputs.previousOneWord === null ? null : inputs.previousOneWord ? 1 : 0,
  prevTurnover: inputs.previousTurnover,
  logFloatCap:
    inputs.floatMarketCapYi !== null && inputs.floatMarketCapYi > 0
      ? Math.log(inputs.floatMarketCapYi)
      : null,
  prevLimitCount: inputs.previousLimitUpCount === null ? null : inputs.previousLimitUpCount / 10,
  prevBrokenCount: inputs.previousBrokenCount === null ? null : inputs.previousBrokenCount / 10,
  indexGapPct: inputs.indexGapPct,
});

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

export type ProbabilityResult = {
  /** 今日收盘继续涨停的概率（0~1） */
  probability: number;
  /** 缺失特征数量（缺失项按均值代入，即标准化后取 0） */
  missingCount: number;
  /** 按贡献绝对值排序的说明，供前端展示 */
  reasons: string[];
};

const formatValue = (key: FeatureKey, value: number): string => {
  switch (key) {
    case 'gapPct':
    case 'prevTurnover':
    case 'indexGapPct':
      return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    case 'board':
      return `${value} 连板`;
    case 'logFloatCap':
      return `${Math.exp(value).toFixed(1)} 亿`;
    case 'prevLimitCount':
      return `${Math.round(value * 10)} 家`;
    case 'prevBrokenCount':
      return `${Math.round(value * 10)} 家`;
    case 'prevOneWord':
      return value >= 0.5 ? '是' : '否';
    default:
      return value.toFixed(2);
  }
};

/**
 * 计算「今日收盘继续涨停」的概率。
 * 缺失特征按训练集均值代入（标准化后为 0），并在 missingCount 中报出，
 * 避免因为一个字段缺失就把概率整体压到错误区间。
 */
export const predictLimitUpProbability = (inputs: ProbabilityInputs): ProbabilityResult => {
  const values = featureValues(inputs);
  let score = INTERCEPT;
  let missingCount = 0;
  const contributions: Array<{
    key: FeatureKey;
    contribution: number;
    /** 展示用原值：board 要还原真实连板数，否则会出现表格写 6 连板、依据写 5 连板 */
    displayValue: number;
  }> = [];

  for (const key of Object.keys(MODEL) as FeatureKey[]) {
    const spec = MODEL[key];
    const raw = values[key];
    if (raw === null || !Number.isFinite(raw)) {
      missingCount += 1;
      continue;
    }
    const z = (raw - spec.mean) / spec.std;
    const contribution = spec.weight * z;
    score += contribution;
    contributions.push({
      key,
      contribution,
      displayValue: key === 'board' && inputs.board !== null ? inputs.board : raw,
    });
  }

  const probability = sigmoid(score);
  const sorted = contributions.sort(
    (left, right) => Math.abs(right.contribution) - Math.abs(left.contribution),
  );
  const reasons = sorted.slice(0, 3).map((item) => {
    const direction = item.contribution >= 0 ? '偏高' : '偏低';
    return `${LABELS[item.key]} ${formatValue(item.key, item.displayValue)}（${direction}）`;
  });

  return { probability, missingCount, reasons };
};

/** 涨停幅度：ST 5%，科创板/创业板 20%，北交所 30%，其余 10% */
export const limitUpPct = (symbol: string, name: string): number => {
  if (/st|\*st/i.test(name)) return 5;
  if (symbol.startsWith('688') || symbol.startsWith('30')) return 20;
  if (symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92')) return 30;
  return 10;
};

/**
 * 竞价就已经封在涨停价 = 一字/秒板，按竞价价买不到。
 * 回测里「合格」的候选有 75% 属于这一类，必须单独标出来。
 */
export const isSealedAtAuction = (
  symbol: string,
  name: string,
  auctionPct: number,
): boolean => auctionPct >= limitUpPct(symbol, name) - 0.3;

/**
 * 档位阈值取自习概率校准表：≥55% 实际涨停率约 65%，30~55% 约 45%，<30% 约 11%，
 * 全样本基准 18.8%。三个档位与基准的倍数关系为 3.5x / 2.4x / 0.6x。
 */
export const toProbabilityTier = (
  probability: number,
): 'qualified' | 'watch' | 'unqualified' =>
  probability >= 0.55 ? 'qualified' : probability >= 0.3 ? 'watch' : 'unqualified';

/** 溢价分档（衡量买入性价比，与涨停概率是独立维度） */
export const classifyAuctionPremium = (
  gapPct: number,
): { level: AuctionPremium; reason: string } => {
  if (gapPct >= 5) {
    return {
      level: 'chase',
      reason: '竞价追高：历史涨停率 55.2%，但竞价买入平均收益 -2.27%',
    };
  }
  if (gapPct >= 3) {
    return {
      level: 'rich',
      reason: '竞价溢价偏高：历史涨停率 25.7%，竞价买入平均收益 -0.82%',
    };
  }
  if (gapPct >= 0) {
    return {
      level: 'mild',
      reason: '竞价温和高开：历史涨停率 11.1%，竞价买入平均收益 -0.46%',
    };
  }
  return {
    level: 'discount',
    reason: '竞价低开：历史涨停率仅 5.6%，但竞价买入平均收益 +0.18%',
  };
};
