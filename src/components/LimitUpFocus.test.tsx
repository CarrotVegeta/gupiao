import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  LimitUpLadderResponse,
  LimitUpResponse,
  Quote,
  SprintLimitUpResponse,
} from '../types';
import { LimitUpFocus, type LimitUpFocusTab } from './LimitUpFocus';
import { LimitUpComparison } from './LimitUpComparison';

const poolResponse: LimitUpResponse = {
  tradeDate: '20260827',
  items: [
    {
      symbol: '002820',
      name: '涨停池样本',
      price: 12.27,
      pct: 10.04,
      boardCount: 3,
      firstSealTime: '09:25:00',
      lastSealTime: '14:42:10',
      industry: '食品饮料',
      breakCount: 1,
    },
  ],
  fetchedAt: '2026-08-27T07:32:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

const ladderResponse: LimitUpLadderResponse = {
  tradeDate: '20260917',
  previousTradeDate: '20260916',
  items: [
    {
      symbol: '605058',
      name: '澳弘电子',
      price: 28.1,
      pct: 9.99,
      boardCount: 5,
      firstSealTime: '09:25:00',
      lastSealTime: '09:25:00',
      industry: '元件',
      breakCount: 0,
    },
    {
      symbol: '603186',
      name: '华瓷股份',
      price: 21.5,
      pct: 10.02,
      boardCount: 3,
      firstSealTime: '09:31:00',
      lastSealTime: '14:02:00',
      industry: '家居用品',
      breakCount: 1,
    },
  ],
  ladder: [
    {
      boardCount: 5,
      items: [
        {
          symbol: '605058',
          name: '澳弘电子',
          price: 28.1,
          pct: 9.99,
          boardCount: 5,
          firstSealTime: '09:25:00',
          lastSealTime: '09:25:00',
          industry: '元件',
          breakCount: 0,
        },
      ],
    },
    {
      boardCount: 3,
      items: [
        {
          symbol: '603186',
          name: '华瓷股份',
          price: 21.5,
          pct: 10.02,
          boardCount: 3,
          firstSealTime: '09:31:00',
          lastSealTime: '14:02:00',
          industry: '家居用品',
          breakCount: 1,
        },
      ],
    },
  ],
  previousLadder: [
    {
      boardCount: 4,
      items: [
        {
          symbol: '603186',
          name: '华瓷股份',
          price: 19.54,
          pct: 10.02,
          boardCount: 4,
          firstSealTime: '09:31:00',
          lastSealTime: '14:02:00',
          industry: '家居用品',
          breakCount: 1,
        },
      ],
    },
  ],
  comparison: [
    {
      boardCount: 4,
      total: 2,
      carried: [
        { symbol: '603186', name: '华瓷股份', boardCount: 3, pct: 10.02 },
      ],
      fallen: [{ symbol: '600111', name: '断板样本', boardCount: null, pct: 10.02 }],
    },
  ],
  previousCount: 2,
  carriedCount: 1,
  promotionRate: 50,
  previousAvailable: true,
  fetchedAt: '2026-09-17T07:32:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

const quoteFixture = (symbol: string, name: string, pct: number): Quote => ({
  symbol,
  name,
  price: 10,
  change: 1,
  pct,
  turnover: 3.2,
  volumeRatio: 1.1,
  amount: 120_000_000,
  preClose: 9.9,
  updatedAt: '2026-09-17T02:00:00.000Z',
  source: 'tencent',
  status: 'fresh',
});

/** 断板样本昨天涨停（+10.02%），今天 -3.21%：左列要显示今天的，不是昨天那根 */
const comparisonQuotes: Record<string, Quote> = {
  '603186': quoteFixture('603186', '华瓷股份', 10.02),
  '600111': quoteFixture('600111', '断板样本', -3.21),
};

const sprintResponse: SprintLimitUpResponse = {
  tradeDate: '20260827',
  items: [
    {
      symbol: '600000',
      name: '冲刺样本',
      price: 12.34,
      pct: 9.87,
      speed: 2.35,
      boardCount: 2,
      probability: null,
      reason: '60日新高',
    },
  ],
  fetchedAt: '2026-08-27T07:35:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
};

const Harness = ({ initialTab = 'pool' as LimitUpFocusTab }) => {
  const [activeTab, setActiveTab] = useState<LimitUpFocusTab>(initialTab);

  return (
    <LimitUpFocus
      activeTab={activeTab}
      onTabChange={setActiveTab}
      poolData={poolResponse}
      isPoolRefreshing={false}
      onRefreshPool={vi.fn()}
      onAddToWatchlist={vi.fn()}
      watchlistSymbols={new Set<string>()}
      ladderData={ladderResponse}
      isLadderRefreshing={false}
      onRefreshLadder={vi.fn()}
      comparisonQuotes={comparisonQuotes}
      sprintData={sprintResponse}
      isSprintRefreshing={false}
      onRefreshSprint={vi.fn()}
    />
  );
};

describe('LimitUpFocus', () => {
  it('switches between the inner navigation tabs and shows only the selected list', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    expect(screen.getByRole('tab', { name: '涨停池' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(screen.getByText('涨停池样本')).toBeInTheDocument();
    expect(screen.queryByText('冲刺样本')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '冲刺涨停' }));

    expect(screen.getByRole('heading', { name: '冲刺涨停' })).toBeInTheDocument();
    expect(screen.getByText('冲刺样本')).toBeInTheDocument();
    expect(screen.queryByText('涨停池样本')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '股票',
      '涨停次数',
      '涨幅',
      '涨速',
      '最新价',
      '涨停原因',
    ]);
    expect(screen.getByText('+9.87%')).toBeInTheDocument();
    expect(screen.getByText('+2.35%')).toBeInTheDocument();
    expect(screen.getByText('60日新高')).toBeInTheDocument();
  });

  it('renders the four focus tabs in order', () => {
    render(<Harness />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '涨停池',
      '冲刺涨停',
      '今/昨对比',
      '连板天梯',
    ]);
  });

  it('shows the limit-up ladder grouped by board count with the promotion rate', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '连板天梯' }));

    expect(screen.getByRole('tab', { name: '连板天梯' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: '连板天梯' })).toBeInTheDocument();
    expect(screen.getByLabelText('5 板 1 只')).toBeInTheDocument();
    expect(screen.getByLabelText('3 板 1 只')).toBeInTheDocument();
    // 默认全部展开：每一档的票都直接看得见
    expect(screen.getByText('澳弘电子')).toBeInTheDocument();
    expect(screen.getByText('华瓷股份')).toBeInTheDocument();
    // 表头本身就是开关，没有单独的 +/- 按钮
    expect(screen.getByRole('button', { name: '收起5 板' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // 晋级率是「昨日涨停今天再涨停 / 昨日涨停」，不是 0 也不是空
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    // 今日池子 2 只、首板 0 只
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('expands a collapsed ladder tier on demand', async () => {
    const user = userEvent.setup();

    render(<Harness initialTab="ladder" />);

    // 默认展开 → 点表头收起
    await user.click(screen.getByRole('button', { name: '收起3 板' }));

    expect(screen.queryByText('华瓷股份')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开3 板' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // 再点一次又展开
    await user.click(screen.getByRole('button', { name: '展开3 板' }));

    expect(screen.getByText('华瓷股份')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起3 板' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows the day-over-day comparison grouped by yesterday board level', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '今/昨对比' }));

    expect(screen.getByRole('heading', { name: '今/昨对比' })).toBeInTheDocument();

    const levels = document.querySelectorAll('.limit-up-comparison__level');
    expect(levels).toHaveLength(1);

    const level = levels[0];
    // 档头：昨日 4 板 2 只 → 今日 5 板 1 只 · 晋级 50.0%
    expect(screen.getByLabelText('昨日 4 板 2 只')).toBeInTheDocument();
    expect(level.textContent).toContain('今日 5 板 1 只');
    expect(level.textContent).toContain('晋级 50.0%');

    // 一只票只出现一次：晋级的那只在最前面并标红，断板的跟在后面
    const rows = [...level.querySelectorAll<HTMLElement>('.limit-up-comparison__row')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('华瓷股份');
    expect(rows[0].textContent).toContain('+10.02%');
    expect(rows[0]).toHaveClass('limit-up-comparison__row--carried');
    expect(screen.getAllByText('华瓷股份')).toHaveLength(1);

    expect(rows[1].textContent).toContain('断板样本');
    expect(rows[1]).not.toHaveClass('limit-up-comparison__row--carried');
    // 断板那批显示的是今天的涨幅（来自行情 -3.21%），不是池子里昨天那根 +10.02%
    expect(rows[1].textContent).toContain('-3.21%');
    expect(rows[1].textContent).not.toContain('10.02');

    // 昨日没涨停池时的兜底文案不该出现
    expect(screen.queryByText('上一交易日涨停池暂不可用，无法对比。')).not.toBeInTheDocument();
  });

  it('lists every yesterday stock without folding, and shows — when today has no quote yet', () => {
    // 昨日首板动辄几十只：这一版不再折叠，全部列出来
    const fallen = Array.from({ length: 12 }, (_, index) => ({
      symbol: `6000${String(index + 10).padStart(2, '0')}`,
      name: `断板${index + 1}`,
      boardCount: null,
      pct: 10.02,
    }));
    const bigResponse: LimitUpLadderResponse = {
      ...ladderResponse,
      comparison: [{ boardCount: 1, total: 12, carried: [], fallen }],
      previousCount: 12,
      carriedCount: 0,
      promotionRate: 0,
    };

    render(
      <LimitUpComparison
        data={bigResponse}
        isRefreshing={false}
        onRefresh={vi.fn()}
        quotes={{}}
      />,
    );

    expect(screen.getByText('断板1')).toBeInTheDocument();
    expect(screen.getByText('断板12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开全部/ })).not.toBeInTheDocument();

    // 没有行情就显示「—」：池子里的 pct 是它昨天涨停那根，不能拿来冒充今天
    const row = screen.getByText('断板1').closest('li');
    expect(row?.textContent).toContain('—');
    expect(row?.textContent).not.toContain('10.02');

    // 一档全断板：没有任何标红行
    expect(document.querySelectorAll('.limit-up-comparison__row--carried')).toHaveLength(0);
  });

  it('says the comparison is unavailable instead of showing a zero promotion rate', () => {
    render(
      <LimitUpComparison
        data={{
          ...ladderResponse,
          previousTradeDate: null,
          previousLadder: [],
          comparison: [],
          previousCount: 0,
          carriedCount: 0,
          promotionRate: null,
          previousAvailable: false,
        }}
        isRefreshing={false}
        onRefresh={vi.fn()}
        quotes={{}}
      />,
    );

    expect(screen.getByText('上一交易日涨停池暂不可用，无法对比。')).toBeInTheDocument();
    // 今日天梯还在，但不该冒出「0.0%」这种把「没取到」说成「零晋级」的数字
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(document.querySelector('.limit-up-comparison__level')).toBeNull();
  });
});
