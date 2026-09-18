import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuctionItem, AuctionResponse } from '../../src/types.js';

/**
 * 09:25 竞价快照落盘。
 *
 * 为什么要存：新浪/腾讯/东财/网易/同花顺都拿不到历史 09:25 竞价量能
 * （腾讯分笔与同花顺分时忽略日期参数、东财 push2his 断连、网易 502），
 * 所以「竞价量比 / 竞价成交额门槛 / 竞价换手率 / 竞昨比」这几个因子
 * 一直无法回测。线上本来就已经把 09:25 的竞价成交额取回来了，
 * 每天落一条就能把这批因子变成可验证的。
 *
 * 落盘内容只含 09:25 时点可知的字段；「当日是否封板」「次日开盘收益」
 * 这些标签事后用日K补算，不需要在这里猜。
 *
 * 路径：环境变量 AUCTION_SNAPSHOT_FILE，缺省 data/auction-snapshots.jsonl。
 * 生产环境的工作目录是发布目录（scripts/deploy-remote.sh 会整体替换），
 * 所以要长期保存必须在 systemd 里把这个变量指到发布目录之外。
 */
export const DEFAULT_SNAPSHOT_FILE = path.resolve(process.cwd(), 'data', 'auction-snapshots.jsonl');

const snapshotPath = (): string => {
  const configured = process.env.AUCTION_SNAPSHOT_FILE?.trim();
  return configured ? path.resolve(configured) : DEFAULT_SNAPSHOT_FILE;
};

export type AuctionSnapshotRow = {
  symbol: string;
  name: string | null;
  boardCount: number | null;
  /** 昨日换手率（%），来自昨日涨停池 */
  turnoverRate: number | null;
  /** 昨日流通市值（元）；除以竞价价即可还原流通股本 */
  floatMarketCap: number | null;
  /** 昨日全天成交额（元），竞价成交额的比较基准 */
  previousAmount: number | null;
  firstSealTime: string | null;
  breakCount: number | null;
  auctionPrice: number | null;
  auctionPct: number | null;
  /** 09:25 集合竞价成交额（元）：量比、竞价换手率、竞昨比都从它算 */
  auctionAmount: number | null;
  /** 竞价量比（%）= 竞价成交额 / 昨日全天成交额，线上已算好 */
  auctionRatio: number | null;
  sealedAtAuction: boolean | null;
  /** 两条件合格判定的结果 */
  result: AuctionItem['result'];
  /**
   * 竞价分时形态（09:15~09:24 的虚拟匹配价/量轨迹）。
   * **不参与判定**，落盘只为以后攒够样本再验证这类形态因子；2026-09-18 起才有这个字段。
   */
  minuteTrend?: AuctionItem['minuteTrend'];
  /** 竞价成交额来自分笔还是分时；用于观测分时兜底的命中率 */
  amountSource?: AuctionItem['auctionAmountSource'];
};

export type AuctionSnapshotRecord = {
  tradeDate: string;
  previousTradeDate: string | null;
  snapshotTime: string;
  source: AuctionResponse['source'];
  fetchedAt: string;
  recordedAt: string;
  rows: AuctionSnapshotRow[];
};

/** 已落盘的交易日；避免 5 分钟缓存过期后重复刷新写出多份 */
const recorded = new Set<string>();
let loaded = false;

const loadRecorded = (): void => {
  if (loaded) {
    return;
  }
  loaded = true;
  const target = snapshotPath();
  if (!existsSync(target)) {
    return;
  }
  try {
    for (const line of readFileSync(target, 'utf8').split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as { tradeDate?: unknown };
        if (typeof parsed.tradeDate === 'string') {
          recorded.add(parsed.tradeDate);
        }
      } catch {
        // 半行或坏行直接跳过，不影响后续追加
      }
    }
  } catch {
    // 读不到就当没有历史，继续写新的
  }
};

export const toSnapshotRow = (item: AuctionItem): AuctionSnapshotRow => ({
  symbol: item.symbol,
  name: item.name ?? null,
  boardCount: item.boardCount,
  turnoverRate: item.turnoverRate,
  floatMarketCap: item.floatMarketCap,
  previousAmount: item.previousAmount,
  firstSealTime: item.firstSealTime,
  breakCount: item.breakCount,
  auctionPrice: item.auctionPrice,
  auctionPct: item.auctionPct,
  auctionAmount: item.auctionAmount,
  auctionRatio: item.auctionRatio,
  sealedAtAuction: item.sealedAtAuction,
  result: item.result,
  minuteTrend: item.minuteTrend,
  amountSource: item.auctionAmountSource,
});

/**
 * 追加一份当日快照。返回是否真的写入。
 * 只记成功、非空、且当天还没记过的结果；任何 IO 故障都吞掉，不能让日志拖垮接口。
 */
export const appendAuctionSnapshot = (
  body: AuctionResponse,
  now: Date = new Date(),
): boolean => {
  if (body.status !== 'fresh' || body.tradeDate === null || body.items.length === 0) {
    return false;
  }
  loadRecorded();
  const tradeDate = body.tradeDate;
  if (recorded.has(tradeDate)) {
    return false;
  }
  const target = snapshotPath();
  const record: AuctionSnapshotRecord = {
    tradeDate,
    previousTradeDate: body.previousTradeDate,
    snapshotTime: body.snapshotTime,
    source: body.source,
    fetchedAt: body.fetchedAt,
    recordedAt: now.toISOString(),
    rows: body.items.map(toSnapshotRow),
  };
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(record)}\n`, 'utf8');
    recorded.add(tradeDate);
    return true;
  } catch {
    return false;
  }
};

export const readAuctionSnapshots = (): AuctionSnapshotRecord[] => {
  const target = snapshotPath();
  if (!existsSync(target)) {
    return [];
  }
  const out: AuctionSnapshotRecord[] = [];
  for (const line of readFileSync(target, 'utf8').split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as AuctionSnapshotRecord;
      if (typeof parsed?.tradeDate === 'string' && Array.isArray(parsed.rows)) {
        out.push(parsed);
      }
    } catch {
      // 坏行跳过
    }
  }
  return out;
};

export const snapshotFile = snapshotPath;

/** 仅供测试：清掉进程内的「已落盘交易日」缓存 */
export const resetSnapshotStateForTests = (): void => {
  recorded.clear();
  loaded = false;
};
