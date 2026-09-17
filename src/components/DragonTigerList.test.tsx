import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DragonTigerResponse } from '../types';
import { DragonTigerList } from './DragonTigerList';

const response: DragonTigerResponse = {
  tradeDate: '20260819',
  items: [
    {
      symbol: '000002',
      name: '万科A',
      closePrice: 8.88,
      changePct: -2.2,
      reason: '日跌幅偏离值达到7%的前5只证券',
      buyAmount: 12_345_678,
      sellAmount: 23_456_789,
      netAmount: -111_111_101,
    },
    {
      symbol: '600000',
      name: '浦发银行',
      closePrice: 12.34,
      changePct: 5.67,
      reason: '日涨幅偏离值达到7%的前5只证券',
      buyAmount: 234_567_890,
      sellAmount: 123_456_789,
      netAmount: 111_111_101,
    },
  ],
  fetchedAt: '2026-08-19T07:35:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('DragonTigerList', () => {
  it('renders the daily billboard columns and sorts by net buy amount descending', () => {
    render(<DragonTigerList data={response} isRefreshing={false} onRefresh={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '龙虎榜' })).toBeInTheDocument();
    expect(screen.getByText('2026-08-19')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' && element.textContent?.replace(/\s/g, '') === '数量：2只',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '上榜原因' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '买入额' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '卖出额' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '净买入额' })).toBeInTheDocument();
    expect(screen.getByText('2.35 亿')).toBeInTheDocument();
    expect(screen.getByText('1.23 亿')).toBeInTheDocument();
    expect(screen.getByText('1.11 亿')).toHaveClass('value--rise');
    expect(screen.getByText('-1.11 亿')).toHaveClass('value--fall');
    expect(screen.getByText('日跌幅偏离值达到7%的前5只证券')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('浦发银行');
    expect(rows[2]).toHaveTextContent('万科A');
  });

  it('shows stale and unavailable states without inventing table rows', () => {
    const { rerender } = render(
      <DragonTigerList
        data={{ ...response, status: 'stale', error: '龙虎榜刷新失败' }}
        isRefreshing
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('数据已过期')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();

    rerender(
      <DragonTigerList
        data={{
          ...response,
          tradeDate: null,
          items: [],
          status: 'unavailable',
          error: '上游不可用',
        }}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('龙虎榜数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('暂无可用龙虎榜数据')).toBeInTheDocument();
    expect(screen.getByText('上游不可用')).toBeInTheDocument();
  });
});
