import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculatePortfolioSummary, hasPositionDetails } from './lib/calculations';
import { LimitUpList } from './components/LimitUpList';
import { MarketOverview } from './components/MarketOverview';
import { PrimaryNav } from './components/PrimaryNav';
import { fetchQuotes, mergeQuotes } from './lib/quotes';
import { searchStocks } from './lib/search';
import { loadState, moveHoldingsToGroup, saveState } from './lib/storage';
import { GroupDialog, type GroupDialogValues } from './components/GroupDialog';
import { GroupSidebar } from './components/GroupSidebar';
import { HoldingForm, type HoldingFormValues } from './components/HoldingForm';
import { HoldingList } from './components/HoldingList';
import { Overview } from './components/Overview';
import { Watchlist } from './components/Watchlist';
import { fetchLimitUp, mergeLimitUp } from './lib/limitUp';
import {
  createUnavailableMarketIndices,
  createUnavailableMarketOverviewResponse,
  fetchMarketOverview,
  marketIndicesInDisplayOrder,
  mergeMarketOverview,
} from './lib/market';
import type {
  Holding,
  LimitUpResponse,
  MarketIndex,
  Quote,
  QuotesResponse,
  StorageState,
  StockGroup,
} from './types';

const REFRESH_INTERVAL_MS = 10_000;

type ModalState =
  | { type: 'create-group' }
  | { type: 'edit-group'; groupId: string }
  | { type: 'create-holding' }
  | { type: 'edit-holding'; holdingId: string }
  | null;

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

const buildLimitUpUnavailableResponse = (fetchedAt: string): LimitUpResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: '涨停池刷新失败',
});

export default function App() {
  const [loadedState] = useState(() => loadState(localStorage));
  const [state, setState] = useState<StorageState>(loadedState.state);
  const [activePage, setActivePage] = useState<'holdings' | 'watchlist' | 'limit-up'>('holdings');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketIndices, setMarketIndices] = useState<Record<string, MarketIndex>>(
    createUnavailableMarketIndices,
  );
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
  const [isMarketRefreshing, setIsMarketRefreshing] = useState(false);
  const [limitUp, setLimitUp] = useState<LimitUpResponse>(emptyLimitUpResponse());
  const [isLimitUpRefreshing, setIsLimitUpRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(
    loadedState.recovered ? '本地数据已恢复为默认状态。' : null,
  );
  const [modal, setModal] = useState<ModalState>(null);
  const [isHoldingSubmitting, setIsHoldingSubmitting] = useState(false);

  const holdingSymbols = useMemo(
    () => unique(state.holdings.map((holding) => holding.symbol)),
    [state.holdings],
  );

  const selectedGroup = useMemo(
    () => state.groups.find((group) => group.id === selectedGroupId) ?? null,
    [selectedGroupId, state.groups],
  );

  const positionedHoldings = useMemo(
    () => state.holdings.filter(hasPositionDetails),
    [state.holdings],
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

  const filteredHoldings = useMemo(
    () => filterByGroup(positionedHoldings),
    [filterByGroup, positionedHoldings],
  );

  const filteredWatchlist = useMemo(
    () => filterByGroup(state.holdings),
    [filterByGroup, state.holdings],
  );

  const summary = useMemo(
    () => calculatePortfolioSummary(filteredHoldings, quotes),
    [filteredHoldings, quotes],
  );

  const marketOverview = useMemo(
    () => marketIndicesInDisplayOrder(marketIndices),
    [marketIndices],
  ); // 指数按固定展示顺序排列

  const commitState = useCallback((updater: (current: StorageState) => StorageState) => {
    setState((current) => {
      const next = updater(current);
      saveState(localStorage, next);
      return next;
    });
  }, []);

  const persistState = useCallback((next: StorageState): void => {
    saveState(localStorage, next);
    setState(next);
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

  const refreshVisibleData = useCallback((): void => {
    void refreshMarketOverview();

    if (holdingSymbols.length > 0) {
      void refreshQuotes(holdingSymbols);
    }

    if (activePage === 'limit-up') {
      void refreshLimitUp();
    }
  }, [activePage, holdingSymbols, refreshLimitUp, refreshMarketOverview, refreshQuotes]);

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

    void refreshLimitUp();
  }, [activePage, refreshLimitUp]);

  const closeModal = (): void => setModal(null);

  const handleCreateGroup = ({ name }: GroupDialogValues): void => {
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
    closeModal();
  };

  const handleUpdateGroup = ({ name }: GroupDialogValues): void => {
    if (modal?.type !== 'edit-group') {
      return;
    }

    commitState((current) => ({
      groups: current.groups.map((group) =>
        group.id === modal.groupId ? { ...group, name } : { ...group },
      ),
      holdings: current.holdings.map((holding) => ({ ...holding })),
    }));
    closeModal();
  };

  const handleDeleteGroup = (): void => {
    if (modal?.type !== 'edit-group') {
      return;
    }

    commitState((current) => {
      const moved = moveHoldingsToGroup(current, modal.groupId, 'ungrouped');

      return {
        groups: moved.groups.filter((group) => group.id !== modal.groupId).map((group) => ({ ...group })),
        holdings: moved.holdings.map((holding) => ({ ...holding })),
      };
    });

    if (selectedGroupId === modal.groupId) {
      setSelectedGroupId('ungrouped');
    }

    closeModal();
  };

  const handleCreateHolding = async (values: HoldingFormValues): Promise<void> => {
    if (isHoldingSubmitting) {
      return;
    }

    setIsHoldingSubmitting(true);
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

    persistState(nextState);

    try {
      await refreshQuotes(nextState.holdings.map((item) => item.symbol));
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
    persistState(nextState);

    try {
      await refreshQuotes(nextState.holdings.map((holding) => holding.symbol));
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

  const editingGroup =
    modal?.type === 'edit-group'
      ? state.groups.find((group) => group.id === modal.groupId)
      : undefined;

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
          {modal.type === 'create-group' ? (
            <GroupDialog
              existingNames={state.groups.map((group) => group.name)}
              onSubmit={handleCreateGroup}
              onCancel={closeModal}
            />
          ) : null}

          {modal.type === 'edit-group' && editingGroup ? (
            <>
              <GroupDialog
                initialGroup={editingGroup}
                existingNames={state.groups.map((group) => group.name)}
                onSubmit={handleUpdateGroup}
                onCancel={closeModal}
              >
                <div className="dialog-card__danger">
                  <div className="dialog-card__header">
                    <div>
                      <p className="eyebrow">危险操作</p>
                      <h2>删除分组</h2>
                    </div>
                  </div>
                  <p className="dialog-card__body">
                    删除后，该分组下的股票会自动移动到“未分组”。
                  </p>
                  <div className="form-actions">
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={closeModal}
                    >
                      取消
                    </button>
                    <button className="button button--danger" type="button" onClick={handleDeleteGroup}>
                      删除分组
                    </button>
                  </div>
                </div>
              </GroupDialog>
            </>
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
            />
          ) : null}
        </div>
      </div>
    );
  };

  const renderGroupSidebar = (holdings: Holding[], title: string, allLabel: string) => (
    <GroupSidebar
      groups={state.groups}
      holdings={holdings}
      selectedGroupId={selectedGroupId}
      title={title}
      allLabel={allLabel}
      onSelect={setSelectedGroupId}
      onCreate={() => setModal({ type: 'create-group' })}
      onEdit={(group) => setModal({ type: 'edit-group', groupId: group.id })}
      onDelete={(group) => setModal({ type: 'edit-group', groupId: group.id })}
    />
  );

  const renderEmptyState = (eyebrow: string, title: string, description: string) => (
    <section className="card empty-state" aria-live="polite">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      <button
        className="button"
        type="button"
        onClick={() => setModal({ type: 'create-holding' })}
      >
        添加股票
      </button>
    </section>
  );

  const renderHoldingsPage = () => {
    if (state.holdings.length === 0) {
      return (
        <>
          {renderGroupSidebar(positionedHoldings, '持仓分组', '全部持仓')}
          {renderEmptyState(
            '空白仪表盘',
            '先添加一只股票，开始跟踪收益表现',
            '所有添加的股票都会进入“自选”，填写开仓价和持有数量后会同步进入“持仓”。',
          )}
        </>
      );
    }

    if (positionedHoldings.length === 0) {
      return (
        <>
          {renderGroupSidebar(positionedHoldings, '持仓分组', '全部持仓')}
          {renderEmptyState(
            '暂无持仓',
            '当前还没有持仓股票',
            '所有添加的股票都会显示在“自选”中，补录开仓价和持有数量后会同步进入“持仓”。',
          )}
        </>
      );
    }

    return (
      <>
        {renderGroupSidebar(positionedHoldings, '持仓分组', '全部持仓')}

        <section className="card holdings-panel">
          <div className="holdings-panel__header">
            <div>
              <p className="eyebrow">
                {selectedGroupId === 'all'
                  ? '全部持仓'
                  : selectedGroup?.name ?? '当前分组'}
              </p>
              <h2>股票列表</h2>
            </div>
            <button
              className="button"
              type="button"
              onClick={() => setModal({ type: 'create-holding' })}
            >
              添加股票
            </button>
          </div>

          {filteredHoldings.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>当前分组还没有持仓</h3>
              <p>你可以切换到“未分组”，或者把股票添加到这个分组。</p>
            </div>
          ) : (
            <HoldingList
              holdings={filteredHoldings}
              quotes={quotes}
              onEdit={(holding) => setModal({ type: 'edit-holding', holdingId: holding.id })}
              onDelete={handleDeleteHolding}
            />
          )}
        </section>
      </>
    );
  };

  const renderWatchlistPage = () => {
    if (state.holdings.length === 0) {
      return (
        <>
          {renderGroupSidebar(state.holdings, '自选分组', '全部自选')}
          {renderEmptyState(
            '自选',
            '自选列表为空',
            '添加股票后会显示在“自选”中，填写开仓价和持有数量可同步进入“持仓”。',
          )}
        </>
      );
    }

    return (
      <>
        {renderGroupSidebar(state.holdings, '自选分组', '全部自选')}

        <section className="card holdings-panel">
          <div className="holdings-panel__header">
            <div>
              <p className="eyebrow">
                {selectedGroupId === 'all'
                  ? '全部自选'
                  : selectedGroup?.name ?? '当前分组'}
              </p>
              <h2>自选股票</h2>
            </div>
            <div className="holdings-panel__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isRefreshing}
                onClick={() => {
                  void refreshQuotes();
                }}
              >
                {isRefreshing ? '刷新中…' : '刷新行情'}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => setModal({ type: 'create-holding' })}
              >
                添加股票
              </button>
            </div>
          </div>

          {filteredWatchlist.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <h3>当前分组还没有自选股票</h3>
              <p>你可以切换到“全部自选”，或者把股票添加到这个分组。</p>
            </div>
          ) : (
            <Watchlist
              holdings={filteredWatchlist}
              quotes={quotes}
              onEdit={(holding) => setModal({ type: 'edit-holding', holdingId: holding.id })}
              onDelete={handleDeleteHolding}
            />
          )}
        </section>
      </>
    );
  };

  return (
    <>
      <div className="dashboard-shell">
        <PrimaryNav
          activePage={activePage}
          holdingCount={positionedHoldings.length}
          watchlistCount={state.holdings.length}
          limitUpCount={limitUp.status === 'unavailable' ? null : limitUp.items.length}
          onNavigate={setActivePage}
        />

        <div className="dashboard-layout">
          <main className="dashboard-main">
            {refreshMessage ? (
              <section className="banner banner--warning" aria-live="polite">
                {refreshMessage}
              </section>
            ) : null}

            <MarketOverview
              indices={marketOverview}
              lastUpdated={marketUpdatedAt}
              isRefreshing={isMarketRefreshing}
              onRefresh={() => {
                void refreshMarketOverview();
              }}
            />

            {activePage === 'holdings' && positionedHoldings.length > 0 ? (
              <Overview
                summary={summary}
                lastUpdated={lastUpdated}
                isRefreshing={isRefreshing}
                onRefresh={() => {
                  void refreshQuotes();
                }}
              />
            ) : null}

            {activePage === 'limit-up' ? (
              <LimitUpList
                data={limitUp}
                isRefreshing={isLimitUpRefreshing}
                onRefresh={() => {
                  void refreshLimitUp();
                }}
              />
            ) : activePage === 'holdings' ? (
              renderHoldingsPage()
            ) : (
              renderWatchlistPage()
            )}
          </main>
        </div>
      </div>

      {renderDialog()}
    </>
  );
}
