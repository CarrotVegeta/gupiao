/**
 * 连板天梯 + 今/昨对比。
 *
 * 两个视图是同一份数据的两种看法：
 * * **连板天梯**：把今日涨停池按连板数分层（5 板 / 4 板 / … / 首板），看资金顶到了哪一层；
 * * **今/昨对比**：把今日涨停池按「昨天是几板」对齐，看昨天每一档今天晋级了几只、断了哪几只。
 *
 * 所以一次请求同时取今日和上一交易日的涨停池：
 * 两个视图本来都要昨日数据（天梯的「晋级率」也是「昨日涨停今天再涨停 / 昨日涨停」），
 * 分两个接口只会让同一份池子被拉两遍。
 *
 * 上一交易日按**交易日历**取，不按自然日回溯：周一要跳到上周五，节假日同理。
 */
import type {
  LimitUpComparisonItem,
  LimitUpComparisonStock,
  LimitUpItem,
  LimitUpLadderGroup,
  LimitUpLadderResponse,
} from '../../src/types.js';
import { fetchEastmoneyLimitUp } from './eastmoney.js';

/** 一份池子能算对比的前提：状态是 fresh 或 stale（stale 是「上一轮的同一份」，仍然可用） */
const hasUsablePool = (response: { status: string; items: LimitUpItem[] }): boolean =>
  response.status === 'fresh' || response.status === 'stale';

const bySymbol = (left: { symbol: string }, right: { symbol: string }): number =>
  left.symbol.localeCompare(right.symbol, 'zh-CN');

/** 板位降序；连板数未知（null）的那一档固定排最后 */
const compareBoardCount = (left: number | null, right: number | null): number => {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
};

/** 按连板数分组，返回板位从高到低的梯子 */
export const buildLadder = (items: LimitUpItem[]): LimitUpLadderGroup[] => {
  const groups = new Map<string, LimitUpLadderGroup>();

  for (const item of items) {
    const key = item.boardCount === null ? 'unknown' : String(item.boardCount);
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, { boardCount: item.boardCount, items: [item] });
  }

  return [...groups.values()]
    .map((group) => ({ ...group, items: [...group.items].sort(bySymbol) }))
    .sort((left, right) => compareBoardCount(left.boardCount, right.boardCount));
};

const toComparisonStock = (
  item: LimitUpItem,
  boardCount: number | null,
): LimitUpComparisonStock => ({
  symbol: item.symbol,
  name: item.name,
  boardCount,
  pct: item.pct,
});

/**
 * 今/昨对比：以昨日池子为基准分档。
 *
 * 昨日板位 = 昨日连板数；今日板位 = 今日池子里的连板数。
 * 昨天 3 板今天涨停就是 4 板 —— 今日连板数由池子自带，不自己 +1 推，
 * 免得上游连板数口径和推算口径在同一个页面上打架。
 */
export const buildComparison = (
  todayItems: LimitUpItem[],
  previousItems: LimitUpItem[],
): LimitUpComparisonItem[] => {
  const todayBySymbol = new Map(todayItems.map((item) => [item.symbol, item]));
  const buckets = new Map<string, LimitUpComparisonItem>();

  for (const previousItem of previousItems) {
    const key = previousItem.boardCount === null ? 'unknown' : String(previousItem.boardCount);
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = {
        boardCount: previousItem.boardCount,
        total: 0,
        carried: [],
        fallen: [],
      };
      buckets.set(key, bucket);
    }

    bucket.total += 1;

    const todayItem = todayBySymbol.get(previousItem.symbol);

    if (todayItem) {
      bucket.carried.push(toComparisonStock(todayItem, todayItem.boardCount ?? null));
    } else {
      bucket.fallen.push(toComparisonStock(previousItem, null));
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      carried: [...bucket.carried].sort(bySymbol),
      fallen: [...bucket.fallen].sort(bySymbol),
    }))
    .sort((left, right) => compareBoardCount(left.boardCount, right.boardCount));
};

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

/**
 * 两份池子是不是「同一份快照」：代码集合与连板数全都一样。
 *
 * 上游在请求日还没有池子时（盘前、非交易日）会把最近一个交易日的池子原样返回，
 * 而响应里的 tradeDate 只是请求日期的回显 —— 这时今昨两份必然是同一份快照。
 * 真出现「今天所有票都晋级且连板数一个不差」的概率可以忽略，用它当判据是安全的。
 */
const isSameSnapshot = (left: LimitUpItem[], right: LimitUpItem[]): boolean => {
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }

  const key = (items: LimitUpItem[]): string =>
    items
      .map((item) => `${item.symbol}:${item.boardCount ?? '-'}`)
      .sort()
      .join('|');

  return key(left) === key(right);
};

const EMPTY_LADDER_RESPONSE = (
  tradeDate: string | null,
  error: string | null,
): LimitUpLadderResponse => ({
  tradeDate,
  previousTradeDate: null,
  items: [],
  ladder: [],
  previousLadder: [],
  comparison: [],
  previousCount: 0,
  carriedCount: 0,
  promotionRate: null,
  previousAvailable: false,
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'unavailable',
  error,
});

/**
 * 找上一交易日：先用交易日历（腾讯上证日K），日历拿不到再退回「按自然日回扫涨停池」。
 *
 * 回扫只跳过周末、不跳节假日 —— 但它是**用池子自己验证**的：
 * 只有真拿到非空涨停池的日子才认，所以假期里的空池会被自动跳过。
 */
const resolvePreviousTradeDate = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<string | null> => {
  try {
    // 动态导入：themes/service 里还挂着一整套选股服务，这里是涨停池链路，
    // 不在启动时就把它整条拉进来
    const { fetchTradeDatesUpTo } = await import('../themes/service.js');
    const dates = await fetchTradeDatesUpTo(tradeDate, 6, fetchImpl);
    const previous = dates.filter((date) => date < tradeDate).pop();

    if (previous) {
      return previous;
    }
  } catch {
    // 日历不可用时走下面的回扫兜底
  }

  return null;
};

export const fetchLimitUpLadder = async (
  requestedTradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LimitUpLadderResponse> => {
  const [todayPool, calendarPreviousDate] = await Promise.all([
    fetchEastmoneyLimitUp(requestedTradeDate, fetchImpl),
    resolvePreviousTradeDate(requestedTradeDate, fetchImpl),
  ]);

  if (!hasUsablePool(todayPool)) {
    return {
      ...EMPTY_LADDER_RESPONSE(todayPool.tradeDate, todayPool.error ?? '涨停池暂不可用'),
      fetchedAt: todayPool.fetchedAt,
    };
  }

  const tradeDate = todayPool.tradeDate ?? requestedTradeDate;

  /** 取「from 之前最近一个交易日」那份池子；日历没给出来就按自然日回扫，只认真的拿到池子的那一天 */
  const loadPreviousPool = async (
    from: string,
  ): Promise<{ tradeDate: string; items: LimitUpItem[] } | null> => {
    const calendarPrevious =
      from === tradeDate ? calendarPreviousDate : await resolvePreviousTradeDate(from, fetchImpl);

    const candidates =
      calendarPrevious !== null
        ? [calendarPrevious]
        : [1, 2, 3, 4, 5, 6, 7].map((days) => dateDaysBefore(from, days));

    for (const candidate of candidates) {
      const pool = await fetchEastmoneyLimitUp(candidate, fetchImpl);

      if (hasUsablePool(pool) && pool.items.length > 0) {
        return { tradeDate: candidate, items: pool.items };
      }
    }

    return null;
  };

  let effectiveTradeDate = tradeDate;
  let todayItems = todayPool.items;
  let previous = await loadPreviousPool(tradeDate);

  /*
   * 请求日还没有池子（盘前 / 非交易日）时，上游把最近一个交易日的池子原样返回，
   * 「今天」和「昨天」会是同一份快照，比出来就是假的「100% 晋级、断板全无」。
   * 认出来就把「今天」落到那个交易日，再往前取它的上一日当「昨日」。
   */
  if (previous !== null && isSameSnapshot(todayItems, previous.items)) {
    effectiveTradeDate = previous.tradeDate;
    todayItems = previous.items;
    previous = await loadPreviousPool(previous.tradeDate);
  }

  const previousTradeDate = previous?.tradeDate ?? null;
  const previousPool = previous?.items ?? [];

  const previousAvailable = previousTradeDate !== null;
  const comparison = previousAvailable ? buildComparison(todayItems, previousPool) : [];
  const previousCount = comparison.reduce((sum, bucket) => sum + bucket.total, 0);
  const carriedCount = comparison.reduce((sum, bucket) => sum + bucket.carried.length, 0);

  return {
    tradeDate: effectiveTradeDate,
    previousTradeDate,
    items: todayItems,
    ladder: buildLadder(todayItems),
    previousLadder: previousAvailable ? buildLadder(previousPool) : [],
    comparison,
    previousCount,
    carriedCount,
    promotionRate: previousCount > 0 ? (carriedCount / previousCount) * 100 : null,
    previousAvailable,
    fetchedAt: new Date().toISOString(),
    source: 'eastmoney',
    /*
     * 今日池子是 fresh 就是 fresh：status 只表达「这份响应本身新不新」，
     * 昨日这一半缺没缺由 previousAvailable 单独表达。
     * 所以缺昨日池子时 error 保持 null —— error 的语义是「这份响应有问题」，
     * 用它去描述「昨日那一半没取到」会让前端把整份今日天梯也当成坏数据。
     */
    status: todayPool.status === 'fresh' ? 'fresh' : 'stale',
    error: null,
  };
};
