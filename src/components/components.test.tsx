import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { GroupManagerDialog } from './GroupManagerDialog';
import { GroupSidebar } from './GroupSidebar';
import { HoldingForm, type HoldingFormValues } from './HoldingForm';
import { HoldingList } from './HoldingList';
import { LimitUpList } from './LimitUpList';
import { MarketOverview } from './MarketOverview';
import { Overview } from './Overview';
import { PrimaryNav } from './PrimaryNav';
import { Watchlist } from './Watchlist';
import { WatchlistFilterBar } from './WatchlistFilterBar';
import { WarningNotes } from './WarningNotes';

const groupsFixture = (): StockGroup[] => [
  {
    id: 'long-term',
    name: '长期持仓',
    isSystem: false,
    createdAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'swing',
    name: '波段交易',
    isSystem: false,
    createdAt: '2026-08-18T00:00:00.000Z',
  },
];

const holding = (overrides: Partial<Holding> = {}): Holding => ({
  id: 'h-1',
  symbol: '600519',
  name: '贵州茅台',
  groupId: 'long-term',
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
  volumeRatio: 1.2,
  amount: 640_000_000,
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
    amount: 868_773_070_000,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
  {
    symbol: '399001',
    name: '深证成指',
    price: 10500.88,
    change: -25.12,
    pct: -0.24,
    amount: 868_773_070_000,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
  {
    symbol: '399006',
    name: '创业板指',
    price: 2100.66,
    change: 8.11,
    pct: 0.39,
    amount: 868_773_070_000,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
  {
    symbol: '000688',
    name: '科创 50',
    price: 980.42,
    change: -3.55,
    pct: -0.36,
    amount: 868_773_070_000,
    updatedAt: '2026-08-19T07:30:00.000Z',
    status: 'fresh',
  },
];

/**
 * styles.css 里的长度单位已统一改成 rem（根字号 clamp 自适应，见文件顶部的说明），
 * 但下面那些样式断言表达的是「稿子 F 在 1440px 基准下的数值」，用 px 写才对得上设计稿。
 * 这里按 13px 基准把 rem 还原回 px（保留 2 位小数，误差 < 0.005px），
 * 让断言继续用设计稿上的原始数字，同时不再随单位变化而失效。
 */
const stylesInDesignPx = (): string =>
  readFileSync('src/styles.css', 'utf8').replace(
    /(-?\d*\.?\d+)rem\b/g,
    (_match, rem: string) => `${Number((Number(rem) * 13).toFixed(2))}px`,
  );

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

    // 选中候选后 symbol 变了，但不该再顺手搜一次、把下拉重新拉起来
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(onSearch).toHaveBeenCalledWith('贵州茅台');
    expect(onSubmit).toHaveBeenCalledWith({
      symbol: '600519',
      name: '贵州茅台',
      // 没有显式选分组：默认「不分组」，不落到第一个分组上
      groupId: '',
      openPrice: null,
      quantity: null,
      note: '',
    });
  });

  it('does not auto-open search suggestions when the edit dialog opens', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn().mockResolvedValue([{ symbol: '600519', name: '贵州茅台' }]);

    render(
      <HoldingFormHarness groups={groupsFixture()} initialHolding={holding()} onSearch={onSearch} />,
    );

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    // 等过防抖窗口：编辑已有股票时，弹窗打开不该自动搜索
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('开仓价')).toHaveValue('10');

    // 用户真的改了代码才搜索
    await user.type(screen.getByLabelText('股票代码'), '1');
    expect(await screen.findByRole('option', { name: '贵州茅台 600519' })).toBeInTheDocument();
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
      // 没选分组就是「不分组」，不预选第一个分组
      groupId: '',
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

  it('submits a trimmed symbol and lets a stock stay unassigned', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<HoldingFormHarness groups={groupsFixture()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));

    // 分组下拉里不再有「未分组」这类系统分组，但可以显式选择「不分组」
    expect(screen.queryByRole('option', { name: '全部持仓' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '不分组' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '未分组' })).not.toBeInTheDocument();
    // 有分组摆在那也不预选：默认停在「不分组」
    expect(screen.getByLabelText('分组')).toHaveValue('');

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
    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(symbolInput).toHaveFocus();

    saveButton.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab();
    expect(symbolInput).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '添加股票' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes the holding dialog from the close button', async () => {
    const user = userEvent.setup();

    render(<HoldingFormHarness groups={groupsFixture()} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));

    expect(screen.queryByRole('dialog', { name: '添加股票' })).not.toBeInTheDocument();
  });

  it('keeps the suggestion list usable from the keyboard', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn().mockResolvedValue([
      { symbol: '600519', name: '贵州茅台' },
      { symbol: '600520', name: '三佳科技' },
    ]);

    render(<HoldingFormHarness groups={groupsFixture()} onSearch={onSearch} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    const symbolInput = screen.getByLabelText('股票代码');
    await user.type(symbolInput, '6005');

    expect(await screen.findByRole('option', { name: '贵州茅台 600519' })).toBeInTheDocument();

    // 上下键高亮候选，回车选中
    await user.keyboard('{ArrowDown}');
    expect(symbolInput).toHaveAttribute(
      'aria-activedescendant',
      'holding-symbol-suggestions-option-0',
    );
    await user.keyboard('{ArrowDown}');
    expect(symbolInput).toHaveAttribute(
      'aria-activedescendant',
      'holding-symbol-suggestions-option-1',
    );
    await user.keyboard('{ArrowUp}');
    expect(symbolInput).toHaveAttribute(
      'aria-activedescendant',
      'holding-symbol-suggestions-option-0',
    );
    await user.keyboard('{Enter}');

    expect(symbolInput).toHaveValue('600519');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('dismisses only the suggestion list on Escape while it is open', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn().mockResolvedValue([{ symbol: '600519', name: '贵州茅台' }]);

    render(<HoldingFormHarness groups={groupsFixture()} onSearch={onSearch} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // 第一次 Esc 只收下拉，弹窗和已输入的代码都还在
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '添加股票' })).toBeInTheDocument();
    expect(screen.getByLabelText('股票代码')).toHaveValue('600519');

    // 第二次 Esc 才关弹窗
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '添加股票' })).not.toBeInTheDocument();
  });

  it('moves focus to the first invalid field and links inline errors', async () => {
    const user = userEvent.setup();

    render(<HoldingFormHarness groups={groupsFixture()} />);

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请输入 6 位股票代码');
    expect(screen.getByLabelText('股票代码')).toHaveFocus();
    expect(screen.getByLabelText('股票代码')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('股票代码')).toHaveAttribute(
      'aria-describedby',
      'holding-symbol-error',
    );

    // 一改输入就收掉旧报错
    await user.type(screen.getByLabelText('股票代码'), '519');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    const deleteButton = screen.getByRole('button', { name: '删除分组' });
    const closeButton = screen.getByRole('button', { name: '关闭' });

    deleteButton.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(deleteButton).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('manages groups from one panel: create, rename and delete', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();

    render(
      <GroupManagerDialog
        groups={groupsFixture()}
        holdings={[holding(), holding({ id: 'h-2', groupId: 'long-term' })]}
        onAdd={onAdd}
        onRename={onRename}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('dialog', { name: '分组管理' });
    expect(panel).toHaveAttribute('aria-modal', 'true');

    // 分组连数量一起列出来
    expect(within(panel).getByText('长期持仓')).toBeInTheDocument();
    expect(within(panel).getByText('2 只')).toBeInTheDocument();
    expect(within(panel).getByText('波段交易')).toBeInTheDocument();

    // 新建：表单校验通过后回调，并回到列表
    await user.click(within(panel).getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '短线观察');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    expect(onAdd).toHaveBeenCalledWith({ name: '短线观察' });
    expect(screen.getByRole('dialog', { name: '分组管理' })).toBeInTheDocument();

    // 重命名：表单预填当前名字
    await user.click(screen.getByRole('button', { name: '重命名分组 长期持仓' }));
    expect(screen.getByLabelText('分组名称')).toHaveValue('长期持仓');
    await user.clear(screen.getByLabelText('分组名称'));
    await user.type(screen.getByLabelText('分组名称'), '长线底仓');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    expect(onRename).toHaveBeenCalledWith('long-term', { name: '长线底仓' });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting a group from the panel', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <GroupManagerDialog
        groups={groupsFixture()}
        holdings={[holding()]}
        onAdd={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '删除分组 长期持仓' }));

    // 第一次点击只是展开确认，不会真的删
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('删除后股票变为未分配')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('删除后股票变为未分配')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除分组 长期持仓' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    expect(onDelete).toHaveBeenCalledWith('long-term');
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

  it('merges the watchlist scope and groups into a single filter row', async () => {
    const user = userEvent.setup();
    const onSelectScope = vi.fn();
    const onSelectGroup = vi.fn();
    const onManageGroups = vi.fn();

    render(
      <WatchlistFilterBar
        scope="all"
        totalCount={13}
        positionCount={2}
        holdings={[holding(), holding({ id: 'h-2', groupId: 'long-term' })]}
        groups={groupsFixture()}
        selectedGroupId="all"
        onSelectScope={onSelectScope}
        onSelectGroup={onSelectGroup}
        onManageGroups={onManageGroups}
      />,
    );

    // 只剩一条筛选控件：范围和分组在同一排
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    const nav = screen.getByRole('navigation', { name: '自选筛选' });
    const itemNames = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent);

    expect(itemNames).toEqual(['全部13', '持仓2', '长期持仓2', '波段交易0']);

    expect(within(nav).getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('button', { name: '持仓' })).not.toHaveAttribute('aria-current');
    // 合并后不再有「全部自选」这种重复的通用档位
    expect(within(nav).queryByRole('button', { name: /全部自选|全部持仓/ })).not.toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: '持仓' }));
    expect(onSelectScope).toHaveBeenCalledWith('position');

    await user.click(within(nav).getByRole('button', { name: '长期持仓' }));
    expect(onSelectGroup).toHaveBeenCalledWith('long-term');

    await user.click(screen.getByRole('button', { name: '分组管理' }));
    expect(onManageGroups).toHaveBeenCalledTimes(1);
  });

  it('leaves group 编辑/删除 out of the filter row and keeps 全部 inactive for a selected group', () => {
    render(
      <WatchlistFilterBar
        scope="all"
        totalCount={13}
        positionCount={2}
        holdings={[holding()]}
        groups={groupsFixture()}
        selectedGroupId="long-term"
        onSelectScope={vi.fn()}
        onSelectGroup={vi.fn()}
        onManageGroups={vi.fn()}
      />,
    );

    const nav = screen.getByRole('navigation', { name: '自选筛选' });

    // 选中分组时「全部」不再高亮，避免两个档位同时 active
    expect(within(nav).getByRole('button', { name: '长期持仓' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('button', { name: '全部' })).not.toHaveAttribute('aria-current');
    // 点分组不再冒出一排编辑/删除，这些操作统一在「分组管理」里
    expect(screen.queryByRole('button', { name: /编辑分组|删除分组/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建分组' })).not.toBeInTheDocument();
  });

  it('shows group edit and delete actions only for the selected custom group', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <GroupSidebar
        groups={[
          ...groupsFixture(),
          {
            id: 'short-term',
            name: '短线观察',
            isSystem: false,
            createdAt: '2026-08-18T00:00:00.000Z',
          },
        ]}
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

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.at(-1)).toContainElement(
      screen.getByRole('button', { name: '编辑分组 长期持仓' }),
    );
    expect(listItems.at(-1)).toContainElement(
      screen.getByRole('button', { name: '删除分组 长期持仓' }),
    );
    expect(listItems.at(-2)).toHaveTextContent('短线观察');

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

  it('把分时图列插在「股票」和「最新价」之间', () => {
    render(<HoldingList holdings={[holding()]} quotes={{ '600519': quote() }} onEdit={vi.fn()} />);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers.slice(0, 3)).toEqual(['股票', '分时图', '最新价']);
  });

  it('有分时数据时画分时图，没有时显示占位符', () => {
    const minuteSeries = {
      '600519': {
        symbol: '600519',
        preClose: 10,
        points: [9.8, 10.1, 10.4],
        times: ['0930', '0931', '0932'],
      },
    };

    const { container, unmount } = render(
      <HoldingList
        holdings={[holding()]}
        quotes={{ '600519': quote() }}
        minuteSeries={minuteSeries}
        onEdit={vi.fn()}
      />,
    );

    // 末点 10.4 高于昨收 10 → 走高染色，且有昨收基准虚线
    expect(container.querySelector('.minute-chart--rise')).not.toBeNull();
    expect(container.querySelector('.minute-chart__baseline')).not.toBeNull();
    expect(container.querySelector('.minute-chart polyline')).not.toBeNull();

    unmount();
    const without = render(
      <HoldingList holdings={[holding()]} quotes={{ '600519': quote() }} onEdit={vi.fn()} />,
    );
    expect(without.container.querySelector('.minute-chart--empty')?.textContent).toBe('—');
    expect(without.container.querySelector('polyline')).toBeNull();
  });

  it('renders the note as a red tag next to the holding name, not a 备注 line', () => {
    const { container } = render(
      <HoldingList
        holdings={[holding({ symbol: '600519', note: '观察业绩' })]}
        quotes={{}}
        onEdit={vi.fn()}
      />,
    );

    const tag = screen.getByText('观察业绩');
    // 设计稿 F 的 .tag：名称同一行里的红色胶囊
    expect(tag).toHaveClass('stock-tag');
    expect(tag.closest('.stock-identity__name')).not.toBeNull();
    expect(container.querySelector('.stock-identity__avatar')).toHaveTextContent('贵');
    // 旧的「备注：」整行已经不再渲染
    expect(container.querySelector('.holding-card__note')).toBeNull();
  });

  it('marks every quote list with the design avatar, tagging only the lists that need it', () => {
    render(
      <>
        <Watchlist
          holdings={[holding({ symbol: '600519', note: '核心仓' })]}
          quotes={{}}
          onEdit={vi.fn()}
        />
        <LimitUpList
          data={limitUpResponseFixture({
            items: [
              {
                symbol: '002820',
                name: '深市连板',
                price: 12.27,
                pct: 10.04,
                boardCount: 3,
                firstSealTime: '09:25:00',
                lastSealTime: '14:42:10',
                industry: '食品饮料',
                breakCount: 1,
              },
            ],
          })}
          isRefreshing={false}
          onRefresh={vi.fn()}
          onAddToWatchlist={vi.fn()}
          watchlistSymbols={new Set<string>()}
        />
      </>,
    );

    // 标签在名称旁边（同一个 .stock-identity__name），不是另起一行
    const noteTag = screen
      .getAllByText('核心仓')
      .find((node) => node.classList.contains('stock-tag'));
    expect(noteTag).toBeDefined();
    expect(noteTag?.closest('.stock-identity__name')).not.toBeNull();

    // 涨停池不挂标签：连板数只留在「连板」列，名称旁没有红标签
    expect(document.querySelectorAll('.stock-tag')).toHaveLength(1);
    expect(screen.getByText('3 连板').classList.contains('stock-tag')).toBe(false);

    // 沪市 6 开头是蓝块，深市 0 开头是绿块
    const avatars = document.querySelectorAll('.stock-identity__avatar');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).not.toHaveClass('stock-identity__avatar--sz');
    expect(avatars[1]).toHaveClass('stock-identity__avatar--sz');
  });

  it('shows the limit-up board tag from the limit-up pool on watchlist and holdings', () => {
    render(
      <>
        <Watchlist
          holdings={[holding({ symbol: '003026', name: '中晶科技' })]}
          quotes={{}}
          limitUpInfo={{ '003026': { boardCount: 3 } }}
          onEdit={vi.fn()}
        />
        <HoldingList
          holdings={[
            holding({ id: 'h-2', symbol: '600519', name: '贵州茅台', note: '核心仓' }),
            holding({ id: 'h-3', symbol: '600000', name: '浦发银行' }),
          ]}
          quotes={{}}
          limitUpInfo={{ '600519': { boardCount: 2 }, '600000': { boardCount: 1 } }}
          onEdit={vi.fn()}
        />
      </>,
    );

    // 没有备注的票：连板数是唯一标签，用主标签样式（红）
    const boardTag = screen.getByText('3 连板');
    expect(boardTag).toHaveClass('stock-tag');
    expect(boardTag).not.toHaveClass('stock-tag--secondary');
    expect(boardTag.closest('.stock-identity__name')?.textContent).toBe('中晶科技3 连板');

    // 首板写「涨停」
    expect(screen.getByText('涨停')).toHaveClass('stock-tag');

    // 备注 + 连板同时存在：备注当主标签，连板退成蓝色副标签
    expect(screen.getByText('核心仓')).not.toHaveClass('stock-tag--secondary');
    expect(screen.getByText('2 连板')).toHaveClass('stock-tag--secondary');
  });

  it('omits the limit-up tag when the pool has no data for the symbol', () => {
    render(
      <Watchlist
        holdings={[holding({ symbol: '600519', name: '贵州茅台' })]}
        quotes={{}}
        limitUpInfo={{}}
        onEdit={vi.fn()}
      />,
    );

    expect(document.querySelector('.stock-tag')).toBeNull();
  });

  it('opens the holding editor only from the stock column, not from numeric cells', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    render(<HoldingList holdings={[holding()]} quotes={{ '600519': quote() }} onEdit={onEdit} />);

    // 数字列是纯展示：点它们不该弹窗
    const numericCells = screen.getAllByRole('cell');
    await user.click(numericCells[0]);
    await user.click(numericCells[1]);
    expect(onEdit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '编辑 贵州茅台' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'h-1', symbol: '600519' }));
  });

  it('opens the watchlist editor only from the stock column', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    render(<Watchlist holdings={[holding()]} quotes={{ '600519': quote() }} onEdit={onEdit} />);

    await user.click(screen.getAllByRole('cell')[0]);
    expect(onEdit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '编辑 贵州茅台' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'h-1', symbol: '600519' }));
  });

  it('把分时图列插在「股票」和「最新价」之间', () => {
    render(<Watchlist holdings={[holding()]} quotes={{ '600519': quote() }} onEdit={vi.fn()} />);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers.slice(0, 3)).toEqual(['股票', '分时图', '最新价']);
  });

  it('renders watchlist cards without position fields', () => {
    render(
      <Watchlist
        holdings={[holding({ openPrice: 10, quantity: 100, note: '先观察' })]}
        quotes={{ '600519': quote() }}
        onEdit={vi.fn()}
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

  it('shows 自选日 and 自选收益 on the watchlist, and a dash when there is no baseline', () => {
    render(
      <Watchlist
        holdings={[
          holding({
            id: 'h-1',
            symbol: '600519',
            watchPrice: 10,
            watchPriceAt: '2026-09-18T01:40:00.000Z',
          }),
          // 本功能上线前的旧记录 / 加入时没拿到行情：没有基准价
          holding({ id: 'h-2', symbol: '000001', name: '平安银行' }),
        ]}
        quotes={{
          '600519': quote({ price: 12 }),
          '000001': quote({ symbol: '000001', name: '平安银行', price: 9 }),
        }}
        onEdit={vi.fn()}
      />,
    );

    // 自选相关三列收在表格最右：自选日 → 自选价 → 自选收益
    const headers = screen
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
      .slice(-3);
    expect(headers).toEqual(['自选日', '自选价', '自选收益']);
    expect(screen.getByRole('columnheader', { name: '自选价' })).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    // 自选价就是记下来的基准价，和「自选收益」配成一组：10.00 对应 +20.00%
    const watchPrices = () =>
      Array.from(document.querySelectorAll('.quote-table__watch-price')).map(
        (cell) => cell.textContent,
      );
    expect(watchPrices()).toEqual(['10.00', '—']);

    // 第一行：自选以来 10 → 12
    expect(rows[1]).toHaveTextContent('+20.00%');
    expect(rows[1]).toHaveTextContent('2026/09/18');

    // 第二行：没有基准价就如实显示「—」，不拿现价顶替成 +0.00%
    expect(rows[2]).not.toHaveTextContent('+0.00%');
    expect(within(rows[2]).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('给自选列表的涨跌幅分档、换手与量比挂档位词，自选收益不加底色块', () => {
    render(
      <Watchlist
        holdings={[
          holding({
            id: 'h-1',
            symbol: '001216',
            name: '华瓷股份',
            watchPrice: 18,
            watchPriceAt: '2026-09-16T02:00:00.000Z',
          }),
          holding({
            id: 'h-2',
            symbol: '000001',
            name: '平安银行',
            watchPrice: 12.5,
            watchPriceAt: '2026-09-16T02:00:00.000Z',
          }),
          holding({
            id: 'h-3',
            symbol: '600519',
            name: '贵州茅台',
            watchPrice: 12,
            watchPriceAt: '2026-09-16T02:00:00.000Z',
          }),
        ]}
        quotes={{
          '001216': quote({
            symbol: '001216',
            name: '华瓷股份',
            price: 19.88,
            change: 1.81,
            pct: 10.02,
            turnover: 18.3,
            volumeRatio: 3.05,
            preClose: 18.07,
          }),
          '000001': quote({
            symbol: '000001',
            name: '平安银行',
            price: 11.5,
            change: -0.08,
            pct: -0.68,
            turnover: 0.62,
            volumeRatio: 0.79,
            preClose: 11.58,
          }),
          // 现价 = 自选价：自选收益 +0.00%，不该被分档
          '600519': quote({ symbol: '600519', name: '贵州茅台', price: 12, pct: 0 }),
        }}
        onEdit={vi.fn()}
      />,
    );

    // 涨停档：红底白字（类名在这里，颜色在 styles.css）
    expect(screen.getByText('+10.02%')).toHaveClass(
      'value-tier',
      'value-tier--limit',
      'value-tier--pad',
    );
    // 自选收益 (19.88 − 18) / 18 = +10.44%：不加底色块，保持原来的红绿文字色
    expect(screen.getByText('+10.44%')).not.toHaveClass('value-tier');
    // 小跌档只有文字颜色，不加底
    expect(screen.getByText('−0.68%')).toHaveClass('value-tier', 'value-tier--down');
    expect(screen.getByText('−0.68%')).not.toHaveClass('value-tier--pad');
    // 恰好 0 的涨跌幅，和本来就不分档的自选收益，都保持界面原样
    const zeros = screen.getAllByText('+0.00%');
    expect(zeros).toHaveLength(2);
    for (const zero of zeros) {
      expect(zero).not.toHaveClass('value-tier');
    }

    // 换手/量比：值下面挂档位词，单元格自己当定位参考
    const words = Array.from(document.querySelectorAll('.value-word')).map((el) => [
      el.textContent,
      el.className,
    ]);
    expect(words).toEqual([
      ['过热', 'value-word value-word--rise'],
      ['大幅放量', 'value-word value-word--rise'],
      ['冷清', 'value-word value-word--dim'],
      ['缩量', 'value-word value-word--fall'],
      ['正常', 'value-word value-word--ink'],
      ['平量', 'value-word value-word--ink'],
    ]);
    expect(document.querySelectorAll('.value-word-host')).toHaveLength(6);
  });

  it('给持仓列表的涨跌幅、持仓收益分档，并给换手挂档位词', () => {
    render(
      <HoldingList
        holdings={[
          holding({ id: 'h-1', symbol: '600127', name: '金健米业', openPrice: 12.5, quantity: 2000 }),
          holding({ id: 'h-2', symbol: '000001', name: '平安银行', openPrice: 11.6, quantity: 100 }),
        ]}
        quotes={{
          '600127': quote({
            symbol: '600127',
            name: '金健米业',
            price: 14.32,
            change: 1.3,
            pct: 9.98,
            turnover: 47.06,
            preClose: 13.02,
          }),
          '000001': quote({
            symbol: '000001',
            name: '平安银行',
            price: 11.5,
            change: -0.08,
            pct: -0.68,
            turnover: 2.49,
            preClose: 11.58,
          }),
        }}
        onEdit={vi.fn()}
      />,
    );

    // 涨跌幅用的是自带内边距的 .quote-row__chg，加档位色但不再垫一层
    const limit = screen.getByText('+9.98%').closest('.quote-row__chg');
    expect(limit).toHaveClass('value-tier', 'value-tier--limit');
    expect(limit).not.toHaveClass('value-tier--pad');
    // 持仓收益 +14.56%：档位底色包住数字
    const profit = screen.getByText('+3,640.00（+14.56%）');
    expect(profit).toHaveClass('value-tier', 'value-tier--limit', 'value-tier--pad');

    const words = Array.from(document.querySelectorAll('.value-word')).map((el) => el.textContent);
    expect(words).toEqual(['过热', '正常']);
  });

  it('sorts the watchlist by 自选价, keeping rows without a baseline at the bottom', async () => {
    const user = userEvent.setup();

    render(
      <Watchlist
        holdings={[
          holding({ id: 'h-1', symbol: '600519', watchPrice: 10 }),
          holding({ id: 'h-2', symbol: '000001', name: '平安银行', watchPrice: 20 }),
          // 没有基准价：自选价和自选收益都是「—」，排序永远沉底
          holding({ id: 'h-3', symbol: '300750', name: '宁德时代' }),
        ]}
        quotes={{}}
        onEdit={vi.fn()}
      />,
    );

    const prices = () =>
      Array.from(document.querySelectorAll('.quote-table__watch-price')).map(
        (cell) => cell.textContent,
      );

    // 默认：添加时间倒序
    expect(prices()).toEqual(['10.00', '20.00', '—']);

    await user.click(screen.getByRole('button', { name: '自选价' }));
    await expect(waitFor(prices)).resolves.toEqual(['20.00', '10.00', '—']);

    await user.click(screen.getByRole('button', { name: '自选价' }));
    await expect(waitFor(prices)).resolves.toEqual(['10.00', '20.00', '—']);
  });

  it('sorts the watchlist by 自选收益 and by 自选日', async () => {
    const user = userEvent.setup();

    render(
      <Watchlist
        holdings={[
          holding({
            id: 'h-1',
            symbol: '600519',
            name: '贵州茅台',
            watchPrice: 10,
            watchPriceAt: '2026-09-18T01:40:00.000Z',
            createdAt: '2026-09-18T01:40:00.000Z',
          }),
          holding({
            id: 'h-2',
            symbol: '000001',
            name: '平安银行',
            watchPrice: 10,
            watchPriceAt: '2026-09-01T01:40:00.000Z',
            createdAt: '2026-09-01T01:40:00.000Z',
          }),
          // 没有基准价：收益是 null，排序时永远沉底
          holding({ id: 'h-3', symbol: '300750', name: '宁德时代' }),
        ]}
        quotes={{
          '600519': quote({ price: 12 }),
          '000001': quote({ symbol: '000001', name: '平安银行', price: 8 }),
          '300750': quote({ symbol: '300750', name: '宁德时代', price: 99 }),
        }}
        onEdit={vi.fn()}
      />,
    );

    // 代码是每行里唯一稳定的标识（首字头像会和名称首字重复）
    const codes = () =>
      Array.from(document.querySelectorAll('.stock-identity__code')).map((cell) => cell.textContent);
    const codesAfterNextPaint = () => waitFor(() => codes());

    // 默认：添加时间倒序
    expect(codes()).toEqual(['600519', '000001', '300750']);

    // 收益降序：+20% 在 −20% 前面，没有基准价的沉底
    await user.click(screen.getByRole('button', { name: '自选收益' }));
    await expect(codesAfterNextPaint()).resolves.toEqual(['600519', '000001', '300750']);

    await user.click(screen.getByRole('button', { name: '自选收益' }));
    await expect(codesAfterNextPaint()).resolves.toEqual(['000001', '600519', '300750']);

    // 自选日：换一列从降序（加得晚的在前）开始
    await user.click(screen.getByRole('button', { name: '自选日' }));
    await expect(codesAfterNextPaint()).resolves.toEqual(['600519', '000001', '300750']);

    // 升序：加得早的在前（300750 没有基准价，退回到创建时间 08-18）
    await user.click(screen.getByRole('button', { name: '自选日' }));
    await expect(codesAfterNextPaint()).resolves.toEqual(['300750', '000001', '600519']);
  });

  it('hides the sort arrow until a column is actually sorted', async () => {
    const user = userEvent.setup();

    render(
      <Watchlist
        holdings={[holding({ id: 'h-1', symbol: '600519' })]}
        quotes={{ '600519': quote({ pct: 1 }) }}
        onEdit={vi.fn()}
      />,
    );

    const indicator = () => document.querySelector('.sort-button__glyph');

    // 默认（添加时间倒序）不画箭头，表头保持干净
    expect(indicator()).toBeNull();
    expect(screen.queryByText('▾')).not.toBeInTheDocument();
    expect(screen.queryByText('▴')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(indicator()?.textContent).toBe('▾');

    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(indicator()?.textContent).toBe('▴');

    // 回到默认后箭头再次消失
    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(indicator()).toBeNull();
  });

  it('sorts the watchlist by any column, defaulting to newest first', async () => {
    const user = userEvent.setup();
    const holdings = [
      holding({ id: 'h-1', symbol: '600519', name: '贵州茅台', createdAt: '2026-09-01T00:00:00.000Z' }),
      holding({ id: 'h-2', symbol: '000001', name: '平安银行', createdAt: '2026-09-03T00:00:00.000Z' }),
      holding({ id: 'h-3', symbol: '300750', name: '宁德时代', createdAt: '2026-09-02T00:00:00.000Z' }),
    ];
    const quotes: QuoteMap = {
      '600519': quote({ symbol: '600519', pct: 1 }),
      '000001': quote({ symbol: '000001', pct: 5 }),
      '300750': quote({ symbol: '300750', pct: 3 }),
    };

    render(<Watchlist holdings={holdings} quotes={quotes} onEdit={vi.fn()} />);

    // 代码是每行里唯一稳定的标识（首字头像会和名称首字重复）
    const codes = () =>
      Array.from(document.querySelectorAll('.stock-identity__code')).map(
        (cell) => cell.textContent,
      );

    // 默认：添加时间倒序
    expect(codes()).toEqual(['000001', '300750', '600519']);

    const pctHeader = () => screen.getByRole('columnheader', { name: '涨跌幅' });

    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(codes()).toEqual(['000001', '300750', '600519']);
    expect(pctHeader()).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(codes()).toEqual(['600519', '300750', '000001']);
    expect(pctHeader()).toHaveAttribute('aria-sort', 'ascending');

    // 第三次点击回到默认的添加时间倒序，并且不再声明已排序
    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(codes()).toEqual(['000001', '300750', '600519']);
    expect(pctHeader()).not.toHaveAttribute('aria-sort');

    // 换一列：新列从降序开始
    await user.click(screen.getByRole('button', { name: '股票' }));
    expect(codes()).toEqual(['600519', '300750', '000001']);
    expect(screen.getByRole('columnheader', { name: '股票' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('keeps rows without a quote at the bottom of a sorted watchlist', async () => {
    const user = userEvent.setup();
    const holdings = [
      holding({ id: 'h-1', symbol: '600519', name: '贵州茅台', createdAt: '2026-09-01T00:00:00.000Z' }),
      holding({ id: 'h-2', symbol: '000001', name: '平安银行', createdAt: '2026-09-02T00:00:00.000Z' }),
    ];

    render(
      <Watchlist holdings={holdings} quotes={{ '600519': quote({ pct: 1 }) }} onEdit={vi.fn()} />,
    );

    // 代码是每行里唯一稳定的标识（首字头像会和名称首字重复）
    const codes = () =>
      Array.from(document.querySelectorAll('.stock-identity__code')).map(
        (cell) => cell.textContent,
      );

    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(codes()).toEqual(['600519', '000001']);

    // 升序时缺行情的票也不能被顶到最前面
    await user.click(screen.getByRole('button', { name: '涨跌幅' }));
    expect(codes()).toEqual(['600519', '000001']);
  });

  it('sorts the holdings table by 持仓收益 and by 开仓价', async () => {
    const user = userEvent.setup();
    const holdings = [
      holding({
        id: 'h-1',
        symbol: '600519',
        name: '贵州茅台',
        openPrice: 10,
        quantity: 100,
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
      holding({
        id: 'h-2',
        symbol: '000001',
        name: '平安银行',
        openPrice: 20,
        quantity: 100,
        createdAt: '2026-09-02T00:00:00.000Z',
      }),
      // 没补录开仓价/数量：收益是 null，排序时永远沉底
      holding({
        id: 'h-3',
        symbol: '300750',
        name: '宁德时代',
        openPrice: null,
        quantity: null,
        createdAt: '2026-09-03T00:00:00.000Z',
      }),
    ];
    const quotes: QuoteMap = {
      '600519': quote({ symbol: '600519', price: 12 }),
      '000001': quote({ symbol: '000001', price: 15 }),
      '300750': quote({ symbol: '300750', price: 99 }),
    };

    render(<HoldingList holdings={holdings} quotes={quotes} onEdit={vi.fn()} />);

    // 代码是每行里唯一稳定的标识（首字头像会和名称首字重复）
    const codes = () =>
      Array.from(document.querySelectorAll('.stock-identity__code')).map(
        (cell) => cell.textContent,
      );

    // 默认：添加时间倒序
    expect(codes()).toEqual(['300750', '000001', '600519']);

    // 收益降序：茅台 (12-10)*100=200 高于平安 (15-20)*100=-500，宁德没数据沉底
    await user.click(screen.getByRole('button', { name: '持仓收益' }));
    expect(codes()).toEqual(['600519', '000001', '300750']);

    // 收益升序：亏损的排前面，宁德仍在最后
    await user.click(screen.getByRole('button', { name: '持仓收益' }));
    expect(codes()).toEqual(['000001', '600519', '300750']);

    await user.click(screen.getByRole('button', { name: '开仓价' }));
    expect(codes()).toEqual(['000001', '600519', '300750']);
  });

  it('keeps stock identity columns left and right-aligns every numeric column', () => {
    render(
      <>
        <HoldingList
          holdings={[holding()]}
          quotes={{ '600519': quote() }}
          onEdit={vi.fn()}
        />
        <Watchlist
          holdings={[holding()]}
          quotes={{ '600519': quote() }}
          onEdit={vi.fn()}
        />
        <LimitUpList
          data={limitUpResponseFixture()}
          isRefreshing={false}
          onRefresh={vi.fn()}
          onAddToWatchlist={vi.fn()}
          watchlistSymbols={new Set<string>()}
        />
      </>,
    );

    const styles = stylesInDesignPx();

    // F 的表格没有「操作」列：只有「股票」列（名称/代码按钮）可点即编辑
    expect(screen.queryByRole('columnheader', { name: '操作' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '编辑 贵州茅台' })).toHaveLength(2);
    expect(styles).not.toContain('.quote-table__row {\n  cursor: pointer;');
    expect(styles).toContain('.quote-table__stock {\n  display: flex;');
    expect(screen.getByRole('columnheader', { name: '板块' })).toBeInTheDocument();
    expect(styles).toContain(
      `.quote-table th,
.quote-table td {
  padding: 0 18px;
  font-size: 13px;
  /* F 用右对齐：数字位数不同也能共用一条右边线，和表头严格对齐 */
  text-align: right;
  vertical-align: middle;
  border-bottom: 1px solid var(--border-color);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}`,
    );
    expect(styles).toContain(
      `section[aria-labelledby='limit-up-list-title'] thead th {
  height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}`,
    );
    expect(styles).toContain(
      `section[aria-labelledby='limit-up-list-title'] tbody th,
section[aria-labelledby='limit-up-list-title'] tbody td {
  height: 43px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  font-size: 13px;
  text-align: right;
  vertical-align: middle;
}`,
    );
    expect(styles).toContain(
      `.quote-table thead th:first-child,
.quote-table tbody th {
  /* 稿子 F：首列左内边距和其它列一致，和卡片标题对齐 */
  padding-left: 18px;
  text-align: left;
}`,
    );
    expect(styles).toContain(
      `section[aria-labelledby='limit-up-list-title'] thead th:first-child,
section[aria-labelledby='limit-up-list-title'] tbody th {
  padding-left: 6px;
  text-align: left;
}`,
    );
    expect(styles).toContain(
      `.quote-table thead th:last-child,
.quote-table tbody td:last-child {
  width: 132px;
  min-width: 132px;
  padding-left: 10px;
  text-align: center;
}`,
    );
    expect(styles).toContain(
      `.quote-table .holding-card__actions {
  justify-content: center;
  gap: 8px;
}`,
    );
  });

  /*
   * 布局回归：定高窗口（≥1181×520 的填充模式）里「卡片被裁成滚不动」的两个坑。
   * 这两条只能靠 CSS 文本断言守住 —— jsdom 不做层叠和布局计算，
   * 把选择器「顺手简化」回去时没有任何渲染测试会失败。
   */
  it('keeps the ladder scrollable in fill mode instead of clipping the rest of the tiers', () => {
    const styles = stylesInDesignPx();

    // 天梯卡片同时命中 `#limit-up-focus-panel > .card`（权重 1,1,0，设了 overflow: hidden），
    // 所以「卡片头固定 + 列表自己滚」的规则必须带同样的 id 前缀才压得住。
    // 少了它，1 板 48 只只会渲染出前面一半，剩下的既滚不到也点不到。
    expect(styles).toContain(`  #limit-up-focus-panel > .card.limit-up-ladder {`);
    expect(styles).toContain(
      `  .limit-up-ladder__list {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }`,
    );
    // 统计条按内容高度留在卡片头上，不跟着列表滚
    expect(styles).toContain(
      `  .limit-up-ladder__stats,
  .limit-up-ladder__group {
    flex: 0 0 auto;
  }`,
    );
  });

  it('lets the card grid shrink below the wide screener table so the page never scrolls sideways', () => {
    const styles = stylesInDesignPx();

    // 栅格子项默认 min-width: auto（= min-content），选股页 101.5385rem 的宽表会把卡片和
    // 整个 <body> 一起顶宽：窗口窄于 1181px 时整页横向滚，表格自己的容器反而滚不动。
    expect(styles).toMatch(/\.dashboard-main \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('marks a holding without position details as an observation item', () => {
    render(
      <HoldingList
        holdings={[holding({ openPrice: null, quantity: null })]}
        quotes={{ '600519': quote() }}
        onEdit={vi.fn()}
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
        volumeRatio: 1.2,
        amount: 640_000_000,
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
      />,
    );

    expect(screen.getByText('暂无行情')).toBeInTheDocument();
    expect(screen.queryByText('行情已过期')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 平安银行' })).toBeInTheDocument();
    expect(screen.getByText('−1.64%')).toHaveClass('value--fall');
    // 涨跌色留在 <p> 上，数字外面再包一层档位底色（+20% 属涨停档）
    const profit = screen.getByText('+200.00（+20.00%）');
    expect(profit.closest('.holding-card__profit')).toHaveClass('value--rise');
    expect(profit).toHaveClass('value-tier', 'value-tier--limit', 'value-tier--pad');
  });

  it('shows the runtime quote name, change amount, and percent', () => {
    render(
      <HoldingList
        holdings={[holding({ name: '持仓备用名称' })]}
        quotes={{
          '600519': quote({ name: '行情实时名称' }),
        }}
        onEdit={vi.fn()}
      />,
    );

    // 名称优先取运行时行情：现在挂在「股票」列按钮的可访问名上
    expect(screen.getByRole('button', { name: '编辑 行情实时名称' })).toBeInTheDocument();
    expect(screen.getByText('+2.00')).toHaveClass('value--rise');
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
      />,
    );

    expect(screen.getByText('+20.00%')).toHaveClass('value--rise');
    expect(screen.getByText('¥200.00')).toHaveClass('value--rise');
    // 刷新按钮已统一收到顶栏，卡片里只保留刷新时间
    expect(screen.getByText(/最后刷新/)).toBeInTheDocument();
  });

  it('renders neutral overview state while partial quotes are refreshing', () => {
    render(
      <Overview
        summary={summaryFixture({ hasPartialQuotes: true, profit: null, returnPct: null })}
        lastUpdated="2026-08-18T10:30:00.000Z"
        isRefreshing
      />,
    );

    expect(screen.getByText('总收益率')).toBeInTheDocument();
    expect(screen.getByText('部分行情')).toBeInTheDocument();
    expect(screen.getByText('刷新中…')).toBeInTheDocument();
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
        auctionCount={4}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole('button', { name: '持仓 12' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '自选 3' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '涨停聚焦 —' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: '竞价 4' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: '持仓 12' }));
    expect(onNavigate).toHaveBeenCalledWith('holdings');

    await user.click(screen.getByRole('button', { name: '自选 3' }));
    expect(onNavigate).toHaveBeenCalledWith('watchlist');
    await user.click(screen.getByRole('button', { name: '竞价 4' }));
    expect(onNavigate).toHaveBeenCalledWith('auction');
    expect(screen.queryByRole('button', { name: /全部持仓|设置/ })).not.toBeInTheDocument();
  });

  it('renders three market indices with quote values and states', () => {
    render(
      <MarketOverview
        indices={marketIndicesFixture()}
      />,
    );

    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('深证成指')).toBeInTheDocument();
    expect(screen.getByText('创业板指')).toBeInTheDocument();
    expect(screen.getByText('科创 50')).toBeInTheDocument();
    expect(screen.getByText('+0.38%')).toHaveClass('value--rise');
    expect(screen.getByText('-0.24%')).toHaveClass('value--fall');
    // 头部整块已移除：刷新入口统一在顶栏，刷新时间展示在页脚
    expect(screen.queryByText('最后刷新：08/19 15:35')).not.toBeInTheDocument();
  });

  it('uses a clear market overview hierarchy for the index cards', () => {
    render(
      <MarketOverview
        indices={marketIndicesFixture()}
      />,
    );

    const overview = screen.getByRole('region', { name: '大盘概览' });

    expect(overview).toHaveClass('market-overview');
    expect(screen.getAllByText('涨跌额')).toHaveLength(4);
    expect(screen.getAllByText('涨跌幅')).toHaveLength(4);
    expect(screen.queryByText('点位')).not.toBeInTheDocument();
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
            amount: 868_773_070_000,
            updatedAt: '2026-08-19T07:30:00.000Z',
            status: 'stale',
          },
          {
            symbol: '399001',
            name: '深证成指',
            price: 10500.88,
            change: -25.12,
            pct: -0.24,
            amount: 868_773_070_000,
            updatedAt: '2026-08-19T07:30:00.000Z',
            status: 'unavailable',
          },
        ]}
      />,
    );

    expect(screen.getByText('数据已过期')).toHaveClass('value--neutral');
    expect(screen.getByText('无可用数据')).toHaveClass('value--neutral');
    expect(screen.getByText('+12.38')).toHaveClass('value--neutral');
    expect(screen.getByText('-0.24%')).toHaveClass('value--neutral');
  });

  it('renders three unavailable market placeholders with null values and tolerates an invalid update time', () => {
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
      />,
    );

    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('深证成指')).toBeInTheDocument();
    expect(screen.getByText('创业板指')).toBeInTheDocument();
    expect(screen.getByText('科创 50')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // 3 个指数卡片 × 5 个空位（点位/涨跌额/涨跌幅/成交额）+ 两市成交卡片 × 3（成交额/涨跌数/涨停/炸板/晋级）
    expect(screen.getAllByText('—')).toHaveLength(18);
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('renders the market turnover card with 涨跌数 alongside the sentiment counts', () => {
    render(
      <MarketOverview
        indices={marketIndicesFixture()}
        turnover={1_737_546_140_000}
        breadth={{
          tradeDate: '20260819',
          previousTradeDate: '20260818',
          limitUpCount: 94,
          brokenCount: 25,
          promotionRate: 4.5,
          riseCount: 2528,
          fallCount: 2594,
          status: 'fresh',
        }}
      />,
    );

    const rise = screen.getByText('2528');
    const fall = screen.getByText('2594');

    expect(rise).toHaveClass('value--rise');
    expect(fall).toHaveClass('value--fall');
    expect(screen.getByText('涨跌数')).toBeInTheDocument();
    expect(screen.getByText('94')).toBeInTheDocument();
    expect(screen.getByText('4.5%')).toBeInTheDocument();
  });

  it('renders the limit-up table contract columns sorted by board count descending and shows stale and empty states', () => {
    const staleData = limitUpResponseFixture({ status: 'stale' });
    const emptyData = limitUpResponseFixture({ items: [] });
    const { rerender } = render(
      <LimitUpList
        data={staleData}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
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
      '自选',
    ]);

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('桂发祥');
    expect(rows[2]).toHaveTextContent('ST中华');
    expect(rows[1]).toHaveTextContent('002820');
    expect(rows[1]).toHaveTextContent('3 连板');
    expect(rows[1]).toHaveTextContent('食品饮料');
    expect(rows[1]).toHaveTextContent('12.27');
    expect(rows[1]).toHaveTextContent('+10.04%');
    expect(Array.from(rows[2].querySelectorAll('td')).map((cell) => cell.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
      // 最后一格是行尾的「添加自选」按钮
      '添加自选',
    ]);
    expect(screen.queryByText('包含 ST / 风险标的')).not.toBeInTheDocument();
    expect(screen.getByText('数据已过期')).toBeInTheDocument();
    expect(screen.getByText('2026-08-19')).toBeInTheDocument();
    expect(screen.getByText('2 只')).toBeInTheDocument();
    // 名称右边不再放标签，所以「3 连板」只出现在「连板」列里
    expect(screen.getAllByText('3 连板')).toHaveLength(1);
    expect(document.querySelector('.stock-tag')).toBeNull();
    expect(screen.getAllByText('—')).not.toHaveLength(0);

    rerender(
      <LimitUpList
        data={emptyData}
        isRefreshing={true}
        onRefresh={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    expect(screen.getByText('暂无涨停数据')).toBeInTheDocument();
    expect(screen.getByText('刷新中…')).toBeInTheDocument();
  });

  it('sorts limit-up rows by board count descending, then groups the same industry together', () => {
    render(
      <LimitUpList
        data={limitUpResponseFixture({
          items: [
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
            {
              symbol: '000001',
              name: '平安银行',
              price: 12.1,
              pct: 10.01,
              boardCount: 1,
              firstSealTime: '09:25:00',
              lastSealTime: '09:25:00',
              industry: '银行',
              breakCount: 0,
            },
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
              symbol: '002557',
              name: '洽洽食品',
              price: 18.8,
              pct: 10.02,
              boardCount: 3,
              firstSealTime: '09:30:00',
              lastSealTime: '10:12:00',
              industry: '食品饮料',
              breakCount: 0,
            },
            {
              symbol: '300014',
              name: '亿纬锂能',
              price: 42.1,
              pct: 10.01,
              boardCount: 3,
              firstSealTime: '09:32:00',
              lastSealTime: '11:00:00',
              industry: '电力设备',
              breakCount: 0,
            },
            {
              symbol: '300001',
              name: '特锐德',
              price: 20.5,
              pct: 20.01,
              boardCount: 2,
              firstSealTime: '09:30:00',
              lastSealTime: '10:00:00',
              industry: '电力设备',
              breakCount: 0,
            },
            {
              symbol: '300750',
              name: '宁德时代',
              price: 180.2,
              pct: 10.03,
              boardCount: 2,
              firstSealTime: '09:31:00',
              lastSealTime: '09:45:00',
              industry: '电力设备',
              breakCount: 0,
            },
            {
              symbol: '603288',
              name: '海天味业',
              price: 38.5,
              pct: 10.0,
              boardCount: 2,
              firstSealTime: '09:40:00',
              lastSealTime: '10:20:00',
              industry: '食品饮料',
              breakCount: 1,
            },
            {
              symbol: '600000',
              name: '浦发银行',
              price: 8.8,
              pct: 10.0,
              boardCount: 1,
              firstSealTime: '09:25:00',
              lastSealTime: '09:25:00',
              industry: null,
              breakCount: 0,
            },
          ],
        })}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('亿纬锂能');
    expect(rows[1]).toHaveTextContent('3 连板');
    expect(rows[1]).toHaveTextContent('电力设备');
    expect(rows[2]).toHaveTextContent('洽洽食品');
    expect(rows[2]).toHaveTextContent('3 连板');
    expect(rows[2]).toHaveTextContent('食品饮料');
    expect(rows[3]).toHaveTextContent('桂发祥');
    expect(rows[3]).toHaveTextContent('3 连板');
    expect(rows[3]).toHaveTextContent('食品饮料');
    expect(rows[4]).toHaveTextContent('特锐德');
    expect(rows[4]).toHaveTextContent('2 连板');
    expect(rows[4]).toHaveTextContent('电力设备');
    expect(rows[5]).toHaveTextContent('宁德时代');
    expect(rows[5]).toHaveTextContent('2 连板');
    expect(rows[5]).toHaveTextContent('电力设备');
    expect(rows[6]).toHaveTextContent('海天味业');
    expect(rows[6]).toHaveTextContent('2 连板');
    expect(rows[6]).toHaveTextContent('食品饮料');
    expect(rows[7]).toHaveTextContent('平安银行');
    expect(rows[7]).toHaveTextContent('1 连板');
    expect(rows[8]).toHaveTextContent('浦发银行');
    expect(rows[8]).toHaveTextContent('1 连板');
    expect(rows[9]).toHaveTextContent('ST中华');
  });

  it('adds a limit-up stock to the watchlist from the row-end button, greying out ones already there', async () => {
    const user = userEvent.setup();
    const onAddToWatchlist = vi.fn();

    render(
      <LimitUpList
        data={limitUpResponseFixture({
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
              symbol: '002557',
              name: '洽洽食品',
              price: 18.8,
              pct: 10.02,
              boardCount: 3,
              firstSealTime: '09:30:00',
              lastSealTime: '10:12:00',
              industry: '食品饮料',
              breakCount: 0,
            },
          ],
        })}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onAddToWatchlist={onAddToWatchlist}
        watchlistSymbols={new Set(['002557'])}
      />,
    );

    // 没在自选里的：按钮可点，把代码和名称原样交给宿主
    await user.click(screen.getByRole('button', { name: '添加 桂发祥 到自选' }));
    expect(onAddToWatchlist).toHaveBeenCalledWith({ symbol: '002820', name: '桂发祥' });

    // 已经在自选里的：置灰显示「已在自选」，点了也不再回调
    const added = screen.getByRole('button', { name: '洽洽食品 已在自选' });
    expect(added).toBeDisabled();
    expect(added).toHaveTextContent('已在自选');
    await user.click(added);
    expect(onAddToWatchlist).toHaveBeenCalledTimes(1);
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
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    expect(screen.getByText('涨停数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('暂无可用涨停数据')).toBeInTheDocument();
    expect(screen.getByText('交易日：暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('数据已过期')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 警示按钮：题材页与趋势页共用的「⚠ 标题 ▸」+ 面板
// ---------------------------------------------------------------------------

describe('WarningNotes', () => {
  it('默认收起，点开才显示正文，再点一次收起', async () => {
    const user = userEvent.setup();
    render(
      <WarningNotes title="数据说明与限制" count={2}>
        <p>第一条限制</p>
        <p>第二条限制</p>
      </WarningNotes>,
    );

    const toggle = screen.getByRole('button', { name: /数据说明与限制/ });
    expect(toggle.textContent).toContain('（2 条）');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('hidden')).toBe(true);
    // 正文不能藏在折叠的 details 里，否则点了按钮也看不到
    expect(panel?.closest('details')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText('第一条限制')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel?.hasAttribute('hidden')).toBe(true);
  });

  it('没有正文时不渲染按钮，避免点了什么都没有', () => {
    render(
      <WarningNotes title="数据说明与限制" count={0}>
        {null}
      </WarningNotes>,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('有正文但条数为 0 时按钮照常显示，只是不写「（0 条）」', () => {
    render(
      <WarningNotes title="数据说明与限制" count={0}>
        <p>本次结果不完整</p>
      </WarningNotes>,
    );

    const toggle = screen.getByRole('button', { name: /数据说明与限制/ });
    expect(toggle.textContent).toContain('数据说明与限制');
    expect(toggle.textContent).not.toContain('0 条');
  });

  it('面板在标题行下面展开（和趋势页同一套行为），标题不被顶动', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div className="theme-title-row">
        <h2>新能源车</h2>
        <WarningNotes title="数据说明与限制" count={1}>
          <p>本次结果不完整</p>
        </WarningNotes>
      </div>,
    );

    const row = container.querySelector('.theme-title-row') as HTMLElement;
    const title = screen.getByRole('heading', { name: '新能源车' });
    const toggle = screen.getByRole('button', { name: /数据说明与限制/ });
    const panelId = toggle.getAttribute('aria-controls') ?? '';
    const panel = () => document.getElementById(panelId);
    const rowHeight = row.offsetHeight;

    expect(panel()?.hasAttribute('hidden')).toBe(true);

    await user.click(toggle);

    // 展开后标题行高度不变：面板是换行项，不长在标题那一行里
    expect(row.offsetHeight).toBe(rowHeight);
    // 面板在标题之后，且不在折叠的 details 里
    expect(
      title.compareDocumentPosition(panel() as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(panel()?.closest('details')).toBeNull();
    expect(panel()?.hasAttribute('hidden')).toBe(false);

    await user.click(screen.getByRole('button', { name: /数据说明与限制/ }));
    expect(panel()?.hasAttribute('hidden')).toBe(true);
  });
});
