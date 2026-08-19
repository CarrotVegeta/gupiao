import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  Holding,
  LimitUpResponse,
  MarketIndex,
  PortfolioSummary,
  Quote,
  QuoteMap,
  StockGroup,
} from '../types';
import { GroupDialog } from './GroupDialog';
import { GroupSidebar } from './GroupSidebar';
import { HoldingForm, type HoldingFormValues } from './HoldingForm';
import { HoldingList } from './HoldingList';
import { LimitUpList } from './LimitUpList';
import { MarketOverview } from './MarketOverview';
import { Overview } from './Overview';
import { PrimaryNav } from './PrimaryNav';
import { Watchlist } from './Watchlist';

const groupsFixture = (): StockGroup[] => [
  {
    id: 'ungrouped',
    name: '未分组',
    isSystem: true,
    createdAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'system-watchlist',
    name: '系统观察',
    isSystem: true,
    createdAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'long-term',
    name: '长期持仓',
    isSystem: false,
    createdAt: '2026-08-18T00:00:00.000Z',
  },
];

const holding = (overrides: Partial<Holding> = {}): Holding => ({
  id: 'h-1',
  symbol: '600519',
  name: '贵州茅台',
  groupId: 'ungrouped',
  openPrice: 10,
  quantity: 100,
  note: '',
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  ...overrides,
});

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  symbol: '600519',
  name: '贵州茅台',
  price: 12,
  change: 2,
  pct: 20,
  turnover: 1.23,
  preClose: 10,
  updatedAt: '2026-08-18T10:30:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  ...overrides,
});

const summaryFixture = (overrides: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  invested: 1000,
  marketValue: 1200,
  profit: 200,
  returnPct: 20,
  hasPartialQuotes: false,
  holdingCount: 1,
  ...overrides,
});

const marketIndicesFixture = (): MarketIndex[] => [
  {
    symbol: '000001',
    name: '上证指数',
    price: 3301.25,
    change: 12.38,
    pct: 0.38,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
  {
    symbol: '399001',
    name: '深证成指',
    price: 10500.88,
    change: -25.12,
    pct: -0.24,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
  {
    symbol: '399006',
    name: '创业板指',
    price: 2100.66,
    change: 8.11,
    pct: 0.39,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
  {
    symbol: '000688',
    name: '科创 50',
    price: 980.42,
    change: -3.55,
    pct: -0.36,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
];

const limitUpResponseFixture = (overrides: Partial<LimitUpResponse> = {}): LimitUpResponse => ({
  tradeDate: '20260819',
  items: [
    {
      symbol: '002820',
      name: '桂发祥',
      price: 12.27,
      pct: 10.04,
      boardCount: 3,
      firstSealTime: '09:25:00',
      lastSealTime: '14:42:10',
      industry: '食品饮料',
      breakCount: 1,
    },
    {
      symbol: '000017',
      name: 'ST中华',
      price: null,
      pct: null,
      boardCount: null,
      firstSealTime: null,
      lastSealTime: null,
      industry: null,
      breakCount: null,
    },
  ],
  fetchedAt: '2026-08-19T07:32:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...overrides,
});

const HoldingFormHarness = ({
  groups,
  initialHolding,
  onSearch,
  onSubmit = vi.fn<(values: HoldingFormValues) => void>(),
}: {
  groups: StockGroup[];
  initialHolding?: Holding;
  onSearch?: (query: string) => Promise<{ symbol: string; name: string }[]>;
  onSubmit?: (values: HoldingFormValues) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        添加股票
      </button>
      {isOpen ? (
        <HoldingForm
          groups={groups}
          initialHolding={initialHolding}
          onSearch={onSearch}
          onSubmit={(values) => {
            onSubmit(values);
            setIsOpen(false);
          }}
          onCancel={() => setIsOpen(false)}
        />
      ) : null}
    </div>
  );
};

const GroupDialogHarness = ({
  onCancel = vi.fn(),
  withDeleteAction = false,
}: {
  onCancel?: () => void;
  withDeleteAction?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        新建分组
      </button>
      {isOpen ? (
        <div>
          <GroupDialog
            existingNames={[]}
            onSubmit={vi.fn()}
            onCancel={() => {
              onCancel();
              setIsOpen(false);
            }}
          >
            {withDeleteAction ? <button type="button">删除分组</button> : null}
          </GroupDialog>
        </div>
      ) : null}
    </div>
  );
};

describe('Task 6 dashboard components', () => {
  it('searches by stock name and submits the selected stock result', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn().mockResolvedValue([{ symbol: '600519', name: '贵州茅台' }]);
    const onSubmit = vi.fn();

    render(<HoldingFormHarness groups={groupsFixture()} onSearch={onSearch} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '贵州茅台');

    const suggestion = await screen.findByRole('option', { name: '贵州茅台 600519' });
    await user.click(suggestion);
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(onSearch).toHaveBeenCalledWith('贵州茅台');
    expect(onSubmit).toHaveBeenCalledWith({
      symbol: '600519',
      name: '贵州茅台',
      groupId: 'ungrouped',
      openPrice: null,
      quantity: null,
      note: '',
    });
  });

  it('submits an observation holding when opening price and quantity are blank', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<HoldingFormHarness groups={groupsFixture()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(onSubmit).toHaveBeenCalledWith({
      symbol: '600519',
      name: '600519',
      groupId: 'ungrouped',
      openPrice: null,
      quantity: null,
      note: '',
    });
  });

  it('shows validation when a holding is submitted with a non-positive opening price', async () => {
    const user = userEvent.setup();

    render(<HoldingFormHarness groups={groupsFixture()} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    await user.type(screen.getByLabelText('开仓价'), '0');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(screen.getByText('请输入大于 0 的开仓价')).toBeInTheDocument();
  });

  it('submits a trimmed symbol and assignable groups only', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<HoldingFormHarness groups={groupsFixture()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));

    expect(screen.queryByRole('option', { name: '全部持仓' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '系统观察' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '未分组' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('股票代码'), ' 600519 ');
    await user.selectOptions(screen.getByLabelText('分组'), '长期持仓');
    await user.type(screen.getByLabelText('开仓价'), '160');
    await user.type(screen.getByLabelText('持有数量'), '100');
    await user.type(screen.getByLabelText('备注'), '观察业绩');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(onSubmit).toHaveBeenCalledWith({
      symbol: '600519',
      name: '600519',
      groupId: 'long-term',
      openPrice: 160,
      quantity: 100,
      note: '观察业绩',
    });
  });

  it('exposes holding dialog semantics, traps focus, and restores focus after Escape', async () => {
    const user = userEvent.setup();

    render(<HoldingFormHarness groups={groupsFixture()} />);
    const trigger = screen.getByRole('button', { name: '添加股票' });

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '添加股票' });
    const symbolInput = screen.getByLabelText('股票代码');
    const saveButton = screen.getByRole('button', { name: '保存股票' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(symbolInput).toHaveFocus();

    saveButton.focus();
    await user.tab();
    expect(symbolInput).toHaveFocus();
    await user.tab({ shift: true });
    expect(saveButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '添加股票' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('prevents case-insensitive duplicate group names', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <GroupDialog
        existingNames={['长期持仓']}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('分组名称'), '长期持仓 ');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    expect(screen.getByText('分组名称不能重复')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('exposes group dialog semantics and closes with Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<GroupDialogHarness onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: '新建分组' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '新建分组' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('分组名称')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps edit-group danger actions inside the active dialog focus cycle', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<GroupDialogHarness onCancel={onCancel} withDeleteAction />);
    await user.click(screen.getByRole('button', { name: '新建分组' }));
    const nameInput = screen.getByLabelText('分组名称');
    const deleteButton = screen.getByRole('button', { name: '删除分组' });

    deleteButton.focus();
    await user.tab();
    expect(nameInput).toHaveFocus();
    await user.tab({ shift: true });
    expect(deleteButton).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders all holdings as the active filter when selectedGroupId is all', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <GroupSidebar
        groups={groupsFixture()}
        holdings={[
          holding(),
          holding({ id: 'h-2', groupId: 'long-term', symbol: '000001', name: '平安银行' }),
        ]}
        selectedGroupId="all"
        onSelect={onSelect}
        onCreate={onCreate}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole('button', { name: '全部持仓' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    expect(screen.queryByRole('button', { name: '编辑分组 长期持仓' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除分组 长期持仓' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '长期持仓' }));
    await user.click(screen.getByRole('button', { name: '新建分组' }));

    expect(onSelect).toHaveBeenCalledWith('long-term');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows group edit and delete actions only for the selected custom group', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <GroupSidebar
        groups={groupsFixture()}
        holdings={[
          holding(),
          holding({ id: 'h-2', groupId: 'long-term', symbol: '000001', name: '平安银行' }),
        ]}
        selectedGroupId="long-term"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole('button', { name: '编辑分组 系统观察' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '编辑分组 长期持仓' }));
    await user.click(screen.getByRole('button', { name: '删除分组 长期持仓' }));

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'long-term', name: '长期持仓' }),
    );
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'long-term', name: '长期持仓' }),
    );
  });

  it('exposes the group navigation as a named region instead of a complementary sidebar landmark', () => {
    render(
      <GroupSidebar
        groups={groupsFixture()}
        holdings={[holding()]}
        selectedGroupId="all"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: '持仓分组' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '持仓分组' })).not.toBeInTheDocument();
  });

  it('shows an edited note on the holding card', () => {
    render(
      <HoldingList
        holdings={[holding({ symbol: '600519', note: '观察业绩' })]}
        quotes={{}}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('观察业绩')).toBeInTheDocument();
  });

  it('renders watchlist cards without position fields', () => {
    render(
      <Watchlist
        holdings={[holding({ openPrice: 10, quantity: 100, note: '先观察' })]}
        quotes={{ '600519': quote() }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByText('开仓价')).not.toBeInTheDocument();
    expect(screen.queryByText('持有数量')).not.toBeInTheDocument();
    expect(screen.queryByText(/持仓收益/)).not.toBeInTheDocument();
    expect(screen.queryByText(/观察项/)).not.toBeInTheDocument();
    expect(screen.getByText('换手')).toBeInTheDocument();
    expect(screen.getByText('最新价')).toBeInTheDocument();
    expect(screen.getByText('先观察')).toBeInTheDocument();
  });

  it('marks a holding without position details as an observation item', () => {
    render(
      <HoldingList
        holdings={[holding({ openPrice: null, quantity: null })]}
        quotes={{ '600519': quote() }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByText('未填写')).toHaveLength(2);
    expect(screen.getByText('观察项：补录开仓价和持有数量后计算收益')).toBeInTheDocument();
  });

  it('shows unavailable and stale quote states in the holding list', () => {
    const quotes: QuoteMap = {
      '000001': quote({
        symbol: '000001',
        name: '平安银行',
        price: 12,
        change: -0.2,
        pct: -1.64,
        turnover: 2.5,
        preClose: 12.2,
        status: 'stale',
      }),
    };

    render(
      <HoldingList
        holdings={[
          holding({ id: 'h-1', symbol: '600519', name: '贵州茅台' }),
          holding({
            id: 'h-2',
            symbol: '000001',
            name: '平安银行',
            openPrice: 10,
            quantity: 100,
          }),
        ]}
        quotes={quotes}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('暂无行情')).toBeInTheDocument();
    expect(screen.queryByText('行情已过期')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 平安银行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除 平安银行' })).toBeInTheDocument();
    expect(screen.getByText('−1.64%')).toHaveClass('value--fall');
    expect(screen.getByText('持仓收益：+¥200.00（+20.00%）')).toHaveClass('value--rise');
  });

  it('shows the runtime quote name, change amount, and percent', () => {
    render(
      <HoldingList
        holdings={[holding({ name: '持仓备用名称' })]}
        quotes={{
          '600519': quote({ name: '行情实时名称' }),
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '行情实时名称' })).toBeInTheDocument();
    expect(screen.getByText('+¥2.00')).toHaveClass('value--rise');
    expect(screen.getByText('+20.00%')).toHaveClass('value--rise');
    expect(screen.getByText('换手')).toBeInTheDocument();
    expect(screen.getByText('1.23%')).toBeInTheDocument();
    expect(screen.queryByText('更新时间')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-08-18 18:30:00')).not.toBeInTheDocument();
  });

  it('renders overview metrics and refresh status', () => {
    render(
      <Overview
        summary={summaryFixture()}
        lastUpdated="2026-08-18T10:30:00.000Z"
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('+20.00%')).toHaveClass('value--rise');
    expect(screen.getByText('¥200.00')).toHaveClass('value--rise');
    expect(screen.getByRole('button', { name: '刷新行情' })).not.toBeDisabled();
  });

  it('renders neutral overview state while partial quotes are refreshing', () => {
    render(
      <Overview
        summary={summaryFixture({ hasPartialQuotes: true, profit: null, returnPct: null })}
        lastUpdated="2026-08-18T10:30:00.000Z"
        isRefreshing
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('总收益率')).toBeInTheDocument();
    expect(screen.getByText('部分行情')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  });

  it('renders the primary navigation with the active page and pending limit-up count fallback', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <PrimaryNav
        activePage="limit-up"
        holdingCount={12}
        watchlistCount={3}
        limitUpCount={null}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole('button', { name: '持仓 12' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '自选 3' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '涨停聚焦 —' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(screen.getByRole('button', { name: '持仓 12' }));
    expect(onNavigate).toHaveBeenCalledWith('holdings');

    await user.click(screen.getByRole('button', { name: '自选 3' }));
    expect(onNavigate).toHaveBeenCalledWith('watchlist');
    expect(screen.queryByRole('button', { name: /全部持仓|设置/ })).not.toBeInTheDocument();
  });

  it('renders four market indices with quote values, update time, and refresh state', () => {
    render(
      <MarketOverview
        indices={marketIndicesFixture()}
        lastUpdated="2026-08-19T07:35:00.000Z"
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('深证成指')).toBeInTheDocument();
    expect(screen.getByText('创业板指')).toBeInTheDocument();
    expect(screen.getByText('科创 50')).toBeInTheDocument();
    expect(screen.getByText('+0.38%')).toHaveClass('value--rise');
    expect(screen.getByText('-0.24%')).toHaveClass('value--fall');
    expect(screen.getByText('最后刷新：08/19 15:35')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新大盘' })).not.toBeDisabled();
  });

  it('uses a clear market overview hierarchy for the index cards', () => {
    render(
      <MarketOverview
        indices={marketIndicesFixture()}
        lastUpdated="2026-08-19T07:35:00.000Z"
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    const overview = screen.getByRole('region', { name: '大盘概览' });

    expect(overview).toHaveClass('market-overview');
    expect(screen.getByText('实时指数')).toBeInTheDocument();
    expect(screen.getByText('四大核心指数')).toBeInTheDocument();
    expect(screen.getAllByText('涨跌额')).toHaveLength(4);
    expect(screen.getAllByText('涨跌幅')).toHaveLength(4);
    expect(screen.getAllByText('点位')).toHaveLength(4);
  });

  it('renders stale and unavailable market indices with neutral semantics', () => {
    render(
      <MarketOverview
        indices={[
          {
            symbol: '000001',
            name: '上证指数',
            price: 3301.25,
            change: 12.38,
            pct: 0.38,
            updatedAt: '2026-08-19T07:30:00.000Z',
            status: 'stale',
          },
          {
            symbol: '399001',
            name: '深证成指',
            price: 10500.88,
            change: -25.12,
            pct: -0.24,
            updatedAt: '2026-08-19T07:30:00.000Z',
            status: 'unavailable',
          },
        ]}
        lastUpdated="2026-08-19T07:35:00.000Z"
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('数据已过期')).toHaveClass('value--neutral');
    expect(screen.getByText('无可用数据')).toHaveClass('value--neutral');
    expect(screen.getByText('+12.38')).toHaveClass('value--neutral');
    expect(screen.getByText('-0.24%')).toHaveClass('value--neutral');
  });

  it('renders four unavailable market placeholders with null values and tolerates an invalid update time', () => {
    render(
      <MarketOverview
        indices={marketIndicesFixture().map((index) => ({
          ...index,
          price: null,
          change: null,
          pct: null,
          updatedAt: null,
          status: 'unavailable' as const,
        }))}
        lastUpdated="not-a-date"
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('深证成指')).toBeInTheDocument();
    expect(screen.getByText('创业板指')).toBeInTheDocument();
    expect(screen.getByText('科创 50')).toBeInTheDocument();
    expect(screen.getByText('最后刷新：未刷新')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(12);
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('renders the limit-up table contract columns in response order and shows stale and empty states', () => {
    const staleData = limitUpResponseFixture({ status: 'stale' });
    const emptyData = limitUpResponseFixture({ items: [] });
    const { rerender } = render(
      <LimitUpList data={staleData} isRefreshing={false} onRefresh={vi.fn()} />,
    );

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '股票',
      '连板',
      '板块',
      '最新价',
      '涨跌幅',
      '首次封板',
      '最后封板',
      '炸板次数',
    ]);

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('桂发祥');
    expect(rows[2]).toHaveTextContent('ST中华');
    expect(rows[1]).toHaveTextContent('002820');
    expect(rows[1]).toHaveTextContent('3 连板');
    expect(rows[1]).toHaveTextContent('食品饮料');
    expect(rows[1]).toHaveTextContent('¥12.27');
    expect(rows[1]).toHaveTextContent('+10.04%');
    expect(Array.from(rows[2].querySelectorAll('td')).map((cell) => cell.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(screen.getByText('包含 ST / 风险标的')).toBeInTheDocument();
    expect(screen.getByText('数据已过期')).toBeInTheDocument();
    expect(screen.getByText('2026-08-19')).toBeInTheDocument();
    expect(screen.getByText('2 只')).toBeInTheDocument();
    expect(screen.getByText('3 连板')).toBeInTheDocument();
    expect(screen.getAllByText('—')).not.toHaveLength(0);

    rerender(<LimitUpList data={emptyData} isRefreshing={true} onRefresh={vi.fn()} />);

    expect(screen.getByText('暂无涨停数据')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  });

  it('shows an explicit unavailable state without inventing a trade date', () => {
    render(
      <LimitUpList
        data={limitUpResponseFixture({
          tradeDate: null,
          items: [],
          status: 'unavailable',
          error: '涨停池上游请求失败',
        })}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('涨停数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('暂无可用涨停数据')).toBeInTheDocument();
    expect(screen.getByText('交易日：暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('数据已过期')).not.toBeInTheDocument();
  });
});
