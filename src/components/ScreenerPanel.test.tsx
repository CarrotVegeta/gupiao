import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenerPanel, type ScreenerTab } from './ScreenerPanel';

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
  metrics: [
    { key: 'duration', label: '持续时间', hit: true, value: '6 天', detail: '连续 6 个交易日涨停家数 ≥2' },
    { key: 'limitUpCount', label: '涨停家数', hit: true, value: '12 只', detail: '主线要求 ≥5' },
    { key: 'ladder', label: '连板梯队', hit: true, value: '最高 5 板', detail: '梯队完整' },
    { key: 'amount', label: '成交额', hit: false, value: '1.08 倍', detail: '要求放大 ≥1.15 倍' },
    { key: 'catalyst', label: '催化强度', hit: false, value: '未识别', detail: '未命中关键词' },
    { key: 'leader', label: '龙头表现', hit: true, value: '澳弘电子', detail: '最高 5 板' },
    { key: 'revival', label: '回流能力', hit: true, value: '分歧后回升', detail: '分歧后回升' },
    { key: 'influence', label: '市场影响力', hit: true, value: '较上证 +0.7%', detail: '跑赢上证' },
  ],
  score: 6,
};

const branchItem = {
  ...themeItem,
  code: 'BK0590',
  name: '西部大开发',
  kind: 'branch' as const,
  limitUpCount: 8,
  score: 3,
};

const trendPick = {
  symbol: '300499',
  name: '高澜股份',
  themes: [{ code: 'BK0900', name: '新能源车' }],
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

const stocksPayload = (role: string) => ({
  tradeDate: '20260917',
  theme: { code: 'BK0900', name: '新能源车' },
  role,
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
      hits: ['首封时间早（09:31:01）'],
      misses: ['开板 37 次（要求 ≤1）'],
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
    },
  ],
  scanned: 12,
  fetchedAt: '2026-09-17T14:00:00.000Z',
  source: 'eastmoney+10jqka+tencent',
  status: 'fresh',
  error: null,
});

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
    if (url.includes('/stocks')) {
      const role = new URL(url, 'http://x').searchParams.get('role') ?? 'leader';
      return json(stocksPayload(role));
    }
    if (url.startsWith('/api/themes')) {
      return json({
        tradeDate: '20260917',
        main: [themeItem],
        branch: [branchItem],
        fetchedAt: '2026-09-17T14:00:00.000Z',
        source: 'eastmoney+10jqka',
        status: 'fresh',
        error: null,
      });
    }
    throw new Error(`未预期的请求：${url}`);
  });
  vi.stubGlobal('fetch', impl);
  return impl;
};

const Harness = () => {
  const [tab, setTab] = useState<ScreenerTab>('trend');
  return <ScreenerPanel activeTab={tab} onTabChange={setTab} />;
};

describe('ScreenerPanel', () => {
  beforeEach(() => {
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('默认展示趋势页，并且把回测结论固定显示出来', async () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: '趋势' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: '趋势形态扫描（不是选股信号）' }),
    ).toBeInTheDocument();

    // 回测结论必须在页头，不能只写在文档里
    const banner = document.querySelector('.trend-evidence');
    expect(banner?.textContent).toContain('已被本项目回测否定');
    expect(banner?.textContent).toContain('−2.426%');

    expect(await screen.findByText('高澜股份')).toBeInTheDocument();
    // 漏斗规模要可见：候选 294 → 拉日K 260 → 命中 1
    const meta = document.querySelector('.overview__actions')?.textContent ?? '';
    expect(meta).toContain('候选：294 只');
    expect(meta).toContain('拉日K：260 只');
    expect(meta).toContain('命中：1 只');
  });

  it('趋势页给出「至少满足条件数」这一档，用来放宽扫描门槛', async () => {
    render(<Harness />);
    await screen.findByText('高澜股份');

    const select = screen.getByRole('combobox', { name: '至少满足条件数' });
    expect(select).toHaveValue('5');
    // 放宽档位存在，方便看「差一点」的票
    expect(screen.getByRole('option', { name: '4/5（看差一点）' })).toBeInTheDocument();
  });

  it('切到题材页显示主线与支线，点击主线进入详情', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));

    expect(await screen.findByRole('heading', { name: '主线题材' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '支线题材（涨停 2~4 只）' })).toBeInTheDocument();
    expect(screen.getAllByText('新能源车').length).toBeGreaterThan(0);
    expect(screen.getAllByText('西部大开发').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '查看 新能源车 的题材详情' }));

    expect(
      await screen.findByRole('heading', { name: /新能源车 · 12 只涨停 · 最高 5 板 · 持续 6 天/ }),
    ).toBeInTheDocument();

    // 8 个指标逐项展示，命中的标出来
    expect(document.querySelectorAll('.theme-detail__metric')).toHaveLength(8);
    expect(document.querySelectorAll('.theme-detail__metric--hit')).toHaveLength(6);
    expect(screen.getByText('涨停原因：量产 · 订单')).toBeInTheDocument();
  });

  it('题材详情默认落在主线龙头，4 个标签都可切换且命中/未命中都列出', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));

    const tabs = ['主线龙头', '主线换手核心', '主线趋势中军', '主线低位补涨'];
    for (const label of tabs) {
      expect(await screen.findByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: '主线龙头' })).toHaveAttribute('aria-selected', 'true');

    expect(await screen.findByText('✔ 首封时间早（09:31:01）')).toBeInTheDocument();
    expect(screen.getByText('✘ 开板 37 次（要求 ≤1）')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '主线换手核心' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '主线换手核心' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('趋势中军标签明确声明「均线多头不再作为硬条件」', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: '题材' }));
    await user.click(await screen.findByRole('button', { name: '查看 新能源车 的题材详情' }));
    await user.click(await screen.findByRole('tab', { name: '主线趋势中军' }));

    expect(
      await screen.findByText(/不再把「MA5>MA10>MA20」当硬条件/),
    ).toBeInTheDocument();
    // 均线排列作为展示列存在（合并在「形态」列里），但不参与筛选
    expect(
      screen.getByRole('columnheader', { name: '形态（均线 / 距5日线 / 10日站上）' }),
    ).toBeInTheDocument();
  });

  it('数据不可用时给出可见提示而不是白屏', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: '上游失败' })),
    );

    render(<Harness />);

    await waitFor(() =>
      expect(screen.getByText('形态扫描暂不可用。')).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: '题材' })).toBeInTheDocument();
  });
});
