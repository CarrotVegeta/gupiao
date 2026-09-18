/**
 * 财联社板块成分股（轮动页点开一个板块看里面有哪些股票）。
 *
 * 2026-09-19 实测发现的接口：
 *   GET https://x-quote.cls.cn/v2/quote/a/plate/stocks?plate_code=cls80457
 *   → { has_core, stocks: [{ stock_code, stock_name, assoc_desc, is_core,
 *                            last_px, change, change_px, col1, col2 }] }
 *
 * 特点与限制：
 *   - **一次返回全部成员**（实测「芯片产业链」770 只、「次新股」162 只），
 *     试过 page / offset / limit / last_time 参数都无效，说明上游不分页；
 *   - 行情字段是**当前快照**，接口没有日期参数，历史日期拿不到当时的成分股与价格；
 *   - `stock_code` 前缀不统一：`920298.BJ`（北交所）/ `sz301583` / `sh688261`，
 *     所以这里统一归一成 6 位数字 + 交易所，避免前端各处再判断；
 *   - `col1` / `col2` 语义不明确（实测像是「涨停/连板标记」与「成交额」），
 *     按「未知字段」原样透出，**不在界面上编它的含义**。
 *
 * 签名与 `server/market/cls.ts` 同一套（参数按 key 排序 → SHA1 → MD5），
 * 公共参数复用同一份游客口径，不引入 token。
 */
import { createHash } from 'node:crypto';
import type { QuoteError } from '../../src/types.js';

const PLATE_STOCKS_ENDPOINT = 'https://x-quote.cls.cn/v2/quote/a/plate/stocks';
const REQUEST_TIMEOUT_MS = 15_000;

/** 财联社 App 的公共参数（无 token / uid，即游客口径）——与 market/cls.ts 保持一致 */
const BASE_PARAMS: Record<string, string> = {
  app: 'cailianpress',
  sv: '8.7.4',
  os: 'android',
  mb: 'Xiaomi-2206123SC',
  ov: '32',
  channel: '8',
  motif: '0',
  net: '',
  province_code: '3205',
  token: '',
};

/** 参数按 key 字母序拼 `k=v&k=v` → SHA1 → MD5 */
export const clsPlateSign = (params: Record<string, string>): string => {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('md5')
    .update(createHash('sha1').update(sorted, 'utf8').digest('hex'), 'utf8')
    .digest('hex');
};

const buildSignedUrl = (plateCode: string): string => {
  const params: Record<string, string> = { ...BASE_PARAMS, plate_code: plateCode };
  params.sign = clsPlateSign(params);
  return `${PLATE_STOCKS_ENDPOINT}?${new URLSearchParams(params).toString()}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const next = typeof value === 'number' ? value : Number(String(value).replace(/[,%+]/g, ''));
  return Number.isFinite(next) ? next : null;
};

/** 涨跌幅字符串 `+30.00%` / `-1.2%` → 数字（%） */
const parseChange = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = asString(value);
  if (text === '') return null;
  const match = /^([+-]?[\d.]+)%?$/.exec(text.replace(/,/g, ''));
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 把上游的 `stock_code` 归一成 6 位数字。
 * 上游混用 `920298.BJ` / `sz301583` / `sh688261` 三种写法。
 */
export const normalizeStockCode = (raw: string): string | null => {
  const match = /(\d{6})/.exec(raw);
  return match ? match[1] : null;
};

/**
 * 交易所：按代码段推断。
 *
 * **顺序要紧**：北交所有 `920xxx` 段，先判 `9` 开头会被错归到上交所——
 * 实测 `920298.BJ`（腾信精密）就被判成了 SH。所以北交所必须放在最前面。
 */
export const exchangeOf = (symbol: string): 'SH' | 'SZ' | 'BJ' => {
  if (/^(4|8|92)/.test(symbol)) return 'BJ';
  if (/^(60|68|9)/.test(symbol)) return 'SH';
  return 'SZ';
};

/** 成交额（元）：`col2` 形如 `13.8亿`；语义未确认，只在能解析时给出数值 */
export const parseAmountText = (value: unknown): number | null => {
  const text = asString(value);
  if (text === '') return null;
  const match = /^([\d.]+)\s*(亿|万)?$/.exec(text);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  // 乘完再取整到元，避免 `4.4 * 1e8` 这种浮点尾数（实测拿到 3629999999.9999995）
  if (match[2] === '亿') return Math.round(base * 1e8);
  if (match[2] === '万') return Math.round(base * 1e4);
  return Math.round(base);
};

export type PlateStock = {
  symbol: string;
  name: string;
  exchange: 'SH' | 'SZ' | 'BJ';
  /** 是否核心票（上游 `is_core`） */
  isCore: boolean;
  /** 入选理由（上游 `assoc_desc`），可能很长或是空串 */
  assocDesc: string | null;
  /** 最新价 */
  price: number | null;
  /** 涨跌幅 % */
  pct: number | null;
  /** 涨跌额 */
  changePx: number | null;
  /** 上游 `col1`，语义未确认，原样透出；界面不解释它 */
  rawCol1: string | null;
  /** 上游 `col2` 的原文（形如 `13.8亿`），语义未确认 */
  rawCol2: string | null;
  /** 由 `col2` 解析出的成交额（元），解析不出来为 null */
  amount: number | null;
};

export type PlateStocksResponse = {
  plateCode: string;
  stocks: PlateStock[];
  /** 上游是否声明有核心票（`has_core`） */
  hasCore: boolean | null;
  /** 核心票数量（由 isCore 统计，便于界面显示） */
  coreCount: number;
  fetchedAt: string;
  status: 'fresh' | 'unavailable';
  warnings: string[];
  error: QuoteError | null;
};

const mapStock = (raw: Record<string, unknown>): PlateStock | null => {
  const symbol = normalizeStockCode(asString(raw.stock_code));
  const name = asString(raw.stock_name);
  if (symbol === null || name === '') return null;
  return {
    symbol,
    name,
    exchange: exchangeOf(symbol),
    isCore: raw.is_core === 1 || raw.is_core === true,
    assocDesc: asString(raw.assoc_desc) || null,
    price: asNumber(raw.last_px),
    pct: parseChange(raw.change),
    changePx: asNumber(raw.change_px),
    rawCol1: asString(raw.col1) || null,
    rawCol2: asString(raw.col2) || null,
    amount: parseAmountText(raw.col2),
  };
};

/** 缓存：成分股在盘中会变（涨跌幅），所以只缓存很短时间 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: PlateStocksResponse; expiresAt: number }>();

/** 测试用 */
export const clearPlateStocksCache = (): void => cache.clear();

export const fetchPlateStocks = async (
  plateCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlateStocksResponse> => {
  const cached = cache.get(plateCode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fetchedAt = new Date().toISOString();
  const unavailable = (message: string, status: PlateStocksResponse['status'] = 'unavailable'): PlateStocksResponse => ({
    plateCode,
    stocks: [],
    hasCore: null,
    coreCount: 0,
    fetchedAt,
    status,
    warnings: [],
    error: { symbol: plateCode, message },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(buildSignedUrl(plateCode), {
      signal: controller.signal,
      headers: { Accept: 'application/json', Referer: 'https://www.cls.cn/' },
    });
    if (!response.ok) return unavailable(`财联社板块成分股 HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isRecord(payload)) return unavailable('财联社板块成分股响应不是对象');
    if (payload.code !== 200) {
      return unavailable(`财联社板块成分股返回 code=${String(payload.code)} ${asString(payload.msg)}`);
    }

    const data = isRecord(payload.data) ? payload.data : null;
    const rawStocks = data && Array.isArray(data.stocks) ? data.stocks : [];
    const stocks = rawStocks
      .map((raw) => (isRecord(raw) ? mapStock(raw) : null))
      .filter((stock): stock is PlateStock => stock !== null);

    const result: PlateStocksResponse = {
      plateCode,
      stocks,
      hasCore: data ? (data.has_core === 1 || data.has_core === true ? true : data.has_core === 0 ? false : null) : null,
      coreCount: stocks.filter((stock) => stock.isCore).length,
      fetchedAt,
      status: stocks.length === 0 ? 'unavailable' : 'fresh',
      warnings: [
        '成分股与行情是**当前快照**：财联社这个接口没有日期参数，历史日期拿不到当时的成分股与价格。',
        '上游一次返回全部成员（芯片产业链 770 只），不分页；`col1`/`col2` 两个字段语义未确认，界面不解释它们。',
      ],
      error: stocks.length === 0 ? { symbol: plateCode, message: '财联社返回的成分股为空' } : null,
    };
    if (result.status === 'fresh') cache.set(plateCode, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : '财联社板块成分股请求失败');
  } finally {
    clearTimeout(timer);
  }
};
