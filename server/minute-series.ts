import { asNumber, fetchWithTimeout, isRecord, toTencentSymbol } from './tencent/client.js';

/**
 * 当日分时序列（09:30~15:00 的逐分钟价），用于表格里的迷你分时图。
 *
 * ## 为什么是腾讯 `ifzq.gtimg.cn/appstock/app/minute/query`
 *
 * - **只给最近一个交易日**，正好是「当日分时图」需要的范围（历史要另外的源）
 * - 返回 `HHMM 价 累计量 累计额`，价格直接可用；实测 267 点（09:30~15:00 共 241 分钟，
 *   多出来的点是竞价/收盘相关点位）
 * - **不需要任何凭据**，与项目现有链路（`qt.gtimg.cn`）同源，回 GBK 的坑也已有现成处理
 *
 * 对比过的替代：
 * - 新浪 `CN_MarketDataService.getKLineData?scale=1`：能给 241 点，但**不支持批量**、
 *   且仓库里已有「新浪分钟K有明确限流」的记录（`scripts/fetch-sina-minute.ts` 的注释），
 *   50 只票会串行打 50 次
 * - 东财 `trends2`：竞价段口径更全（供竞价页用），但一次也只能一只，且要处理 `iscr`/`ndays` 裁切
 *
 * **注意**：上游是按「市场前缀 + 代码」寻址（`sh600519`），一个请求一只票，
 * 所以这里按 `MINUTE_CONCURRENCY` 并发抓。请求数 = 票数，这是这一列的主要成本，
 * 前端因此不该按行情轮询频率去刷分时。
 */

const MINUTE_ENDPOINT = 'https://ifzq.gtimg.cn/appstock/app/minute/query';
const REQUEST_TIMEOUT_MS = 8_000;
/** 上游单请求一只票；并发压到 6，避免把上游打到限流 */
const MINUTE_CONCURRENCY = 6;

export type MinuteSeries = {
  symbol: string;
  /** 当日昨收；分时接口不返回，由批量行情补 */
  preClose: number | null;
  /** 逐分钟收盘价（元），按时间升序 */
  points: number[];
  /** 数据时间戳（`HHMM`），与 points 一一对应 */
  times: string[];
};

/**
 * `{"data":{"sh600519":{"data":{"data":["0930 1262.99 113 14271787.32", ...]}}}}`
 * → 逐点数组。
 */
export const parseTencentMinuteSeries = (
  payload: unknown,
  symbol: string,
): { points: number[]; times: string[] } | null => {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const node = payload.data[toTencentSymbol(symbol)];
  if (!isRecord(node)) {
    return null;
  }

  const inner = node.data;
  if (!isRecord(inner)) {
    return null;
  }

  const rows = inner.data;
  if (!Array.isArray(rows)) {
    return null;
  }

  const points: number[] = [];
  const times: string[] = [];

  for (const row of rows) {
    if (typeof row !== 'string') {
      continue;
    }
    const fields = row.trim().split(/\s+/);
    if (fields.length < 2) {
      continue;
    }

    const time = fields[0];
    if (!/^\d{4}$/.test(time)) {
      continue;
    }

    const price = asNumber(fields[1]);
    if (price === null || price <= 0) {
      continue;
    }

    times.push(time);
    points.push(price);
  }

  return points.length > 0 ? { points, times } : null;
};

const fetchOne = async (
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<{ points: number[]; times: string[] } | null> => {
  const params = new URLSearchParams({ code: toTencentSymbol(symbol) });

  try {
    const response = await fetchWithTimeout(
      `${MINUTE_ENDPOINT}?${params.toString()}`,
      fetchImpl,
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    return parseTencentMinuteSeries(payload, symbol);
  } catch {
    return null;
  }
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
};

/**
 * 批量抓当日分时。单只失败（停牌、无成交、上游异常）直接跳过，
 * 由前端按「该票没有分时数据」渲染占位 —— 不拿别的票或别的时段顶替。
 *
 * `preClose` 取不到（该票不在批量行情里）时为 null，前端会退化成「只画形状、不染色」。
 */
export const fetchMinuteSeries = async (
  symbols: string[],
  preCloses: Map<string, number | null> = new Map(),
  fetchImpl: typeof fetch = fetch,
): Promise<MinuteSeries[]> => {
  if (symbols.length === 0) {
    return [];
  }

  const fetched = await mapWithConcurrency(symbols, MINUTE_CONCURRENCY, async (symbol) => {
    const series = await fetchOne(symbol, fetchImpl);
    if (series === null) {
      return null;
    }

    const preClose = preCloses.get(symbol) ?? null;
    return {
      symbol,
      preClose: preClose !== null && preClose > 0 ? preClose : null,
      points: series.points,
      times: series.times,
    } satisfies MinuteSeries;
  });

  return fetched.filter((series): series is MinuteSeries => series !== null);
};
