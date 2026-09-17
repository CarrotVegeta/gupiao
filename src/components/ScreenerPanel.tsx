import { memo, useCallback, useEffect, useState } from 'react';
import type { ThemeItem, ThemesResponse } from '../types';
import { fetchThemes, mergeThemes, unavailableThemes } from '../lib/screener';
import { ThemeBoard } from './ThemeBoard';
import { ThemeDetail } from './ThemeDetail';
import { TrendScanner } from './TrendScanner';

export type ScreenerTab = 'trend' | 'theme';

type ScreenerPanelProps = {
  activeTab: ScreenerTab;
  onTabChange: (tab: ScreenerTab) => void;
  /** 行尾「添加自选」：交给宿主写进自选列表 */
  onAddToWatchlist: (stock: { symbol: string; name: string }) => void;
  /** 已经在自选里的代码集合，用来把「添加自选」按钮置灰 */
  watchlistSymbols: ReadonlySet<string>;
};

/**
 * 选股页容器。
 *
 * 用 `memo` 包住是必需的：App 每 10 秒轮询一次行情并 setState，整棵子树默认都要重渲染，
 * 而这里可能挂着题材详情那张几百行的表。实测（生产构建、静置 40 秒）在 717 行的题材详情上，
 * 轮询带来的纯 reconciliation 空转约 370ms JS，屏幕上一个像素都没变。
 * 生效前提是宿主传下来的 props 引用稳定 —— App 侧 onAddToWatchlist / watchlistSymbols
 * 已经是 useCallback / useMemo，onTabChange 传的是 setState。
 */
export const ScreenerPanel = memo(function ScreenerPanel({
  activeTab,
  onTabChange,
  onAddToWatchlist,
  watchlistSymbols,
}: ScreenerPanelProps) {
  const [themes, setThemes] = useState<ThemesResponse>(() => unavailableThemes('加载中'));
  const [isRefreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ThemeItem | null>(null);

  const refreshThemes = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetchThemes();
      setThemes((previous) => mergeThemes(previous, response));
    } catch (error) {
      setThemes((previous) =>
        mergeThemes(
          previous,
          unavailableThemes(error instanceof Error ? error.message : '题材请求失败'),
        ),
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 只在进入「题材」这一档时才拉数据，避免切到趋势页也白白打一遍三家上游
  useEffect(() => {
    if (activeTab !== 'theme') return;
    if (themes.status === 'fresh') return;
    void refreshThemes();
  }, [activeTab, refreshThemes, themes.status]);

  return (
    <>
      <div className="limit-up-focus-tabs" role="tablist" aria-label="选股分类">
        <button
          className="limit-up-focus-tabs__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'trend'}
          onClick={() => onTabChange('trend')}
        >
          趋势
        </button>
        <button
          className="limit-up-focus-tabs__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'theme'}
          onClick={() => {
            setSelected(null);
            onTabChange('theme');
          }}
        >
          题材
        </button>
      </div>

      {activeTab === 'trend' ? (
        <TrendScanner
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
        />
      ) : null}

      {activeTab === 'theme' ? (
        selected === null ? (
          <ThemeBoard
            data={themes}
            isRefreshing={isRefreshing}
            onRefresh={() => void refreshThemes()}
            onSelect={setSelected}
          />
        ) : (
          <ThemeDetail
            theme={selected}
            tradeDate={themes.tradeDate ?? undefined}
            onBack={() => setSelected(null)}
            onAddToWatchlist={onAddToWatchlist}
            watchlistSymbols={watchlistSymbols}
          />
        )
      ) : null}
    </>
  );
});
