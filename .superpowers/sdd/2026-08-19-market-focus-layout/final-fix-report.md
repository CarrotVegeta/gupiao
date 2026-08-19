# 最终审查修正报告

## 基线与范围

- 修正基线：`a64b855311b886e3c0073d5ac0af1bbe79661a2d`
- 修正方式：当前任务内单次修正，无子代理。
- 初始基线测试：`npm test` 退出码 0，`11 passed`，`97 passed`。
- 未触碰、未暂存：`.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md`。该文件在本轮开始前已经处于修改状态。
- `LimitUpResponse.error` 已按设计统一为 `string | null`；实现和正常测试夹具中不再混用错误对象。

## 6 个 Important finding 的修复

### 1. 前端涨停 envelope 原子校验

- `src/lib/limitUp.ts` 对完整 envelope 一次性校验：
  - `items` 必须是数组，且每一行都符合共享类型；不再过滤坏行后继续返回 `fresh`。
  - `source` 必须为 `eastmoney`。
  - `status`、`tradeDate`、`fetchedAt`、`error` 必须满足契约；`fetchedAt` 必须可解析。
  - `fresh` 必须有 8 位交易日且 `error === null`。
- 任一字段或行不合法时标准化为 `unavailable`、空 `items`、`tradeDate: null` 和稳定中文错误 `涨停响应数据格式错误`。
- JSON 解析失败抛出稳定中文错误，不透传原始解析器英文信息。
- `mergeLimitUp` 只有收到合法 `fresh` 才替换数据；坏 envelope 标准化后的 unavailable 会保留上一轮成功数据。
- 回归：`src/lib/limitUp.test.ts` 覆盖非数组 `items`、坏 item、坏 source/status/tradeDate/fetchedAt/error、坏 JSON 和 merge 保留。

### 2. 前端大盘固定四项与非法时间

- `src/lib/market.ts` 固定维护上证指数、深证成指、创业板指、科创 50 四个槽位，并提供固定顺序转换；不依赖数字对象键的枚举顺序。
- 首次网络失败、坏 payload、缺行、坏行和非法 `fetchedAt` 都返回/合并为四个占位。
- 缺失项为 `unavailable`；若上一轮有成功值则变为 `stale` 并保留旧值。
- `MarketIndex.price/change/pct` 改为 `number | null`；占位统一为 `null`，不再伪装成 0。
- `MarketOverview` 的数值和时间格式化先校验 null/finite/Invalid Date，非法时间显示“未刷新”，不会抛 `RangeError`。
- App 从初始渲染开始就持有四个占位，失败刷新不覆盖最后成功更新时间。
- 回归：`src/lib/market.test.ts`、`src/components/components.test.tsx`、`src/App.test.tsx` 覆盖坏 payload、缺行、首次失败、四占位 null 和非法时间。

### 3. 涨停初始 unavailable 与跨交易日 stale

- App 初始涨停状态改为 `status: unavailable`、`tradeDate: null`，未加载数量显示 `—`。
- 首次失败保持 unavailable，不再被错误合并成 stale，也不使用请求日期伪造数据日期。
- 上一轮成功后再次失败时，`mergeLimitUp` 只更新 `status: stale` 和错误文案，完整保留上一轮 `items`、`tradeDate`、成功 `fetchedAt`。
- `LimitUpList` 对 unavailable 显示“涨停数据暂不可用”“暂无可用涨停数据”和“交易日：暂无数据”；stale 继续显示“数据已过期”。
- 回归：模块测试直接校验成功时间/交易日不被失败覆盖；App 测试覆盖首次 unavailable 和跨交易日失败仍显示上一交易日。

### 4. nullable 涨停数值与 6 位代码

- `LimitUpItem.price/pct/boardCount/breakCount` 改为 `number | null`。
- 服务端只丢弃缺少有效代码或名称的行；价格、涨跌幅、连板数、炸板数缺失时保留该行并映射为 null。
- 数字转换显式拒绝空字符串、纯空白和 `-`，不再触发 `Number('') === 0`。
- 股票代码统一标准化为 6 位，覆盖数值代码、短数字代码、`SH/SZ/BJ` 前缀和 `1.600000` 一类 QuoteID。
- 表格对四个 nullable 数值字段统一显示 `—`。
- 回归：服务端映射测试覆盖 `17 -> 000017`、`1.600000 -> 600000` 和四个缺失数值；组件测试逐列断言 null 显示 `—`。

### 5. 按 tc 和原始 pool 行数完成分页

- 分页完整性改用 `receivedPoolRows += pool.length`，与去重后的 `items.length` 完全解耦。
- 不再因 `pool.length < pagesize` 提前结束；只在以下条件停止：
  - 原始行数达到上游 `tc`；
  - 收到空页；
  - 达到 50 页安全上限。
- 后续页 `tc` 变化时采用已见最大值，避免较小的瞬时值导致提前完成。
- 空页或安全上限时若 `tc` 仍显示未收齐，整批返回 unavailable、空 items 和 `涨停池分页数据不完整`，不会返回不完整 fresh。
- 仍按标准化 symbol 去重并保持首见顺序；去重不参与完整性判断。
- 回归：覆盖短页但 `tc` 未收齐继续请求、未收齐空页 unavailable、安全上限 unavailable、空池 fresh。

### 6. 5 秒超时覆盖 body/JSON 与稳定中文错误

- 涨停每页请求的 AbortController 直到 `response.json()` 完成后才清理，覆盖 headers、body 读取和 JSON 解析。
- 大盘请求的同一 5 秒计时器同样覆盖 body/JSON；同时兼容 signal 已 abort 但底层抛出非 AbortError 的情况。
- 错误分类稳定：
  - Abort：`大盘指数上游请求超时` / `涨停池上游请求超时`。
  - 坏 JSON：`大盘指数上游响应格式错误` / `涨停池上游响应格式错误`。
  - 普通失败：`大盘指数上游请求失败` / `涨停池上游请求失败`。
  - HTTP 错误保留中文固定前缀和状态码。
- 不再拼接或暴露第三方英文 `error.message`。
- 回归：两套服务端测试都用挂起的 `json()` 验证 5 秒 body 超时，并覆盖 Abort、坏 JSON、普通英文错误不外泄。

## 既有验收保留情况

- 四指数请求 URL 仍固定为 `1.000001,0.399001,0.399006,1.000688`，测试继续断言 URL 和 fields。
- 涨停池未增加 ST/风险过滤，App/组件测试继续包含 `ST中华`。
- `tc=0,pool=[]` 仍返回 fresh 空池。
- `server/index.ts` 的 8 位日期校验和非法日期 400 路径未改动。
- 成功后失败 stale 保留、30 秒可见页刷新、持仓/分组/收益/搜索相关测试均在全量套件中通过。

## TDD 与聚焦测试实际结果

### RED

- 前端命令：

  ```text
  npm test -- src/lib/limitUp.test.ts src/lib/market.test.ts src/components/components.test.tsx src/App.test.tsx
  ```

  实际：退出码 1，`4 failed`，`22 failed | 41 passed`。失败对应坏 fresh envelope、四占位、nullable、首次 unavailable、跨日 stale 和 Invalid Date。

- 服务端命令：

  ```text
  npm test -- server/limit-up/eastmoney.test.ts server/market/eastmoney.test.ts
  ```

  实际：退出码 1，`2 failed`，`15 failed | 4 passed`。body 超时用例在旧实现中超时，其他失败对应 nullable、短页分页、完整性和中文错误。

### GREEN

命令：

```text
npm test -- src/lib/limitUp.test.ts src/lib/market.test.ts src/components/components.test.tsx src/App.test.tsx server/limit-up/eastmoney.test.ts server/market/eastmoney.test.ts
```

实际输出摘要：

```text
Test Files  6 passed (6)
     Tests  82 passed (82)
```

## 最终验证命令与真实输出

### `npm run typecheck`

退出码 0：

```text
> typecheck
> tsc -b --pretty false tsconfig.json tsconfig.server.json
```

### `npm test`

退出码 0：

```text
Test Files  11 passed (11)
     Tests  121 passed (121)
Duration  5.12s
```

### `npm run build`

退出码 0：

```text
vite v8.2.1 building client environment for production...
✓ 31 modules transformed.
dist/index.html                   0.41 kB │ gzip:  0.31 kB
dist/assets/index-DLYmhT6Y.css    9.76 kB │ gzip:  2.50 kB
dist/assets/index-CJtqQ8EU.js   227.63 kB │ gzip: 69.72 kB
✓ built in 171ms
```

### `git diff --check`

- 退出码 0。
- 无标准输出。

## 剩余 concerns

- 无已知代码级遗留问题。
- 东方财富实时可用性属于外部运行时因素；本轮用可控 Response/Abort 信号覆盖成功、HTTP、坏 JSON、普通拒绝和 body 超时，没有依赖实时上游做非确定性测试。
- 工作区仍会显示用户原有的 `.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md` 修改；该文件不属于本轮提交，且未被本轮修改。
