import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SprintLimitUpItem, SprintLimitUpResponse } from '../types';
import { SprintLimitUpRail } from './SprintLimitUpRail';

const item = (
  overrides: Partial<SprintLimitUpItem> & Pick<SprintLimitUpItem, 'symbol' | 'name'>,
): SprintLimitUpItem => ({
  price: 12.34,
  pct: 9.87,
  speed: 2.35,
  boardCount: 0,
  probability: null,
  reason: '60日新高',
  ...overrides,
});

const response: SprintLimitUpResponse = {
  tradeDate: '20260918',
  items: [
    item({ symbol: '002902', name: '铭普光磁', boardCount: 2, reason: '光模块' }),
    item({ symbol: '603051', name: '鹿山新材', pct: 8.61, speed: 0.39, price: 25.85 }),
  ],
  fetchedAt: '2026-09-18T03:00:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('SprintLimitUpRail', () => {
  it('把整页的六列压进三行：涨幅大字 + 最新价，涨速与涨停原因在左列第二行', () => {
    render(
      <SprintLimitUpRail
        data={response}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onOpenAll={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '冲刺涨停' })).toBeInTheDocument();
    // 卡片头的数量是整池条数，不是侧栏截断后的 7 条
    expect(screen.getByText('2')).toBeInTheDocument();

    expect(screen.getByText('铭普光磁')).toBeInTheDocument();
    expect(screen.getByText('+9.87%')).toBeInTheDocument();
    expect(screen.getByText('12.34')).toBeInTheDocument();
    expect(screen.getByText('涨速 +2.35% · 光模块')).toBeInTheDocument();

    // 涨停次数有值才挂标签：冲刺池里 0 次是常态，写成「0 次」只是噪声
    expect(screen.getByText('2 次')).toBeInTheDocument();
    expect(screen.queryByText('0 次')).not.toBeInTheDocument();

    expect(screen.getByText('鹿山新材')).toBeInTheDocument();
    expect(screen.getByText('涨速 +0.39% · 60日新高')).toBeInTheDocument();
  });

  it('默认只列前 7 只，页脚的「查看全部」交回调用方', async () => {
    const user = userEvent.setup();
    const onOpenAll = vi.fn();
    const manyItems = Array.from({ length: 9 }, (_, index) =>
      item({ symbol: `00001${index}`, name: `样本${index}` }),
    );

    render(
      <SprintLimitUpRail
        data={{ ...response, items: manyItems }}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onOpenAll={onOpenAll}
      />,
    );

    expect(screen.getByText('样本0')).toBeInTheDocument();
    expect(screen.getByText('样本6')).toBeInTheDocument();
    expect(screen.queryByText('样本7')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看全部 9 只 →' }));

    expect(onOpenAll).toHaveBeenCalledTimes(1);
  });

  it('卡片头可以在原地刷新，刷新中禁用按钮', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    const { rerender } = render(
      <SprintLimitUpRail
        data={response}
        isRefreshing={false}
        onRefresh={onRefresh}
        onOpenAll={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '刷新冲刺涨停' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <SprintLimitUpRail
        data={response}
        isRefreshing
        onRefresh={onRefresh}
        onOpenAll={vi.fn()}
      />,
    );

    const refreshButton = screen.getByRole('button', { name: '刷新冲刺涨停' });

    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveTextContent('刷新中…');
  });

  it('空态：首次加载写「正在拉取」，拿不到数据时写不可用并带上原因', () => {
    const empty = { ...response, items: [], tradeDate: null, status: 'unavailable' as const };

    const { rerender } = render(
      <SprintLimitUpRail
        data={empty}
        isRefreshing
        onRefresh={vi.fn()}
        onOpenAll={vi.fn()}
      />,
    );

    expect(screen.getByText('正在拉取冲刺涨停…')).toBeInTheDocument();

    rerender(
      <SprintLimitUpRail
        data={{ ...empty, error: '冲刺涨停刷新失败' }}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onOpenAll={vi.fn()}
      />,
    );

    expect(screen.getByText('冲刺涨停数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('冲刺涨停刷新失败')).toBeInTheDocument();
    // 空态里没有列表，就不该再挂一个「查看全部 0 只」
    expect(screen.queryByRole('button', { name: /查看全部/ })).not.toBeInTheDocument();
  });
});
