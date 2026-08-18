import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('Task 7 app interactions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
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
            fetchedAt: '2026-08-18T10:30:00.000Z',
            source: 'eastmoney',
            errors: [],
          }),
        ),
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
    await user.click(screen.getByRole('button', { name: '编辑分组 短线观察' }));
    await user.click(screen.getByRole('button', { name: '删除分组' }));

    expect(screen.getByRole('button', { name: '未分组' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('600519')).toBeInTheDocument();
  });
});
