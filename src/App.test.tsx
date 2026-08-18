import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { QuotesResponse, StorageState } from './types';

const makeResponse = (response: Partial<QuotesResponse> = {}): Response =>
  new Response(
    JSON.stringify({
      quotes: [],
      fetchedAt: '2026-08-18T10:30:00.000Z',
      source: 'eastmoney',
      errors: [],
      ...response,
    }),
  );

describe('Task 7 app interactions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeResponse({
          quotes: [
            {
              symbol: '600519',
              name: '贵州茅台',
              price: 168.2,
              change: 3.2,
              pct: 1.98,
              preClose: 165,
              updatedAt: '2026-08-18T10:30:00.000Z',
              source: 'eastmoney',
              status: 'fresh',
            },
          ],
        }),
      ),
    );
  });

  it('adds a holding, persists its note, and filters by group', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '长期持仓');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    await user.selectOptions(screen.getByLabelText('分组'), '长期持仓');
    await user.type(screen.getByLabelText('开仓价'), '160');
    await user.type(screen.getByLabelText('持有数量'), '100');
    await user.type(screen.getByLabelText('备注'), '观察业绩');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(screen.getByText('600519')).toBeInTheDocument();
    expect(screen.getByText('观察业绩')).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('观察业绩');

    await user.click(screen.getByRole('button', { name: '长期持仓' }));
    expect(screen.getByText('600519')).toBeInTheDocument();
  });

  it('moves holdings to ungrouped when a custom group is deleted', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '短线观察');
    await user.click(screen.getByRole('button', { name: '保存分组' }));
    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    await user.selectOptions(screen.getByLabelText('分组'), '短线观察');
    await user.type(screen.getByLabelText('开仓价'), '160');
    await user.type(screen.getByLabelText('持有数量'), '100');
    await user.click(screen.getByRole('button', { name: '保存股票' }));
    await user.click(screen.getByRole('button', { name: '短线观察' }));
    await user.click(screen.getByRole('button', { name: '编辑分组 短线观察' }));
    await user.click(screen.getByRole('button', { name: '删除分组' }));

    expect(screen.getByRole('button', { name: '未分组' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('600519')).toBeInTheDocument();
  });

  it('keeps the active filter when deleting a different custom group', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '短线观察');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '波段交易');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    await user.click(screen.getByRole('button', { name: '波段交易' }));
    await user.click(screen.getByRole('button', { name: '编辑分组 短线观察' }));
    await user.click(screen.getByRole('button', { name: '删除分组' }));

    expect(screen.getByRole('button', { name: '波段交易' })).toHaveAttribute('aria-current', 'true');
  });

  it('falls back to the edited symbol until a later refresh provides the runtime quote name', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeResponse({
          quotes: [
            {
              symbol: '600519',
              name: '贵州茅台',
              price: null,
              change: null,
              pct: null,
              preClose: 165,
              updatedAt: '2026-08-18T10:30:00.000Z',
              source: 'eastmoney',
              status: 'unavailable',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          quotes: [
            {
              symbol: '000001',
              name: '',
              price: null,
              change: null,
              pct: null,
              preClose: null,
              updatedAt: '2026-08-18T10:31:00.000Z',
              source: 'eastmoney',
              status: 'unavailable',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          quotes: [
            {
              symbol: '000001',
              name: '平安银行',
              price: 12.3,
              change: 0.1,
              pct: 0.82,
              preClose: 12.2,
              updatedAt: '2026-08-18T10:32:00.000Z',
              source: 'eastmoney',
              status: 'fresh',
            },
          ],
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const seededState: StorageState = {
      groups: [
        {
          id: 'ungrouped',
          name: '未分组',
          isSystem: true,
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      ],
      holdings: [
        {
          id: 'holding-1',
          symbol: '600519',
          name: '贵州茅台',
          groupId: 'ungrouped',
          openPrice: 160,
          quantity: 100,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };

    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));

    render(<App />);

    expect(await screen.findByText('暂无行情')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑 贵州茅台' }));
    await user.clear(screen.getByLabelText('股票代码'));
    await user.type(screen.getByLabelText('股票代码'), '000001');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(await screen.findByRole('button', { name: '编辑 000001' })).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('"name":"000001"');

    await user.click(screen.getByRole('button', { name: '刷新行情' }));

    expect(await screen.findByText('平安银行')).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('"name":"000001"');
    expect(localStorage.getItem('stock-dashboard:v1')).not.toContain('平安银行');
  });
});
