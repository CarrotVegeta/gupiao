/**
 * 市场情绪指标：涨跌家数 / 涨停家数 / 炸板家数 / 晋级率
 *
 * 两个数据源：
 * * push2 的 ulist —— 沪、深两市的涨跌家数（f104=上涨、f105=下跌），加总成全市场口径
 * * push2ex 的池子接口 —— 涨停池 / 炸板池，`data.tc` 是家数，`data.pool[].c` 是代码
 *
 * 晋级率 = 今日涨停 ∩ 昨日涨停 / 昨日涨停家数，衡量赚钱效应的延续性。
 */
import type { MarketBreadth, Quote } from '../../src/types.js';

const ZT_POOL_ENDPOINT = 'https://push2ex.eastmoney.com/getTopicZTPool';
const ZB_POOL_ENDPOINT = 'https://push2ex.eastmoney.com/getTopicZBPool';
// push2 在部分网络会被上游直接断连，push2delay 是同一份数据的实时镜像（与 market/eastmoney.ts 同策略）
const MARKET_COUNT_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
] as const;
const MARKET_COUNT_PATH = '/api/qt/ulist.np/get';
// 沪市 + 深市：请求用 secid，但响应里的 f12 是不带市场前缀的 6 位代码
const MARKET_COUNT_SECIDS = ['1.000001', '0.399001'] as const;
const MARKET_COUNT_SYMBOLS = ['000001', '399001'] as const;
const MARKET_COUNT_PARAMS = new URLSearchParams({
  secids: MARKET_COUNT_SECIDS.join(','),
  fields: 'f12,f104,f105',
  fltt: '2',
}).toString();
const REQUEST_TIMEOUT_MS = 8_000;
const POOL_PAGE_SIZE = 800;
const MAX_LOOKBACK_DAYS = 10;

type PoolSnapshot = {
  total: number | null;
  codes: Set<string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const next = Number(value);
    return Number.isFinite(next) ? Math.trunc(next) : null;
  }
  return null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const dateDaysBefore = (tradeDate: string, days: number): string => {
  const date = new Date(
    Date.UTC(
      Number(tradeDate.slice(0, 4)),
      Number(tradeDate.slice(4, 6)) - 1,
      Number(tradeDate.slice(6, 8)),
    ),
  );
  date.setUTCDate(date.getUTCDate() - days);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
};

const isWeekend = (tradeDate: string): boolean => {
  const date = new Date(
    Date.UTC(
      Number(tradeDate.slice(0, 4)),
      Number(tradeDate.slice(4, 6)) - 1,
      Number(tradeDate.slice(6, 8)),
    ),
  );
  const day = date.getUTCDay();
  return day === 0 || day === 6;
};

/** 拉一次池子：拿到总家数和代码集合；失败返回 null，由调用方降级 */
const fetchPool = async (
  endpoint: string,
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<PoolSnapshot | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      ut: '7eea3edcaed734bea9cbfc24409ed989',
      dpt: 'wz.ztzt',
      sort: 'fbt:asc',
      date: tradeDate,
      pagesize: String(POOL_PAGE_SIZE),
      Pageindex: '0',
    });
    const response = await fetchImpl(`${endpoint}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    if (!data) {
      return null;
    }

    const codes = new Set<string>();
    if (Array.isArray(data.pool)) {
      for (const row of data.pool) {
        if (isRecord(row) && typeof row.c === 'string' && /^\d{6}$/.test(row.c)) {
          codes.add(row.c);
        }
      }
    }

    const total = asInteger(data.tc);
    return { total: total !== null && total >= 0 ? total : codes.size, codes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** 往前找最近一个有涨停数据的交易日，用于算晋级率 */
const findPreviousPool = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<{ date: string; snapshot: PoolSnapshot } | null> => {
  for (let daysBefore = 1; daysBefore <= MAX_LOOKBACK_DAYS; daysBefore += 1) {
    const candidate = dateDaysBefore(tradeDate, daysBefore);
    if (isWeekend(candidate)) {
      continue;
    }
    const snapshot = await fetchPool(ZT_POOL_ENDPOINT, candidate, fetchImpl);
    if (snapshot && snapshot.codes.size > 0) {
      return { date: candidate, snapshot };
    }
  }
  return null;
};

const unavailable = (
  tradeDate: string | null,
  status: Quote['status'],
): MarketBreadth => ({
  tradeDate,
  previousTradeDate: null,
  limitUpCount: null,
  brokenCount: null,
  promotionRate: null,
  riseCount: null,
  fallCount: null,
  status,
});

/** 沪深两市涨跌家数：push2 的 ulist 里，f104=上涨家数、f105=下跌家数 */
export const fetchRiseFallCounts = async (
  fetchImpl: typeof fetch,
): Promise<{ riseCount: number; fallCount: number } | null> => {
  for (const host of MARKET_COUNT_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(`${host}${MARKET_COUNT_PATH}?${MARKET_COUNT_PARAMS}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        continue;
      }

      const payload: unknown = await response.json();
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const rows = data && Array.isArray(data.diff) ? data.diff : null;
      if (!rows || rows.length === 0) {
        continue;
      }

      // 只认有完整涨跌家数的行；沪、深两市都到齐才加总，缺一边宁可不出数
      const seen = new Set<string>();
      let riseCount = 0;
      let fallCount = 0;
      for (const row of rows) {
        if (!isRecord(row)) {
          continue;
        }
        const symbol = asString(row.f12);
        if (!(MARKET_COUNT_SYMBOLS as readonly string[]).includes(symbol) || seen.has(symbol)) {
          continue;
        }
        const rise = asInteger(row.f104);
        const fall = asInteger(row.f105);
        if (rise === null || fall === null || rise < 0 || fall < 0) {
          continue;
        }
        seen.add(symbol);
        riseCount += rise;
        fallCount += fall;
      }

      if (seen.size < MARKET_COUNT_SYMBOLS.length) {
        continue;
      }

      return { riseCount, fallCount };
    } catch {
      // 换下一个镜像/主站
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
};

export const fetchMarketBreadth = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketBreadth> => {
  const [todayPool, brokenPool, counts] = await Promise.all([
    fetchPool(ZT_POOL_ENDPOINT, tradeDate, fetchImpl),
    fetchPool(ZB_POOL_ENDPOINT, tradeDate, fetchImpl),
    fetchRiseFallCounts(fetchImpl),
  ]);

  if (!todayPool && !brokenPool && !counts) {
    return unavailable(tradeDate, 'unavailable');
  }

  const previous = await findPreviousPool(tradeDate, fetchImpl);

  let promotionRate: number | null = null;
  if (previous && previous.snapshot.total !== null && previous.snapshot.total > 0) {
    let carried = 0;
    for (const code of todayPool?.codes ?? []) {
      if (previous.snapshot.codes.has(code)) {
        carried += 1;
      }
    }
    promotionRate = (carried / previous.snapshot.total) * 100;
  }

  return {
    tradeDate,
    previousTradeDate: previous?.date ?? null,
    limitUpCount: todayPool?.total ?? null,
    brokenCount: brokenPool?.total ?? null,
    promotionRate,
    riseCount: counts?.riseCount ?? null,
    fallCount: counts?.fallCount ?? null,
    status: todayPool || brokenPool || counts ? 'fresh' : 'stale',
  };
};
