# 大盘行情、左侧导航与涨停聚焦实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有股票看板中加入顶部四大指数、左侧“持仓/涨停聚焦”一级导航，并通过服务端展示包含 ST 风险标的的最新交易日全部涨停股票。

**Architecture:** 服务端继续代理东方财富公开接口，分别标准化指数列表和涨停池数据；前端用两个纯请求模块消费稳定响应。`App` 只负责一级页面状态、刷新生命周期和现有持仓状态组合，展示细节拆到 `PrimaryNav`、`MarketOverview` 和 `LimitUpList`，分组导航移动到持仓列表上方。

**Tech Stack:** React 18+, TypeScript, Express, Vitest, Testing Library, 东方财富公开行情接口。

**Spec:** `docs/superpowers/specs/2026-08-19-market-focus-layout-design.md`

## Global Constraints

- 一级导航固定在主内容左侧，只包含“持仓”和“涨停聚焦”。
- 大盘行情固定显示在主内容顶部，展示上证指数、深证成指、创业板指和科创 50。
- 持仓页面的分组导航位于股票列表上方，不再占用一级导航位置。
- 涨停聚焦包含数据源返回的全部股票，不排除 ST、风险警示或其他标的。
- “几板”使用涨停池返回的连续涨停板数字；“板块”使用数据源返回的行业板块名称。
- 行情和涨停数据只保存在运行时缓存，不写入现有 `localStorage` 持仓数据。
- 不引入第三方 UI 框架、数据库或额外运行时依赖。
- 上游请求设置 5 秒超时；失败时前端保留上一轮成功数据。
- 所有验证继续使用 `npm run typecheck`、`npm test` 和 `npm run build`。

---

### Task 1: 添加共享市场与涨停数据模型

**Files:**
- Modify: `src/types.ts`
- Test: `src/lib/market.test.ts`（创建测试夹具时可暂时只放类型驱动的响应样例）
- Test: `src/lib/limitUp.test.ts`（创建测试夹具时可暂时只放类型驱动的响应样例）

**Interfaces:**
- Produces `MarketIndex`, `MarketOverviewResponse`, `LimitUpItem`, `LimitUpResponse`，供服务端、前端请求模块和 React 组件共同使用。

- [ ] **Step 1: 写出响应夹具测试**

在两个新测试文件中先声明实际响应夹具，要求包含：

```ts
const marketResponse: MarketOverviewResponse = {
  indices: [{
    symbol: '000001', name: '上证指数', price: 3990.29,
    change: -0.01, pct: 0, updatedAt: null, status: 'fresh',
  }],
  fetchedAt: '2026-08-19T02:00:00.000Z',
  source: 'eastmoney', errors: [],
};

const limitUpResponse: LimitUpResponse = {
  tradeDate: '20260818',
  items: [{
    symbol: '002820', name: '桂发祥', price: 12.27, pct: 10.04,
    boardCount: 3, firstSealTime: '09:25:00', lastSealTime: '09:25:00',
    industry: '休闲食品', breakCount: 0,
  }],
  fetchedAt: '2026-08-18T08:00:00.000Z',
  source: 'eastmoney', status: 'fresh', error: null,
};
```

运行：

```bash
npm test -- src/lib/market.test.ts src/lib/limitUp.test.ts
```

预期：FAIL，提示类型或模块尚未提供。

- [ ] **Step 2: 添加最小共享类型**

在 `src/types.ts` 中添加上述四个类型，字段类型与设计文档一致；沿用现有 `QuoteError` 结构，不新增重复的错误类型。

- [ ] **Step 3: 运行模型测试**

运行同一条 Vitest 命令，预期两个夹具测试 PASS。

- [ ] **Step 4: 提交**

```bash
git add src/types.ts src/lib/market.test.ts src/lib/limitUp.test.ts
git commit -m "feat: 增加大盘和涨停数据模型"
```

### Task 2: 实现东方财富指数与涨停池适配器和服务端接口

**Files:**
- Create: `server/market/eastmoney.ts`
- Create: `server/market/eastmoney.test.ts`
- Create: `server/limit-up/eastmoney.ts`
- Create: `server/limit-up/eastmoney.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Produces `mapEastmoneyMarket(payload, fetchedAt): MarketOverviewResponse`。
- Produces `fetchEastmoneyMarket(fetchImpl?): Promise<MarketOverviewResponse>`。
- Produces `mapEastmoneyLimitUpItem(raw): LimitUpItem | null`。
- Produces `fetchEastmoneyLimitUp(date, fetchImpl?): Promise<LimitUpResponse>`。
- Produces Express routes `GET /api/market-overview` and `GET /api/limit-up?date=YYYYMMDD`。

- [ ] **Step 1: 写指数适配器失败测试**

`server/market/eastmoney.test.ts` 使用东方财富 `data.diff` 夹具，断言 `f2/f3/f4/f12/f14` 映射为点位、涨跌幅、涨跌额、代码和名称，并断言四个固定 `secids` 出现在请求 URL 中。再添加单个坏指数行被标记为 `unavailable` 的测试。

运行：

```bash
npm test -- server/market/eastmoney.test.ts
```

预期：FAIL，因为适配器文件和函数尚不存在。

- [ ] **Step 2: 实现指数适配器**

创建 `server/market/eastmoney.ts`：

```ts
const MARKET_SYMBOLS = ['000001', '399001', '399006', '000688'] as const;
const MARKET_SECIDS = '1.000001,0.399001,0.399006,1.000688';
```

请求 `https://push2.eastmoney.com/api/qt/ulist.np/get`，使用 `fields=f2,f3,f4,f12,f14`，将每项转换为 `MarketIndex`。指数响应为 `data: null`、HTTP 非 2xx 或字段不完整时，不抛出整批错误；对应项用 `unavailable` 表示并保留错误信息。

- [ ] **Step 3: 运行指数测试并提交**

运行 `npm test -- server/market/eastmoney.test.ts`，确认 PASS 后提交：

```bash
git add server/market/eastmoney.ts server/market/eastmoney.test.ts
git commit -m "feat: 接入大盘指数行情"
```

- [ ] **Step 4: 写涨停池失败测试**

`server/limit-up/eastmoney.test.ts` 添加以下行为测试：

1. `c/n/p/zdp/lbc/fbt/lbt/hybk/zbc` 映射为标准化 `LimitUpItem`，价格按 `/1000` 缩放，`92500` 转为 `09:25:00`。
2. 缺少代码或名称的行返回 `null`，合法行不受影响。
3. 第一页 `tc=3,pool=[...]` 且 `pagesize=2` 时，适配器继续请求 `Pageindex=1` 并合并全部 3 行。
4. `data.pool=[]` 时返回 `tradeDate`、空 `items`、`status: 'fresh'`。
5. HTTP 错误或超时时返回 `status: 'unavailable'` 和中文错误，而不是抛出未处理异常。

运行：

```bash
npm test -- server/limit-up/eastmoney.test.ts
```

预期：FAIL，因为适配器文件和函数尚不存在。

- [ ] **Step 5: 实现涨停池分页适配器**

创建 `server/limit-up/eastmoney.ts`：

- 固定请求 `https://push2ex.eastmoney.com/getTopicZTPool`，带 `ut=7eea3edcaed734bea9cbfc24409ed989`、`dpt=wz.ztzt`、`sort=fbt:asc`；
- `pagesize` 使用 100，依据响应 `tc` 和 `Pageindex` 继续拉取，最多连续空页 1 页即停止；
- `p` 除以 1000，涨跌幅 `zdp` 保持百分比数值；
- `fbt/lbt` 统一补零为 `HH:mm:ss`，非法时间为 `null`；
- `hybk` 空字符串标准化为 `null`；
- 使用 `Set` 按股票代码去重，按数据源顺序保留结果；
- 请求通过 `AbortController` 在 5 秒后终止。

- [ ] **Step 6: 接入 Express 路由**

在 `server/index.ts` 中：

- 新增 `parseTradeDate(input)`，只接受 `/^\d{8}$/`；缺省日期使用 Asia/Shanghai 当前日期；
- `GET /api/market-overview` 返回 `MarketOverviewResponse`；
- `GET /api/limit-up` 非法日期返回 400，合法日期调用适配器并返回标准 body；
- 上游错误由适配器标准化为 200 响应中的 `status: 'unavailable'`，不暴露第三方原始堆栈。

用 `curl` 做接口级检查：

```bash
curl -sS http://localhost:5173/api/market-overview
curl -sS 'http://localhost:5173/api/limit-up?date=20260818'
curl -i 'http://localhost:5173/api/limit-up?date=bad'
```

预期：前两个返回 JSON，最后一个返回 HTTP 400。

- [ ] **Step 7: 运行服务端测试并提交**

运行：

```bash
npm test -- server/market/eastmoney.test.ts server/limit-up/eastmoney.test.ts
npm run typecheck
```

确认 PASS 后提交：

```bash
git add server/index.ts server/market server/limit-up
git commit -m "feat: 增加大盘和涨停聚焦接口"
```

### Task 3: 添加前端请求模块和状态合并逻辑

**Files:**
- Create: `src/lib/market.ts`
- Create: `src/lib/market.test.ts`
- Create: `src/lib/limitUp.ts`
- Create: `src/lib/limitUp.test.ts`

**Interfaces:**
- Produces `fetchMarketOverview(fetchImpl?): Promise<MarketOverviewResponse>`。
- Produces `mergeMarketOverview(previous, response): Record<string, MarketIndex>`。
- Produces `fetchLimitUp(date?, fetchImpl?): Promise<LimitUpResponse>`。
- Produces `mergeLimitUp(previous, response): LimitUpResponse`。

- [ ] **Step 1: 写请求模块失败测试**

添加以下测试：

```ts
it('requests the market overview endpoint', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(marketResponse)));
  await expect(fetchMarketOverview(fetchImpl)).resolves.toEqual(marketResponse);
  expect(fetchImpl).toHaveBeenCalledWith('/api/market-overview');
});

it('keeps the last fresh limit-up response when the next response is unavailable', () => {
  const previous = { ...limitUpResponse, status: 'fresh' as const };
  const next = { ...limitUpResponse, items: [], status: 'unavailable' as const, error: '网络错误' };
  expect(mergeLimitUp(previous, next)).toMatchObject({ status: 'stale', items: previous.items });
});
```

运行：

```bash
npm test -- src/lib/market.test.ts src/lib/limitUp.test.ts
```

预期：FAIL。

- [ ] **Step 2: 实现请求和校验**

`fetchMarketOverview` 请求 `/api/market-overview`；`fetchLimitUp` 请求 `/api/limit-up`，传入日期时用 `encodeURIComponent`。两个函数在非 2xx 时抛出中文错误，在 JSON 中只保留符合标准类型的字段。

`mergeMarketOverview` 按指数代码合并 fresh 值；响应中的 unavailable/stale 只把已有数据标记为 stale，不把已有价格清零。`mergeLimitUp` 在新响应 fresh 时替换 items，在 unavailable 时保留上一次 items 并把状态改成 stale。

- [ ] **Step 3: 运行模块测试并提交**

```bash
npm test -- src/lib/market.test.ts src/lib/limitUp.test.ts
git add src/lib/market.ts src/lib/market.test.ts src/lib/limitUp.ts src/lib/limitUp.test.ts
git commit -m "feat: 增加大盘和涨停前端请求模块"
```

### Task 4: 创建一级导航、顶部指数条和涨停列表组件

**Files:**
- Create: `src/components/PrimaryNav.tsx`
- Create: `src/components/MarketOverview.tsx`
- Create: `src/components/LimitUpList.tsx`
- Modify: `src/components/components.test.tsx`

**Interfaces:**
- `PrimaryNavProps = { activePage: 'holdings' | 'limit-up'; holdingCount: number; limitUpCount: number | null; onNavigate(page): void }`。
- `MarketOverviewProps = { indices: MarketIndex[]; lastUpdated: string | null; isRefreshing: boolean; onRefresh(): void }`。
- `LimitUpListProps = { data: LimitUpResponse; isRefreshing: boolean; onRefresh(): void }`。

- [ ] **Step 1: 写组件失败测试**

在 `components.test.tsx` 添加：

1. `PrimaryNav` 只渲染“持仓”和“涨停聚焦”，当前页面有 `aria-current="page"`，点击调用正确页面。
2. `MarketOverview` 渲染四个指数、涨跌幅、更新时间和刷新按钮，负数使用下跌语义类。
3. `LimitUpList` 渲染日期、数量、连板、行业、封板时间和炸板次数；空 items 显示“暂无涨停数据”；stale 显示“数据已过期”。

运行：

```bash
npm test -- src/components/components.test.tsx
```

预期：FAIL。

- [ ] **Step 2: 实现 `PrimaryNav`**

用原生 `button` 和 `aria-current`，不在组件中管理页面状态；`limitUpCount === null` 显示 `—`，避免把未加载当成 0。

- [ ] **Step 3: 实现 `MarketOverview`**

复用 `formatCurrency`、`formatPercent` 和时间格式化风格，指数点位显示两位小数；组件只消费 props，不发请求。

- [ ] **Step 4: 实现 `LimitUpList`**

用语义化 `table`，按 `data.items` 原顺序展示；`null` 字段显示 `—`；将 `tradeDate` 格式化为 `YYYY-MM-DD`；标题旁显示“包含 ST / 风险标的”。

- [ ] **Step 5: 运行组件测试并提交**

```bash
npm test -- src/components/components.test.tsx
git add src/components/PrimaryNav.tsx src/components/MarketOverview.tsx src/components/LimitUpList.tsx src/components/components.test.tsx
git commit -m "feat: 增加看板一级导航和涨停列表组件"
```

### Task 5: 重组 App 页面状态并移动分组导航

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/GroupSidebar.tsx`
- Modify: `src/components/components.test.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- `App` 新增 `activePage: 'holdings' | 'limit-up'`，默认 `'holdings'`。
- `PrimaryNav`、`MarketOverview` 和 `LimitUpList` 由 `App` 传入真实状态与回调。
- `GroupSidebar` 保持现有分组操作 props，只改变渲染位置和包裹语义。

- [ ] **Step 1: 写 App 集成失败测试**

在 `src/App.test.tsx` 添加：

1. 默认渲染顶部指数和持仓页面，并在股票列表之前找到“分组导航”。
2. 点击“涨停聚焦”后调用 `/api/limit-up`，渲染涨停股票；点击“持仓”后恢复总览和分组筛选。
3. 涨停请求返回 unavailable 时，页面显示过期提示而不影响已保存持仓。

测试 fetch mock 要按 URL 分支返回 `MarketOverviewResponse`、`QuotesResponse` 和 `LimitUpResponse`，不可只返回一种 JSON。

运行：

```bash
npm test -- src/App.test.tsx
```

预期：FAIL，因为 App 尚无一级页面状态和新增接口请求。

- [ ] **Step 2: 添加全局页面和行情状态**

在 `App` 中添加：

```ts
const [activePage, setActivePage] = useState<'holdings' | 'limit-up'>('holdings');
const [marketIndices, setMarketIndices] = useState<Record<string, MarketIndex>>({});
const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
const [limitUp, setLimitUp] = useState<LimitUpResponse>(emptyLimitUpResponse());
```

实现 `refreshMarketOverview` 和 `refreshLimitUp`，分别调用对应请求模块并使用 merge 函数；公共刷新定时器只在页面可见时运行，涨停页切入时立即请求一次。

- [ ] **Step 3: 调整 JSX 结构**

页面主结构固定为：

```tsx
<div className="dashboard-layout">
  <PrimaryNav ... />
  <main className="dashboard-main">
    <MarketOverview ... />
    {activePage === 'holdings' ? (
      <>
        <Overview ... />
        <GroupSidebar ... />
        <HoldingList ... />
      </>
    ) : (
      <LimitUpList ... />
    )}
  </main>
</div>
```

保留弹窗挂载位置和现有持仓刷新逻辑；涨停页不渲染持仓总览、分组导航或新增股票按钮。

- [ ] **Step 4: 运行集成测试并提交**

```bash
npm test -- src/App.test.tsx src/components/components.test.tsx
git add src/App.tsx src/App.test.tsx src/components/GroupSidebar.tsx src/components/components.test.tsx
git commit -m "feat: 重组看板页面导航和分组布局"
```

### Task 6: 完成响应式样式、文档和全量验收

**Files:**
- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `src/App.test.tsx`（如需补充小屏或 stale 验收）

**Interfaces:**
- Produces桌面端左侧导航 + 主内容区布局；小于 900px 时导航堆叠到主内容上方。
- Produces可横向滚动但不裁切涨停表格的窄屏展示。

- [ ] **Step 1: 添加样式回归测试断言**

在组件测试中断言：

    ```ts
    expect(screen.getByRole('navigation', { name: '一级导航' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '大盘行情' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '持仓筛选' })).toBeInTheDocument();
    ```

- [ ] **Step 2: 更新样式**

在 `src/styles.css` 增加：

- `.dashboard-layout` 的两栏网格；
- `.primary-nav` 的选中态和数量文字；
- `.market-overview` 的四项行情网格；
- `.limit-up-list`、`.limit-up-table` 以及 stale/empty 状态；
- `.group-sidebar` 在持仓内容中位于 `HoldingList` 之前；
- `@media (max-width: 900px)` 下导航、行情条和表格堆叠/滚动规则。

不得改变现有上涨暖红、下跌青绿、无数据中性灰的语义颜色。

- [ ] **Step 3: 更新 README 烟雾测试**

补充流程：打开顶部大盘行情、切换“涨停聚焦”、验证涨停表格包含连板和行业板块、切回“持仓”确认分组筛选和收益率仍在。

- [ ] **Step 4: 全量验证**

按顺序运行：

```bash
git diff --check
npm run typecheck
npm test
npm run build
```

启动开发服务器后运行：

```bash
curl -sS http://localhost:5173/api/market-overview
curl -sS 'http://localhost:5173/api/limit-up?date=20260818'
curl -i 'http://localhost:5173/api/limit-up?date=bad'
```

预期：类型检查、全部测试、生产构建退出码均为 0；页面和两个合法接口返回 200；非法日期返回 400。

- [ ] **Step 5: 提交最终改动**

```bash
git add src server README.md
git commit -m "feat: 完成大盘行情和涨停聚焦看板"
```
