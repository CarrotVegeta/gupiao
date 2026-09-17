# 选股重构一期交付说明（任务 1～7）

对应实施说明：`docs/superpowers/plans/2026-09-18-screener-ai-implementation.md`
日期：2026-09-18。范围：一期任务 1～7；任务 8 未实施。

## 1. 改动文件清单与规则版本

### 规则版本

| 常量 | 值 | 位置 |
| --- | --- | --- |
| `ROLE_RULE_VERSION` / `ASSIGN_ROLE_VERSION` | `roles-v1-2026-09-18` | `server/themes/assignRoles.ts`、`server/themes/roles.ts` |
| `THEME_RULE_VERSION` | `roles-v1-2026-09-18+classify-v2` | `server/themes/service.ts`（缓存键已包含它，规则变化即失效） |

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `server/themes/attribution.ts` | 本轮题材关联纯函数 `resolveThemeRelation`（含日期过滤） |
| `server/themes/topicAliases.ts` | 细分逻辑映射表（一期为空，只用明确映射；含测试替换钩子） |
| `server/themes/assignRoles.ts` | 资格→排序→代表分配（`ROLE_LIMITS`、并列处理、候选标签） |
| `server/themes/attribution.test.ts` / `assignRoles.test.ts` / `classify.v2.test.ts` / `metrics.test.ts` / `service.test.ts` | 对应单测与编排测试（全部注入固定上游，不发真实网络请求） |
| `server/screener/trend.test.ts` | 趋势扫描纠错测试 |
| `src/components/ThemeDetail.test.tsx` / `src/components/TrendScanner.test.tsx` | 前端行为测试 |
| `scripts/clean-dist-server.mjs` | 跨平台清理 `dist-server`（原来的 `rm -rf` 在 Windows 直接失败） |

### 修改文件（要点）

| 文件 | 要点 |
| --- | --- |
| `src/types.ts` | 新增 `CheckState`、`ScreenerDataStatus`、`ThemeKindV2`、`RelationState`、`Evidence`、`ThemeRelation`、`CheckResult`、`RoleTag`、`ScanCoverage`、`ThemeStockV2`、`ThemeDetailResponseV2`；`ThemeItem` 增加 `classificationReasons` 与三个口径家数；`ThemesResponse` 增加 `schemaVersion`、`pending`、`warnings` |
| `server/themes/classify.ts` | 新增 `classifyThemeV2`（当日 ≥5＋前两日各 ≥2 才 main；数据不足/未决可能补足 → pending）；旧 8 项仅作观察 |
| `server/themes/metrics.ts` | 按交易日截断、未完成K线剔除、最近突破日、首次突破定义、涨跌日量能改用 close 对比、连板高度与连续一字按 OHLC 重算、交易日间隔 |
| `server/themes/roles.ts` | 删除按命中数的 `ROLE_MIN_HITS` 体系，改为 `ROLE_RULES_V1` 必要资格 + 越大越优排序数组 |
| `server/themes/service.ts` | 统一编排：三口径家数、证据生成、关联、风险、角色、覆盖披露、缓存键、历史请求保护、观察日回退 |
| `server/themes/eastmoney.ts` | `fetchBoardCatalog` 单页失败不再让整张目录为空（返回 `{catalog, errors}`） |
| `server/index.ts` | 新增 `GET /api/themes/:code/detail`（不接收 role）；`/stocks?role=` 保留为同一服务的兼容包装 |
| `src/lib/screener.ts` | `fetchThemeDetail(code, date?, signal?)`；v2 客户端校验（partial 不是空列表、覆盖数自洽校验）；趋势响应透传覆盖字段；页头结论改为受限表述 |
| `src/components/ThemeDetail.tsx` | 删除 role state / 四个页签 / 按角色请求；改为一张去重表 + 角色标签列 + 本轮关联列 + 风险 + 覆盖 + 展开证据；最新请求保护 |
| `src/components/ThemeBoard.tsx` | 主线 / 支线 / 待确认三组；展示三口径家数与分类依据；「高度标杆」不再叫龙头 |
| `src/components/ScreenerPanel.tsx` | 详情传入交易日，详情与总览共用同一次计算 |
| `server/screener/trend.ts`、`src/components/TrendScanner.tsx` | 任务 6 的 9 项纠错（缩量改名、未完成K线剔除、去掉 70% 预筛、覆盖披露、有向绝对偏离、4/5 旧模板说明、draft/applied 校验、请求防乱序、受限结论） |
| `src/styles.css` | 追加题材 v2 与角色标签样式（仅追加，未改既有规则） |
| `package.json` | `build` 改为 `node scripts/clean-dist-server.mjs && tsc -b … && vite build` |
| `server/themes/roles.test.ts` | 删除（其断言基于已被替换的命中数逻辑；兼容规则测试全部重写进 `assignRoles.test.ts` / `metrics.test.ts`） |

`src/App.tsx` 的改动（移除三个 `.page-glow` 节点）不是本次实施内容，是工作区里已存在的用户修改，按约定原样保留、未回滚。

## 2. 各角色默认资格与数量（v1 建议默认值，不是收益承诺）

集中定义在 `ROLE_RULES_V1`（`server/themes/roles.ts`）与 `ROLE_LIMITS`（`assignRoles.ts`）。

公共前置条件：本轮关联 = `supported`；指标可计算；非 ST；风险成功查询且无风险命中。
风险未知记 `missing` 并展示原因，但**不发确定标签**；仅概念归属的股票留在表里，拿不到角色。

| 角色（页面文案） | 必要资格 | 代表排序（依次比较，越大越优） | 数量上限 |
| --- | --- | --- | --- |
| 龙头候选 | 近 20 交易日存在涨停记录；逐日重算的连续板高度可计算；本轮关联有效 | 连续板高度降序 → 近 5 日相对板块涨幅 → 5 日均额 | 每题材 1 |
| 核心候选（换手核心口径） | 近 3 日均额 ≥5 亿；当日换手 8%～25%；不是连续两日一字涨停 | 3 日均额降序 → 板块调整日相对表现 | 每题材 1 |
| 趋势中军候选 | 沪深主板；近 5 日均额 ≥5 亿；近 10 日 ≥7 日收盘在 MA5 上；距 MA5 在 −5%～+5%；近 10 日涨幅 5%～25%；当前收盘 ≥MA10 | 5 日均额降序 → 站上 MA5 天数 → 距 MA5 绝对值升序 | 每题材 1 |
| 潜在低位补涨 | 与龙头有相同非空 topicKey；板块 20 日涨幅减个股 ≥15 个百分点；流通市值 50～300 亿；最近 3 交易日首次放量突破；本轮启动晚于龙头 2～4 交易日 | 启动日晚（数值大）→ 突破日 → 5 日均额 | 每题材 2 |

- v1 **只产出 `candidate`**：没有分钟级带动证据时不会输出「确认龙头」。
- 所有必要 checks 必须 `pass` 才 `eligible`；`missing` / `pending` 一律不算通过。
- 排序项缺失为 `null`（不填 0）；第一关键项缺失的候选不参与代表分配；后续项缺失排在已知值之后。
- 完全并列且跨越上限时该角色不发标签，给出「并列待确认」warning。
- 阈值是可解释的规则版本，不是已验证的盈利参数，也不代表上涨概率。

## 3. 实际测试结果

以下命令均在本机 Windows（PowerShell + `npm.cmd`）实跑。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（exit 0，无 TS 错误） |
| `npm test` | **40 个测试文件 / 434 个测试全部通过**（exit 0） |
| `npm run build` | 通过（exit 0）：`dist-server` 清理 + tsc + vite build，产物 `dist/assets/index-*.css 51.42 kB`、`index-*.js 312.23 kB` |
| `npm test -- server/themes/service.test.ts` | 15 passed |
| `npm test -- server/screener/trend.test.ts src/components/TrendScanner.test.tsx` | 26 passed（server 13 + 组件 13） |
| `npm test -- src/components/ThemeDetail.test.tsx` | 11 passed |
| `npm test -- src/lib/screener.test.ts src/components/ScreenerPanel.test.tsx` | 44 passed |

覆盖的关键边界：A1～A6 关联状态、六组分类表、未满足必要条件不能用高分补偿、并列待确认、覆盖截断（121 只只扫 120）、单只日K失败不清空题材、风险未查不发标签、旧接口与新接口同源、历史请求不返回今天行情、客户端 partial 不是空列表、A→B 乱序请求不串题材、趋势七项案例。

未通过项：无（本轮结束时全绿）。

### 3.1 追加变更（2026-09-18 当天，应要求）

**取消趋势页的「板块范围」筛选，趋势一律全市场扫描。**

- 背景：趋势页默认「仅主线题材」取候选，而主线要求「本轮驱动有依据」（见第 4 节第 1 条：一期没有可核查的细分映射 → 主线恒为 0 个），
  导致默认口径下候选池永远是 0 只、形态一只股都出不来（实测 `candidates=0`，而全市场口径 `candidates=5916 / 命中 9`）。
- 改动：`server/screener/trend.ts` 的 `DEFAULT_FILTERS.themeScope` 改为 `'all'`，`parseTrendFilters` **忽略** `themeScope` 参数；
  `collectCandidates` 删除「仅主线」分支与其 `buildThemes` 依赖；来源声明固定为 `eastmoney`；命中排序去掉题材数比较，只按 5 日均额降序。
  `src/components/TrendScanner.tsx` 删除板块范围下拉框、草稿态不再含该字段，页面显示「扫描范围：全市场（已取消『仅主线题材』筛选）」。
- `TrendFilters.themeScope` 字段保留仅为兼容旧调用方，服务端不再据此改变行为（测试固定住：传 `themeScope=main` 也返回全市场）。
- 新增测试：`server/screener/trend.test.ts`（默认全市场、传 main 仍全市场）、`src/components/TrendScanner.test.tsx`（界面无该下拉、请求恒带 `themeScope=all`）。
- 追加后实测：`npm run typecheck` 通过、`npm test` **40 文件 / 443 测试全通过**、`npm run build` 通过；
  无头 Chrome 实测趋势页 `命中 9 行`、覆盖「扫描范围 5916 只 · 已拉日K 260 只（成功 258 / 失败 2） · 未扫描 5656 只」、无任何 4xx/5xx 与前端异常。

### 3.2 追加变更（应要求）：研究结论块改为默认折叠

- `src/components/TrendScanner.tsx`：页头整块研究结论由固定横幅改为 `<details>`，**默认折叠**。
  折叠态只显示一行摘要「研究结论的适用范围（受限）：原五条件组合在既有样本里不支持收益优势」+「不构成任何买入建议。」；
  展开后才出现完整受限结论、参数适用范围说明、原研究数字与已知限制、样本范围 footer。CSS 自绘 ▸/▾ 箭头（不用原生三角，避免 flex 布局把它挤到单独一行）。
- 文案同步修正：参数适用范围由「默认五条件 + 仅主线题材」改为「默认五条件」——板块范围筛选已取消（见 3.1）。
- 新增测试：`src/components/TrendScanner.test.tsx` 断言默认 `open === false`、折叠态含摘要与免责声明、点击后展开并出现完整结论。
- 无头 Chrome 实测：折叠态该块高度 **44.8px**（正文 146px 不占位）、展开态 **212px**，页面无异常。
- 追加后实测：`npm run typecheck` 通过、`npm test` **40 文件 / 450 测试全通过**、`npm run build` 通过。

### 3.3 追加变更（应要求）：整块条件区 / 分类区也收到折叠里

- **趋势页**：`条件筛选 + 生效条件 + 覆盖说明` 整体包进 `.trend-settings`（`<details>`，默认折叠）。
  折叠态只有一行摘要：`条件与扫描范围：5/5 档 · 偏离 ≤4% · 近10日涨幅 ≤20% · 站稳 3 日 · 5日均额 ≥5 亿 · 全市场　已扫描 260 / 5916 只（未扫描 5656） · 点开可改条件`
  ——生效条件与覆盖进度都留在摘要里，不点开也看得到；点开才是表单、生效条件说明与覆盖明细。实测该块 **45px → 展开 287px**。
  另外把研究结论块从整块横幅收成标题旁的一枚窄条（`.trend-evidence` 摘要内联），页头不再占一整行。
- **题材详情页**：`分类依据 + 旧 8 项观察指标` 收进 `.theme-detail__classification`（`<details>`，默认折叠），
  摘要为一行「分类依据与观察指标　等 N 条依据」；类型判定说明、数据状态横幅、覆盖数、筛选与股票表保持可见。实测该块 **35px**。
- 新增测试：`src/components/TrendScanner.test.tsx`（默认 `open === false`、摘要含生效条件与覆盖进度、点开后表单与覆盖明细出现）、
  `src/components/ThemeDetail.test.tsx`（默认折叠、摘要含依据条数、点开后出现旧指标列表）。
- 追加后实测：`npm run typecheck` 通过、`npm test` **40 文件 / 457 测试全通过**、`npm run build` 通过；
  无头 Chrome 实测开合状态与页面无异常、无 4xx/5xx。

### 3.3 追加修复：`npm run dev` 偶发整进程退出（EBUSY）

- 现象：`tsx watch` 重写 `server/**` 时会生成 `.xxx.tmpdir/*.tmp`，vite 默认 watch 项目根，撞上这些临时文件就抛
  `EBUSY: resource busy or locked, watch '...tmpdir\...tmp'` 并让 `concurrently` 带着两个进程一起退出。
  同类第二次触发：浏览器自动化工具用的 user-data-dir（实测 `E:\code\gupiao\.cdp-profile`，Chrome 锁住
  `Default/Network/Cookies`）同样会让 vite watcher 抛 EBUSY 并整进程退出。
- 修复：`vite.config.ts` 增加 `server.watch.ignored = ['**/server/**', '**/dist-server/**', '**/.cdp-profile/**', '**/.chrome-debug/**', '**/.playwright/**', '**/.tmp/**']`
  （前端不 import 这些目录，屏蔽不影响 HMR）。
- 验证：在 `.cdp-profile` 被 Chrome 持续占用的情况下，连续重写 `server/themes/topicAliases.ts` 3 次（触发 tsx 重启 3 次），
  vite（5174）进程未退出，`/api/themes` 与 `/api/screener/trend` 仍返回 200。
- 另：`src/App.test.tsx` 三个跑完整交互的用例（增删分组 + 行情刷新）加了 20s 单测超时。
  它们在单独运行时约 1~4s，全量并行跑时偶尔贴到 5s 默认超时导致随机失败；这不是业务回归。

### 3.4 事故与修复（2026-09-18 深夜）：`TrendScanner.tsx` 被编码往返损坏后重建

- 经过：为验证 EBUSY 修复，我用 PowerShell 的 `Get-Content -Raw` + `Set-Content` 做「重写同一个文件」的压力测试。
  Windows PowerShell 5.1 默认按 ANSI 读取、再按默认编码写出，**中文字符被替换成 `?`**（实测 171 处 U+FFFD / 问号），
  `src/components/TrendScanner.tsx` 因此损坏到无法编译。这是我的操作失误：把源码当文本数据交给有损编码的管道。
- 影响范围：用「是否存在 U+FFFD」这一硬指标逐个文件核对过 `src/`、`server/`、`docs/`、`scripts/`，
  **只有 `src/components/TrendScanner.tsx` 一个文件损坏**（171 处），其余文件（含 `styles.css`、其它组件与服务端）均为 0 处。
- 为什么不能回滚：该文件在 git 里的版本是选股页最初那版（274 行，没有覆盖披露、折叠、板块列、自选按钮），
  工作区版本从未提交，也没有备份，因此不能靠 `git checkout` 恢复。
- 处理：按 `src/components/TrendScanner.test.tsx`（20 个用例，未损坏）的契约 + 服务端 `TrendScanResponseV2` +
  你截图里的真实列序，把该文件完整重建，并把「同条件失败保留上一轮结果并标过期」「条件区默认折叠」
  「研究结论收成标题旁警示按钮（面板不放在折叠区内）」等行为全部实现。
- 一处测试断言按真实界面修正：原断言写「均线排列是第 5 列」，但界面（与你的截图一致）里第 4 列是均线排列、
  第 5 列是距 5 日线偏离；已改成 `cells[3]` 并注明列序。
- 验证：`npm run typecheck` 通过、`npm test` **42 文件 / 500 测试全通过**、`npm run build` 通过；
  无头 Chrome 实测趋势页 9 行结果、12 列（股票 / 板块 / 现价 / 涨跌幅 / 均线排列 / 距5日线偏离 / 连续站稳 / 缩量比 /
  10日涨幅 / 5日均额 / 命中条件 / 操作）、条件区默认折叠、覆盖披露完整、无异常与 4xx/5xx。
- 教训：后续所有文本改动改用 DSH 的文件工具（`edit` / `write`，UTF-8），不再用 PowerShell 管道读写源码。

## 4. 真实数据缺口说明（实证，不是推测）

以下结论来自本机对真实上游的实测（`/api/themes`、`/api/themes/BK0900/detail`，2026-09-18 00:35 前后，开盘前）：

1. **`topicAliases` 一期为空 → 本轮驱动「有依据」恒为 0。**
   真实返回：`新能源车(BK0900)` 概念成员涨停 12 只，`supportedLimitUpCount = 0`，`unresolvedLimitUpCount = 12`；
   37 条 evidence 全部是 `match: 'ambiguous'`（上游涨停原因如「PCB」没有可核查的细分映射）。
   因此角色标签目前为空，题材分类落在 `pending`（「待确认」）。这是刻意的保守行为：宁可不给标签，也不编造精确映射。
   填入经过核查的 `{ themeCode, topicKey, exactPhrases }` 后，`supported` 与角色标签会自动生效；该路径已由 `service.test.ts` 的精确映射用例覆盖。

2. **开盘前「今天」的涨停池还不存在。**
   同花顺涨停池按自然交易日给数据：`date=20260918` 返回 0 行（`total: 0`），`date=20260917` 返回 47 行；
   而东财涨停池此时已经把最近一个交易日标成 `20260918`。服务因此在请求日涨停池为空时**退回到最近有数据的交易日**观察，并在 `warnings` 与页面明写
   「请求交易日 20260918 的涨停池尚未产生，本次按最近有数据的交易日 20260917 观察」。
   `theme.tradeDate` 仍是请求日，`evidence.validTradeDate` 是观察日，两者不会混。

3. **未扫描范围必须当成限制条件读。**
   实测 `新能源车` 板块 717 只成员，快速上限只扫 120 只，`coverage = { total: 717, attempted: 120, succeeded: 120, failed: 0, unscanned: 597 }`，`status = 'partial'`。
   角色只代表「已扫描范围内」的比较，页面与 warning 都已写明。

4. **分钟级带动证据缺失 → 龙头只能是候选。**
   v1 没有分时带动数据，`分时带动证据` 恒为 `pending`，因此不输出「确认龙头」。这属于任务 8 的范围。

5. **历史日期不做精确重建。**
   没有当日快照的历史请求直接返回 `unavailable`（「不拿最新行情冒充历史」），并在测试中固定住。存在有效上游日K时，`metricsTradeDate` 可能早于观察日（实测为 `20260916`），页面按「指标截止」如实展示。

6. **板块日K取不到时的降级。**
   实测 `新能源车` 的板块日K（同花顺 `bk_885431`）取不到，warning 明写「相对涨幅 / 抗跌性 / 补涨滞后度按缺失处理」，这些排序项为 `null` 而不是 0。

7. **未做浏览器视觉验收。**
   本轮只运行了 Testing Library 组件测试与真实上游接口探测，**没有**截图或人工核对桌面 / 窄屏布局。第 1 节里的 900px 断点样式已写入 `src/styles.css`，但没有真人验收结论。

## 5. 已知偏差与后续（任务 8 及以后）

- 一期没有公告 / 事件适配器：公告类证据类型已预留，但没有证据时保持 `unknown`。
- 补涨要求「与龙头同源细分逻辑」，在映射表为空时该 check 为 `pending`，等价于不给补涨标签。
- 龙头启动锚点只用「当日可观察事件」，即观察日；跨日的启动时序需要历史证据快照，留给二期。
- 全市场后台扫描、条件 schema、人工归因维护界面、题材阶段状态机、新回测都在任务 8。
- `GET /api/themes/:code/detail` 是主路径；`/stocks?role=` 只是兼容包装（同一服务、同一判定），确认无调用方后可单独清理。
