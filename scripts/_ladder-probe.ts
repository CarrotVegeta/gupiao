/**
 * 临时验证脚本：直接打东财涨停池，跑一遍连板天梯 / 今昨对比的计算。
 * 用法：npx tsx scripts/_ladder-probe.ts [YYYYMMDD]
 */
import { fetchLimitUpLadder } from '../server/limit-up/ladder.js';

const tradeDate = process.argv[2] ?? '20260917';

const body = await fetchLimitUpLadder(tradeDate);

console.log('tradeDate         :', body.tradeDate);
console.log('previousTradeDate :', body.previousTradeDate);
console.log('status / error    :', body.status, '/', body.error);
console.log('previousAvailable :', body.previousAvailable);
console.log('previousCount     :', body.previousCount);
console.log('carriedCount      :', body.carriedCount);
console.log('promotionRate     :', body.promotionRate);
console.log('today items       :', body.items.length);

console.log('\n--- 今日连板天梯 ---');
for (const group of body.ladder) {
  console.log(
    `${String(group.boardCount ?? '?').padStart(2)} 板  ${String(group.items.length).padStart(2)} 只  ${group.items
      .map((item) => item.name)
      .join('、')}`,
  );
}

console.log('\n--- 今/昨对比 ---');
for (const bucket of body.comparison) {
  console.log(
    `昨日 ${String(bucket.boardCount ?? '?').padStart(2)} 板  共 ${bucket.total} 只  晋级 ${bucket.carried.length}  断板 ${bucket.fallen.length}`,
  );
  console.log(`    晋级：${bucket.carried.map((s) => `${s.name}(${s.boardCount}板)`).join('、') || '无'}`);
  console.log(`    断板：${bucket.fallen.map((s) => `${s.name}(${s.pct?.toFixed(2)}%)`).join('、') || '无'}`);
}

console.log('\n--- 昨日连板天梯 ---');
for (const group of body.previousLadder) {
  console.log(
    `${String(group.boardCount ?? '?').padStart(2)} 板  ${String(group.items.length).padStart(2)} 只  ${group.items
      .map((item) => item.name)
      .join('、')}`,
  );
}
