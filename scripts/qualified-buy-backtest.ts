/**
 * 「竞价结论=合格 且 竞价未封板」买入的胜率回测
 *
 * 口径：
 * - 合格 = 涨停概率模型输出 >= 55%（阈值取自概率校准表，见 README）
 * - 竞价未封板 = 09:25 竞价价没有开到涨停价（否则买不到）
 * - 买入价 = 09:25 竞价成交价（= 当日开盘价）
 * - 概率全部来自走前验证（只用历史交易日拟合），因此是样本外结果
 * - 不含手续费
 *
 * 用法：npx tsx scripts/qualified-buy-backtest.ts [概率阈值]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Row = {
  date: string;
  symbol: string;
  p: number;
  gapPct: number;
  board: number;
  sealed: boolean;
  touched: boolean;
  retSameDay: number;
  retNextOpen: number | null;
  retNextClose: number | null;
  mfe: number;
  mae: number;
};

type HistoryTick = { date: string; symbol: string; name: string };

const oos = JSON.parse(
  readFileSync(path.join(process.cwd(), 'scripts/output/auction-model-oos.json'), 'utf8'),
) as Row[];
const history = JSON.parse(
  readFileSync(path.join(process.cwd(), 'scripts/output/limit-up-history.json'), 'utf8'),
) as { dates: string[]; ticks: HistoryTick[] };

const nameOf = new Map(history.ticks.map((tick) => [`${tick.date}|${tick.symbol}`, tick.name]));

/** 涨停幅度：ST 5%，科创板/创业板 20%，北交所 30%，其余 10% */
const limitPct = (symbol: string, name: string): number => {
  if (/st|\*st/i.test(name)) return 5;
  if (symbol.startsWith('688') || symbol.startsWith('30')) return 20;
  if (symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92')) return 30;
  return 10;
};

const rows = oos
  .filter((row) => row.retNextOpen !== null && row.retNextClose !== null)
  .map((row) => {
    const name = nameOf.get(`${row.date}|${row.symbol}`) ?? '';
    const limit = limitPct(row.symbol, name);
    return { ...row, name, limit, sealedAtAuction: row.gapPct >= limit - 0.3 };
  });

const THRESHOLD = Number(process.argv[2] ?? 0.55);
const qualified = rows.filter((row) => row.p >= THRESHOLD);

const stats = (set: typeof rows, pick: (row: (typeof rows)[number]) => number) => {
  if (set.length === 0) return null;
  const values = set.map(pick);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { n: set.length, mean };
};

const winRate = (set: typeof rows, pick: (row: (typeof rows)[number]) => boolean): string =>
  set.length === 0 ? '—' : `${((set.filter(pick).length / set.length) * 100).toFixed(1)}%`;

const dayEqual = (set: typeof rows, pick: (row: (typeof rows)[number]) => number) => {
  const byDay = new Map<string, number[]>();
  for (const row of set) {
    const list = byDay.get(row.date) ?? [];
    list.push(pick(row));
    byDay.set(row.date, list);
  }
  const means = [...byDay.values()].map((values) => values.reduce((a, b) => a + b, 0) / values.length);
  const mean = means.reduce((a, b) => a + b, 0) / (means.length || 1);
  const sd = Math.sqrt(
    means.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, means.length - 1),
  );
  return { mean, days: means.length, t: sd > 0 ? mean / (sd / Math.sqrt(means.length)) : 0 };
};

const block = (label: string, set: typeof rows): void => {
  if (set.length === 0) {
    console.log(`\n${label}: 无样本`);
    return;
  }
  const nextOpen = dayEqual(set, (row) => row.retNextOpen as number);
  console.log(`\n${label}`);
  console.log(`  样本 ${set.length} 条，覆盖 ${nextOpen.days} 个交易日`);
  console.log(`  胜率（按笔）`);
  console.log(`    当日收盘涨停（封板）      ${winRate(set, (row) => row.sealed)}`);
  console.log(`    当日盘中触及涨停          ${winRate(set, (row) => row.touched)}`);
  console.log(`    当日收盘价 > 买入价       ${winRate(set, (row) => row.retSameDay > 0)}`);
  console.log(`    次日开盘价 > 买入价       ${winRate(set, (row) => (row.retNextOpen as number) > 0)}`);
  console.log(`    次日收盘价 > 买入价       ${winRate(set, (row) => (row.retNextClose as number) > 0)}`);
  console.log(`  平均收益（不含手续费）`);
  console.log(`    当日收盘卖 ${stats(set, (row) => row.retSameDay)!.mean.toFixed(2)}%`);
  console.log(
    `    次日开盘卖 按笔 ${stats(set, (row) => row.retNextOpen as number)!.mean.toFixed(2)}% / 日等权 ${nextOpen.mean.toFixed(2)}%（t=${nextOpen.t.toFixed(2)}）`,
  );
  console.log(
    `    次日收盘卖 ${stats(set, (row) => row.retNextClose as number)!.mean.toFixed(2)}%`,
  );
  console.log(
    `  盘中最大浮盈均值 ${(set.reduce((total, row) => total + row.mfe, 0) / set.length).toFixed(2)}%，最大浮亏均值 ${(set.reduce((total, row) => total + row.mae, 0) / set.length).toFixed(2)}%`,
  );
};

console.log(`区间 ${history.dates[0]} ~ ${history.dates.at(-1)}（${history.dates.length} 个交易日）`);
console.log(`合格阈值：概率 >= ${(THRESHOLD * 100).toFixed(0)}%（走前验证的样本外概率）`);
console.log(`全样本候选 ${rows.length} 条`);

const qualifiedBuyable = qualified.filter((row) => !row.sealedAtAuction);
const qualifiedSealed = qualified.filter((row) => row.sealedAtAuction);

console.log(`\n合格 ${qualified.length} 条，其中：`);
console.log(`  竞价就封板（买不到）${qualifiedSealed.length} 条`);
console.log(`  竞价未封板（可买）  ${qualifiedBuyable.length} 条  ← 本次回测对象`);

block('【本次问题】合格 且 竞价未封板 → 买入', qualifiedBuyable);
block('对照 A：合格 但竞价已封板（买不到）', qualifiedSealed);
block('对照 B：观察档（30%~55%）且竞价未封板', rows.filter((row) => row.p >= 0.3 && row.p < THRESHOLD && !row.sealedAtAuction));
block('对照 C：不合格（<30%）且竞价未封板', rows.filter((row) => row.p < 0.3 && !row.sealedAtAuction));

console.log('\n按连板数拆分（合格 且 竞价未封板）：');
for (const [label, pick] of [
  ['首板', (row: (typeof rows)[number]) => row.board === 1],
  ['2 板', (row: (typeof rows)[number]) => row.board === 2],
  ['>=3 板', (row: (typeof rows)[number]) => row.board >= 3],
] as Array<[string, (row: (typeof rows)[number]) => boolean]>) {
  const set = qualifiedBuyable.filter(pick);
  if (set.length === 0) {
    console.log(`  ${label}：无样本`);
    continue;
  }
  const nextOpen = dayEqual(set, (row) => row.retNextOpen as number);
  console.log(
    `  ${label.padEnd(6)} n=${String(set.length).padStart(3)}  封板率 ${winRate(set, (row) => row.sealed).padStart(6)}  次日开盘赚 ${winRate(set, (row) => (row.retNextOpen as number) > 0).padStart(6)}  次日开盘均收益 ${nextOpen.mean.toFixed(2).padStart(6)}%`,
  );
}

console.log('\n拆解（合格 且 竞价未封板）：当天封住 vs 没封住');
{
  const sealed = qualifiedBuyable.filter((row) => row.sealed);
  const open = qualifiedBuyable.filter((row) => !row.sealed);
  const show = (label: string, set: typeof rows): void => {
    console.log(
      `  ${label.padEnd(10)} n=${String(set.length).padStart(3)}  当日收盘卖 ${(set.reduce((t, r) => t + r.retSameDay, 0) / set.length).toFixed(2).padStart(6)}%  次日开盘卖 ${(set.reduce((t, r) => t + (r.retNextOpen as number), 0) / set.length).toFixed(2).padStart(6)}%`,
    );
  };
  show('当天封住', sealed);
  show('没封住', open);
  console.log(
    `  这批票当日开盘平均相对昨收 +${(qualifiedBuyable.reduce((t, r) => t + r.gapPct, 0) / qualifiedBuyable.length).toFixed(2)}%（买入就已经付掉的溢价）`,
  );
}

console.log('\n按月（合格 且 竞价未封板，次日开盘卖出胜率）：');
const months = new Map<string, typeof rows>();
for (const row of qualifiedBuyable) {
  const key = row.date.slice(0, 6);
  const list = months.get(key) ?? [];
  list.push(row);
  months.set(key, list);
}
for (const key of [...months.keys()].sort()) {
  const set = months.get(key) as typeof rows;
  const nextOpen = dayEqual(set, (row) => row.retNextOpen as number);
  console.log(
    `  ${key}  n=${String(set.length).padStart(3)}  胜率 ${winRate(set, (row) => (row.retNextOpen as number) > 0).padStart(6)}  平均 ${nextOpen.mean.toFixed(2).padStart(6)}%`,
  );
}
