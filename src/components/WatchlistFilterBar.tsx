import type { Holding, StockGroup } from '../types';

export type WatchlistScope = 'all' | 'position';

type WatchlistFilterBarProps = {
  scope: WatchlistScope;
  totalCount: number;
  positionCount: number;
  /** 已经按范围过滤过的股票，分组数量按它统计，避免和「持仓」档位对不上 */
  holdings: Holding[];
  groups: StockGroup[];
  selectedGroupId: string;
  onSelectScope: (scope: WatchlistScope) => void;
  onSelectGroup: (groupId: string) => void;
  onManageGroups: () => void;
};

const countByGroup = (holdings: Holding[], groupId: string): number =>
  holdings.filter((holding) => holding.groupId === groupId).length;

/**
 * 自选页表头唯一的筛选控件：范围（全部 / 持仓）和分组共用一条分段控件。
 * 分组的新建 / 重命名 / 删除统一收进「分组管理」面板，这里只负责切换。
 */
export const WatchlistFilterBar = ({
  scope,
  totalCount,
  positionCount,
  holdings,
  groups,
  selectedGroupId,
  onSelectScope,
  onSelectGroup,
  onManageGroups,
}: WatchlistFilterBarProps) => {
  /** 「全部」只在既没选持仓、也没选具体分组时高亮 */
  const isAllActive = scope === 'all' && selectedGroupId === 'all';

  return (
    <div className="group-filter">
      <nav className="segmented" aria-label="自选筛选">
        <button
          type="button"
          className={`segmented__item${isAllActive ? ' segmented__item--on' : ''}`}
          aria-current={isAllActive ? 'true' : undefined}
          onClick={() => onSelectScope('all')}
        >
          全部
          <span className="segmented__count" aria-hidden="true">
            {totalCount}
          </span>
        </button>
        <button
          type="button"
          className={`segmented__item${scope === 'position' ? ' segmented__item--on' : ''}`}
          aria-current={scope === 'position' ? 'true' : undefined}
          onClick={() => onSelectScope('position')}
        >
          持仓
          <span className="segmented__count" aria-hidden="true">
            {positionCount}
          </span>
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`segmented__item${
              selectedGroupId === group.id ? ' segmented__item--on' : ''
            }`}
            aria-current={selectedGroupId === group.id ? 'true' : undefined}
            onClick={() => onSelectGroup(group.id)}
          >
            {group.name}
            <span className="segmented__count" aria-hidden="true">
              {countByGroup(holdings, group.id)}
            </span>
          </button>
        ))}
      </nav>

      <button
        className="button button--secondary button--compact"
        type="button"
        onClick={onManageGroups}
      >
        分组管理
      </button>
    </div>
  );
};
