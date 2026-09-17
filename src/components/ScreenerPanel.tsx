import { useCallback, useEffect, useState } from 'react';
import type { ThemeItem, ThemesResponse } from '../types';
import { fetchThemes, mergeThemes, unavailableThemes } from '../lib/screener';
import { ThemeBoard } from './ThemeBoard';
import { ThemeDetail } from './ThemeDetail';
import { TrendScanner } from './TrendScanner';

export type ScreenerTab = 'trend' | 'theme';

type ScreenerPanelProps = {
  activeTab: ScreenerTab;
  onTabChange: (tab: ScreenerTab) => void;
};

export const ScreenerPanel = ({ activeTab, onTabChange }: ScreenerPanelProps) => {
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

      {activeTab === 'trend' ? <TrendScanner /> : null}

      {activeTab === 'theme' ? (
        selected === null ? (
          <ThemeBoard
            data={themes}
            isRefreshing={isRefreshing}
            onRefresh={() => void refreshThemes()}
            onSelect={setSelected}
          />
        ) : (
          <ThemeDetail theme={selected} onBack={() => setSelected(null)} />
        )
      ) : null}
    </>
  );
};
