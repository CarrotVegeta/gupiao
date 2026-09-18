import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenerPanel, type ScreenerTab } from './ScreenerPanel';
import type { MainlineBoardReport, MainlineReport } from '../types';

/**
 * 选股页容器现在只有两档：主线 / 趋势。
 *
 * 2026-09-19 删掉了「板块」（同花顺概念 Top 20）与「细分逻辑」（涨停原因标签）两档，
 * 所以这里原来那 10 条针对这两档的用例一并删除；组件与后端接口仍保留。
 */

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

/** 主线档的一天快照 */
const mainlineDay = {
  date: '20260918',
  code: '885756',
  name: '芯片概念',
  pct: 2.71,
  limitUpCount: 18,
  continuousCount: 3,
  highLabel: '6天3板',
  maxBoard: 3,
  upstreamDays: 10,
  amount: 9.3748e11,
  mainNet: 1.144e10,
  rank: { pct: 2, limitUp: 1, flow: 2, amount: 1 },
  hit: 4,
  streakHit: 2,
  streakRank: { pct: 3, limitUp: 5, flow: 2, amount: 5 },
  streak: 3,
  dayKind: 'strong' as const,
  capitalReturn: 1,
  judge: null,
};

const mainlineBoard: MainlineBoardReport = {
  code: '885756',
  name: '芯片概念',
  days: [mainlineDay],
  members: [],
  themes: [
    {
      key: '存储',
      count: 2,
      maxBoard: 1,
      members: ['托伦斯', '诚邦股份'],
      variants: ['存储芯片', '半导体存储'],
      streak: 2,
      boardSpread: 2,
    },
  ],
  ladder: {
    maxBoard: 3,
    leader: {
      symbol: '002161',
      name: '远望谷',
      boardCount: 3,
      highLabel: '6天3板',
      firstSealTime: '09:44:15',
      sealAmount: 8.28e7,
      amount: null,
      floatMarketCap: null,
      turnoverRate: null,
      pct: 10,
      changeTag: null,
      limitUpIn60d: null,
      isSt: false,
      reasonTags: ['光通信'],
    },
    frontRow: [],
    firstBoard: [],
    laggard: [],
    core: [],
    coreSupport: 0,
    breakRate: null,
    full: false,
    coreAvailable: false,
    laggardAvailable: false,
    breakRateAvailable: false,
  },
  appearDays: 5,
  streakHit: 2,
  maxRankStreak: 5,
  maxRankKey: 'limitUp',
  capitalReturn: 1,
  score: {
    tier: 'mainline',
    total: 10,
    ebb: false,
    degraded: false,
    conditions: [
      {
        key: 'limitUpTop3',
        label: '涨停家数进入前三',
        hit: true,
        score: 2,
        evidence: '涨停家数 18，当日第 1 名',
      },
      {
        key: 'coreTroop',
        label: '有大成交趋势中军',
        hit: false,
        score: 0,
        evidence: '成员成交额 / 流通市值缺失，中军不可判定',
      },
    ],
  },
};

const mainlineReport: MainlineReport = {
  tradeDates: ['20260914', '20260918'],
  latestDate: '20260918',
  ranks: [
    { key: 'pct', label: '涨幅榜', rows: [mainlineBoard] },
    { key: 'limitUp', label: '涨停家数榜', rows: [mainlineBoard] },
    { key: 'flow', label: '主力净流入榜', rows: [mainlineBoard] },
    { key: 'amount', label: '成交额榜', rows: [mainlineBoard] },
  ],
  boards: [mainlineBoard],
  warnings: ['板块宇宙来自同花顺涨停板块 Top 20 的历史并集'],
  flowAvailable: true,
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
        conclusions: [],
        status: 'fresh',
        error: null,
      });
    }
    if (url.startsWith('/api/mainline')) {
      return json(mainlineReport);
    }
    throw new Error(`未预期的请求：${url}`);
  });
  vi.stubGlobal('fetch', impl);
  return impl;
};

const Harness = ({
  initialTab = 'trend' as ScreenerTab,
  onAddToWatchlist = vi.fn(),
  watchlistSymbols = new Set<string>(),
}: {
  initialTab?: ScreenerTab;
  onAddToWatchlist?: (stock: { symbol: string; name: string }) => void;
  watchlistSymbols?: ReadonlySet<string>;
} = {}) => {
  const [tab, setTab] = useState<ScreenerTab>(initialTab);
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

  it('只剩「主线」「趋势」两档，不再有「板块」「细分逻辑」', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['主线', '趋势']);
    expect(screen.queryByRole('tab', { name: '板块' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '细分逻辑' })).not.toBeInTheDocument();
  });

  it('默认展示趋势页，并且把受限的研究结论收在标题行的警示按钮里', async () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: '趋势' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: '趋势形态扫描（不是选股信号）' }),
    ).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /研究结论/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await screen.findByText('高澜股份')).toBeInTheDocument();
  });

  it('切到主线档：打 /api/mainline，并渲染四榜、反复出现、总览、明细四段', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '主线' }));

    // 默认回看 5 个交易日
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/mainline?days=5');
    });

    expect(await screen.findByRole('heading', { name: '主线' })).toBeInTheDocument();
    expect(screen.getByText('20260914 ~ 20260918（2 个交易日）')).toBeInTheDocument();

    // 四榜并列
    for (const label of ['涨幅榜', '涨停家数榜', '主力净流入榜', '成交额榜']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // 四段标题都在（内容长，靠章节跳转定位）
    expect(screen.getByRole('heading', { name: /一、四榜并列/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /二、反复出现的板块/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /三、当日板块总览/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /四、重点板块明细/ })).toBeInTheDocument();

    // 总览表有数据，不是空壳
    const overview = screen.getByRole('heading', { name: /三、当日板块总览/ }).nextElementSibling;
    const rows = within(overview as HTMLElement).getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
    expect(within(overview as HTMLElement).getByText('芯片概念')).toBeInTheDocument();

    // 章节跳转按钮
    for (const label of ['一 · 四榜并列', '二 · 反复出现', '三 · 板块总览', '四 · 重点明细']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('主线明细：五档阵容、归一后的题材、评分逐项依据都摆出来', async () => {
    render(<Harness initialTab="mainline" />);

    expect(await screen.findByText('远望谷（6天3板）')).toBeInTheDocument();
    // 中军不可判定时如实写明，而不是显示「无」
    expect(screen.getByText('不可判定（成员成交额缺失）')).toBeInTheDocument();
    // 题材带归一来源
    expect(screen.getByText('存储')).toBeInTheDocument();
    expect(screen.getByText(/归一自：存储芯片 \/ 半导体存储/)).toBeInTheDocument();
    // 评分明细逐项
    expect(screen.getByText('涨停家数 18，当日第 1 名')).toBeInTheDocument();
    expect(screen.getByText('成员成交额 / 流通市值缺失，中军不可判定')).toBeInTheDocument();
  });

  it('主线档回看天数可切：点了 3 天就按 days=3 重新取数', async () => {
    const user = userEvent.setup();
    render(<Harness initialTab="mainline" />);

    await screen.findByRole('heading', { name: '主线' });
    await user.click(screen.getByRole('button', { name: '3 天' }));

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/mainline?days=3');
    });
  });

  it('主线取数失败时显示失败原因，不拿旧数据顶上', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/mainline')) {
          return new Response('boom', { status: 502 });
        }
        throw new Error(`未预期的请求：${url}`);
      }),
    );

    render(<Harness initialTab="mainline" />);

    expect(await screen.findByText('主线数据拉取失败。')).toBeInTheDocument();
    expect(screen.getByText(/主线报告请求失败/)).toBeInTheDocument();
    // 失败态不能混进「没有数据」或「正在加载」
    expect(screen.queryByText(/正在拉取主线数据/)).not.toBeInTheDocument();
    expect(screen.queryByText(/拉取完成，但当前窗口内没有可用的主线数据/)).not.toBeInTheDocument();
  });

  it('加载中显示「正在拉取」，不说「没有数据」（取数约 7 秒，两者必须分开）', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/mainline')) {
          await gate;
          return json(mainlineReport);
        }
        throw new Error(`未预期的请求：${url}`);
      }),
    );

    render(<Harness initialTab="mainline" />);

    // 请求还在飞：只能说「正在拉取」
    expect(await screen.findByText(/正在拉取主线数据/)).toBeInTheDocument();
    expect(screen.getByText('正在拉取')).toBeInTheDocument();
    expect(screen.queryByText(/暂时没有主线数据/)).not.toBeInTheDocument();
    expect(screen.queryByText(/拉取完成，但当前窗口内没有可用的主线数据/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();

    release();

    // 拉完了才出数据，加载文案消失
    expect(await screen.findByRole('heading', { name: /三、当日板块总览/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/正在拉取主线数据/)).not.toBeInTheDocument();
    });
  });
});
