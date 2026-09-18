import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculatePortfolioSummary, hasPositionDetails } from './lib/calculations';
import { DragonTigerList } from './components/DragonTigerList';
import { AuctionList } from './components/AuctionList';
import {
  MarketOverview,
  formatIndexValue,
  formatSignedPercent,
  getMarketToneClass,
} from './components/MarketOverview';
import { PrimaryNav, type PrimaryNavPage } from './components/PrimaryNav';
import { ScreenerPanel, type ScreenerTab } from './components/ScreenerPanel';
import { RotationPage } from './components/RotationPage';
import type { RotationSummary } from './components/SectorRotationPanel';
import { fetchMinuteSeries, fetchQuotes, mergeQuotes } from './lib/quotes';
import { searchStocks } from './lib/search';
import { loadState, moveHoldingsToGroup, saveState } from './lib/storage';
import type { GroupDialogValues } from './components/GroupDialog';
import { GroupManagerDialog } from './components/GroupManagerDialog';
import { HoldingForm, type HoldingFormValues } from './components/HoldingForm';
import { HoldingList } from './components/HoldingList';
import { toMinuteSeriesMap } from './components/MinuteChart';
import { LimitUpFocus, type LimitUpFocusTab } from './components/LimitUpFocus';
import { Overview } from './components/Overview';
import { SprintLimitUpRail } from './components/SprintLimitUpRail';
import { GroupFilter } from './components/GroupFilter';
import { Watchlist } from './components/Watchlist';
import { WatchlistFilterBar, type WatchlistScope } from './components/WatchlistFilterBar';
import { fetchDragonTiger, mergeDragonTiger } from './lib/dragonTiger';
import { fetchAuction, mergeAuction } from './lib/auction';
import { fetchLimitUp, mergeLimitUp } from './lib/limitUp';
import { fetchLimitUpLadder, mergeLimitUpLadder } from './lib/limitUpLadder';
import { toLimitUpInfoMap } from './lib/limitUpInfo';
import { currentQuotePrice, snapshotWatchPrices } from './lib/watchlist';
import { fetchSprintLimitUp, mergeSprintLimitUp } from './lib/sprintLimitUp';
import {
  createUnavailableMarketIndices,
  createUnavailableMarketOverviewResponse,
  fetchMarketOverview,
  marketIndicesInDisplayOrder,
  mergeMarketOverview,
} from './lib/market';
import type {
  MarketBreadth,
  AuctionResponse,
  DragonTigerResponse,
  Holding,
  LimitUpLadderResponse,
  LimitUpResponse,
  MarketIndex,
  MinuteSeriesMap,
  Quote,
  QuoteMap,
  QuotesResponse,
  SprintLimitUpResponse,
  StorageState,
  StockGroup,
} from './types';

const REFRESH_INTERVAL_MS = 10_000;
/** 分时刷新最小间隔：上游按票数逐个抓，比行情贵得多 */
const MINUTE_REFRESH_MIN_MS = 5 * 60 * 1000;

// 分组的增删改都收在「分组管理」面板里，不再有单独的 create-group / edit-group 弹窗
type ModalState =
  | { type: 'manage-groups' }
  | { type: 'create-holding' }
  | { type: 'edit-holding'; holdingId: string }
  | null;

const formatTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const unique = (symbols: string[]): string[] => Array.from(new Set(symbols));

/**
 * 给还没有参考价的自选行补记「自选收益」的基准价（加入自选当时的价格）。
 * 有基准的行走进来也原样不变，所以反复调用是安全的。
 * 返回这一轮真的记下几行的条数。
 */
const captureWatchPrices = (
  state: StorageState,
  quotes: QuoteMap,
): { state: StorageState; captured: number } => {
  const { holdings, captured } = snapshotWatchPrices(
    state.holdings,
    quotes,
    new Date().toISOString(),
  );

  return captured === 0 ? { state, captured } : { state: { ...state, holdings }, captured };
};

/**
 * 这一批股票里能当基准价用的行情：只有请求到的那几个代码参与，
 * quotes 里其它股票（竞价栏、对比列）的旧价不能拿来当参考价。
 */
const pickQuotes = (quotes: QuoteMap, targets: string[]): QuoteMap => {
  const picked: QuoteMap = {};

  for (const symbol of targets) {
    const quote = quotes[symbol];

    if (quote !== undefined) {
      picked[symbol] = quote;
    }
  }

  return picked;
};

const normalizeDisplayName = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

const formatTradeDate = (date: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';

  return `${year}${month}${day}`;
};

const emptyLimitUpResponse = (): LimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'unavailable',
  error: null,
});

const emptySprintLimitUpResponse = (): SprintLimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'unavailable',
  error: null,
});

const emptyLimitUpLadderResponse = (): LimitUpLadderResponse => ({
  tradeDate: null,
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
  error: null,
});

const emptyDragonTigerResponse = (): DragonTigerResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'unavailable',
  error: null,
});

const emptyAuctionResponse = (): AuctionResponse => ({
  tradeDate: null,
  previousTradeDate: null,
  snapshotTime: '09:25:00',
  items: [],
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'unavailable',
  error: null,
});

const buildLimitUpUnavailableResponse = (fetchedAt: string): LimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: '涨停池刷新失败',
});

const buildSprintLimitUpUnavailableResponse = (
  fetchedAt: string,
): SprintLimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: '冲刺涨停刷新失败',
});

const buildLimitUpLadderUnavailableResponse = (
  fetchedAt: string,
): LimitUpLadderResponse => ({
  ...emptyLimitUpLadderResponse(),
  fetchedAt,
  error: '连板天梯刷新失败',
});

const buildDragonTigerUnavailableResponse = (fetchedAt: string): DragonTigerResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: '龙虎榜刷新失败',
});

const buildAuctionUnavailableResponse = (fetchedAt: string): AuctionResponse => ({
  tradeDate: null,
  previousTradeDate: null,
  snapshotTime: '09:25:00',
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: '竞价刷新失败',
});

export default function App() {
  const [loadedState] = useState(() => loadState(localStorage));
  const [state, setState] = useState<StorageState>(loadedState.state);
  const [activePage, setActivePage] = useState<PrimaryNavPage>('watchlist');
  const [activeScreenerTab, setActiveScreenerTab] = useState<ScreenerTab>('mainline');
  /** 「轮动」页的板块数，由页面内取数后回报，只用于导航计数 */
  const [rotationPlateCount, setRotationPlateCount] = useState<number | null>(null);
  const [activeLimitUpTab, setActiveLimitUpTab] = useState<LimitUpFocusTab>('pool');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  // 自选页表头的筛选：范围（全部 / 持仓）和分组合并成一条分段控件
  const [watchlistScope, setWatchlistScope] = useState<WatchlistScope>('all');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  /**
   * 当日分时序列（迷你分时图用）。只在自选/持仓列表变化和页面首次加载时取一次：
   * 服务端为它要逐只打上游，请求数 = 票数，不能跟着 10 秒行情轮询一起刷。
   */
  const [minuteSeries, setMinuteSeries] = useState<MinuteSeriesMap>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketIndices, setMarketIndices] = useState<Record<string, MarketIndex>>(
    createUnavailableMarketIndices,
  );
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
  const [marketTurnover, setMarketTurnover] = useState<number | null>(null);
  const [marketBreadth, setMarketBreadth] = useState<MarketBreadth | null>(null);
  const [isMarketRefreshing, setIsMarketRefreshing] = useState(false);
  const [limitUp, setLimitUp] = useState<LimitUpResponse>(emptyLimitUpResponse());
  const [isLimitUpRefreshing, setIsLimitUpRefreshing] = useState(false);
  // 连板天梯与今/昨对比共用一份响应：两个视图看的是同一份池子（见 types.ts 的契约说明）
  const [limitUpLadder, setLimitUpLadder] = useState<LimitUpLadderResponse>(
    emptyLimitUpLadderResponse(),
  );
  const [isLimitUpLadderRefreshing, setIsLimitUpLadderRefreshing] = useState(false);
  const [sprintLimitUp, setSprintLimitUp] = useState<SprintLimitUpResponse>(
    emptySprintLimitUpResponse(),
  );
  const [isSprintLimitUpRefreshing, setIsSprintLimitUpRefreshing] = useState(false);
  const [dragonTiger, setDragonTiger] = useState<DragonTigerResponse>(
    emptyDragonTigerResponse(),
  );
  const [isDragonTigerRefreshing, setIsDragonTigerRefreshing] = useState(false);
  const [auction, setAuction] = useState<AuctionResponse>(emptyAuctionResponse());
  const [isAuctionRefreshing, setIsAuctionRefreshing] = useState(false);
  /**
   * 竞价列表的「涨跌幅」列要看盘中的现价，而竞价快照本身按 09:25 固定、
   * 服务端还缓存 5 分钟：把现价塞进快照会让这一列最多滞后 5 分钟。
   * 所以单独走行情接口，和持仓/自选用同一套 Quote 形状。
   */
  const [auctionQuotes, setAuctionQuotes] = useState<Record<string, Quote>>({});
  /**
   * 今/昨对比左列里「昨天涨停、今天没涨停」那批的今日行情：它们不在今日涨停池里，
   * 池子那份 pct 是它们昨天封板当天那根，今天的涨跌幅只能从行情接口拿。
   */
  const [comparisonQuotes, setComparisonQuotes] = useState<Record<string, Quote>>({});
  const [refreshMessage, setRefreshMessage] = useState<string | null>(
    loadedState.recovered ? '本地数据已恢复为默认状态。' : null,
  );
  /** 「已加入自选」这类成功提示：和失败的 warning 分开，几秒后自己消失 */
  const [watchlistNotice, setWatchlistNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [isHoldingSubmitting, setIsHoldingSubmitting] = useState(false);

  const holdingSymbols = useMemo(
    () => unique(state.holdings.map((holding) => holding.symbol)),
    [state.holdings],
  );

  /** 选股页行尾按钮要按代码判断「已在自选」，用集合查而不是每行扫一遍持仓 */
  const watchlistSymbols = useMemo(
    () => new Set(state.holdings.map((holding) => holding.symbol)),
    [state.holdings],
  );


  const positionedHoldings = useMemo(
    () => state.holdings.filter(hasPositionDetails),
    [state.holdings],
  );

  const scopeHoldings = useMemo(
    () => (watchlistScope === 'position' ? positionedHoldings : state.holdings),
    [positionedHoldings, state.holdings, watchlistScope],
  );

  const filterByGroup = useCallback(
    (holdings: Holding[]): Holding[] => {
      if (selectedGroupId === 'all') {
        return holdings;
      }

      return holdings.filter((holding) => holding.groupId === selectedGroupId);
    },
    [selectedGroupId],
  );

  // 范围与分组共用一条控件，点范围就回到「全部分组」，点分组就退出「持仓」档位
  const selectWatchlistScope = useCallback((scope: WatchlistScope): void => {
    setWatchlistScope(scope);
    setSelectedGroupId('all');
  }, []);

  const selectWatchlistGroup = useCallback((groupId: string): void => {
    setSelectedGroupId(groupId);
    setWatchlistScope('all');
  }, []);

  const filteredHoldings = useMemo(
    () => filterByGroup(positionedHoldings),
    [filterByGroup, positionedHoldings],
  );

  const filteredWatchlist = useMemo(
    () => filterByGroup(scopeHoldings),
    [filterByGroup, scopeHoldings],
  );

  // 持仓收益只统计「全部持仓」，不跟着分组筛选走：
  // 切分组只影响下方明细，概览数字保持全局口径。
  // 持仓收益只统计「全部持仓」，不跟着分组筛选走：
  // 切分组只影响下方明细，概览数字保持全局口径。
  const summary = useMemo(
    () => calculatePortfolioSummary(positionedHoldings, quotes),
    [positionedHoldings, quotes],
  );

  const marketOverview = useMemo(
    () => marketIndicesInDisplayOrder(marketIndices),
    [marketIndices],
  ); // 指数按固定展示顺序排列

  // 涨停池 -> 代码维度的标签查询表，自选/持仓的名称旁标签用它
  const limitUpInfo = useMemo(() => toLimitUpInfoMap(limitUp), [limitUp]);

  const commitState = useCallback((updater: (current: StorageState) => StorageState) => {
    setState((current) => {
      const next = updater(current);
      saveState(localStorage, next);
      return next;
    });
  }, []);

  const persistState = useCallback((next: StorageState): void => {
    const saved = saveState(localStorage, next);
    setState(next);
    if (!saved) {
      setRefreshMessage('本地存储写入失败：这次改动只在本页有效，刷新后会丢失。');
    }
  }, []);

  /**
   * 刷新行情时把行情并进 state，并顺手补记「自选收益」的基准价。
   *
   * 补记必须写在 setQuotes 的更新函数里，不能写成 `setQuotes(...); commit(读到的 quotes)`：
   * 更新函数要等下一次渲染才执行，外面那行读到的还是空对象，等于什么都没记。
   *
   * 只给还缺参考价的行记（加入时没拿到行情、或本功能上线前的旧记录），
   * 所以定时器每 10 秒走一遍也是安全的，不会把起点往后挪。
   */
  const mergeQuotesAndCaptureBaselines = useCallback(
    (response: QuotesResponse, targets: string[]): void => {
      setQuotes((current) => {
        const merged = mergeQuotes(current, response);

        setState((currentState) => {
          const { state: next, captured } = captureWatchPrices(
            currentState,
            pickQuotes(merged, targets),
          );

          if (captured === 0) {
            return currentState;
          }

          if (!saveState(localStorage, next)) {
            return currentState;
          }

          return next;
        });

        return merged;
      });
    },
    [],
  );

  const refreshQuotes = useCallback(
    async (symbols: string[] = holdingSymbols): Promise<QuotesResponse | null> => {
      const targets = unique(symbols);

      if (targets.length === 0) {
        return null;
      }

      setIsRefreshing(true);

      try {
        const response = await fetchQuotes(targets);

        mergeQuotesAndCaptureBaselines(response, targets);
        setLastUpdated(response.fetchedAt);
        setRefreshMessage(
          response.errors.length > 0 ? '部分行情刷新失败，当前仍显示上一轮数据。' : null,
        );

        return response;
      } catch (error) {
        setQuotes((current) =>
          mergeQuotes(current, {
            quotes: [],
            fetchedAt: new Date().toISOString(),
            source: 'eastmoney',
            errors: targets.map((symbol) => ({ symbol, message: '行情刷新失败' })),
          }),
        );
        setRefreshMessage(
          error instanceof Error
            ? `${error.message}，已保留上一轮数据。`
            : '行情刷新失败，已保留上一轮数据。',
        );
        return null;
      } finally {
        setIsRefreshing(false);
      }
    },
    [holdingSymbols, mergeQuotesAndCaptureBaselines],
  );

  /**
   * 选股列表行尾的「添加自选」：只建一条观察记录（不填开仓价 / 数量），
   * 已经在自选里的就只提示一次，不重复写。
   *
   * 新记录先不带基准价：行情拿到手才知道「加入当时」的价格，
   * 硬编一个（比如拿现价当基准）算出来永远是 0%，所以交给下面这次刷新的
   * refreshQuotes 统一补记（它就是为缺基准价的行准备的）。
   */
  const handleAddToWatchlist = useCallback(
    async ({ symbol, name }: { symbol: string; name: string }): Promise<void> => {
      const target = symbol.trim();

      if (!/^\d{6}$/.test(target)) {
        setWatchlistNotice(null);
        setRefreshMessage(`${name || symbol} 不是有效的 6 位股票代码，没能加入自选。`);
        return;
      }

      if (state.holdings.some((holding) => holding.symbol === target)) {
        setRefreshMessage(null);
        setWatchlistNotice(`${name || target} 已经在自选列表里了。`);
        return;
      }

      const timestamp = new Date().toISOString();
      const displayName = normalizeDisplayName(name) ?? target;
      const nextHoldings: Holding[] = [
        ...state.holdings.map((holding) => ({ ...holding })),
        {
          id: createId(),
          symbol: target,
          name: displayName,
          // 空 groupId 表示「未分组」：只在「全部」里出现，不擅自塞进用户建的分组
          groupId: '',
          openPrice: null,
          quantity: null,
          note: '',
          createdAt: timestamp,
          updatedAt: timestamp,
          watchPrice: null,
          watchPriceAt: null,
        },
      ];

      persistState({
        groups: state.groups.map((group) => ({ ...group })),
        holdings: nextHoldings,
      });
      setRefreshMessage(null);
      setWatchlistNotice(`已把 ${displayName} 加入自选。`);
      // 行情跟着一起刷：切到自选页就是有价的一行，而不是只有代码
      await refreshQuotes(nextHoldings.map((holding) => holding.symbol));
    },
    [persistState, refreshQuotes, state.groups, state.holdings],
  );

  const refreshMarketOverview = useCallback(async (): Promise<void> => {
    setIsMarketRefreshing(true);

    try {
      const response = await fetchMarketOverview();

      setMarketIndices((current) => mergeMarketOverview(current, response));
      setMarketTurnover(response.turnover);
      setMarketBreadth(response.breadth);
      if (response.indices.some((index) => index.status === 'fresh')) {
        setMarketUpdatedAt(response.fetchedAt);
      }
    } catch {
      const fetchedAt = new Date().toISOString();

      setMarketIndices((current) =>
        mergeMarketOverview(
          current,
          createUnavailableMarketOverviewResponse(fetchedAt, '大盘刷新失败'),
        ),
      );
    } finally {
      setIsMarketRefreshing(false);
    }
  }, []);

  const refreshLimitUp = useCallback(async (): Promise<void> => {
    setIsLimitUpRefreshing(true);

    try {
      const response = await fetchLimitUp(formatTradeDate());

      setLimitUp((current) => mergeLimitUp(current, response));
    } catch {
      const fetchedAt = new Date().toISOString();

      setLimitUp((current) =>
        mergeLimitUp(current, buildLimitUpUnavailableResponse(fetchedAt)),
      );
    } finally {
      setIsLimitUpRefreshing(false);
    }
  }, []);

  const refreshLimitUpLadder = useCallback(async (): Promise<void> => {
    setIsLimitUpLadderRefreshing(true);

    try {
      const response = await fetchLimitUpLadder(formatTradeDate());

      setLimitUpLadder((current) => mergeLimitUpLadder(current, response));
    } catch {
      const fetchedAt = new Date().toISOString();

      setLimitUpLadder((current) =>
        mergeLimitUpLadder(current, buildLimitUpLadderUnavailableResponse(fetchedAt)),
      );
    } finally {
      setIsLimitUpLadderRefreshing(false);
    }
  }, []);

  const refreshSprintLimitUp = useCallback(async (): Promise<void> => {
    setIsSprintLimitUpRefreshing(true);

    try {
      const response = await fetchSprintLimitUp(formatTradeDate());

      setSprintLimitUp((current) => mergeSprintLimitUp(current, response));
    } catch {
      const fetchedAt = new Date().toISOString();

      setSprintLimitUp((current) =>
        mergeSprintLimitUp(current, buildSprintLimitUpUnavailableResponse(fetchedAt)),
      );
    } finally {
      setIsSprintLimitUpRefreshing(false);
    }
  }, []);

  const refreshDragonTiger = useCallback(async (): Promise<void> => {
    setIsDragonTigerRefreshing(true);

    try {
      const response = await fetchDragonTiger(formatTradeDate());

      setDragonTiger((current) => mergeDragonTiger(current, response));
    } catch {
      const fetchedAt = new Date().toISOString();

      setDragonTiger((current) =>
        mergeDragonTiger(current, buildDragonTigerUnavailableResponse(fetchedAt)),
      );
    } finally {
      setIsDragonTigerRefreshing(false);
    }
  }, []);

  const refreshAuction = useCallback(async (): Promise<void> => {
    setIsAuctionRefreshing(true);

    try {
      const response = await fetchAuction(formatTradeDate());
      setAuction((current) => mergeAuction(current, response));
    } catch {
      const fetchedAt = new Date().toISOString();
      setAuction((current) => mergeAuction(current, buildAuctionUnavailableResponse(fetchedAt)));
    } finally {
      setIsAuctionRefreshing(false);
    }
  }, []);

  /*
   * 依赖用「代码串」而不是 items 数组：竞价每刷一次都会换出新数组，
   * 但候选没变时不该再打一次行情。
   */
  const auctionSymbolKey = useMemo(
    () => unique(auction.items.map((item) => item.symbol)).join(','),
    [auction.items],
  );

  const refreshAuctionQuotes = useCallback(async (): Promise<void> => {
    const symbols = auctionSymbolKey === '' ? [] : auctionSymbolKey.split(',');

    if (symbols.length === 0) {
      return;
    }

    try {
      const response = await fetchQuotes(symbols);
      setAuctionQuotes((current) => mergeQuotes(current, response));
    } catch {
      // 拉不到就保留上一轮：这一列宁可显示旧价，页脚也有「行情」时间可对照
    }
  }, [auctionSymbolKey]);

  /*
   * 依赖用「代码串」而不是 items 数组：对比每刷一次都会换出新数组，
   * 但成分没变时不该再打一次行情。
   */
  const comparisonSymbolKey = useMemo(
    () =>
      unique(
        limitUpLadder.comparison.flatMap((bucket) =>
          [...bucket.carried, ...bucket.fallen].map((stock) => stock.symbol),
        ),
      ).join(','),
    [limitUpLadder.comparison],
  );

  const refreshComparisonQuotes = useCallback(async (): Promise<void> => {
    const symbols = comparisonSymbolKey === '' ? [] : comparisonSymbolKey.split(',');

    if (symbols.length === 0) {
      return;
    }

    try {
      const response = await fetchQuotes(symbols);
      setComparisonQuotes((current) => mergeQuotes(current, response));
    } catch {
      // 拉不到就保留上一轮；这一列没有行情时显示「—」，不会拿昨天的涨幅顶上
    }
  }, [comparisonSymbolKey]);

  const refreshVisibleData = useCallback((): void => {
    void refreshMarketOverview();

    if (holdingSymbols.length > 0) {
      void refreshQuotes(holdingSymbols);
    }

    // 自选/持仓的名称旁要用涨停池算连板标识。
    // 池子已经有数据就不再重复拉（和右栏冲刺涨停同一个思路），
    // 只有从来没成功拿到过（unavailable）才补一次。
    if (
      (activePage === 'watchlist' || activePage === 'holdings') &&
      limitUp.status === 'unavailable'
    ) {
      void refreshLimitUp();
    }

    if (activePage === 'limit-up') {
      if (activeLimitUpTab === 'pool') {
        void refreshLimitUp();
      } else if (activeLimitUpTab === 'sprint') {
        void refreshSprintLimitUp();
      } else {
        // 今/昨对比与连板天梯共用同一份响应，进任一页签都只刷这一个接口。
        // 定时器里无条件刷（数据要跟着盘中变），进页面的首次加载在下面按 status 判断
        void refreshLimitUpLadder();

        // 对比左列里断板那批的涨幅要跟着盘中走：池子是一分钟一变的快照，行情另算一次
        if (activeLimitUpTab === 'comparison') {
          void refreshComparisonQuotes();
        }
      }
    }

    if (activePage === 'dragon-tiger') {
      void refreshDragonTiger();
    }

    // 竞价列表的「涨跌幅」是盘中实时值：10 秒跟着行情一起刷，
    // 但竞价快照本身不重复拉（服务端 5 分钟缓存，09:25 结果也不会变）。
    if (activePage === 'auction') {
      void refreshAuctionQuotes();
    }
  }, [
    activePage,
    activeLimitUpTab,
    holdingSymbols,
    limitUp.status,
    refreshAuctionQuotes,
    refreshComparisonQuotes,
    refreshDragonTiger,
    refreshLimitUp,
    refreshLimitUpLadder,
    refreshMarketOverview,
    refreshQuotes,
    refreshSprintLimitUp,
  ]);

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      return;
    }

    void refreshQuotes(holdingSymbols);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 上次成功取分时的时刻，用来给「切回标签页」那条路径做节流 */
  const minuteFetchedAtRef = useRef(0);

  /**
   * 当日分时：上游一次只给一只票，服务端要逐只抓（请求数 = 票数），
   * 所以**不跟 10 秒行情轮询走**。只在三种时机取：
   * 1. 首次加载 / 自选·持仓的代码集合变化（含增删股票）
   * 2. 从其它标签页切回来（下面的 visibilitychange 路径），节流见 MINUTE_REFRESH_MIN_MS
   *
   * 分时是增强信息：拿不到就保持「—」，不弹错误、不影响行情与其它列。
   */
  const refreshMinuteSeries = useCallback(
    async (symbols: string[] = holdingSymbols): Promise<void> => {
      if (symbols.length === 0) {
        setMinuteSeries({});
        return;
      }

      try {
        const series = await fetchMinuteSeries(symbols);
        minuteFetchedAtRef.current = Date.now();
        setMinuteSeries(toMinuteSeriesMap(series));
      } catch {
        // 静默失败：这一列显示「—」，行情照旧
      }
    },
    [holdingSymbols],
  );

  useEffect(() => {
    void refreshMinuteSeries(holdingSymbols);
  }, [refreshMinuteSeries, holdingSymbols]);

  useEffect(() => {
    let timerId: number | null = null;

    const clearTimer = (): void => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const startTimer = (): void => {
      clearTimer();

      if (document.visibilityState !== 'visible') {
        return;
      }

      timerId = window.setInterval(() => {
        refreshVisibleData();
      }, REFRESH_INTERVAL_MS);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        refreshVisibleData();
        // 分时另算节流：它比行情贵得多，切标签页不该每次都重打一遍上游
        if (Date.now() - minuteFetchedAtRef.current >= MINUTE_REFRESH_MIN_MS) {
          void refreshMinuteSeries();
        }
        startTimer();
        return;
      }

      clearTimer();
    };

    startTimer();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshVisibleData]);

  useEffect(() => {
    void refreshMarketOverview();
  }, [refreshMarketOverview]);

  useEffect(() => {
    if (activePage !== 'limit-up') {
      return;
    }

    if (activeLimitUpTab === 'pool') {
      void refreshLimitUp();
    } else if (activeLimitUpTab === 'sprint') {
      void refreshSprintLimitUp();
    } else if (limitUpLadder.status === 'unavailable' && !isLimitUpLadderRefreshing) {
      // 两个视图共用同一份响应：已经拿到就不再因为切页签重拉（10 秒定时器照常刷）
      void refreshLimitUpLadder();
    }
  }, [
    activeLimitUpTab,
    activePage,
    isLimitUpLadderRefreshing,
    limitUpLadder.status,
    refreshLimitUp,
    refreshLimitUpLadder,
    refreshSprintLimitUp,
  ]);

  /*
   * 今/昨对比要拿断板那批的今日行情：进页签时先拉一次，
   * 之后不管数据先到还是页签先到，comparisonSymbolKey 变了就会补一次。
   */
  useEffect(() => {
    if (activePage !== 'limit-up' || activeLimitUpTab !== 'comparison') {
      return;
    }

    void refreshComparisonQuotes();
  }, [activeLimitUpTab, activePage, refreshComparisonQuotes]);

  // 自选/持仓页要靠涨停池给名称旁打「涨停 / N 连板」标识，进页面时拉一次
  useEffect(() => {
    if (activePage !== 'watchlist' && activePage !== 'holdings') {
      return;
    }

    if (limitUp.status === 'unavailable' && !isLimitUpRefreshing) {
      void refreshLimitUp();
    }
  }, [
    activePage,
    isLimitUpRefreshing,
    limitUp.status,
    refreshLimitUp,
  ]);

  useEffect(() => {
    if (activePage !== 'dragon-tiger') {
      return;
    }

    void refreshDragonTiger();
  }, [activePage, refreshDragonTiger]);

  useEffect(() => {
    if (activePage !== 'auction') {
      return;
    }

    void refreshAuction();
  }, [activePage, refreshAuction]);

  // 竞价快照到位（或换了一批候选）后补一次实时行情，进竞价页时也走这条
  useEffect(() => {
    if (activePage !== 'auction') {
      return;
    }

    void refreshAuctionQuotes();
  }, [activePage, refreshAuctionQuotes]);

  const closeModal = (): void => setModal(null);

  // 自选页右栏常驻冲刺涨停，首次进入自选页时拉一次
  useEffect(() => {
    if (
      activePage === 'watchlist' &&
      sprintLimitUp.status === 'unavailable' &&
      !isSprintLimitUpRefreshing
    ) {
      void refreshSprintLimitUp();
    }
  }, [
    activePage,
    isSprintLimitUpRefreshing,
    refreshSprintLimitUp,
    sprintLimitUp.status,
  ]);

  // 顶栏「竞价」的计数要在落地页就有数：快照仍预取一次（右栏已经不再展示竞价候选）
  useEffect(() => {
    if (activePage === 'watchlist' && auction.status === 'unavailable' && !isAuctionRefreshing) {
      void refreshAuction();
    }
  }, [activePage, auction.status, isAuctionRefreshing, refreshAuction]);

  // 成功提示不常驻：4 秒后自己收掉，免得和真正的失败提示一直并排挂着
  useEffect(() => {
    if (watchlistNotice === null) {
      return;
    }

    const timerId = window.setTimeout(() => setWatchlistNotice(null), 4000);

    return () => window.clearTimeout(timerId);
  }, [watchlistNotice]);

  const deleteGroupById = (groupId: string): void => {
    commitState((current) => {
      // 组内股票变成「未分配」，只在「全部」里出现
      const moved = moveHoldingsToGroup(current, groupId, '');

      return {
        groups: moved.groups.filter((group) => group.id !== groupId).map((group) => ({ ...group })),
        holdings: moved.holdings.map((holding) => ({ ...holding })),
      };
    });

    if (selectedGroupId === groupId) {
      setSelectedGroupId('all');
    }
  };

  // 「分组管理」面板：增删改都在弹窗里完成，关弹窗之前不打断操作
  const handleManagerAddGroup = ({ name }: GroupDialogValues): void => {
    const group: StockGroup = {
      id: createId(),
      name,
      isSystem: false,
      createdAt: new Date().toISOString(),
    };

    commitState((current) => ({
      groups: [...current.groups, group],
      holdings: current.holdings.map((holding) => ({ ...holding })),
    }));
  };

  const handleManagerRenameGroup = (groupId: string, { name }: GroupDialogValues): void => {
    commitState((current) => ({
      groups: current.groups.map((group) =>
        group.id === groupId ? { ...group, name } : { ...group },
      ),
      holdings: current.holdings.map((holding) => ({ ...holding })),
    }));
  };

  const handleCreateHolding = async (values: HoldingFormValues): Promise<void> => {
    if (isHoldingSubmitting) {
      return;
    }

    setIsHoldingSubmitting(true);

    try {
      const symbol = values.symbol.trim();
      const timestamp = new Date().toISOString();
      const holding: Holding = {
        id: createId(),
        symbol,
        name: values.name.trim() || symbol,
        groupId: values.groupId,
        openPrice: values.openPrice,
        quantity: values.quantity,
        note: values.note,
        createdAt: timestamp,
        updatedAt: timestamp,
        // 自选基准价在记这一条的同时抓：行情已经在手，不用等下一轮
        watchPrice: currentQuotePrice(quotes[symbol]),
        watchPriceAt: timestamp,
      };
      const nextState: StorageState = {
        groups: state.groups.map((group) => ({ ...group })),
        holdings: [...state.holdings.map((item) => ({ ...item })), holding],
      };

      // persistState 放在 try 里：万一它抛错，下面 finally 一定把按钮解锁，
      // 否则 isHoldingSubmitting 会永远停在 true，界面看起来就是「添加失败」
      persistState(nextState);
      await refreshQuotes(nextState.holdings.map((item) => item.symbol));
    } catch (error) {
      setRefreshMessage(
        error instanceof Error ? `添加股票失败：${error.message}` : '添加股票失败，请重试。',
      );
    } finally {
      setIsHoldingSubmitting(false);
      closeModal();
    }
  };

  const handleUpdateHolding = async (values: HoldingFormValues): Promise<void> => {
    if (modal?.type !== 'edit-holding' || isHoldingSubmitting) {
      return;
    }

    const currentHolding = state.holdings.find((holding) => holding.id === modal.holdingId);

    if (!currentHolding) {
      closeModal();
      return;
    }

    const symbol = values.symbol.trim();
    const symbolChanged = symbol !== currentHolding.symbol;
    const nextName =
      symbol === currentHolding.symbol
        ? normalizeDisplayName(quotes[symbol]?.name) ?? currentHolding.name
        : normalizeDisplayName(quotes[symbol]?.name) ?? symbol;
    const timestamp = new Date().toISOString();
    /*
     * 自选基准价按「这条自选是什么时候加的」算，所以改备注/开仓价都保留它。
     * 只有换成另一只股票时才重置：旧基准价是那只票的价格，套到新代码上会算出假收益。
     * 重置后 watchPrice 为空，这一轮刷完行情由 captureWatchPrices 重新记。
     */
    const watchPriceSource = symbolChanged
      ? { watchPrice: currentQuotePrice(quotes[symbol]), watchPriceAt: timestamp }
      : {};
    const nextState: StorageState = {
      groups: state.groups.map((group) => ({ ...group })),
      holdings: state.holdings.map((holding) =>
        holding.id === modal.holdingId
          ? {
              ...holding,
              symbol,
              name: values.name.trim() || nextName,
              groupId: values.groupId,
              openPrice: values.openPrice,
              quantity: values.quantity,
              note: values.note,
              updatedAt: timestamp,
              ...watchPriceSource,
            }
          : { ...holding },
      ),
    };

    setIsHoldingSubmitting(true);

    try {
      persistState(nextState);
      await refreshQuotes(nextState.holdings.map((holding) => holding.symbol));
    } catch (error) {
      setRefreshMessage(
        error instanceof Error ? `保存股票失败：${error.message}` : '保存股票失败，请重试。',
      );
    } finally {
      setIsHoldingSubmitting(false);
      closeModal();
    }
  };

  const handleDeleteHolding = (holding: Holding): void => {
    commitState((current) => ({
      groups: current.groups.map((group) => ({ ...group })),
      holdings: current.holdings
        .filter((item) => item.id !== holding.id)
        .map((item) => ({ ...item })),
    }));
  };

  const editingHolding =
    modal?.type === 'edit-holding'
      ? state.holdings.find((holding) => holding.id === modal.holdingId)
      : undefined;

  const renderDialog = () => {
    if (modal === null) {
      return null;
    }

    return (
      <div className="dialog-backdrop" role="presentation">
        <div className="dialog-stack">
          {modal.type === 'manage-groups' ? (
            <GroupManagerDialog
              groups={state.groups}
              holdings={state.holdings}
              onAdd={handleManagerAddGroup}
              onRename={handleManagerRenameGroup}
              onDelete={deleteGroupById}
              onClose={closeModal}
            />
          ) : null}

          {modal.type === 'create-holding' ? (
            <HoldingForm
              groups={state.groups}
              isSubmitting={isHoldingSubmitting}
              onSearch={searchStocks}
              onSubmit={handleCreateHolding}
              onCancel={closeModal}
            />
          ) : null}

          {modal.type === 'edit-holding' && editingHolding ? (
            <HoldingForm
              groups={state.groups}
              initialHolding={editingHolding}
              isSubmitting={isHoldingSubmitting}
              onSearch={searchStocks}
              onSubmit={handleUpdateHolding}
              onCancel={closeModal}
              onDelete={() => {
                handleDeleteHolding(editingHolding);
                closeModal();
              }}
            />
          ) : null}
        </div>
      </div>
    );
  };

  /** 「轮动」页自己取大盘概览（它只关心 emotion 那部分），这里只接导航计数的摘要 */
  const handleRotationSummary = useCallback((summary: RotationSummary): void => {
    setRotationPlateCount(summary.hasData ? summary.plateCount : null);
  }, []);

  const renderHoldingsPage = () => (
    // 持仓页没有右侧竞价栏，用 --solo 让列表占满整行，否则第二列会空出一条导轨槽
    <div className="workbench workbench--solo">
      <div className="workbench__main">
        {positionedHoldings.length > 0 ? (
          <Overview summary={summary} lastUpdated={lastUpdated} isRefreshing={isRefreshing} />
        ) : null}

        <section className="card panel-card">
          {/* 表头只留左对齐的纯筛选：标题、统计数字、分组增删改都已去掉 */}
          <div className="panel-header">
            <GroupFilter
              groups={state.groups}
              holdings={positionedHoldings}
              selectedGroupId={selectedGroupId}
              allLabel="全部持仓"
              navLabel="持仓筛选"
              onSelect={setSelectedGroupId}
            />
          </div>

          {state.holdings.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>先添加一只股票</h3>
              <p>点右上角「添加股票」；填写开仓价和持有数量后会同步进入「持仓」。</p>
            </div>
          ) : positionedHoldings.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>当前还没有持仓股票</h3>
              <p>所有股票都会显示在「自选」中，补录开仓价和持有数量后进入「持仓」。</p>
            </div>
          ) : filteredHoldings.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>当前分组还没有持仓</h3>
              <p>切换到「全部持仓」，或者把股票加到别的分组。</p>
            </div>
          ) : (
            <HoldingList
              holdings={filteredHoldings}
              quotes={quotes}
              minuteSeries={minuteSeries}
              limitUpInfo={limitUpInfo}
              onEdit={(holding) => setModal({ type: 'edit-holding', holdingId: holding.id })}
            />
          )}
        </section>
      </div>
    </div>
  );

  const renderWatchlistPage = () => (
    <div className="workbench">
      <div className="workbench__main">
        <section className="card panel-card">
          {/* 表头只留左对齐的筛选：左上角统计数字已去掉 */}
          <div className="panel-header">
            <WatchlistFilterBar
              scope={watchlistScope}
              totalCount={state.holdings.length}
              positionCount={positionedHoldings.length}
              holdings={scopeHoldings}
              groups={state.groups}
              selectedGroupId={selectedGroupId}
              onSelectScope={selectWatchlistScope}
              onSelectGroup={selectWatchlistGroup}
              onManageGroups={() => setModal({ type: 'manage-groups' })}
            />
          </div>

          {state.holdings.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>自选列表为空</h3>
              <p>点右上角「添加股票」；填写开仓价和持有数量后会进入「持仓」。</p>
            </div>
          ) : scopeHoldings.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>当前还没有持仓股票</h3>
              <p>补录开仓价和持有数量后，股票会出现在这里。</p>
            </div>
          ) : filteredWatchlist.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>当前分组还没有股票</h3>
              <p>切换到「全部」，或者把股票加到这个分组。</p>
            </div>
          ) : (
            <Watchlist
              holdings={filteredWatchlist}
              quotes={quotes}
              minuteSeries={minuteSeries}
              limitUpInfo={limitUpInfo}
              onEdit={(holding) => setModal({ type: 'edit-holding', holdingId: holding.id })}
            />
          )}
        </section>
      </div>

      <aside className="workbench__rail">
        {/* 右栏看的是「马上要封板的那几只」，点「查看全部」进涨停聚焦的冲刺涨停页签 */}
        <SprintLimitUpRail
          data={sprintLimitUp}
          isRefreshing={isSprintLimitUpRefreshing}
          onRefresh={() => {
            void refreshSprintLimitUp();
          }}
          onOpenAll={() => {
            setActiveLimitUpTab('sprint');
            setActivePage('limit-up');
          }}
        />
      </aside>
    </div>
  );

  return (
    <>
      {/*
       * 背景（斜向渐变 + 左上冷蓝 / 右上暖粉 / 底部青绿三团柔光）统一由 body 绘制，
       * 见 src/styles.css 的 body 规则。
       * 这里原来有三个 .page-glow 节点（filter: blur(80px) 的独立圆），
       * 它们各自栅格化出的矩形边界会和卡片边缘切出一条颜色突变，
       * 所以改成整页一层背景，不再在 DOM 里单独画。
       */}
      <div className="dashboard-shell">
        <PrimaryNav
          activePage={activePage}
          holdingCount={positionedHoldings.length}
          watchlistCount={state.holdings.length}
          limitUpCount={limitUp.status === 'unavailable' ? null : limitUp.items.length}
          auctionCount={auction.status === 'unavailable' ? null : auction.items.length}
          dragonTigerCount={
            dragonTiger.status === 'unavailable' ? null : dragonTiger.items.length
          }
          rotationCount={rotationPlateCount}
          onNavigate={setActivePage}
          isRefreshing={isRefreshing || isMarketRefreshing}
          lastUpdated={lastUpdated ?? marketUpdatedAt}
          onRefresh={() => {
            void refreshQuotes();
            void refreshMarketOverview();
          }}
          onAddHolding={() => setModal({ type: 'create-holding' })}
        />

        <div className="dashboard-layout">
          {/*
           * 所有页面都进「填充模式」：内容区不再整列滚动，
           * 卡片按剩余高度撑满，列表明细超出时在自己的方块里滚动。
           */}
          <main className="dashboard-main dashboard-main--fill">
            {refreshMessage ? (
              <section className="banner banner--warning" aria-live="polite">
                {refreshMessage}
              </section>
            ) : null}

            {watchlistNotice ? (
              <section className="banner banner--success" role="status">
                {watchlistNotice}
              </section>
            ) : null}

            {/* 选股页与涨停聚焦页都不重复展示大盘指数条：这两页看的是板块 / 涨停结构，指数另有专门入口 */}
            {activePage === 'screener' || activePage === 'limit-up' ? null : (
              <MarketOverview
                indices={marketOverview}
                turnover={marketTurnover}
                breadth={marketBreadth}
              />
            )}

            {activePage === 'limit-up' ? (
              <LimitUpFocus
                activeTab={activeLimitUpTab}
                onTabChange={setActiveLimitUpTab}
                poolData={limitUp}
                isPoolRefreshing={isLimitUpRefreshing}
                onRefreshPool={() => {
                  void refreshLimitUp();
                }}
                onAddToWatchlist={handleAddToWatchlist}
                watchlistSymbols={watchlistSymbols}
                ladderData={limitUpLadder}
                isLadderRefreshing={isLimitUpLadderRefreshing}
                onRefreshLadder={() => {
                  void refreshLimitUpLadder();
                }}
                comparisonQuotes={comparisonQuotes}
                sprintData={sprintLimitUp}
                isSprintRefreshing={isSprintLimitUpRefreshing}
                onRefreshSprint={() => {
                  void refreshSprintLimitUp();
                }}
              />
            ) : activePage === 'auction' ? (
              <AuctionList
                data={auction}
                quotes={auctionQuotes}
                isRefreshing={isAuctionRefreshing}
                onRefresh={() => {
                  void refreshAuction();
                  void refreshAuctionQuotes();
                }}
              />
            ) : activePage === 'dragon-tiger' ? (
              <DragonTigerList
                data={dragonTiger}
                isRefreshing={isDragonTigerRefreshing}
                onRefresh={() => {
                  void refreshDragonTiger();
                }}
              />
            ) : activePage === 'rotation' ? (
              <RotationPage onSummary={handleRotationSummary} />
            ) : activePage === 'screener' ? (
              <ScreenerPanel
                activeTab={activeScreenerTab}
                onTabChange={setActiveScreenerTab}
                onAddToWatchlist={handleAddToWatchlist}
                watchlistSymbols={watchlistSymbols}
              />
            ) : activePage === 'holdings' ? (
              renderHoldingsPage()
            ) : (
              renderWatchlistPage()
            )}
          </main>
        </div>

        <footer className="dashboard-footer">
          {/* 大盘行情：和页面顶部同一份数据；涨跌幅用小色块，左上角开始排 */}
          <div className="dashboard-footer__indices">
            {marketOverview.map((index) => (
              <span key={index.symbol} className="dashboard-footer__index">
                <span className="dashboard-footer__index-name">{index.name}</span>
                <b className="dashboard-footer__index-value">{formatIndexValue(index.price)}</b>
                <span className={`dashboard-footer__pct ${getMarketToneClass(index.status, index.pct)}`}>
                  {formatSignedPercent(index.pct)}
                </span>
              </span>
            ))}
          </div>

          {marketBreadth?.status === 'fresh' ? (
            <>
              <i className="dashboard-footer__sep" aria-hidden="true" />
              <div className="dashboard-footer__stats">
                <span className="dashboard-footer__stat">
                  涨 <b className="value--rise">{marketBreadth.riseCount ?? '—'}</b>
                </span>
                <span className="dashboard-footer__stat">
                  跌 <b className="value--fall">{marketBreadth.fallCount ?? '—'}</b>
                </span>
                <span className="dashboard-footer__stat">
                  涨停 <b>{marketBreadth.limitUpCount ?? '—'}</b>
                </span>
                <span className="dashboard-footer__stat">
                  炸板 <b>{marketBreadth.brokenCount ?? '—'}</b>
                </span>
                <span className="dashboard-footer__stat">
                  晋级率{' '}
                  <b>
                    {marketBreadth.promotionRate === null
                      ? '—'
                      : `${marketBreadth.promotionRate.toFixed(1)}%`}
                  </b>
                </span>
              </div>
            </>
          ) : null}

          {/* 时间戳靠右：行情刷新时刻 + 竞价快照日期 */}
          <div className="dashboard-footer__times">
            <span>
              行情 <b>{lastUpdated ? formatTime(lastUpdated) : '—'}</b>
            </span>
            <i className="dashboard-footer__sep" aria-hidden="true" />
            <span>
              竞价快照{' '}
              <b>
                {auction.tradeDate
                  ? `${auction.tradeDate.slice(4, 6)}-${auction.tradeDate.slice(6, 8)} 09:25`
                  : '09:25:00'}
              </b>
            </span>
          </div>
        </footer>
      </div>

      {renderDialog()}
    </>
  );
}
