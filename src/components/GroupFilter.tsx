import type { Holding, StockGroup } from '../types';

type GroupFilterProps = {
  groups: StockGroup[];
  holdings: Holding[];
  selectedGroupId: string;
  allLabel?: string;
  navLabel?: string;
  onSelect: (groupId: string) => void;
};

const countByGroup = (holdings: Holding[], groupId: string): number =>
  holdings.filter((holding) => holding.groupId === groupId).length;

/**
 * 分组筛选：分段控件，放在列表卡片表头里，不再单独占一张卡。
 * 这里只有纯筛选——分组的增删改统一收在自选页的「分组管理」面板。
 */
export const GroupFilter = ({
  groups,
  holdings,
  selectedGroupId,
  allLabel = '全部',
  navLabel = '自选筛选',
  onSelect,
}: GroupFilterProps) => (
  <div className="group-filter">
    <nav className="segmented" aria-label={navLabel}>
      <button
        type="button"
        className={`segmented__item${selectedGroupId === 'all' ? ' segmented__item--on' : ''}`}
        aria-current={selectedGroupId === 'all' ? 'true' : undefined}
        onClick={() => onSelect('all')}
      >
        {allLabel}
        <span className="segmented__count" aria-hidden="true">
          {holdings.length}
        </span>
      </button>
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          className={`segmented__item${selectedGroupId === group.id ? ' segmented__item--on' : ''}`}
          aria-current={selectedGroupId === group.id ? 'true' : undefined}
          onClick={() => onSelect(group.id)}
        >
          {group.name}
          <span className="segmented__count" aria-hidden="true">
            {countByGroup(holdings, group.id)}
          </span>
        </button>
      ))}
    </nav>
  </div>
);
