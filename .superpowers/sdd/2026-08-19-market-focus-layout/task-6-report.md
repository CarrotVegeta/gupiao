# Task 6 报告：完成响应式样式、README 烟雾测试说明和全量验收

## 改动文件

- `src/styles.css`
- `src/App.test.tsx`
- `README.md`
- `.superpowers/sdd/2026-08-19-market-focus-layout/task-6-report.md`

## 实现说明

### 1. `src/styles.css`

- 将页面主布局样式从旧的未使用选择器切换到现有结构：
  - `dashboard-layout`
  - `dashboard-main`
- 为一级导航补充桌面端与小屏样式：
  - 桌面端固定左列；
  - `<900px` 时整体堆叠到主内容上方；
  - 导航按钮保留选中态与数量展示。
- 将 `overview__metrics` 调整为自适应网格，兼容顶部大盘指数条在不同宽度下换行。
- 为涨停列表补充 scoped 样式：
  - 表格列宽、表头、斑马纹、股票代码副文案；
  - stale banner / empty state 展示；
  - 窄屏横向滚动，不裁切表格。
- 保留原有语义色：
  - 上涨：`--rise` 暖红
  - 下跌：`--fall` 青绿
  - 无数据/过期：`--neutral` 中性灰

### 2. `src/App.test.tsx`

- 在现有集成测试中补充结构与无障碍回归断言：
  - `navigation[name="一级导航"]`
  - `region[name="大盘概览"]`
  - `navigation[name="持仓筛选"]`
- 未改动业务组件实现，只基于当前真实可访问名称补充回归保护。

### 3. `README.md`

- 仅补充用户流程，不改运行说明：
  - 顶部确认大盘概览；
  - 切换“涨停聚焦”核对涨停表格及“连板/板块”信息；
  - 切回“持仓”确认分组筛选、收益率和添加入口仍在；
  - 刷新后确认本地持仓与备注保留。

## 验证命令与结果

### 1. 结构回归测试

命令：

```bash
npm test -- src/App.test.tsx
```

结果：

- 1 个测试文件通过
- 14 个测试全部通过

### 2. 全量验收

按 brief 顺序执行：

```bash
git diff --check
npm run typecheck
npm test
npm run build
```

结果：

- `git diff --check`：通过
- `npm run typecheck`：通过
- `npm test`：11 个测试文件、97 个测试全部通过
- `npm run build`：通过，产物输出到 `dist/` 与 `dist-server/`

### 3. 开发服务接口烟雾

实际执行时，`npm run dev` 因本机 `5173` 端口已被占用，Vite 自动回退到 `http://localhost:5174/`，代理仍转发到本地 API 服务 `http://localhost:3001`。

已验证：

```bash
curl -sS http://localhost:5174/api/market-overview
curl -sS 'http://localhost:5174/api/limit-up?date=20260818'
curl -i 'http://localhost:5174/api/limit-up?date=bad'
```

结果：

- `/api/market-overview`：返回 200 JSON
- `/api/limit-up?date=20260818`：返回 200 JSON
- `/api/limit-up?date=bad`：返回 `HTTP/1.1 400 Bad Request`

## 自查

- 业务代码未修改，未触碰 `App/server/lib/components` 源文件。
- `.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md` 保持未动。
- 修改范围仅包含用户允许的文档/样式/测试文件，以及本任务报告。

## Concerns

- brief 中给出的 ARIA 断言是 `region[name="大盘行情"]`，但当前锁定业务代码的真实可访问名称为 `大盘概览`。由于本任务禁止修改组件业务代码，测试按真实名称 `大盘概览` 落地，并在此记录偏差。
- 开发服务烟雾验证时，本机 `5173` 端口已被占用，因此实际验证端口为 `5174`；接口代理与返回结果均正常。
