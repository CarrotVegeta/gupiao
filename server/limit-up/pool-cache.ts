/**
 * 同花顺涨停池的**按交易日缓存**。
 *
 * 池子里的字段（涨停原因 / 封单额 / 开板次数 / 换手率 / 流通市值 / 首末封时间）
 * 现在有两个消费方：
 *   1. `/api/limit-up`（涨停聚焦页）—— 东财池负责「哪些票涨停」，这里补原因与封单；
 *   2. `server/themes/thsBoard.ts`（选股页「板块」档）—— 板块成员补封单 / 开板 / 换手 / 流通市值。
 *
 * 两家都按交易日取同一份快照，所以缓存放在这里共用，避免一次页面刷新打两遍上游。
 * 只缓存成功结果；失败留给下次请求重试。
 */
import { fetchLimitUpPool, type LimitUpPoolRow } from '../themes/tenjqka.js';

const CACHE_TTL_MS = 5 * 60_000;
/** 缓存上限：一次页面访问最多用到 1~2 个交易日，留些余量即可 */
const MAX_ENTRIES = 8;

type Cached = { rows: LimitUpPoolRow[]; expiresAt: number };

const cache = new Map<string, Cached>();

/** 测试用：清空缓存 */
export const clearThsPoolCache = (): void => {
  cache.clear();
};

export const getThsPoolRows = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rows: LimitUpPoolRow[]; error: string | null }> => {
  const cached = cache.get(tradeDate);
  if (cached && cached.expiresAt > Date.now()) {
    return { rows: cached.rows, error: null };
  }

  const { rows, error } = await fetchLimitUpPool(tradeDate, fetchImpl);
  if (error === null && rows.length > 0) {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(tradeDate, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
    return { rows, error: null };
  }

  return { rows, error: error?.message ?? null };
};
