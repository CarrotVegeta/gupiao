/**
 * 主线引擎 · 同花顺取数层（只用同花顺，设计稿 §9）。
 *
 * 接口清单（全部实测，见 `docs/mainline-engine-design.md` §9）：
 *   block_top       涨停板块排行    固定 Top 20，支持历史日期（最早 2025-09-03）
 *   limit_up_pool   涨停池          含涨停原因 / 连板 / 封板字段，支持历史日期
 *   realhead        板块实时行情    含 19 成交额、527198 主力净流入、271 涨停家数
 *   line/bk_xxx/年  板块年度日K     含成交额，可回溯至板块上市
 *
 * **资金流（527198）没有历史接口**：`realhead` 只能取当前，年度日K 里没有资金流列。
 * 所以历史快照里 `mainNet` 一律为 null，回测必须走降级口径（见 `continuity.ts`）。
 */
import { parseJsonp } from '../themes/tenjqka.js';
import type { QuoteError } from '../../src/types.js';
import type { BoardRealtime } from './types.js';

const TIMEOUT_MS = 12_000;

const HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://data.10jqka.com.cn/',
};

const KLINE_HEADERS: Record<string, string> = {
  ...HEADERS,
  Referer: 'https://q.10jqka.com.cn/',
};

/**
 * `realhead` 的字段编号（实测确认，见设计稿 §10.1）。
 * 同花顺用数字编号做字段名，这里集中映射，不散落在各处。
 */
const REALTIME_FIELD = {
  /** 成交额（元） */
  amount: '19',
  /** 涨跌幅 % */
  pct: '199112',
  /** 主力净流入（元） */
  mainNet: '527198',
  /** 涨停家数（同花顺口径） */
  limitUpCount: '271',
  riseCount: '37',
  fallCount: '38',
  flatCount: '39',
} as const;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const fetchText = async (url: string, fetchImpl: typeof fetch, headers = HEADERS): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 板块实时行情。
 *
 * 注意：部分板块会返回 502/504（实测 25 个抽样里 20 个可用），
 * 所以这是**可失败**的调用，调用方必须容忍 null。
 */
export const fetchBoardRealtime = async (
  boardCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ realtime: BoardRealtime | null; error: QuoteError | null }> => {
  try {
    const text = await fetchText(`https://d.10jqka.com.cn/v6/realhead/bk_${boardCode}/last.js`, fetchImpl);
    const parsed = parseJsonp(text);
    const items = parsed?.items;
    if (!items || typeof items !== 'object') {
      return { realtime: null, error: { symbol: boardCode, message: 'realhead 响应缺少 items' } };
    }
    const record = items as Record<string, unknown>;
    return {
      realtime: {
        code: String(record['5'] ?? boardCode),
        name: typeof record.name === 'string' ? record.name : '',
        amount: asNumber(record[REALTIME_FIELD.amount]),
        pct: asNumber(record[REALTIME_FIELD.pct]),
        mainNet: asNumber(record[REALTIME_FIELD.mainNet]),
        limitUpCount: asNumber(record[REALTIME_FIELD.limitUpCount]),
        riseCount: asNumber(record[REALTIME_FIELD.riseCount]),
        fallCount: asNumber(record[REALTIME_FIELD.fallCount]),
        flatCount: asNumber(record[REALTIME_FIELD.flatCount]),
      },
      error: null,
    };
  } catch (error) {
    return {
      realtime: null,
      error: {
        symbol: boardCode,
        message: error instanceof Error ? error.message : '同花顺板块实时行情请求失败',
      },
    };
  }
};

export type BoardYearBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number | null;
};

/**
 * 板块某一年的日K（`/v6/line/bk_XXXXXX/01/YYYY.js`）。
 *
 * 实测格式：`date,open,high,low,close,volume(股),amount(元),,,,,0`（11 列），
 * 每年约 243 个交易日，可回溯到板块上市那一年。
 */
export const fetchBoardYearKline = async (
  boardCode: string,
  year: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bars: BoardYearBar[]; error: QuoteError | null }> => {
  try {
    const text = await fetchText(
      `https://d.10jqka.com.cn/v6/line/bk_${boardCode}/01/${year}.js`,
      fetchImpl,
      KLINE_HEADERS,
    );
    const parsed = parseJsonp(text);
    const data = typeof parsed?.data === 'string' ? parsed.data : '';
    const bars = data
      .split(';')
      .map((line) => line.split(','))
      .filter((parts) => /^\d{8}$/.test(parts[0]?.trim() ?? '') && parts.length >= 6)
      .map((parts) => ({
        date: parts[0].trim(),
        open: Number(parts[1]),
        high: Number(parts[2]),
        low: Number(parts[3]),
        close: Number(parts[4]),
        volume: Number(parts[5]),
        amount: parts[6] === undefined || parts[6] === '' ? null : Number(parts[6]),
      }))
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0 && Number.isFinite(bar.open));
    return { bars, error: null };
  } catch (error) {
    return {
      bars: [],
      error: {
        symbol: `${boardCode}/${year}`,
        message: error instanceof Error ? error.message : '同花顺板块年度日K请求失败',
      },
    };
  }
};

/** 取多个年份并合并（按日期升序）。失败的年份跳过并记录错误。 */
export const fetchBoardKlineRange = async (
  boardCode: string,
  years: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ bars: BoardYearBar[]; errors: QuoteError[] }> => {
  const errors: QuoteError[] = [];
  const bars: BoardYearBar[] = [];
  for (const year of years) {
    const result = await fetchBoardYearKline(boardCode, year, fetchImpl);
    if (result.error) errors.push(result.error);
    bars.push(...result.bars);
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return { bars, errors };
};

/** 日K 里某一天的成交额（元） */
export const amountOn = (bars: BoardYearBar[], date: string): number | null =>
  bars.find((bar) => bar.date === date)?.amount ?? null;
