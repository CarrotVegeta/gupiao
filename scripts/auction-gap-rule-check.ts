/**
 * 逐条核对外部给的「竞价选股」规则，用项目已有的 140 个交易日历史。
 *
 * 规则 1（竞价涨幅分档）可以直接验证；
 * 规则 2/3（量比、竞价成交额、竞价换手率）需要 09:25 竞价量能，
 * 用 scripts/fetch-sina-minute.ts 抓的首根分钟K线做代理，单独在
 * scripts/auction-volume-proxy.ts 里评估。
 *
 * 用法：npx tsx scripts/auction-gap-rule-check.ts
 */
import { BASE, avg, completeRows, samples, type Sample } from './_auction-lab.js';

const buyable = completeRows(BASE, samples.filter(s => !s.sealedAtAuction));
const all = completeRows(BASE, samples);

const pct = (v: number | null | undefined, d = 1) => v === null || v === undefined ? '  —  ' : `${(v * 100).toFixed(d)}%`.padStart(7);
const num = (v: number | null | undefined, d = 2) => v === null || v === undefined ? '  —  ' : v.toFixed(d).padStart(7);

/** 收盘价相对昨收 = (1+开盘涨幅) × (1+开盘买入当日收益) - 1 */
const closeVsPrevClose = (s: Sample) => (1 + s.gapPct / 100) * (1 + s.retSameDay / 100) - 1;

type Bucket = { label: string; test: (s: Sample) => boolean };
const TIERS: Bucket[] = [
  { label: '<2.8% 小幅高开', test: s => s.gapPct < 2.8 },
  { label: '2.8~3.5% 黄金区间', test: s => s.gapPct >= 2.8 && s.gapPct < 3.5 },
  { label: '3.5~7% 强高开', test: s => s.gapPct >= 3.5 && s.gapPct < 7 },
  { label: '>7% 超高开', test: s => s.gapPct >= 7 },
];
const FINE: Bucket[] = [
  { label: '<0%', test: s => s.gapPct < 0 },
  { label: '0~2.8%', test: s => s.gapPct >= 0 && s.gapPct < 2.8 },
  { label: '2.8~3.5%', test: s => s.gapPct >= 2.8 && s.gapPct < 3.5 },
  { label: '3.5~5%', test: s => s.gapPct >= 3.5 && s.gapPct < 5 },
  { label: '5~7%', test: s => s.gapPct >= 5 && s.gapPct < 7 },
  { label: '7~9%', test: s => s.gapPct >= 7 && s.gapPct < 9 },
  { label: '>=9%', test: s => s.gapPct >= 9 },
];

const report = (title: string, rows: Sample[], tiers: Bucket[]) => {
  console.log(`\n${title}（共 ${rows.length} 条）`);
  console.log(`  ${'区间'.padEnd(18)} ${'样本'.padStart(6)} ${'只/天'.padStart(6)} ${'收盘涨(>昨收)'.padStart(13)} ${'收盘>开盘'.padStart(10)} ${'收盘涨停'.padStart(9)} ${'次日开盘'.padStart(9)}`);
  const days = new Set(rows.map(r => r.date)).size;
  for (const tier of tiers) {
    const set = rows.filter(tier.test);
    if (set.length === 0) { console.log(`  ${tier.label.padEnd(18)} 无样本`); continue; }
    console.log(
      `  ${tier.label.padEnd(18)} ${String(set.length).padStart(6)} ${(set.length / days).toFixed(2).padStart(6)} `
      + `${pct(avg(set.map(s => +(closeVsPrevClose(s) > 0))) ?? 0).padStart(13)} `
      + `${pct(avg(set.map(s => +(s.retSameDay > 0))) ?? 0).padStart(10)} `
      + `${pct(avg(set.map(s => s.y)) ?? 0).padStart(9)} `
      + `${num(avg(set.flatMap(s => s.retNextOpen === null ? [] : [s.retNextOpen])))}`,
    );
  }
};

console.log('外部规则核验：竞价涨幅分档');
console.log('「收盘涨(>昨收)」= 尾盘相对昨收上涨，也就是规则里说的「当日收红」；');
console.log('「收盘>开盘」= 09:25 开盘价买入并持到收盘是否赚钱。');

report('【A】规则原分档 · 全部候选（含竞价已封板，买不到的也算）', all, TIERS);
report('【B】规则原分档 · 只算竞价未封板（可买到）', buyable, TIERS);
report('【C】细分档 · 全部候选', all, FINE);
report('【D】细分档 · 只算可买到', buyable, FINE);

console.log('\n规则原文的三个断言：');
{
  const golden = all.filter(s => s.gapPct >= 2.8 && s.gapPct < 3.5);
  const goldenBuy = buyable.filter(s => s.gapPct >= 2.8 && s.gapPct < 3.5);
  const low = all.filter(s => s.gapPct < 2.8);
  const high = all.filter(s => s.gapPct >= 7);
  const line = (label: string, got: number, claim: string) =>
    console.log(`  ${label.padEnd(42)} 实测 ${pct(got)}   规则声称 ${claim}`);
  line('2.8~3.5% 当日收红（全部候选）', avg(golden.map(s => +(closeVsPrevClose(s) > 0))) ?? 0, '87.2%');
  line('2.8~3.5% 当日收红（可买到）', avg(goldenBuy.map(s => +(closeVsPrevClose(s) > 0))) ?? 0, '87.2%');
  line('<2.8% 当日翻绿（全部候选）', avg(low.map(s => +(closeVsPrevClose(s) < 0))) ?? 0, '>60%');
  line('>7% 次日开盘收益（全部候选）', (avg(high.flatMap(s => s.retNextOpen === null ? [] : [s.retNextOpen])) ?? 0) / 100, '「主力出货高发区」');
  console.log('');
  console.log('  按涨停幅度归一化后再看同一件事（避免 20% 板被算成「超高开」）：');
  for (const [label, lo, hi] of [['相对强度 <0.28', 0, 0.28], ['0.28~0.35', 0.28, 0.35], ['0.35~0.7', 0.35, 0.7], ['>=0.7', 0.7, 9]] as Array<[string, number, number]>) {
    const set = all.filter(s => s.gapRel >= lo && s.gapRel < hi);
    if (!set.length) continue;
    console.log(`    ${label.padEnd(16)} n=${String(set.length).padStart(5)}  收红 ${pct(avg(set.map(s => +(closeVsPrevClose(s) > 0))) ?? 0)}  收盘涨停 ${pct(avg(set.map(s => s.y)) ?? 0)}  次日开盘 ${num(avg(set.flatMap(s => s.retNextOpen === null ? [] : [s.retNextOpen])))}`);
  }
}
