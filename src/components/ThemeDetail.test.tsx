import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeItem } from '../types';
import { ThemeDetail } from './ThemeDetail';

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
  leader: { symbol: '600001', name: '甲股票', boardCount: 3, highLabel: '3 板' },
  metrics: [
    { key: 'duration', label: '持续时间', hit: true, value: '3 天', detail: '连续 3 个交易日' },
  ],
  score: 5,
  classificationReasons: ['最近 3 个交易日驱动有依据家数 5/2/2'],
  conceptLimitUpCount: 5,
  supportedLimitUpCount: 3,
  unresolvedLimitUpCount: 2,
});

const stockRow = (overrides: Record<string, unknown>) => ({
  symbol: '600001',
  name: '甲股票',
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
    state: 'supported',
    evidenceIds: ['ev-1'],
    reasons: ['本轮有明确依据：PCB'],
    alternativeThemeCodes: [],
    topicKeys: ['pcb'],
    asOf: '2026-09-18T07:10:00.000Z',
  },
  roles: [
    {
      role: 'leader',
      status: 'candidate',
      reasons: ['题材内龙头候选比较排名第 1'],
      missingEvidence: ['分时带动证据：缺少分钟级带动证据'],
      assignedAt: '2026-09-18T07:10:00.000Z',
      ruleVersion: 'roles-v1-2026-09-18',
    },
    {
      role: 'turnover',
      status: 'candidate',
      reasons: ['题材内核心候选比较排名第 1'],
      missingEvidence: [],
      assignedAt: '2026-09-18T07:10:00.000Z',
      ruleVersion: 'roles-v1-2026-09-18',
    },
  ],
  checks: {
    leader: [
      { key: '本轮关联', state: 'pass', value: 'supported', reason: '驱动有依据', evidenceIds: [] },
      {
        key: '分时带动证据',
        state: 'pending',
        value: null,
        reason: '缺少分钟级带动证据，v1 只能给「龙头候选」',
        evidenceIds: ['ev-1'],
      },
    ],
  },
  metricsState: 'ready',
  metricsTradeDate: '20260918',
  risksChecked: true,
  ...overrides,
});

const membershipRow = (symbol: string, name: string) =>
  stockRow({
    symbol,
    name,
    boardCount: null,
    firstSealTime: null,
    sealType: null,
    openCount: null,
    reason: null,
    roles: [],
    checks: {},
    risksChecked: false,
    relation: {
      state: 'membership_only',
      evidenceIds: [],
      reasons: ['只有静态概念归属，没有本轮驱动依据'],
      alternativeThemeCodes: [],
      topicKeys: [],
      asOf: '2026-09-18T07:10:00.000Z',
    },
  });

const detailPayload = (
  code: string,
  name: string,
  items: unknown[],
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 2,
  ruleVersion: 'roles-v1-2026-09-18+classify-v2',
  tradeDate: '20260918',
  asOf: '2026-09-18T07:10:00.000Z',
  theme: { code, name },
  items,
  evidence: [
    {
      id: 'ev-1',
      themeCode: code,
      symbol: '600001',
      sourceKind: 'limit_up_reason',
      sourceName: '同花顺涨停池',
      sourceUrl: null,
      text: 'PCB',
      publishedAt: null,
      observedAt: '2026-09-18T07:10:00.000Z',
      validTradeDate: '20260918',
      topicKey: 'pcb',
      match: 'exact',
    },
  ],
  coverage: { total: 30, attempted: 25, succeeded: 24, failed: 1, unscanned: 5 },
  status: 'partial',
  warnings: ['题材共 30 只成员，本次扫描 25 只'],
  error: null,
  ...overrides,
});

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** 可控 deferred：用于断言乱序返回不会串板块 */
const deferred = () => {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/** 默认：自选为空、加入自选是空实现；要断言按钮的测试自己传 watchlistSymbols / onAddToWatchlist */
const renderDetail = (
  theme: ThemeItem,
  props: { onAddToWatchlist?: (stock: { symbol: string; name: string }) => void; watchlistSymbols?: ReadonlySet<string> } = {},
) =>
  render(
    <ThemeDetail
      theme={theme}
      onBack={vi.fn()}
      onAddToWatchlist={props.onAddToWatchlist ?? vi.fn()}
      watchlistSymbols={props.watchlistSymbols ?? new Set<string>()}
    />,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeDetail', () => {
  it('没有四个角色页签，只有一张表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    await screen.findByText('甲股票');
    for (const label of ['主线龙头', '主线换手核心', '主线趋势中军', '主线低位补涨']) {
      expect(screen.queryByRole('tab', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('同股双标签只占一行，两个标签并排', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    const row = (await screen.findByText('甲股票')).closest('tr');
    expect(row?.textContent).toContain('龙头候选');
    expect(row?.textContent).toContain('核心候选（换手核心口径）');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('仅概念归属的股票显示「—」角色，并明说不发确定角色', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          detailPayload('BK0900', '新能源车', [
            stockRow({}),
            membershipRow('600002', '仅概念股'),
          ]),
        ),
      ),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    expect(await screen.findByText('仅概念股')).toBeInTheDocument();
    expect(screen.getByText('仅概念归属')).toBeInTheDocument();
    expect(screen.getByText('仅概念归属，不发确定角色')).toBeInTheDocument();
    const row = screen.getByText('仅概念股').closest('tr');
    expect(row?.querySelector('.theme-role-badges__empty')?.textContent).toBe('—');
  });

  it('点击股票行展开，再点一次收起', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    // 行本身就是开关：没有单独的「展开」按钮
    const row = (await screen.findByText('甲股票')).closest('tr') as HTMLTableRowElement;
    expect(screen.queryByRole('button', { name: /判断详情/ })).not.toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await user.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/缺少分钟级带动证据/)).toBeInTheDocument();
    expect(screen.getByText(/本轮关联依据/)).toBeInTheDocument();
    expect(screen.getByText(/证据：同花顺涨停池：PCB/)).toBeInTheDocument();
    expect(screen.getByText('已核验，未见减持 / 业绩 / ST 风险')).toBeInTheDocument();
    // 主表的风险列：已核验且无风险命中
    expect(row.textContent).toContain('未见');

    await user.click(row);
    await waitFor(() => expect(screen.queryByText(/本轮关联依据/)).not.toBeInTheDocument());
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('键盘可以展开与收起', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    const row = (await screen.findByText('甲股票')).closest('tr') as HTMLTableRowElement;
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/本轮关联依据/)).toBeInTheDocument();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText(/本轮关联依据/)).not.toBeInTheDocument());
  });

  it('不可用时给出可见提示，且不再出现旧版「没有满足硬条件」文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('上游失败');
      }),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    expect(await screen.findByText('该板块数据暂不可用。')).toBeInTheDocument();
    expect(
      screen.getByText('数据不可用，无法展示股票明细。'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/硬条件/)).toBeNull();
  });

  it('A→B 切换板块时，A 的请求晚返回不会覆盖 B 的结果', async () => {
    const first = deferred();
    const second = deferred();
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('BK0900')) return first.promise;
      if (url.includes('BK0590')) return second.promise;
      throw new Error(`未预期的请求：${url}`);
    });
    vi.stubGlobal('fetch', impl);

    const Harness = () => {
      const [code, setCode] = useState('BK0900');
      return (
        <>
          <button type="button" onClick={() => setCode('BK0590')}>
            切换到另一个板块
          </button>
          <ThemeDetail
            theme={themeItem(code, code === 'BK0900' ? '新能源车' : '西部大开发')}
            onBack={vi.fn()}
            onAddToWatchlist={vi.fn()}
            watchlistSymbols={new Set<string>()}
          />
        </>
      );
    };

    const user = userEvent.setup();
    render(<Harness />);

    // 等 A 的请求发出后再切到 B
    await waitFor(() => expect(impl).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '切换到另一个板块' }));
    await waitFor(() => expect(impl).toHaveBeenCalledTimes(2));

    // B 先返回，A 后返回：最终必须显示 B 的成员
    second.resolve(
      json(detailPayload('BK0590', '西部大开发', [membershipRow('600002', 'B题材成员')])),
    );
    expect(await screen.findByText('B题材成员')).toBeInTheDocument();

    first.resolve(json(detailPayload('BK0900', '新能源车', [stockRow({})])));
    await waitFor(() => expect(screen.queryByText('甲股票')).not.toBeInTheDocument());
    expect(screen.getByText('B题材成员')).toBeInTheDocument();
  });

  it('切换板块时不同键结果不会被当成当前结果（先显示加载态）', async () => {
    const first = deferred();
    const second = deferred();
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes('BK0900') ? first.promise : second.promise;
    });
    vi.stubGlobal('fetch', impl);

    const Harness = () => {
      const [code, setCode] = useState('BK0900');
      return (
        <>
          <button type="button" onClick={() => setCode('BK0590')}>
            切换
          </button>
          <ThemeDetail
            theme={themeItem(code, code === 'BK0900' ? '新能源车' : '西部大开发')}
            onBack={vi.fn()}
            onAddToWatchlist={vi.fn()}
            watchlistSymbols={new Set<string>()}
          />
        </>
      );
    };

    const user = userEvent.setup();
    render(<Harness />);
    first.resolve(json(detailPayload('BK0900', '新能源车', [stockRow({})])));
    expect(await screen.findByText('甲股票')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '切换' }));
    await waitFor(() => expect(screen.queryByText('甲股票')).not.toBeInTheDocument());
    expect(screen.getByText('该板块数据暂不可用。')).toBeInTheDocument();

    second.resolve(
      json(detailPayload('BK0590', '西部大开发', [membershipRow('600002', 'B题材成员')])),
    );
    expect(await screen.findByText('B题材成员')).toBeInTheDocument();
  });

  it('「只看有角色标签」隐藏无标签成员，搜索按代码 / 名称过滤', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          detailPayload('BK0900', '新能源车', [
            stockRow({}),
            membershipRow('600002', '仅概念股'),
          ]),
        ),
      ),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    await screen.findByText('仅概念股');
    await user.click(screen.getByRole('checkbox', { name: '只看有角色标签' }));
    await waitFor(() => expect(screen.queryByText('仅概念股')).not.toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: '搜索股票' });
    await user.type(search, '不存在');
    await waitFor(() =>
      expect(document.querySelector('.empty-state')?.textContent).toContain('没有匹配的成员'),
    );
  });

  it('分类依据与观察指标默认折叠，点开才显示', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    await screen.findByText('甲股票');
    const box = document.querySelector('.theme-detail__classification');
    const summary = document.querySelector('.theme-detail__classification-summary');
    expect(box?.tagName).toBe('DETAILS');
    expect(box?.hasAttribute('open')).toBe(false);
    // 折叠态摘要是一行：标签 + 依据条数（详细依据在折叠体里）
    expect(summary?.textContent).toContain('分类依据与观察指标');
    expect(summary?.textContent).toContain('等 1 条依据');
    // 旧指标列表在这个折叠体里
    const metrics = document.querySelector('.theme-detail__metrics');
    expect(box?.contains(metrics)).toBe(true);
    expect(metrics?.closest('details')).toBe(box);

    await user.click(summary as Element);
    expect(box?.hasAttribute('open')).toBe(true);
    expect(document.querySelectorAll('.theme-detail__metric')).toHaveLength(1);
  });

  it('partial 时覆盖说明与数据限制收在标题旁的警示按钮里，点开才显示', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    await screen.findByText('甲股票');

    // 按钮跟标题同排，默认收起；不能再出现占一整条高度的黄色横幅
    const heading = screen.getByRole('heading', { name: /新能源车/ });
    const toggle = screen.getByRole('button', { name: /数据说明与限制/ });
    const titleRow = heading.closest('.theme-title-row');
    expect(titleRow).not.toBeNull();
    expect(titleRow?.contains(toggle)).toBe(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.banner--warning')).toBeNull();
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('hidden')).toBe(true);

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel?.hasAttribute('hidden')).toBe(false);
    // 正文不能在折叠的 details 里，否则点了也看不到
    expect(panel?.closest('details')).toBeNull();
    expect(screen.getByText(/本次结果不完整（有失败或未扫描成员）/)).toBeInTheDocument();

    const meta = document.querySelector('.overview__actions')?.textContent ?? '';
    expect(meta).toContain('未扫描');
    expect(meta).toContain('失败');
  });

  it('规则版本与数据状态对用户可见', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(detailPayload('BK0900', '新能源车', [stockRow({})]))),
    );
    renderDetail(themeItem('BK0900', '新能源车'));

    await screen.findByText('甲股票');
    const notes = [...document.querySelectorAll('.status-note')]
      .map((node) => node.textContent ?? '')
      .join(' ');
    expect(notes).toContain('规则版本');
    expect(notes).toContain('roles-v1-2026-09-18+classify-v2');
  });

  it('每行末尾有「添加自选」，点它加自选但不展开这一行', async () => {
    const user = userEvent.setup();
    const onAddToWatchlist = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          detailPayload('BK0900', '新能源车', [
            stockRow({}),
            membershipRow('600002', '仅概念股'),
          ]),
        ),
      ),
    );
    // 600002 已经在自选里：按钮置灰，说明文案也换成「已在自选」
    renderDetail(themeItem('BK0900', '新能源车'), {
      onAddToWatchlist,
      watchlistSymbols: new Set(['600002']),
    });

    const row = (await screen.findByText('甲股票')).closest('tr') as HTMLTableRowElement;
    expect(row.lastElementChild?.textContent).toBe('添加自选');
    expect(screen.getByRole('button', { name: '仅概念股 已在自选' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '添加 甲股票 到自选' }));

    expect(onAddToWatchlist).toHaveBeenCalledWith({ symbol: '600001', name: '甲股票' });
    // 按钮吃掉了点击：整行没有跟着展开
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/本轮关联依据/)).not.toBeInTheDocument();
  });
});
