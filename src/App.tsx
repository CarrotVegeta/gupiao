import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculatePortfolioSummary, hasPositionDetails } from './lib/calculations';
import { DragonTigerList } from './components/DragonTigerList';
import { AuctionList } from './components/AuctionList';
import { MarketOverview } from './components/MarketOverview';
import { PrimaryNav, type PrimaryNavPage } from './components/PrimaryNav';
import { ScreenerPanel, type ScreenerTab } from './components/ScreenerPanel';
import { fetchQuotes, mergeQuotes } from './lib/quotes';
import { searchStocks } from './lib/search';
import { loadState, moveHoldingsToGroup, saveState } from './lib/storage';
import type { GroupDialogValues } from './components/GroupDialog';
import { GroupManagerDialog } from './components/GroupManagerDialog';
import { HoldingForm, type HoldingFormValues } from './components/HoldingForm';
import { HoldingList } from './components/HoldingList';
import { LimitUpFocus, type LimitUpFocusTab } from './components/LimitUpFocus';
import { Overview } from './components/Overview';
import { AuctionRail } from './components/AuctionRail';
import { GroupFilter } from './components/GroupFilter';
import { Watchlist } from './components/Watchlist';
import { WatchlistFilterBar, type WatchlistScope } from './components/WatchlistFilterBar';
import { fetchDragonTiger, mergeDragonTiger } from './lib/dragonTiger';
import { fetchAuction, mergeAuction } from './lib/auction';
import { fetchLimitUp, mergeLimitUp } from './lib/limitUp';
import { toLimitUpInfoMap } from './lib/limitUpInfo';
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
  LimitUpResponse,
  MarketIndex,
  Quote,
  QuotesResponse,
  SprintLimitUpResponse,
  StorageState,
  StockGroup,
} from './types';

const REFRESH_INTERVAL_MS = 10_000;

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
  const [activeScreenerTab, setActiveScreenerTab] = useState<ScreenerTab>('trend');
  const [activeLimitUpTab, setActiveLimitUpTab] = useState<LimitUpFocusTab>('pool');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  // 自选页表头的筛选：范围（全部 / 持仓）和分组合并成一条分段控件
  const [watchlistScope, setWatchlistScope] = useState<WatchlistScope>('all');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
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
  const [isLimitUpRefreshing, setIsLimitUpRefreshing] = useState(false);  const [sprintLimitUp, setSprintLimitUp] = useState<SprintLimitUpResponse>(
    emptySprintLimitUpResponse(),
  );
  const [isSprintLimitUpRefreshing, setIsSprintLimitUpRefreshing] = useState(false);
  const [dragonTiger, setDragonTiger] = useState<DragonTigerResponse>(
    emptyDragonTigerResponse(),
  );
  const [isDragonTigerRefreshing, setIsDragonTigerRefreshing] = useState(false);
  const [auction, setAuction] = useState<AuctionResponse>(emptyAuctionResponse());
  const [isAuctionRefreshing, setIsAuctionRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(
    loadedState.recovered ? '本地数据已恢复为默认状态。' : null,
  );
  const [modal, setModal] = useState<ModalState>(null);
  const [isHoldingSubmitting, setIsHoldingSubmitting] = useState(false);

  const holdingSymbols = useMemo(
    () => unique(state.holdings.map((holding) => holding.symbol)),
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

  const refreshQuotes = useCallback(
    async (symbols: string[] = holdingSymbols): Promise<QuotesResponse | null> => {
      const targets = unique(symbols);

      if (targets.length === 0) {
        return null;
      }

      setIsRefreshing(true);

      try {
        const response = await fetchQuotes(targets);

        setQuotes((current) => mergeQuotes(current, response));
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
    [holdingSymbols],
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

  const refreshVisibleData = useCallback((): void => {
    void refreshMarketOverview();

    if (holdingSymbols.length > 0) {
      void refreshQuotes(holdingSymbols);
    }

    // 自选/持仓的名称旁要用涨停池算连板标识。
    // 池子已经有数据就不再重复拉（和竞价候选侧栏同一个思路），
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
      } else {
        void refreshSprintLimitUp();
      }
    }

    if (activePage === 'dragon-tiger') {
      void refreshDragonTiger();
    }
  }, [
    activePage,
    activeLimitUpTab,
    holdingSymbols,
    limitUp.status,
    refreshDragonTiger,
    refreshLimitUp,
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
    } else {
      void refreshSprintLimitUp();
    }
  }, [activeLimitUpTab, activePage, refreshLimitUp, refreshSprintLimitUp]);

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

  const closeModal = (): void => setModal(null);

  // 落地页右侧常驻竞价候选，首次进入自选页时拉一次
  useEffect(() => {
    if (activePage === 'watchlist' && auction.status === 'unavailable' && !isAuctionRefreshing) {
      void refreshAuction();
    }
  }, [activePage, auction.status, isAuctionRefreshing, refreshAuction]);

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
    const nextName =
      symbol === currentHolding.symbol
        ? normalizeDisplayName(quotes[symbol]?.name) ?? currentHolding.name
        : normalizeDisplayName(quotes[symbol]?.name) ?? symbol;
    const timestamp = new Date().toISOString();
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
              defaultGroupId={selectedGroupId}
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
              limitUpInfo={limitUpInfo}
              onEdit={(holding) => setModal({ type: 'edit-holding', holdingId: holding.id })}
            />
          )}
        </section>
      </div>

      <aside className="workbench__rail">
        <AuctionRail
          data={auction}
          isRefreshing={isAuctionRefreshing}
          onRefresh={() => {
            void refreshAuction();
          }}
          onOpenAll={() => setActivePage('auction')}
        />
      </aside>
    </div>
  );

  return (
    <>
      {/* 稿子 F 的三团背景柔光，卡片玻璃靠它们透出冷暖倾向 */}
      <div className="page-glow page-glow--g1" aria-hidden="true" />
      <div className="page-glow page-glow--g2" aria-hidden="true" />
      <div className="page-glow page-glow--g3" aria-hidden="true" />

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

            <MarketOverview
              indices={marketOverview}
              turnover={marketTurnover}
              breadth={marketBreadth}
            />

            {activePage === 'limit-up' ? (
              <LimitUpFocus
                activeTab={activeLimitUpTab}
                onTabChange={setActiveLimitUpTab}
                poolData={limitUp}
                isPoolRefreshing={isLimitUpRefreshing}
                onRefreshPool={() => {
                  void refreshLimitUp();
                }}
                sprintData={sprintLimitUp}
                isSprintRefreshing={isSprintLimitUpRefreshing}
                onRefreshSprint={() => {
                  void refreshSprintLimitUp();
                }}
              />
            ) : activePage === 'auction' ? (
              <AuctionList
                data={auction}
                isRefreshing={isAuctionRefreshing}
                onRefresh={() => {
                  void refreshAuction();
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
            ) : activePage === 'screener' ? (
              <ScreenerPanel activeTab={activeScreenerTab} onTabChange={setActiveScreenerTab} />
            ) : activePage === 'holdings' ? (
              renderHoldingsPage()
            ) : (
              renderWatchlistPage()
            )}
          </main>
        </div>

        <footer className="dashboard-footer">
          <span>数据源 腾讯 / 东方财富</span>
          <i className="dashboard-footer__sep" aria-hidden="true" />
          <span>行情 {lastUpdated ? formatTime(lastUpdated) : '—'}</span>
          <i className="dashboard-footer__sep" aria-hidden="true" />
          <span>
            竞价快照 {auction.tradeDate ? `${auction.tradeDate.slice(4, 6)}-${auction.tradeDate.slice(6, 8)} 09:25` : '09:25:00'}
          </span>
          {marketBreadth?.status === 'fresh' ? (
            <>
              <i className="dashboard-footer__sep" aria-hidden="true" />
              <span>
                涨停 {marketBreadth.limitUpCount ?? '—'} · 炸板{' '}
                {marketBreadth.brokenCount ?? '—'} · 晋级率{' '}
                {marketBreadth.promotionRate === null
                  ? '—'
                  : `${marketBreadth.promotionRate.toFixed(1)}%`}
              </span>
            </>
          ) : null}
        </footer>
      </div>

      {renderDialog()}
    </>
  );
}
