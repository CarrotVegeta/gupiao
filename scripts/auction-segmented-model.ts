/**
 * 竞价分组模型的可复现离线验证。默认只写研究报告；--write 才更新线上参数。
 * npx tsx scripts/auction-segmented-model.ts [--write]
 * 输入：limit-up-history.json + 同批 sina-k-<symbol>.txt，均位于 scripts/output。
 * 最后20个交易日为固定留出集；模型形式及40%/30%分档在开发期确定。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { auctionFeatures, isSealedAtAuction, limitUpPct } from '../server/auction/model-features.js';
import { fitLogistic, predictLogistic, walkForward } from '../server/auction/training.js';
import { AUCTION_POLICY } from '../src/lib/auction-policy.js';

type Tick = {
  date: string; symbol: string; name: string; gapPct: number; board: number; prevOneWord: boolean;
  prevTurnover: number | null; floatCap: number | null; prevLimitCount: number; prevBrokenCount: number;
  indexGapPct: number | null; sealedToday: boolean; touchedToday: boolean; retNextOpen: number | null;
};
const raw = readFileSync('scripts/output/limit-up-history.json', 'utf8');
const history = JSON.parse(raw) as { ticks: Tick[] };
const barCache = new Map<string, Map<string, { open: number; previousClose: number }>>();
const hashes: string[] = [];
function bars(symbol: string) {
  if (!barCache.has(symbol)) {
    const source = readFileSync(`scripts/output/cache/sina-k-${symbol}.txt`, 'utf8');
    hashes.push(`${symbol}:${createHash('sha256').update(source).digest('hex')}`);
    const list = JSON.parse(source) as { day: string; open: string; close: string }[];
    const byDate = new Map<string, { open: number; previousClose: number }>();
    list.forEach((r, i) => { if (i > 0) byDate.set(r.day.replaceAll('-', ''), { open: +r.open, previousClose: +list[i - 1].close }); });
    barCache.set(symbol, byDate);
  }
  return barCache.get(symbol)!;
}
// 旧生成器对创业/科创/北交ST先套5%，候选、连板数和标签都受污染；
// 在逐日历史重建完成前整组剔除，不仅改归一化后继续使用错误标签。
const contaminated = history.ticks.filter(t => /st/i.test(t.name) && /^(30|688|8|4|92)/.test(t.symbol));
const rows = history.ticks.filter(t => !(/st/i.test(t.name) && /^(30|688|8|4|92)/.test(t.symbol))).flatMap(t => {
  const bar = bars(t.symbol).get(t.date);
  if (!bar) throw new Error(`缺少历史开盘价/昨收：${t.date} ${t.symbol}`);
  const sealedAtAuction = isSealedAtAuction(t.symbol, t.name, bar.open, bar.previousClose);
  if (sealedAtAuction === null) throw new Error('历史价格无效');
  const x = auctionFeatures({
    gapPct: t.gapPct, board: t.board, previousOneWord: t.prevOneWord,
    previousTurnover: t.prevTurnover, floatMarketCapYi: t.floatCap, limitPct: limitUpPct(t.symbol, t.name),
  });
  const legacy = [t.gapPct, Math.min(t.board, 5), +t.prevOneWord, t.prevTurnover,
    t.floatCap && t.floatCap > 0 ? Math.log(t.floatCap) : null, t.prevLimitCount / 10, t.prevBrokenCount / 10, t.indexGapPct];
  // 同一组完整样本比较两个模型；不以次日收益是否存在筛选分类标签。
  if ([...x, ...legacy].some(v => v === null || !Number.isFinite(v))) return [];
  return [{ ...t, x: x as number[], legacy: legacy as number[], y: +t.sealedToday, sealedAtAuction }];
});
const dates = [...new Set(rows.map(r => r.date))].sort();
const cutoff = dates.at(-20)!;
const dev = rows.filter(r => r.date < cutoff);
const holdout = rows.filter(r => r.date >= cutoff);
type Pair = (typeof rows)[number] & { p: number };
const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function auc(rows: Pair[]) {
  const ordered = [...rows].sort((a, b) => a.p - b.p);
  const positives = rows.filter(r => r.y === 1).length;
  if (!positives || positives === rows.length) return null;
  let ranks = 0;
  for (let i = 0; i < ordered.length;) {
    let j = i + 1;
    while (j < ordered.length && ordered[j].p === ordered[i].p) j++;
    for (let k = i; k < j; k++) if (ordered[k].y) ranks += (i + 1 + j) / 2;
    i = j;
  }
  return (ranks - positives * (positives + 1) / 2) / (positives * (rows.length - positives));
}
function summary(rows: Pair[]) {
  return { n: rows.length, predicted: avg(rows.map(r => r.p)), sealed: avg(rows.map(r => r.y)),
    touched: avg(rows.map(r => +r.touchedToday)),
    nextOpenReturn: avg(rows.flatMap(r => r.retNextOpen === null ? [] : [r.retNextOpen])) };
}
function metrics(rows: Pair[], threshold: number) {
  const top3 = [...new Set(rows.map(r => r.date))].flatMap(date => rows.filter(r => r.date === date).sort((a, b) => b.p - a.p).slice(0, 3));
  return { ...summary(rows), brier: avg(rows.map(r => (r.p - r.y) ** 2)), auc: auc(rows),
    qualified: summary(rows.filter(r => r.p >= threshold)),
    watch: summary(rows.filter(r => r.p >= 0.3 && r.p < threshold)),
    low: summary(rows.filter(r => r.p < 0.3)), top3: summary(top3) };
}
const originalDev = walkForward(dev.map(r => ({ ...r, x: r.legacy })));
const newDev = [false, true].flatMap(sealed => walkForward(dev.filter(r => r.sealedAtAuction === sealed)));
const originalFit = fitLogistic(dev.map(r => r.legacy), dev.map(r => r.y));
const originalHoldout = holdout.map(r => ({ ...r, p: predictLogistic(originalFit, r.legacy) }));
const newHoldout = [false, true].flatMap(sealed => {
  const train = dev.filter(r => r.sealedAtAuction === sealed);
  const model = fitLogistic(train.map(r => r.x), train.map(r => r.y));
  return holdout.filter(r => r.sealedAtAuction === sealed).map(r => ({ ...r, p: predictLogistic(model, r.x) }));
});
const development = {
  original: metrics(originalDev.filter(r => !r.sealedAtAuction), 0.55),
  segmented: metrics(newDev.filter(r => !r.sealedAtAuction), AUCTION_POLICY.qualifiedProbability),
};
const validation = {
  original: metrics(originalHoldout.filter(r => !r.sealedAtAuction), 0.55),
  segmented: metrics(newHoldout.filter(r => !r.sealedAtAuction), AUCTION_POLICY.qualifiedProbability),
  sealedOriginal: metrics(originalHoldout.filter(r => r.sealedAtAuction), 0.55),
  sealedSegmented: metrics(newHoldout.filter(r => r.sealedAtAuction), AUCTION_POLICY.qualifiedProbability),
};
const metadata = {
  version: 'auction-segmented-v2', from: dates[0], through: dates.at(-1), holdoutFrom: cutoff,
  samples: rows.length, excludedLegacyStSamples: contaminated.length, inputSha256: createHash('sha256').update(raw).digest('hex'),
  pricesSha256: createHash('sha256').update(hashes.sort().join('\n')).digest('hex'),
  policy: AUCTION_POLICY,
};
const report = { metadata, development, validation,
  limitations: ['已整组剔除旧生成器按5%标记的创业/科创/北交ST样本；尚未逐日重建该组。', '历史流通股数/名称来自抓取时点，非逐日复原；除权及历史ST变化可能影响标签。',
    '竞价未涨停不保证实际成交；收益未扣费用滑点。', '未采集历史竞价金额/题材强度，不将其强行用于筛选。',
    '市场家数由日K重建，与线上涨停池口径不同；旧indexGapPct误用了平安银行，新模型均剔除。'],
};
writeFileSync('scripts/output/auction-segmented-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--write')) {
  if (validation.segmented.brier! >= validation.original.brier! || validation.segmented.auc! < validation.original.auc!) {
    throw new Error('留出集未同时改善概率误差和排序，拒绝生成线上参数');
  }
  writeFileSync('docs/auction-model-v2-validation.json', JSON.stringify(report, null, 2) + '\n');
  const models = Object.fromEntries([['unsealed', false], ['sealed', true]].map(([name, sealed]) => {
    const train = rows.filter(r => r.sealedAtAuction === sealed);
    return [name, fitLogistic(train.map(r => r.x), train.map(r => r.y))];
  }));
  writeFileSync('server/auction/model-parameters.ts',
    '// 由 scripts/auction-segmented-model.ts --write 生成；不要手工调权重。\n' +
    `export const MODEL_METADATA = ${JSON.stringify(metadata, null, 2)};\n` +
    `export const SEGMENTED_MODELS = ${JSON.stringify(models, null, 2)};\n`);
}
