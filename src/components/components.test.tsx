import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Holding, PortfolioSummary, Quote, QuoteMap, StockGroup } from '../types';
import { GroupDialog } from './GroupDialog';
import { GroupSidebar } from './GroupSidebar';
import { HoldingForm, type HoldingFormValues } from './HoldingForm';
import { HoldingList } from './HoldingList';
import { Overview } from './Overview';

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

    await user.click(screen.getByRole('button', { name: '长期持仓' }));
    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.click(screen.getByRole('button', { name: '编辑分组 长期持仓' }));
    await user.click(screen.getByRole('button', { name: '删除分组 长期持仓' }));

    expect(onSelect).toHaveBeenCalledWith('long-term');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'long-term', name: '长期持仓' }),
    );
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'long-term', name: '长期持仓' }),
    );
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
    expect(screen.getByText('行情已过期')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 平安银行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除 平安银行' })).toBeInTheDocument();
    expect(screen.getByText('−1.64%')).toHaveClass('value--fall');
    expect(screen.getByText('持仓收益：+¥200.00（+20.00%）')).toHaveClass('value--rise');
  });

  it('shows the runtime quote name, change amount, percent, and quote time', () => {
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
    expect(screen.getByText('2026-08-18 18:30:00')).toBeInTheDocument();
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
});
