import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type {
  AuctionResponse,
  DragonTigerResponse,
  LimitUpLadderResponse,
  LimitUpResponse,
  MarketOverviewResponse,
  Quote,
  MinuteSeriesResponse,
  QuotesResponse,
  SprintLimitUpResponse,
  StorageState,
} from './types';

type FetchPayload =
  | AuctionResponse
  | MinuteSeriesResponse
  | QuotesResponse
  | MarketOverviewResponse
  | LimitUpResponse
  | LimitUpLadderResponse
  | SprintLimitUpResponse
  | DragonTigerResponse
  | TrendScanFixture;
type FetchReply = FetchPayload | Error | (() => Promise<Response>);

/** 选股页形态扫描的最小响应：只要够渲染一行，重点验证行尾的「添加自选」 */
type TrendScanFixture = {
  tradeDate: string;
  items: Array<Record<string, unknown>>;
  scanned: number;
  candidates: number;
  filters: Record<string, unknown>;
  fetchedAt: string;
  source: string;
  status: string;
  error: string | null;
  coverage: {
    total: number;
    attempted: number;
    succeeded: number;
    failed: number;
    unscanned: number;
  };
  matchedTotal: number;
  returnedCount: number;
  truncated: boolean;
  metricsTradeDate: string;
  quoteAsOf: string;
};

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

/**
 * 迷你分时图的固件：给默认的自选/持仓票（600519）一条「低开走高」的分时，
 * 覆盖 MiniChart 的「有昨收 → 画基准线并染色」这条路径。
 */
const minuteResponseFixture = (
  response: Partial<MinuteSeriesResponse> = {},
): MinuteSeriesResponse => ({
  series: [
    {
      symbol: '600519',
      preClose: 165,
      points: [164.2, 165.4, 167.1, 168.2],
      times: ['0930', '0931', '0932', '0933'],
    },
  ],
  fetchedAt: '2026-08-18T10:30:00.000Z',
  source: 'tencent',
  missing: [],
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

/** 连板天梯 / 今-昨对比的最小响应：够渲染一档梯子和一行对比 */
const limitUpLadderResponseFixture = (
  response: Partial<LimitUpLadderResponse> = {},
): LimitUpLadderResponse => {
  const todayItem = {
    symbol: '605058',
    name: '澳弘电子',
    price: 28.1,
    pct: 9.99,
    boardCount: 5,
    firstSealTime: '09:25:00',
    lastSealTime: '09:25:00',
    industry: '元件',
    breakCount: 0,
  };
  const previousItem = {
    ...todayItem,
    price: 25.55,
    boardCount: 4,
  };

  return {
    tradeDate: '20260819',
    previousTradeDate: '20260818',
    items: [todayItem],
    ladder: [{ boardCount: 5, items: [todayItem] }],
    previousLadder: [{ boardCount: 4, items: [previousItem] }],
    comparison: [
      {
        boardCount: 4,
        total: 2,
        carried: [{ symbol: '605058', name: '澳弘电子', boardCount: 5, pct: 9.99 }],
        fallen: [{ symbol: '600111', name: '北方稀土', boardCount: null, pct: 10.02 }],
      },
    ],
    previousCount: 2,
    carriedCount: 1,
    promotionRate: 50,
    previousAvailable: true,
    fetchedAt: '2026-08-19T07:33:00.000Z',
    source: 'eastmoney',
    status: 'fresh',
    error: null,
    ...response,
  };
};

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
      sealedAtAuction: false,
      minuteTrend: null,
      auctionAmountSource: 'tick',
      result: 'qualified',
      reasons: ['竞价高开 4.00%，在 2%~6% 区间', '竞价量比 5.20%，达到 5%'],
    },
  ],
  fetchedAt: '2026-08-19T01:25:10.000Z',
  source: 'eastmoney',
  status: 'fresh',
  error: null,
  ...response,
});

const trendScanResponseFixture = (
  response: Partial<TrendScanFixture> = {},
): TrendScanFixture => ({
  tradeDate: '20260917',
  items: [
    {
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
      matched: ['5/10/20 日线多头排列'],
      unmatched: [],
    },
  ],
  scanned: 260,
  candidates: 294,
  filters: {
    themeScope: 'all',
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
  coverage: { total: 294, attempted: 260, succeeded: 255, failed: 5, unscanned: 34 },
  matchedTotal: 1,
  returnedCount: 1,
  truncated: false,
  metricsTradeDate: '20260917',
  quoteAsOf: '2026-09-17T14:00:00.000Z',
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
  limitUpLadder = [limitUpLadderResponseFixture()],
  sprintLimitUp = [sprintLimitUpResponseFixture()],
  dragonTiger = [dragonTigerResponseFixture()],
  auction = [auctionResponseFixture()],
  screener = [trendScanResponseFixture()],
  minute = [minuteResponseFixture()],
}: {
  market?: FetchReply[];
  quotes?: FetchReply[];
  limitUp?: FetchReply[];
  limitUpLadder?: FetchReply[];
  sprintLimitUp?: FetchReply[];
  dragonTiger?: FetchReply[];
  auction?: FetchReply[];
  screener?: FetchReply[];
  minute?: FetchReply[];
} = {}) => {
  let marketIndex = 0;
  let quotesIndex = 0;
  let limitUpIndex = 0;
  let limitUpLadderIndex = 0;
  let sprintLimitUpIndex = 0;
  let dragonTigerIndex = 0;
  let auctionIndex = 0;
  let minuteIndex = 0;
  let screenerIndex = 0;

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

    if (url.startsWith('/api/limit-up-ladder')) {
      const reply = nextReply(limitUpLadder, limitUpLadderIndex);
      limitUpLadderIndex += 1;
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

    if (url.startsWith('/api/minute?')) {
      const reply = nextReply(minute, minuteIndex);
      minuteIndex += 1;
      return resolveFetchReply(reply);
    }

    if (url.startsWith('/api/screener/trend')) {
      const reply = nextReply(screener, screenerIndex);
      screenerIndex += 1;
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
    // 页脚也展示同一份大盘行情，指数名要限定在大盘概览区域里查
    expect(
      within(screen.getByRole('region', { name: '大盘概览' })).getByText('上证指数'),
    ).toBeInTheDocument();
    // 默认进入自选页：右侧常驻冲刺涨停，分组筛选在卡片表头里
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
    const overview = screen.getByRole('region', { name: '大盘概览' });
    expect(within(overview).getByText('上证指数')).toBeInTheDocument();
    expect(within(overview).getByText('深证成指')).toBeInTheDocument();
    expect(within(overview).getByText('创业板指')).toBeInTheDocument();
    expect(within(overview).getByText('两市成交')).toBeInTheDocument();
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
    // 涨停聚焦页不重复展示大盘指数条（和选股页一样）
    expect(screen.queryByRole('region', { name: '大盘概览' })).not.toBeInTheDocument();
    // 「添加股票」在顶栏，任何页面都能用
    expect(screen.getByRole('button', { name: '添加股票' })).toBeInTheDocument();

    await clickPrimaryNav(user, /^持仓/);

    expect(await screen.findByRole('heading', { name: '总收益率' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();
  });

  it('preloads the sprint pool for the watchlist rail and keeps the 竞价 badge populated', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    // 自选页右栏常驻冲刺涨停，进入自选页就拉一次
    await screen.findByRole('heading', { name: '冲刺涨停' });
    expect(screen.getByText('冲刺样本')).toBeInTheDocument();
    await waitFor(() => expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')).toHaveLength(1));
    expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')[0]).toMatch(
      /^\/api\/sprint-limit-up\?date=\d{8}$/,
    );

    // 右栏不再展示竞价候选，但顶栏「竞价」的计数仍要在落地页就有数，所以快照照旧预取
    await waitFor(() => expect(getFetchUrls(fetchMock, '/api/auction')).toHaveLength(1));
    expect(getFetchUrls(fetchMock, '/api/auction')[0]).toMatch(/^\/api\/auction\?date=\d{8}$/);

    await user.click(screen.getByRole('button', { name: /^竞价/ }));

    expect(await screen.findByRole('heading', { name: '竞价连板候选' })).toBeInTheDocument();
    expect(screen.getByText('人民网')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '竞价结论' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '竞价量比' })).toBeInTheDocument();
    expect(screen.getAllByText('合格').length).toBeGreaterThan(0);
  });

  it('jumps from the watchlist rail to the 涨停聚焦 · 冲刺涨停 tab', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    // 右栏的「查看全部」不只是切页：还要停在冲刺涨停页签上，否则用户看到的是涨停池
    await user.click(await screen.findByRole('button', { name: '查看全部 1 只 →' }));

    expect(await screen.findByRole('tab', { name: '冲刺涨停' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('table', { name: '冲刺涨停列表' })).toBeInTheDocument();
  });

  it('shows the live change percent on the auction list from a separate quotes call', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      quotes: [
        quotesResponseFixture({
          quotes: [
            {
              symbol: '603000',
              name: '人民网',
              price: 10.85,
              change: 0.45,
              pct: 4.33,
              turnover: 8.5,
              volumeRatio: 1.4,
              amount: 520_000_000,
              preClose: 10.4,
              updatedAt: '2026-08-19T02:10:00.000Z',
              source: 'tencent',
              status: 'fresh',
            },
          ],
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /^竞价/ }));
    expect(await screen.findByRole('heading', { name: '竞价连板候选' })).toBeInTheDocument();

    // 09:25 快照里没有现价：涨跌幅必须另走一次行情接口
    await waitFor(() =>
      expect(getFetchUrls(fetchMock, '/api/quotes?')).toEqual(['/api/quotes?symbols=603000']),
    );

    const row = await screen.findByRole('row', { name: /人民网/ });
    expect(within(row).getByText('+4.33%')).toHaveClass('value--rise');
    // 竞价涨幅仍在：两列是不同口径，不能互相顶掉
    expect(within(row).getByText('+4.00%')).toBeInTheDocument();
  });

  it('switches the two limit-up focus tabs and shows the sprint list only on its own tab', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      sprintLimitUp: [sprintLimitUpResponseFixture()],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    // 自选页右栏已经拉过一次冲刺涨停池；涨停聚焦页默认停在涨停池，不显示冲刺那批
    await waitFor(() => expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));
    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(screen.queryByText('冲刺样本')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '冲刺涨停' }));

    expect(await screen.findByRole('heading', { name: '冲刺涨停' })).toBeInTheDocument();
    expect(screen.getByText('冲刺样本')).toBeInTheDocument();
    expect(screen.queryByText('桂发祥')).not.toBeInTheDocument();
    // 进页签会再刷一次（和竞价页一个套路：进页面就拉最新一份）
    expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')).toHaveLength(2);
    expect(getFetchUrls(fetchMock, '/api/sprint-limit-up')[1]).toMatch(
      /^\/api\/sprint-limit-up\?date=\d{8}$/,
    );

    await user.click(screen.getByRole('tab', { name: '涨停池' }));

    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(screen.getByText('桂发祥')).toBeInTheDocument();
    expect(screen.queryByText('冲刺样本')).not.toBeInTheDocument();
  });

  it('fetches the ladder only when the 今/昨对比 or 连板天梯 tab is selected', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));
    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    // 停在涨停池页签时不该打天梯接口
    expect(getFetchUrls(fetchMock, '/api/limit-up-ladder')).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: '连板天梯' }));

    expect(await screen.findByRole('heading', { name: '连板天梯' })).toBeInTheDocument();
    expect(screen.getByText('澳弘电子')).toBeInTheDocument();
    expect(getFetchUrls(fetchMock, '/api/limit-up-ladder')).toHaveLength(1);
    expect(getFetchUrls(fetchMock, '/api/limit-up-ladder')[0]).toMatch(
      /^\/api\/limit-up-ladder\?date=\d{8}$/,
    );

    // 两个视图共用同一份响应：切到今/昨对比不会再打一次
    await user.click(screen.getByRole('tab', { name: '今/昨对比' }));

    expect(await screen.findByRole('heading', { name: '今/昨对比' })).toBeInTheDocument();
    expect(screen.getByText('北方稀土')).toBeInTheDocument();
    expect(getFetchUrls(fetchMock, '/api/limit-up-ladder')).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: '涨停池' }));

    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '连板天梯' })).not.toBeInTheDocument();
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

    const overview = await screen.findByRole('region', { name: '大盘概览' });
    expect(within(overview).getByText('上证指数')).toBeInTheDocument();
    expect(within(overview).getByText('3301.25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '刷新行情' }));

    expect(await screen.findAllByText('数据已过期')).toHaveLength(3);
    expect(within(overview).getByText('3301.25')).toBeInTheDocument();
    expect(within(overview).getByText('+12.38')).toHaveClass('value--neutral');
    expect(within(overview).getByText('+0.38%')).toHaveClass('value--neutral');
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

  it('adds a limit-up stock to the watchlist from the pool row-end button', async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));

    expect(await screen.findByRole('heading', { name: '涨停池' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加 桂发祥 到自选' }));

    expect(await screen.findByText('已把 桂发祥 加入自选。')).toBeInTheDocument();
    // 同一条记录：按钮置灰 + 顶栏自选数 +1
    expect(screen.getByRole('button', { name: '桂发祥 已在自选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '自选 1' })).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('"symbol":"002820"');
  });

  // 这几个用例要跑完整交互（增删分组 + 行情刷新），并行跑全量测试时容易贴到 5s 默认超时，
  // 单独跑约 1~4s。这里给它们明确的宽松超时，避免整机负载把结果变成随机失败。
  it('adds a holding, persists its note, and filters by group', { timeout: 20_000 }, async () => {
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

  it('defaults a new holding to 不分组 even while a custom group is being viewed', async () => {
    const user = userEvent.setup();

    render(<App />);
    // 自选页的分组操作统一走「分组管理」面板
    await user.click(screen.getByRole('button', { name: '分组管理' }));
    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '长期持仓');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    // 回到列表后关掉面板，再选中新分组，然后新增股票
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await user.click(screen.getByRole('button', { name: '长期持仓' }));
    await user.click(screen.getByRole('button', { name: '添加股票' }));

    // 新增默认「不分组」：不跟着当前筛选走，也不落到第一个分组上
    expect(screen.getByRole<HTMLOptionElement>('option', { name: '不分组' }).selected).toBe(true);
    expect(screen.getByRole<HTMLOptionElement>('option', { name: '长期持仓' }).selected).toBe(false);
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

  it('keeps holdings when their custom group is deleted', { timeout: 20_000 }, async () => {
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

  it('falls back to the all view after deleting the selected custom group', { timeout: 20_000 }, async () => {
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

  it('选股页不展示大盘数据，并能在结果行尾把股票加入自选', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 其他页仍有大盘概览，只有选股页去掉
    expect(await screen.findByRole('heading', { name: '大盘概览' })).toBeInTheDocument();

    await clickPrimaryNav(user, /^选股/);

    expect(screen.queryByRole('region', { name: '大盘概览' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '趋势形态扫描（不是选股信号）' }),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '添加 高澜股份 到自选' }));

    expect(await screen.findByText('已把 高澜股份 加入自选。')).toBeInTheDocument();
    // 同一条记录：按钮置灰 + 顶栏自选数 +1
    expect(screen.getByRole('button', { name: '高澜股份 已在自选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '自选 1' })).toBeInTheDocument();
    expect(localStorage.getItem('stock-dashboard:v1')).toContain('"symbol":"300499"');
  });

  it('把股票加入自选时顺手记下当时的价格，作为「自选收益」的基准', async () => {
    const user = userEvent.setup();
    /*
     * 加入自选后要拿 002820 当时的现价：默认行情夹具里只有 600519。
     * 加完之后那一次请求只查新代码（列表里原来没有自选），所以第一份就是带 002820 的响应；
     * 后面再刷（含定时器）沿用最后一份，不影响断言。
     */
    const quoteForRequest = (symbol: string, price: number): Quote => ({
      symbol,
      name: symbol === '002820' ? '桂发祥' : '贵州茅台',
      price,
      change: 1.12,
      pct: 10.04,
      turnover: 8.5,
      volumeRatio: 2.4,
      amount: 320_000_000,
      preClose: price - 1,
      updatedAt: '2026-08-18T10:30:00.000Z',
      source: 'eastmoney',
      status: 'fresh',
    });
    const fetchMock = createFetchMock({
      quotes: [
        quotesResponseFixture({
          quotes: [quoteForRequest('002820', 12.27)],
        }),
        quotesResponseFixture({
          quotes: [quoteForRequest('600519', 168.2), quoteForRequest('002820', 12.27)],
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));
    await user.click(await screen.findByRole('button', { name: '添加 桂发祥 到自选' }));
    expect(await screen.findByText('已把 桂发祥 加入自选。')).toBeInTheDocument();

    // 基准价 = 加入那一刻的现价；取价时刻也要一起记（自选日靠它）
    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem('stock-dashboard:v1') ?? '{}',
      ) as StorageState;
      const added = saved.holdings.find((holding) => holding.symbol === '002820');

      expect(added?.watchPrice).toBe(12.27);
      expect(added?.watchPriceAt).toEqual(expect.any(String));
    });
  });

  it('给没有基准价的旧自选记录补记「自选收益」的起点', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // 本功能上线前写下来的记录：有 createdAt，但没有 watchPrice
    localStorage.setItem(
      'stock-dashboard:v1',
      JSON.stringify({
        groups: [],
        holdings: [
          {
            id: 'h-legacy',
            symbol: '600519',
            name: '贵州茅台',
            groupId: '',
            openPrice: null,
            quantity: null,
            note: '',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
      }),
    );

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    // 第一次刷行情（进页面时就刷）顺手补上基准价，用户不用做任何操作
    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem('stock-dashboard:v1') ?? '{}',
      ) as StorageState;
      const legacy = saved.holdings.find((holding) => holding.id === 'h-legacy');

      expect(legacy?.watchPrice).toBe(168.2);
      expect(legacy?.watchPriceAt).toEqual(expect.any(String));
    });
  });
});
