/**
 * 腾讯行情公共客户端（qt.gtimg.cn）
 *
 * 抽这一层的原因：
 * 1. `qt.gtimg.cn` 返回 **GBK**，用 `response.text()` 会把股票名解成乱码，必须走 arrayBuffer + TextDecoder('gbk')
 * 2. 「按代码批量取字段数组」在行情、自选、竞价三处都要用，字段下标只能有一份定义
 *
 * gtimg 返回的 `~` 分隔字段（共 88 项）常用下标：
 *   [1] 名称  [2] 代码  [3] 现价  [4] 昨收  [5] 今开
 *   [30] 时间 YYYYMMDDHHMMSS  [31] 涨跌额  [32] 涨跌幅%
 *   [33] 最高  [34] 最低  [38] 换手率%  [44] 流通市值(亿)  [45] 总市值(亿)
 *   [47] 涨停价  [48] 跌停价  [49] 量比  [51] 均价
 */
export const TENCENT_QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q=';

/** 一次批量请求的代码数量上限，实测 50 只在各网络下都稳定 */
export const TENCENT_QUOTE_BATCH_SIZE = 50;

export const TENCENT_FIELD = {
  name: 1,
  symbol: 2,
  price: 3,
  preClose: 4,
  open: 5,
  updatedAt: 30,
  change: 31,
  pct: 32,
  high: 33,
  low: 34,
  turnover: 38,
  amount: 37,
  floatMarketCap: 44,
  totalMarketCap: 45,
  limitUpPrice: 47,
  limitDownPrice: 48,
  volumeRatio: 49,
  averagePrice: 51,
} as const;

/** 字段数少于此值说明上游返回的是残缺/占位行，直接丢弃 */
const MIN_FIELD_COUNT = 50;

const DEFAULT_TIMEOUT_MS = 8_000;

export const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = typeof value === 'number' ? value : String(value).trim();
  if (raw === '' || raw === '-' || raw === '--') {
    return null;
  }

  const next = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(next) ? next : null;
};

/** 6 开头 → 沪市，0/3 开头 → 深市，其余（4/8/92）→ 北交所 */
export const toTencentSymbol = (symbol: string): string => {
  if (symbol.startsWith('6')) {
    return `sh${symbol}`;
  }

  return symbol.startsWith('0') || symbol.startsWith('3') ? `sz${symbol}` : `bj${symbol}`;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const fetchWithTimeout = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * `v_sh600519="1~贵州茅台~600519~..."` → Map('sh600519' → 字段数组)
 *
 * 键用「市场前缀 + 代码」而不是 6 位代码：000001 既是上证指数(sh000001)又是平安银行(sz000001)，
 * 只靠 6 位代码会串行。
 */
export const parseTencentQuoteLines = (text: string): Map<string, string[]> => {
  const rows = new Map<string, string[]>();

  for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/gi)) {
    const code = match[1]?.toLowerCase();
    const fields = match[2]?.split('~') ?? [];
    if (!code || fields.length < MIN_FIELD_COUNT) {
      continue;
    }

    rows.set(code, fields);
  }

  return rows;
};

/**
 * 批量拉取行情字段。整批失败只跳过该批，返回已拿到的部分——
 * 缺哪些代码由调用方按「请求列表 - 返回列表」判断，进而决定是否切备用源。
 */
export const fetchTencentQuoteFields = async (
  codes: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string[]>> => {
  const rows = new Map<string, string[]>();

  for (let offset = 0; offset < codes.length; offset += TENCENT_QUOTE_BATCH_SIZE) {
    const batch = codes.slice(offset, offset + TENCENT_QUOTE_BATCH_SIZE).join(',');
    try {
      const response = await fetchWithTimeout(`${TENCENT_QUOTE_ENDPOINT}${batch}`, fetchImpl);
      if (!response.ok) {
        continue;
      }

      const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
      for (const [code, fields] of parseTencentQuoteLines(text)) {
        rows.set(code, fields);
      }
    } catch {
      // 传输失败：跳过该批，由调用方兜底
    }
  }

  return rows;
};

/** `20260917142547` → ISO 时间串（北京时间） */
export const parseTencentTime = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!/^\d{14}$/.test(raw)) {
    return null;
  }

  const year = Number(raw.slice(0, 4));
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  const hour = raw.slice(8, 10);
  const minute = raw.slice(10, 12);
  const second = raw.slice(12, 14);
  const next = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);

  return Number.isNaN(next.getTime()) ? null : next.toISOString();
};
