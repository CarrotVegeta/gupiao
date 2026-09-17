import { LimitUpList } from './LimitUpList';
import { SprintLimitUpList } from './SprintLimitUpList';
import { LimitUpLadder } from './LimitUpLadder';
import { LimitUpComparison } from './LimitUpComparison';
import type {
  LimitUpLadderResponse,
  LimitUpResponse,
  Quote,
  SprintLimitUpResponse,
} from '../types';

export type LimitUpFocusTab = 'pool' | 'comparison' | 'ladder' | 'sprint';

export const LIMIT_UP_FOCUS_TABS: Array<{ id: LimitUpFocusTab; label: string }> = [
  { id: 'pool', label: '涨停池' },
  { id: 'sprint', label: '冲刺涨停' },
  { id: 'comparison', label: '今/昨对比' },
  { id: 'ladder', label: '连板天梯' },
];

type LimitUpFocusProps = {
  activeTab: LimitUpFocusTab;
  onTabChange: (tab: LimitUpFocusTab) => void;
  poolData: LimitUpResponse;
  isPoolRefreshing: boolean;
  onRefreshPool: () => void;
  /** 涨停池行尾的「添加自选」，原样转给 LimitUpList */
  onAddToWatchlist: (stock: { symbol: string; name: string }) => void;
  /** 已经在自选里的代码集合，用来把「添加自选」按钮置灰 */
  watchlistSymbols: ReadonlySet<string>;
  ladderData: LimitUpLadderResponse;
  isLadderRefreshing: boolean;
  onRefreshLadder: () => void;
  /** 今/昨对比左列里断板那批的今日行情（涨停池里没有它们） */
  comparisonQuotes: Record<string, Quote>;
  sprintData: SprintLimitUpResponse;
  isSprintRefreshing: boolean;
  onRefreshSprint: () => void;
};

const PANEL_LABELS: Record<LimitUpFocusTab, string> = {
  pool: '涨停池',
  comparison: '今/昨对比',
  ladder: '连板天梯',
  sprint: '冲刺涨停',
};

const LimitUpFocus = ({
  activeTab,
  onTabChange,
  poolData,
  isPoolRefreshing,
  onRefreshPool,
  onAddToWatchlist,
  watchlistSymbols,
  ladderData,
  isLadderRefreshing,
  onRefreshLadder,
  comparisonQuotes,
  sprintData,
  isSprintRefreshing,
  onRefreshSprint,
}: LimitUpFocusProps) => (
  <>
    <div className="limit-up-focus-tabs" role="tablist" aria-label="涨停聚焦分类">
      {LIMIT_UP_FOCUS_TABS.map((tab) => (
        <button
          key={tab.id}
          id={`limit-up-focus-tab-${tab.id}`}
          className="limit-up-focus-tabs__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls="limit-up-focus-panel"
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
    <div id="limit-up-focus-panel" role="tabpanel" aria-label={PANEL_LABELS[activeTab]}>
      {activeTab === 'pool' ? (
        <LimitUpList
          data={poolData}
          isRefreshing={isPoolRefreshing}
          onRefresh={onRefreshPool}
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
        />
      ) : activeTab === 'comparison' ? (
        <LimitUpComparison
          data={ladderData}
          isRefreshing={isLadderRefreshing}
          onRefresh={onRefreshLadder}
          quotes={comparisonQuotes}
        />
      ) : activeTab === 'ladder' ? (
        <LimitUpLadder
          data={ladderData}
          isRefreshing={isLadderRefreshing}
          onRefresh={onRefreshLadder}
        />
      ) : (
        <SprintLimitUpList
          data={sprintData}
          isRefreshing={isSprintRefreshing}
          onRefresh={onRefreshSprint}
        />
      )}
    </div>
  </>
);

export { LimitUpFocus };
