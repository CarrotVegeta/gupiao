# 选股重构 AI 实施说明与任务计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 本文不要求子代理。只有用户另行要求执行时才修改业务代码。

**Goal:** 将题材详情改成“统一股票表＋少量角色标签”，先核查本轮题材关联，再判题材强度和代表角色；修复趋势扫描的口径、覆盖披露和交互问题。

**Architecture:** 数据适配器提供带时间和失败状态的证据，纯函数负责关联、题材分类和角色分配；服务层统一编排，前端仅展示，不重新计算角色。保留趋势／题材两个入口，不重做其他业务模块。

**Tech Stack:** 现有 React、TypeScript、Express、Vitest；不为本次改造新增框架。

**Spec:** `docs/superpowers/plans/2026-09-17-screener-review-and-redesign.md`，含2026-09-18的5.2节补充。

日期：2026-09-18。状态：可交给AI评审及据此实施的建议版；尚未实施。

## 0. 给执行AI的边界

这份文件回答“具体怎么改”；配套审查报告回答“为什么要改”。两份都读。

本文中的数量上限、排序方式、阈值是为了避免执行时自由发挥而给出的**v1建议默认值**，不是用户已经逐项确认、也不是已验证的盈利参数。如果用户要求“按此文档实现”，按这些默认值实现，并集中存放为可解释的规则版本；用户后续指令优先。

### 必须满足

- 保留“趋势／题材”两个入口。
- 每个题材只展示一张去重股票表。取消“龙头／核心／中军／补涨”四个角色页签。
- 标签为股票在当前题材内的角色，不是四个股票池。
- F10概念归属不能独立确认本轮驱动；同一股票允许多重驱动。
- 数据缺失、待验证、不满足、满足四种状态不混淆。
- 不因有一个排名第一就强行贴确定标签；不自动编造公告、分时带动、催化来源或历史首板日期。
- 不修改持仓、自选、竞价、涨停关注等无关业务；不要为本次修改全局Quote状态类型。
- 不自动交易；不把角色或研究分数解释为买入信号或上涨概率。
- 本轮文档编写不等于授权编码。执行任务前检查工作区差异，保留用户已有修改，不回滚无关文件。

### 一期与后续边界

一期执行任务1～7：数据契约、本轮关联、分类、角色标签、接口、题材界面、趋势纠错。

后续任务8独立执行：完整原聊天趋势模板、全市场后台扫描、人工归因维护界面、题材阶段状态机、新回测。第一期不得假装已完成这些内容。

## 1. 页面最终应变成什么

```text
选股                         [趋势] [题材]

题材： [主线] [支线] [待确认]    交易日 / 更新时间 / 数据状态
题材列表                    选中题材名称 + 分类依据
                            概念成员涨停 n / 驱动有依据 m / 待确认 k
                            覆盖：总成员 n，已计算 m，失败 k，未扫描 j
                            [只看有角色标签]  搜索股票
                            股票 | 角色 | 本轮关联 | 涨跌幅 | 5日均额 | 依据
                            A    | 龙头候选、核心候选 | 有依据 | ...
                            B    | 趋势中军候选       | 有依据 | ...
                            C    | 潜在低位补涨       | 有依据 | ...
                            D    | —                  | 仅概念 | ...
                            点击行 → 展开证据、条件判定、风险和候选比较
```

不自动打开四个子列表。不以每行完整展示八条判断为默认布局。

初次进入展示全部已取得成员，带标签置顶；勾选“只看有角色标签”才隐藏无标签行。被扫描上限截断的成员仍可显示基本行情，但metrics状态为missing，不算“已评估且不达标”。

桌面左右联动，宽度不足900px改为题材列表→详情→返回；900px是布局默认值，可沿用项目更合适的已有断点。

## 2. 共享类型和接口契约

在 `src/types.ts` 增加下列类型；服务器类型可复用。旧ThemeStockItem中的行情和均线字段继续保留，不从零复制两套字段。

```ts
export type CheckState = 'pass' | 'fail' | 'pending' | 'missing';
export type ScreenerDataStatus = 'fresh' | 'partial' | 'stale' | 'unavailable';
export type ThemeKindV2 = 'main' | 'branch' | 'pending';
export type RelationState =
  'supported' | 'possible' | 'membership_only' | 'other_driver' | 'unknown';

export type Evidence = {
  id: string;
  themeCode: string;
  symbol: string;
  sourceKind: 'limit_up_reason' | 'announcement' | 'event' | 'manual';
  sourceName: string;
  sourceUrl: string | null;
  text: string;
  publishedAt: string | null;
  observedAt: string;
  validTradeDate: string;
  topicKey: string | null;
  // 只有明确语义映射才为exact；模糊关联不能作为强证据
  match: 'exact' | 'ambiguous' | 'unrelated';
};
export type ThemeRelation = {
  state: RelationState;
  evidenceIds: string[];
  reasons: string[];
  alternativeThemeCodes: string[];
  topicKeys: string[];
  asOf: string;
};
export type CheckResult = {
  key: string;
  state: CheckState;
  value: number | string | boolean | null;
  reason: string;
  evidenceIds: string[];
};
export type RoleTag = {
  role: ThemeStockRole;
  status: 'candidate' | 'confirmed';
  reasons: string[];
  missingEvidence: string[];
  assignedAt: string;
  ruleVersion: string;
};
export type ScanCoverage = {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unscanned: number;
};
export type ThemeStockV2 = ThemeStockItem & {
  quoteAsOf: string | null;
  relation: ThemeRelation;
  roles: RoleTag[];
  checks: Partial<Record<ThemeStockRole, CheckResult[]>>;
  metricsState: 'ready' | 'missing' | 'failed';
  metricsTradeDate: string | null;
  risksChecked: boolean;
};
export type ThemeDetailResponseV2 = {
  schemaVersion: 2;
  ruleVersion: string;
  tradeDate: string | null;
  asOf: string;
  theme: { code: string; name: string } | null;
  items: ThemeStockV2[];
  evidence: Evidence[];
  coverage: ScanCoverage;
  status: ScreenerDataStatus;
  warnings: string[];
  error: string | null;
};
```

约束：`attempted = succeeded + failed`；`total = attempted + unscanned`。日K不足窗口计failed并给原因，不伪装成评估成功。覆盖数只指唯一股票，不是四角色请求数相加。

`checks`中的必选项遇到missing/pending不能按pass处理。普通未涨停、明确不满足阈值是fail；数据没有取到是missing；需要次日或分时确认是pending。

接口改动：

- 新增 `GET /api/themes/:code/detail?date=YYYYMMDD`，响应为ThemeDetailResponseV2，不接收role。
- 前端新函数 `fetchThemeDetail(code, date?, signal?)` 替代按角色拉取。
- 暂时保留旧 `/stocks?role=` 路由作为兼容包装：调用同一个新服务，再按roles包含指定角色筛选；不能保留第二套判定逻辑。若已无调用方，在后续单独清理。
- `/api/themes` 增加schemaVersion、pending列表、classificationReasons、conceptLimitUpCount、supportedLimitUpCount、unresolvedLimitUpCount；旧limitUpCount保留为概念口径，但新UI不得笼统叫“题材驱动涨停数”。
- 数量缺少可靠基础数据时返回null，不返回0。完整基础涨停池中有n只成员、其中证据缺失时：concept=n，supported为已知下界，unresolved包含缺证据者。
- partial表示有可用结果但有缺失；stale表示返回之前同查询键缓存。fresh允许warnings但不允许error；不可恢复失败才error非空。同步更新客户端校验，不把partial变空列表。
- 数据键必须包含日期、题材、规则版本；趋势另外包含规范化参数。A题材缓存不能填到B题材。

## 3. 任务1：本轮题材关联（先做，P0）

**修改/新建文件**：`src/types.ts`、`server/themes/eastmoney.ts`、`tenjqka.ts`、新建 `server/themes/attribution.ts`、`topicAliases.ts`、`attribution.test.ts`。

**接口**：

```ts
type AttributionInput = {
  themeCode: string;
  symbol: string;
  isMember: boolean;
  evidence: Evidence[];
  evidenceFetchFailed: boolean;
  hasConflictingEvidence: boolean;
  alternativeThemeCodes: string[];
  tradeDate: string;
  asOf: string;
};
// 放在attribution.ts并导出，依赖仅为上述输入
export function resolveThemeRelation(input: AttributionInput): ThemeRelation;
```

### 明确如何拿证据

1. 复用已有涨停池reasonTags和获取时间。当天涨停原因只能支持当天观察，不自动解释之前20天。
2. F10只设置isMember并保留业务背景，不生成本轮强证据。
3. `topicAliases.ts` 用人工可审阅映射 `{ themeCode, topicKey, exactPhrases }`，只录入能在现有板块目录和真实样本核查的映射。不能编造BK代码；不能用字符串包含将“技术”“增长”“合作”等通用词判定为精确题材。
4. 名称规范化只去空格、统一全半角和明确别名；不使用任意模糊匹配作为exact。未配置的映射返回ambiguous或unknown，不“猜一个”。
5. 公告/事件适配器不在一期强行新增。类型预留，当前没有证据就保持unknown。不得调用语言模型凭股票名称虚构归因。
6. 保存上游原文和实际请求来源；无稳定文章URL时sourceUrl可为null，不能虚构新闻链接。publishedAt未知可以为null；observedAt不能冒充发布时间。

### 状态判定优先级

过滤 `observedAt > asOf`、`publishedAt > asOf`、`validTradeDate != tradeDate` 的证据。没有历史快照时，不把当前证据用于历史请求。

```ts
// 判定顺序；validEvidence已通过日期过滤
if (input.hasConflictingEvidence) return 'possible';
if (validEvidence.some(e => e.themeCode === input.themeCode && e.match === 'exact'))
  return 'supported';
if (input.evidenceFetchFailed) return 'unknown';
if (validEvidence.some(e => e.themeCode === input.themeCode && e.match === 'ambiguous'))
  return 'possible';
if (input.alternativeThemeCodes.length > 0) return 'other_driver';
return input.isMember ? 'membership_only' : 'unknown';
```

上述代码为分支示意；实际返回ThemeRelation完整对象，reasons必须包含命中分支原因，evidenceIds仅指向实际使用且有效的证据。`hasConflictingEvidence`只来自明确矛盾资料，不把“同时有A/B两条逻辑”当冲突。

**测试用例骨架**（使用Vitest，函数名和输入按本文）：

```ts
it('F10归属不能单独确认本轮驱动', () => {
  const result = resolveThemeRelation({
    themeCode: 'BK0001', symbol: '600001', isMember: true,
    evidence: [], evidenceFetchFailed: false,
    hasConflictingEvidence: false, alternativeThemeCodes: [],
    tradeDate: '20260918', asOf: '2026-09-18T07:10:00Z',
  });
  expect(result.state).toBe('membership_only');
});
```

测试编号A1～A6：纯归属→membership_only；exact本日原因→supported；ambiguous→possible；证据获取失败→unknown；仅另一题材有依据→other_driver；晚于asOf的证据不得支持历史结论。合成BK代码只用于测试。

- [ ] 写上述失败测试和其余五个输入变化案例。
- [ ] `npm test -- server/themes/attribution.test.ts`，确认失败原因指向未实现行为。
- [ ] 实现状态判定、日期过滤、来源保留；代码不发网络请求。
- [ ] 同一命令通过后检查变化，只提交本任务文件（仅在用户授权提交时）。

## 4. 任务2：重算题材分类（P0）

**文件**：`server/themes/classify.ts`、`classify.test.ts`、`service.ts`、`src/types.ts`。

**新增纯函数接口**：

```ts
type ThemeDayEvidence = {
  date: string;
  conceptCount: number | null;
  supportedCount: number | null;
  unresolvedCount: number | null;
  complete: boolean;
};
export function classifyThemeV2(daysNewestFirst: ThemeDayEvidence[]): {
  kind: ThemeKindV2;
  reasons: string[];
};
```

v1建议分类规则只用明确的家数与持续性，不用原8项凑分决定主线：

- 使用最近3个有效交易日，不是自然日，日期缺口不能跳过。
- 已知supported今天≥5且前两日各≥2 → main，即使有其他未决成员，正面资格已满足。记录覆盖不足的warning。
- 尚不能证明main：如不足3日、计数缺失，或unresolved可能使不达标日达到相应门槛 → pending。
- 足够数据排除main，今天supported≥2 → branch。
- 其他 → pending；只有当天存在概念活跃（concept≥2）或已跟踪的题材进入列表，避免把全目录都显示为pending。
- 这是“当日≥5＋连续3日≥2”的明确v1规则，不称“连续3日≥5”。原聊天更严格版本后续可作为独立配置，不偷换标题。
- 昨日已显示的题材在本次会话/现有快照仍可保留，标“今日未达活跃门槛”；不凭单日家数直接标退潮。

补充修正：梯队检查真实1板、2板、≥3板各至少1只；上游“几天几板”与连续板数不混用，无法区分时该指标missing，不能称连板梯队完整。催化强度→催化类别，市场影响力→相对强度与容量，龙头表现→高度标杆。这些只作为观察项。

**必须通过的输入输出**：

| supported 最近三日 | unresolved 最近三日 | 其他条件 | 结果 |
| --- | --- | --- | --- |
| 5,2,2 | 0,0,0 | 日期连续 | main |
| 5 | 0 | 仅首日 | pending |
| 4,2,2 | 1,0,0 | 今天未决可能补足 | pending |
| 4,2,2 | 0,0,0 | 完整 | branch |
| 5,null,2 | 0,null,0 | 缺前一日 | pending |
| 1,2,2 | 0,0,0 | 已跟踪题材 | pending＋今日未达活跃门槛 |

- [ ] 在classify.test.ts以`it.each`录入上述六组。
- [ ] `npm test -- server/themes/classify.test.ts`确认新例失败。
- [ ] 实现函数，service从任务1结果按(symbol,theme,date)去重生成计数，缺数据不补0。
- [ ] 运行同一命令并验证旧分类调用已被新函数替代；旧8分仅可保留观察展示。

## 5. 任务3：资格判断与代表标签（P0/P1）

**文件**：`roles.ts`、`metrics.ts`、新建 `assignRoles.ts`、`assignRoles.test.ts`、`metrics.test.ts`。

### 公共前置条件

确定资格：本轮relation=supported，指标可计算；排除ST；风险成功查询且flags为空。flags不为空暂不分配角色，并在表中展示原因；risksChecked=false保留观察信息但不发确定标签。这是保守v1产品规则，不把所有风险事件解释为同等交易风险。

possible/unknown/membership_only/other_driver不参加确定角色分配。可以显示“关联待确认”，但不能因为它成交额最大就叫龙头。

### 建议v1必要资格与排序

下表阈值集中在`ROLE_RULES_V1`，保持可追溯；代表排序按列依次比较，不引入未经解释的百分制权重。

| role | 必要资格（在公共条件外） | 代表排序，按顺序 |
| --- | --- | --- |
| leader | 近20交易日存在涨停记录；当前本轮关联有效 | 本轮可确认的连续板高度降序、近5日相对板块涨幅降序、5日均额降序 |
| turnover | 近3日均额≥5亿；当日换手8%～25%；不是连续两交易日一字涨停 | 3日均额降序、可计算的板块调整日相对表现降序 |
| trend | 沪深主板；近5日均额≥5亿；近10日≥7日收盘在MA5上；距MA5在[-5%,+5%]；近10日涨幅[5%,25%]；当前收盘≥MA10 | 5日均额降序、近10日站上MA5天数降序、距MA5绝对值升序 |
| laggard | 与龙头候选有相同非空topicKey；板块20日涨幅减个股≥15个百分点；流通市值50～300亿；最近3交易日发生首次20/60日平台放量突破；本轮启动晚于龙头2～4交易日 | 突破日降序、突破量/此前5日均量降序、5日均额降序 |

明确限制：

- leader有必要资格只表示高度/强度代表，缺少分时带动证据时标签必须是“龙头候选”。不能输出确认龙头。
- v1其余角色同样默认candidate，展示“核心候选”“趋势中军候选”“潜在低位补涨”。confirmed枚举留给未来有明确确认规则的版本，v1不生成。
- 持续一字判断用两日OHLC均相等且达到涨停价；缺任一日价格/涨停口径则pending，不把当天sealType替代历史检查。
- 中军不恢复MA5>MA10>MA20硬条件；只展示。取消用“命中6/8”代替必要资格。
- 补涨所需本轮龙头启动日期缺失时不给补涨标签；不得用任意20日最早涨停冒充。没有本轮事件锚点时应显示待验证。
- 相对涨幅只使用同日期区间、匹配可信的板块日K；缺排序项按未知处理且列入missingEvidence，不按0。第一关键排序项缺失时不比较出代表。
- 全部可用关键排序值相同则不强行选一个，返回“并列待确认”；股票代码只能用于稳定显示顺序，不用于证明谁更强。
- 默认每题材leader/turnover/trend各最多1只，laggard最多2只。允许一个股票多个标签，最终按symbol合并。
- 排名前的候选必须先完成风险和关联检查；不能先截前60再查询风险后不重排。

**纯函数接口**：

```ts
type RoleAssessment = {
  symbol: string;
  role: ThemeStockRole;
  eligible: boolean;
  checks: CheckResult[];
  // 所有项已转换为“越大越优”，缺失为null
  rank: Array<number | null>;
};
export function assignRoleTags(
  assessments: RoleAssessment[],
  assignedAt: string,
): { tags: Record<string, RoleTag[]>; warnings: string[] };
```

rank转换：升序量取负值；不可计算不得填0。所有必要checks须pass才eligible=true。先过滤eligible再按rank比较；第一项为null时该候选不参与代表分配，后续项null排在任意已知值后，两个null继续比较下一项。相同rank且跨过选取上限的边界时，该边界组不发标签并给并列warning。

字段来源：连续板高度用逐日收盘是否达到该日涨停价重新计算，不能使用“8天5板”的5冒充连续5板；近5日相对板块涨幅=个股5日涨幅−板块同期5日涨幅；板块调整日相对表现=最近20交易日内板块跌幅≤−1%的各日“个股涨幅−板块涨幅”的均值，少于2个有效日则null。补涨日期排序使用YYYYMMDD数值；所有排名只比较同一题材、同一截止日。

**测试骨架**：

```ts
it('未满足必要条件不能用高排序分补偿', () => {
  const output = assignRoleTags([
    { symbol: '600001', role: 'leader', eligible: false, checks: [], rank: [9,9,9] },
    { symbol: '600002', role: 'leader', eligible: true, checks: [], rank: [3,2,1] },
  ], '2026-09-18T07:10:00Z');
  expect(output.tags['600001']).toBeUndefined();
  expect(output.tags['600002'][0].status).toBe('candidate');
});
```

其他必须案例：同股双标签只一行；无合格者空标签；同分边界待确认；风险未查不合格；未涨停日不自动从候选全集删除；缺本轮启动日期没有补涨标签。

`metrics.ts`具体修正：输入先按交易日截断；记录最近突破日，而非只判断最后一根；突破仍用现有收盘超过此前20/60日高点且量≥此前5日均量2倍，命名前20日未发生同类突破为“首次”；最近3交易日窗口含信号日。自然日差改为交易日历索引差。涨跌日量能用close与前一交易日close比较，不用open；只取截止日期已完成的10个交易日。

- [ ] 写代表分配测试及周末间隔、历史突破、涨跌日口径测试。
- [ ] `npm test -- server/themes/assignRoles.test.ts server/themes/metrics.test.ts server/themes/roles.test.ts`确认失败。
- [ ] 实现必要资格、排名和日期指标，删除新路径对ROLE_MIN_HITS的依赖。
- [ ] 同一命令通过；只保留与新规则兼容的旧角色测试。

## 6. 任务4：统一详情服务及兼容接口（P1）

**文件**：`server/themes/service.ts`、`server/index.ts`、`src/lib/screener.ts`及对应测试；新建`server/themes/service.test.ts`。

服务接口：`buildThemeDetail(tradeDate: string, boardCode: string, fetchImpl = fetch): Promise<ThemeDetailResponseV2>`。

编排顺序必须是：

1. 读取所有可获得成员与当日行情，按symbol去重，保存基本行。
2. 获取当日有效关联证据，调用任务1；未涨停成员仍保留，不能从今日涨停池反推全部成员身份。
3. 分批计算日K与风险。v1沿用日K并发6；快速上限120，但记录未扫描成员。不能用当日成交额3.5亿过滤成员再宣称全题材排名。
4. 候选扫描顺序：已有有效标签成员、当日supported成员、其余成员按成交额降序；symbol去重。有效标签仅来自同日同版本缓存，不把旧日期标签当今日确认。
5. 计算资格与代表；若有未扫描/失败，只称“已扫描范围内候选”，response.status=partial。
6. 返回所有已取得基本成员，缺日K的行roles=[]、metricsState=missing/failed。
7. 同一次计算结果供题材总览和详情使用。总览未算角色前显示“待计算”；可另列“高度标杆”，不得自行称龙头。

缓存TTL沿用5分钟，键=date+code+ruleVersion；有失败可保留同键成功快照为stale，fetched/asOf显示原数据时间。历史请求无当时快照时返回unavailable并说明“无该日快照”，不要拼最新行情；历史精确重建留到后续。

测试固定上游响应，不使用实时网络：重复成员合并、120截断覆盖数、某只日K失败不让整题材清空、风险失败不分配标签、旧role兼容路由与新接口同源、历史请求不返回今天行情。

- [ ] 为service写上述六个mock场景；客户端增加partial响应及非法字段校验测试。
- [ ] `npm test -- server/themes/service.test.ts src/lib/screener.test.ts`。
- [ ] 实现服务、路由和解析；fetchThemeDetail接受AbortSignal。
- [ ] 重跑上述测试及`npm run typecheck`，解决所有新旧类型调用差异。

## 7. 任务5：移除角色页签，改统一列表（P1）

**文件**：`ThemeDetail.tsx`、`ThemeBoard.tsx`、`ScreenerPanel.tsx`、`src/styles.css`、相关组件测试；必要时新增`RoleBadges.tsx`和`ThemeStockEvidence.tsx`，仅负责显示。

具体删除：ThemeDetail的role state、按role触发的useEffect、四个标签button、`fetchThemeStocks(theme.code,nextRole)`新页面调用、单个role决定的空状态。

具体新增：items按symbol一行；roles标签；relation中文状态；独立风险列/标记；点击展开checks和对应evidence；未扫描状态；标签为空显示“—”。

最新请求保护示例（刷新计数用state，省略具体渲染）：

```tsx
useEffect(() => {
  let active = true;
  const controller = new AbortController();
  setLoading(true);
  fetchThemeDetail(theme.code, tradeDate, controller.signal)
    .then(next => { if (active) setData(next); })
    .catch(error => {
      if (!active || error.name === 'AbortError') return;
      // 仅保留当前code/date键的缓存并标stale；无同键缓存显示unavailable
      setError(error.message);
    })
    .finally(() => { if (active) setLoading(false); });
  return () => { active = false; controller.abort(); };
}, [theme.code, tradeDate, refreshCounter]);
```

不要让新题材加载期间继续显示旧题材的股票并配上新标题。加载时清除不同键结果；同键刷新保留原结果并显示刷新状态。

验收：页面上无四个role页签；同股双标签一行；“仅概念归属”的股票没有确定角色；A→B后A请求晚返回不会覆盖；失败不同时显示“没有达标股”；键盘可展开详情。

- [ ] 用Testing Library断言上述六项，网络返回使用deferred promise测试乱序。
- [ ] `npm test -- src/components/ScreenerPanel.test.tsx src/components/ThemeDetail.test.tsx`（新增ThemeDetail.test.tsx）。
- [ ] 实现组件和样式；响应式断点按第1节。
- [ ] 同一命令通过，浏览器检查桌面与窄屏截图，不把仅组件测试当视觉验收。

## 8. 任务6：趋势扫描第一期纠错（P0/P1）

**文件**：`TrendScanner.tsx`、`server/screener/trend.ts`、`src/types.ts`、`src/lib/screener.ts`；新建`server/screener/trend.test.ts`及`src/components/TrendScanner.test.tsx`。

一期保留原五条件研究模板及参数默认值，不擅自套用新完整方法。必须做：

1. “回调缩量”改“缩量（最近已完成日成交量/此前5日均量）”；未完成日K从形态计算移除。
2. 增加metricsTradeDate；最新报价标quoteAsOf。最后日K是否完成由交易日/时段判断；无可信日历或完成状态时返回missing，不以本机日期盲猜。
3. 去掉`candidate.member.amount < minAmountYi*1e8*0.7`前置剔除；近5日均额在日K计算后作为独立门槛。
4. 保留快速260只上限但响应增加coverage、matchedTotal、returnedCount、truncated。matchedTotal指已扫描范围，界面文字必须一致；最多120行截断时说明。
5. 保留“连续N日”名称，不把它改名为“10日内7日”；保留绝对距离规则但明示“距MA5绝对偏离≤X%”，结果显示有向值。
6. “4/5”暂保留为旧模板研究模式，标明具体缺哪项，不称全部硬条件通过。新必选/观察配置放任务8。
7. 输入改draftFilters，点击应用通过校验后复制到appliedFilters并请求；空输入不转0，非整数天数拒绝，小于最小值给字段错误。重新扫描使用appliedFilters。
8. 同任务5保护最新请求；失败保留同参数旧结果，切换参数时不能把旧结果当当前结果。
9. 将“被否定/毒源”替换为审查报告第8节的受限结论，完整研究细节可折叠；参数变化提示研究只针对原配置。

测试案例：只缩量但上涨的K线文案不出现“回调”；盘中K线不参与全天量比较；5日均额达标但当天量小不在预筛被删；261候选只扫260要显示未扫描1；空数字不请求；快速输入三次应用只产生一次请求；旧请求不能覆盖新参数。

- [ ] 录入上述七个案例并运行`npm test -- server/screener/trend.test.ts src/components/TrendScanner.test.tsx`。
- [ ] 按1～9项实现，每项保留明确状态，不新增未约定的阈值。
- [ ] 同一测试命令通过，检查原模板参数在往返请求中保持一致。

## 9. 任务7：集成验收和交付

按顺序执行：

```text
npm run typecheck
npm test
npm run build
```

构建脚本当前含`rm -rf dist-server`。在Windows运行前检查npm脚本实际使用的shell；若需改为跨平台清理，使用Node fs.rmSync并确认目标解析为本项目dist-server，不删除其他目录。

浏览器操作路径：选股→题材→分别打开主线/支线/待确认→展开股票→切题材→模拟部分失败→切趋势→修改条件→应用→返回。核对角色、来源、截止日期、覆盖、风险和结果不会错配。

交付必须包含：

- 改动文件清单与规则版本。
- 各角色默认资格和数量限制；明确为候选、非收益承诺。
- 测试命令实际结果和未通过项；不得写未运行的测试已通过。
- 一份真实数据缺口说明：无法归因、无法确认带动、未扫描范围等。
- 桌面、窄屏展示结果；无可靠真实上游时说明使用fixture，不能伪造线上验收。

不要因新证据规则导致标签减少就放宽为F10归属自动通过；这恰是本次修正要避免的行为。

## 10. 任务8：明确留给第二期的工作

以下不是一期遗漏，需单独验证后实施：

| 工作 | 如何进入下一期 |
| --- | --- |
| 原聊天完整趋势模板 | 新建版本，增加MA5/10连续3日上行、10日7日站稳、涨幅上下限、20日高点距离、加速过滤；定义每个公式并与旧模板分开 |
| 必选／观察／关闭条件 | 增加条件schema和参数校验，取消任意命中数代替必要资格；保存方案带版本 |
| 完整市场扫描 | 后台分批任务、进度、取消、缓存，区分快速结果与完成结果 |
| 人工维护本轮归因 | 可编辑证据来源和有效日期，记录更正日志；不是直接编辑计算结果而不留记录 |
| 非涨停股的驱动证据覆盖 | 验证公告/事件来源后接入；没有来源之前宁可关联未知 |
| 角色确认与阶段识别 | 定义分钟级带动证据、跨日角色稳定条件和阶段转移；未实现前只给候选 |
| 新回测 | 复用版本规则、处理历史证据可用时间、交易执行成本和重叠收益统计；不得沿用旧结果宣称新策略有效 |

## 11. 可直接发给AI的任务提示词

```text
请先阅读以下两份文件：
1. docs/superpowers/plans/2026-09-17-screener-review-and-redesign.md
2. docs/superpowers/plans/2026-09-18-screener-ai-implementation.md

请按第2份文件的任务1～7实现第一期，任务8不在本次范围。
先核查当前仓库状态，再逐项修改、测试并进行页面验收。
必须保留趋势/题材入口；题材内只有一张股票表，角色作为标签。
必须区分静态概念归属和本轮驱动；数据不足输出待确认，禁止编造。
采用文档标明的v1建议默认值，不自行增加新的评分权重或交易规则。
如发现文档与实际代码不一致，先定位差异；普通实现细节自行处理，
涉及需求范围或判定语义的重大变化需明确说明。
完成后交付实际测试结果、页面展示和未解决的数据限制。
不要修改无关业务，也不要自动提交或推送。
```

如果仅想让AI检查计划，把提示词中的“实现第一期”替换为“评审第一期计划，不修改代码”。
