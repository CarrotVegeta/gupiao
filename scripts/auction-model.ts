/**
 * 竞价涨停概率模型
 *
 * 目标：给定「上一交易日涨停池」中的一只票，预测它**今天收盘仍然涨停**的概率。
 * 特征全部来自 09:25 竞价时刻可得的信息（竞价溢价 + 昨日涨停池特征 + 大盘竞价缺口）。
 *
 * 方法：L2 正则逻辑回归 + 走前验证（按交易日滚动，只用历史数据拟合），
 *       输出概率校准表（预测 30% 的那批票，实际是不是 30% 涨停）。
 *
 * 用法：npx tsx scripts/auction-model.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Tick = {
  date: string;
  symbol: string;
  name: string;
  board: number;
  prevGapPct: number;
  prevOneWord: boolean;
  prevTurnover: number | null;
  prevShrink: number | null;
  floatCap: number | null;
  gapPct: number;
  oneWord: boolean;
  prevLimitCount: number;
  prevBrokenCount: number;
  prevMultiBoard: number;
  indexGapPct: number | null;
  indexPrevPct: number | null;
  limitCount10: number;
  ztSpan: number;
  pct20: number | null;
  distHigh60: number | null;
  prevAmplitude: number | null;
  prevBrokenRatio: number | null;
  index5dPct: number | null;
  index20dPct: number | null;
  sealedToday: boolean;
  touchedToday: boolean;
  retNextOpen: number | null;
};

const data = JSON.parse(
  readFileSync(path.join(process.cwd(), 'scripts/output/limit-up-history.json'), 'utf8'),
) as { dates: string[]; ticks: Tick[] };

type FeatureSpec = {
  key: string;
  label: string;
  value: (tick: Tick) => number | null;
};

/** 运行时可得的特征（服务器不需要额外抓数据） */
const RUNTIME_FEATURES: FeatureSpec[] = [
  { key: 'gapPct', label: '今日竞价溢价%', value: (tick) => tick.gapPct },
  { key: 'board', label: '昨日连板数', value: (tick) => Math.min(tick.board, 5) },
  { key: 'prevOneWord', label: '昨日一字板', value: (tick) => (tick.prevOneWord ? 1 : 0) },
  { key: 'prevTurnover', label: '昨日换手率%', value: (tick) => tick.prevTurnover },
  { key: 'logFloatCap', label: '流通市值log', value: (tick) => (tick.floatCap ? Math.log(tick.floatCap) : null) },
  { key: 'prevLimitCount', label: '昨日涨停家数', value: (tick) => tick.prevLimitCount / 10 },
  { key: 'prevBrokenCount', label: '昨日炸板家数', value: (tick) => tick.prevBrokenCount / 10 },
  { key: 'indexGapPct', label: '大盘竞价缺口%', value: (tick) => tick.indexGapPct },
];

/** 需要额外抓昨日K线才能得到的特征 */
const EXTRA_FEATURES: FeatureSpec[] = [
  { key: 'prevGapPct', label: '昨日竞价溢价%', value: (tick) => tick.prevGapPct },
  { key: 'prevShrink', label: '昨日量比(缩量)', value: (tick) => tick.prevShrink },
];

/** 运行时仍然只多抓 1 个指数K线就能拿到的特征 */
const RUNTIME_FEATURES_V2: FeatureSpec[] = [
  ...RUNTIME_FEATURES,
  { key: 'limitCount10', label: '近10日涨停次数', value: (tick) => tick.limitCount10 },
  { key: 'ztSpan', label: '涨停簇跨度(天)', value: (tick) => tick.ztSpan },
  { key: 'prevBrokenRatio', label: '昨日炸板率%', value: (tick) => tick.prevBrokenRatio },
  { key: 'index5dPct', label: '大盘5日涨幅%', value: (tick) => tick.index5dPct },
  { key: 'index20dPct', label: '大盘20日涨幅%', value: (tick) => tick.index20dPct },
];

/** 需要逐只抓历史K线才能得到的「位置」特征，用来估计上限 */
const POSITION_FEATURES: FeatureSpec[] = [
  { key: 'pct20', label: '20日累计涨幅%', value: (tick) => tick.pct20 },
  { key: 'distHigh60', label: '距60日高点%', value: (tick) => tick.distHigh60 },
  { key: 'prevAmplitude', label: '昨日振幅%', value: (tick) => tick.prevAmplitude },
];

/** 非线性扩展：竞价溢价在 7% 以上是质变，线性项抓不住 */
const NONLINEAR_FEATURES: FeatureSpec[] = [
  { key: 'gapNearLimit', label: '竞价接近涨停', value: (tick) => (tick.gapPct >= 9.8 ? 1 : 0) },
  { key: 'gapHigh', label: '竞价>=7%', value: (tick) => (tick.gapPct >= 7 ? 1 : 0) },
  { key: 'gapNegative', label: '竞价低开', value: (tick) => (tick.gapPct < 0 ? 1 : 0) },
  { key: 'gapXBoard', label: '竞价x连板', value: (tick) => tick.gapPct * Math.min(tick.board, 5) },
];

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

type Model = {
  weights: number[];
  bias: number;
  means: number[];
  stds: number[];
  keys: string[];
};

const buildMatrix = (
  rows: Tick[],
  specs: FeatureSpec[],
): { x: number[][]; y: number[]; kept: Tick[] } => {
  const x: number[][] = [];
  const y: number[] = [];
  const kept: Tick[] = [];

  for (const row of rows) {
    const values = specs.map((spec) => spec.value(row));
    if (values.some((value) => value === null || !Number.isFinite(value))) continue;
    x.push(values as number[]);
    y.push(row.sealedToday ? 1 : 0);
    kept.push(row);
  }

  return { x, y, kept };
};

const fit = (
  x: number[][],
  y: number[],
  keys: string[],
  options: { lambda: number; iterations: number; rate: number },
): Model => {
  const dimension = keys.length;
  const means = new Array(dimension).fill(0);
  const stds = new Array(dimension).fill(1);

  for (let j = 0; j < dimension; j += 1) {
    const column = x.map((row) => row[j]);
    const mean = column.reduce((a, b) => a + b, 0) / column.length;
    const variance = column.reduce((total, value) => total + (value - mean) ** 2, 0) / column.length;
    means[j] = mean;
    stds[j] = Math.sqrt(variance) || 1;
  }

  const z = x.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
  const weights = new Array(dimension).fill(0);
  let bias = Math.log(y.reduce((a, b) => a + b, 0) / (y.length - y.reduce((a, b) => a + b, 0)) || 1);

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const gradient = new Array(dimension).fill(0);
    let biasGradient = 0;

    for (let i = 0; i < z.length; i += 1) {
      let score = bias;
      for (let j = 0; j < dimension; j += 1) score += weights[j] * z[i][j];
      const error = sigmoid(score) - y[i];
      for (let j = 0; j < dimension; j += 1) gradient[j] += error * z[i][j];
      biasGradient += error;
    }

    for (let j = 0; j < dimension; j += 1) {
      weights[j] -= options.rate * (gradient[j] / z.length + options.lambda * weights[j]);
    }
    bias -= options.rate * (biasGradient / z.length);
  }

  return { weights, bias, means, stds, keys };
};

const predict = (model: Model, specs: FeatureSpec[], row: Tick): number | null => {
  const values = specs.map((spec) => spec.value(row));
  if (values.some((value) => value === null || !Number.isFinite(value))) return null;
  let score = model.bias;
  for (let j = 0; j < model.keys.length; j += 1) {
    score += model.weights[j] * (((values[j] as number) - model.means[j]) / model.stds[j]);
  }
  return sigmoid(score);
};

const auc = (pairs: Array<{ p: number; y: number }>): number => {
  const positives = pairs.filter((pair) => pair.y === 1).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  const sorted = [...pairs].sort((a, b) => a.p - b.p);
  let rankSum = 0;
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1].p === sorted[index].p) end += 1;
    const averageRank = (index + end) / 2 + 1;
    for (let k = index; k <= end; k += 1) {
      if (sorted[k].y === 1) rankSum += averageRank;
    }
    index = end + 1;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
};

const brier = (pairs: Array<{ p: number; y: number }>): number =>
  pairs.reduce((total, pair) => total + (pair.p - pair.y) ** 2, 0) / pairs.length;

const evaluate = (
  name: string,
  specs: FeatureSpec[],
  ticks: Tick[],
  options: { minTrainDays: number; refitEvery: number } = { minTrainDays: 25, refitEvery: 5 },
): { model: Model; outOfSample: Array<{ p: number; y: number; tick: Tick }> } => {
  const dates = [...new Set(ticks.map((tick) => tick.date))].sort();
  const outOfSample: Array<{ p: number; y: number; tick: Tick }> = [];
  let model: Model | null = null;

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    if (index >= options.minTrainDays && (index - options.minTrainDays) % options.refitEvery === 0) {
      const trainRows = ticks.filter((tick) => tick.date < date);
      const { x, y } = buildMatrix(trainRows, specs);
      model = fit(x, y, specs.map((spec) => spec.key), { lambda: 0.02, iterations: 1200, rate: 0.6 });
    }
    if (model === null) continue;

    for (const tick of ticks.filter((row) => row.date === date)) {
      const probability = predict(model, specs, tick);
      if (probability === null) continue;
      outOfSample.push({ p: probability, y: tick.sealedToday ? 1 : 0, tick });
    }
  }

  const full = buildMatrix(ticks, specs);
  const finalModel = fit(full.x, full.y, specs.map((spec) => spec.key), {
    lambda: 0.02,
    iterations: 2500,
    rate: 0.6,
  });

  console.log(`\n=== ${name} ===`);
  console.log(
    `  样本 ${full.x.length} / ${ticks.length}（特征缺失剔除），走前验证 ${outOfSample.length} 条`,
  );
  console.log(`  基准涨停率 ${((full.y.reduce((a, b) => a + b, 0) / full.y.length) * 100).toFixed(1)}%`);
  console.log(`  AUC ${auc(outOfSample).toFixed(4)} | Brier ${brier(outOfSample).toFixed(4)}`);

  console.log('  校准表（预测概率区间 → 实际涨停率）：');
  const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.01];
  for (let index = 0; index < bins.length - 1; index += 1) {
    const subset = outOfSample.filter((pair) => pair.p >= bins[index] && pair.p < bins[index + 1]);
    if (subset.length === 0) continue;
    const actual = subset.filter((pair) => pair.y === 1).length / subset.length;
    console.log(
      `    ${(bins[index] * 100).toFixed(0).padStart(3)}~${(bins[index + 1] * 100).toFixed(0).padStart(3)}%  n=${String(subset.length).padStart(4)}  预测均值 ${(subset.reduce((total, pair) => total + pair.p, 0) / subset.length * 100).toFixed(1).padStart(5)}%  实际 ${(actual * 100).toFixed(1).padStart(5)}%`,
    );
  }

  console.log('  系数（标准化后，log-odds）：');
  finalModel.keys.forEach((key, index) => {
    console.log(`    ${key.padEnd(16)} ${finalModel.weights[index].toFixed(4).padStart(9)}`);
  });
  console.log(`    ${'bias'.padEnd(16)} ${finalModel.bias.toFixed(4).padStart(9)}`);
  console.log(
    `  标准化参数 means=[${finalModel.means.map((value) => value.toFixed(4)).join(', ')}]`,
  );
  console.log(`             stds=[${finalModel.stds.map((value) => value.toFixed(4)).join(', ')}]`);

  // 概率分层的实际表现（看钱，不只看概率）
  const sorted = [...outOfSample].sort((a, b) => b.p - a.p);
  for (const share of [0.1, 0.2, 0.3, 0.5]) {
    const count = Math.floor(sorted.length * share);
    const top = sorted.slice(0, count);
    const withReturn = top.filter((pair) => pair.tick.retNextOpen !== null);
    const meanReturn =
      withReturn.reduce((total, pair) => total + (pair.tick.retNextOpen as number), 0) /
      (withReturn.length || 1);
    const hit = top.filter((pair) => pair.y === 1).length / (top.length || 1);
    console.log(
      `  概率前 ${(share * 100).toFixed(0)}%：n=${count} 实际涨停率 ${(hit * 100).toFixed(1)}%，次日开盘卖出平均收益 ${meanReturn.toFixed(2)}%`,
    );
  }

  return { model: finalModel, outOfSample };
};

const ticks = data.ticks.filter((tick) => tick.retNextOpen !== null);
const runtime = evaluate('模型 B：当前线上特征（8 项）', RUNTIME_FEATURES, ticks);
const runtimeV2 = evaluate('模型 C：+涨停历史/情绪/大盘趋势（仍只多抓 1 个指数K线）', RUNTIME_FEATURES_V2, ticks);
const nonlinear = evaluate('模型 D：C + 非线性项', [...RUNTIME_FEATURES_V2, ...NONLINEAR_FEATURES], ticks);
const full = evaluate('模型 E：D + 位置特征（需逐只抓K线，仅作上限参考）', [
  ...RUNTIME_FEATURES_V2,
  ...NONLINEAR_FEATURES,
  ...POSITION_FEATURES,
], ticks);
const extended = evaluate('模型 A：旧版 + 昨日K线特征', [...RUNTIME_FEATURES, ...EXTRA_FEATURES], ticks);

// 保存走前验证的样本外预测，供收益/卖出规则分析使用（避免样本内自欺）
writeFileSync(
  path.join(process.cwd(), 'scripts/output', 'auction-model-oos.json'),
  JSON.stringify(
    runtime.outOfSample.map((pair) => ({
      date: pair.tick.date,
      symbol: pair.tick.symbol,
      p: Number(pair.p.toFixed(4)),
      y: pair.y,
      gapPct: pair.tick.gapPct,
      board: pair.tick.board,
      prevOneWord: pair.tick.prevOneWord,
      prevTurnover: pair.tick.prevTurnover,
      floatCap: pair.tick.floatCap,
      prevLimitCount: pair.tick.prevLimitCount,
      prevBrokenCount: pair.tick.prevBrokenCount,
      indexGapPct: pair.tick.indexGapPct,
      sealed: pair.tick.sealedToday,
      touched: pair.tick.touchedToday,
      retSameDay: pair.tick.retSameDay,
      retNextOpen: pair.tick.retNextOpen,
      retNextClose: pair.tick.retNextClose,
      retSealHold:
        pair.tick.sealedToday && pair.tick.retNextOpen !== null
          ? pair.tick.retNextOpen
          : pair.tick.retSameDay,
      mfe: pair.tick.mfe,
      mae: pair.tick.mae,
    })),
    null,
    2,
  ),
  'utf8',
);

writeFileSync(
  path.join(process.cwd(), 'scripts/output', 'auction-model.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      window: { from: data.dates[0], to: data.dates.at(-1), ticks: ticks.length },
      aucRuntime: auc(runtime.outOfSample),
      aucRuntimeV2: auc(runtimeV2.outOfSample),
      aucNonlinear: auc(nonlinear.outOfSample),
      aucFull: auc(full.outOfSample),
      brierRuntime: brier(runtime.outOfSample),
      brierRuntimeV2: brier(runtimeV2.outOfSample),
      brierNonlinear: brier(nonlinear.outOfSample),
      brierFull: brier(full.outOfSample),
      models: {
        runtime: runtime.model,
        runtimeV2: runtimeV2.model,
        nonlinear: nonlinear.model,
        full: full.model,
      },
    },
    null,
    2,
  ),
  'utf8',
);
console.log('\n模型参数已写入 scripts/output/auction-model.json');
