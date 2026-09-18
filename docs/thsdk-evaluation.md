# thsdk 评估：对「股票持仓看板」是否有用

评估对象：[panghu11033/thsdk](https://github.com/panghu11033/thsdk)（同花顺 Python 数据接口，第三方逆向封装）
对照对象：[HiThink-Tech/Financial-API](https://github.com/HiThink-Tech/Financial-API)（同花顺**官方**金融数据服务，调研中发现）
评估日期：2026-09-18
评估性质：只读调研，未安装、未执行、未改动任何项目代码

## 一句话结论

**不建议引入 thsdk；但同花顺官方那套 REST 服务值得单独评估**（见 §六）。

- thsdk 唯一有价值的能力是 `list_security_call_auction_quotes(security, phase, date)` ——
  它看起来支持**指定历史日期**取集合竞价行情，正好命中本项目唯一「所有免费源都拿不到」的数据缺口：
  历史 09:25 竞价量能（`README.md:120-122`、`scripts/auction-volume-availability.ts:24-26`）。
  但代价是 Python 3.10+ 子进程 + 12MB 无源码闭源 .so + 50 组硬编码共享游客账号 + 50ms 限频（§四）。
- **官方 [hithink-finance](https://fuyao.aicubes.cn/) 的 `/api/a-share/auction/snapshot` 直接返回
  `auction_amount`（竞价成交额）、`auction_volume`、`auction_volume_ratio`、`auction_yesterday_ratio_pct`
  —— 正是本项目要算「竞价量比」缺的那个字段**，而且是 REST + API Key，对 Node 更友好。
  代价：它同样是**实时/终态快照**，请求参数里**没有历史日期**，所以补不了历史回测（§6.1）。

## 二、thsdk 的事实

### 2.1 它是什么

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 形态 | Python 包 + ctypes 加载的**原生闭源动态库** | `src/thsdk/_runtime.py`（`ctypes.CDLL` 加载 `libs/<os>/<arch>/hq.so`），只暴露 `CallAlloc`/`FreeResult` 两个符号，跨边界传 JSON |
| 真实实现 | **原生库是 Go 写的**（stripped ELF x86-64，`go1.27.0`），方法名带 `go_name`；二进制内含 17+ 个 `*.10jqka.com.cn` 主机、`hevo.10jqka.com.cn:8602`、`Hevo_Mac`/`hevo_pc`/`thspc_hevo`、Chrome UA、`hx page %d protocol payload` | 对 sdist 内 `hq.so` 做只读 `strings`；`src/thsdk/_method_manifest.py`（`go_name` 字段） |
| 取数方式 | **冒充同花顺 PC 客户端（hevo）走私有二进制协议**直连服务器，不是任何有文档的 HTTP API | 同上（`hevo_pc` / `Hevo_Mac` / 私有 payload 字符串） |
| 仓库性质 | **PyPI 包的镜像**，不是真源码仓库 | `.github/workflows/sync-thsdk.yml`：每天从 PyPI 下载 sdist、解压、**删除全部 `.so/.dll/.dylib`**、提交 |
| 仓库活跃度 | 293 star / 101 fork / 19 open issues；但提交历史几乎全是 CI 机器人（`actions-user` 164 次，作者 `panghu11033` 仅 4 次，`claude` 2 次）；无 release、无 tag | GitHub API contributors / commits |
| 本机可用的二进制 | `linux/amd64/hq.so` **12.5 MB**（另有 darwin amd64/arm64、linux arm64、windows amd64；sdist 合计 22.6 MB，**PyPI 上没有任何 wheel，只有 sdist**） | sdist `thsdk-2.0.2.tar.gz` 逐文件清单 |
| 版本 | PyPI 最新 **2.0.2**（2026-09-05），包内 `__version__` 却写 `3.0.0`，README 写 3.x —— **元数据自相矛盾** | `https://pypi.org/pypi/thsdk/json`、sdist `thsdk/__init__.py` |
| 依赖 | 仅 `pandas>=1.3.0`；`python_requires>=3.10` | sdist `setup.py` |
| 许可证 | ❌ **GitHub 仓库根目录没有 LICENSE 文件**（API `license: null`）；sdist 里那份 MIT 的版权人是 **"Copyright (c) 2024 Marjorie Floyd"**（与本项目无关的样板名） | GitHub tree API、sdist `LICENSE` |

**关键判断：这是非官方逆向封装，不是官方 SDK，且它选择「无人值守地冒充同花顺 PC 客户端」。**
同花顺官方数据服务是 iFinD / [fuyao.aicubes.cn](https://fuyao.aicubes.cn/)（见 §七）。
同花顺用户协议明确禁止「反向工程、反向编译或反汇编」以及「通过其他第三方工具接入」
（[用户协议 5.4 / 5.2.2](http://t.10jqka.com.cn/app/agreement/userAgreement.html)）——
thsdk 的行为正落在这两条上。仓库自己的 issue 区也印证了这些代价：

- [#11 「里面的那些 lib 库是哪里来的啊？」](https://github.com/panghu11033/thsdk/issues/11)（2026-03-24，open，作者未答）
- [#23 「同花顺的接口，用了 50 个游客账号循环，哪天一封白费了」](https://github.com/panghu11033/thsdk/issues/23)（2026-06-02，open，作者未答）
- [#26 「无法保持长连接会话，卡死或突然退出」](https://github.com/panghu11033/thsdk/issues/26)（2026-06-18，open）
- [#28 「不能用游客账号获取数据？」](https://github.com/panghu11033/thsdk/issues/28)（2026-07-20，open，贴出 `游客号登录失败`）
- [#20 「换成真实个人账号反而报『游客权限不足，当前接口为非法请求』」](https://github.com/panghu11033/thsdk/issues/20)（2026-05-04，open）
- [#30 「问财接口返回结果为空」](https://github.com/panghu11033/thsdk/issues/30)（2026-09-04，open）
- [#18 Windows 加载 `hq.dll` 失败](https://github.com/panghu11033/thsdk/issues/18)（2026-04-08，open）

**未检索到任何一例「已被封号」的公开确认报告** —— 封号风险属于「不确定」。可确定的是：
默认路径下你的请求跑在**全互联网共享的游客号**上，且是自动化访问。

### 2.2 补充：它确实"能用"，但用的是共享游客号

仓库里有一个 [industry_constituents.yml](https://raw.githubusercontent.com/panghu11033/thsdk/main/.github/workflows/industry_constituents.yml)
每天两次在 GitHub Actions 上 `pip install thsdk` 并跑取数脚本，产出的 CSV 每天自动提交成功
（最近提交 2026-09-16）—— 说明**从美国云 IP 用内置游客号自动登录是可行的**，
`data/industry_constituents.csv`（91 个同花顺二级行业 + 成分股）就是这么来的。
这既是「它能跑通」的证据，也正是「它把生产流量压在共享游客号上」的证据。

### 2.3 认证与限频

- 三种登录：`auth()` 自动 / `auth("user","password")` / `auth_qrcode()` 扫码；
  成功后写 `account.session` 到**首次调用时的工作目录**，README 称其为敏感凭据
- 登录优先级：显式凭据 → `THS_USERNAME`/`THS_PASSWORD` → `account.session` → **打包内置的游客账号**
  （即默认 `auth()` 不需要你提供任何账号）
- `src/thsdk/_temporary_accounts.py` 里是 **50 组硬编码的 `thsguest_*` 游客账号（用户名+密码+伪造 MAC）**，
  明文写在包源码里轮换使用 —— 这些凭据人人可见，因此是**全球共享**的；issue #28 已出现登录失败
- 设备伪装：`session.py:_derive_account_mac()` 用 `SHA256("thsdk-account-mac-v1\0"+username)`
  生成固定 MAC，真实账号也可显式传 `mac`
- examples 里带一个 `loop.py` 专门演示 **50ms 限频**（≈20 请求/秒），SDK 会自动退避重试
- **Level-2 永久不支持**：README 首段写明，且 `.github/workflows/auto-reply-level2.yml` 会对
  任何提到 level2 的 issue 自动回复「暂不支持」，并引导去 `quant.10jqka.com.cn`
- **哪些接口需要付费权限：不确定**，README 没有权限矩阵，只能靠运行时 `account_permissions()` 探测

### 2.4 与本项目能力重叠的部分

thsdk 96 个 API 覆盖：K 线（多周期/复权）、分时、逐笔、五档盘口、公司行为、证券搜索、
板块成分、行业归属、概念标签、7x24 快讯、研报、涨停事件分析、集合竞价行情、资金流、
问财选股、热度排行、自选股管理。

本项目现在靠 8 个公开 HTTP 上游实现同类数据，其中 4 个上游就是**同一家同花顺**
（`data.10jqka.com.cn` 的 `limit_up_pool` / `block_top`，`d.10jqka.com.cn` 的 `bk_*` / `hs_*` 日K，
见 `server/themes/tenjqka.ts:23-25`），而且**不需要登录**。

## 三、缺口对照：thsdk 能补什么

| 本项目缺口（带出处） | thsdk 能否补 | 判断 |
| --- | --- | --- |
| **历史 09:25 竞价量能** —— 腾讯/同花顺分时忽略 date、东财 push2his 断连、网易 502；`README.md:120-122,156-158`、`scripts/auction-volume-availability.ts:24-26`；现在靠 `data/auction-snapshots.jsonl` 每天攒 1 行（当前共 1 行） | `list_security_call_auction_quotes(security, phase, date, window)` 的 `date` 是**历史日期类型**，examples 就传了 `2026-09-03T09:15:00+08:00` | ✅ **唯一强候选**，需要 POC 实测 |
| 东财涨停池只留约 15 个交易日，训练样本不足（`README.md:576`） | `analyze_security_limit_up(security, date)` / `get_security_price_limit_events()`，但都要**逐只**调用 | ⚠️ 874 只/天 × 历史 N 天，50ms 限频下要跑很久；且样本可继续用新浪自建（现有方案已跑通） |
| 同花顺 `block_top` 固定 Top 20、参数无效，涨停家数必须自算（`server/themes/tenjqka.ts:12-14`、`README.md:444,451-452`） | `rank_block_securities()` / `list_security_block_memberships()` 可查板块成分与归属 | ⚠️ 现有「涨停股 × 东财 F10 归属」自算已够用，替换收益不明 |
| 东财 F10 给的是「当前」题材归属，历史回测有前视偏差（`README.md:456-457`） | `get_security_concept_tags()` / `list_security_industry_mappings()` | ❓ 未知是否返回**历史**归属；大概率也是当前快照，未必能解决前视偏差 |
| 板块/题材细分靠人工补录别名（`server/themes/topicAliases.ts:13-17,29-37`） | 仓库里直接带一份 **同花顺二级行业成分股 CSV（91 行，含行业代码/名称/成分股）**，`data/industry_constituents.csv`，由 Action 每日更新 | ⚠️ 可作为**一次性对照/补充快照**，但它不含概念题材，且以 `data/industry_constituents.csv` 静态文件形式存在，仍需自己跑脚本才能更新 |
| 09:25 之后「次日竞价强于板块平均」「分时回落有承接」等盘中/次日指标拿不到（`README.md:434-435`） | `list_security_intraday_bars()` / `list_security_ticks()` / `list_security_extended_hours_*` | ⚠️ 逐只调用 + 限频，日常实时链路里成本高于现在的腾讯批量分笔（1 批 50 只） |

**结论**：真正值得投入的只有第 1 项。其余要么现有实现更便宜，要么收益不明确。

## 四、代价清单（为什么不适合整体引入）

1. **技术栈断裂**：本项目是纯 Node + TypeScript（`package.json`，无一行 Python），
   部署是 rsync + systemd（`scripts/deploy-remote.sh`，端口 3001，运行时固定在
   `/opt/stock-dashboard/runtime`）。thsdk 必须跑在**另一个 Python 进程**里，
   等于新增一个 sidecar 服务 + 一套虚拟环境 + 一套 systemd 单元 + 一条本地 RPC 通道，
   把「一个 node 进程」变成「node + python + 12MB 闭源 .so」。
2. **Python 版本要求**：`python_requires>=3.10`，本机默认 `python3` 是 **3.8.10**；
   虽然 `~/.local/share/uv` 里有 3.11/3.13 可直接用，但部署机需要额外准备。
3. **供应链不可审**：`.so` 无法审计、无法打补丁、无法从源码重建；仓库每日同步还专门
   把 `.so` 删掉（`.github/workflows/sync-thsdk.yml` 的 "Remove dynamic libs" 步骤），
   意味着**你 review 的 Python 代码 ≠ 你实际运行的取数逻辑**，而后者随时可能在升级时被替换。
   PyPI 上**只有 sdist、没有任何 wheel**，由单一匿名账号发布，`setup.py` 注释还自称「一个 wheel
   承载全平台」（与实际不符），包内 `__version__` 又与 `setup.py` 版本号矛盾 —— 元数据整体不可信。
   仓库根目录**没有 LICENSE 文件**（GitHub API `license: null`），sdist 里那份 MIT 的版权人写的是
   无关的样板名 —— 法务上拿不到一个干净的授权结论。
4. **账号与合规风险（最重要的一条）**：默认走 **50 组硬编码在包源码里的共享游客账号**
   （`_temporary_accounts.py`），这些凭据人人可见、不属于你、随时可能失效（issue #28 已出现登录失败）；
   要稳定就得用**自己的同花顺账号**（或 `THS_USERNAME`/`THS_PASSWORD`），会话文件 `account.session`
   是落在工作目录的敏感凭据。更关键的是取数方式本身：二进制伪装 `hevo_pc` 客户端、伪造 MAC 与 UA，
   而同花顺用户协议明确禁止反向工程与「通过其他第三方工具」接入
   （[协议 5.4 / 5.2.2](http://t.10jqka.com.cn/app/agreement/userAgreement.html)）。
   这与本项目「不引入任何账号凭据、只用公开接口」的现状完全相反。
5. **限频**：50ms/次 ≈ 20 req/s；本项目现在的做法是**批量**（腾讯行情 50 只/请求，
   `server/tencent/client.ts:17`），改用逐只 API 会显著变慢。
6. **稳定性**：issue 里有「长连接卡死或突然退出」（#26）、「问财返回为空」（#30/#14）、
   「Windows 加载 hq.dll 失败」（#18）等未解决报告，且 19 个 open issue 基本无人回复；
   相比之下现网链路已经过 `scripts/_host-health.ts` 巡检并有腾讯/东财双源兜底。
7. **维护主体**：单人匿名账号 + GitHub Action 自动同步（164 次提交里作者手写只有 4 次），
   无 release、无 tag；`auto-reply-level2.yml` 明确 Level-2 永久不支持。

## 五、建议方案

优先级：**方案 D（官方服务，见 §六）> 方案 A（thsdk POC，可选）> 方案 B（一次性快照）> 方案 C（不做）**。

### 方案 A（可选）：只做一次「历史竞价量能」可行性 POC，不进生产

目标只有一个问题：**`list_security_call_auction_quotes(date=过去某交易日)` 到底能不能返回
该日 09:25 的竞价成交额/成交量？**

- 能 → 用它**离线**补齐 `data/auction-snapshots.jsonl` 的历史（哪怕只补 60~140 个交易日），
  让 `AUCTION_POLICY` 里那两条「尚未在历史样本上验证」的经验阈值（`src/lib/auction-policy.ts:8-13`）
  第一次跑上真正的走前验证。POC 放在 `scripts/` 下当离线工具，**不进运行时**。
- 不能 → 结论就是「与现有方案无差别」，直接放弃 thsdk，继续按天攒快照。

POC 脚本（放到 `tmp-analysis/` 或 `scripts/`，用 uv 建独立环境，**不要**写进 `package.json`）：

```bash
# 1. 建隔离环境（本机 uv 已有 3.11/3.13）
export UV_CACHE_DIR=/tmp/uv-cache
uv venv --python 3.13 /tmp/thsdk-poc
/tmp/thsdk-poc/bin/pip install thsdk

# 2. 只需一个临时脚本，验证三件事
cat > /tmp/thsdk-poc/probe.py <<'PY'
import thsdk
thsdk.auth()                      # 先试临时账号，失败再考虑自己账号
for d in ["2026-09-16T09:15:00+08:00", "2026-09-10T09:15:00+08:00"]:
    r = thsdk.list_security_call_auction_quotes(
        security="USHA600519", phase="opening", date=d)
    print(d, r)                   # 看有几个字段、是否含成交额/成交量、是否只给最近一天
PY
/tmp/thsdk-poc/bin/python /tmp/thsdk-poc/probe.py
```

**验收标准（三条都要过）**：
1. 传历史日期返回的**不是**最近一个交易日的数据（对比两次不同 date 的输出差异）；
2. 返回里有竞价**成交额或成交量**（不只是价格）；
3. 用同一天的腾讯分笔结果对照，误差可接受。

> ⚠️ POC 需要账号登录，属于对外部服务的凭据使用，建议由你本人决定是否执行；
> `pip install` 与 `uv venv` 只会写 `/tmp`，不会污染仓库。

### 方案 B：只取那份行业成分股快照（零风险）

仓库里的 `data/industry_constituents.csv`（91 个同花顺二级行业 + 成分股）可以直接下载，
用来**对照**题材分类里 `industry` 字段的覆盖情况（`server/themes/eastmoney.ts:194-198`
「拿不到就是 null」）。不引入任何代码依赖、不需要登录。
代价：它来自别人的 Action，无 SLA、无历史版本语义，只适合当一次性参考。

### 方案 C（不推荐）：整体替换行情/题材链路

把腾讯/东财换成 thsdk。收益是「数据更结构化、有 SDK」，代价是上面 §四全部七条。
本项目当前的核心价值恰恰是**零凭据、零数据库、单进程、多源兜底**，换掉它等于把
运维复杂度和合规风险一次性拉满，而现有缺口只有一项能被它补上 —— 投入产出不成比例。

### 方案 D：把官方 API 当作竞价/涨停池的**批量主源**（见 §六，优先级高于方案 A）

官方 `/api/a-share/auction/snapshot` 一次 100 只，字段含 `auction_amount`、
`auction_volume_ratio`、`auction_yesterday_ratio_pct`、`auction_unmatched`，
比现在「腾讯批量行情拿今开 + 逐只分笔补成交额」的拼装链路更直接；
官方 `limit-up-pool?date_ms=` 还能按日回补历史涨停池。
**前提是先确认价格与配额可接受**（§6.3）。

## 六、调研中发现的更优替代：同花顺官方 hithink-finance（建议优先评估）

[HiThink-Tech/Financial-API](https://github.com/HiThink-Tech/Financial-API) 是**同花顺官方**
维护的 A 股数据服务（官网 [fuyao.aicubes.cn](https://fuyao.aicubes.cn/)），
2026 年升级为 monorepo，形态与本项目高度契合：

| 维度 | 官方 hithink-finance | thsdk |
| --- | --- | --- |
| 授权 | 官方，仓库 MIT，有完整文档与契约 | 非官方逆向，仓库无 LICENSE |
| 接入方式 | **REST（`GET` + `X-api-key`）**、MCP、Node CLI、Python SDK、DuckDB | 只有 Python + 12MB 原生 .so |
| 凭据 | 一个 API Key（`HITHINK_FINANCE_API_KEY`） | 共享游客号 或 你的同花顺账号 + 设备指纹伪装 |
| 对 Node 友好 | ✅ 直接 `fetch`，无需子进程 | ❌ 必须 Python sidecar |
| 批量 | 竞价快照一次最多 100 只 | 逐只调用 + 50ms 限频 |
| 限流 | 不设累计上限，动态限流，`code=4001` 退避 3 次 | 固定 50ms |
| 可审计 | ✅ 契约文档 + `llms-full.txt` | ❌ 二进制黑盒 |

### 6.1 它对本项目最相关的两个接口

**① 集合竞价快照**（[文档](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/a-share/auction-snapshot.md)）

```text
GET /api/a-share/auction/snapshot?thscodes=600519.SH,000001.SZ&stage=final
```

返回字段里**正好包含本项目缺的那几个**：

| 字段 | 对本项目的意义 |
| --- | --- |
| `auction_amount` | **竞价成交额** —— `AuctionItem.auctionAmount` 的直接来源 |
| `auction_volume` | 竞价成交量 |
| `auction_volume_ratio` | **竞价量比**（官方口径） |
| `auction_yesterday_ratio_pct` | **竞昨比** —— `src/lib/auction-policy.ts` 里 `ratioMinPct` 用的就是这个口径 |
| `auction_turnover_pct` | 竞价换手率 |
| `auction_unmatched` | 未匹配量（现在完全拿不到的新特征） |
| `pre_close_price` / `open_price` | 现成的昨收与今开 |

**但它的请求参数只有 `thscodes` 和 `stage`，没有日期** → 与现有腾讯分笔一样是
**实时/终态快照，补不了历史**。也就是说：它能让线上链路更稳、字段更全（多出未匹配量、
竞价换手率、官方量比），但**解决不了「历史 09:25 量能」这个核心痛点**。

**② 涨停池 / 炸板池 / 连板天梯**（[文档](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/a-share/special-data-limit-up-pool.md)）

`GET /api/a-share/special-data/limit-up-pool?date_ms=<毫秒戳>` **支持指定历史交易日**，
返回 `limit_up_time`（HH:MM）、`limit_up_reason`、`continue_day_cnt`、`seal_money`、`max_seal_money`。
这正好能补上「东财涨停池只保留约 15 个交易日、自建涨停历史要跑新浪全市场日K」的缺口
（`README.md:576`）；`limit-up-ladder` 直接给近 30 个交易日的连板梯队矩阵。

### 6.2 官方服务同样有的边界

- **没有分钟 K、没有 tick、没有龙虎榜以外的新闻原文**（README「当前公开能力边界」）
- **资金流向、高频历史/分时标为「端内专用，待上线」**，当前不可用
- **集合竞价只有快照，没有历史**
- 需要付费/授权（官网申请 API Key，价格未公开）→ **引入前需要你先确认成本**
- 仍是外部依赖，但**不引入二进制、不需要账号密码、有契约文档**，风险层级与 thsdk 完全不同

### 6.3 建议的动作

1. 去 [fuyao.aicubes.cn/admin](https://fuyao.aicubes.cn/admin/) 看 API Key 的**价格与配额**；
2. 若可接受，用 `/api/a-share/auction/snapshot` 做一次**与现有腾讯分笔的逐只对照**
   （价格、成交额误差），验证官方口径是否与现网一致；
3. 用 `/api/a-share/special-data/limit-up-pool?date_ms=` 回补历史涨停池，
   把 `scripts/limit-up-history.ts` 的新浪自建方案换成官方源（更准、更快）。

## 七、附带收获：不用引入任何外部依赖，也能把竞价量能变稳

调研 thsdk 的过程中顺手验证了一个**现有链路没试过的免费源**：**分时接口的第一个点就是 09:25 集合竞价**。
这条结论比 thsdk 本身更有价值，因为它零凭据、零新依赖。

### 7.1 实测证据（2026-09-18，47 只真实候选，对照物是 `data/auction-snapshots.jsonl`）

脚本：`tmp-analysis/verify-minute-auction.mjs`、`tmp-analysis/verify-em-trends-auction.mjs`（探针，未入库）

| 源 | 端点 | 竞价所在点 | 价格完全相等 | 成交额误差 |
| --- | --- | --- | --- | --- |
| 腾讯分时 | `ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519` | 第一个点 `0930` | **47/47** | 最大 0.06%，其余全 0 |
| 东财分时（镜像） | `push2delay.eastmoney.com/api/qt/stock/trends2/get` | 首个成交量>0 的点 `09:26` | **47/47** | **47/47 误差 ≤0.1%** |

东财分时甚至把竞价过程逐分钟给出来了（`华瓷股份` 2026-09-18）：

```text
09:15  19.88  0          ← 竞价开始，虚拟开盘参考价
09:16~09:24 21.87 0      ← 竞价过程中价格被推高
09:25  21.87/21.60  0    ← 09:25 撮合价出现，但成交量记在下一分钟
09:26  20.98  34669  72735562.00   ← ✅ 这一笔就是集合竞价成交（与快照完全一致）
09:31  21.40  52603  113859079.00  ← 连续竞价开始后累计
```

### 7.2 这能解决什么 / 不能解决什么

**能**：
- 竞价成交额有了**第二个独立来源**，且比分笔更省事：一次请求就同时拿到价格与成交额，
  不像现在「批量行情拿今开 + 逐只分笔补成交额」两段式；
- **北交所不再是盲区**：实测 `bj920092` 分时首个点就有成交量，而分笔对北交所返回空
  （README 里「腾讯分笔拿不到量能时…量能标记为缺失」的那类票可以消掉）；
- 可用来做**交叉校验**：现网 `auctionAmount` 与分时首点不一致时可以直接判为上游异常。

**不能**：
- ❌ **仍然拿不到历史**。腾讯 `mkline?param=sh600519,m1,<date>,320` 传历史日期返回**空数组**；
  不传日期时 320 根 1 分钟 K 只覆盖 `20260917 13:42 ~ 20260918 15:00`（约 1.3 个交易日），
  再往前没有。东财 trends2 忽略 `date` 参数，永远只给最近一个交易日。
- 也就是说：**历史 09:25 量能这件事，免费源已经被彻底封死**（腾讯分笔、腾讯分时、腾讯分钟K、
  东财分笔、东财分时、东财日K、官方 REST 全部试过），
  只剩 §五方案 A 的 thsdk POC 这一条窄路，或者继续按天攒快照。

### 7.3 注意：两家的时间戳口径不同

- **腾讯分时**没有单独的 09:25 点，它的**第一个点就是 `0930`**，且该点直接携带竞价成交；
- **东财分时**把竞价过程逐分钟铺开：`09:15`~`09:24` 成交量恒为 0（只有虚拟开盘参考价），
  `09:25` 出现撮合价但成交量仍是 0，**竞价成交记在 `09:26` 这一点上**。

两家金额一致但时间戳不同，所以重建时**不能写死 `0930` 或 `09:26`**：

- 腾讯分时 → 取**第一个点**；
- 东财分时 → 取**第一个成交量 > 0 的点**。

这与现有代码里「按窗口取第一条，而不是写死 `09:25:00`」的处理思路一致
（`README.md:267-269`、`server/auction/eastmoney.ts:261-263`）。

## 八、落地情况（2026-09-18 已实现）

调研结论已经变成代码，**没有引入任何新依赖或外部账号**：

| 改动 | 位置 |
| --- | --- |
| 新增竞价分时抓取 + 特征提取模块（18 个单测） | `server/auction/minute.ts`、`server/auction/minute.test.ts` |
| 量能兜底链新增「分时首个有量点」，位于分笔之后、批量报价之前 | `server/auction/eastmoney.ts` 的 `minuteSymbols` 段 |
| 竞价分时形态进入响应与前端新列（迷你走势 + 形状标签 + tooltip） | `src/types.ts` 的 `AuctionMinuteTrend`、`src/components/AuctionList.tsx` |
| 形态与量能来源落盘，供以后验证形态因子 | `server/auction/snapshot-log.ts` 的 `minuteTrend` / `amountSource` |
| 说明与阈值集中处 | `README.md` 竞价筛选说明、`server/auction/minute.ts` 的 `AUCTION_TREND_THRESHOLDS` |

实测（2026-09-18 真实候选 47 只，端到端跑 `fetchEastmoneyAuction`）：

- 分时形态覆盖 **47/47**，链路总耗时 2.34s（与改造前的 ~2.3s 持平）
- 量能来源全部是 `tick`（当天分笔可用），分时兜底未触发 —— 北交所那类票要等实际出现才能验证
- 形态分布（当天）：
  `rising+尾段下砸 13`、`rising 7`、`rising+尾段下砸+后段放量 6`、`falling+尾段上抬+后段放量 6`、
  `rising+后段放量 4`、其余 11 只分散在 falling / flat / 上抬
- 按竞价量比降序看，**头部几乎全是「竞价走高 + 尾段下砸 + 摸板未封」**：
  华瓷股份 13.16%（走高 10.01%、下砸 4.07%）、沃顿科技 13.03%（5.18%）、新宏泽 9.78%（5.97%）……
  这些票的虚拟匹配价都是开盘就冲到涨停（+10%）然后被砸到最终竞价价，是当天一种非常集中的形态。

**刻意没有做的事**：形态特征**没有**进入合格判定。理由与 09:25 量能一致 ——
只有 2026-09-18 一天的样本，任何阈值都是在拟合当天。它现在只是观察列 + 落盘字段，
等攒够交易日再用 `minuteTrend` 做走前验证。

## 九、待验证清单

**已由本次调研验证通过（§七）**：
- [x] 腾讯分时的第一个点 = 09:25 竞价结果（47/47 价格完全相等，成交额最大误差 0.06%）
- [x] 东财分时首个成交量>0 的点 = 09:25 竞价结果（47/47 误差 ≤0.1%）
- [x] 腾讯分钟 K（m1/m5）传历史日期返回空、不传日期只覆盖约 1.3 个交易日
- [x] 东财分时（trends2）忽略 `date` 参数，只给最近一个交易日

**待验证**：
- [ ] POC 6（已实现，等验证）：竞价分时形态因子（`minuteTrend.trend/lateShiftPct/lateRush/touchedLimitUp`）
      与「次日是否封板 / 次日开盘收益」的关系 —— 需要先攒够交易日，脚本可仿 `scripts/auction-model.ts`
- [ ] POC 1：`list_security_call_auction_quotes` 传历史日期是否真返回历史竞价量能（决定 thsdk 是否有价值）
- [ ] POC 2：临时账号（`auth()` 无凭据）是否就能取到竞价行情，还是必须真实账号（issue #28 显示会失败）
- [ ] POC 3：`get_security_concept_tags()` 是否带历史语义（若带，可缓解 `README.md:456-457` 的前视偏差）
- [ ] POC 4：官方 `auction/snapshot` 与腾讯分笔的成交额/价格是否一致（一致则官方源可做竞价主源）
- [ ] POC 5：官方 `special-data/limit-up-pool?date_ms=` 能回溯多少个交易日（决定能否替代新浪自建）
- [ ] POC 6：把竞价量能主源从「逐只分笔」换成「分时首点」的收益评估（请求数、北交所覆盖率、
      `AuctionItem.source` 取值、以及是否需要保留分笔做交叉校验）—— **这一步值得实际改代码**
- [ ] 决策项：官方 API Key 的价格与配额是否可接受（未确认前不引入任何外部依赖）
- [ ] 若 POC 1 通过：评估补齐 60 个交易日 × 每日约 90 只的历史竞价数据需要多少墙钟时间
      （50ms 限频下 5400 次调用 ≈ 4.5 分钟，可接受）

## 十、不确定项（本次调研未能证实）

- thsdk 的 `account.session` 是否加密、是否会被上传
- thsdk 是否支持龙虎榜（96 个 API 清单里没有对应条目）
- 哪些 thsdk 接口需要付费/Level-2 权限（README 无权限矩阵，只能运行时 `account_permissions()` 探测）
- 是否有真实用户因 thsdk 被同花顺封号（未检索到公开确认案例，风险存在但未被证实）
- 是否有过 DMCA / 下架投诉（无发现）
- 同花顺 App/PC 客户端用户协议中与逆向直接对应的条款原文（本次取证到的是「同顺号」内容平台协议）
- 官方 hithink-finance 的价格、配额与数据延迟（官网未公开，需注册后确认）
