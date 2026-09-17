import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type {
  AuctionResponse,
  DragonTigerResponse,
  LimitUpResponse,
  MarketOverviewResponse,
  QuotesResponse,
  SprintLimitUpResponse,
  StorageState,
} from './types';

type FetchPayload =
  | AuctionResponse
  | QuotesResponse
  | MarketOverviewResponse
  | LimitUpResponse
  | SprintLimitUpResponse
  | DragonTigerResponse;
type FetchReply = FetchPayload | Error | (() => Promise<Response>);

const makeResponse = (payload: FetchPayload): Response => new Response(JSON.stringify(payload));

const marketResponseFixture = (
  response: Partial<MarketOverviewResponse> = {},
): MarketOverviewResponse => ({
  turnover: 1_737_546_140_000,
  breadth: {
    tradeDate: '20260819',
    previousTradeDate: '20260818',
    limitUpCount: 94,
    brokenCount: 25,
    promotionRate: 4.5,
    riseCount: 2528,
    fallCount: 2594,
    status: 'fresh',
  },
  indices: [
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
      price: 2200.66,
      change: 8.11,
      pct: 0.37,
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
  ],
  fetchedAt: '2026-08-19T07:35:00.000Z',
  source: 'eastmoney',
  errors: [],
  ...response,
});

const quotesResponseFixture = (response: Partial<QuotesResponse> = {}): QuotesResponse => ({
  quotes: [],
  fetchedAt: '2026-08-18T10:30:00.000Z',
  source: 'eastmoney',
  errors: [],
  ...response,
});

const limitUpResponseFixture = (response: Partial<LimitUpResponse> = {}): LimitUpResponse => ({
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
      price: 5.21,
      pct: 4.98,
      boardCount: 2,
      firstSealTime: null,
      lastSealTime: null,
      industry: null,
      breakCount: 0,
    },
  ],
  fetchedAt: '2026-08-19T07:32:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...response,
});

const sprintLimitUpResponseFixture = (
  response: Partial<SprintLimitUpResponse> = {},
): SprintLimitUpResponse => ({
  tradeDate: '20260819',
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
  fetchedAt: '2026-08-19T07:36:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...response,
});

const dragonTigerResponseFixture = (
  response: Partial<DragonTigerResponse> = {},
): DragonTigerResponse => ({
  tradeDate: '20260819',
  items: [
    {
      symbol: '600000',
      name: '浦发银行',
      closePrice: 12.34,
      changePct: 5.67,
      reason: '日涨幅偏离值达到7%的前5只证券',
      buyAmount: 234_567_890,
      sellAmount: 123_456_789,
      netAmount: 111_111_101,
    },
  ],
  fetchedAt: '2026-08-19T07:35:00.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...response,
});

const auctionResponseFixture = (
  response: Partial<AuctionResponse> = {},
): AuctionResponse => ({
  tradeDate: '20260819',
  previousTradeDate: '20260818',
  snapshotTime: '09:25:00',
  items: [
    {
      symbol: '603000',
      name: '人民网',
      boardCount: 2,
      firstSealTime: '09:35:00',
      lastSealTime: '10:00:00',
      breakCount: 0,
      previousAmount: 100_000_000,
      sealAmount: 15_000_000,
      floatMarketCap: 1_000_000_000,
      auctionPrice: 10.4,
      auctionPct: 4,
      auctionAmount: 5_200_000,
      auctionRatio: 5.2,
      auctionPremium: 'rich',
      turnoverRate: 8.5,
      limitUpProbability: 0.62,
      sealedAtAuction: false,
      probabilityMissing: 0,
      result: 'qualified',
      reasons: ['竞价溢价 +4.00%（抬高概率）'],
    },
  ],
  fetchedAt: '2026-08-19T01:25:10.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...response,
});

const resolveFetchReply = (reply: FetchReply): Promise<Response> => {
  if (reply instanceof Error) {
    return Promise.reject(reply);
  }

  if (typeof reply === 'function') {
    return reply();
  }

  return Promise.resolve(makeResponse(reply));
};

const createFetchMock = ({
  market = [marketResponseFixture()],
  quotes = [
    quotesResponseFixture({
      quotes: [
        {
          symbol: '600519',
          name: '贵州茅台',
          price: 168.2,
          change: 3.2,
          pct: 1.98,
          turnover: 0.42,
          volumeRatio: 1.2,
          amount: 640_000_000,
          preClose: 165,
          updatedAt: '2026-08-18T10:30:00.000Z',
          source: 'eastmoney',
          status: 'fresh',
        },
      ],
    }),
  ],
  limitUp = [limitUpResponseFixture()],
  sprintLimitUp = [sprintLimitUpResponseFixture()],
  dragonTiger = [dragonTigerResponseFixture()],
  auction = [auctionResponseFixture()],
}: {
  market?: FetchReply[];
  quotes?: FetchReply[];
  limitUp?: FetchReply[];
  sprintLimitUp?: FetchReply[];
  dragonTiger?: FetchReply[];
  auction?: FetchReply[];
} = {}) => {
  let marketIndex = 0;
  let quotesIndex = 0;
  let limitUpIndex = 0;
  let sprintLimitUpIndex = 0;
  let dragonTigerIndex = 0;
  let auctionIndex = 0;

  const nextReply = (queue: FetchReply[], index: number): FetchReply =>
    queue[Math.min(index, queue.length - 1)];

  return vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === '/api/market-overview') {
      const reply = nextReply(market, marketIndex);
      marketIndex += 1;
      return resolveFetchReply(reply);
    }

    if (url.startsWith('/api/quotes?')) {
      const reply = nextReply(quotes, quotesIndex);
      quotesIndex += 1;
      return resolveFetchReply(reply);
    }

    if (url.startsWith('/api/limit-up')) {
      const reply = nextReply(limitUp, limitUpIndex);
      limitUpIndex += 1;
      return resolveFetchReply(reply);
    }

    if (url.startsWith('/api/sprint-limit-up')) {
      const reply = nextReply(sprintLimitUp, sprintLimitUpIndex);
      sprintLimitUpIndex += 1;
      return resolveFetchReply(reply);
    }

    if (url.startsWith('/api/dragon-tiger')) {
      const reply = nextReply(dragonTiger, dragonTigerIndex);
      dragonTigerIndex += 1;
      return resolveFetchReply(reply);
    }

    if (url.startsWith('/api/auction')) {
      const reply = nextReply(auction, auctionIndex);
      auctionIndex += 1;
      return resolveFetchReply(reply);
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
};

const getFetchUrls = (fetchMock: ReturnType<typeof vi.fn>, prefix: string): string[] =>
  fetchMock.mock.calls
    .map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    )
    .filter((url) => url.startsWith(prefix));

/**
 * 点顶栏一级导航的入口。
 * 自选页表头也有「持仓」档位（范围筛选），所以要限定在导航里查，避免二义。
 */
const clickPrimaryNav = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
): Promise<void> => {
  const nav = await screen.findByRole('navigation', { name: '一级导航' });

  await user.click(within(nav).getByRole('button', { name: label }));
};

/** 面板里的说明文字是一整段，用子串匹配而不是 getByText 的全等匹配 */
const hasText = (text: string) => (content: string, element: Element | null): boolean =>
  element?.tagName === 'P' && (content ?? '').includes(text);

/**
 * 新建分组只有自选页的「分组管理」面板这一个入口，
 * 持仓页表头只剩纯筛选，不再有「新建分组 / 编辑 / 删除」。
 */
const createGroupViaPanel = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> => {
  await user.click(screen.getByRole('button', { name: '分组管理' }));
  await user.click(screen.getByRole('button', { name: '新建分组' }));
  await user.type(screen.getByLabelText('分组名称'), name);
  await user.click(screen.getByRole('button', { name: '保存分组' }));
  await user.click(screen.getByRole('button', { name: '关闭' }));
};

describe('Task 7 app interactions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', createFetchMock());
  });

  it('shows the market overview above the holdings page and places group navigation before the stock list', async () => {
    const user = userEvent.setup();
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
          openPrice: 1200,
          quantity: 1,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));

    render(<App />);

    expect(await screen.findByRole('heading', { name: '大盘概览' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '一级导航' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '大盘概览' })).toBeInTheDocument();
    expect(screen.getByText('上证指数')).toBeInTheDocument();
    // 默认进入自选页：右侧常驻竞价候选，分组筛选在卡片表头里
    expect(screen.getByRole('button', { name: '自选 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation', { name: '自选筛选' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '持仓 1' }));

    expect(await screen.findByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();

    expect(await screen.findByRole('button', { name: '持仓 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // 分组筛选在卡片表头里，必须排在列表内容之前
    const groupHeading = screen.getByRole('navigation', { name: '持仓筛选' });
    const listTable = screen.getByRole('table');

    expect(
      groupHeading.compareDocumentPosition(listTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('keeps all three market placeholders unavailable when the first request rejects', async () => {
    const fetchMock = createFetchMock({ market: [new Error('network down')] });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    // 大盘刷新的入口已合并到顶栏「刷新行情」
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '刷新行情' })).not.toBeDisabled(),
    );
    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('深证成指')).toBeInTheDocument();
    expect(screen.getByText('创业板指')).toBeInTheDocument();
    expect(screen.getByText('两市成交')).toBeInTheDocument();
    expect(screen.getAllByText('无可用数据')).toHaveLength(3);
    expect(
      within(screen.getByRole('region', { name: '大盘概览' })).getAllByText('—'),
    ).toHaveLength(18);
  });

  it('requests and renders limit-up data when navigating, then restores holdings-only sections', async () => {
    const user = userEvent.setup();
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
          openPrice: 1200,
          quantity: 1,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = createFetchMock();
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    // 自选/持仓页也要用涨停池算名称旁的「涨停 / N 连板」标识，
    // 所以落地（自选）就会先拉一次池子。
    const poolCallsOnWatchlist = getFetchUrls(fetchMock, '/api/limit-up');
    expect(poolCallsOnWatchlist).toHaveLength(1);
    expect(poolCallsOnWatchlist[0]).toMatch(/^\/api\/limit-up\?date=\d{8}$/);

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));

    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(screen.getByText('桂发祥')).toBeInTheDocument();
    // 切到涨停聚焦再拉一次（同一个交易日，服务端结果一致）
    expect(getFetchUrls(fetchMock, '/api/limit-up')).toHaveLength(2);
    expect(getFetchUrls(fetchMock, '/api/limit-up')[0]).toMatch(/^\/api\/limit-up\?date=\d{8}$/);
    expect(screen.queryByRole('heading', { name: '总收益率' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '持仓筛选' })).not.toBeInTheDocument();
    // 「添加股票」在顶栏，任何页面都能用
    expect(screen.getByRole('button', { name: '添加股票' })).toBeInTheDocument();

    await clickPrimaryNav(user, /^持仓/);

    expect(await screen.findByRole('heading', { name: '总收益率' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();
  });

  it('preloads the auction snapshot for the rail and reuses it on the auction page', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    // 落地页右侧常驻竞价候选，进入自选页就拉一次
    await screen.findByRole('heading', { name: '竞价候选' });
    await waitFor(() => expect(getFetchUrls(fetchMock, '/api/auction')).toHaveLength(1));
    expect(getFetchUrls(fetchMock, '/api/auction')[0]).toMatch(/^\/api\/auction\?date=\d{8}$/);

    await user.click(screen.getByRole('button', { name: /^竞价/ }));

    expect(await screen.findByRole('heading', { name: '竞价连板候选' })).toBeInTheDocument();
    expect(screen.getByText('人民网')).toBeInTheDocument();
    expect(screen.getByText('合格')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    // 侧栏已拉过一次；进竞价页会再刷一次（服务端有 5 分钟缓存，代价很低）
    expect(getFetchUrls(fetchMock, '/api/auction').length).toBeGreaterThanOrEqual(1);
  });

  it('switches the two limit-up focus tabs and fetches the sprint list only when selected', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      sprintLimitUp: [sprintLimitUpResponseFixture()],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));
    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: '冲刺涨停' }));

    expect(await screen.findByRole('heading', { name: '冲刺涨停' })).toBeInTheDocument();
    expect(screen.getByText('冲刺样本')).toBeInTheDocument();
    expect(screen.queryByText('桂发祥')).not.toBeInTheDocument();
    expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')).toHaveLength(1);
    expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')[0]).toMatch(
      /^\/api\/sprint-limit-up\?date=\d{8}$/,
    );

    await user.click(screen.getByRole('tab', { name: '涨停池' }));

    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(screen.getByText('桂发祥')).toBeInTheDocument();
    expect(screen.queryByText('冲刺样本')).not.toBeInTheDocument();
  });

  it('requests and renders dragon-tiger data when navigating, then keeps the last rows after refresh failure', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      dragonTiger: [
        dragonTigerResponseFixture(),
        new Error('network down'),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    expect(getFetchUrls(fetchMock, '/api/dragon-tiger')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /龙虎榜/ }));

    expect(await screen.findByRole('heading', { name: '龙虎榜' })).toBeInTheDocument();
    expect(screen.getByText('浦发银行')).toBeInTheDocument();
    expect(getFetchUrls(fetchMock, '/api/dragon-tiger')).toHaveLength(1);
    expect(getFetchUrls(fetchMock, '/api/dragon-tiger')[0]).toMatch(
      /^\/api\/dragon-tiger\?date=\d{8}$/,
    );

    await user.click(screen.getByRole('button', { name: '刷新龙虎榜' }));

    expect(await screen.findByText('数据已过期')).toBeInTheDocument();
    expect(screen.getByText('浦发银行')).toBeInTheDocument();
    expect(screen.getByText('1.11 亿')).toHaveClass('value--rise');
  });

  it('shows an unavailable first-load state without mutating saved holdings', async () => {
    const user = userEvent.setup();
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
          openPrice: 1200,
          quantity: 1,
          note: '长期观察',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = createFetchMock({
      limitUp: [
        limitUpResponseFixture({
          tradeDate: null,
          items: [],
          status: 'unavailable',
          error: '数据暂不可用',
        }),
      ],
    });
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));

    expect(await screen.findByText('涨停数据暂不可用')).toBeInTheDocument();
    expect(screen.getByText('暂无可用涨停数据')).toBeInTheDocument();
    expect(screen.getByText('交易日：暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('数据已过期')).not.toBeInTheDocument();

    await clickPrimaryNav(user, /^持仓/);

    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('长期观察')).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('长期观察');
  });

  it('keeps the last market overview values when a later market refresh rejects', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      market: [marketResponseFixture(), new Error('network down')],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('3301.25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '刷新行情' }));

    expect(await screen.findAllByText('数据已过期')).toHaveLength(3);
    expect(screen.getByText('3301.25')).toBeInTheDocument();
    expect(screen.getByText('+12.38')).toHaveClass('value--neutral');
    expect(screen.getByText('+0.38%')).toHaveClass('value--neutral');
  });

  it('keeps the last limit-up items when a later limit-up refresh rejects', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      limitUp: [
        limitUpResponseFixture({
          tradeDate: '20260818',
          fetchedAt: '2026-08-18T07:32:00.000Z',
        }),
        new Error('network down'),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));

    expect(await screen.findByText('桂发祥')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '刷新涨停池' }));

    expect(await screen.findByText('数据已过期')).toBeInTheDocument();
    expect(screen.getByText('2026-08-18')).toBeInTheDocument();
    expect(screen.getByText('桂发祥')).toBeInTheDocument();
    expect(screen.getByText('ST中华')).toBeInTheDocument();
  });

  it('adds a holding, persists its note, and filters by group', async () => {
    const user = userEvent.setup();

    render(<App />);

    // 分组只在自选页的「分组管理」面板里维护，持仓页不再提供入口
    await createGroupViaPanel(user, '长期持仓');

    await clickPrimaryNav(user, /^持仓/);

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

  it('defaults a new holding to the selected custom group', async () => {
    const user = userEvent.setup();

    render(<App />);
    // 自选页的分组操作统一走「分组管理」面板
    await user.click(screen.getByRole('button', { name: '分组管理' }));
    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '长期持仓');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    // 回到列表后关掉面板，再选中新分组
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await user.click(screen.getByRole('button', { name: '长期持仓' }));
    await user.click(screen.getByRole('button', { name: '添加股票' }));

    expect(screen.getByRole<HTMLOptionElement>('option', { name: '长期持仓' }).selected).toBe(true);
  });

  it('persists a new holding before refresh and keeps it when refresh rejects', async () => {
    const user = userEvent.setup();
    let rejectFetch: (reason: Error) => void = () => undefined;
    const pendingFetch = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    });
    const fetchMock = createFetchMock({
      quotes: [() => pendingFetch],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    await user.type(screen.getByLabelText('开仓价'), '1200');
    await user.type(screen.getByLabelText('持有数量'), '1');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(localStorage.getItem('stock-dashboard:v1')).toContain('600519');
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(getFetchUrls(fetchMock, '/api/quotes?')).toEqual(['/api/quotes?symbols=600519']);

    await act(async () => rejectFetch(new Error('network down')));

    expect(await screen.findByRole('button', { name: '编辑 600519' })).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('600519');
  });

  it('persists an edited symbol before refresh and refreshes the next holding list', async () => {
    const user = userEvent.setup();
    let rejectFetch: (reason: Error) => void = () => undefined;
    const pendingFetch = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    });
    const fetchMock = createFetchMock({
      quotes: [
        quotesResponseFixture({
          quotes: [
            {
              symbol: '600519', name: '贵州茅台', price: 1297.99, change: 4.9,
              pct: 0.38, turnover: 0.17, volumeRatio: 1.2, amount: 640_000_000, preClose: 1293.09, updatedAt: '2026-08-18T02:30:00.000Z',
              source: 'eastmoney', status: 'fresh',
            },
          ],
        }),
        () => pendingFetch,
      ],
    });
    const seededState: StorageState = {
      groups: [
        {
          id: 'ungrouped', name: '未分组', isSystem: true,
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      ],
      holdings: [
        {
          id: 'holding-1', symbol: '600519', name: '贵州茅台', groupId: 'ungrouped',
          openPrice: 1200, quantity: 1, note: '',
          createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '编辑 贵州茅台' }));
    await user.clear(screen.getByLabelText('股票代码'));
    await user.type(screen.getByLabelText('股票代码'), '000001');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    expect(localStorage.getItem('stock-dashboard:v1')).toContain('000001');
    expect(localStorage.getItem('stock-dashboard:v1')).not.toContain('600519');
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(getFetchUrls(fetchMock, '/api/quotes?').at(-1)).toBe('/api/quotes?symbols=000001');

    await act(async () => rejectFetch(new Error('network down')));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '编辑 000001' })).toBeInTheDocument(),
    );
  });

  it('refreshes all symbols from the next holding list after adding a holding', async () => {
    const user = userEvent.setup();
    const seededState: StorageState = {
      groups: [
        {
          id: 'ungrouped', name: '未分组', isSystem: true,
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      ],
      holdings: [
        {
          id: 'holding-1', symbol: '600519', name: '贵州茅台', groupId: 'ungrouped',
          openPrice: 1200, quantity: 1, note: '',
          createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = createFetchMock({
      quotes: [quotesResponseFixture(), quotesResponseFixture()],
    });
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(getFetchUrls(fetchMock, '/api/quotes?')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '000001');
    await user.type(screen.getByLabelText('开仓价'), '10');
    await user.type(screen.getByLabelText('持有数量'), '1');
    await user.click(screen.getByRole('button', { name: '保存股票' }));

    await waitFor(() => expect(getFetchUrls(fetchMock, '/api/quotes?')).toHaveLength(2));
    expect(getFetchUrls(fetchMock, '/api/quotes?').at(-1)).toBe('/api/quotes?symbols=600519%2C000001');
  });

  it('keeps holdings when their custom group is deleted', async () => {
    const user = userEvent.setup();

    render(<App />);
    await createGroupViaPanel(user, '短线观察');

    await clickPrimaryNav(user, /^持仓/);
    await user.click(screen.getByRole('button', { name: '添加股票' }));
    await user.type(screen.getByLabelText('股票代码'), '600519');
    await user.selectOptions(screen.getByLabelText('分组'), '短线观察');
    await user.type(screen.getByLabelText('开仓价'), '160');
    await user.type(screen.getByLabelText('持有数量'), '100');
    await user.click(screen.getByRole('button', { name: '保存股票' }));
    // 先在持仓页选中它，删除后应自动回落到「全部持仓」
    await user.click(screen.getByRole('button', { name: '短线观察' }));

    // 删除分组要回自选页的面板
    await clickPrimaryNav(user, /^自选/);
    await user.click(screen.getByRole('button', { name: '分组管理' }));
    await user.click(screen.getByRole('button', { name: '删除分组 短线观察' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));

    await clickPrimaryNav(user, /^持仓/);

    // 分组没了，但股票还在（变成未分配，只在「全部」里）
    expect(screen.getByRole('button', { name: '全部持仓' })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: '短线观察' })).not.toBeInTheDocument();
    expect(screen.getByText('600519')).toBeInTheDocument();
  });

  it('falls back to the all view after deleting the selected custom group', async () => {
    const user = userEvent.setup();

    render(<App />);
    await createGroupViaPanel(user, '短线观察');
    await createGroupViaPanel(user, '波段交易');

    await clickPrimaryNav(user, /^持仓/);
    await user.click(screen.getByRole('button', { name: '短线观察' }));

    // 删除分组统一在自选页的面板里
    await clickPrimaryNav(user, /^自选/);
    await user.click(screen.getByRole('button', { name: '分组管理' }));
    await user.click(screen.getByRole('button', { name: '删除分组 短线观察' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));

    await clickPrimaryNav(user, /^持仓/);

    expect(screen.getByRole('button', { name: '全部持仓' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: '波段交易' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '短线观察' })).not.toBeInTheDocument();
  });

  it('keeps the holdings page total on all positions and offers no group actions', async () => {
    const user = userEvent.setup();
    const seededState: StorageState = {
      groups: [
        {
          id: 'long-term',
          name: '长期持仓',
          isSystem: false,
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      ],
      holdings: [
        {
          id: 'holding-1',
          symbol: '600519',
          name: '贵州茅台',
          groupId: 'long-term',
          openPrice: 160,
          quantity: 100,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
        {
          id: 'holding-2',
          symbol: '000001',
          name: '平安银行',
          groupId: '',
          openPrice: 20,
          quantity: 200,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));

    render(<App />);
    await clickPrimaryNav(user, /^持仓/);

    // 持仓页表头只剩纯筛选，分组维护全部收在自选页的「分组管理」面板里
    expect(screen.getByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建分组' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑分组|删除分组/ })).not.toBeInTheDocument();

    const holdingCount = () =>
      within(screen.getByRole('region', { name: '总收益率' })).getByText('持仓数量').parentElement
        ?.textContent;

    // 全部持仓：两只都在，总览按全部统计
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('平安银行')).toBeInTheDocument();
    expect(holdingCount()).toContain('2');

    // 切到分组：明细只剩该组，但收益概览仍按「全部持仓」统计
    await user.click(
      within(screen.getByRole('navigation', { name: '持仓筛选' })).getByRole('button', {
        name: '长期持仓',
      }),
    );

    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.queryByText('平安银行')).not.toBeInTheDocument();
    expect(holdingCount()).toContain('2');
  });

  it('marks every known holding quote stale after a whole refresh rejects', async () => {
    const user = userEvent.setup();
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
          name: '600519',
          groupId: 'ungrouped',
          openPrice: 1200,
          quantity: 1,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
        {
          id: 'holding-2',
          symbol: '000001',
          name: '000001',
          groupId: 'ungrouped',
          openPrice: 10,
          quantity: 1,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = createFetchMock({
      quotes: [
        quotesResponseFixture({
          quotes: [
            {
              symbol: '600519', name: '贵州茅台', price: 1297.99, change: 4.9,
              pct: 0.38, turnover: 0.17, volumeRatio: 1.2, amount: 640_000_000, preClose: 1293.09, updatedAt: '2026-08-18T02:30:00.000Z',
              source: 'eastmoney', status: 'fresh',
            },
            {
              symbol: '000001', name: '平安银行', price: 12.3, change: 0.1,
              pct: 0.82, turnover: 1.1, volumeRatio: 1.2, amount: 640_000_000, preClose: 12.2, updatedAt: '2026-08-18T02:30:00.000Z',
              source: 'eastmoney', status: 'fresh',
            },
          ],
        }),
        new Error('network down'),
      ],
    });

    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await clickPrimaryNav(user, /^持仓/);

    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '刷新行情' }));

    expect(await screen.findByText('network down，已保留上一轮数据。')).toBeInTheDocument();
    expect(screen.queryByText('行情已过期')).not.toBeInTheDocument();
    expect(screen.getByText('1,297.99')).toBeInTheDocument();
    expect(screen.getByText('12.30')).toBeInTheDocument();
  });

  it('lists positioned stocks in both pages while watch-only stocks stay only in the watchlist', async () => {
    const user = userEvent.setup();
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
          openPrice: 1200,
          quantity: 1,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
        {
          id: 'holding-2',
          symbol: '000001',
          name: '平安银行',
          groupId: 'ungrouped',
          openPrice: null,
          quantity: null,
          note: '先观察',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));

    render(<App />);

    // 默认进自选：持仓票和观察票都在；表头标题文字已去掉，不再有「我的票」标题
    expect(await screen.findByText('平安银行')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '我的票' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自选 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('平安银行')).toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('先观察')).toBeInTheDocument();
    // 自选页不该出现持仓相关字段
    expect(screen.queryByRole('heading', { name: '总收益率' })).not.toBeInTheDocument();
    expect(screen.queryByText('开仓价')).not.toBeInTheDocument();
    expect(screen.queryByText('持有数量')).not.toBeInTheDocument();
    expect(screen.queryByText(/持仓收益/)).not.toBeInTheDocument();
    expect(screen.queryByText(/观察项/)).not.toBeInTheDocument();
    // 自选页右侧有竞价栏，工作台是两列
    expect(document.querySelector('.workbench__rail')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '持仓 1' }));

    // 持仓页表头不再有「持仓股票」标题和统计数字，只留靠左的分组筛选
    expect(await screen.findByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '持仓股票' })).not.toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.queryByText('平安银行')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '总收益率' })).toBeInTheDocument();
    // 持仓页没有竞价栏，工作台必须退回单列，否则右侧会空出一条 348px 的导轨槽
    expect(document.querySelector('.workbench')).toHaveClass('workbench--solo');
    expect(document.querySelector('.workbench__rail')).toBeNull();
  });

  it('creates and deletes watchlist groups through the 分组管理 panel', async () => {
    const user = userEvent.setup();
    const seededState: StorageState = {
      groups: [],
      holdings: [],
    };
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));

    render(<App />);

    // 自选页不再有裸的「新建分组」，先开面板
    expect(screen.queryByRole('button', { name: '新建分组' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '分组管理' }));

    expect(screen.getByRole('dialog', { name: '分组管理' })).toBeInTheDocument();
    expect(screen.getByText(hasText('还没有分组'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '长期持仓');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    // 建完回到列表，分组出现在面板和筛选条里
    expect(screen.getByRole('dialog', { name: '分组管理' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: '分组管理' })).getByText('长期持仓')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭' }));

    const filterNav = screen.getByRole('navigation', { name: '自选筛选' });
    expect(within(filterNav).getByRole('button', { name: '长期持仓' })).toBeInTheDocument();

    // 删掉它，筛选条里也随之消失
    await user.click(screen.getByRole('button', { name: '分组管理' }));
    await user.click(screen.getByRole('button', { name: '删除分组 长期持仓' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));

    expect(within(filterNav).queryByRole('button', { name: '长期持仓' })).not.toBeInTheDocument();
    // 删掉唯一的自定义分组后，面板回到空状态
    await user.click(screen.getByRole('button', { name: '分组管理' }));
    expect(screen.getByText(hasText('还没有分组'))).toBeInTheDocument();
  });

  it('filters the watchlist in place by 全部 / 持仓', async () => {
    const user = userEvent.setup();
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
          openPrice: 1200,
          quantity: 1,
          note: '',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
        {
          id: 'holding-2',
          symbol: '000001',
          name: '平安银行',
          groupId: 'ungrouped',
          openPrice: null,
          quantity: null,
          note: '先观察',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    };
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(seededState));

    render(<App />);

    const scopeNav = await screen.findByRole('navigation', { name: '自选筛选' });

    // 默认「全部」：持仓票和观察票都在
    expect(within(scopeNav).getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // 自选页不再有重复的「观察」档位
    expect(within(scopeNav).queryByRole('button', { name: '观察' })).not.toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('平安银行')).toBeInTheDocument();

    await user.click(within(scopeNav).getByRole('button', { name: '持仓' }));

    // 只留已补录开仓价/数量的票，并且还留在自选页（不跳到「持仓」页）
    expect(screen.queryByText('平安银行')).not.toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自选 2' })).toHaveAttribute('aria-current', 'page');
    // 范围和分组共用一条控件，切到「持仓」时它自己高亮
    expect(within(scopeNav).getByRole('button', { name: '持仓' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(scopeNav).getByRole('button', { name: '全部' })).not.toHaveAttribute(
      'aria-current',
    );

    await user.click(within(scopeNav).getByRole('button', { name: '全部' }));

    // 切回「全部」后观察票重新出现
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('平安银行')).toBeInTheDocument();
    expect(screen.getByText('先观察')).toBeInTheDocument();
    expect(within(scopeNav).getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('shows the watchlist empty state when no stocks have been added', async () => {
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: '自选 0' }));

    expect(await screen.findByRole('heading', { name: '自选列表为空' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '自选筛选' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加股票' })).toBeInTheDocument();
  });

  it('falls back to the edited symbol until a later refresh provides the runtime quote name', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      quotes: [
        quotesResponseFixture({
          quotes: [
            {
              symbol: '600519',
              name: '贵州茅台',
              price: null,
              change: null,
              pct: null,
              turnover: null,
              volumeRatio: 1.2,
              amount: 640_000_000,
              preClose: 165,
              updatedAt: '2026-08-18T10:30:00.000Z',
              source: 'eastmoney',
              status: 'unavailable',
            },
          ],
        }),
        quotesResponseFixture({
          quotes: [
            {
              symbol: '000001',
              name: '',
              price: null,
              change: null,
              pct: null,
              turnover: null,
              volumeRatio: 1.2,
              amount: 640_000_000,
              preClose: null,
              updatedAt: '2026-08-18T10:31:00.000Z',
              source: 'eastmoney',
              status: 'unavailable',
            },
          ],
        }),
        quotesResponseFixture({
          quotes: [
            {
              symbol: '000001',
              name: '平安银行',
              price: 12.3,
              change: 0.1,
              pct: 0.82,
              turnover: 1.1,
              volumeRatio: 1.2,
              amount: 640_000_000,
              preClose: 12.2,
              updatedAt: '2026-08-18T10:32:00.000Z',
              source: 'eastmoney',
              status: 'fresh',
            },
          ],
        }),
      ],
    });

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
    await clickPrimaryNav(user, /^持仓/);

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
