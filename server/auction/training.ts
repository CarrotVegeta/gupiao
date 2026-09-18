/** 离线训练工具；线上只加载生成的系数，不执行拟合。 */
export type LogisticModel = { weights: number[]; bias: number; means: number[]; stds: number[] };
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export const fitLogistic = (x: number[][], y: number[]): LogisticModel => {
  if (!x.length || x.length !== y.length || x.some(r => r.length !== x[0].length || r.some(v => !Number.isFinite(v))) || y.some(v => v !== 0 && v !== 1)) {
    throw new Error('训练样本必须非空、维度一致且标签为0/1');
  }
  const means = x[0].map((_, j) => x.reduce((s, r) => s + r[j], 0) / x.length);
  const stds = means.map((m, j) => Math.sqrt(x.reduce((s, r) => s + (r[j] - m) ** 2, 0) / x.length) || 1);
  const z = x.map(r => r.map((v, j) => (v - means[j]) / stds[j]));
  const weights = means.map(() => 0);
  const rate = (y.reduce((s, v) => s + v, 0) + 0.5) / (y.length + 1);
  let bias = Math.log(rate / (1 - rate));
  for (let iteration = 0; iteration < 1200; iteration += 1) {
    const gradient = means.map(() => 0);
    let biasGradient = 0;
    for (let i = 0; i < z.length; i += 1) {
      let score = bias;
      for (let j = 0; j < weights.length; j += 1) score += weights[j] * z[i][j];
      const error = sigmoid(score) - y[i];
      biasGradient += error;
      for (let j = 0; j < weights.length; j += 1) gradient[j] += error * z[i][j];
    }
    for (let j = 0; j < weights.length; j += 1) weights[j] -= 0.6 * (gradient[j] / x.length + 0.02 * weights[j]);
    bias -= 0.6 * biasGradient / x.length;
  }
  return { weights, bias, means, stds };
};

export const predictLogistic = (model: LogisticModel, x: (number | null)[]): number =>
  sigmoid(model.bias + model.weights.reduce((s, w, j) => {
    const v = x[j];
    return s + (v === null || !Number.isFinite(v) ? 0 : w * ((v - model.means[j]) / model.stds[j]));
  }, 0));

export type TrainingRow = { date: string; x: number[]; y: number };
export const walkForward = <T extends TrainingRow>(
  rows: T[], options = { minTrainDays: 25, refitEvery: 10 },
): (T & { p: number; trainThrough: string })[] => {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const predictions: (T & { p: number; trainThrough: string })[] = [];
  let model: LogisticModel | null = null;
  let trainThrough = '';
  for (let i = options.minTrainDays; i < dates.length; i += 1) {
    const date = dates[i];
    if ((i - options.minTrainDays) % options.refitEvery === 0) {
      const train = rows.filter(r => r.date < date);
      model = fitLogistic(train.map(r => r.x), train.map(r => r.y));
      trainThrough = dates[i - 1];
    }
    for (const row of rows.filter(r => r.date === date)) {
      predictions.push({ ...row, p: predictLogistic(model!, row.x), trainThrough });
    }
  }
  return predictions;
};
