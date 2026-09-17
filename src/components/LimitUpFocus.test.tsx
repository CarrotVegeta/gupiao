import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LimitUpResponse, SprintLimitUpResponse } from '../types';
import { LimitUpFocus } from './LimitUpFocus';

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

describe('LimitUpFocus', () => {
  it('switches between the two inner navigation tabs and shows only the selected list', async () => {
    const user = userEvent.setup();

    const Harness = () => {
      const [activeTab, setActiveTab] = useState<'pool' | 'sprint'>('pool');

      return (
        <LimitUpFocus
          activeTab={activeTab}
          onTabChange={setActiveTab}
          poolData={poolResponse}
          isPoolRefreshing={false}
          onRefreshPool={vi.fn()}
          sprintData={sprintResponse}
          isSprintRefreshing={false}
          onRefreshSprint={vi.fn()}
        />
      );
    };

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
});
