/**
 * 涨停隔夜策略分析：竞价买入 vs 打板买入，到底哪个口径有优势
 *
 * 背景：用「次日开盘卖出」的口径衡量竞价买入时，无论怎么选股都是零期望甚至负期望。
 * 原因不是选股，而是入场价：涨停股次日普遍高开，竞价买入等于替卖方承担了这个溢价。
 * 本脚本把两种入场放到同一口径下对比，并做成交可行性（一字板 vs 换手板）与时间稳定性检验。
 *
 * 用法：npx tsx scripts/limit-up-hold-analysis.ts
 * 依赖：scripts/output/limit-up-history.json、scripts/output/auction-model-oos.json
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Sealed = {
  date: string;
  symbol: string;
  name: string;
  board: number;
  oneWord: boolean;
  gapPct: number;
  close: number;
  nextOpen: number | null;
  nextClose: number | null;
};

type Oos = {
  date: string;
  symbol: string;
  p: number;
  y: number;
  board: number;
  gapPct: number;
  sealed: boolean;
  retNextOpen: number | null;
};

const read = <T>(file: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'scripts/output', file), 'utf8')) as T;

const history = read<{ dates: string[]; sealed: Sealed[] }>('limit-up-history.json');
const oos = read<Oos[]>('auction-model-oos.json');

const sealedRows = history.sealed.filter((row) => row.nextOpen !== null && row.nextClose !== null);
const sealedIndex = new Map(sealedRows.map((row) => [`${row.date}|${row.symbol}`, row]));

/** 09:25 概率 + 当天真的封板 → 打板口径样本 */
const joined = oos
  .map((row) => {
    const sealed = sealedIndex.get(`${row.date}|${row.symbol}`);
    // board 取「封板当日」的连板数（sealed 侧），不是昨日候选时的连板数
    return sealed ? { probability: row.p, ...sealed } : null;
  })
  .filter((row): row is NonNullable<typeof row> => row !== null);

type Stat = { n: number; mean: number; days: number; t: number; win: number };

/** 按交易日等权计算，避免「某天票特别多」把结论带偏 */
const stat = (rows: Sealed[]): Stat => {
  const byDay = new Map<string, number[]>();
  for (const row of rows) {
    const list = byDay.get(row.date) ?? [];
    list.push(row.nextOpen as number);
    byDay.set(row.date, list);
  }
  const dayMeans = [...byDay.values()].map(
    (values) => values.reduce((a, b) => a + b, 0) / values.length,
  );
  const mean = dayMeans.reduce((a, b) => a + b, 0) / (dayMeans.length || 1);
  const variance =
    dayMeans.reduce((total, value) => total + (value - mean) ** 2, 0) /
    Math.max(1, dayMeans.length - 1);
  const sd = Math.sqrt(variance);
  return {
    n: rows.length,
    mean,
    days: byDay.size,
    t: sd > 0 ? mean / (sd / Math.sqrt(dayMeans.length)) : 0,
    win: (rows.filter((row) => (row.nextOpen as number) > 0).length / (rows.length || 1)) * 100,
  };
};

const line = (label: string, rows: Sealed[]): void => {
  if (rows.length === 0) {
    console.log(`${label.padEnd(32)} 无样本`);
    return;
  }
  const value = stat(rows);
  console.log(
    `${label.padEnd(32)} n=${String(value.n).padStart(5)} 天=${String(value.days).padStart(3)} ` +
      `次日开盘 ${value.mean.toFixed(2).padStart(6)}% t=${value.t.toFixed(2).padStart(6)} 胜率 ${value.win.toFixed(1).padStart(5)}%`,
  );
};

console.log(`区间 ${history.dates[0]} ~ ${history.dates.at(-1)}（${history.dates.length} 个交易日）`);
console.log('口径：涨停当日按涨停价买入 → 次日开盘卖出（T+1 可执行，不含手续费）\n');

console.log('=== 一、入场价对比：同样持有过夜，在哪买 ===');
console.log('  A. 竞价买入（上一交易日涨停股，今日 09:25 开盘价买入）');
const toSealed = (row: Oos): Sealed =>
  ({ date: row.date, nextOpen: row.retNextOpen } as Sealed);
line('    全部候选', oos.filter((row) => row.retNextOpen !== null).map(toSealed));
line('    其中竞价未涨停(可买)', oos.filter((row) => row.retNextOpen !== null && row.gapPct < 9.8).map(toSealed));
console.log('  B. 打板买入（当日封板后按涨停价买入）');
line('    全部涨停股', sealedRows);
line('    其中 换手板（当天开过板）', sealedRows.filter((row) => !row.oneWord));
line('    其中 一字板（基本买不到）', sealedRows.filter((row) => row.oneWord));

console.log('\n=== 二、打板分档（只看买得到的换手板）===');
const buyable = sealedRows.filter((row) => !row.oneWord);
line('首板', buyable.filter((row) => row.board === 1));
line('2 板', buyable.filter((row) => row.board === 2));
line('3 板', buyable.filter((row) => row.board === 3));
line('>=4 板', buyable.filter((row) => row.board >= 4));
for (const [label, lo, hi] of [
  ['当日竞价 >=9.8%', 9.8, 999],
  ['当日竞价 7~9.8%', 7, 9.8],
  ['当日竞价 5~7%', 5, 7],
  ['当日竞价 3~5%', 3, 5],
  ['当日竞价 0~3%', 0, 3],
  ['当日竞价 低开', -999, 0],
] as Array<[string, number, number]>) {
  line(label, buyable.filter((row) => row.gapPct >= lo && row.gapPct < hi));
}

console.log('\n=== 三、叠加 09:25 涨停概率模型 ===');
console.log(`  候选池 ${oos.length} 条，其中当天真的封板 ${joined.length} 条（${((joined.length / oos.length) * 100).toFixed(1)}%）`);
line('全部封板候选', joined);
line('  换手板 可买', joined.filter((row) => !row.oneWord));
line('  换手板 概率>=55%', joined.filter((row) => !row.oneWord && row.probability >= 0.55));
line('  换手板 概率30~55%', joined.filter((row) => !row.oneWord && row.probability >= 0.3 && row.probability < 0.55));
line('  换手板 概率<30%', joined.filter((row) => !row.oneWord && row.probability < 0.3));
line('  换手板 概率>=30% 且 >=2板', joined.filter((row) => !row.oneWord && row.probability >= 0.3 && row.board >= 2));

console.log('\n=== 四、时间稳定性（换手板，按月份）===');
const months = new Map<string, Sealed[]>();
for (const row of buyable) {
  const key = row.date.slice(0, 6);
  const list = months.get(key) ?? [];
  list.push(row);
  months.set(key, list);
}
for (const key of [...months.keys()].sort()) {
  line(key, months.get(key) as Sealed[]);
}

console.log('\n=== 五、每日可打标的数量 ===');
{
  const perDay = new Map<string, number>();
  for (const row of joined.filter((item) => !item.oneWord)) {
    perDay.set(row.date, (perDay.get(row.date) ?? 0) + 1);
  }
  const counts = [...perDay.values()];
  const highProbability = joined.filter((row) => !row.oneWord && row.probability >= 0.55);
  const highPerDay = new Map<string, number>();
  for (const row of highProbability) {
    highPerDay.set(row.date, (highPerDay.get(row.date) ?? 0) + 1);
  }
  console.log(
    `  换手板封板候选 ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)} 只/天（${counts.length} 天有票）`,
  );
  console.log(
    `  其中概率>=55% 的 ${(highProbability.length / Math.max(1, highPerDay.size)).toFixed(2)} 只/天（${highPerDay.size} 天有票）`,
  );
}

console.log('\n注意：换手板只是「当天开过板、理论上能成交」的代理，真实成交率还取决于封单量与排队顺序，');
console.log('      一字板那部分（+6.96%）正是买不到的高收益样本，不能计入可实现收益。');
