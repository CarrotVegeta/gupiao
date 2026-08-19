# Task 3 报告：前端市场/涨停请求模块和 stale 合并

## 改动文件

- `src/lib/market.ts`
- `src/lib/market.test.ts`
- `src/lib/limitUp.ts`
- `src/lib/limitUp.test.ts`
- `.superpowers/sdd/2026-08-19-market-focus-layout/task-3-report.md`

## 实现说明

### 1. `src/lib/market.ts`

- 新增 `fetchMarketOverview(fetchImpl?)`，固定请求 `/api/market-overview`。
- 对响应 JSON 做运行时校验，只保留符合 `MarketOverviewResponse`、`MarketIndex`、`QuoteError` 结构的字段。
- 非 2xx 响应抛出中文错误：`大盘请求失败（HTTP 状态码）`。
- 新增 `mergeMarketOverview(previous, response)`：
  - `fresh` 指数按 `symbol` 覆盖旧值；
  - `unavailable` / `stale` 指数若已有旧值，则仅把旧值标记为 `stale`，保留旧的价格、涨跌额、涨跌幅；
  - 若没有旧值，则保留当前返回的指数对象，避免丢失首轮状态。

### 2. `src/lib/limitUp.ts`

- 新增 `fetchLimitUp(date?, fetchImpl?)`，默认请求 `/api/limit-up`；传入日期时请求 `/api/limit-up?date=${encodeURIComponent(date)}`。
- 对响应 JSON 做运行时校验，只保留符合 `LimitUpResponse`、`LimitUpItem`、`QuoteError` 结构的字段。
- 校验 `LimitUpItem.symbol` 为 6 位数字，`firstSealTime` / `lastSealTime` / `industry` 允许 `string | null`。
- 非 2xx 响应抛出中文错误：`涨停请求失败（HTTP 状态码）`。
- 新增 `mergeLimitUp(previous, response)`：
  - 新响应为 `fresh` 时直接替换；
  - 新响应为 `unavailable` / `stale` 且存在上一轮数据时，保留上一轮 `items`，仅把整体状态改为 `stale`，并带上本轮 `fetchedAt` 与 `error`。

### 3. 测试补充

- `src/lib/market.test.ts` 增加：
  - 正确请求 `/api/market-overview`
  - 响应体过滤非法指数/错误项
  - 非 2xx 抛中文错误
  - `mergeMarketOverview` fresh 覆盖与 unavailable 保留旧值
- `src/lib/limitUp.test.ts` 增加：
  - 默认请求 `/api/limit-up`
  - 传日期时做 `encodeURIComponent`
  - 响应体过滤非法涨停项
  - 非 2xx 抛中文错误
  - `mergeLimitUp` fresh 替换与 unavailable 保留旧 `items`

## 命令与实际输出

### 1. TDD 红灯验证

命令：

```bash
npm test -- src/lib/market.test.ts src/lib/limitUp.test.ts
```

实际输出摘要：

```text
FAIL  src/lib/limitUp.test.ts
Error: Failed to resolve import "./limitUp"

FAIL  src/lib/market.test.ts
Error: Failed to resolve import "./market"

Test Files  2 failed (2)
Tests  no tests
```

结论：失败原因符合预期，来自目标模块尚未创建。

### 2. 模块测试绿灯验证

命令：

```bash
npm test -- src/lib/market.test.ts src/lib/limitUp.test.ts
```

实际输出：

```text
Test Files  2 passed (2)
Tests  13 passed (13)
Duration  1.11s
```

### 3. 类型检查

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

- 仅修改了 brief 允许的四个源码/测试文件，并新增本报告文件。
- 未触碰 `server`、`App`、`.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md`。
- 请求模块没有把 `unknown` 直接强转为目标类型，均通过运行时校验后再组装返回值。
- `unavailable` 合并时：
  - 大盘不会清空旧价格、涨跌额、涨跌幅；
  - 涨停不会清空上一轮 `items`。
- 错误文案为中文。

## Concerns

- 本次按 Task 3 范围执行了模块级测试与 `typecheck`，未额外运行 `npm run build` 或组件/页面级测试。
- 工作区原本存在未提交改动：`.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md`。本次已避开，不纳入提交。
