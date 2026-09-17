import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenerPanel, type ScreenerTab } from './ScreenerPanel';

const themeMetrics = [
  { key: 'duration', label: '持续时间', hit: true, value: '6 天', detail: '连续 6 个交易日涨停家数 ≥2' },
  { key: 'limitUpCount', label: '涨停家数', hit: true, value: '12 只', detail: '主线要求 ≥5' },
  { key: 'ladder', label: '连板梯队', hit: true, value: '最高 5 板', detail: '梯队完整' },
  { key: 'amount', label: '成交额', hit: false, value: '1.08 倍', detail: '要求放大 ≥1.15 倍' },
  { key: 'catalyst', label: '催化强度', hit: false, value: '未识别', detail: '未命中关键词' },
  { key: 'leader', label: '龙头表现', hit: true, value: '澳弘电子', detail: '最高 5 板' },
  { key: 'revival', label: '回流能力', hit: true, value: '分歧后回升', detail: '分歧后回升' },
  { key: 'influence', label: '市场影响力', hit: true, value: '较上证 +0.7%', detail: '跑赢上证' },
];

const themeItem = {
  code: 'BK0900',
  name: '新能源车',
  kind: 'main' as const,
  pct: 0.29,
  limitUpCount: 12,
  continuousCount: 4,
  maxBoard: 5,
  maxBoardLabel: '5 板',
  durationDays: 6,
  amount: 4.7e11,
  amountRatio: 25.85,
  catalysts: ['量产', '订单'],
  leader: { symbol: '605058', name: '澳弘电子', boardCount: 5, highLabel: '5 板' },
  metrics: themeMetrics,
  score: 6,
  classificationReasons: ['最近 3 个交易日驱动有依据家数 5/2/2'],
  conceptLimitUpCount: 12,
  supportedLimitUpCount: 5,
  unresolvedLimitUpCount: 7,
};

const branchItem = {
  ...themeItem,
  code: 'BK0590',
  name: '西部大开发',
  kind: 'branch' as const,
  limitUpCount: 8,
  score: 3,
  conceptLimitUpCount: 8,
  supportedLimitUpCount: 2,
  unresolvedLimitUpCount: 6,
};

const pendingItem = {
  ...themeItem,
  code: 'BK0666',
  name: '待确认题材',
  kind: 'branch' as const,
  limitUpCount: 3,
  conceptLimitUpCount: 3,
  supportedLimitUpCount: 1,
  unresolvedLimitUpCount: 1,
};

const trendPick = {
  symbol: '300499',
  name: '高澜股份',
  themes: [{ code: 'BK0900', name: '新能源车' }],
  industry: '专用设备',
  price: 38.26,
  pct: 0.21,
  ma5: 37.18,
  ma10: 36.21,
  ma20: 33.68,
  distMa5: 2.9,
  stableDays: 4,
  shrink: 0.88,
  pctWindow: 13.06,
  avgAmount5d: 1.48e9,
  turnoverRate: 13.9,
  matched: ['5/10/20 日线多头排列', '连续 4 日站稳 5 日线'],
  unmatched: [],
};

/** v2 详情响应：一张表 + 角色标签，同股多标签只有一行 */
const detailPayload = {
  schemaVersion: 2,
  ruleVersion: 'roles-v1-2026-09-18+classify-v2',
  tradeDate: '20260917',
  asOf: '2026-09-17T14:00:00.000Z',
  theme: { code: 'BK0900', name: '新能源车' },
  items: [
    {
      symbol: '605058',
      name: '澳弘电子',
      price: 48.76,
      pct: 9.99,
      boardCount: 5,
      firstSealTime: '09:31:01',
      sealType: '换手板',
      openCount: 1,
      sealAmount: 3e7,
      turnoverRate: 15.8,
      amount: 1.08e9,
      avgAmount3d: 7.63e8,
      avgAmount5d: 7.1e8,
      floatMarketCap: 6.97e9,
      reason: 'PCB + HDI板',
      precise: true,
      hits: [],
      misses: [],
      risks: [],
      ma5: 40.67,
      ma10: 34.8,
      ma20: 31.09,
      maBull: true,
      distMa5: 19.9,
      distMa10: 40.1,
      stableDays10: 9,
      pct10: 52.3,
      pct20: 78.1,
      limitUpIn60d: 3,
      quoteAsOf: '2026-09-17T14:00:00.000Z',
      relation: {
        state: 'supported',
        evidenceIds: ['ev-1'],
        reasons: ['本轮有明确依据：PCB'],
        alternativeThemeCodes: [],
        topicKeys: [],
        asOf: '2026-09-17T14:00:00.000Z',
      },
      roles: [
        {
          role: 'leader',
          status: 'candidate',
          reasons: ['题材内龙头候选比较排名第 1'],
          missingEvidence: ['分时带动证据：缺少分钟级带动证据，v1 只能给「龙头候选」'],
          assignedAt: '2026-09-17T14:00:00.000Z',
          ruleVersion: 'roles-v1-2026-09-18',
        },
        {
          role: 'trend',
          status: 'candidate',
          reasons: ['题材内趋势中军候选比较排名第 1'],
          missingEvidence: [],
          assignedAt: '2026-09-17T14:00:00.000Z',
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
            reason: '缺少分钟级带动证据，v1 只能给「龙头候选」，不能输出确认龙头',
            evidenceIds: [],
          },
        ],
      },
      metricsState: 'ready',
      metricsTradeDate: '20260917',
      risksChecked: true,
    },
    {
      symbol: '600002',
      name: '仅概念股',
      price: 12.3,
      pct: 1.2,
      boardCount: null,
      firstSealTime: null,
      sealType: null,
      openCount: null,
      sealAmount: null,
      turnoverRate: 3.2,
      amount: 2e8,
      avgAmount3d: null,
      avgAmount5d: null,
      floatMarketCap: 8e9,
      reason: null,
      precise: true,
      hits: [],
      misses: [],
      risks: [],
      ma5: null,
      ma10: null,
      ma20: null,
      maBull: null,
      distMa5: null,
      distMa10: null,
      stableDays10: null,
      pct10: null,
      pct20: null,
      limitUpIn60d: null,
      quoteAsOf: '2026-09-17T14:00:00.000Z',
      relation: {
        state: 'membership_only',
        evidenceIds: [],
        reasons: ['只有静态概念归属，没有本轮驱动依据'],
        alternativeThemeCodes: [],
        topicKeys: [],
        asOf: '2026-09-17T14:00:00.000Z',
      },
      roles: [],
      checks: {},
      metricsState: 'ready',
      metricsTradeDate: '20260917',
      risksChecked: false,
    },
  ],
  evidence: [
    {
      id: 'ev-1',
      themeCode: 'BK0900',
      symbol: '605058',
      sourceKind: 'limit_up_reason',
      sourceName: '同花顺涨停池',
      sourceUrl: null,
      text: 'PCB',
      publishedAt: null,
      observedAt: '2026-09-17T14:00:00.000Z',
      validTradeDate: '20260917',
      topicKey: null,
      match: 'ambiguous',
    },
  ],
  coverage: { total: 30, attempted: 25, succeeded: 24, failed: 1, unscanned: 5 },
  status: 'partial',
  warnings: ['1 只成员日K取数失败，按「数据缺失」展示，不当作不达标'],
  error: null,
};

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const installFetch = () => {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/screener/trend')) {
      return json({
        tradeDate: '20260917',
        items: [trendPick],
        scanned: 260,
        candidates: 294,
        filters: {
          themeScope: 'main',
          maxMa5Dist: 4,
          maxPct: 20,
          pctWindow: 10,
          minStableDays: 3,
          minAmountYi: 5,
          minScore: 5,
          mainOnly: false,
          excludeSt: false,
        },
        fetchedAt: '2026-09-17T14:00:00.000Z',
        source: 'eastmoney+10jqka',
        status: 'fresh',
        error: null,
      });
    }
    if (url.includes('/detail')) {
      return json(detailPayload);
    }
    if (url.startsWith('/api/themes')) {
      return json({
        schemaVersion: 2,
        tradeDate: '20260917',
        main: [themeItem],
        branch: [branchItem],
        pending: [pendingItem],
        fetchedAt: '2026-09-17T14:00:00.000Z',
        source: 'eastmoney+10jqka',
        status: 'fresh',
        warnings: [],
        error: null,
      });
    }
    throw new Error(`未预期的请求：${url}`);
  });
  vi.stubGlobal('fetch', impl);
  return impl;
};

const Harness = ({
  onAddToWatchlist = vi.fn(),
  watchlistSymbols = new Set<string>(),
}: {
  onAddToWatchlist?: (stock: { symbol: string; name: string }) => void;
  watchlistSymbols?: ReadonlySet<string>;
} = {}) => {
  const [tab, setTab] = useState<ScreenerTab>('trend');
  return (
    <ScreenerPanel
      activeTab={tab}
      onTabChange={setTab}
      onAddToWatchlist={onAddToWatchlist}
      watchlistSymbols={watchlistSymbols}
    />
  );
};

describe('ScreenerPanel', () => {
  beforeEach(() => {
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('默认展示趋势页，并且把受限的研究结论收在标题行的警示按钮里', async () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: '趋势' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: '趋势形态扫描（不是选股信号）' }),
    ).toBeInTheDocument();

    // 开关是标题行上的警示按钮：默认收起，正文（受限结论）不显示
    const toggle = screen.getByRole('button', { name: /研究结论/ });
    const header = screen
      .getByRole('heading', { name: '趋势形态扫描（不是选股信号）' })
      .closest('.overview__header');
    expect(header?.contains(toggle)).toBe(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.getAttribute('title')).toContain('不支持收益优势');
    expect(toggle.getAttribute('title')).not.toContain('已被本项目回测否定');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel?.hasAttribute('hidden')).toBe(true);
    expect(panel?.textContent ?? '').not.toContain('已被本项目回测否定');

    expect(await screen.findByText('高澜股份')).toBeInTheDocument();
  });

  it('切到题材页显示主线 / 支线 / 待确认，点击进入详情', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));

    expect(await screen.findByRole('heading', { name: '主线题材' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '支线题材' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待确认题材' })).toBeInTheDocument();
    expect(screen.getAllByText('新能源车').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '查看 新能源车 的题材详情' }));

    expect(
      await screen.findByRole('heading', { name: /新能源车 · 概念成员涨停 12 只/ }),
    ).toBeInTheDocument();
  });

  it('题材详情只有一张表，没有四个角色页签', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));

    await screen.findByRole('heading', { name: /新能源车 · 概念成员涨停/ });

    for (const label of ['主线龙头', '主线换手核心', '主线趋势中军', '主线低位补涨']) {
      expect(screen.queryByRole('tab', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole('table')).toHaveLength(1);
    // 同股双标签只占一行：两个角色标签合并在同一行的「角色」列里
    const row = document.querySelector('tbody tr');
    expect(row?.textContent).toContain('澳弘电子');
    expect(row?.textContent).toContain('龙头候选');
    expect(row?.textContent).toContain('趋势中军候选');
    expect(screen.getByText('龙头候选')).toBeInTheDocument();
    expect(screen.getByText('趋势中军候选')).toBeInTheDocument();
  });

  it('仅概念归属的股票没有确定角色，并标注本轮关联', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));

    expect(await screen.findByText('仅概念股')).toBeInTheDocument();
    expect(screen.getByText('仅概念归属')).toBeInTheDocument();
    expect(screen.getByText('仅概念归属，不发确定角色')).toBeInTheDocument();
  });

  it('覆盖不足时显示 partial 提示与覆盖数，不假装全题材已扫描', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));
    await screen.findByText('仅概念股');

    // 覆盖不足的说明收在标题旁的警示按钮里：点开才显示
    const toggle = await screen.findByRole('button', { name: /数据说明与限制/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(
      await screen.findByText(/本次结果不完整（有失败或未扫描成员）/),
    ).toBeInTheDocument();

    const coverageText = document.querySelector('.overview__actions')?.textContent ?? '';
    expect(coverageText).toContain('未扫描');
  });

  it('「只看有角色标签」会隐藏无标签成员', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));
    await screen.findByText('仅概念股');

    await user.click(screen.getByRole('checkbox', { name: '只看有角色标签' }));

    await waitFor(() => expect(screen.queryByText('仅概念股')).not.toBeInTheDocument());
    expect(document.querySelector('tbody')?.textContent).toContain('澳弘电子');
  });

  it('键盘可以展开判断详情', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));

    // 点（或聚焦后回车）股票那一行就展开，不再有单独的「展开」按钮
    const row = (
      await screen.findByText('澳弘电子', { exact: false, selector: '.stock-identity__name' })
    ).closest('tr') as HTMLTableRowElement;
    row.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/本轮关联依据/)).toBeInTheDocument();
    expect(screen.getByText(/缺少分钟级带动证据/)).toBeInTheDocument();
  });

  it('数据不可用时给出可见提示而不是白屏', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: '上游失败' })),
    );

    render(<Harness />);

    await waitFor(() => expect(screen.getByText('形态扫描暂不可用。')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: '题材' })).toBeInTheDocument();
  });

  it('趋势表与题材详情每行末尾都有「添加自选」，已在自选的置灰', async () => {
    const user = userEvent.setup();
    const onAddToWatchlist = vi.fn();
    render(
      <Harness onAddToWatchlist={onAddToWatchlist} watchlistSymbols={new Set(['605058'])} />,
    );

    // 趋势表：不在自选 → 可点，回调拿到代码与名称
    await user.click(await screen.findByRole('button', { name: '添加 高澜股份 到自选' }));
    expect(onAddToWatchlist).toHaveBeenCalledWith({ symbol: '300499', name: '高澜股份' });

    // 题材详情：605058 已在自选 → 置灰；另一只仍可点
    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));

    expect(await screen.findByRole('button', { name: '澳弘电子 已在自选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加 仅概念股 到自选' })).toBeEnabled();
  });
});
