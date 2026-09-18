import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuctionResponse, QuoteMap } from '../types';
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

/** 实时行情：只有 000001 / 000002 有，000003 缺失 */
const quotes: QuoteMap = {
  '000001': {
    symbol: '000001',
    name: '首板样本',
    price: 10.53,
    change: 0.33,
    pct: 3.24,
    turnover: 12.4,
    volumeRatio: 1.8,
    amount: 320_000_000,
    preClose: 10.2,
    updatedAt: '2026-08-19T02:10:00.000Z',
    source: 'tencent',
    status: 'fresh',
  },
  '000002': {
    symbol: '000002',
    name: '三板样本',
    price: 9.51,
    change: -0.29,
    pct: -2.96,
    turnover: 3.2,
    volumeRatio: 0.9,
    amount: 100_000_000,
    preClose: 9.8,
    updatedAt: '2026-08-19T02:10:00.000Z',
    source: 'tencent',
    status: 'fresh',
  },
};

const renderList = (data: AuctionResponse = response, quoteMap: QuoteMap = quotes) =>
  render(
    <AuctionList data={data} quotes={quoteMap} isRefreshing={false} onRefresh={vi.fn()} />,
  );

describe('AuctionList', () => {
  it('marks auction results with probability and sorts by board count first', () => {
    renderList();

    expect(screen.getByRole('heading', { name: '竞价连板候选' })).toBeInTheDocument();
    expect(screen.getByText('固定快照：09:25')).toBeInTheDocument();
    expect(screen.getByText('涨跌幅＝现价相对昨收（盘中实时）')).toBeInTheDocument();
    expect(screen.getByText('9:15 前显示上一交易日竞价')).toBeInTheDocument();
    // 9:15 前服务端会把竞价日回退到上一交易日，卡片照实显示返回的日期
    expect(screen.getByText(/竞价日：2026-08-19 · 昨日：2026-08-18/)).toBeInTheDocument();
    expect(screen.getByText('较高概率 1')).toBeInTheDocument();
    expect(screen.getByText('数据不足 1')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('三板样本');
    expect(rows[1]).toHaveTextContent('低概率');
    expect(rows[2]).toHaveTextContent('二板样本');
    expect(rows[2]).toHaveTextContent('数据不足');
    expect(rows[3]).toHaveTextContent('首板样本');
    expect(rows[3]).toHaveTextContent('较高概率');
    expect(within(rows[3]).getByText('62%')).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent('+2.00%');
    expect(rows[3]).toHaveTextContent('320.00万');
    expect(rows[3]).toHaveTextContent('4.00%');
    expect(rows[3]).toHaveTextContent('竞价溢价 +2.00%（抬高概率）');
    expect(rows[3]).toHaveTextContent('温和');
  });

  it('shows the live change percent in its own column next to the auction gap', () => {
    renderList();

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers.indexOf('涨跌幅')).toBe(headers.indexOf('竞价涨幅') + 1);

    const first = screen.getByRole('row', { name: /首板样本/ });
    const rise = within(first).getByText('+3.24%');
    expect(rise).toHaveClass('value--rise');

    const second = screen.getByRole('row', { name: /三板样本/ });
    const fall = within(second).getByText('-2.96%');
    expect(fall).toHaveClass('value--fall');
  });

  it('keeps the change column neutral when the quote is missing', () => {
    renderList();

    // 000003 没有行情，只能给「—」，且不能染成红/绿
    const missing = screen.getByRole('row', { name: /二板样本/ });
    const cell = within(missing).getByTitle('暂无行情');
    expect(cell).toHaveTextContent('—');
    expect(cell).toHaveClass('value--neutral');
  });

  it('marks a stale quote so the number is not mistaken for the live one', () => {
    renderList(response, {
      ...quotes,
      '000001': { ...quotes['000001']!, status: 'stale' },
    });

    const cell = within(screen.getByRole('row', { name: /首板样本/ })).getByTitle(
      '行情已过期，显示上一轮',
    );
    expect(cell).toHaveTextContent('+3.24%');
  });

  it('wraps 研判依据 text in its own clamp box instead of clamping the table cell', () => {
    renderList();

    const cell = screen.getByRole('row', { name: /首板样本/ }).querySelector('.auction-list__reasons');
    expect(cell?.tagName).toBe('TD');
    expect(cell?.firstElementChild).toHaveClass('auction-list__reasons-text');
    expect(cell).toHaveTextContent('竞价溢价 +2.00%（抬高概率）');
  });

  it('filters the table when a summary chip is clicked', async () => {
    const user = userEvent.setup();
    renderList();

    const rowCount = (): number => screen.getAllByRole('row').length;
    expect(rowCount()).toBe(4);

    // 三个候选：2 板低概率、数据不足、首板较高概率
    await user.click(screen.getByRole('button', { name: '较高概率 1' }));
    expect(screen.getByRole('button', { name: '较高概率 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowCount()).toBe(2);
    expect(screen.getByRole('row', { name: /首板样本/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /三板样本/ })).not.toBeInTheDocument();
    expect(screen.getByText(/已筛选 「较高概率」，共 1 只/)).toBeInTheDocument();

    // 再点一次取消筛选
    await user.click(screen.getByRole('button', { name: '较高概率 1' }));
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
    renderList(withSealed);

    // 000001 竞价已封板、000003 数据不足，都不能算「可买」
    await user.click(screen.getByRole('button', { name: '竞价未涨停 1' }));

    expect(screen.getByRole('button', { name: '竞价未涨停 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('row', { name: /首板样本/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /二板样本/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /三板样本/ })).toBeInTheDocument();
    expect(screen.getByText(/已筛选 竞价未涨停，共 1 只/)).toBeInTheDocument();
  });

  it('explains an empty result instead of showing a blank table', async () => {
    const user = userEvent.setup();
    const onlyQualified = {
      ...response,
      items: response.items.filter((item) => item.result === 'qualified'),
    };
    renderList(onlyQualified);

    await user.click(screen.getByRole('button', { name: '观察 0' }));

    expect(screen.getByText('当前筛选条件下没有候选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示全部 1 只' })).toBeInTheDocument();
  });

  it('shows stale and unavailable states without pretending the snapshot is current', () => {
    const { rerender } = render(
      <AuctionList
        data={{ ...response, status: 'stale', error: '竞价刷新失败' }}
        quotes={quotes}
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
        quotes={{}}
        isRefreshing
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('竞价数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('暂无竞价候选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  });
});
