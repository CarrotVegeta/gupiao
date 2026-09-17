import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuctionItem, AuctionResponse } from '../types';
import { AuctionRail } from './AuctionRail';

const item = (overrides: Partial<AuctionItem> & Pick<AuctionItem, 'symbol' | 'name'>): AuctionItem => ({
  boardCount: 2,
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
  reasons: ['竞价溢价 +2.00%（抬高概率）'],
  ...overrides,
});

const response: AuctionResponse = {
  tradeDate: '20260819',
  previousTradeDate: '20260818',
  snapshotTime: '09:25:00',
  items: [
    item({ symbol: '000001', name: '合格样本', limitUpProbability: 0.66, result: 'qualified' }),
    item({
      symbol: '000002',
      name: '观察样本甲',
      limitUpProbability: 0.51,
      auctionPct: 6.02,
      result: 'watch',
    }),
    item({
      symbol: '000003',
      name: '观察样本乙',
      limitUpProbability: 0.36,
      auctionPct: 4.94,
      result: 'watch',
    }),
    item({ symbol: '000004', name: '不合格样本', limitUpProbability: 0.12, result: 'unqualified' }),
    item({
      symbol: '000005',
      name: '数据不足样本',
      limitUpProbability: null,
      auctionPct: null,
      auctionAmount: null,
      auctionRatio: null,
      auctionPremium: null,
      turnoverRate: null,
      sealedAtAuction: null,
      result: 'insufficient',
      reasons: ['缺少 09:25 竞价成交数据'],
    }),
  ],
  fetchedAt: '2026-08-19T01:25:10.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

describe('AuctionRail', () => {
  it('lists the highest probability candidates and lets 合格 / 观察 filter the rail in place', async () => {
    const user = userEvent.setup();

    render(
      <AuctionRail data={response} isRefreshing={false} onRefresh={vi.fn()} onOpenAll={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: '竞价候选' })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    const group = screen.getByRole('group', { name: '按档位筛选竞价候选' });
    const qualifiedChip = within(group).getByRole('button', { name: '合格 1' });
    const watchChip = within(group).getByRole('button', { name: '观察 2' });

    // 默认不筛档：各档位的票混在一起按概率排序
    expect(qualifiedChip).toHaveAttribute('aria-pressed', 'false');
    expect(watchChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('合格样本')).toBeInTheDocument();
    expect(screen.getByText('观察样本甲')).toBeInTheDocument();
    expect(screen.getByText('观察样本乙')).toBeInTheDocument();
    expect(screen.getByText('不合格样本')).toBeInTheDocument();
    expect(screen.queryByText('数据不足样本')).not.toBeInTheDocument();

    await user.click(watchChip);

    expect(watchChip).toHaveAttribute('aria-pressed', 'true');
    expect(qualifiedChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('观察样本甲')).toBeInTheDocument();
    expect(screen.getByText('观察样本乙')).toBeInTheDocument();
    expect(screen.queryByText('合格样本')).not.toBeInTheDocument();
    expect(screen.queryByText('不合格样本')).not.toBeInTheDocument();

    // 再点一次取消筛选，回到全部档位
    await user.click(watchChip);

    expect(watchChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('合格样本')).toBeInTheDocument();
    expect(screen.getByText('不合格样本')).toBeInTheDocument();

    await user.click(qualifiedChip);

    expect(screen.getByText('合格样本')).toBeInTheDocument();
    expect(screen.queryByText('观察样本甲')).not.toBeInTheDocument();
    expect(screen.queryByText('观察样本乙')).not.toBeInTheDocument();
  });

  it('shows a reset hint when the selected tier has no candidates and opens the full list from the footer', async () => {
    const user = userEvent.setup();
    const onOpenAll = vi.fn();
    const qualifiedOnly: AuctionResponse = {
      ...response,
      items: [response.items[0]],
    };

    render(
      <AuctionRail data={qualifiedOnly} isRefreshing={false} onRefresh={vi.fn()} onOpenAll={onOpenAll} />,
    );

    const group = screen.getByRole('group', { name: '按档位筛选竞价候选' });

    await user.click(within(group).getByRole('button', { name: '观察 0' }));

    expect(screen.getByText('「观察」档暂无候选')).toBeInTheDocument();
    expect(screen.queryByText('合格样本')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '显示全部 1 只' }));

    expect(screen.getByText('合格样本')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看全部 1 只 →' }));

    expect(onOpenAll).toHaveBeenCalledTimes(1);
  });

  it('keeps the 7 item cap and shows the unavailable state when the snapshot is missing', () => {
    const manyItems = Array.from({ length: 9 }, (_, index) =>
      item({
        symbol: `00001${index}`,
        name: `样本${index}`,
        limitUpProbability: 0.9 - index * 0.05,
        result: index === 0 ? 'qualified' : 'watch',
      }),
    );

    const { rerender } = render(
      <AuctionRail
        data={{ ...response, items: manyItems }}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onOpenAll={vi.fn()}
      />,
    );

    expect(screen.getByText('样本0')).toBeInTheDocument();
    expect(screen.getByText('样本6')).toBeInTheDocument();
    expect(screen.queryByText('样本7')).not.toBeInTheDocument();

    rerender(
      <AuctionRail
        data={{
          ...response,
          items: [],
          tradeDate: null,
          previousTradeDate: null,
          status: 'unavailable',
          error: '竞价刷新失败',
        }}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onOpenAll={vi.fn()}
      />,
    );

    expect(screen.getByText('竞价数据暂不可用')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '按档位筛选竞价候选' })).toBeInTheDocument();
  });
});
