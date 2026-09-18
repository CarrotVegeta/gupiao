/**
 * 诊断「竞价可买 · 较高概率」的胜率天花板来自哪里。
 *
 * 1) 不用模型，先看结构性事实：封板率 / 次日开盘收益在「竞价涨幅 × 昨日连板」网格上的分布
 * 2) 线上模型的分档扫描：阈值从 0.30 扫到 0.80，每一步的封板率和次日开盘收益
 * 3) 训练区域收窄：只用竞价涨幅 >= g 的样本拟合，看是否把系数集中到真正决策的区域
 * 4) 每日取前 K 名：绝对阈值 vs 横截面排名
 *
 * 全部用走前验证样本外概率。
 * 用法：npx tsx scripts/auction-buyable-region.ts
 */
import { writeFileSync } from 'node:fs';
import { fitLogistic, predictLogistic } from '../server/auction/training.js';
import {
  BASE, F, avg, completeRows, samples, walkForwardPooled, type FeatureKey, type Pred, type Sample,
} from './_auction-lab.js';

const buyable = completeRows(BASE, samples.filter(s => !s.sealedAtAuction));
const dates = [...new Set(buyable.map(s => s.date))].sort();
const pooled = walkForwardPooled(BASE, buyable);

const fmtPct = (v: number | null | undefined, d = 1) => v === null || v === undefined ? '   —  ' : `${(v * 100).toFixed(d)}%`.padStart(7);
const fmtNum = (v: number | null | undefined, d = 2) => v === null || v === undefined ? '   —  ' : v.toFixed(d).padStart(7);

type Set = Pred[];
const stat = (set: Set) => ({
  n: set.length,
  seal: avg(set.map(r => r.y)),
  touched: avg(set.map(r => r.touched)),
  nextOpen: avg(set.flatMap(r => r.retNextOpen === null ? [] : [r.retNextOpen])),
  sameDay: avg(set.map(r => r.retSameDay)),
});
const line = (label: string, set: Set) => {
  const s = stat(set);
  return `  ${label.padEnd(20)} n=${String(s.n).padStart(4)}  封板 ${fmtPct(s.seal)}  触板 ${fmtPct(s.touched)}  当日收盘卖 ${fmtNum(s.sameDay)}%  次日开盘卖 ${fmtNum(s.nextOpen)}%`;
};

const GAP_BUCKETS: Array<[string, (g: number) => boolean]> = [
  ['<0% 低开', g => g < 0],
  ['0~3%', g => g >= 0 && g < 3],
  ['3~5%', g => g >= 3 && g < 5],
  ['5~7%', g => g >= 5 && g < 7],
  ['7~9%', g => g >= 7 && g < 9],
  ['>=9%', g => g >= 9],
];
const BOARDS: Array<[string, (b: number) => boolean]> = [
  ['首板', b => b === 1], ['2板', b => b === 2], ['3板', b => b === 3], ['>=4板', b => b >= 4],
];

console.log(`可买样本 ${buyable.length} 条 / ${dates.length} 个交易日（全部走前验证样本外概率）\n`);

console.log('【1】不用模型：竞价涨幅 × 昨日连板 的结构性封板率');
console.log(`  ${'分组'.padEnd(20)} ${'样本'.padStart(6)} ${'封板率'.padStart(8)} ${'次日开盘'.padStart(9)}`);
for (const [gl, gpick] of GAP_BUCKETS) {
  const set = buyable.filter(r => gpick(r.gapPct));
  const s = stat(set);
  console.log(`  ${gl.padEnd(20)} ${String(s.n).padStart(6)} ${fmtPct(s.seal)} ${fmtNum(s.nextOpen)}%`);
}
console.log('');
for (const [bl, bpick] of BOARDS) {
  const set = buyable.filter(r => bpick(r.board));
  const s = stat(set);
  console.log(`  ${bl.padEnd(20)} ${String(s.n).padStart(6)} ${fmtPct(s.seal)} ${fmtNum(s.nextOpen)}%`);
}

console.log('\n【1b】连板 × 竞价涨幅 交叉（只保留 n>=25 的格子，格式：封板率(n) / 次日开盘%）');
{
  const head = '  ' + '连板'.padEnd(8) + GAP_BUCKETS.map(([g]) => g.padStart(17)).join('');
  console.log(head);
  for (const [bl, bpick] of BOARDS) {
    const cells = GAP_BUCKETS.map(([, gpick]) => {
      const set = buyable.filter(r => bpick(r.board) && gpick(r.gapPct));
      if (set.length < 25) return '—'.padStart(17);
      const s = stat(set);
      return `${fmtPct(s.seal)}(${s.n})/${fmtNum(s.nextOpen)}`.padStart(17);
    });
    console.log('  ' + bl.padEnd(8) + cells.join(''));
  }
}

console.log('\n【2】线上模型分档扫描（概率阈值）');
console.log(`  ${'阈值'.padEnd(10)} ${'样本'.padStart(6)} ${'封板率'.padStart(8)} ${'触板率'.padStart(8)} ${'次日开盘'.padStart(9)} ${'每日只数'.padStart(9)}`);
for (const t of [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]) {
  const set = pooled.filter(r => r.p >= t);
  const s = stat(set);
  console.log(`  p>=${t.toFixed(2)}`.padEnd(11) + `${String(s.n).padStart(6)} ${fmtPct(s.seal)} ${fmtPct(s.touched)} ${fmtNum(s.nextOpen)}% ${(s.n / dates.length).toFixed(2).padStart(8)}`);
}

console.log('\n【2b】不看概率，只看竞价涨幅（线上现有概率与涨幅高度共线）');
for (const [gl, gpick] of GAP_BUCKETS) {
  const set = pooled.filter(r => gpick(r.gapPct) && r.p >= 0.4);
  if (set.length < 10) continue;
  console.log(line(`p≥.4 且 ${gl}`, set));
}

console.log('\n【3】训练区域收窄：只用「竞价涨幅>=g」的可买样本拟合 5 特征模型');
console.log(`  ${'训练区域'.padEnd(14)} ${'每日前1封板(n)'.padStart(19)} ${'每日前3封板(n)'.padStart(19)} ${'前3次日开盘'.padStart(12)}`);
for (const g of [0, 2, 3, 4, 5, 6]) {
  const trainRows = buyable.filter(r => r.gapPct >= g);
  const preds = walkForwardPooled(BASE, trainRows);
  const top1 = dates.flatMap(d => preds.filter(r => r.date === d).sort((a, b) => b.p - a.p).slice(0, 1));
  const top3 = dates.flatMap(d => preds.filter(r => r.date === d).sort((a, b) => b.p - a.p).slice(0, 3));
  const s1 = stat(top1); const s3 = stat(top3);
  console.log(`  gap>=${g}%`.padEnd(15)
    + `${fmtPct(s1.seal)}(${String(s1.n).padStart(3)})`.padStart(19)
    + `${fmtPct(s3.seal)}(${String(s3.n).padStart(3)})`.padStart(19)
    + `${fmtNum(s3.nextOpen)}%`.padStart(12));
}

console.log('\n【4】每日取前 K 名（线上 5 特征，全部可买样本参与排名）');
console.log(`  ${'K'.padEnd(6)} ${'样本'.padStart(6)} ${'封板率'.padStart(8)} ${'触板率'.padStart(8)} ${'次日开盘'.padStart(9)} ${'当日收盘'.padStart(9)}`);
for (const k of [1, 2, 3, 5, 8, 10, 20]) {
  const set = dates.flatMap(d => pooled.filter(r => r.date === d).sort((a, b) => b.p - a.p).slice(0, k));
  const s = stat(set);
  console.log(`  前${String(k).padEnd(4)} ${String(s.n).padStart(6)} ${fmtPct(s.seal)} ${fmtPct(s.touched)} ${fmtNum(s.nextOpen)}% ${fmtNum(s.sameDay)}%`);
}

console.log('\n【5】线上「较高概率」池（p>=0.4）的子结构');
const tier = pooled.filter(r => r.p >= 0.4);
console.log(`  总计 ${tier.length} 条，覆盖 ${new Set(tier.map(r => r.date)).size} 个交易日，平均 ${(tier.length / new Set(tier.map(r => r.date)).size).toFixed(2)} 只/天`);
for (const [bl, bpick] of BOARDS) console.log(line(`连板 ${bl}`, tier.filter(r => bpick(r.board))));
for (const [gl, gpick] of GAP_BUCKETS) console.log(line(`涨幅 ${gl}`, tier.filter(r => gpick(r.gapPct))));
for (const [label, pick] of [
  ['流通市值<30亿', (r: Sample) => (r.floatCap ?? 1e9) < 30],
  ['30~100亿', (r: Sample) => (r.floatCap ?? 0) >= 30 && (r.floatCap ?? 0) < 100],
  ['>=100亿', (r: Sample) => (r.floatCap ?? 0) >= 100],
  ['昨日换手<10%', (r: Sample) => (r.prevTurnover ?? 99) < 10],
  ['昨日换手>=10%', (r: Sample) => (r.prevTurnover ?? 0) >= 10],
  ['同板块涨停>=5家', (r: Sample) => r.sectorHeat >= 5],
  ['同板块涨停<5家', (r: Sample) => r.sectorHeat < 5],
] as Array<[string, (r: Sample) => boolean]>) {
  console.log(line(label, tier.filter(pick)));
}

console.log('\n【6】线上「较高概率」池：逐月稳定性');
{
  const byMonth = new Map<string, Pred[]>();
  for (const r of tier) {
    const key = r.date.slice(0, 6);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }
  for (const key of [...byMonth.keys()].sort()) {
    const set = byMonth.get(key)!;
    const s = stat(set);
    console.log(`  ${key}  n=${String(s.n).padStart(3)}  封板 ${fmtPct(s.seal)}  次日开盘 ${fmtNum(s.nextOpen)}%`);
  }
}

// 第二阶段：在基线概率之上再叠一层「只在决策区训练」的排序模型
console.log('\n【7】两阶段：基线 p>=0.35 的子样本上再拟合一个排序模型（第二阶段也走前重拟合）');
let stage2Cache: { model: ReturnType<typeof fitLogistic>; keys: FeatureKey[] } | null = null;
{
  const EXTRA: FeatureKey[] = ['gapRel', 'board', 'turnover', 'floatCap', 'sectorHeatLog', 'prevAmplitude', 'marketMulti', 'indexGap'];
  const rowsU = pooled.filter(r => r.p >= 0.35);
  const stageDates = [...new Set(rowsU.map(r => r.date))].sort();
  const stage2: Pred[] = [];
  for (let i = 0; i < stageDates.length; i += 1) {
    const date = stageDates[i];
    if (i < 10 || i % 10 === 0) {
      const train = rowsU.filter(r => r.date < date);
      if (train.length > 60) {
        stage2Cache = {
          model: fitLogistic(train.map(r => EXTRA.map(k => F[k].pick(r)) as number[]), train.map(r => r.y)),
          keys: EXTRA,
        };
      }
    }
    if (!stage2Cache) continue;
    const cache = stage2Cache;
    for (const row of rowsU.filter(r => r.date === date)) {
      stage2.push({ ...row, p: predictLogistic(cache.model, cache.keys.map(k => F[k].pick(row))) });
    }
  }
  const topK = (k: number, rows: Pred[]) => stageDates.flatMap(d => rows.filter(r => r.date === d).sort((a, b) => b.p - a.p).slice(0, k));
  console.log(`  ${'排序依据'.padEnd(20)} ${'前3封板'.padStart(9)} ${'前3次日开盘'.padStart(13)}  样本`);
  for (const [label, rows] of [['基线概率', rowsU], ['第二阶段模型', stage2]] as Array<[string, Pred[]]>) {
    const s = stat(topK(3, rows));
    console.log(`  ${label.padEnd(20)} ${fmtPct(s.seal)} ${fmtNum(s.nextOpen)}%  ${s.n}`);
  }
}

writeFileSync('scripts/output/auction-buyable-region.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  buyable: buyable.length, dates: dates.length,
  thresholdSweep: [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70].map(t => {
    const s = stat(pooled.filter(r => r.p >= t));
    return { threshold: t, ...s, perDay: s.n / dates.length };
  }),
}, null, 2) + '\n');
