import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculatePortfolioSummary } from './lib/calculations';
import { fetchQuotes, mergeQuotes } from './lib/quotes';
import { loadState, moveHoldingsToGroup, saveState } from './lib/storage';
import { GroupDialog, type GroupDialogValues } from './components/GroupDialog';
import { GroupSidebar } from './components/GroupSidebar';
import { HoldingForm, type HoldingFormValues } from './components/HoldingForm';
import { HoldingList } from './components/HoldingList';
import { Overview } from './components/Overview';
import type { Holding, Quote, QuotesResponse, StorageState, StockGroup } from './types';

const REFRESH_INTERVAL_MS = 30_000;

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

const getQuoteName = (response: QuotesResponse | null, symbol: string): string | null =>
  normalizeDisplayName(response?.quotes.find((quote) => quote.symbol === symbol)?.name);

const isQuoteStale = (quote: Quote | undefined): boolean => quote?.status === 'stale';

export default function App() {
  const [loadedState] = useState(() => loadState(localStorage));
  const [state, setState] = useState<StorageState>(loadedState.state);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(
    loadedState.recovered ? '本地数据已恢复为默认状态。' : null,
  );
  const [modal, setModal] = useState<ModalState>(null);

  const holdingSymbols = useMemo(
    () => unique(state.holdings.map((holding) => holding.symbol)),
    [state.holdings],
  );

  const selectedGroup = useMemo(
    () => state.groups.find((group) => group.id === selectedGroupId) ?? null,
    [selectedGroupId, state.groups],
  );

  const filteredHoldings = useMemo(() => {
    if (selectedGroupId === 'all') {
      return state.holdings;
    }

    return state.holdings.filter((holding) => holding.groupId === selectedGroupId);
  }, [selectedGroupId, state.holdings]);

  const summary = useMemo(
    () => calculatePortfolioSummary(filteredHoldings, quotes),
    [filteredHoldings, quotes],
  );

  const allVisibleQuotesAreStale = useMemo(() => {
    if (filteredHoldings.length === 0) {
      return false;
    }

    const visibleQuotes = filteredHoldings.map((holding) => quotes[holding.symbol]);

    return visibleQuotes.length > 0 && visibleQuotes.every(isQuoteStale);
  }, [filteredHoldings, quotes]);

  const commitState = useCallback((updater: (current: StorageState) => StorageState) => {
    setState((current) => {
      const next = updater(current);
      saveState(localStorage, next);
      return next;
    });
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

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      return;
    }

    void refreshQuotes(holdingSymbols);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      return;
    }

    let timerId: number | null = null;

    const clearTimer = (): void => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const startTimer = (): void => {
      clearTimer();

      if (document.visibilityState !== 'visible' || holdingSymbols.length === 0) {
        return;
      }

      timerId = window.setInterval(() => {
        void refreshQuotes(holdingSymbols);
      }, REFRESH_INTERVAL_MS);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && holdingSymbols.length > 0) {
        void refreshQuotes(holdingSymbols);
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
  }, [holdingSymbols, refreshQuotes]);

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
    const symbol = values.symbol.trim();
    const response = await refreshQuotes([symbol]);
    const quoteName = getQuoteName(response, symbol) ?? symbol;
    const timestamp = new Date().toISOString();
    const holding: Holding = {
      id: createId(),
      symbol,
      name: quoteName,
      groupId: values.groupId,
      openPrice: values.openPrice,
      quantity: values.quantity,
      note: values.note,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    commitState((current) => ({
      groups: current.groups.map((group) => ({ ...group })),
      holdings: [...current.holdings, holding],
    }));
    closeModal();
  };

  const handleUpdateHolding = async (values: HoldingFormValues): Promise<void> => {
    if (modal?.type !== 'edit-holding') {
      return;
    }

    const currentHolding = state.holdings.find((holding) => holding.id === modal.holdingId);

    if (!currentHolding) {
      closeModal();
      return;
    }

    const symbol = values.symbol.trim();
    const response =
      symbol === currentHolding.symbol ? null : await refreshQuotes([symbol]);
    const nextName =
      symbol === currentHolding.symbol
        ? getQuoteName(response, symbol) ?? normalizeDisplayName(quotes[symbol]?.name) ?? currentHolding.name
        : getQuoteName(response, symbol) ?? normalizeDisplayName(quotes[symbol]?.name) ?? symbol;

    commitState((current) => ({
      groups: current.groups.map((group) => ({ ...group })),
      holdings: current.holdings.map((holding) =>
        holding.id === modal.holdingId
          ? {
              ...holding,
              symbol,
              name: nextName,
              groupId: values.groupId,
              openPrice: values.openPrice,
              quantity: values.quantity,
              note: values.note,
              updatedAt: new Date().toISOString(),
            }
          : { ...holding },
      ),
    }));
    closeModal();
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
              />
              <div className="dialog-card dialog-card--danger">
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
            </>
          ) : null}

          {modal.type === 'create-holding' ? (
            <HoldingForm
              groups={state.groups}
              onSubmit={(values) => {
                void handleCreateHolding(values);
              }}
              onCancel={closeModal}
            />
          ) : null}

          {modal.type === 'edit-holding' && editingHolding ? (
            <HoldingForm
              groups={state.groups}
              initialHolding={editingHolding}
              onSubmit={(values) => {
                void handleUpdateHolding(values);
              }}
              onCancel={closeModal}
            />
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <>
      <main className="app-shell">
        <div className="dashboard-grid">
          <div className="sidebar-column">
            <GroupSidebar
              groups={state.groups}
              holdings={state.holdings}
              selectedGroupId={selectedGroupId}
              onSelect={setSelectedGroupId}
              onCreate={() => setModal({ type: 'create-group' })}
              onEdit={(group) => setModal({ type: 'edit-group', groupId: group.id })}
              onDelete={(group) => setModal({ type: 'edit-group', groupId: group.id })}
            />
          </div>

          <div className="content-column">
            {refreshMessage ? (
              <section className="banner banner--warning" aria-live="polite">
                {refreshMessage}
              </section>
            ) : null}

            {state.holdings.length === 0 ? (
              <section className="card empty-state" aria-live="polite">
                <p className="eyebrow">空白仪表盘</p>
                <h2>先添加一只股票，开始跟踪收益表现</h2>
                <p>你可以先新建分组，也可以直接把第一只持仓放到“未分组”。</p>
                <button className="button" type="button" onClick={() => setModal({ type: 'create-holding' })}>
                  添加股票
                </button>
              </section>
            ) : (
              <>
                <Overview
                  summary={summary}
                  lastUpdated={lastUpdated}
                  isRefreshing={isRefreshing}
                  onRefresh={() => {
                    void refreshQuotes();
                  }}
                />

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

                  {allVisibleQuotesAreStale ? (
                    <p className="stale-note" aria-live="polite">
                      当前行情全部来自上一轮刷新，请稍后重试。
                    </p>
                  ) : null}

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
            )}
          </div>
        </div>
      </main>

      {renderDialog()}
    </>
  );
}
