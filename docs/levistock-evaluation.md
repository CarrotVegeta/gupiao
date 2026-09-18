# levistock 评估：对「股票持仓看板」是否有帮助

评估对象：[fleetinglife/levistock](https://github.com/fleetinglife/levistock)（A股数据 Python SDK，封装东财 / 财联社 / 同花顺 / 开盘红 / i问财）
评估日期：2026-09-18
评估性质：只读调研 + **对上游接口做了实测探针**（未安装 SDK、未改动任何项目代码）

## 一句话结论

**不要把 levistock 作为依赖引入**，它的 30+ 个接口里绝大部分是在封装我们**已经在裸调**的同一个公开
HTTP 接口（东财 `push2ex` / `push2delay`、同花顺 `data.10jqka.com.cn`），而它是一门 Python 库、我们是
纯 Node + TypeScript，引入等于凭空多一个 Python sidecar。

但它是一张**很有价值的「上游地图」**：实测验证出 **3 个我们目前没用、且能补上真实缺口的数据源**，
其中 2 个是干净的公开 HTTP（不需要任何依赖），1 个需要评估合规风险。

| 结论 | 对象 |
| --- | --- |
| ❌ 不引入 | levistock 这个包本身（技术栈断裂 + 大部分能力已重叠 + 作者私有服务单点） |
| ✅ 值得自建接入 | ① 财联社板块轮动（30 日历史 `days=30`）② 财联社市场情绪（封板率/高开率/获利率/连板率） |
| ⚠️ 值得 POC 后决定 | ③ 开盘红（kaipanhong）历史涨停天梯 —— 可回溯 **≥1 年**，实测与东财涨停池**逐日只数完全一致** |
| ❌ 明确不做 | i问财自然语言选股（cookie 由**作者私有服务器**签发，单点）、财联社电报（依赖抓取）、同花顺人气榜（纯展示） |

## 二、levistock 是什么

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 形态 | 纯 Python 包，`requests` + `tqdm` 两个依赖，`requires-python>=3.8` | `pyproject.toml` |
| 许可证 | MIT（✅ 干净，与 thsdk 相反） | GitHub API `license.spdx_id = MIT` |
| 体量 | 约 30 个公开函数，19 个模块，最大单文件 ~12KB | GitHub tree API |
| 活跃度 | 创建 2026-05-11，**最后 push 2026-05-25**（评估日已停滞近 4 个月） | GitHub API `created_at` / `pushed_at` |
| 社区 | 81 star / 30 fork / 0 open issue | GitHub API |
| 版本一致性 | `pyproject.toml` 写 `0.1.6`，`__init__.py` 写 `0.1.0` —— 元数据轻微不自洽 | `pyproject.toml`、`levistock/__init__.py` |
| 底层实现 | **没有二进制、没有逆向 .so**，全部是 `requests` 直连公开 HTTP；财联社的签名算法（`SHA1`→`MD5`）是明文写在源码里的 | `market/market_wind_cls.py`、`sector/sector_heat_cls.py` |
| 唯一的私有依赖 | `api.levizhang.com`（作者自己的服务，只提供 3 个端点） | `utils/trade_day.py`、`stock/stock_strategy_wencai.py` |

**与 thsdk 的关键区别**：thsdk 是「12MB 闭源 .so + 冒充 PC 客户端 + 50 组共享游客号」；
levistock 是「明文 Python + 公开 HTTP + 一个签名算法」。**合规与技术风险低一个量级**——
它的问题不在「黑盒」，而在「没必要」和「私有服务单点」。

### 2.1 作者私有服务 `api.levizhang.com` 的真实暴露面

这是评估里最关键的一条。该服务暴露了 FastAPI 自动文档，实测拿到完整端点表：

```text
GET /isTradeDay      判断今天是否交易日
GET /getTradeDays    近 N 个交易日（n 范围 1-30）
GET /getCookie       签发 i问财所需的 hexin-v cookie
```

实测三个端点**当前全部可用**：

```console
$ curl -s https://api.levizhang.com/isTradeDay
{"code":"000000","message":"操作成功","data":null}
$ curl -s "https://api.levizhang.com/getTradeDays?n=5"
{"code":"000000","message":"操作成功","data":["20260914",...,"20260918"]}
$ curl -s https://api.levizhang.com/getCookie
{"code":"000000","message":"操作成功","data":"A_h_N0Qp7IrTmgpzHDhlK8Ixya2KYVzrvsUwbzJpRDPmTZIX2nEsew7VAP2B"}
```

**含义**：这个服务没有 SLA、没有文档承诺、是单点。levistock 里凡是用到「交易日」或「问财」的接口，
整条链路都挂在这台机器上。用它判断交易日属于**用一个新的外部依赖替换一个本地纯函数**，是净负债。

## 三、能力对照：它给的，我们基本都有了

本项目现有上游（见 `README.md:62-100`、`server/**`）：腾讯 `qt.gtimg.cn` / `ifzq.gtimg.cn`、
东财 `push2` / `push2delay` / `push2ex` / `datacenter` / `searchapi`、同花顺
`data.10jqka.com.cn` / `d.10jqka.com.cn`、新浪。

| levistock 接口 | 它封装的上游 | 我们现状 | 结论 |
| --- | --- | --- | --- |
| `stocks_all_em` / `stocks_em` | 东财 `push2` 行情 | 腾讯批量 50 只/次为主源，东财兜底 | 重叠，且我们更快 |
| `market_index_em` / `market_index_all_em` | 东财 `push2` 指数 | 腾讯 `sh/sz` 前缀指数 | 重叠 |
| `stock_zt_pool_em` / `stock_dt_pool_em` / `stock_yesterday_zt_em` | 东财 `push2ex` | 已在用（涨停池/今昨对比） | **同一个接口** |
| `sector_em` / `sector_stocks_em` / `sector_stock_belong_em` | 东财板块 + F10 | `server/themes/eastmoney.ts` 已在用 | **同一个接口** |
| `sector_industry_cls`（财联社行业板块） | `x-quote.cls.cn/web_quote/plate/plate_list` | 东财板块 + F10 题材归属 | 重叠，概念细分更弱 |
| `news_telegraph_cls` | 财联社 `api3.cls.cn/get_roll_list` | 未接 | ❌ 抓取型资讯，非缺口 |
| `stock_hot_rank_ths`（人气榜） | 同花顺 `dq.10jqka.com.cn` + 东财补行情 | 未接 | ❌ 纯展示，无策略价值 |
| `stock_zt_pool_cls`（涨停原因） | 财联社 `up_down_analysis?type=up_pool` | **同花顺 `limit_up_pool` 已含涨停原因，且支持历史日期** | ❌ **重叠**（见 §3.1） |
| `stock_kline_cls` / `stock_timeline_cls` | 财联社分时/K线 | 腾讯分时 + 同花顺日K | 重叠 |
| `stock_changes_em`（盘口异动） | 东财 `push2ex` | 未接 | ❌ 直播型异动，本项目无实时盯盘需求 |
| `is_trade_day` / `get_trade_days` | **作者私有服务** | 腾讯 `ifzq` 交易日历 | ❌ 引入外部单点，纯负债 |

### 3.1 实测：涨停原因我们早就有了

`server/themes/tenjqka.ts:1-13` 的注释写得很清楚——同花顺 `limit_up_pool` 提供「涨停原因、封板类型、
开板次数、封单额、换手率、流通市值、分时序列」，**无需 cookie 且支持历史日期**。这是本项目题材归因
（`server/themes/topics.ts`、`roles.ts`、`attribution.ts`）的数据底座。财联社的 `up_reason` 是同一类信息，
**没有任何增量**，且只有当天。

> 实测对照：财联社 `up_pool` 2026-09-18 返回 78 条，原因形如
> `次新+半导体设备|托伦斯是国内领先的精密金属零部件综合服务商…`，与同花顺字段同质。

## 四、实测三个真正有增量的上游

以下全部是我用 `curl` **裸调验证过的**（绕过 SDK），结论不依赖 SDK 本身。

### 4.1 ⚠️ 开盘红历史涨停天梯 —— 可回溯 ≥1 年，与东财逐日吻合

```text
POST https://apphis.kaipanhong.com/w1/api/index.php
  a=GetZhangTingTianTi & c=FuPanLa & Date=YYYY-MM-DD
  （今天用 apphwshhq.kaipanhong.com）
```

字段（`StockList` 数组）：`[代码, 名称, 连板数, 涨停时间戳, 板块代码, 板块名称, 是否大单一字, 是否有人气, 板块涨停股数, 个股成交额, 板块成交额]`

**实测：历史深度远超东财**

| 日期 | 天梯只数 |
| --- | --- |
| 2026-09-18（实时） | 有数据 |
| 2026-09-17 / 2026-09-16 / 2026-09-15 | 47 / 89 / 32 |
| 2026-08-17 | ~545（原始行数，含嵌套） |
| 2025-12-17 / 2025-06-17 | 有数据 |
| **2024-09-18** | **有数据**（3600 字节） |

**实测：与东财涨停池逐日只数完全一致**

| 日期 | KPH 天梯 | 东财涨停池 | 一致 |
| --- | --- | --- | --- |
| 2026-09-17 | 47 | 47 | ✅ |
| 2026-09-16 | 89 | 89 | ✅ |
| 2026-09-15 | 32 | 32 | ✅ |

**对本项目的价值**：现有方案是 `scripts/limit-up-history.ts` —— **用新浪日K自建**，
`KLINE_DAYS = 140`、全市场 5500 只、限频 120ms/请求、带重试与本地缓存，跑一次产出
`scripts/output/limit-up-history.json`（12.7MB，日期范围 `20260226 ~ 20260916`）。
这套自建逻辑存在的唯一理由就是「东财涨停池只保留约 15 个交易日」（`README.md:576`，实测
东财 2026-08-01 确实已返回 0 只）。

KPH 天梯如果稳定，**一次请求换一天**，把 140 天扩到 1~2 年的成本可以忽略不计，
而且顺带拿到自建方案**算不出来**的三个字段：

- **大单一字**（`[6]`）—— 「一字板」是打板/竞价策略里的强区分特征；
- **人气股**（`[7]`）—— 情绪周期里「人气股杀跌」是退潮信号；
- **板块涨停股数 / 板块成交额**（`[8]`/`[10]`）—— 板块效应的直接度量。

**但必须先解决两个问题**（决定了它是资产还是负债）：

1. **合规与合规**：它走的是**开盘红手机 App 的私有接口**，请求头伪装
   `Dalvik/2.1.0 … 2206123SC`、`DeviceID` 硬编码、`PhoneOSNew/VerSion/apiv` 一批 App 参数。
   这与本项目「只用公开接口、零凭据」的现状（`README.md:88-94`）不一致，性质上更接近 thsdk 的做法。
2. **可持续性**：无文档、无契约、字段靠位置索引（`[0]`~`[10]`），上游改版即静默错位。

### 4.2 ✅ 财联社板块轮动 —— 30 天历史，我们完全没有

```text
GET https://x-quote.cls.cn/v2/quote/a/plate/rotation?days=30&sign=<sha1→md5>
  签名：把参数按 key 字母序拼 k=v&k=v → SHA1 → MD5
```

**实测：只接受 `days=4` 或 `days=30`**（传 15 会返回 `{"days":"支持 4/30"}`）。
`days=30` 返回 30 个交易日、每日 top10 板块：

```text
返回天数: 30   日期范围: 2026-09-18 ~ 2026-08-10
2026-09-18  ['次新股','芯片产业链','光通信','网络安全','算力工程']
2026-09-17  ['烟草','农林牧渔','文化传媒','医药','新能源汽车']
2026-08-10  ['猪肉产业','黄金概念','医院','食品饮料','水务']
```

**对本项目的价值**：全项目**搜不到任何「轮动 / rotation / 热度 / heat」逻辑**（`grep` 为空）。
现有 `server/themes/eastmoney.ts` 只做「**当前**板块快照 + F10 题材归属」，也就是说：

- 能回答「今天哪个题材强」；
- **不能**回答「这个题材是第几天走强 / 昨天谁在涨」——而后者正是做「题材延续性」和
  「板块轮动节奏」的必需输入，也是 `README.md:456-457` 记录的**前视偏差**问题的部分解药
  （历史轮动是逐日快照，天然无前视）。

同源还有一个板块热度榜（`plate_heat_list`，实测可用，含 `rank` / `cur_heat` / `rank_change` / `is_new`），
`rank_change` 与 `is_new` 是现成的**「新上榜题材」信号**。

**成本**：零依赖、零凭据、一个 `sha1→md5` 的签名函数（30 行内）、Node 直接 `fetch` 即可。

### 4.3 ✅ 财联社市场情绪 —— 补齐「封板率/高开率/获利率/连板率」

```text
GET https://x-quote.cls.cn/v2/quote/a/stock/emotion?app=CailianpressWeb&os=web&sv=8.4.6&sign=9f8797a1f4de66c2370f7a03990d2737
```

实测返回（2026-09-18，**连签名都不用算，是固定值**）：

| 字段 | 值 | 含义 | 我们现状 |
| --- | --- | --- | --- |
| `market_degree` | 70 | 市场热度 0-100 | ❌ 无 |
| `up_ratio` / `up_ratio_num` | `76.00%` / 78 | **封板率** / 封板数 | ❌ 无 |
| `up_open_num` | 25 | 炸板数 | ⚠️ 部分（我们算炸板家数） |
| `performance` | `2.81%` | **昨涨停今表现** | ❌ 无 |
| `up_open_ratio` | `62%` | **高开率** | ❌ 无 |
| `profit_ratio` | `68%` | **获利率** | ❌ 无 |
| `shsz_balance` | 2.08万亿 | 两市成交额 | ✅ 有 |
| `limit_up_board` | `{一板:66, 二板:8, 三板:2, 高度板:2}` + 连板率 21%/40%/50% | 连板梯队 + **各档连板率** | ⚠️ 部分（我们算总体晋级率） |

**对本项目的价值**：`server/market/breadth.ts` 已经自算「涨跌家数 / 涨停家数 / 炸板家数 / 晋级率」，
但**封板率、高开率、获利率、分档连板率这四个是判定情绪周期的核心指标，我们一个都没有**，
而且自算需要「昨日涨停池」——而昨日池恰恰是东财 15 天保留期之外的痛点。

**成本**：零依赖、签名是固定字符串、一次请求。

## 五、为什么不整体引入

1. **技术栈断裂**：本项目 `package.json` 无一行 Python；部署是 `scripts/deploy-remote.sh`
   （rsync + systemd，端口 3001）。levistock 需要 Python 3.8+ 解释器 + 虚拟环境 + sidecar + RPC 通道，
   把「单进程 Node」变成「Node + Python」。本机 `python3` 是 3.8.10，`uv` 里有 3.11/3.13 可用，
   但**收益（见 §三）撑不起这个代价**。
2. **它没有一件我们缺的事**：唯一独有的能力（KPH 天梯、CLS 轮动/情绪）**都可以不装 SDK 直接裸调**——
   我上面的实测全部是 `curl` 完成的。引入 SDK 只增加一层不可控的中间层。
3. **私有服务单点**：`is_trade_day` / `get_trade_days` / `getCookie` 三个端点挂在
   `api.levizhang.com` 上，无 SLA、无文档、无版本策略。
4. **停滞维护**：2026-05-25 后无提交，0 个 issue（说明也没人在用/没人反馈），
   单一匿名作者，`pyproject` 与 `__init__` 版本号已不一致。
5. **合规一致性**：KPH 链路是手机 App 私有接口伪装；本项目当前是「公开接口 + 零凭据」，
   引入前应确认这是否是你愿意接受的边界变化。

## 六、建议的落地路径（按优先级）

### P0：财联社轮动 + 情绪（零风险，建议直接做）

- 新增 `server/themes/cls.ts`：实现 `sign()`（sha1→md5）+ 两个 fetch：
  `plate/rotation?days=30`、`plate_heat_list`、`stock/emotion`。
- 轮动接入题材页：新增「近 30 日题材轮动」视图（题材 × 日期矩阵 / 上榜次数 / 首次上榜日）；
  用 `rank_change` + `is_new` 生成「新上榜题材」信号。
- 情绪接入大盘概览：封板率 / 高开率 / 获利率 / 分档连板率，与 `breadth.ts` 自算值**并列展示**，
  先当**交叉校验**（两家口径不一致本身就是上游异常信号），再考虑替换。
- 加一条 `scripts/_host-health.ts` 打点，纳入上游巡检。

### P1：KPH 历史涨停天梯（先 POC，不要进运行时）

- **只做离线 POC**：写 `scripts/limit-up-ladder-history.ts`，用 KPH 拉 1~2 年天梯，
  与现有 `scripts/output/limit-up-history.json` 的 140 天**逐日对账**（只数、个股名单、连板数）。
- 验收标准（三条都要过）：
  1. 重叠区间（`20260226~20260916`）**逐日只数与名单一致**（我已抽验 3 天 3/3 只数一致）；
  2. 扩到 1 年后，**板位 × 晋级率**的样本量足够做走前验证（现有 140 天对高板位太稀疏）；
  3. 连续多日抓取无封禁/限流迹象。
- 若通过：把「大单一字 / 人气股 / 板块涨停股数」作为新特征，进
  `scripts/auction-model.ts` 与 `scripts/auction-buyable-lab.ts` 做走前验证。
- **绝不进线上链路**（`server/`），只做 `scripts/` 下的离线数据源——与现有
  `scripts/limit-up-history.ts` 定位一致。

### P2（不做）

- ❌ i问财自然语言选股：cookie 由 `api.levizhang.com/getCookie` 签发，等于把选股页的核心能力
  押在作者私有服务器上；若要，应自己实现 `hexin-v`（有逆向成本）或放弃。
- ❌ 财联社电报 / 盘口异动 / 同花顺人气榜：与项目定位（盘后复盘 + 竞价 + 选股）不匹配。
- ❌ 引入 levistock 包本身。

## 七、立即可以做的最小验证

```bash
# 1. 财联社情绪（固定签名，无依赖）
curl -s "https://x-quote.cls.cn/v2/quote/a/stock/emotion?app=CailianpressWeb&os=web&sv=8.4.6&sign=9f8797a1f4de66c2370f7a03990d2737" \
  -H 'Referer: https://www.cls.cn/' | head -c 400

# 2. 财联社板块轮动 30 日（需要 sha1→md5 签名，见 §4.2）
# 3. KPH 天梯历史（对照东财涨停池）
curl -s -X POST https://apphis.kaipanhong.com/w1/api/index.php \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H 'User-Agent: Dalvik/2.1.0 (Linux; U; Android 12; 2206123SC Build/c069a49.2)' \
  --data 'PhoneOSNew=1&DeviceID=1a609dd6-b2b8-3bf9-ac40-a77581551454&VerSion=6.0.6&Token=0&Red=1&apiv=w45&UserID=0&a=GetZhangTingTianTi&c=FuPanLa&Date=2026-09-17'
```

## 八、待验证 / 不确定项

- [ ] KPH 天梯的**最早可回溯日期**（已确认 2024-09-18 有数据，更早未测）
- [ ] KPH 天梯「只数 === 东财涨停池」的**普遍性**（已抽验 3 天，需在 140 天重叠区间全量对账）
- [ ] KPH 长时间、高频抓取是否限流或封 IP（App 私有接口，未验证）
- [ ] 财联社 `emotion` 的**固定 `sign` 是否长期有效**（当前明文硬编码，可能某天变更）
- [ ] 财联社 `rotation` 的 `days=30` 是否稳定（实测只接受 4/30，边界行为未知）
- [ ] `plate_heat_list` 的 `cur_heat` 是**无纲量相对值**，跨日可比性未验证
- [ ] 财联社板块代码（`cls80195`）与东财板块代码（`BK****`）/ 同花顺题材的**映射关系**
      （做轮动视图必须先解决，可能仍需人工别名表，参见 `server/themes/topicAliases.ts`）
- [ ] KPH 走手机 App 私有接口的合规边界是否可接受（**需要你本人决策**）

## 九、与 thsdk 评估的结论对比

| 维度 | thsdk | levistock |
| --- | --- | --- |
| 形态 | 12.5MB 闭源 .so + ctypes | 明文 Python + 公开 HTTP |
| 许可证 | 仓库无 LICENSE、sdist 版权人错乱 | MIT，干净 |
| 凭据 | 50 组硬编码共享游客号 / 真实账号 | 无需账号，但有一个作者私有服务 |
| 结论 | 不引入；只有 1 个 POC 点 | **不引入包本身，但有 3 个上游值得自建** |
| 实际价值 | 低（且合规存疑） | **中等**（CLS 轮动/情绪是明确缺口，KPH 天梯值得 POC） |

**一句话**：levistock 的价值不是它的代码，而是它**把「哪些免费源能拿到什么」这件事整理清楚了**——
尤其暴露了开盘红这个我们此前完全没碰过的历史数据源。把它当地图用，不要当依赖用。

## 十、落地情况（2026-09-18 已实现 P0）

按 §六 的 P0 建议实施，**没有引入任何依赖、没有引入任何凭据**（纯 `fetch` + `node:crypto`）。

| 改动 | 位置 |
| --- | --- |
| 新增财联社适配器：签名（sha1→md5）+ 情绪 + 板块轮动 + 汇总排序 | `server/market/cls.ts` |
| 财联社单测（签名锁定、`row3` 表头错位、非法 days、降级路径） | `server/market/cls.test.ts`（19 个用例） |
| 情绪接入大盘概览：新增可选 `emotion` 字段 | `src/types.ts` 的 `MarketEmotion` / `MarketIndicesResponse`，`server/index.ts` 的 `/api/market-overview` |
| 新增轮动接口 | `server/index.ts` 的 `GET /api/themes/rotation?days=4\|30` |
| 轮动前端 lib（含运行时校验） | `src/lib/sectorRotation.ts` + `src/lib/sectorRotation.test.ts` |
| 情绪前端展示（封板率 / 高开率 / 获利率 / 连板梯队） | `src/components/MarketOverview.tsx` 的 `EmotionRow` |
| 轮动面板（近 4 / 30 日切换 + 上榜次数榜） | `src/components/SectorRotationPanel.tsx`，挂在 `src/components/ScreenerPanel.tsx` 的题材档 |
| 样式 | `src/styles.css` 的 `.market-breadth__row` / `.sector-rotation__*` |

### 10.1 实测验收（线上真实请求）

`/api/themes/rotation`（默认 30 日）：

```text
status: fresh | days: 30 | 交易日: 30 | 板块: 77
  芯片产业链  最新 2.77% 上榜17/30 首见20260812 近见20260918
  PCB        最新 1.68% 上榜16/30 首见20260812 近见20260918
  光通信      最新 2.57% 上榜15/30 首见20260811 近见20260918
  机器人概念  最新 1.75% 上榜15/30 首见20260811 近见20260918
```

- `days=4` → 返回 4 天 / 26 个板块；`days=15` → **HTTP 400**（上游不认，后端挡住）
- `/api/market-overview`（当天）→ `emotion`: 热度 70、封板率 76%、高开率 62%、获利率 68%、炸板 25、成交额 2.08 万亿，
  连板梯队 `一板 66 / 二板 8（连板率 40%）/ 三板 2（50%）/ 高度板 2`
- `/api/market-overview?date=20260910`（历史）→ `emotion` 为 `null`（见 10.2 的护栏）
- 全量测试 `677 passed`（54 个文件），`npm run typecheck`、`npm run build` 均通过

### 10.2 实现时踩到 / 刻意处理的三个点

1. **`limit_up_board.row3` 首项是表头**。上游给的是
   `row1=['一板','二板','三板','高度板']` / `row2=[66,8,2,2]` / `row3=['连板率','21%','40%','50%']`
   —— `row3[0]` 是文字「连板率」，不是一板的连板率。必须右移一位取，否则会把表头解析成 NaN 或 0。
2. **情绪没有日期参数**。上游只给当天快照，所以请求历史日期时后端**直接不抓**并返回 `null`
   （`wantsToday` 判断），否则会把「今天的封板率」贴到历史日期上，变成假数据。
3. **`days` 只认 4 / 30**。传 15 上游回的是 `{"days":"支持 4/30"}` 而不是数组；
   后端在路由层直接 400，解析层也把「非数组 data」当无数据（而不是「0 天上榜」）。

### 10.3 顺带发现的既有问题（未改动）

验收时发现：**`/api/market-overview?date=20260910` 的 `breadth.tradeDate` 返回的是 `20260918`**
（即请求历史日期时，`breadth` 被算成了「今天」的池子）。这与本次改动无关 ——
`server/market/breadth.ts:141-147` 用上游 `data.qdate`（它恒等于最新交易日）当 `todayPool.date`，
而 `server/index.ts` 又把默认的「今天」传了进去。历史日期要不要返回 breadth 属于既有设计问题，
本次没有动它，仅在此记录。

## 十一、本次未做（P1 / P2 去向）

- **P1 开盘红历史涨停天梯**：仍是离线 POC 候选，见 §4.1 与 §八。未写代码，
  因为它需要先在 140 天重叠区间与 `scripts/output/limit-up-history.json` 全量对账。
- **P2**：i问财（作者私有服务单点）、财联社电报、同花顺人气榜，均按 §六 结论不做。
- **`docs/README.md` 的既有重复**：`README.md` 的「观察 / 选股 / 数据源」整段存在两份副本
  （第一份约行 324–509，第二份约行 511–696，且第二份是较旧的版本），与本次改动无关，未清理。

