/**
 * L2 · 从板块里找题材（设计稿 §3）。
 *
 * 题材的单位是**涨停原因标签**，不是板块名。六步：
 *   ① 锚定集合：板块当日涨停股（只有涨停股才有涨停原因，这是数据事实）
 *   ② 标签展开：`reason_type` 按 + 、 / 拆开
 *   ③ 通用词过滤：业绩/增长/定增/回购… 不说明「在炒什么」
 *   ④ 同义归一：存储芯片/半导体存储 → 存储（不做这步题材会被拆碎）
 *   ⑤ 计家数：同一只票同一标签只算一次
 *   ⑥ 成题门槛：cnt ≥ 2
 *
 * 实测依据（设计稿 §12.2）：不做归一，「国产芯片」10 只涨停股最大题材只有
 * `先进封装 2 家`，其余各 1 家，看起来「没有题材」；归一后 3~4 条各 2 家。
 *
 * 本文件是纯函数，不碰网络。
 */
import type { ThemeTag } from './types.js';

/** 通用词（设计稿 §7.2）：用子串包含判定，所以词要写得足够具体 */
export const GENERIC_TOPIC_WORDS: string[] = [
  // 业绩口径
  '业绩', '增长', '扭亏', '预增', '预减', '减亏', '收窄', '扣非', '净利', '营收',
  '半年报', '中报', '年报', '季报', '高增', '改善', '暴增', '预盈', '预亏',
  // 资金与股东行为
  '回购', '增持', '减持', '股权激励', '员工持股', '举牌', '解禁', '质押', '分红',
  '定增', '可转债', '转债', '配股', '募投', '募资',
  // 公司行为 / 事件
  '控制权', '控股股东', '实控人', '股权转让', '协议转让', '溢价转让', '股权收购',
  '资产收购', '资产重组', '资产剥离', '重大重组', '并购重组', '重组', '重整',
  '摘帽', '风险澄清', '异常波动', '复牌', '停牌', '拟收购', '拟投资', '拟购',
  '拟参投', '战略入股', '参股', '增资', '设立', '成立', '产业基金', '项目投资',
  '投资', '合作', '签约', '中标', '订单', '产能', '扩产', '投产',
  '量产', '销量', '产量', '价格', '涨价', '提价', '降价',
  // 泛指 / 统计属性
  '次新', '题材股', '趋势股', '高送转', '指数', '板块', '国资改革',
];

/**
 * 同义归一表（设计稿 §7.3）。
 *
 * 只收**能在涨停池样本里核查到**的同义词，不靠语义猜（沿用项目
 * `server/themes/topicAliases.ts` 的采信规则）。新增条目要附样本依据。
 */
export const THEME_SYNONYMS: Array<{ key: string; phrases: string[] }> = [
  {
    key: '存储',
    phrases: ['存储芯片', '半导体存储', '存储', '高带宽内存', 'HBM', '内存接口芯片'],
  },
  {
    key: '先进封装',
    phrases: ['先进封装', '半导体封测', '封测', 'CoWoS', '封装测试', '封装材料'],
  },
  {
    key: '芯片扩产',
    phrases: ['芯片扩产', '产能扩张', '产能释放', '晶圆扩产', '扩产'],
  },
  {
    key: '半导体设备',
    phrases: ['半导体设备', '半导体洁净室', '光刻机', '光刻胶', '半导体材料'],
  },
  {
    key: '光通信',
    phrases: ['光通信', '光模块', '800G交换机', '高速光模块', 'CPO', '硅光'],
  },
  {
    key: '算力',
    phrases: ['算力', '算力基础设施', '算力集成', '算力租赁', 'AI算力', '智算中心'],
  },
  {
    key: '人形机器人',
    phrases: ['人形机器人', '机器人结构件', '机器人关节', '灵巧手', '谐波减速器'],
  },
  {
    key: '固态电池',
    phrases: ['固态电池', '半固态电池', '硫化物电解质', '固态电解质'],
  },
  {
    key: '商业航天',
    phrases: ['商业航天', '卫星互联网', '低轨卫星', '火箭发射', '卫星制造'],
  },
  {
    key: '低空经济',
    phrases: ['低空经济', 'eVTOL', '无人机', '飞行汽车'],
  },
];

/** 归一 key → 该 key 下的所有原始写法（含 key 自己） */
const SYNONYM_INDEX: Map<string, string> = (() => {
  const index = new Map<string, string>();
  for (const entry of THEME_SYNONYMS) {
    for (const phrase of entry.phrases) index.set(phrase, entry.key);
  }
  return index;
})();

/**
 * 规范化为用于比较的文本：去空白、全角转半角、小写。
 * 不做去括号等激进处理——「数据中心(AIDC)」和「数据中心」在题材层是两件事。
 */
export const normalizeTag = (raw: string): string =>
  raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase();

/** 是否通用词（不构成题材） */
export const isGenericTag = (tag: string): boolean => {
  const normalized = normalizeTag(tag);
  return GENERIC_TOPIC_WORDS.some((word) => normalized.includes(normalizeTag(word)));
};

/**
 * 把原始标签归一到题材 key。
 *
 * **顺序很关键**：先查同义表，再判通用词。
 * 反例（实测踩到）：「产能扩张」含通用词「扩产」，若先判通用词就会被丢掉，
 * 于是归一表里的「芯片扩产」永远聚不起来——人工核查过的同义表是更强的证据，
 * 必须优先于机械的子串规则。
 *
 * 通用词返回 null（调用方直接丢弃）；长度异常的也丢弃。
 */
export const toThemeKey = (raw: string): string | null => {
  const normalized = normalizeTag(raw);
  if (normalized.length < 2 || normalized.length > 20) return null;

  const mapped = SYNONYM_INDEX.get(normalized);
  if (mapped !== undefined) return mapped;

  if (isGenericTag(normalized)) return null;
  return normalized;
};

/** 输入：一只涨停股的题材要素 */
export type ThemeMemberInput = {
  symbol: string;
  name: string;
  boardCount: number;
  highLabel: string | null;
  /** 原始涨停原因标签（未过滤、未归一） */
  reasonTags: string[];
};

export type ExtractOptions = {
  /** 成题门槛，默认 2（1 家只是个股故事） */
  minCount?: number;
  /** 上一交易日的题材 key 集合，用于算「连续出现天数」 */
  previousKeys?: Set<string>;
};

/**
 * 从一个板块的涨停成员里提取题材。
 *
 * 只做「板块内」这一层的判定；跨板块扩散与全市场家数由调用方在拿到所有板块的
 * 结果后回填（见 `annotateSpread`）。
 */
export const extractThemes = (
  members: ThemeMemberInput[],
  options: ExtractOptions = {},
): ThemeTag[] => {
  const minCount = options.minCount ?? 2;

  const buckets = new Map<
    string,
    {
      variants: Map<string, number>;
      members: ThemeMemberInput[];
    }
  >();

  for (const member of members) {
    const seenKeys = new Set<string>();
    for (const raw of member.reasonTags) {
      const key = toThemeKey(raw);
      if (key === null || seenKeys.has(key)) continue;
      seenKeys.add(key);

      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = { variants: new Map<string, number>(), members: [] };
        buckets.set(key, bucket);
      }

      const rawTrimmed = raw.trim();
      bucket.variants.set(rawTrimmed, (bucket.variants.get(rawTrimmed) ?? 0) + 1);
      bucket.members.push(member);
    }
  }

  const themes: ThemeTag[] = [];
  for (const [key, bucket] of buckets) {
    const count = bucket.members.length;
    if (count < minCount) continue;
    const variants = [...bucket.variants.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    const maxBoard = Math.max(...bucket.members.map((member) => member.boardCount));
    themes.push({
      key,
      display: variants[0] ?? key,
      variants,
      count,
      members: bucket.members.map((member) => ({
        symbol: member.symbol,
        name: member.name,
        boardCount: member.boardCount,
        highLabel: member.highLabel,
      })),
      maxBoard,
      outOfBoardRatio: null,
      marketCount: null,
      streak: options.previousKeys?.has(key) ? 2 : 1,
      boardSpread: 1,
    });
  }

  // 排序：家数 → 最高板 → key（稳定）
  themes.sort(
    (a, b) => b.count - a.count || b.maxBoard - a.maxBoard || a.key.localeCompare(b.key),
  );
  return themes;
};

/**
 * 跨板块扩散 + 全市场家数回填（设计稿 §3.3）。
 *
 * 输入是「板块 code → 该板块提取出的题材」，输出会就地补上：
 *   - `marketCount`：该 key 当日出现在多少个板块的题材里（家数口径的近似下界）
 *   - `boardSpread`：出现该 key 的板块数
 *   - `outOfBoardRatio`：(marketCount − 本板块贡献) / marketCount，本板块贡献按 1 计
 *
 * 注意：这里用的是「跨板块出现次数」，不是真实的股票家数（那需要全市场成分股）。
 * 所以 `outOfBoardRatio` 的语义是「这条逻辑有多少板块在炒」，不是「多少只票在炒」，
 * 面板上必须按这个语义披露。
 */
export const annotateSpread = (byBoard: Map<string, ThemeTag[]>): void => {
  const boardCountByKey = new Map<string, number>();
  for (const themes of byBoard.values()) {
    for (const theme of themes) {
      boardCountByKey.set(theme.key, (boardCountByKey.get(theme.key) ?? 0) + 1);
    }
  }

  for (const themes of byBoard.values()) {
    for (const theme of themes) {
      const spread = boardCountByKey.get(theme.key) ?? 1;
      theme.boardSpread = spread;
      theme.marketCount = spread;
      theme.outOfBoardRatio = spread <= 1 ? 0 : (spread - 1) / spread;
    }
  }
};

/**
 * 题材的连续性（设计稿 §3.8.4）：同一 key 连续多少个交易日在**同一个板块内** cnt ≥ 2。
 *
 * `history` 按日升序，每个元素是该板块当日提取出的题材 key 集合。
 */
export const themeStreak = (history: Array<Set<string>>, key: string): number => {
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!history[index].has(key)) break;
    streak += 1;
  }
  return streak;
};
