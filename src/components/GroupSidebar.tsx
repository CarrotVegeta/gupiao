import type { Holding, StockGroup } from '../types';

type GroupSidebarProps = {
  groups: StockGroup[];
  holdings: Holding[];
  selectedGroupId: string;
  title?: string;
  allLabel?: string;
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onEdit: (group: StockGroup) => void;
  onDelete: (group: StockGroup) => void;
};

const getCountByGroup = (holdings: Holding[], groupId: string): number =>
  holdings.filter((holding) => holding.groupId === groupId).length;

export const GroupSidebar = ({
  groups,
  holdings,
  selectedGroupId,
  title = '持仓分组',
  allLabel = '全部持仓',
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: GroupSidebarProps) => {
  const selectedCustomGroup = groups.find((group) => group.id === selectedGroupId);

  return (
    <section className="group-sidebar card" aria-labelledby="group-sidebar-title">
      <div className="group-sidebar__header">
        <div>
          <p className="eyebrow">分组导航</p>
          <h2 id="group-sidebar-title">{title}</h2>
        </div>
        <button className="button button--secondary" type="button" onClick={onCreate}>
          新建分组
        </button>
      </div>

      <nav aria-label="持仓筛选">
        <ul className="group-sidebar__list">
          <li className="group-sidebar__item">
            <button
              className="group-sidebar__select"
              type="button"
              aria-current={selectedGroupId === 'all' ? 'true' : undefined}
              onClick={() => onSelect('all')}
            >
              <span>{allLabel}</span>
              <span className="group-sidebar__count" aria-hidden="true">
                {holdings.length}
              </span>
            </button>
          </li>

          {groups.map((group) => (
            <li key={group.id} className="group-sidebar__item">
              <button
                className="group-sidebar__select"
                type="button"
                aria-current={selectedGroupId === group.id ? 'true' : undefined}
                onClick={() => onSelect(group.id)}
              >
                <span>{group.name}</span>
                <span className="group-sidebar__count" aria-hidden="true">
                  {getCountByGroup(holdings, group.id)}
                </span>
              </button>
            </li>
          ))}

          {groups.length === 0 ? (
            <li className="group-sidebar__item">
              <p className="group-sidebar__empty">
                还没有分组。可以直接加股票（显示在「全部」里），也可以点右上角「新建分组」。
              </p>
            </li>
          ) : null}

          {selectedCustomGroup ? (
            <li className="group-sidebar__item">
              <div className="group-sidebar__actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`编辑分组 ${selectedCustomGroup.name}`}
                  onClick={() => onEdit(selectedCustomGroup)}
                >
                  编辑
                </button>
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  aria-label={`删除分组 ${selectedCustomGroup.name}`}
                  onClick={() => onDelete(selectedCustomGroup)}
                >
                  删除
                </button>
              </div>
            </li>
          ) : null}
        </ul>
      </nav>
    </section>
  );
};
