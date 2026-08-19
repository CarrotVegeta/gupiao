import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { LimitUpResponse, MarketOverviewResponse, QuotesResponse, StorageState } from './types';

type FetchPayload = QuotesResponse | MarketOverviewResponse | LimitUpResponse;
type FetchReply = FetchPayload | Error | (() => Promise<Response>);

const makeResponse = (payload: FetchPayload): Response => new Response(JSON.stringify(payload));

const marketResponseFixture = (
  response: Partial<MarketOverviewResponse> = {},
): MarketOverviewResponse => ({
  indices: [
    {
      symbol: '000001',
      name: '上证指数',
      price: 3301.25,
      change: 12.38,
      pct: 0.38,
      updatedAt: '2026-08-19T07:30:00.000Z',
      status: 'fresh',
    },
    {
      symbol: '399001',
      name: '深证成指',
      price: 10500.88,
      change: -25.12,
      pct: -0.24,
      updatedAt: '2026-08-19T07:30:00.000Z',
      status: 'fresh',
    },
    {
      symbol: '399006',
      name: '创业板指',
      price: 2200.66,
      change: 8.11,
      pct: 0.37,
      updatedAt: '2026-08-19T07:30:00.000Z',
      status: 'fresh',
    },
    {
      symbol: '000688',
      name: '科创 50',
      price: 980.42,
      change: -3.55,
      pct: -0.36,
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
          preClose: 165,
          updatedAt: '2026-08-18T10:30:00.000Z',
          source: 'eastmoney',
          status: 'fresh',
        },
      ],
    }),
  ],
  limitUp = [limitUpResponseFixture()],
}: {
  market?: FetchReply[];
  quotes?: FetchReply[];
  limitUp?: FetchReply[];
} = {}) => {
  let marketIndex = 0;
  let quotesIndex = 0;
  let limitUpIndex = 0;

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

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
};

const getFetchUrls = (fetchMock: ReturnType<typeof vi.fn>, prefix: string): string[] =>
  fetchMock.mock.calls
    .map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    )
    .filter((url) => url.startsWith(prefix));

describe('Task 7 app interactions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', createFetchMock());
  });

  it('shows the market overview above the holdings page and places group navigation before the stock list', async () => {
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
    expect(screen.getByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();
    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '持仓 1' })).toHaveAttribute('aria-current', 'page');

    const groupHeading = screen.getByRole('heading', { name: '持仓分组' });
    const listHeading = screen.getByRole('heading', { name: '股票列表' });

    expect(
      groupHeading.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('keeps all four market placeholders unavailable when the first request rejects', async () => {
    const fetchMock = createFetchMock({ market: [new Error('network down')] });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByRole('button', { name: '刷新大盘' })).not.toBeDisabled());
    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('深证成指')).toBeInTheDocument();
    expect(screen.getByText('创业板指')).toBeInTheDocument();
    expect(screen.getByText('科创 50')).toBeInTheDocument();
    expect(screen.getAllByText('无可用数据')).toHaveLength(4);
    expect(
      within(screen.getByRole('region', { name: '大盘概览' })).getAllByText('—'),
    ).toHaveLength(12);
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

    expect(getFetchUrls(fetchMock, '/api/limit-up')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /涨停聚焦/ }));

    expect(await screen.findByRole('heading', { name: '涨停列表' })).toBeInTheDocument();
    expect(screen.getByText('桂发祥')).toBeInTheDocument();
    expect(getFetchUrls(fetchMock, '/api/limit-up')).toHaveLength(1);
    expect(getFetchUrls(fetchMock, '/api/limit-up')[0]).toMatch(/^\/api\/limit-up\?date=\d{8}$/);
    expect(screen.queryByRole('heading', { name: '总收益率' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '持仓分组' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加股票' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /持仓/ }));

    expect(await screen.findByRole('heading', { name: '总收益率' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '持仓分组' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加股票' })).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /持仓/ }));

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
    expect(screen.getByText('3,301.25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '刷新大盘' }));

    expect(await screen.findAllByText('数据已过期')).toHaveLength(4);
    expect(screen.getByText('3,301.25')).toBeInTheDocument();
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

  it('defaults a new holding to the selected custom group', async () => {
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '长期持仓');
    await user.click(screen.getByRole('button', { name: '保存分组' }));
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
              pct: 0.38, turnover: 0.17, preClose: 1293.09, updatedAt: '2026-08-18T02:30:00.000Z',
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

  it('falls back to ungrouped after deleting the selected custom group', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '短线观察');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    await user.click(screen.getByRole('button', { name: '新建分组' }));
    await user.type(screen.getByLabelText('分组名称'), '波段交易');
    await user.click(screen.getByRole('button', { name: '保存分组' }));

    await user.click(screen.getByRole('button', { name: '短线观察' }));
    await user.click(screen.getByRole('button', { name: '编辑分组 短线观察' }));
    await user.click(screen.getByRole('button', { name: '删除分组' }));

    expect(screen.getByRole('button', { name: '未分组' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: '波段交易' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '短线观察' })).not.toBeInTheDocument();
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
              pct: 0.38, turnover: 0.17, preClose: 1293.09, updatedAt: '2026-08-18T02:30:00.000Z',
              source: 'eastmoney', status: 'fresh',
            },
            {
              symbol: '000001', name: '平安银行', price: 12.3, change: 0.1,
              pct: 0.82, turnover: 1.1, preClose: 12.2, updatedAt: '2026-08-18T02:30:00.000Z',
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

    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '刷新行情' }));

    expect(await screen.findByText('network down，已保留上一轮数据。')).toBeInTheDocument();
    expect(screen.queryByText('行情已过期')).not.toBeInTheDocument();
    expect(screen.getByText('¥1,297.99')).toBeInTheDocument();
    expect(screen.getByText('¥12.30')).toBeInTheDocument();
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

    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    expect(screen.queryByText('平安银行')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '持仓 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '自选 2' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '自选 2' }));

    expect(await screen.findByRole('heading', { name: '自选股票' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '自选分组' })).toBeInTheDocument();
    expect(screen.getByText('平安银行')).toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '总收益率' })).not.toBeInTheDocument();
    expect(screen.queryByText('开仓价')).not.toBeInTheDocument();
    expect(screen.queryByText('持有数量')).not.toBeInTheDocument();
    expect(screen.queryByText(/持仓收益/)).not.toBeInTheDocument();
    expect(screen.queryByText(/观察项/)).not.toBeInTheDocument();
    expect(screen.getByText('先观察')).toBeInTheDocument();
  });

  it('shows the watchlist empty state when no stocks have been added', async () => {
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: '大盘概览' });

    await user.click(screen.getByRole('button', { name: '自选 0' }));

    expect(await screen.findByRole('heading', { name: '自选列表为空' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '自选分组' })).toBeInTheDocument();
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
