/**
 * 诊断：连续两次拉取竞价候选，检查评分/竞价明细是否稳定
 * 用法：npx tsx scripts/auction-stability.ts [YYYYMMDD]
 */
import { fetchEastmoneyAuction } from '../server/auction/eastmoney.js';

const tradeDate = process.argv[2] ?? '20260917';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const first = await fetchEastmoneyAuction(tradeDate);
await sleep(60_000);
const second = await fetchEastmoneyAuction(tradeDate);

const key = (item: (typeof first.items)[number]): string =>
  [
    item.score,
    item.result,
    item.auctionPrice,
    item.auctionPct,
    item.auctionAmount,
    item.auctionRatio,
  ].join('|');

const a = new Map(first.items.map((item) => [item.symbol, item]));
let changed = 0;

for (const item of second.items) {
  const before = a.get(item.symbol);
  if (!before || key(before) === key(item)) continue;
  changed += 1;
  console.log(`\n${item.symbol} ${item.name}`);
  console.log(
    `  1) score=${before.score} ${before.result} price=${before.auctionPrice} pct=${before.auctionPct} amount=${before.auctionAmount} ratio=${before.auctionRatio}`,
  );
  console.log(
    `  2) score=${item.score} ${item.result} price=${item.auctionPrice} pct=${item.auctionPct} amount=${item.auctionAmount} ratio=${item.auctionRatio}`,
  );
  console.log(`  原因1: ${before.reasons.join(' / ')}`);
  console.log(`  原因2: ${item.reasons.join(' / ')}`);
}

console.log(`\n变化 ${changed} / ${second.items.length} 只`);
console.log(`第一次 ${first.fetchedAt}，第二次 ${second.fetchedAt}`);
