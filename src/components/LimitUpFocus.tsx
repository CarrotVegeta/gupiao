import { LimitUpList } from './LimitUpList';
import { SprintLimitUpList } from './SprintLimitUpList';
import type { LimitUpResponse, SprintLimitUpResponse } from '../types';

export type LimitUpFocusTab = 'pool' | 'sprint';

type LimitUpFocusProps = {
  activeTab: LimitUpFocusTab;
  onTabChange: (tab: LimitUpFocusTab) => void;
  poolData: LimitUpResponse;
  isPoolRefreshing: boolean;
  onRefreshPool: () => void;
  sprintData: SprintLimitUpResponse;
  isSprintRefreshing: boolean;
  onRefreshSprint: () => void;
};

const LimitUpFocus = ({
  activeTab,
  onTabChange,
  poolData,
  isPoolRefreshing,
  onRefreshPool,
  sprintData,
  isSprintRefreshing,
  onRefreshSprint,
}: LimitUpFocusProps) => (
  <>
    <div className="limit-up-focus-tabs" role="tablist" aria-label="涨停聚焦分类">
      <button
        id="limit-up-focus-tab-pool"
        className="limit-up-focus-tabs__tab"
        type="button"
        role="tab"
        aria-selected={activeTab === 'pool'}
        aria-controls="limit-up-focus-panel"
        onClick={() => onTabChange('pool')}
      >
        涨停池
      </button>
      <button
        id="limit-up-focus-tab-sprint"
        className="limit-up-focus-tabs__tab"
        type="button"
        role="tab"
        aria-selected={activeTab === 'sprint'}
        aria-controls="limit-up-focus-panel"
        onClick={() => onTabChange('sprint')}
      >
        冲刺涨停
      </button>
    </div>
    <div id="limit-up-focus-panel" role="tabpanel" aria-label={activeTab === 'pool' ? '涨停池' : '冲刺涨停'}>
      {activeTab === 'pool' ? (
        <LimitUpList data={poolData} isRefreshing={isPoolRefreshing} onRefresh={onRefreshPool} />
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
