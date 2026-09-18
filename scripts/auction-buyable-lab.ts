/**
 * 「竞价可买到 · 较高概率 → 开盘买入 → 当日收盘涨停」胜率优化实验台。
 *
 * 目标指标（只用竞价未封板的可买样本）：
 *   封板率精度、AUC / Brier、次日开盘卖出平均收益（买入价 = 09:25 竞价价 = 当日开盘价）。
 *
 * 协议：与 scripts/auction-segmented-model.ts 一致的样本重建 + 走前验证
 * （minTrainDays=25，每 10 个交易日重拟合，只用预测日之前的样本），全部指标为样本外。
 *
 * 用法：npx tsx scripts/auction-buyable-lab.ts [base|loo|add1]
 */
import { writeFileSync } from 'node:fs';
import { fitLogistic } from '../server/auction/training.js';
import {
  BASE, F, HEADER, boardOf, completeRows, contaminated, history, metrics, row, samples, walkForwardPooled,
  type FeatureKey,
} from './_auction-lab.js';

// ---------------------------------------------------------------- 实验

const buyable = samples.filter(s => !s.sealedAtAuction);
const buyableDev = buyable.filter(s => s.date < [...new Set(samples.map(s => s.date))].sort().at(-20)!);
const buyableHoldout = buyable.filter(s => s.date >= [...new Set(samples.map(s => s.date))].sort().at(-20)!);

console.log(`样本 ${samples.length} 条（已剔除受污染 ST 创业板/科创/北交 ${contaminated.length} 条），交易日 ${history.dates.length} 天`);
console.log(`竞价未封板（可买）${buyable.length} 条；其中开发期 ${buyableDev.length}、最后20日留出 ${buyableHoldout.length}`);
console.log(`板块映射覆盖 ${boardOf.size} 只股票`);
console.log(HEADER);

const experiments: { group: string; label: string; keys: FeatureKey[] }[] = [
  { group: 'base', label: 'V2 线上 5 特征', keys: BASE },
];
// 逐个剔除基础特征
for (const drop of BASE) {
  experiments.push({ group: 'loo', label: `去掉「${F[drop].label}」`, keys: BASE.filter(k => k !== drop) });
}
// 单个新增
const CANDIDATES: FeatureKey[] = ['shrink', 'limitCount10', 'ztSpan', 'pct20', 'distHigh60', 'prevAmplitude',
  'prevBrokenRatio', 'marketLimit', 'marketBroken', 'marketMulti', 'indexGap', 'indexPrev', 'index5d', 'index20d',
  'prevGap', 'sectorHeatLog', 'sectorBoardCount', 'sectorMaxBoard', 'sectorIsLeader', 'sectorHeatRank',
  'gapNear', 'gapHigh', 'gapLow', 'gapBoard', 'gapSq', 'heatGap'];
const CANDIDATES2: FeatureKey[] = ['sectorDensity', 'sectorDensitySum', 'gapRankDay', 'gapRelDay',
  'boardRankDay', 'capRankDay', 'turnoverRelDay', 'heatRankDay', 'poolSizeDay', 'prevGapRel'];
for (const add of CANDIDATES) {
  experiments.push({ group: 'add1', label: `+${F[add].label}`, keys: [...BASE, add] });
}
for (const add of CANDIDATES2) {
  experiments.push({ group: 'add2', label: `+${F[add].label}`, keys: [...BASE, add] });
}
// 组合：把信息量最互补的几组一起加进去
experiments.push({ group: 'add2', label: '+板块密度+横截面', keys: [...BASE, 'sectorDensity', 'gapRankDay', 'boardRankDay'] });
experiments.push({ group: 'add2', label: '+板块密度+换手相对', keys: [...BASE, 'sectorDensity', 'turnoverRelDay'] });

// 换手阈值 / 小市值 的非线性与交互项（把「换手≥10% + 概率≥0.5」这类硬条件交给模型）
const CANDIDATES3: FeatureKey[] = ['turnoverHi', 'turnoverMid', 'turnoverCap', 'turnoverHiGap',
  'turnoverGap', 'capSmall', 'capSmallGap'];
for (const add of CANDIDATES3) {
  experiments.push({ group: 'add3', label: `+${F[add].label}`, keys: [...BASE, add] });
}
experiments.push({ group: 'add3', label: '+换手阈值+交互', keys: [...BASE, 'turnoverHi', 'turnoverHiGap'] });
experiments.push({ group: 'add3', label: '+换手阈值+交互+换手上限', keys: [...BASE, 'turnoverHi', 'turnoverHiGap', 'turnoverCap'] });
experiments.push({ group: 'add3', label: '+小市值+小市值交互', keys: [...BASE, 'capSmall', 'capSmallGap'] });
experiments.push({ group: 'add3', label: '+换手阈值+小市值+两交互', keys: [...BASE, 'turnoverHi', 'turnoverHiGap', 'capSmall', 'capSmallGap'] });

// V3 候选：删掉线性无贡献的「昨日换手率」和「昨日一字板」，改用换手档位 + 交互
const V3: Array<[string, FeatureKey[]]> = [
  ['V3a 去换手/一字 + 换手阈值+交互', ['gapRel', 'board', 'floatCap', 'turnoverHi', 'turnoverHiGap']],
  ['V3b 去换手/一字 + 换手阈值', ['gapRel', 'board', 'floatCap', 'turnoverHi']],
  ['V3c 保留一字 + 换手阈值+交互', ['gapRel', 'board', 'oneWord', 'floatCap', 'turnoverHi', 'turnoverHiGap']],
  ['V3d 去换手/一字 + 换手上限', ['gapRel', 'board', 'floatCap', 'turnoverCap']],
  ['V3e 4特征(去换手/一字)', ['gapRel', 'board', 'floatCap']],
  ['V3f V3a + 小市值交互', ['gapRel', 'board', 'floatCap', 'turnoverHi', 'turnoverHiGap', 'capSmall', 'capSmallGap']],
  ['V3g V3a + 板块密度', ['gapRel', 'board', 'floatCap', 'turnoverHi', 'turnoverHiGap', 'sectorDensity']],
  ['V3h V3a 去掉连板', ['gapRel', 'floatCap', 'turnoverHi', 'turnoverHiGap']],
];
for (const [label, keys] of V3) experiments.push({ group: 'v3', label, keys });

const HOLDOUT_FROM = [...new Set(samples.map(s => s.date))].sort().at(-20)!;
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const results: Record<string, unknown>[] = [];
for (const group of ['base', 'loo', 'add1', 'add2', 'add3', 'v3']) {
  if (only.length && !only.includes(group)) continue;
  console.log(`\n=== ${group} ===`);
  console.log(HEADER);
  for (const exp of experiments.filter(e => e.group === group)) {
    // 每个实验在同一批「该特征集完整」的样本上比较，基线重跑一遍作为对照。
    const subset = completeRows(exp.keys, buyable);
    const pooled = walkForwardPooled(exp.keys, subset);
    const m = metrics(pooled, exp.label);
    console.log(row(exp.label, m));
    const holdoutPreds = pooled.filter(r => r.date >= HOLDOUT_FROM);
    const h = metrics(holdoutPreds, '留出');
    const entry: Record<string, unknown> = {
      group: exp.group, variant: exp.label, features: exp.keys.map(k => F[k].name), dev: m, holdout: h,
    };
    console.log(row('  ↳ 最后20日留出', h));
    if (exp.keys.length !== BASE.length || exp.keys.some((k, i) => k !== BASE[i])) {
      const baseSame = metrics(walkForwardPooled(BASE, subset), '基线(同样本)');
      entry.sameSubsetBase = baseSame;
      console.log(row('  ↳ 同样本基线', baseSame));
    }
    results.push(entry);
  }
}

writeFileSync('scripts/output/auction-buyable-lab.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  samples: samples.length, buyable: buyable.length,
  results,
}, null, 2) + '\n');
console.log('\n已写出 scripts/output/auction-buyable-lab.json');
