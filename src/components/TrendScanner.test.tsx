import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrendScanner } from './TrendScanner';

// ---------------------------------------------------------------------------
// 夹具：固定响应，不发真实网络请求
// ---------------------------------------------------------------------------

const baseFilters = (overrides: Record<string, unknown> = {}) => ({
  // 板块范围已取消：趋势一律全市场（服务端忽略 themeScope）
  themeScope: 'all',
  maxMa5Dist: 4,
  maxPct: 20,
  pctWindow: 10,
  minStableDays: 3,
  minAmountYi: 5,
  minScore: 5,
  mainOnly: false,
  excludeSt: false,
  ...overrides,
});

const makePick = (overrides: Record<string, unknown> = {}) => ({
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
  matched: [
    '5/10/20 日线多头排列',
    '缩量（最近已完成日成交量/此前5日均量）：0.88（最近已完成日 20260917）',
  ],
  unmatched: [],
  metricsTradeDate: '20260917',
  lastBarCompleted: true,
  notes: [],
  ...overrides,
});

const makePicks = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    makePick({ symbol: String(300000 + index), name: `样本股${index}` }),
  );

const trendPayload = (overrides: Record<string, unknown> = {}) => ({
  tradeDate: '20260917',
  items: [makePick()],
  scanned: 260,
  candidates: 294,
  filters: baseFilters(),
  fetchedAt: '2026-09-17T14:00:00.000Z',
  source: 'eastmoney+10jqka',
  status: 'fresh',
  error: null,
  coverage: { total: 294, attempted: 260, succeeded: 255, failed: 5, unscanned: 34 },
  matchedTotal: 1,
  returnedCount: 1,
  truncated: true,
  metricsTradeDate: '20260917',
  quoteAsOf: '2026-09-17T14:00:00.000Z',
  ...overrides,
});

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const installFetch = (handler: (url: string) => unknown = () => trendPayload()) => {
  const impl = vi.fn(async (input: RequestInfo | URL) => json(handler(String(input))));
  vi.stubGlobal('fetch', impl);
  return impl;
};

const coverageText = (): string => document.querySelector('.trend-coverage')?.textContent ?? '';
const metaText = (): string => document.querySelector('.overview__actions')?.textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrendScanner', () => {
  it('缩量条件只描述量能，页面文案里不出现「回调」', async () => {
    installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );

    expect(await screen.findByText('高澜股份')).toBeInTheDocument();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('回调');
    expect(text).toContain('缩量（最近已完成日成交量/此前5日均量）');
    // 表头是短标签「缩量比」：口径写在 title 里，
    // 原来那个长标题会把这一列撑到数据宽度的两三倍
    const shrinkHeader = [...document.querySelectorAll('thead th')].find(
      (cell) => cell.textContent === '缩量比',
    );
    expect(shrinkHeader).toBeDefined();
    expect(shrinkHeader?.getAttribute('title')).toContain('最近已完成交易日成交量');
    // 研究结论改成受限表述，不再出现「已被回测否定」
    expect(text).not.toContain('已被本项目回测否定');
  });

  it('研究结论开关是标题行上的警示按钮：默认不显示正文，点开在下面展开', async () => {
    const user = userEvent.setup();
    installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    // 按钮在标题那一行（红框位置）：标题、按钮、右侧统计同属 .overview__header
    const heading = screen.getByRole('heading', { name: '趋势形态扫描（不是选股信号）' });
    const toggle = screen.getByRole('button', { name: /研究结论/ });
    const header = heading.closest('.overview__header');
    expect(header).not.toBeNull();
    expect(header?.contains(toggle)).toBe(true);
    expect(toggle.textContent).toContain('⚠');
    // 虚线框里的三角箭头/摘要条已经没有了
    expect(document.querySelector('.trend-research__summary')).toBeNull();

    // 默认不显示正文，按钮提示里带摘要与免责声明
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.getAttribute('title')).toContain('不支持收益优势');
    expect(toggle.getAttribute('title')).toContain('不构成任何买入建议');
    const panelId = toggle.getAttribute('aria-controls') ?? '';
    const panel = document.getElementById(panelId);
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('hidden')).toBe(true);
    // 正文仍在标题下面、表格上面
    expect(
      heading.compareDocumentPosition(panel as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(panelId)?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText(/不代表所有趋势方法无效/)).toBeInTheDocument();
    expect(screen.getByText(/只针对原配置/)).toBeInTheDocument();
    expect(screen.getByText(/展开原研究细节与已知限制/)).toBeInTheDocument();

    // 再点一下收起
    await user.click(screen.getByRole('button', { name: /研究结论/ }));
    expect(document.getElementById(panelId)?.hasAttribute('hidden')).toBe(true);
  });

  it('股票与板块分开两列：不再有「所属主线板块」，板块显示真实归属', async () => {
    installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    const headers = [...document.querySelectorAll('thead th')].map(
      (cell) => cell.textContent ?? '',
    );
    expect(headers).toContain('股票');
    expect(headers).toContain('板块');
    expect(headers.join(' ')).not.toContain('所属主线板块');
    // 空题材不再冒充板块
    expect(document.body.textContent).not.toContain('全市场口径');

    // 股票列只有股票本身，板块列是上游给的行业归属
    const row = screen.getByText('高澜股份').closest('tr');
    expect(row).not.toBeNull();
    const cells = [...(row as HTMLTableRowElement).children];
    expect(cells[0].textContent).toContain('高澜股份');
    expect(cells[1].textContent).toBe('专用设备');
  });

  it('板块缺失时显示「—」而不是空着', async () => {
    installFetch(() => trendPayload({ items: [makePick({ industry: null })] }));
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    const row = screen.getByText('高澜股份').closest('tr');
    const cells = [...(row as HTMLTableRowElement).children];
    expect(cells[1].textContent).toBe('—');
  });

  it('均线排列只给多头结论，不展示均线数值', async () => {
    installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    const row = screen.getByText('高澜股份').closest('tr');
    const cells = [...(row as HTMLTableRowElement).children];
    // 列序与界面一致：股票 / 板块 / 现价 / 涨跌幅 / 均线排列 / 距5日线偏离 / …
    expect(cells[4].textContent).toBe('多头');
    expect(document.body.textContent).not.toContain('37.18');
    expect(document.body.textContent).not.toContain('均线不足');
  });

  it('取消「板块范围」筛选：界面没有该下拉，请求也固定全市场', async () => {
    const impl = installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    // 界面上不再有板块范围下拉框
    expect(screen.queryByRole('combobox', { name: '板块范围' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '仅主线题材' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '全市场（对照）' })).not.toBeInTheDocument();
    // 「候选范围」与「生效条件」在折叠的条件区里；拉日K深度是另一档（默认 260 只）
    const settings = document.querySelector('.trend-settings');
    expect(settings?.textContent).toContain('候选范围：全市场');
    expect(settings?.textContent).toContain('拉日K上限');
    expect(settings?.textContent).toContain('拉日K 前 260 只');
    expect(settings?.textContent).toContain('生效条件：');
    expect(settings?.textContent).toContain('全市场');

    // 请求参数里始终带 themeScope=all
    const url = String(impl.mock.calls[0][0]);
    expect(url).toContain('themeScope=all');
    expect(url).not.toContain('themeScope=main');
  });

  it('条件与扫描范围默认折叠：折叠态只有一行摘要，点开才出现表单与覆盖说明', async () => {
    const user = userEvent.setup();
    installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    const settings = document.querySelector('.trend-settings');
    const summary = document.querySelector('.trend-settings__summary');
    expect(settings?.tagName).toBe('DETAILS');
    expect(settings?.hasAttribute('open')).toBe(false);
    // 折叠态摘要里就有生效条件与覆盖进度，不点开也能看到关键信息
    expect(summary?.textContent).toContain('5/5 档');
    expect(summary?.textContent).toContain('全市场');
    expect(summary?.textContent).toContain('已扫描 260 / 294 只');
    expect(summary?.textContent).toContain('未扫描 34');
    // 表单与覆盖明细都在折叠体里（浏览器渲染时不可见；jsdom 不支持 details 的可见性，用层级关系断言）
    const filterForm = document.querySelector('.trend-filters');
    const coverageBlock = document.querySelector('.trend-coverage');
    expect(settings?.contains(filterForm)).toBe(true);
    expect(settings?.contains(coverageBlock)).toBe(true);
    expect(filterForm?.closest('details')).toBe(settings);
    expect(filterForm?.closest('summary')).toBeNull();

    await user.click(summary as Element);

    expect(settings?.hasAttribute('open')).toBe(true);
    expect(document.querySelector('.trend-filters')).not.toBeNull();
    expect(document.querySelector('.trend-coverage')).not.toBeNull();
    expect(screen.getByRole('button', { name: '应用' })).toBeInTheDocument();
    expect(coverageText()).toContain('扫描范围 294 只');
  });

  it('披露扫描范围、未扫描数量，命中文案限定在已扫描范围内', async () => {
    installFetch();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    expect(metaText()).toContain('候选：294 只');
    expect(metaText()).toContain('拉日K：260 只');
    expect(metaText()).toContain('命中：1 只');
    expect(metaText()).toContain('已扫描范围内');

    expect(coverageText()).toContain('扫描范围 294 只');
    expect(coverageText()).toContain('已拉日K 260 只（成功 255 / 失败 5）');
    expect(coverageText()).toContain('未扫描 34 只');
    expect(coverageText()).toContain('不代表全市场筛选完成');
    expect(coverageText()).toContain('日K截止日：20260917');
    expect(coverageText()).toContain('报价观察时间');
  });

  it('261 个候选只扫 260 时，界面显示未扫描 1 只', async () => {
    installFetch(() =>
      trendPayload({
        candidates: 261,
        scanned: 260,
        coverage: { total: 261, attempted: 260, succeeded: 260, failed: 0, unscanned: 1 },
      }),
    );
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    expect(coverageText()).toContain('扫描范围 261 只');
    expect(coverageText()).toContain('未扫描 1 只');
    expect(coverageText()).toContain('不代表全市场筛选完成');
  });

  it('「拉日K上限」默认 260；选「全部」应用后按 scanLimit=0 请求并改写覆盖说明', async () => {
    const fetchImpl = installFetch((url) =>
      url.includes('scanLimit=0')
        ? trendPayload({
            candidates: 5917,
            scanned: 5917,
            filters: baseFilters({ scanLimit: 0 }),
            coverage: { total: 5917, attempted: 5917, succeeded: 5900, failed: 17, unscanned: 0 },
          })
        : trendPayload(),
    );
    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    // 首次加载就是默认的 260 只快速档
    expect(String(fetchImpl.mock.calls[0][0])).toContain('scanLimit=260');

    // 条件区整体折叠，先展开才能操作表单
    await user.click(document.querySelector('.trend-settings__summary') as Element);

    const select = screen.getByRole('combobox', { name: /拉日K上限/ });
    // 「全部」这一档就在下拉里，不需要改代码
    expect(within(select).getByRole('option', { name: /全部/ })).toBeInTheDocument();
    await user.selectOptions(select, '0');
    await user.click(screen.getByRole('button', { name: '应用' }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(String(fetchImpl.mock.calls[1][0])).toContain('scanLimit=0');

    // 全市场覆盖：未扫描为 0，不再提示「未扫描」
    await waitFor(() => expect(coverageText()).toContain('未扫描 0 只'));
    expect(coverageText()).not.toContain('把「拉日K上限」改成「全部」');
    // 并把「全部扫描」的耗时预期写在页面上
    expect(document.body.textContent).toContain('当前是「全部」扫描');
    // 折叠态摘要也跟着改了
    expect(document.querySelector('.trend-settings__summary')?.textContent).toContain('拉日K 全部');
  }, 20000);

  it('命中超过 120 行时说明还有多少条未显示', async () => {
    installFetch(() =>
      trendPayload({
        items: makePicks(120),
        candidates: 200,
        scanned: 200,
        coverage: { total: 200, attempted: 200, succeeded: 200, failed: 0, unscanned: 0 },
        matchedTotal: 135,
        returnedCount: 120,
      }),
    );
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('样本股0');

    expect(coverageText()).toContain('已显示 120 行');
    expect(coverageText()).toContain('还有 15 条未显示');
  }, 20000);

  it('覆盖字段缺失时如实说明无法确认范围，而不是假装扫完了', async () => {
    installFetch(() =>
      trendPayload({ coverage: undefined, matchedTotal: undefined, returnedCount: undefined, truncated: undefined }),
    );
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    expect(coverageText()).toContain('无法确认扫描范围');
  });

  it('空数字输入不通过校验：给字段错误且不发请求', async () => {
    const fetchImpl = installFetch();
    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const stableInput = screen.getByRole('spinbutton', { name: /连续站稳 5 日线/ });
    await user.clear(stableInput);
    await user.click(screen.getByRole('button', { name: '应用' }));

    expect(await screen.findByText(/不能为空/)).toBeInTheDocument();
    // 空输入没有被当成 0，也没有发起请求
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  }, 20000);

  it('非整数天数与小于最小值的输入被拒绝，且不发请求', async () => {
    const fetchImpl = installFetch();
    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 天数必须是整数：2.5 天不是合法输入
    const stableInput = screen.getByRole('spinbutton', { name: /连续站稳 5 日线/ });
    fireEvent.change(stableInput, { target: { value: '2.5' } });
    await user.click(screen.getByRole('button', { name: '应用' }));
    expect(await screen.findByText('必须是整数天数')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 小于最小值给字段错误（表单 noValidate，校验由这里的字段提示负责）
    fireEvent.change(stableInput, { target: { value: '3' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /日均成交额下限/ }), {
      target: { value: '-1' },
    });
    await user.click(screen.getByRole('button', { name: '应用' }));
    expect(await screen.findByText('必须在 0 ~ 500 之间')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  }, 20000);

  it('快速连续三次点「应用」只产生一次请求', async () => {
    const fetchImpl = installFetch();
    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');

    const amountInput = screen.getByRole('spinbutton', { name: /日均成交额下限/ });
    fireEvent.change(amountInput, { target: { value: '8' } });

    const apply = screen.getByRole('button', { name: '应用' });
    await user.click(apply);
    await user.click(apply);
    await user.click(apply);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2)); // 首次加载 + 一次应用
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.includes('minAmountYi=8'))).toHaveLength(1);
  });

  it('「重新扫描」用已生效条件，不用草稿里没应用的值', async () => {
    const fetchImpl = installFetch();
    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');
    await waitFor(() => expect(screen.getByRole('button', { name: '重新扫描' })).toBeEnabled());

    fireEvent.change(screen.getByRole('spinbutton', { name: /日均成交额下限/ }), {
      target: { value: '9' },
    });
    await user.click(screen.getByRole('button', { name: '重新扫描' }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const lastUrl = String(fetchImpl.mock.calls[1][0]);
    expect(lastUrl).toContain('minAmountYi=5');
    expect(lastUrl).not.toContain('minAmountYi=9');
  });

  it('旧请求晚返回不能覆盖新参数的结果', async () => {
    const pending: Array<{ url: string; resolve: (value: Response) => void }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            pending.push({ url: String(input), resolve });
          }),
      ),
    );

    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    // 条件改成 10 亿并应用：请求 2
    fireEvent.change(screen.getByRole('spinbutton', { name: /日均成交额下限/ }), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(pending).toHaveLength(2));

    // 新条件还没回来时，不能继续显示旧条件的结果
    expect(screen.queryByText('旧条件票')).not.toBeInTheDocument();

    await act(async () => {
      pending[1].resolve(
        json(trendPayload({ items: [makePick({ name: '新条件票', symbol: '300501' })] })),
      );
      await Promise.resolve();
    });
    expect(await screen.findByText('新条件票')).toBeInTheDocument();

    // 旧请求这时才返回，必须被丢弃
    await act(async () => {
      pending[0].resolve(
        json(trendPayload({ items: [makePick({ name: '旧条件票', symbol: '300502' })] })),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText('旧条件票')).not.toBeInTheDocument();
    expect(screen.getByText('新条件票')).toBeInTheDocument();
  });

  it('同一条件失败保留上一轮结果并标过期，换条件失败则不显示旧结果', async () => {
    let mode: 'ok' | 'fail' = 'ok';
    installFetch(() => {
      if (mode === 'fail') throw new Error('上游挂了');
      return trendPayload();
    });

    const user = userEvent.setup();
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );
    await screen.findByText('高澜股份');
    await waitFor(() => expect(screen.getByRole('button', { name: '重新扫描' })).toBeEnabled());

    // 同条件重扫失败：旧结果保留，并明确标成过期
    mode = 'fail';
    await user.click(screen.getByRole('button', { name: '重新扫描' }));

    expect(await screen.findByText(/同一条件下的上一轮结果/)).toBeInTheDocument();
    expect(screen.getByText('高澜股份')).toBeInTheDocument();
    expect(screen.getByText('上游挂了')).toBeInTheDocument();

    // 换条件失败：不同键的旧结果不能再当成当前结果
    fireEvent.change(screen.getByRole('spinbutton', { name: /日均成交额下限/ }), {
      target: { value: '12' },
    });
    await user.click(screen.getByRole('button', { name: '应用' }));

    expect(await screen.findByText('形态扫描请求失败。')).toBeInTheDocument();
    expect(screen.queryByText('高澜股份')).not.toBeInTheDocument();
    expect(screen.getByText('还没有可用结果。')).toBeInTheDocument();
  });

  it('4/5 档标明是旧模板研究模式，并列出具体缺哪一项', async () => {
    installFetch(() =>
      trendPayload({
        filters: baseFilters({ minScore: 4 }),
        items: [
          makePick({
            matched: ['5/10/20 日线多头排列'],
            unmatched: ['仅连续 2 日站稳 5 日线（要求 ≥3）'],
          }),
        ],
      }),
    );
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );

    expect(await screen.findByText('高澜股份')).toBeInTheDocument();
    expect(screen.getByText(/旧模板研究模式/)).toBeInTheDocument();
    expect(screen.getByText('✘ 仅连续 2 日站稳 5 日线（要求 ≥3）')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('全部硬条件通过');
  });

  it('数据不可用时给出可见提示而不是白屏', async () => {
    installFetch(() => ({ message: '上游失败' }));
    render(
      <TrendScanner onAddToWatchlist={vi.fn()} watchlistSymbols={new Set<string>()} />,
    );

    expect(await screen.findByText('形态扫描暂不可用。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '趋势形态扫描（不是选股信号）' })).toBeInTheDocument();
  });

  it('结果行末尾有「添加自选」，已在自选的股票按钮置灰', async () => {
    const user = userEvent.setup();
    const onAddToWatchlist = vi.fn();
    installFetch(() =>
      trendPayload({
        items: [makePick({ symbol: '300499', name: '高澜股份' }), makePick({ symbol: '300500', name: '样本股' })],
        matchedTotal: 2,
        returnedCount: 2,
      }),
    );
    render(
      <TrendScanner
        onAddToWatchlist={onAddToWatchlist}
        watchlistSymbols={new Set(['300500'])}
      />,
    );

    await screen.findByText('高澜股份');
    expect(screen.getByRole('button', { name: '样本股 已在自选' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '添加 高澜股份 到自选' }));
    expect(onAddToWatchlist).toHaveBeenCalledWith({ symbol: '300499', name: '高澜股份' });
  });
});
