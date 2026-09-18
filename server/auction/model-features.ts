export type ProbabilityInputs = {
  gapPct: number | null;
  board: number | null;
  previousOneWord: boolean | null;
  previousTurnover: number | null;
  floatMarketCapYi: number | null;
  limitPct?: number;
  sealedAtAuction?: boolean;
  /** 兼容旧调用方；历史口径未对齐的市场特征不参与新版模型。 */
  previousLimitUpCount?: number | null;
  previousBrokenCount?: number | null;
  indexGapPct?: number | null;
};

export const FEATURE_LABELS = ['相对竞价强度', '昨日连板', '昨日一字板', '昨日换手率', '流通市值'];
/** 训练和推断共用，特征顺序与模型系数一致。 */
export const auctionFeatures = (inputs: ProbabilityInputs): (number | null)[] => [
  inputs.gapPct === null ? null : inputs.gapPct / (inputs.limitPct ?? 10),
  inputs.board === null ? null : Math.min(inputs.board, 5),
  inputs.previousOneWord === null ? null : Number(inputs.previousOneWord),
  inputs.previousTurnover,
  inputs.floatMarketCapYi !== null && inputs.floatMarketCapYi > 0 ? Math.log(inputs.floatMarketCapYi) : null,
];

export const limitUpPct = (symbol: string, name: string): number => {
  if (/^(688|30)/.test(symbol)) return 20;
  if (/^(8|4|92)/.test(symbol)) return 30;
  if (/st/i.test(name)) return 5;
  return 10;
};

/** 优先采用行情给出的涨停价，否则按昨收计算到分；没有有效价格就不猜。 */
export const isSealedAtAuction = (
  symbol: string, name: string, price: number, preClose: number | null, quotedLimit?: number | null,
): boolean | null => {
  if (!Number.isFinite(price) || price <= 0) return null;
  const limit = quotedLimit !== undefined && quotedLimit !== null && Number.isFinite(quotedLimit) && quotedLimit > 0
    ? quotedLimit
    : preClose !== null && Number.isFinite(preClose) && preClose > 0
      ? Math.round((preClose * (100 + limitUpPct(symbol, name))) + 1e-8) / 100 : null;
  return limit === null ? null : Math.round(price * 100) >= Math.round(limit * 100);
};
