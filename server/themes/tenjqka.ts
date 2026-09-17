/**
 * 选股页的同花顺适配器（`data.10jqka.com.cn` / `d.10jqka.com.cn`）。
 *
 * 实测 2026-09-17：无需 cookie，**且支持历史日期**（`date` 参数），所以既能做线上也能做回测。
 *
 * 提供的四类数据：
 *   1. 涨停池 `limit_up_pool` —— 涨停原因、封板类型、开板次数、封单额、换手率、流通市值、分时序列
 *   2. 板块排行 `block_top` —— 涨停家数、连板家数、最高板、持续天数、板块成员（**固定 Top 20，参数无效**）
 *   3. 板块日K `d.10jqka.com.cn/v6/line/bk_XXXXXX/01/last.js` —— 含成交额，用于「成交额连续放大」
 *   4. 个股日K `d.10jqka.com.cn/v6/line/hs_XXXXXX/01/last.js` —— 含成交额与换手率
 *
 * 注意：`block_top` 只给 Top 20 板块，2~4 只涨停的支线题材不在其中，
 * 所以「涨停家数」是自算的（涨停股 × 东财 F10 题材归属），`block_top` 只用来
 * ① 交叉验证 ② 拿到同花顺板块代码去取板块日K。
 */
import type { QuoteError } from '../../src/types.js';

const REQUEST_TIMEOUT_MS = 12_000;
const POOL_PAGE_SIZE = 100;
const POOL_MAX_PAGES = 6;
const KLINE_DAYS = 90;

const POOL_ENDPOINT = 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool';
const BLOCK_TOP_ENDPOINT = 'https://data.10jqka.com.cn/dataapi/limit_up/block_top';
const KLINE_ENDPOINT = 'https://d.10jqka.com.cn/v6/line';

const POOL_FIELDS =
  '199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const fetchText = async (url: string, fetchImpl: typeof fetch): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://data.10jqka.com.cn/',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 上游时间戳是 epoch 秒，转成东八区 HH:mm:ss。
 * 实测 2026-09-17 的时间戳解析正确（1789624827 → 13:20:27）。
 */
export const toSealTime = (value: unknown): string | null => {
  const seconds = asNumber(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date((seconds + 8 * 3600) * 1000);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

/** 「3天2板」→ 2，「首板」→ 1，解析不出来返回 null */
export const parseBoardCount = (label: string | null): number | null => {
  if (!label) return null;
  const match = label.match(/(\d+)\s*板/);
  if (match) return Number(match[1]);
  return label.includes('首板') ? 1 : null;
};

/** 涨停原因字符串「风电铸件+风电轴承+半年报增长」→ 标签数组 */
export const splitReasonTags = (value: unknown): string[] =>
  asString(value)
    .split(/[+＋、,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 20);

// ---------------------------------------------------------------------------
// 一、涨停池
// ---------------------------------------------------------------------------

export type LimitUpPoolRow = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  boardCount: number | null;
  /** 原样保留「3天2板」 */
  highLabel: string | null;
  firstSealTime: string | null;
  lastSealTime: string | null;
  /** 换手板 / 一字板 / T字板 */
  sealType: string | null;
  /** 开板次数 */
  openCount: number | null;
  /** 封单额（元） */
  sealAmount: number | null;
  /** 流通市值（元） */
  floatMarketCap: number | null;
  turnoverRate: number | null;
  reasonTags: string[];
  /** 分时涨跌幅序列（约 80 个点） */
  intraday: number[];
};

const mapPoolRow = (raw: Record<string, unknown>): LimitUpPoolRow | null => {
  const symbol = String(raw.code ?? '').trim();
  const name = asString(raw.name);
  if (!/^\d{6}$/.test(symbol) || !name) return null;

  const highLabel = asString(raw.high_days) || null;

  return {
    symbol,
    name,
    price: asNumber(raw.latest),
    pct: asNumber(raw.change_rate),
    boardCount: parseBoardCount(highLabel),
    highLabel,
    firstSealTime: toSealTime(raw.first_limit_up_time),
    lastSealTime: toSealTime(raw.last_limit_up_time),
    sealType: asString(raw.limit_up_type) || null,
    openCount: asNumber(raw.open_num),
    sealAmount: asNumber(raw.order_amount),
    floatMarketCap: asNumber(raw.currency_value),
    turnoverRate: asNumber(raw.turnover_rate),
    reasonTags: splitReasonTags(raw.reason_type),
    intraday: Array.isArray(raw.time_preview)
      ? raw.time_preview.map((value) => asNumber(value)).filter((value): value is number => value !== null)
      : [],
  };
};

/** 拉取某个交易日的涨停池（支持历史日期） */
export const fetchLimitUpPool = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rows: LimitUpPoolRow[]; error: QuoteError | null }> => {
  const rows: LimitUpPoolRow[] = [];
  const seen = new Set<string>();

  try {
    for (let page = 1; page <= POOL_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(POOL_PAGE_SIZE),
        field: POOL_FIELDS,
        filter: 'HS,GEM2STAR',
        order_field: '330324',
        order_type: '0',
        date: tradeDate,
      });

      const payload: unknown = JSON.parse(await fetchText(`${POOL_ENDPOINT}?${params.toString()}`, fetchImpl));
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const info = data && Array.isArray(data.info) ? data.info : [];
      const total = data && isRecord(data.page) ? asNumber(data.page.total) ?? 0 : 0;

      for (const raw of info) {
        if (!isRecord(raw)) continue;
        const row = mapPoolRow(raw);
        if (!row || seen.has(row.symbol)) continue;
        seen.add(row.symbol);
        rows.push(row);
      }

      if (info.length < POOL_PAGE_SIZE || rows.length >= total) break;
    }

    return { rows, error: null };
  } catch (error) {
    return {
      rows,
      error: {
        symbol: tradeDate,
        message: error instanceof Error ? error.message : '同花顺涨停池请求失败',
      },
    };
  }
};

// ---------------------------------------------------------------------------
// 二、板块排行（Top 20）
// ---------------------------------------------------------------------------

export type BlockTopRow = {
  /** 同花顺板块代码，如 885431 */
  code: string;
  name: string;
  pct: number | null;
  limitUpCount: number | null;
  continuousCount: number | null;
  /** 原样保留「8天5板」 */
  highLabel: string | null;
  /** 上游给的持续天数（语义不完全明确，只作参考） */
  days: number | null;
  memberSymbols: string[];
};

const mapBlockTopRow = (raw: Record<string, unknown>): BlockTopRow | null => {
  const code = String(raw.code ?? '').trim();
  const name = asString(raw.name);
  if (!/^\d{5,6}$/.test(code) || !name) return null;

  const stocks = Array.isArray(raw.stock_list) ? raw.stock_list : [];
  const memberSymbols = stocks
    .map((item) => (isRecord(item) ? String(item.code ?? '').trim() : ''))
    .filter((symbol) => /^\d{6}$/.test(symbol));

  return {
    code,
    name,
    pct: asNumber(raw.change),
    limitUpCount: asNumber(raw.limit_up_num),
    continuousCount: asNumber(raw.continuous_plate_num),
    highLabel: asString(raw.high) || null,
    days: asNumber(raw.days),
    memberSymbols,
  };
};

/** 拉取涨停板块排行（上游固定返回 Top 20，参数无效） */
export const fetchBlockTop = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rows: BlockTopRow[]; error: QuoteError | null }> => {
  try {
    const params = new URLSearchParams({ filter: 'HS,GEM2STAR', date: tradeDate });
    const payload: unknown = JSON.parse(
      await fetchText(`${BLOCK_TOP_ENDPOINT}?${params.toString()}`, fetchImpl),
    );
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const rows = data
      .map((raw) => (isRecord(raw) ? mapBlockTopRow(raw) : null))
      .filter((row): row is BlockTopRow => row !== null);
    return { rows, error: null };
  } catch (error) {
    return {
      rows: [],
      error: {
        symbol: tradeDate,
        message: error instanceof Error ? error.message : '同花顺板块排行请求失败',
      },
    };
  }
};

// ---------------------------------------------------------------------------
// 三、日K（板块 / 个股），带磁盘无关的内存缓存
// ---------------------------------------------------------------------------

export type KlineBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 成交额（元）；同花顺给的是精确值 */
  amount: number | null;
  /** 换手率（%） */
  turnoverRate: number | null;
};

const parseJsonp = (text: string): Record<string, unknown> | null => {
  const match = text.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * 解析同花顺的日K字符串。
 * 板块行：date,open,high,low,close,volume(股),amount(元)
 * 个股行：date,open,high,low,close,volume(股),amount(元),换手率(%),...
 */
const parseKlineRows = (data: unknown): KlineBar[] => {
  if (typeof data !== 'string' || data.length === 0) return [];
  return data
    .split(';')
    .map((line) => line.split(','))
    .filter((parts) => parts.length >= 6 && /^\d{8}$/.test(parts[0]?.trim() ?? ''))
    .map((parts) => ({
      date: parts[0].trim(),
      open: Number(parts[1]),
      high: Number(parts[2]),
      low: Number(parts[3]),
      close: Number(parts[4]),
      volume: Number(parts[5]),
      amount: parts[6] === undefined ? null : Number(parts[6]),
      turnoverRate: parts[7] === undefined ? null : Number(parts[7]),
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({
      ...bar,
      amount: bar.amount !== null && Number.isFinite(bar.amount) ? bar.amount : null,
      turnoverRate:
        bar.turnoverRate !== null && Number.isFinite(bar.turnoverRate) ? bar.turnoverRate : null,
    }));
};

const klineCache = new Map<string, { bars: KlineBar[]; expiresAt: number }>();
const KLINE_TTL_MS = 10 * 60 * 1000;

export const clearThemeKlineCache = (): void => klineCache.clear();

const fetchKline = async (path: string, fetchImpl: typeof fetch): Promise<KlineBar[]> => {
  const cached = klineCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.bars;

  try {
    const text = await fetchText(`${KLINE_ENDPOINT}/${path}/01/last.js`, fetchImpl);
    const parsed = parseJsonp(text);
    const bars = parseKlineRows(parsed?.data).slice(-KLINE_DAYS);
    if (bars.length > 0) klineCache.set(path, { bars, expiresAt: Date.now() + KLINE_TTL_MS });
    return bars;
  } catch {
    return [];
  }
};

/** 板块日K（含成交额） */
export const fetchBoardKline = (
  boardCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KlineBar[]> => fetchKline(`bk_${boardCode}`, fetchImpl);

/** 个股日K（含成交额与换手率） */
export const fetchStockKline = (
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KlineBar[]> => fetchKline(`hs_${symbol}`, fetchImpl);
