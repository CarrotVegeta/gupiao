import type { AuctionResponse } from '../../src/types.js';

/**
 * 09:25 竞价快照在当天是固定的，但一次请求要打 80~90 个上游接口。
 * 短时缓存既避免重复刷新把上游打到限流（限流会让量能项缺失、评分档位跳变），
 * 也保证同一时间窗内多次刷新看到的是同一份判定结果。
 */
export const AUCTION_CACHE_TTL_MS = 5 * 60 * 1000;
export const AUCTION_CACHE_MAX_ENTRIES = 6;

export type AuctionCache = {
  get: (tradeDate: string) => AuctionResponse | null;
  set: (tradeDate: string, body: AuctionResponse) => void;
  size: () => number;
};

export const createAuctionCache = (
  ttlMs: number = AUCTION_CACHE_TTL_MS,
  maxEntries: number = AUCTION_CACHE_MAX_ENTRIES,
): AuctionCache => {
  const store = new Map<string, { body: AuctionResponse; expiresAt: number }>();

  const prune = (): void => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  };

  return {
    get(tradeDate) {
      const entry = store.get(tradeDate);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt <= Date.now()) {
        store.delete(tradeDate);
        return null;
      }
      return entry.body;
    },
    set(tradeDate, body) {
      prune();
      while (store.size >= maxEntries) {
        const oldest = store.keys().next();
        if (oldest.done) {
          break;
        }
        store.delete(oldest.value);
      }
      store.set(tradeDate, { body, expiresAt: Date.now() + ttlMs });
    },
    size() {
      return store.size;
    },
  };
};
