/**
 * 在线上「较高概率」池（p>=0.4 且竞价未封板）之上，穷举 1~2 个二元过滤条件的组合，
 * 找出能真正提高「当日收盘涨停」比例的子集，并做开发期/留出期拆分复核。
 *
 * 目的：回答「要不要减因子、要不要加硬条件」，而不是继续在概率模型里堆特征。
 * 用法：npx tsx scripts/auction-tier-filters.ts
 */
import { writeFileSync } from 'node:fs';
import { BASE, avg, completeRows, samples, walkForwardPooled, type Pred } from './_auction-lab.js';

const buyable = completeRows(BASE, samples.filter(s => !s.sealedAtAuction));
const pooled: Pred[] = walkForwardPooled(BASE, buyable);
const dates = [...new Set(pooled.map(r => r.date))].sort();
const holdoutFrom = dates.at(-20)!;
const tier = pooled.filter(r => r.p >= 0.4);
const dev = tier.filter(r => r.date < holdoutFrom);
const holdout = tier.filter(r => r.date >= holdoutFrom);

const stat = (set: Pred[]) => ({
  n: set.length,
  seal: avg(set.map(r => r.y)) ?? 0,
  touched: avg(set.map(r => r.touched)) ?? 0,
  nextOpen: avg(set.flatMap(r => r.retNextOpen === null ? [] : [r.retNextOpen])),
  perDay: set.length / Math.max(1, new Set(set.map(r => r.date)).size),
});

/** 按日等权 + 日间标准误，避免某一天候选人特别多把显著性做假 */
const dayT = (set: Pred[], pick: (r: Pred) => number) => {
  const byDay = new Map<string, number[]>();
  for (const r of set) byDay.set(r.date, [...(byDay.get(r.date) ?? []), pick(r)]);
  const means = [...byDay.values()].map(v => v.reduce((a, b) => a + b, 0) / v.length);
  if (means.length < 3) return 0;
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  const sd = Math.sqrt(means.reduce((t, v) => t + (v - mean) ** 2, 0) / (means.length - 1));
  return sd > 0 ? mean / (sd / Math.sqrt(means.length)) : 0;
};

type Filter = { label: string; keep: (r: Pred) => boolean };
const FILTERS: Filter[] = [
  { label: '竞价涨幅≤7%', keep: r => r.gapPct <= 7 },
  { label: '竞价涨幅≤8%', keep: r => r.gapPct <= 8 },
  { label: '竞价涨幅3~7%', keep: r => r.gapPct >= 3 && r.gapPct <= 7 },
  { label: '昨日换手≥10%', keep: r => (r.prevTurnover ?? 0) >= 10 },
  { label: '流通市值≤30亿', keep: r => (r.floatCap ?? 1e9) <= 30 },
  { label: '连板≥3', keep: r => r.board >= 3 },
  { label: '连板≥2', keep: r => r.board >= 2 },
  { label: '近10日涨停≥3次', keep: r => r.limitCount10 >= 3 },
  { label: '昨日炸板率≤30%', keep: r => (r.prevBrokenRatio ?? 100) <= 30 },
  { label: '板块涨停密度≥15%', keep: r => r.sectorDensity >= 0.15 },
  { label: '大盘竞价缺口≥-0.3%', keep: r => (r.indexGapPct ?? -9) >= -0.3 },
  { label: '概率≥0.5', keep: r => r.p >= 0.5 },
  { label: '概率≥0.6', keep: r => r.p >= 0.6 },
];

const pct = (v: number | null | undefined, d = 1) => v === null || v === undefined ? '   —  ' : `${(v * 100).toFixed(d)}%`.padStart(7);
const num = (v: number | null | undefined, d = 2) => v === null || v === undefined ? '   —  ' : v.toFixed(d).padStart(7);

const base = stat(tier);
console.log(`可买样本 ${buyable.length} / ${dates.length} 天；较高概率池 ${tier.length} 条（${base.perDay.toFixed(2)} 只/天）`);
console.log(`  池基准：封板 ${pct(base.seal)}  触板 ${pct(base.touched)}  次日开盘 ${num(base.nextOpen)}%`);
console.log(`  开发期 ${dev.length} 条封板 ${pct(stat(dev).seal)}；留出期(最后20日) ${holdout.length} 条封板 ${pct(stat(holdout).seal)}\n`);

type Combo = { label: string; set: Pred[] };
const combos: Combo[] = [];
for (const f of FILTERS) combos.push({ label: f.label, set: tier.filter(f.keep) });
for (let i = 0; i < FILTERS.length; i += 1) {
  for (let j = i + 1; j < FILTERS.length; j += 1) {
    const a = FILTERS[i]; const b = FILTERS[j];
    combos.push({ label: `${a.label} + ${b.label}`, set: tier.filter(r => a.keep(r) && b.keep(r)) });
  }
}

console.log('【全部 1~2 元组合，按封板率排序，n>=60】');
console.log(`  ${'条件'.padEnd(38)} ${'样本'.padStart(5)} ${'只/天'.padStart(6)} ${'封板率'.padStart(8)} ${'触板率'.padStart(8)} ${'次日开盘'.padStart(9)} ${'t'.padStart(6)}`);
const ranked = combos
  .map(c => ({ ...c, s: stat(c.set), t: dayT(c.set, r => r.y) }))
  .filter(c => c.s.n >= 60)
  .sort((a, b) => b.s.seal - a.s.seal);
for (const c of ranked) {
  console.log(`  ${c.label.padEnd(38)} ${String(c.s.n).padStart(5)} ${c.s.perDay.toFixed(2).padStart(6)} ${pct(c.s.seal)} ${pct(c.s.touched)} ${num(c.s.nextOpen)}% ${num(c.t)}`);
}

console.log('\n【组合对「次日开盘收益」的排序，n>=60】');
console.log(`  ${'条件'.padEnd(38)} ${'样本'.padStart(5)} ${'封板率'.padStart(8)} ${'次日开盘'.padStart(9)} ${'t'.padStart(6)}`);
for (const c of [...ranked].sort((a, b) => (b.s.nextOpen ?? -9) - (a.s.nextOpen ?? -9)).slice(0, 12)) {
  console.log(`  ${c.label.padEnd(38)} ${String(c.s.n).padStart(5)} ${pct(c.s.seal)} ${num(c.s.nextOpen)}% ${num(c.t)}`);
}

console.log('\n【关键条件在留出期（最后20日）是否还成立】');
const focused = ['竞价涨幅≤7%', '竞价涨幅≤8%', '竞价涨幅3~7%', '昨日换手≥10%', '流通市值≤30亿', '连板≥2', '概率≥0.5'];
console.log(`  ${'条件'.padEnd(24)} ${'开发期n'.padStart(8)} ${'开发封板'.padStart(9)} ${'开发次日'.padStart(9)} ${'留出n'.padStart(7)} ${'留出封板'.padStart(9)} ${'留出次日'.padStart(9)}`);
for (const label of focused) {
  const f = FILTERS.find(x => x.label === label)!;
  const d = stat(dev.filter(f.keep));
  const h = stat(holdout.filter(f.keep));
  console.log(`  ${label.padEnd(24)} ${String(d.n).padStart(8)} ${pct(d.seal)} ${num(d.nextOpen)}% ${String(h.n).padStart(7)} ${pct(h.seal)} ${num(h.nextOpen)}%`);
}

writeFileSync('scripts/output/auction-tier-filters.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  tier: { n: tier.length, ...base, devSeal: stat(dev).seal, holdoutSeal: stat(holdout).seal },
  combos: ranked.map(c => ({ label: c.label, ...c.s, dayT: c.t })),
}, null, 2) + '\n');

// ---------------------------------------------------------------- 稳健性检验
// 529 条上穷举了 90 个组合，最高封板率必然被「挑选」抬高。这里做两件事：
// 1) 按时间切成 6 段，看该条件是否每段都赢过池子平均
// 2) 按日 bootstrap（重采样交易日），给出封板率提升的 95% 区间
console.log('\n【稳健性】114 个交易日切成 6 段 + 按日 bootstrap（2000 次）');
const size = dates.length / 6;
const blocks: string[][] = Array.from({ length: 6 }, (_, i) =>
  dates.slice(Math.round(i * size), Math.round((i + 1) * size)));

const tierDays = [...new Set(tier.map(r => r.date))];
const rowsOfDay = new Map<string, Pred[]>();
for (const r of tier) rowsOfDay.set(r.date, [...(rowsOfDay.get(r.date) ?? []), r]);

let seed = 20260918;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const bootstrapUplift = (keep: (r: Pred) => boolean) => {
  const ups: number[] = [];
  for (let b = 0; b < 2000; b += 1) {
    let allN = 0; let allSeal = 0; let keptN = 0; let keptSeal = 0;
    for (let i = 0; i < tierDays.length; i += 1) {
      const day = tierDays[Math.floor(rand() * tierDays.length)];
      for (const r of rowsOfDay.get(day)!) {
        allN += 1; allSeal += r.y;
        if (keep(r)) { keptN += 1; keptSeal += r.y; }
      }
    }
    if (keptN > 0 && allN > 0) ups.push(keptSeal / keptN - allSeal / allN);
  }
  ups.sort((a, b) => a - b);
  return { lo: ups[Math.floor(ups.length * 0.025)] ?? 0, hi: ups[Math.floor(ups.length * 0.975)] ?? 0 };
};

const byLabel = (label: string) => FILTERS.find(x => x.label === label)!.keep;
const ROBUST: Filter[] = [
  { label: '昨日换手≥10% + 概率≥0.5', keep: r => byLabel('昨日换手≥10%')(r) && r.p >= 0.5 },
  { label: '连板≥3 + 概率≥0.5', keep: r => r.board >= 3 && r.p >= 0.5 },
  { label: '竞价涨幅≤7% + 流通市值≤30亿', keep: r => r.gapPct <= 7 && (r.floatCap ?? 1e9) <= 30 },
  { label: '流通市值≤30亿 + 板块涨停密度≥15%', keep: r => (r.floatCap ?? 1e9) <= 30 && r.sectorDensity >= 0.15 },
  { label: '概率≥0.5', keep: r => r.p >= 0.5 },
  { label: '竞价涨幅≤7%', keep: byLabel('竞价涨幅≤7%') },
  { label: '流通市值≤30亿', keep: byLabel('流通市值≤30亿') },
  { label: '昨日换手≥10%', keep: byLabel('昨日换手≥10%') },
];
console.log(`  ${'条件'.padEnd(34)} ${'整体'.padStart(7)} ${'提升'.padStart(7)} ${'提升95%区间'.padStart(18)} ${'赢段'.padStart(6)}  6段封板率`);
for (const f of ROBUST) {
  const s = stat(tier.filter(f.keep));
  const ci = bootstrapUplift(f.keep);
  let wins = 0;
  const blockRates = blocks.map(block => {
    const set = block.flatMap(d => rowsOfDay.get(d) ?? []);
    const all = avg(set.map(r => r.y));
    const part = avg(set.filter(f.keep).map(r => r.y));
    if (part !== null && all !== null && part > all) wins += 1;
    return part === null ? '  —' : `${(part * 100).toFixed(0)}%`;
  });
  console.log(`  ${f.label.padEnd(34)} ${pct(s.seal)} ${pct(s.seal - base.seal)} ${`[${pct(ci.lo)}, ${pct(ci.hi)}]`.padStart(18)} ${String(wins).padStart(4)}/6  ${blockRates.map(b => b.padStart(5)).join('')}`);
}
console.log('  （池子整体封板率 52.7%；最后 20 个交易日单独看是 47.4%）');
console.log('\n已写出 scripts/output/auction-tier-filters.json');
