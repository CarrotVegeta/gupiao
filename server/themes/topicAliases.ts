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
 * 一期状态：**映射表为空**。本轮没有可核查的真实样本，宁可不配置，
 * 让所有关联落到 `membership_only` / `unknown`，也不编造精确映射。
 * 后续补录时只需往里加条目，判定逻辑与测试无需改动。
 */

export type TopicAliasEntry = {
  /** 东财板块代码，如 BK1036 */
  themeCode: string;
  /** 细分逻辑键，同题材内唯一，用于「与龙头同源逻辑」比较 */
  topicKey: string;
  /** 该细分逻辑的精确词；按规范化后的文本做全等比较 */
  exactPhrases: string[];
};

/** 一期留空：没有可核查样本就不配置，避免把通用词当成精确题材 */
export const TOPIC_ALIASES: TopicAliasEntry[] = [];

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
