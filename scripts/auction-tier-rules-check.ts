/**
 * 「较高概率 + 竞价未封板」池上，两条候选规则的最终复核：
 *   A. 竞价涨幅封顶（≤7%）—— 对封板率没用，但对「次日开盘卖出」收益可能有用
 *   B. 昨日换手≥10% 且 概率≥0.5 —— 唯一 bootstrap 区间不跨 0 的封板率提升
 * 复核方式：按日 bootstrap（重采样交易日）+ 6 段时间稳定性 + 最后 20 日留出期。
 *
 * 用法：npx tsx scripts/auction-tier-rules-check.ts
 */
import { writeFileSync } from 'node:fs';
import { BASE, avg, completeRows, samples, walkForwardPooled, type Pred } from './_auction-lab.js';

const buyable = completeRows(BASE, samples.filter(s => !s.sealedAtAuction));
const tier = walkForwardPooled(BASE, buyable).filter(r => r.p >= 0.4);
const dates = [...new Set(tier.map(r => r.date))].sort();
const holdoutFrom = dates.at(-20)!;

const byDay = new Map<string, Pred[]>();
for (const r of tier) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
const dayList = [...byDay.keys()];
const rowsOf = (days: string[]) => days.flatMap(d => byDay.get(d) ?? []);

const seal = (set: Pred[]) => avg(set.map(r => r.y)) ?? 0;
const nextOpen = (set: Pred[]) => avg(set.flatMap(r => r.retNextOpen === null ? [] : [r.retNextOpen]));

let seed = 987654321;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** 按日重采样，返回 (规则组 - 其余) 的封板率差与次日开盘收益差的 95% 区间 */
const boot = (keep: (r: Pred) => boolean, pick: (set: Pred[]) => number) => {
  const diffs: number[] = [];
  for (let b = 0; b < 4000; b += 1) {
    const sample = rowsOf(Array.from({ length: dayList.length }, () => dayList[Math.floor(rand() * dayList.length)]));
    const kept = sample.filter(keep);
    const rest = sample.filter(r => !keep(r));
    if (kept.length < 5 || rest.length < 5) continue;
    diffs.push(pick(kept) - pick(rest));
  }
  diffs.sort((a, b) => a - b);
  const q = (p: number) => diffs[Math.floor(diffs.length * p)] ?? 0;
  return { lo: q(0.025), hi: q(0.975), mean: avg(diffs) ?? 0, n: diffs.length };
};

const size = dates.length / 6;
const blocks = Array.from({ length: 6 }, (_, i) => dates.slice(Math.round(i * size), Math.round((i + 1) * size)));

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const sgn = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;

const RULES: Array<{ label: string; keep: (r: Pred) => boolean; note: string }> = [
  { label: '竞价涨幅≤7%', keep: r => r.gapPct <= 7, note: '压住买入溢价' },
  { label: '竞价涨幅≤8%', keep: r => r.gapPct <= 8, note: '压住买入溢价' },
  { label: '竞价涨幅≤7% 且 概率≥0.5', keep: r => r.gapPct <= 7 && r.p >= 0.5, note: '溢价+概率' },
  { label: '昨日换手≥10% 且 概率≥0.5', keep: r => (r.prevTurnover ?? 0) >= 10 && r.p >= 0.5, note: '封板率候选' },
  { label: '换手≥10% 且 概率≥0.5 且 涨幅≤7%', keep: r => (r.prevTurnover ?? 0) >= 10 && r.p >= 0.5 && r.gapPct <= 7, note: '两者合并' },
  { label: '换手≥8% 且 概率≥0.5', keep: r => (r.prevTurnover ?? 0) >= 8 && r.p >= 0.5, note: '门槛敏感性' },
  { label: '换手≥12% 且 概率≥0.5', keep: r => (r.prevTurnover ?? 0) >= 12 && r.p >= 0.5, note: '门槛敏感性' },
  { label: '换手≥15% 且 概率≥0.5', keep: r => (r.prevTurnover ?? 0) >= 15 && r.p >= 0.5, note: '门槛敏感性' },
  { label: '昨日换手≥10%', keep: r => (r.prevTurnover ?? 0) >= 10, note: '单条件对照' },
  { label: '流通市值≤30亿', keep: r => (r.floatCap ?? 1e9) <= 30, note: '单条件对照' },
  { label: '连板≥3', keep: r => r.board >= 3, note: '单条件对照' },
];

console.log(`较高概率可买池 ${tier.length} 条 / ${dates.length} 天；基准 封板 ${pct(seal(tier))}，次日开盘 ${sgn(nextOpen(tier))}\n`);

console.log('【规则效果】');
console.log(`  ${'规则'.padEnd(26)} ${'保留n'.padStart(6)} ${'只/天'.padStart(6)} ${'封板率'.padStart(8)} ${'封板率差(95%区间)'.padStart(24)} ${'次日开盘'.padStart(9)} ${'收益差(95%区间)'.padStart(24)}`);
for (const rule of RULES) {
  const kept = tier.filter(rule.keep);
  const sealBoot = boot(rule.keep, seal);
  const retBoot = boot(rule.keep, nextOpen);
  console.log(
    `  ${rule.label.padEnd(26)} ${String(kept.length).padStart(6)} ${(kept.length / dates.length).toFixed(2).padStart(6)} `
    + `${pct(seal(kept)).padStart(8)} ${`${sgn(sealBoot.mean * 100)} [${sgn(sealBoot.lo * 100)}, ${sgn(sealBoot.hi * 100)}]`.padStart(24)} `
    + `${sgn(nextOpen(kept)).padStart(9)} ${`${sgn(retBoot.mean)} [${sgn(retBoot.lo)}, ${sgn(retBoot.hi)}]`.padStart(24)}`,
  );
}

console.log('\n【6 段稳定性】每段内「规则组 - 其余」的封板率差 / 收益差（百分点）');
console.log(`  ${'规则'.padEnd(26)} ${blocks.map((_, i) => `第${i + 1}段`.padStart(13)).join('')}`);
for (const rule of RULES) {
  const cells = blocks.map(block => {
    const set = rowsOf(block);
    const kept = set.filter(rule.keep);
    const rest = set.filter(r => !rule.keep(r));
    if (kept.length < 5 || rest.length < 5) return '     —      ';
    const ds = (seal(kept) - seal(rest)) * 100;
    const dr = nextOpen(kept) - nextOpen(rest);
    return `${sgn(ds, 0)}/${sgn(dr, 1)}`.padStart(13);
  });
  console.log(`  ${rule.label.padEnd(26)} ${cells.join('')}`);
}

console.log('\n【最后 20 个交易日留出期】');
console.log(`  ${'规则'.padEnd(26)} ${'保留n'.padStart(6)} ${'封板率'.padStart(8)} ${'次日开盘'.padStart(9)}   （留出期池子 ${tier.filter(r => r.date >= holdoutFrom).length} 条，封板 ${pct(seal(tier.filter(r => r.date >= holdoutFrom)))}，次日开盘 ${sgn(nextOpen(tier.filter(r => r.date >= holdoutFrom)))}）`);
for (const rule of RULES) {
  const kept = tier.filter(r => r.date >= holdoutFrom && rule.keep(r));
  console.log(`  ${rule.label.padEnd(26)} ${String(kept.length).padStart(6)} ${pct(seal(kept)).padStart(8)} ${sgn(nextOpen(kept)).padStart(9)}`);
}

writeFileSync('scripts/output/auction-tier-rules-check.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  tier: { n: tier.length, seal: seal(tier), nextOpen: nextOpen(tier) },
  rules: RULES.map(rule => {
    const kept = tier.filter(rule.keep);
    const holdout = kept.filter(r => r.date >= holdoutFrom);
    return {
      label: rule.label, kept: kept.length, perDay: kept.length / dates.length,
      seal: seal(kept), nextOpen: nextOpen(kept),
      sealUplift: boot(rule.keep, seal), returnUplift: boot(rule.keep, nextOpen),
      holdout: { n: holdout.length, seal: seal(holdout), nextOpen: nextOpen(holdout) },
      blocks: blocks.map(block => {
        const set = rowsOf(block);
        const k = set.filter(rule.keep); const r = set.filter(x => !rule.keep(x));
        return k.length < 5 || r.length < 5 ? null : { sealDiff: seal(k) - seal(r), retDiff: nextOpen(k) - nextOpen(r) };
      }),
    };
  }),
}, null, 2) + '\n');
console.log('\n已写出 scripts/output/auction-tier-rules-check.json');
