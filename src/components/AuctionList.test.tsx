import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuctionResponse } from '../types';
import { AuctionList } from './AuctionList';

const response: AuctionResponse = {
  tradeDate: '20260819',
  previousTradeDate: '20260818',
  snapshotTime: '09:25:00',
  items: [
    {
      symbol: '000001',
      name: '首板样本',
      boardCount: 1,
      firstSealTime: '09:30:00',
      lastSealTime: '09:30:00',
      breakCount: 0,
      previousAmount: 80_000_000,
      sealAmount: 8_000_000,
      floatMarketCap: 800_000_000,
      auctionPrice: 10.2,
      auctionPct: 2,
      auctionAmount: 3_200_000,
      auctionRatio: 4,
      auctionPremium: 'mild',
      turnoverRate: 12.4,
      limitUpProbability: 0.62,
      sealedAtAuction: false,
      probabilityMissing: 0,
      result: 'qualified',
      reasons: ['竞价溢价 +2.00%（抬高概率）', '昨日封板稳定，未炸板'],
    },
    {
      symbol: '000002',
      name: '三板样本',
      boardCount: 3,
      firstSealTime: '10:20:00',
      lastSealTime: '14:20:00',
      breakCount: 2,
      previousAmount: 200_000_000,
      sealAmount: 2_000_000,
      floatMarketCap: 2_000_000_000,
      auctionPrice: 9.8,
      auctionPct: -2,
      auctionAmount: 1_000_000,
      auctionRatio: 0.5,
      auctionPremium: 'discount',
      turnoverRate: 3.2,
      limitUpProbability: 0.07,
      sealedAtAuction: false,
      probabilityMissing: 0,
      result: 'unqualified',
      reasons: ['竞价溢价 -2.00%（压低概率）', '昨日存在封板分歧'],
    },
    {
      symbol: '000003',
      name: '二板样本',
      boardCount: 2,
      firstSealTime: '09:50:00',
      lastSealTime: '13:30:00',
      breakCount: 1,
      previousAmount: 120_000_000,
      sealAmount: 5_000_000,
      floatMarketCap: 1_000_000_000,
      auctionPrice: null,
      auctionPct: null,
      auctionAmount: null,
      auctionRatio: null,
      auctionPremium: null,
      turnoverRate: null,
      limitUpProbability: null,
      sealedAtAuction: null,
      probabilityMissing: 0,
      result: 'insufficient',
      reasons: ['缺少 09:25 竞价成交数据'],
    },
  ],
  fetchedAt: '2026-08-19T01:25:10.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('AuctionList', () => {
  it('marks auction results with probability and sorts by board count first', () => {
    render(<AuctionList data={response} isRefreshing={false} onRefresh={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '竞价连板候选' })).toBeInTheDocument();
    expect(screen.getByText('固定快照：09:25')).toBeInTheDocument();
    expect(screen.getByText('合格 1')).toBeInTheDocument();
    expect(screen.getByText('数据不足 1')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('三板样本');
    expect(rows[1]).toHaveTextContent('不合格');
    expect(rows[2]).toHaveTextContent('二板样本');
    expect(rows[2]).toHaveTextContent('数据不足');
    expect(rows[3]).toHaveTextContent('首板样本');
    expect(rows[3]).toHaveTextContent('合格');
    expect(within(rows[3]).getByText('62%')).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent('+2.00%');
    expect(rows[3]).toHaveTextContent('320.00万');
    expect(rows[3]).toHaveTextContent('4.00%');
    expect(rows[3]).toHaveTextContent('竞价溢价 +2.00%（抬高概率）');
    expect(rows[3]).toHaveTextContent('温和');
  });

  it('wraps 研判依据 text in its own clamp box instead of clamping the table cell', () => {
    render(<AuctionList data={response} isRefreshing={false} onRefresh={vi.fn()} />);

    const cell = screen.getByRole('row', { name: /首板样本/ }).querySelector('.auction-list__reasons');
    expect(cell?.tagName).toBe('TD');
    expect(cell?.firstElementChild).toHaveClass('auction-list__reasons-text');
    expect(cell).toHaveTextContent('竞价溢价 +2.00%（抬高概率）');
  });

  it('filters the table when a summary chip is clicked', async () => {
    const user = userEvent.setup();
    render(<AuctionList data={response} isRefreshing={false} onRefresh={vi.fn()} />);

    const rowCount = (): number => screen.getAllByRole('row').length;
    expect(rowCount()).toBe(4);

    // 三个候选：2 板不合格、数据不足、首板合格
    await user.click(screen.getByRole('button', { name: '合格 1' }));
    expect(screen.getByRole('button', { name: '合格 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowCount()).toBe(2);
    expect(screen.getByRole('row', { name: /首板样本/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /三板样本/ })).not.toBeInTheDocument();
    expect(screen.getByText(/已筛选 「合格」，共 1 只/)).toBeInTheDocument();

    // 再点一次取消筛选
    await user.click(screen.getByRole('button', { name: '合格 1' }));
    expect(rowCount()).toBe(4);

    // 数据不足同样可以筛
    await user.click(screen.getByRole('button', { name: '数据不足 1' }));
    expect(rowCount()).toBe(2);
    expect(screen.getByRole('row', { name: /二板样本/ })).toBeInTheDocument();

    // 全部按钮恢复
    await user.click(screen.getByRole('button', { name: '全部 3' }));
    expect(rowCount()).toBe(4);
    expect(screen.queryByText(/已筛选/)).not.toBeInTheDocument();
  });

  it('keeps only buyable candidates when the buyable chip is on', async () => {
    const user = userEvent.setup();
    const withSealed = {
      ...response,
      items: response.items.map((item) =>
        item.symbol === '000001' ? { ...item, sealedAtAuction: true } : item,
      ),
    };
    render(<AuctionList data={withSealed} isRefreshing={false} onRefresh={vi.fn()} />);

    // 000001 竞价已封板、000003 数据不足，都不能算「可买」
    await user.click(screen.getByRole('button', { name: '只看可买 1' }));

    expect(screen.getByRole('button', { name: '只看可买 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('row', { name: /首板样本/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /二板样本/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /三板样本/ })).toBeInTheDocument();
    expect(screen.getByText(/已筛选 只看可买，共 1 只/)).toBeInTheDocument();
  });

  it('explains an empty result instead of showing a blank table', async () => {
    const user = userEvent.setup();
    const onlyQualified = {
      ...response,
      items: response.items.filter((item) => item.result === 'qualified'),
    };
    render(<AuctionList data={onlyQualified} isRefreshing={false} onRefresh={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '观察 0' }));

    expect(screen.getByText('当前筛选条件下没有候选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示全部 1 只' })).toBeInTheDocument();
  });

  it('shows stale and unavailable states without pretending the snapshot is current', () => {
    const { rerender } = render(
      <AuctionList
        data={{ ...response, status: 'stale', error: '竞价刷新失败' }}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('当前显示上一轮竞价快照')).toBeInTheDocument();

    rerender(
      <AuctionList
        data={{
          ...response,
          tradeDate: null,
          previousTradeDate: null,
          items: [],
          status: 'unavailable',
          error: '竞价上游数据获取失败',
        }}
        isRefreshing
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('竞价数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('暂无竞价候选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  });
});
