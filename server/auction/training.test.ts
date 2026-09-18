import { describe, expect, it } from 'vitest';
import { fitLogistic, predictLogistic, walkForward } from './training.js';

describe('竞价模型离线训练', () => {
  it('只用预测日之前的数据拟合，未来标签变化不影响过去预测', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      date: String(i).padStart(8, '0'), x: [i % 3], y: (i % 3 === 2 ? 1 : 0),
    }));
    const first = walkForward(rows, { minTrainDays: 10, refitEvery: 5 });
    const changed = walkForward(rows.map(r => r.date >= '00000030' ? { ...r, y: 1 - r.y } : r),
      { minTrainDays: 10, refitEvery: 5 });
    expect(first.filter(r => r.date < '00000030')).toEqual(changed.filter(r => r.date < '00000030'));
    expect(first[0].date).toBe('00000010');
    expect(first.every(r => r.trainThrough < r.date)).toBe(true);
  });

  it('处理常数特征及单类别样本，不输出 NaN 或无穷概率', () => {
    const model = fitLogistic([[1, 0], [1, 0], [1, 0]], [0, 0, 0]);
    expect(predictLogistic(model, [1, 0])).toBeGreaterThan(0);
    expect(predictLogistic(model, [1, 0])).toBeLessThan(0.1);
  });

  it('从数据学习方向，预测缺失值时按训练均值代入', () => {
    const model = fitLogistic([[-2], [-1], [1], [2]], [0, 0, 1, 1]);
    expect(predictLogistic(model, [-2])).toBeLessThan(predictLogistic(model, [2]));
    expect(predictLogistic(model, [null])).toBeCloseTo(predictLogistic(model, model.means));
  });
});
