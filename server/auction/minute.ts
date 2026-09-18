import { toEastmoneySecId } from '../quotes/eastmoney.js';

/**
 * 集合竞价分时（09:15~09:25）的抓取与特征提取。
 *
 * ## 为什么能用「分时」拿到 09:25 竞价成交
 *
 * 2026-09-18 用当天真实候选池（47 只）逐只对照 `data/auction-snapshots.jsonl` 验证过：
 * **分时序列里第一个成交量 > 0 的点，就是 09:25 集合竞价成交**，价格 47/47 完全相等、
 * 成交额最大相对误差 0.06%（其余全 0）。对照脚本见 `tmp-analysis/verify-em-trends-auction.mjs`。
 *
 * 与 `stock.gtimg.cn` 分笔相比：
 * - 一次请求同时拿到竞价价与竞价成交额，不需要「批量行情拿今开 + 逐只分笔补量」两段式
 * - **北交所不再是盲区**：分笔对北交所返回空，分时首个点仍有成交量
 * - 额外拿到 09:15~09:25 的逐分钟轨迹
 *
 * ## 三个必须注意的上游口径（全部由实测确定）
 *
 * 1. **不能传 `iscr=0`、`ndays=1`，`fields1` 只能用 `f1,f2`**。
 *    传 `iscr=0` 或 `ndays=1`（或给 `fields1` 多加字段）会让上游把 09:15~09:25 整段裁掉、
 *    只从 09:30 开始返回；只有 `fields1=f1,f2` 才拿得到完整竞价段（256 点）。
 * 2. **竞价成交记在 `09:26` 这一点上**：`09:15`~`09:24` 成交量为 0（只有虚拟匹配价），
 *    `09:25` 出现最终撮合价但成交量仍为 0，真正的成交落在 `09:26`。
 *    所以取「第一个成交量 > 0 的点」，而不是写死 `09:25`。
 * 3. **`f56` 已经是成交额（元），不要再拿「价 × 手数」估算**。实测该点
 *    `f56 / 收盘价` 与 `f55`（成交量，单位股）完全吻合，`f55 × 收盘价` 与快照竞价成交额一致。
 *
 * `f58` 是每分钟的**虚拟匹配量**（撮合价上可成交的数量），是竞价过程的核心观测量；
 * `f61` 是未匹配量。两者的确切业务口径尚未完全确证，只原样参与特征、不进入合格判定。
 */

/** 与 eastmoney.ts 保持一致的超时 */
const REQUEST_TIMEOUT_MS = 8_000;
const MINUTE_CONCURRENCY = 4;
/**
 * 只把 `push2delay` 作为分时源：
 * 主站 `push2` 在本网络成功率 0~25%，放在前面只会每次白等一个 8 秒超时。
 */
const TRENDS_ENDPOINT = 'https://push2delay.eastmoney.com/api/qt/stock/trends2/get';

/** 竞价时段（含 09:26 的成交落点与 09:30 的开盘确认点） */
export const AUCTION_WINDOW_START = '09:15';
export const AUCTION_WINDOW_END = '09:30';
/** 09:25 之前最后一分钟的虚拟匹配价，就是这个时点的「竞价参考价」 */
const VIRTUAL_PRICE_CUTOFF = '09:25';

/** 方向阈值默认值；与 `src/lib/auction-policy.ts` 的阈值风格一致，集中可调 */
export const AUCTION_TREND_THRESHOLDS = {
  /** 首点到尾点涨幅超过这个值算「竞价走高」 */
  trendFlatPct: 0.3,
  /** 竞价价相对 09:24 虚拟匹配价低这么多算「尾段下砸」（% ，负值） */
  lateFallPct: -1,
  /** 高这么多算「尾段上抬」（%） */
  lateRisePct: 1,
  /** 虚拟匹配量高点落在这一分钟及之后算「后段放量」 */
  lateRushFrom: '09:23',
} as const;

export type AuctionTrend = 'rising' | 'falling' | 'flat';

/** 09:15~09:24 的逐分钟竞价轨迹（不含 09:25 的最终撮合与 09:26 的成交落点） */
export type AuctionMinutePoint = {
  /** HH:MM */
  time: string;
  /** 该分钟的虚拟匹配价 */
  matchPrice: number;
  /** 该分钟的虚拟匹配量（撮合价上可成交的数量） */
  matchedVolume: number;
};

export type AuctionMinuteData = {
  symbol: string;
  preClose: number | null;
  /** 09:25 集合竞价成交价 */
  auctionPrice: number;
  /** 09:25 集合竞价成交额（元） */
  auctionAmount: number;
  /** 09:24 最后一分钟的虚拟匹配价 */
  lastVirtualPrice: number | null;
  points: AuctionMinutePoint[];
};

export type AuctionMinuteFeatures = {
  /** 竞价时段整体方向：首点到尾点相对昨收的走势 */
  trend: AuctionTrend;
  /** 首点到尾点的涨跌幅（%） */
  trendPct: number;
  /** 尾段偏移（%）= 竞价成交价 相对 09:24 虚拟匹配价 */
  lateShiftPct: number;
  /** 虚拟匹配量峰值 */
  maxMatchedVolume: number;
  /** 峰值出现的分钟 */
  peakMatchedTime: string | null;
  /** 虚拟匹配量高点是否落在尾段 */
  lateRush: boolean | null;
  /** 峰值匹配量与竞价成交量的比值（%），衡量撮合价上的厚度 */
  matchedSharePct: number | null;
  /**
   * 竞价过程中虚拟匹配价摸到过涨停价、但最终没封在上面。
   * 要拿到涨停价才能算，拿不到就是 null。
   */
  touchedLimitUp: boolean | null;
  /** 可直接展示的形状描述 */
  label: string;
};

export type AuctionMinuteResult = {
  data: AuctionMinuteData;
  features: AuctionMinuteFeatures;
};

/**
 * trends2 每个点的列（`fields2=f51..f61`）：
 *
 * `0 时间, 1 开, 2 收, 3 高, 4 低, 5 成交量, 6 成交额, 7 均价, 8 虚拟匹配量, 9 ?, 10 未匹配量`
 */
type RawPoint = {
  time: string;
  matchPrice: number;
  /** 虚拟匹配量：竞价时段来自 f58 */
  matchedVolume: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toFixed2 = (value: number): number => Number(value.toFixed(2));

export type ParsedAuctionMinute = {
  /** 09:15~09:25 的逐分钟轨迹 */
  points: RawPoint[];
  /** 第一个成交量 > 0 的点（= 09:26 竞价成交落点） */
  settlement: { price: number; volume: number; amount: number } | null;
  tradeDate: string | null;
};

export const parseAuctionMinuteTrends = (trends: unknown): ParsedAuctionMinute => {
  if (!Array.isArray(trends)) {
    return { points: [], settlement: null, tradeDate: null };
  }

  const points: RawPoint[] = [];
  let settlement: ParsedAuctionMinute['settlement'] = null;
  let tradeDate: string | null = null;

  for (const raw of trends) {
    if (typeof raw !== 'string') {
      continue;
    }
    const fields = raw.split(',');
    if (fields.length < 9) {
      continue;
    }

    // `2026-09-18 09:26`
    const stamp = fields[0] ?? '';
    if (stamp.length < 16) {
      continue;
    }
    const date = stamp.slice(0, 10);
    const time = stamp.slice(11, 16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      continue;
    }
    if (time < AUCTION_WINDOW_START || time > AUCTION_WINDOW_END) {
      continue;
    }

    tradeDate = date;
    const matchPrice = asNumber(fields[2]);
    if (matchPrice === null || matchPrice <= 0) {
      continue;
    }

    // 成交落点：第一个成交量 > 0 的点，就是 09:25 集合竞价成交
    if (settlement === null) {
      const volume = asNumber(fields[5]);
      const amount = asNumber(fields[6]);
      if (volume !== null && volume > 0) {
        settlement = {
          price: matchPrice,
          volume,
          amount: amount !== null && amount > 0 ? amount : volume * matchPrice,
        };
      }
    }

    // 09:25 的最终撮合价不并入轨迹：它的「匹配量」口径与前面不同，且尾段偏移
    // 正是拿它和竞价成交价比出来的，混在一起会重复计算。
    if (time < VIRTUAL_PRICE_CUTOFF) {
      points.push({
        time,
        matchPrice,
        matchedVolume: Math.max(0, asNumber(fields[8]) ?? 0),
      });
    }
  }

  return { points, settlement, tradeDate };
};

/**
 * 方向标签与特征。所有阈值集中在 `AUCTION_TREND_THRESHOLDS`。
 */
export const summarizeAuctionMinute = (
  symbol: string,
  preClose: number | null,
  parsed: ParsedAuctionMinute,
  limitUpPrice: number | null = null,
): AuctionMinuteResult | null => {
  const { settlement, points } = parsed;
  if (settlement === null || points.length === 0) {
    return null;
  }

  const first = points[0];
  const last = points.at(-1)!;
  const peak = points.reduce((best, point) =>
    point.matchedVolume > best.matchedVolume ? point : best,
  );

  const trendPct = toFixed2(((last.matchPrice - first.matchPrice) / first.matchPrice) * 100);
  const lateShiftPct = toFixed2(((settlement.price - last.matchPrice) / last.matchPrice) * 100);
  const trend: AuctionTrend =
    trendPct > AUCTION_TREND_THRESHOLDS.trendFlatPct
      ? 'rising'
      : trendPct < -AUCTION_TREND_THRESHOLDS.trendFlatPct
        ? 'falling'
        : 'flat';

  const lateRush =
    peak.matchedVolume > 0 ? peak.time >= AUCTION_TREND_THRESHOLDS.lateRushFrom : null;
  const matchedSharePct =
    settlement.volume > 0
      ? toFixed2((peak.matchedVolume / settlement.volume) * 100)
      : null;

  // 与 isSealedAtAuction 同一口径：按分取整后比较，避免浮点边界误判
  const limitReached =
    limitUpPrice !== null && Number.isFinite(limitUpPrice) && limitUpPrice > 0
      ? points.some((point) => Math.round(point.matchPrice * 100) >= Math.round(limitUpPrice * 100))
      : null;
  const touchedLimitUp =
    limitReached === null
      ? null
      : limitReached && Math.round(settlement.price * 100) < Math.round((limitUpPrice as number) * 100);

  const shiftText =
    lateShiftPct <= AUCTION_TREND_THRESHOLDS.lateFallPct
      ? `尾段下砸 ${Math.abs(lateShiftPct).toFixed(2)}%`
      : lateShiftPct >= AUCTION_TREND_THRESHOLDS.lateRisePct
        ? `尾段上抬 ${lateShiftPct.toFixed(2)}%`
        : null;
  const trendText =
    trend === 'rising'
      ? `竞价走高 ${trendPct.toFixed(2)}%`
      : trend === 'falling'
        ? `竞价走低 ${Math.abs(trendPct).toFixed(2)}%`
        : '竞价走平';

  return {
    data: {
      symbol,
      preClose,
      auctionPrice: toFixed2(settlement.price),
      auctionAmount: Number(settlement.amount.toFixed(2)),
      lastVirtualPrice: toFixed2(last.matchPrice),
      points: points.map((point) => ({
        time: point.time,
        matchPrice: toFixed2(point.matchPrice),
        matchedVolume: point.matchedVolume,
      })),
    },
    features: {
      trend,
      trendPct,
      lateShiftPct,
      maxMatchedVolume: peak.matchedVolume,
      peakMatchedTime: peak.time,
      lateRush,
      matchedSharePct,
      touchedLimitUp,
      label: [
        trendText,
        shiftText,
        touchedLimitUp ? '摸板未封' : null,
        lateRush ? `后段放量(${peak.time})` : null,
      ]
        .filter((part): part is string => part !== null)
        .join('，'),
    },
  };
};

const timeoutSignal = (): AbortSignal | undefined => {
  const candidate = AbortSignal as typeof AbortSignal & {
    timeout?: (ms: number) => AbortSignal;
  };
  return typeof candidate.timeout === 'function' ? candidate.timeout(REQUEST_TIMEOUT_MS) : undefined;
};

const fetchTrends = async (
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown> | null> => {
  const params = new URLSearchParams({
    secid: toEastmoneySecId(symbol),
    // 只能用 f1,f2：多带字段或加 iscr/ndays 都会让上游裁掉 09:15~09:25
    fields1: 'f1,f2',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  });

  try {
    const response = await fetchImpl(`${TRENDS_ENDPOINT}?${params.toString()}`, {
      signal: timeoutSignal(),
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    const data = isRecord(payload) ? payload.data : null;
    return isRecord(data) ? data : null;
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
 * 逐只抓取集合竞价分时。拿不到（停牌 / 无竞价成交 / 上游失败）的票不进结果表，
 * 由调用方决定是回退分笔还是标记数据不足。
 */
export const fetchAuctionMinutes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
  /** 外部已经拿到的涨停价（批量行情里就有），用来判断竞价是否摸过板 */
  limitUpPrices: Map<string, number | null> = new Map(),
): Promise<Map<string, AuctionMinuteResult>> => {
  const result = new Map<string, AuctionMinuteResult>();
  if (symbols.length === 0) {
    return result;
  }

  const fetched = await mapWithConcurrency(symbols, MINUTE_CONCURRENCY, async (symbol) => {
    const data = await fetchTrends(symbol, fetchImpl);
    if (data === null) {
      return { symbol, value: null };
    }

    const parsed = parseAuctionMinuteTrends(data.trends);
    const value = summarizeAuctionMinute(
      symbol,
      asNumber(data.prePrice),
      parsed,
      limitUpPrices.get(symbol) ?? null,
    );
    return { symbol, value };
  });

  for (const entry of fetched) {
    if (entry.value !== null) {
      result.set(entry.symbol, entry.value);
    }
  }

  return result;
};
