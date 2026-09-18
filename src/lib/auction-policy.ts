import type { AuctionResult } from '../types.js';

/**
 * 竞价合格判定：只看两个条件，不再输出涨停封板概率。
 *
 * 1. 竞价高开幅度落在 [gapMinPct, gapMaxPct] 之内 —— 过低说明市场认可度不够，
 *    过高（尤其一字板）要么买不到，要么溢价已经把空间吃光。
 * 2. 竞价量比 = 09:25 竞价成交额 ÷ 昨日全天成交额，达到 ratioMinPct。
 *
 * 阈值来自经验规则，**尚未在本地历史样本上验证**：09:25 竞价量能没有可用的免费历史接口
 * （腾讯分笔/同花顺分时忽略日期参数、东财 push2his 断连、网易 502）。
 * 线上每次成功返回都会把 09:25 字段写入 data/auction-snapshots.jsonl
 * （见 server/auction/snapshot-log.ts），攒够交易日后再回测这两个阈值。
 */
export const AUCTION_POLICY = {
  gapMinPct: 2,
  gapMaxPct: 6,
  ratioMinPct: 5,
  /** 量比达到这一档记作「爆量」；仍属合格，只是多一个标记 */
  ratioHeavyPct: 10,
} as const;

export const auctionResultLabels: Record<AuctionResult, string> = {
  qualified: '合格',
  unqualified: '不合格',
  insufficient: '数据不足',
};

export const auctionResultOrder: AuctionResult[] = ['qualified', 'unqualified', 'insufficient'];

export type AuctionQualification = {
  result: AuctionResult;
  /** 竞价量比是否达到「爆量」档 */
  heavyVolume: boolean;
  reasons: string[];
};

const isUsable = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

export const evaluateAuctionQualification = (
  auctionPct: number | null,
  auctionRatio: number | null,
): AuctionQualification => {
  if (!isUsable(auctionPct) || !isUsable(auctionRatio)) {
    const missing = [
      isUsable(auctionPct) ? null : '竞价涨幅',
      isUsable(auctionRatio) ? null : '竞价量比',
    ].filter((label): label is string => label !== null);
    return {
      result: 'insufficient',
      heavyVolume: false,
      reasons: [`缺少${missing.join('、')}，无法判定`],
    };
  }

  const gapPass = auctionPct >= AUCTION_POLICY.gapMinPct && auctionPct <= AUCTION_POLICY.gapMaxPct;
  const ratioPass = auctionRatio >= AUCTION_POLICY.ratioMinPct;
  const heavyVolume = auctionRatio >= AUCTION_POLICY.ratioHeavyPct;

  return {
    result: gapPass && ratioPass ? 'qualified' : 'unqualified',
    heavyVolume,
    reasons: [
      `竞价高开 ${auctionPct.toFixed(2)}%，${gapPass ? '在' : '不在'} ${AUCTION_POLICY.gapMinPct}%~${AUCTION_POLICY.gapMaxPct}% 区间`,
      `竞价量比 ${auctionRatio.toFixed(2)}%，${ratioPass ? '达到' : '低于'} ${AUCTION_POLICY.ratioMinPct}%${heavyVolume ? '（爆量）' : ''}`,
    ],
  };
};
