/** 仅代表封板概率分档；阈值基于未封板组开发期走前验证，不能解释为买入条件。 */
export const AUCTION_POLICY = {
  qualifiedProbability: 0.4,
  watchProbability: 0.3,
  maxMissingFeatures: 1,
} as const;

export const auctionProbabilityTier = (probability: number): 'qualified' | 'watch' | 'unqualified' =>
  probability >= AUCTION_POLICY.qualifiedProbability ? 'qualified'
    : probability >= AUCTION_POLICY.watchProbability ? 'watch' : 'unqualified';

export const auctionResultLabels = {
  qualified: '较高概率', watch: '观察', unqualified: '低概率', insufficient: '数据不足',
} as const;
