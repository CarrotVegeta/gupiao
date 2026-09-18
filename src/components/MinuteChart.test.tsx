import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MinuteChart, toMinuteSeriesMap } from './MinuteChart';

const flat = (count: number) => Array.from({ length: count }, () => 10);

describe('MinuteChart', () => {
  it('画一条价格折线，并按末点相对昨收染色', () => {
    const { container } = render(<MinuteChart points={[10, 10.2, 10.5]} preClose={10} />);

    const root = container.querySelector('.minute-chart');
    expect(root).toHaveClass('minute-chart--rise');
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(root?.getAttribute('aria-label')).toContain('+5.00%');
    expect(root?.getAttribute('aria-label')).toContain('高于昨收');
  });

  it('末点低于昨收时染成跌色', () => {
    const { container } = render(<MinuteChart points={[10, 9.8, 9.5]} preClose={10} />);

    const root = container.querySelector('.minute-chart');
    expect(root).toHaveClass('minute-chart--fall');
    expect(root?.getAttribute('aria-label')).toContain('-5.00%');
  });

  it('有昨收时画昨收基准虚线，且基准线是中性色（不参与涨跌染色）', () => {
    const { container } = render(<MinuteChart points={[10, 10.1]} preClose={10} />);

    const baseline = container.querySelector('line.minute-chart__baseline');
    expect(baseline).not.toBeNull();
    // 纵轴中点是昨收：y = 26 / 2
    expect(baseline?.getAttribute('y1')).toBe('13');
    expect(baseline?.getAttribute('y2')).toBe('13');
  });

  it('与昨收持平的行既不染红也不染绿', () => {
    const { container } = render(<MinuteChart points={flat(5)} preClose={10} />);

    const root = container.querySelector('.minute-chart');
    expect(root).toHaveClass('minute-chart--flat');
    expect(root).not.toHaveClass('minute-chart--rise');
    expect(root).not.toHaveClass('minute-chart--fall');
  });

  it('缺少昨收时退化为只画形状：不画基准线、不假装知道涨跌', () => {
    const { container } = render(<MinuteChart points={[10, 10.5, 10.2]} preClose={null} />);

    const root = container.querySelector('.minute-chart');
    expect(container.querySelector('.minute-chart__baseline')).toBeNull();
    expect(root).toHaveClass('minute-chart--flat');
    expect(root?.getAttribute('aria-label')).toContain('缺少昨收价');
  });

  it('没有分时数据时只给占位符，不渲染 SVG', () => {
    const { container } = render(<MinuteChart points={[]} preClose={10} />);

    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('—');
  });

  it('只有一个点时画圆点而不是零长度折线（部分浏览器不渲染空 polyline）', () => {
    const { container } = render(<MinuteChart points={[10.3]} preClose={10} />);

    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('circle.minute-chart__dot')).not.toBeNull();
  });

  it('昨收疑似取错（振幅超出 30% 档位）时降级为中性色并在文案里说明', () => {
    const { container } = render(<MinuteChart points={[10, 25]} preClose={10} />);

    const root = container.querySelector('.minute-chart');
    expect(root).toHaveClass('minute-chart--flat');
    expect(root?.getAttribute('aria-label')).toContain('振幅异常');
  });

  it('把纵轴压在画布内：极端脏数据不会把折线画到框外', () => {
    const { container } = render(<MinuteChart points={[1, 1000, 5]} preClose={10} />);

    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    for (const pair of points.split(' ')) {
      const y = Number(pair.split(',')[1]);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(24);
    }
  });

  it('忽略非法点，不把它们当 0 画成假跳水', () => {
    const { container } = render(
      <MinuteChart points={[10, Number.NaN, 0, -1, 10.4]} preClose={10} />,
    );

    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(container.querySelector('.minute-chart')?.getAttribute('aria-label')).toContain('+4.00%');
  });
});

describe('toMinuteSeriesMap', () => {
  it('按代码建索引', () => {
    const map = toMinuteSeriesMap([
      { symbol: '600519', preClose: 10, points: [10], times: ['0930'] },
      { symbol: '000001', preClose: null, points: [5, 5.1], times: ['0930', '0931'] },
    ]);

    expect(Object.keys(map)).toEqual(['600519', '000001']);
    expect(map['000001'].points).toEqual([5, 5.1]);
  });

  it('空数组给空表，不报错', () => {
    expect(toMinuteSeriesMap([])).toEqual({});
  });
});
