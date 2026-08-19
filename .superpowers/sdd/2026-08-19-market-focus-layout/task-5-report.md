# Task 5 报告：重组 App 页面状态并移动分组布局

## 改动文件

- `src/App.tsx`
- `src/App.test.tsx`
- `src/components/GroupSidebar.tsx`
- `src/components/components.test.tsx`
- `.superpowers/sdd/2026-08-19-market-focus-layout/task-5-report.md`

## 实现说明

### 1. `src/App.tsx`

- 新增一级页面状态 `activePage: 'holdings' | 'limit-up'`，默认值为 `holdings`。
- 接入 `PrimaryNav`、`MarketOverview`、`LimitUpList` 三个纯 props 组件，由 `App` 统一提供状态和回调。
- 新增大盘状态：
  - `marketIndices`
  - `marketUpdatedAt`
  - `isMarketRefreshing`
- 新增涨停状态：
  - `limitUp`
  - `isLimitUpRefreshing`
- 新增 `refreshMarketOverview()` 与 `refreshLimitUp()`，分别调用：
  - `fetchMarketOverview` / `mergeMarketOverview`
  - `fetchLimitUp` / `mergeLimitUp`
- 统一页面可见性刷新生命周期：
  - 初始挂载时刷新大盘；
  - 持仓仍保留原有挂载即刷新 quotes 的逻辑；
  - 页面可见时启动 30 秒公共刷新；
  - 页面重新可见时立即刷新大盘、持仓 quotes，以及当前在涨停页时的涨停池。
- 切入“涨停聚焦”页时立即请求 `/api/limit-up?date=YYYYMMDD`。
- JSX 结构重组为：
  - 顶部一级导航
  - 主区域固定显示大盘
  - `holdings` 页渲染持仓总览、分组导航、股票列表
  - `limit-up` 页只渲染涨停列表
- 保留了原有持仓、分组、收益、弹窗和 quotes 刷新逻辑；涨停页不渲染持仓总览、分组导航和“添加股票”入口。

### 2. `src/components/GroupSidebar.tsx`

- 仅调整包裹语义：外层从 `aside` 改为 `section`。
- 保留现有分组操作 props、按钮文案、筛选逻辑和交互行为不变。
- 这样在新的主内容流中作为“分组区域”而不是侧边栏 landmark，更符合新的页面布局。

### 3. `src/App.test.tsx`

- 将 `fetch` mock 改为按 URL 分支返回不同 JSON：
  - `/api/market-overview`
  - `/api/quotes?...`
  - `/api/limit-up?date=...`
- 新增集成测试覆盖：
  - 默认进入持仓页，渲染大盘概览，且分组导航位于股票列表之前；
  - 点击“涨停聚焦”后立即请求涨停接口、渲染涨停列表，返回持仓页后恢复总览/分组/添加股票入口；
  - 涨停接口返回 `status: unavailable` 时，通过合并逻辑显示“数据已过期”，且不影响已保存持仓。
- 同时更新原有测试中的请求断言，避免新增大盘请求后把 `fetch` 次数误判为 quotes 行为。

### 4. `src/components/components.test.tsx`

- 新增 `GroupSidebar` 语义测试：
  - 作为具名 `region` 暴露；
  - 不再暴露为 `complementary` 侧边栏 landmark。

## 命令与实际结果

### 1. TDD 红灯验证：App 集成测试

命令：

```bash
npm test -- src/App.test.tsx
```

实际输出摘要：

```text
❯ src/App.test.tsx (12 tests | 3 failed)
× shows the market overview above the holdings page and places group navigation before the stock list
× requests and renders limit-up data when navigating, then restores holdings-only sections
× shows a stale limit-up notice for unavailable responses without mutating saved holdings
```

结论：失败原因符合预期，App 尚未接入一级页面状态、大盘概览与涨停页面装配。

### 2. TDD 红灯验证：GroupSidebar 语义测试

命令：

```bash
npm test -- src/components/components.test.tsx
```

实际输出摘要：

```text
❯ src/components/components.test.tsx (20 tests | 1 failed)
× exposes the group navigation as a named region instead of a complementary sidebar landmark
```

结论：失败原因符合预期，当前 `GroupSidebar` 仍使用 `aside` 语义。

### 3. 目标测试绿灯验证

命令：

```bash
npm test -- src/App.test.tsx src/components/components.test.tsx
```

实际输出：

```text
Test Files  2 passed (2)
Tests  32 passed (32)
```

### 4. 类型检查

命令：

```bash
npm run typecheck
```

实际输出：

```text
> typecheck
> tsc -b --pretty false tsconfig.json tsconfig.server.json
```

结论：命令退出码为 0，通过。

## 自查

- 仅修改了 brief 允许的 4 个源码/测试文件，并新增本任务报告文件。
- 未触碰 `styles`、`server`、请求模块，也未修改 `.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md`。
- 一级导航默认页为 `holdings`。
- 大盘概览在持仓页和涨停页都会显示。
- 涨停页切入时立即请求，页面可见时纳入 30 秒公共刷新。
- 涨停页不会渲染持仓总览、分组导航和“添加股票”入口。
- 分组导航已移动到股票列表上方。

## Concerns

- 本次按任务要求运行了 `src/App.test.tsx`、`src/components/components.test.tsx` 和 `npm run typecheck`，未额外运行全量测试或 `npm run build`。
- 工作区原本存在与本任务无关的未提交改动：`.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md`。本次已避开，未纳入修改与提交。

## 2026-08-19 审查修复追加

### 根因

- `src/App.tsx` 中的 `refreshMarketOverview()` 与 `refreshLimitUp()` 只处理了 resolved 响应，没有捕获 rejected fetch。
- `src/lib/market.ts` 与 `src/lib/limitUp.ts` 在网络失败或非 2xx 时会直接 `throw`，导致：
  - 失败路径没有进入 `mergeMarketOverview` / `mergeLimitUp`；
  - 上一轮成功数据无法保留为 stale；
  - 页面交互会留下 unhandled rejection。

### 修复说明

- 在 `App` 内为两个刷新函数补上 rejected 分支捕获，不修改请求模块。
- 大盘 rejected 时：
  - 生成中文错误的 unavailable 标准化响应；
  - 通过 `mergeMarketOverview` 把已有指数状态降级为 stale，保留上一轮价格、涨跌额和涨跌幅；
  - 若此前没有成功数据，则保留空列表状态，不崩溃。
- 涨停池 rejected 时：
  - 生成中文错误的 unavailable 标准化响应；
  - 通过 `mergeLimitUp` 保留上一轮 `items`，并把整体状态降级为 stale；
  - 若此前没有成功数据，则保持空池 stale 状态。
- 保留了原有 resolved `status: unavailable` 的处理路径，没有改动页面结构和可见性刷新策略。

### 本轮 TDD 红灯验证

命令：

```bash
npm test -- src/App.test.tsx
```

实际输出摘要：

```text
❯ src/App.test.tsx (14 tests | 2 failed)
× keeps the last market overview values when a later market refresh rejects
× keeps the last limit-up items when a later limit-up refresh rejects

Unhandled Rejection
Error: network down
```

结论：失败原因符合预期，正是 rejected fetch 未被 App 捕获，也没有进入 stale 合并。

### 本轮修复后目标测试

命令：

```bash
npm test -- src/App.test.tsx src/components/components.test.tsx
```

实际输出：

```text
Test Files  2 passed (2)
Tests  34 passed (34)
```

### 本轮修复后类型检查

命令：

```bash
npm run typecheck
```

实际输出：

```text
> typecheck
> tsc -b --pretty false tsconfig.json tsconfig.server.json
```

结论：命令退出码为 0，通过。
