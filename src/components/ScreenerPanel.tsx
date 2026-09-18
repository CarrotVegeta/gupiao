import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { MainlineReport } from '../types';
import { fetchMainline, unavailableMainline } from '../lib/screener';
import { MainlinePanel, type MainlineLoadState } from './MainlinePanel';
import { TrendScanner } from './TrendScanner';

export type ScreenerTab = 'mainline' | 'trend';

type ScreenerPanelProps = {
  activeTab: ScreenerTab;
  onTabChange: (tab: ScreenerTab) => void;
  /** 行尾「添加自选」：交给宿主写进自选列表 */
  onAddToWatchlist: (stock: { symbol: string; name: string }) => void;
  /** 已经在自选里的代码集合，用来把「添加自选」按钮置灰 */
  watchlistSymbols: ReadonlySet<string>;
};

/**
 * 选股页容器：两档 —— **主线**（多日复盘口径）/ **趋势**（形态扫描）。
 *
 * 2026-09-19：原来还有「板块」（同花顺概念 Top 20）与「细分逻辑」（涨停原因标签）
 * 两档，按用户要求删掉。两档背后的组件与取数函数（`ThemeBoard` / `ThemeDetail` /
 * `fetchThemes` / `fetchTopicThemes`）以及后端 `/api/themes*`、`/api/ths-boards/*`
 * 都保留着，没有从渲染树里删除 —— 想恢复只需把 tab 与分支加回来。
 *
 * 用 `memo` 包住是必需的：App 每 10 秒轮询一次行情并 setState，整棵子树默认都要重渲染，
 * 而这里可能挂着几百行的表格。实测（生产构建、静置 40 秒）在 717 行的表上，
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
  /** 「主线」档：多日口径的报告 */
  const [mainline, setMainline] = useState<MainlineReport>(() => unavailableMainline('—'));
  /**
   * 主线档的加载状态。
   *
   * **必须和「有没有数据」分开**：一次 5 天窗口的请求实测要 7 秒左右
   * （block_top + 涨停池 + realhead 各几十次上游请求），
   * 这期间如果按「boards 为空」渲染，用户看到的就是「暂时没有主线数据」——
   * 明明在加载却像没数据。所以四态分开：
   *   idle        还没开始取
   *   loading     正在取 → 显示「正在拉取」
   *   ready       取到了，有数据
   *   ready-empty 取完了但确实没有（例如非交易日）
   *   error       取失败，显示原因
   */
  const [mainlineState, setMainlineState] = useState<MainlineLoadState>('idle');
  const [mainlineError, setMainlineError] = useState<string | null>(null);
  /** 主线档的回看交易日数 */
  const mainlineDayOptions = [3, 5, 10, 20] as const;
  const [mainlineDays, setMainlineDays] = useState<number>(5);
  /** 防止重复取数（strict mode 下 effect 会跑两次） */
  const inFlight = useRef(false);

  const loadMainline = useCallback(async (days: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMainlineState('loading');
    setMainlineError(null);
    try {
      const report = await fetchMainline({ days });
      setMainline(report);
      // 取到了但一个板块都没有：这是「真的没有」，不是「还在加载」
      setMainlineState(report.boards.length === 0 ? 'ready-empty' : 'ready');
    } catch (error) {
      setMainline(unavailableMainline('—'));
      setMainlineError(error instanceof Error ? error.message : '主线报告请求失败');
      setMainlineState('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  // 进入「主线」档且还没取过数时才拉
  useEffect(() => {
    if (activeTab !== 'mainline') return;
    if (mainlineState !== 'idle') return;
    void loadMainline(mainlineDays);
  }, [activeTab, mainlineState, mainlineDays, loadMainline]);

  return (
    <>
      <div className="limit-up-focus-tabs" role="tablist" aria-label="选股分类">
        <button
          className="limit-up-focus-tabs__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'mainline'}
          onClick={() => onTabChange('mainline')}
        >
          主线
        </button>
        <button
          className="limit-up-focus-tabs__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'trend'}
          onClick={() => onTabChange('trend')}
        >
          趋势
        </button>
      </div>

      {activeTab === 'mainline' ? (
        <>
          <div className="mainline-window-picker" role="group" aria-label="回看交易日数">
            <span className="status-note">回看</span>
            {mainlineDayOptions.map((option) => (
              <button
                className="mainline-window-picker__item"
                key={option}
                type="button"
                aria-pressed={mainlineDays === option}
                disabled={mainlineState === 'loading'}
                onClick={() => {
                  setMainlineDays(option);
                  void loadMainline(option);
                }}
              >
                {option} 天
              </button>
            ))}
          </div>
          <MainlinePanel
            data={mainline}
            loadState={mainlineState}
            loadError={mainlineError}
            onRefresh={() => void loadMainline(mainlineDays)}
          />
        </>
      ) : null}

      {activeTab === 'trend' ? (
        <TrendScanner
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
        />
      ) : null}
    </>
  );
});
