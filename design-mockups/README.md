# 设计稿（design-mockups）

股票看板的视觉探索稿，都是 1440×900 的独立静态 HTML（内联 CSS，无外部依赖），
用来快速比较风格，选定后再落到 `src/styles.css` 与组件里。

## 方案索引

| 文件 | 方案 | 明暗 | 版式骨架 | 关键词 |
|---|---|---|---|---|
| `a-dark-terminal.html` | A 深色终端 | 暗 | 指数卡 + 双表 | 初版深色 |
| `b-light-workbench.html` | B 浅色工作台 | 亮 | 卡片工作台 | 初版浅色 |
| `c-workstation.html` | C 工作站 | 亮 | 三栏工作区 | — |
| `d-bento.html` | D Bento | 亮 | 网格拼贴 | — |
| `e-terminal.html` | E 终端 | 暗 | 终端风 | — |
| `f-glass-refined.html` | F 精修玻璃 | 亮 | 玻璃拟态 | 柔光背景 |
| `g-desk-terminal.html` | **G 盘口终端** | 暗 | 分组树 + 行情表 + **五档盘口/天梯** | 等宽数字、分时迷你图、红涨绿跌 |
| `h-light-desk.html` | **H 行情白盘** | 亮 | 极窄工具条 + 13 列高密度表 + 底部天梯 | 券商软件手感、1px 细线、行高 31.5px |
| `i-kline-cockpit.html` | **I K线驾驶舱** | 暗 | 大 K 线主图 + 账户/情绪 + 持仓卡 | 蜡烛图（内联脚本生成）、盈亏大字 |
| `j-heatmap-warroom.html` | **J 板块热力作战图** | 亮 | 热力图主导 + 主线识别 + 天梯 | 面积=成交额、题材主线/支线 |
| `k-starfield-gravity.html` | **K 题材星图 · 引力场** | 暗 | 径向星系图（**无表格**） | 星球=板块成交额、环绕=涨停个股、越靠中心资金越集中 |
| `l-tape-feed.html` | **L 盘中异动流** | 亮 | 时间轴事件流 + 情绪温度计 | 按「发生时间」组织，封板/炸板/涨速分类色 |
| `m-ai-briefing.html` | **M AI 盘面播报** | 亮 | 对话式看板 | 自然语言复盘 + 可核对的数据依据栏 |
| `n-flip-board.html` | **N 翻牌行情墙** | 暗 | 机场大屏网格（**无表格**） | 逐位翻牌数字、副屏 3 米可读 |

### 基于现有页面与字段的方案（O–Q）

上面 A–N 是自由发挥的方向探索（K–N 引入了现有应用里没有的模块，仅作风格参考）。
**O–Q 严格只用现有板块与字段**：自选 10 列（最新价/涨跌幅/涨跌额/换手/量比/成交额/自选日/自选价/自选收益）、
持仓 8 列（最新价/涨跌额/涨跌幅/换手/开仓价/持有数量/持仓收益）与总览
（总收益率/总收益额/总投入/当前市值/持仓数量），数据取自 `design-mockups/shot.mjs` 里的 11 只自选、4 只持仓种子。

| 文件 | 方案 | 明暗 | 思路 |
|---|---|---|---|
| `o-watch-dualdesk.html` | **O 双栏看盘台** | 亮 | 自选与持仓同屏：左侧 10 列全字段密排表，右侧总览 + 4 张持仓卡；最接近现有截图，改动最小 |
| `p-watch-bigread.html` | **P 大字盯盘** | 暗 | 每只自选一行放大：大字现价 + 大字涨跌幅，辅助字段降为次行小字；右栏持仓总览与持仓卡 |
| `q-watch-scale.html` | **Q 行情刻度** | 亮 | 抛弃表格网格：每条是一把刻度尺，条形＝相对昨收涨跌幅、菱形＝相对自选价的自选收益；行高按 持仓 &gt; 涨停 &gt; 普通 分级 |
| `r-terminal-3col.html` | **R 暗色三栏终端** | 暗 | 分组树 + 自选紧凑表 + 持仓总览/明细三栏并排；「自选日/自选价」从独立列改为行内第二行，表格撑满 |
| `s-watch-lanes.html` | **S 分组看板** | 亮 | 按现有分组切成泳道（农业/黄金/未分组），每只一张卡片；右侧持仓总览 + 持仓明细 |
| `t-cost-view.html` | **T 成本视角** | 亮 | 不按代码排，按「自选收益」分三段（跑赢/贴着/跌破）；横条＝自选价→现价的价差，颜色只看自选收益，今日涨跌幅单独成标签 |
| `u-mobile.html` | **U 手机窄屏** | 亮 | 390×844 双屏（自选/持仓）：自选 11 只一屏，行内第二行放 自选日/自选价/换手/量比，成交额在第一行 |
| `v-neon-cyber.html` | **V 霓虹赛博** | 暗 | 霓虹发光 + 网格地平线 + HUD 角标面板 + 扫描线；行内加迷你走势图 |
| `w-brutalist.html` | **W 新粗野主义** | 亮 | 3px 黑描边 + 硬阴影（无模糊）+ 原色块（黄/橙/蓝）+ 涨跌幅用硬边进度条 |
| `x-swiss-grid.html` | **X 瑞士网格** | 亮 | 0 圆角 0 阴影 0 投影，只有发丝线与一个红色强调；数字等宽右对齐、超大指数 |
| `y-editorial.html` | **Y 财经杂志** | 亮 | 报头 + 期号 + 章节号 01/02 + 双栏清单 + 红色「涨停」印章 + 「本期合计」大字 |

### 自选 / 持仓「不只是数字」（Z1–Z4）

同一套外壳（顶栏 + 指数带 + 左自选 11 行 / 右持仓 4 卡 + 页脚）与同一份种子数据，
只改「数字怎么被呈现」，用于挑选非纯数字的行内表达。四份都由
`gen-watch-visual.mjs` 生成（`node design-mockups/gen-watch-visual.mjs`），要改种子数据或样式改脚本即可。

| 文件 | 方案 | 行内主体 | 数据依赖 |
|---|---|---|---|
| `z1-watch-pulse.html` | **Z1 分时脉搏** | 每行一条当日分时迷你图（含昨收虚线），持仓卡标注成本线 | 需新增分时接口（腾讯 minute/query 可一次批量） |
| `z2-watch-scale.html` | **Z2 刻度尺** | 涨跌幅 / 换手 / 量比 / 成交额 / 自选收益全部条形刻度化 | 无，纯前端由现有行情字段算 |
| `z3-watch-info.html` | **Z3 信息行** | 行业 · 涨停原因 · 连板 · 加入（持有）天数写成文字 | 无，行业与涨停原因取自现有行情 / 涨停池 |
| `z4-watch-kline.html` | **Z4 迷你K线** | 每行近 10 日迷你 K 线，持仓卡标注开仓价 | 需新增日K接口（东财 push2his 可一次批量） |

Z5–Z7 不加任何图表，只改**字段值本身怎么显示**（用户口径：「要的是字段值的展示」）：

| 文件 | 方案 | 字段值的呈现 | 数据依赖 |
|---|---|---|---|
| `z5-watch-tier.html` | **Z5 数值分档色阶** | 涨跌幅/自选收益按档给色块（涨停 · 大涨 · 小涨 · 平盘 · 小跌 · 大跌 · 跌停），换手配冷清/正常/活跃/过热，量比配缩量/平量/温和放量/大幅放量 | 无，阈值前端定义 |
| `z6-watch-annotated.html` | **Z6 值带口径** | 每个字段值下面一行小字写口径：最新价→较昨收、涨跌幅→档位词、成交额→占两市、自选价→何时加入、自选收益→自选 N 天 · 今日贡献 | 无，口径由现有字段推导 |
| `z7-watch-fieldgrid.html` | **Z7 字段值网格** | 不再是表头对列，每行「字段名 + 字段值」成对铺开（最新价 48.76 / 涨跌幅 +9.99% / 加入天数 3 天 …） | 无 |
| `z8-watch-tier-lite.html` | **Z8 分档色（精简）** | Z5 的删减版：只保留「值本身按档变色/加底」（涨跌幅、涨跌额、自选收益、持仓收益率）+ 换手与量比的档位词，其余批注、图例、占比全部去掉 | 无 |

### 在真实界面上验证「只改这两处」（tier-*）

Z8 是新画的稿子，仍然会带上稿件外壳。要证明「除了这两处，界面上的别的东西一律没变」，
用 `shot-tier-preview.mjs`：把改动**注入正在运行的真实页面**再截图，配合 `diff-pixels.mjs` 逐像素比对。

```bash
npm run dev                       # dev server: 5174（API 3001）
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=.cdp-profile about:blank &
node design-mockups/shot-tier-preview.mjs     # → renders/tier-{before,after}-{watchlist,holdings}.png
node design-mockups/diff-pixels.mjs \
  design-mockups/renders/tier-before-watchlist.png \
  design-mockups/renders/tier-after-watchlist.png \
  design-mockups/renders/tier-diff-watchlist.png
```

注入内容只有两件事：① 涨跌幅 / 自选收益 / 持仓收益 的值本身按档变色、极端档加底；
② 换手、量比 各补一个档位词。档位词用绝对定位挂在值的正下方，脱离文档流，
所以既不加宽列也不撑高行；档位色只加在「装数字的那个元素」上（自选页 `.watch-pct`、
持仓页 `.quote-row__chg` / `.holding-card__profit`），恰好 0 的值直接不碰。

实测：自选页差异像素 0.39%、持仓页 1.00%，包围盒都落在表格行内，顶栏 / 指数带 / 右栏 / 页脚全未变动。

**已落地到应用里**：档位口径在 `src/lib/valueTier.ts`（`tierOfChange` / `turnoverLevel` / `volumeRatioLevel`），
样式在 `src/styles.css` 的 `.value-tier` / `.value-word` 两段，接进 `Watchlist.tsx` 与 `HoldingList.tsx`。
落地后的真实截图见 `renders/impl-*.png`，与改动前的像素差异：自选页 0.33%、持仓页 0.63%（只落在涨跌幅 / 换手 / 量比 / 持仓收益四列 + 顶栏时间）。
持仓收益的档位按**收益率**算（不是金额），所以和注入稿里「金额越大档越高」的观感略有不同。

## 渲染与体检

```bash
# 精确视口截图（2x，输出到 renders/）
node design-mockups/shot-html.mjs design-mockups/g-desk-terminal.html \
  design-mockups/renders/g-desk-terminal.png 1440 900 2

# 局部放大（clip: x,y,w,h）
node design-mockups/shot-html.mjs design-mockups/h-light-desk.html \
  design-mockups/renders/zoom.png 1440 900 3 0,780,1440,120

# 布局体检：视口/滚动尺寸 + 越界元素 + 被父容器裁切的内容
node design-mockups/probe-layout.mjs design-mockups/i-kline-cockpit.html 1440 900
```

- `shot.mjs` / `shot-variant.mjs`：给真实运行中的应用截图（CDP，需先起 dev server 与调试端口）。
- `probe-layout.mjs` 会输出两类问题：`overflow`（越出视口）与 `clipped`（被 `overflow:hidden` 的祖先切掉）；
  纯装饰光斑（`.glow` 或带 `data-decor`）会自动跳过。新稿要求两者都为 0。
- A–F 是第一轮初稿（不在 1440×900 下做裁切校验），G–N 为后续方案。

## 约定

- A 股习惯：**红涨绿跌**（`--rise` 红 / `--fall` 绿）。
- 数字统一等宽字体 + `tabular-nums`，避免行情跳动时列宽抖动。
- 中文回退字体 `WenQuanYi Zen Hei`，等宽回退 `WenQuanYi Zen Hei Mono`。
