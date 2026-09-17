import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeItem } from '../types';
import { ThemeDetail, themeRowRenderCount } from './ThemeDetail';

/**
 * 回归测试：点一行展开时，**不能**把所有行都重新渲染一遍。
 *
 * 背景：展开状态原先放在 ThemeDetail 里，整张表又是 ThemeDetail 的渲染产物，
 * 于是点一行会让父组件重跑整个 visibleItems.map(...)。宽基概念（新能源车 700+ 只成员）
 * 下，每次点击要重新创建整张表的元素树并逐个 diff：实测点击到下一帧 200–440ms
 * （4× CPU 降速；dev 下 1.5–2s），而真正变化的 DOM 只有一行。
 *
 * 这里通过 spy 一个「每行都会渲染一次」的子组件来数渲染次数：
 * 点一行之后，新增渲染次数必须等于 1，而不是等于行数。
 */

const renderCounts = { current: 0 };

vi.mock('./AddToWatchlistButton', () => ({
  AddToWatchlistButton: () => {
    renderCounts.current += 1;
    return null;
  },
}));

const themeItem = (code: string, name: string): ThemeItem => ({
  code,
  name,
  kind: 'main',
  pct: 1.2,
  limitUpCount: 5,
  continuousCount: 2,
  maxBoard: 3,
  maxBoardLabel: '3 板',
  durationDays: 3,
  amount: 4.7e11,
  amountRatio: 25.85,
  catalysts: ['PCB'],
  leader: null,
  metrics: [],
  score: 5,
  classificationReasons: [],
  conceptLimitUpCount: 5,
  supportedLimitUpCount: 3,
  unresolvedLimitUpCount: 2,
});

const stockRow = (symbol: string, name: string) => ({
  symbol,
  name,
  price: 11,
  pct: 9.99,
  boardCount: 3,
  firstSealTime: '09:31:01',
  sealType: '换手板',
  openCount: 0,
  sealAmount: 3e7,
  turnoverRate: 12,
  amount: 1.08e9,
  avgAmount3d: 7.63e8,
  avgAmount5d: 7.1e8,
  floatMarketCap: 6.97e9,
  reason: 'PCB',
  precise: true,
  hits: [],
  misses: [],
  risks: [],
  ma5: 10.5,
  ma10: 10.2,
  ma20: 10,
  maBull: true,
  distMa5: 4.8,
  distMa10: 7.8,
  stableDays10: 8,
  pct10: 12,
  pct20: 18,
  limitUpIn60d: 2,
  quoteAsOf: '2026-09-18T07:10:00.000Z',
  relation: {
    state: 'membership_only',
    evidenceIds: [],
    reasons: ['只有静态概念归属'],
    alternativeThemeCodes: [],
    topicKeys: [],
    asOf: '2026-09-18T07:10:00.000Z',
  },
  roles: [],
  checks: {},
  metricsState: 'ready',
  metricsTradeDate: '20260918',
  risksChecked: false,
});

const PAYLOAD = {
  schemaVersion: 2,
  ruleVersion: 'roles-v1-2026-09-18+classify-v2',
  tradeDate: '20260918',
  asOf: '2026-09-18T07:10:00.000Z',
  theme: { code: 'BK0900', name: '新能源车' },
  items: [
    stockRow('600001', '甲股票'),
    stockRow('600002', '乙股票'),
    stockRow('600003', '丙股票'),
    stockRow('600004', '丁股票'),
    stockRow('600005', '戊股票'),
    stockRow('600006', '己股票'),
  ],
  evidence: [],
  coverage: { total: 6, attempted: 6, succeeded: 6, failed: 0, unscanned: 0 },
  status: 'fresh',
  warnings: [],
  error: null,
};

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  renderCounts.current = 0;
  themeRowRenderCount.current = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeDetail 行渲染成本', () => {
  it('点一行展开只重渲染那一行，其余行不跟着重渲染', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json(PAYLOAD)));

    render(
      <ThemeDetail
        theme={themeItem('BK0900', '新能源车')}
        onBack={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    await screen.findByText('甲股票');
    expect(screen.getAllByRole('row')).toHaveLength(7); // 表头 + 6 行

    // 数据到位后的补渲染先结算掉，再开始计数
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(6));

    renderCounts.current = 0;
    await user.click(screen.getByText('甲股票').closest('tr') as HTMLElement);
    await screen.findByText(/本轮关联依据/);

    // 关键断言：只多渲染 1 行；如果退回「父组件内联 map」的写法，这里会是 6
    expect(renderCounts.current).toBe(1);

    // 收起同样只动一行
    renderCounts.current = 0;
    await user.click(screen.getByText('甲股票').closest('tr') as HTMLElement);
    await waitFor(() => expect(screen.queryByText(/本轮关联依据/)).not.toBeInTheDocument());
    expect(renderCounts.current).toBe(1);
  });

  it('父组件因为外部原因重渲染时，未变化的行靠 memo 跳过（不重复渲染子组件）', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json(PAYLOAD)));

    const { rerender } = render(
      <ThemeDetail
        theme={themeItem('BK0900', '新能源车')}
        onBack={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    await screen.findByText('甲股票');
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(6));

    // 换一个「整表重渲染」的触发点：搜索框输入（visibleItems 变化）
    renderCounts.current = 0;
    await user.type(screen.getByRole('searchbox', { name: '搜索股票' }), '甲');
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1));
    // 过滤后只剩 1 行；输入 1 个字符期间的重渲染每次最多渲染 1 行（其余行被 memo 挡住）
    expect(renderCounts.current).toBeLessThanOrEqual(2);

    // 外部 props 不变时 rerender：行不应重新渲染
    renderCounts.current = 0;
    rerender(
      <ThemeDetail
        theme={themeItem('BK0900', '新能源车')}
        onBack={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );
    expect(renderCounts.current).toBe(1);
  });

  it('展开态不跨行串台：同时只有点中的那一行展开', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json(PAYLOAD)));

    render(
      <ThemeDetail
        theme={themeItem('BK0900', '新能源车')}
        onBack={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    await screen.findByText('甲股票');
    await user.click(screen.getByText('甲股票').closest('tr') as HTMLElement);
    expect(await screen.findByText(/本轮关联依据/)).toBeInTheDocument();
    expect(document.querySelectorAll('tr.is-expanded')).toHaveLength(1);

    await user.click(screen.getByText('丙股票').closest('tr') as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('tr.is-expanded')).toHaveLength(1));
    const expanded = document.querySelector('tr.is-expanded');
    expect(expanded?.textContent).toContain('丙股票');
  });
});

/**
 * 这里测的是 ThemeRow 组件本身的渲染次数（themeRowRenderCount）：
 * 比 spy 子组件更直接 —— 行的渲染函数没跑，就是没跑。
 */
describe('ThemeRow 渲染次数', () => {
  it('点一行展开时，只有那一行的渲染函数被执行', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json(PAYLOAD)));

    render(
      <ThemeDetail
        theme={themeItem('BK0900', '新能源车')}
        onBack={vi.fn()}
        onAddToWatchlist={vi.fn()}
        watchlistSymbols={new Set<string>()}
      />,
    );

    await screen.findByText('甲股票');
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(6));

    themeRowRenderCount.current = 0;
    await user.click(screen.getByText('甲股票').closest('tr') as HTMLElement);
    await screen.findByText(/本轮关联依据/);

    // 6 行里只有被点的那一行渲染；退回内联 map 写法时这里会是 6
    expect(themeRowRenderCount.current).toBe(1);
  });
});
