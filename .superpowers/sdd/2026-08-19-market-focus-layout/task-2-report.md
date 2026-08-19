# Task 2 报告：服务端东方财富适配器和接口

## 改动文件

- `server/market/eastmoney.ts`
- `server/market/eastmoney.test.ts`
- `server/limit-up/eastmoney.ts`
- `server/limit-up/eastmoney.test.ts`
- `server/index.ts`

## 关键实现

### 1. 大盘指数适配器

- 新增 `fetchEastmoneyMarket(fetchImpl?)` 和 `mapEastmoneyMarket(payload, fetchedAt)`。
- 固定请求：
  - URL：`https://push2.eastmoney.com/api/qt/ulist.np/get`
  - `secids=1.000001,0.399001,0.399006,1.000688`
  - `fields=f2,f3,f4,f12,f14`
- 将东方财富原始整数行情按 `/100` 归一化为：
  - `f2 -> price`
  - `f3 -> pct`
  - `f4 -> change`
  - `f12 -> symbol`
  - `f14 -> name`
- 对单个指数坏数据、缺失行、`data: null`、HTTP 非 2xx、请求异常都不抛整批错误，而是返回 4 个固定指数位，其中异常项标记为 `status: 'unavailable'`，并在 `errors` 中保留 `QuoteError`。

### 2. 涨停池分页适配器

- 新增 `fetchEastmoneyLimitUp(date, fetchImpl?)` 和 `mapEastmoneyLimitUpItem(raw)`。
- 固定请求：
  - URL：`https://push2ex.eastmoney.com/getTopicZTPool`
  - `ut=7eea3edcaed734bea9cbfc24409ed989`
  - `dpt=wz.ztzt`
  - `sort=fbt:asc`
  - `pagesize=100`
  - 使用 `Pageindex` 翻页
- 行映射规则：
  - `c/n/p/zdp/lbc/fbt/lbt/hybk/zbc -> LimitUpItem`
  - `p / 1000`
  - `zdp` 保持百分比数值
  - `fbt/lbt` 统一补零成 `HH:mm:ss`
  - 非法时间输出运行时 `null`
  - `hybk` 空串输出运行时 `null`
- 使用 `Set` 按 `symbol` 去重，保持源顺序。
- 支持按 `tc` 继续翻页；遇到空页即停止。
- 每次请求都用 `AbortController` 做 5 秒超时。
- HTTP 错误、超时、坏 payload 统一返回 `status: 'unavailable'` + 中文错误，不抛未处理异常。

### 3. Express 路由接入

- `GET /api/market-overview`
  - 直接返回 `MarketOverviewResponse`
- `GET /api/limit-up?date=YYYYMMDD`
  - 新增 `parseTradeDate(input)`
  - 仅接受 `/^\d{8}$/`
  - 缺省日期使用 `Asia/Shanghai` 当前日期
  - 非法日期返回 HTTP 400
  - 合法日期调用适配器，哪怕上游失败也返回标准 body，由适配器给出 `status: 'unavailable'`

## 测试命令和实际输出

### 1. 聚焦测试

命令：

```bash
npm test -- server/market/eastmoney.test.ts server/limit-up/eastmoney.test.ts
```

实际输出：

```text
Test Files  2 passed (2)
     Tests  8 passed (8)
```

覆盖点：

- 大盘字段映射
- 固定 secids URL
- 单条坏指数行降级为 `unavailable`
- 涨停池字段映射
- 缺失代码/名称坏数据过滤
- 分页合并
- 空池返回
- 上游 HTTP 错误降级

### 2. 类型检查

命令：

```bash
npm run typecheck
```

实际输出：

```text
> typecheck
> tsc -b --pretty false tsconfig.json tsconfig.server.json
```

### 3. 接口级检查 / 替代验证

说明：当前沙箱对本地回环连接不稳定，`localhost`/`127.0.0.1` 存在间歇性 DNS/EPERM/连接失败；因此按 brief 允许的方式，以已完成的聚焦测试 + 类型检查为主，并补充一次成功的 `curl` 样例与 `parseTradeDate` focused check。

成功样例 1：

```bash
curl -sS http://localhost:5173/api/market-overview
```

实际输出节选：

```json
{"indices":[{"symbol":"000001","name":"上证指数","price":3937.97,"pct":-1.31,"change":-52.33
```

成功样例 2：

```bash
curl -sS 'http://localhost:5173/api/limit-up?date=20260818'
```

实际输出节选：

```json
{"tradeDate":"20260818","items":[{"symbol":"603089","name":"正裕工业","price":11.8
```

日期校验 focused check：

```bash
PORT=0 node --input-type=module -e "const mod = await import('./dist-server/server/index.js'); console.log(mod.parseTradeDate(undefined)); console.log(mod.parseTradeDate('20260818')); console.log(mod.parseTradeDate('bad')); process.exit(0);"
```

实际输出：

```text
20260819
20260818
null
```

## 自查结论

- 只修改了本任务允许的服务端文件和本报告文件。
- 未触碰 `.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md`。
- 未做 Task 3 及之后的前端工作。
- 大盘接口已修正为真实上游缩放后的可用数值。
- 涨停池覆盖了错误、分页、空池、坏数据、日期校验替代验证。
- 上游异常均被标准化处理，没有直接暴露第三方堆栈。

## 疑问 / concerns

1. 已在后续修正提交中将 `src/types.ts` 的 `LimitUpItem.firstSealTime / lastSealTime / industry` 调整为 `string | null`，并同步更新 Task 1 的类型夹具，使共享契约与设计文档、服务端输出保持一致。
2. 本地接口 400 验证受当前沙箱回环网络限制，已用 `parseTradeDate` focused check 替代。
