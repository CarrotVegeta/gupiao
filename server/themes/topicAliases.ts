/**
 * 题材细分逻辑（topicKey）的人工可审阅映射表。
 *
 * 目的：把上游涨停原因文本（如「风电铸件+半年报增长」）映射到某个**题材的细分逻辑**。
 * 只有明确语义映射才算 `exact`；没配置的一律 `ambiguous`/`unknown`，
 * 绝不使用「字符串包含」把「技术」「增长」「合作」这类通用词判定为精确题材。
 *
 * 录入规则（见实施说明 §3.4）：
 *   1. `themeCode` 必须是真实存在的东财 BK 板块代码，不能用编造的代码。
 *   2. `exactPhrases` 只能写能在现有板块目录与真实样本里核查过的细分逻辑词。
 *   3. 通用词（技术 / 增长 / 合作 / 概念 / 龙头 …）禁止进 `exactPhrases`。
 *
 * 状态（2026-09-18 更新）：**已按真实样本补录，见下方 `TOPIC_ALIASES`**。
 * 补录只收「词面自证」的条目（标签与板块名全等，或互为包含且有 ≥2 次样本），
 * 因为样本里一只票的涨停原因会复制到它所属的几十个板块上——
 * 「人形机器人」被挂到 117 个板块（最高频共现竟是「新能源车」），共现统计不能当依据。
 * 新增条目时请保持同样标准：能在涨停池 + 东财目录里核查到，才写进来。
 */

export type TopicAliasEntry = {
  /** 东财板块代码，如 BK1036 */
  themeCode: string;
  /** 细分逻辑键，同题材内唯一，用于「与龙头同源逻辑」比较 */
  topicKey: string;
  /** 该细分逻辑的精确词；按规范化后的文本做全等比较 */
  exactPhrases: string[];
};

/**
 * 2026-09-18 按真实样本补录：窗口 20260817 ~ 20260918（25 个交易日），
 * 由 tmp-analysis/alias-emit.ts 生成（可重跑）。采信规则：
 *   1. 涨停原因标签与该板块名归一后完全相等 → 直接采信；
 *   2. 二者互为包含（如「高端PCB」⊇「PCB」）且样本 ≥2 → 采信；
 *   3. 其余不采信——「人形机器人」在样本里被挂到 117 个板块上（最高频共现是「新能源车」），
 *      共现统计不能当依据，只有词面自证的才收。
 * 每条一个细分逻辑（topicKey = 归一后的词），注释里的「样本 N」是窗口内观测次数。
 */
export const TOPIC_ALIASES: TopicAliasEntry[] = [
  // BK0490 军工
  { themeCode: 'BK0490', topicKey: '军工装备', exactPhrases: ['军工装备'] }, // 样本 5
  { themeCode: 'BK0490', topicKey: '军工', exactPhrases: ['军工'] }, // 样本 4（与板块名全等）

  // BK0492 煤化工概念
  { themeCode: 'BK0492', topicKey: '煤化工', exactPhrases: ['煤化工'] }, // 样本 9

  // BK0493 新能源
  { themeCode: 'BK0493', topicKey: '新能源发电', exactPhrases: ['新能源发电'] }, // 样本 2
  { themeCode: 'BK0493', topicKey: '新能源', exactPhrases: ['新能源'] }, // 样本 1（与板块名全等）

  // BK0506 创投
  { themeCode: 'BK0506', topicKey: '创投', exactPhrases: ['创投'] }, // 样本 3（与板块名全等）

  // BK0509 网络游戏
  { themeCode: 'BK0509', topicKey: '网络游戏', exactPhrases: ['网络游戏'] }, // 样本 3（与板块名全等）

  // BK0547 黄金概念
  { themeCode: 'BK0547', topicKey: '黄金', exactPhrases: ['黄金'] }, // 样本 6
  { themeCode: 'BK0547', topicKey: '黄金概念', exactPhrases: ['黄金概念'] }, // 样本 1（与板块名全等）

  // BK0554 物联网
  { themeCode: 'BK0554', topicKey: 'RFID物联网', exactPhrases: ['RFID物联网'] }, // 样本 3
  { themeCode: 'BK0554', topicKey: '物联网', exactPhrases: ['物联网'] }, // 样本 1（与板块名全等）

  // BK0574 锂电池概念
  { themeCode: 'BK0574', topicKey: '锂电池', exactPhrases: ['锂电池'] }, // 样本 4

  // BK0577 核能核电
  { themeCode: 'BK0577', topicKey: '核电', exactPhrases: ['核电'] }, // 样本 3

  // BK0581 智能电网
  { themeCode: 'BK0581', topicKey: '智能电网', exactPhrases: ['智能电网'] }, // 样本 7（与板块名全等）

  // BK0588 光伏概念
  { themeCode: 'BK0588', topicKey: '光伏', exactPhrases: ['光伏'] }, // 样本 2

  // BK0615 中药概念
  { themeCode: 'BK0615', topicKey: '中药', exactPhrases: ['中药'] }, // 样本 14

  // BK0617 石墨烯
  { themeCode: 'BK0617', topicKey: '石墨烯', exactPhrases: ['石墨烯'] }, // 样本 5（与板块名全等）

  // BK0619 3D打印
  { themeCode: 'BK0619', topicKey: '3D打印', exactPhrases: ['3D打印'] }, // 样本 2（与板块名全等）

  // BK0628 智慧城市
  { themeCode: 'BK0628', topicKey: '智慧城市', exactPhrases: ['智慧城市'] }, // 样本 1（与板块名全等）

  // BK0634 大数据
  { themeCode: 'BK0634', topicKey: '视听大数据', exactPhrases: ['视听大数据'] }, // 样本 2

  // BK0644 特斯拉概念
  { themeCode: 'BK0644', topicKey: '特斯拉概念', exactPhrases: ['特斯拉概念'] }, // 样本 1（与板块名全等）

  // BK0655 网络安全
  { themeCode: 'BK0655', topicKey: '网络安全', exactPhrases: ['网络安全'] }, // 样本 8（与板块名全等）

  // BK0666 苹果概念
  { themeCode: 'BK0666', topicKey: '苹果概念', exactPhrases: ['苹果概念'] }, // 样本 3（与板块名全等）

  // BK0680 智能家居
  { themeCode: 'BK0680', topicKey: '智能家居', exactPhrases: ['智能家居'] }, // 样本 2（与板块名全等）

  // BK0683 央国企改革
  { themeCode: 'BK0683', topicKey: '国企改革', exactPhrases: ['国企改革'] }, // 样本 24
  { themeCode: 'BK0683', topicKey: '国企', exactPhrases: ['国企'] }, // 样本 8

  // BK0690 氟化工概念
  { themeCode: 'BK0690', topicKey: '氟化工', exactPhrases: ['氟化工'] }, // 样本 3

  // BK0693 基因测序
  { themeCode: 'BK0693', topicKey: '基因测序', exactPhrases: ['基因测序'] }, // 样本 4（与板块名全等）

  // BK0703 超级电容
  { themeCode: 'BK0703', topicKey: '超级电容', exactPhrases: ['超级电容'] }, // 样本 3（与板块名全等）

  // BK0706 脑机接口
  { themeCode: 'BK0706', topicKey: '脑机接口', exactPhrases: ['脑机接口'] }, // 样本 2（与板块名全等）

  // BK0802 智能驾驶
  { themeCode: 'BK0802', topicKey: '智能驾驶', exactPhrases: ['智能驾驶'] }, // 样本 4（与板块名全等）

  // BK0809 AI智能体
  { themeCode: 'BK0809', topicKey: 'AI智能体', exactPhrases: ['AI智能体'] }, // 样本 2（与板块名全等）

  // BK0825 新零售
  { themeCode: 'BK0825', topicKey: '零售', exactPhrases: ['零售'] }, // 样本 10
  { themeCode: 'BK0825', topicKey: '新零售', exactPhrases: ['新零售'] }, // 样本 7（与板块名全等）

  // BK0841 体外诊断概念
  { themeCode: 'BK0841', topicKey: '体外诊断', exactPhrases: ['体外诊断'] }, // 样本 5

  // BK0843 天然气
  { themeCode: 'BK0843', topicKey: '天然气', exactPhrases: ['天然气'] }, // 样本 6（与板块名全等）

  // BK0864 氢能源
  { themeCode: 'BK0864', topicKey: '氢能', exactPhrases: ['氢能'] }, // 样本 2

  // BK0877 PCB
  { themeCode: 'BK0877', topicKey: 'PCB', exactPhrases: ['PCB'] }, // 样本 12（与板块名全等）
  { themeCode: 'BK0877', topicKey: '高端PCB', exactPhrases: ['高端PCB'] }, // 样本 10
  { themeCode: 'BK0877', topicKey: '光模块PCB', exactPhrases: ['光模块PCB'] }, // 样本 6
  { themeCode: 'BK0877', topicKey: 'PCB概念', exactPhrases: ['PCB概念'] }, // 样本 5
  { themeCode: 'BK0877', topicKey: 'AI算力PCB', exactPhrases: ['AI算力PCB'] }, // 样本 5
  { themeCode: 'BK0877', topicKey: 'AI服务器PCB', exactPhrases: ['AI服务器PCB'] }, // 样本 5
  { themeCode: 'BK0877', topicKey: 'PCB覆铜板', exactPhrases: ['PCB覆铜板'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: 'PCB制造', exactPhrases: ['PCB制造'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: '拟布局PCB', exactPhrases: ['拟布局PCB'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: 'PCB收购', exactPhrases: ['PCB收购'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: '算力PCB', exactPhrases: ['算力PCB'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: 'AI电源PCB', exactPhrases: ['AI电源PCB'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: 'PCB用化学试剂', exactPhrases: ['PCB用化学试剂'] }, // 样本 2
  { themeCode: 'BK0877', topicKey: 'PCB刀具', exactPhrases: ['PCB刀具'] }, // 样本 2

  // BK0883 数字货币
  { themeCode: 'BK0883', topicKey: '数字货币', exactPhrases: ['数字货币'] }, // 样本 4（与板块名全等）

  // BK0884 光刻机
  { themeCode: 'BK0884', topicKey: '光刻机', exactPhrases: ['光刻机'] }, // 样本 2（与板块名全等）

  // BK0888 农业种植
  { themeCode: 'BK0888', topicKey: '农业种植', exactPhrases: ['农业种植'] }, // 样本 1（与板块名全等）

  // BK0890 MLCC
  { themeCode: 'BK0890', topicKey: 'MLCC离型膜', exactPhrases: ['MLCC离型膜'] }, // 样本 3
  { themeCode: 'BK0890', topicKey: 'MLCC上游', exactPhrases: ['MLCC上游'] }, // 样本 2
  { themeCode: 'BK0890', topicKey: 'MLCC', exactPhrases: ['MLCC'] }, // 样本 1（与板块名全等）

  // BK0892 乳业
  { themeCode: 'BK0892', topicKey: '乳业', exactPhrases: ['乳业'] }, // 样本 1（与板块名全等）

  // BK0895 维生素
  { themeCode: 'BK0895', topicKey: '维生素', exactPhrases: ['维生素'] }, // 样本 3（与板块名全等）

  // BK0896 白酒
  { themeCode: 'BK0896', topicKey: '白酒', exactPhrases: ['白酒'] }, // 样本 1（与板块名全等）

  // BK0899 CRO
  { themeCode: 'BK0899', topicKey: 'CRO', exactPhrases: ['CRO'] }, // 样本 5（与板块名全等）

  // BK0900 新能源车
  { themeCode: 'BK0900', topicKey: '新能源车', exactPhrases: ['新能源车'] }, // 样本 1（与板块名全等）

  // BK0906 流感
  { themeCode: 'BK0906', topicKey: '流感', exactPhrases: ['流感'] }, // 样本 1（与板块名全等）

  // BK0907 转基因
  { themeCode: 'BK0907', topicKey: '转基因玉米', exactPhrases: ['转基因玉米'] }, // 样本 10
  { themeCode: 'BK0907', topicKey: '转基因', exactPhrases: ['转基因'] }, // 样本 9（与板块名全等）

  // BK0908 HJT电池
  { themeCode: 'BK0908', topicKey: 'HJT电池', exactPhrases: ['HJT电池'] }, // 样本 2（与板块名全等）

  // BK0918 特高压
  { themeCode: 'BK0918', topicKey: '特高压', exactPhrases: ['特高压'] }, // 样本 8（与板块名全等）

  // BK0920 车联网(车路云)
  { themeCode: 'BK0920', topicKey: '车联网', exactPhrases: ['车联网'] }, // 样本 2

  // BK0922 数据中心
  { themeCode: 'BK0922', topicKey: '数据中心交换机', exactPhrases: ['数据中心交换机'] }, // 样本 6
  { themeCode: 'BK0922', topicKey: '数据中心', exactPhrases: ['数据中心'] }, // 样本 4（与板块名全等）
  { themeCode: 'BK0922', topicKey: 'AI数据中心', exactPhrases: ['AI数据中心'] }, // 样本 2

  // BK0939 辅助生殖
  { themeCode: 'BK0939', topicKey: '辅助生殖', exactPhrases: ['辅助生殖'] }, // 样本 1（与板块名全等）

  // BK0948 MicroLED
  { themeCode: 'BK0948', topicKey: 'MicroLED', exactPhrases: ['Micro LED'] }, // 样本 1（与板块名全等）

  // BK0949 氦气概念
  { themeCode: 'BK0949', topicKey: '氦气', exactPhrases: ['氦气'] }, // 样本 3

  // BK0950 草甘膦
  { themeCode: 'BK0950', topicKey: '草甘膦', exactPhrases: ['草甘膦'] }, // 样本 2（与板块名全等）

  // BK0952 第三代半导体
  { themeCode: 'BK0952', topicKey: '第三代半导体', exactPhrases: ['第三代半导体'] }, // 样本 1（与板块名全等）

  // BK0953 鸿蒙概念
  { themeCode: 'BK0953', topicKey: '鸿蒙概念', exactPhrases: ['鸿蒙概念'] }, // 样本 2（与板块名全等）

  // BK0958 虚拟电厂
  { themeCode: 'BK0958', topicKey: '虚拟电厂', exactPhrases: ['虚拟电厂'] }, // 样本 7（与板块名全等）

  // BK0959 数字阅读
  { themeCode: 'BK0959', topicKey: '数字阅读', exactPhrases: ['数字阅读'] }, // 样本 2（与板块名全等）

  // BK0963 商业航天
  { themeCode: 'BK0963', topicKey: '商业航天', exactPhrases: ['商业航天'] }, // 样本 10（与板块名全等）

  // BK0968 固态电池
  { themeCode: 'BK0968', topicKey: '固态电池', exactPhrases: ['固态电池'] }, // 样本 12（与板块名全等）

  // BK0979 低碳冶金
  { themeCode: 'BK0979', topicKey: '低碳冶金', exactPhrases: ['低碳冶金'] }, // 样本 1（与板块名全等）

  // BK0989 储能概念
  { themeCode: 'BK0989', topicKey: '储能', exactPhrases: ['储能'] }, // 样本 11

  // BK0991 工程机械概念
  { themeCode: 'BK0991', topicKey: '工程机械', exactPhrases: ['工程机械'] }, // 样本 2

  // BK0993 宠物经济
  { themeCode: 'BK0993', topicKey: '宠物经济', exactPhrases: ['宠物经济'] }, // 样本 2（与板块名全等）

  // BK0998 机器视觉
  { themeCode: 'BK0998', topicKey: '机器视觉', exactPhrases: ['机器视觉'] }, // 样本 1（与板块名全等）

  // BK1003 抽水蓄能
  { themeCode: 'BK1003', topicKey: '抽水蓄能', exactPhrases: ['抽水蓄能'] }, // 样本 2（与板块名全等）

  // BK1004 工业母机
  { themeCode: 'BK1004', topicKey: '工业母机', exactPhrases: ['工业母机'] }, // 样本 3（与板块名全等）

  // BK1007 植物照明
  { themeCode: 'BK1007', topicKey: '植物照明', exactPhrases: ['植物照明'] }, // 样本 2（与板块名全等）

  // BK1010 磷化工
  { themeCode: 'BK1010', topicKey: '磷化工', exactPhrases: ['磷化工'] }, // 样本 5（与板块名全等）

  // BK1011 环氧丙烷
  { themeCode: 'BK1011', topicKey: '环氧丙烷', exactPhrases: ['环氧丙烷'] }, // 样本 1（与板块名全等）

  // BK1013 华为欧拉
  { themeCode: 'BK1013', topicKey: '华为欧拉', exactPhrases: ['华为欧拉'] }, // 样本 1（与板块名全等）

  // BK1022 职业教育
  { themeCode: 'BK1022', topicKey: '职业教育', exactPhrases: ['职业教育'] }, // 样本 1（与板块名全等）

  // BK1023 培育钻石
  { themeCode: 'BK1023', topicKey: '培育钻石', exactPhrases: ['培育钻石'] }, // 样本 6（与板块名全等）

  // BK1024 绿色电力
  { themeCode: 'BK1024', topicKey: '电力', exactPhrases: ['电力'] }, // 样本 6
  { themeCode: 'BK1024', topicKey: '绿色电力', exactPhrases: ['绿色电力'] }, // 样本 2（与板块名全等）

  // BK1026 调味品概念
  { themeCode: 'BK1026', topicKey: '调味品', exactPhrases: ['调味品'] }, // 样本 3

  // BK1047 数据安全
  { themeCode: 'BK1047', topicKey: '数据安全', exactPhrases: ['数据安全'] }, // 样本 5（与板块名全等）

  // BK1063 重组蛋白
  { themeCode: 'BK1063', topicKey: '重组蛋白', exactPhrases: ['重组蛋白'] }, // 样本 1（与板块名全等）

  // BK1071 跨境支付
  { themeCode: 'BK1071', topicKey: '跨境支付', exactPhrases: ['跨境支付'] }, // 样本 3（与板块名全等）

  // BK1089 汽车热管理
  { themeCode: 'BK1089', topicKey: '汽车热管理', exactPhrases: ['汽车热管理'] }, // 样本 5（与板块名全等）

  // BK1090 机器人概念
  { themeCode: 'BK1090', topicKey: '机器人', exactPhrases: ['机器人'] }, // 样本 20
  { themeCode: 'BK1090', topicKey: '机器人概念', exactPhrases: ['机器人概念'] }, // 样本 6（与板块名全等）

  // BK1101 先进封装
  { themeCode: 'BK1101', topicKey: '先进封装', exactPhrases: ['先进封装'] }, // 样本 5（与板块名全等）

  // BK1102 空气能热泵
  { themeCode: 'BK1102', topicKey: '空气能热泵', exactPhrases: ['空气能热泵'] }, // 样本 1（与板块名全等）

  // BK1104 信创
  { themeCode: 'BK1104', topicKey: '信创', exactPhrases: ['信创'] }, // 样本 1（与板块名全等）

  // BK1106 创新药
  { themeCode: 'BK1106', topicKey: '创新药', exactPhrases: ['创新药'] }, // 样本 33（与板块名全等）

  // BK1109 供销社概念
  { themeCode: 'BK1109', topicKey: '供销社', exactPhrases: ['供销社'] }, // 样本 7

  // BK1113 复合集流体
  { themeCode: 'BK1113', topicKey: '复合集流体', exactPhrases: ['复合集流体'] }, // 样本 2（与板块名全等）

  // BK1115 跨境电商
  { themeCode: 'BK1115', topicKey: '跨境电商', exactPhrases: ['跨境电商'] }, // 样本 5（与板块名全等）

  // BK1128 CPO概念
  { themeCode: 'BK1128', topicKey: 'CPO', exactPhrases: ['CPO'] }, // 样本 9

  // BK1134 算力概念
  { themeCode: 'BK1134', topicKey: '算力', exactPhrases: ['算力'] }, // 样本 5

  // BK1136 光通信模块
  { themeCode: 'BK1136', topicKey: '光通信', exactPhrases: ['光通信'] }, // 样本 6

  // BK1137 存储芯片
  { themeCode: 'BK1137', topicKey: '存储芯片', exactPhrases: ['存储芯片'] }, // 样本 13（与板块名全等）

  // BK1138 液冷服务器
  { themeCode: 'BK1138', topicKey: '液冷服务器', exactPhrases: ['液冷服务器'] }, // 样本 21（与板块名全等）
  { themeCode: 'BK1138', topicKey: '液冷', exactPhrases: ['液冷'] }, // 样本 11

  // BK1147 SPD概念
  { themeCode: 'BK1147', topicKey: 'SPD', exactPhrases: ['SPD'] }, // 样本 3

  // BK1156 PEEK材料概念
  { themeCode: 'BK1156', topicKey: 'PEEK材料', exactPhrases: ['PEEK材料'] }, // 样本 4

  // BK1160 柔性屏(折叠屏)
  { themeCode: 'BK1160', topicKey: '折叠屏', exactPhrases: ['折叠屏'] }, // 样本 3

  // BK1163 可控核聚变
  { themeCode: 'BK1163', topicKey: '可控核聚变', exactPhrases: ['可控核聚变'] }, // 样本 7（与板块名全等）
  { themeCode: 'BK1163', topicKey: '核聚变', exactPhrases: ['核聚变'] }, // 样本 2

  // BK1166 低空经济
  { themeCode: 'BK1166', topicKey: '低空经济', exactPhrases: ['低空经济'] }, // 样本 3（与板块名全等）

  // BK1172 AI语料
  { themeCode: 'BK1172', topicKey: 'AI语料', exactPhrases: ['AI语料'] }, // 样本 3（与板块名全等）

  // BK1174 合成生物
  { themeCode: 'BK1174', topicKey: '合成生物', exactPhrases: ['合成生物'] }, // 样本 8（与板块名全等）

  // BK1175 玻璃基板
  { themeCode: 'BK1175', topicKey: '玻璃基板', exactPhrases: ['玻璃基板'] }, // 样本 4（与板块名全等）
  { themeCode: 'BK1175', topicKey: '玻璃基板上游', exactPhrases: ['玻璃基板上游'] }, // 样本 2

  // BK1176 财税数字化
  { themeCode: 'BK1176', topicKey: '财税数字化', exactPhrases: ['财税数字化'] }, // 样本 1（与板块名全等）

  // BK1178 AI眼镜
  { themeCode: 'BK1178', topicKey: 'AI眼镜', exactPhrases: ['AI眼镜'] }, // 样本 2（与板块名全等）

  // BK1181 并购重组概念
  { themeCode: 'BK1181', topicKey: '重组', exactPhrases: ['重组'] }, // 样本 6
  { themeCode: 'BK1181', topicKey: '并购重组', exactPhrases: ['并购重组'] }, // 样本 2

  // BK1182 智谱AI概念
  { themeCode: 'BK1182', topicKey: '智谱AI', exactPhrases: ['智谱AI'] }, // 样本 2

  // BK1184 人形机器人
  { themeCode: 'BK1184', topicKey: '人形机器人', exactPhrases: ['人形机器人'] }, // 样本 28（与板块名全等）
  { themeCode: 'BK1184', topicKey: '机器人', exactPhrases: ['机器人'] }, // 样本 4

  // BK1193 海南自贸
  { themeCode: 'BK1193', topicKey: '海南自贸港', exactPhrases: ['海南自贸港'] }, // 样本 4
  { themeCode: 'BK1193', topicKey: '海南自贸区', exactPhrases: ['海南自贸区'] }, // 样本 3

  // BK1629 AI应用
  { themeCode: 'BK1629', topicKey: 'AI应用', exactPhrases: ['AI应用'] }, // 样本 31（与板块名全等）

  // BK1646 消费电子概念
  { themeCode: 'BK1646', topicKey: '消费电子', exactPhrases: ['消费电子'] }, // 样本 5

  // BK1660 光纤概念
  { themeCode: 'BK1660', topicKey: '光纤概念', exactPhrases: ['光纤概念'] }, // 样本 4（与板块名全等）

  // BK1753 光刻胶
  { themeCode: 'BK1753', topicKey: '光刻胶', exactPhrases: ['光刻胶'] }, // 样本 7（与板块名全等）
];

/**
 * 测试用：临时替换映射表，测完必须恢复（`setTopicAliasesForTest(TOPIC_ALIASES)` 的引用会被替换，
 * 所以调用方要自己保存原数组）。生产代码不调用它。
 */
export const setTopicAliasesForTest = (entries: TopicAliasEntry[]): TopicAliasEntry[] => {
  const previous = aliases;
  aliases = entries;
  return previous;
};

/** 当前生效的映射表（默认就是上面那张空表） */
let aliases: TopicAliasEntry[] = TOPIC_ALIASES;

/** 常见别名归一：只处理明确同义写法，不做模糊匹配 */
export const TOPIC_TEXT_ALIASES: Record<string, string> = {
  新能源汽车: '新能源车',
  储能: '储能概念',
};

const FULL_WIDTH_MAP: Record<string, string> = {
  '（': '(',
  '）': ')',
  '，': ',',
  '。': '.',
  '、': ',',
  '：': ':',
  '；': ';',
  '＋': '+',
  '－': '-',
  '％': '%',
};

/**
 * 名称/词组规范化：去空格、全角转半角、明确别名替换。
 * 不做任何模糊匹配——这是「exact 才能当强证据」这条约束的实现基础。
 */
export const normalizeTopicText = (value: string): string => {
  const halfWidth = [...value.trim()]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code === 0x3000) return ' ';
      if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
      return FULL_WIDTH_MAP[char] ?? char;
    })
    .join('');
  const compact = halfWidth.replace(/\s+/g, '');
  return TOPIC_TEXT_ALIASES[compact] ?? compact;
};

export type TopicMatch = {
  match: 'exact' | 'ambiguous';
  topicKey: string | null;
};

/**
 * 把一条原因文本解析成「题材细分逻辑」匹配结果。
 *
 * 只有在该题材已配置的 `exactPhrases` 里**全等**命中才返回 exact；
 * 其余情况返回 ambiguous（可能相关，但不足以当强证据）。
 */
export const resolveTopicMatch = (themeCode: string, text: string): TopicMatch => {
  const normalized = normalizeTopicText(text);
  if (normalized.length === 0) return { match: 'ambiguous', topicKey: null };

  for (const entry of aliases) {
    if (entry.themeCode !== themeCode) continue;
    for (const phrase of entry.exactPhrases) {
      if (normalizeTopicText(phrase) === normalized) {
        return { match: 'exact', topicKey: entry.topicKey };
      }
    }
  }

  return { match: 'ambiguous', topicKey: null };
};
