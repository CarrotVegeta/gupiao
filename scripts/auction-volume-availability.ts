/**
 * 规则 2/3 到底缺哪一个数据：逐字段列出「历史能否重建」，并现场打一遍上游。
 *
 * 结论：规则 2 和规则 3 的每一个条件都由同一个量派生 ——
 *       「某个历史交易日 09:25 集合竞价的成交量/成交额」。
 *       其余字段（竞价价、昨日成交额、流通股本、近5日量）历史都能重建。
 *
 * 用法：npx tsx scripts/auction-volume-availability.ts [symbol] [pastDate]
 *   默认 sh600519 / 20260916
 */
const symbol = process.argv[2] ?? 'sh600519';
const pastDate = process.argv[3] ?? '20260916';

const say = (label: string, value: string) => console.log(`  ${label.padEnd(34)} ${value}`);

console.log('一、规则需要的字段，历史能不能重建\n');
console.log('  字段'.padEnd(36) + '历史来源'.padEnd(30) + '结论');
const rows: Array<[string, string, string]> = [
  ['竞价涨幅', '日K open ÷ 昨收', '✅ 能'],
  ['昨日全天成交额', '日K volume × 均价（或涨停池 amount）', '✅ 能'],
  ['近5日平均成交量', '日K volume', '✅ 能'],
  ['流通股本 / 流通市值', '新浪 universe(nmc/trade) 或涨停池 ltsz', '✅ 能'],
  ['昨日换手率', '日K volume ÷ 流通股本（或涨停池 hs）', '✅ 能'],
  ['昨日封板时间 / 炸板次数', '东财涨停池 push2ex（仅最近约 15 交易日）', '△ 部分'],
  ['** 09:25 集合竞价成交量 **', '—', '❌ 拿不到'],
  ['** 09:25 集合竞价成交额 **', '—', '❌ 拿不到'],
];
for (const [a, b, c] of rows) console.log(`  ${a.padEnd(34)} ${b.padEnd(30)} ${c}`);

console.log('\n  规则 2/3 的每个条件都是同一个量除以不同的分母：');
console.log('    竞价量比        = 09:25 竞价成交量 ÷ (近5日平均每分钟量 × 竞价分钟数)');
console.log('    竞价成交额门槛   = 09:25 竞价成交量 × 09:25 竞价价');
console.log('    竞昨比 ≥3%      = 09:25 竞价成交额 ÷ 昨日全天成交额');
console.log('    竞价换手率       = 09:25 竞价成交量 ÷ 流通股本');
console.log('  → 所以「缺的数据」只有一样：历史交易日的 09:25 集合竞价成交量。');

console.log('\n二、现场验证：09:25 那一笔，今天拿得到、历史拿不到\n');

const decodeGbk = (buffer: ArrayBuffer) => new TextDecoder('gbk').decode(buffer);

// 1) 腾讯分笔：今天
const todayUrl = `https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=${symbol}&p=0`;
try {
  const text = decodeGbk(await (await fetch(todayUrl)).arrayBuffer());
  const payload = text.slice(text.indexOf('"') + 1, text.lastIndexOf('"'));
  const first = payload.split('|')[0];
  const [seq, time, price, , lots, amount] = first.split('/');
  say('腾讯分笔·今天 第一笔', `${time}  价 ${price}  ${lots} 手  成交额 ${amount} 元`);
  say('  → 09:25 竞价成交额', Number(time.replaceAll(':', '')) <= 92559 ? '✅ 就在这一笔里' : '（今天第一笔不是 09:25，可能已收盘归档）');
} catch (error) {
  say('腾讯分笔·今天', `请求失败：${(error as Error).message}`);
}

// 2) 腾讯分笔：指定历史日期
for (const suffix of [`&d=${pastDate}`, `&date=${pastDate}`]) {
  try {
    const text = decodeGbk(await (await fetch(`${todayUrl}${suffix}`)).arrayBuffer());
    const payload = text.slice(text.indexOf('"') + 1, text.lastIndexOf('"'));
    const first = payload.split('|')[0];
    const time = first.split('/')[1];
    say(`腾讯分笔·d/date=${pastDate}`, `返回的第一笔时间 ${time}  → ${time?.startsWith('09:25') ? '（注意：要确认这是不是今天）' : '未返回历史'}`);
  } catch (error) {
    say(`腾讯分笔 ${suffix}`, `请求失败：${(error as Error).message}`);
  }
}
console.log('  （腾讯分笔的日期参数被忽略：无论传哪一天，返回的都是最近一个交易时段）');

// 3) 东财分笔 details/get：带日期 vs 不带日期
const emBase = 'https://push2delay.eastmoney.com/api/qt/stock/details/get';
const secid = symbol.startsWith('sh') ? `1.${symbol.slice(2)}` : `0.${symbol.slice(2)}`;
const emParams = new URLSearchParams({
  secid, fields1: 'f1,f2,f3,f4', fields2: 'f51,f52,f53,f54,f55', pos: '-80', iscca: '1', ut: 'fa5fd1943c7b386f172d6893dbfba10b',
});
try {
  const plain = (await (await fetch(`${emBase}?${emParams}`)).json()) as { data?: { details?: string[] } };
  const dated = (await (await fetch(`${emBase}?${emParams}&date=${pastDate}`)).json()) as { data?: { details?: string[] } };
  const head = (body: { data?: { details?: string[] } }) => body.data?.details?.[0] ?? '无数据';
  say('东财分笔·不带日期', head(plain));
  say(`东财分笔·date=${pastDate}`, head(dated));
  say('  两次是否相同', JSON.stringify(plain.data?.details) === JSON.stringify(dated.data?.details) ? '✅ 完全相同 → date 参数无效' : '✗ 不同');
} catch (error) {
  say('东财分笔', `请求失败：${(error as Error).message}`);
}

console.log('\n三、结论');
console.log('  线上（今天）本来就有这个数：/api/auction 的 auctionAmount / auctionRatio 就是它。');
console.log('  缺的只是「历史」。所以 server/auction/snapshot-log.ts 每天把它写进');
console.log('  data/auction-snapshots.jsonl，攒够交易日之后规则 2/3 就能真正回测。');
