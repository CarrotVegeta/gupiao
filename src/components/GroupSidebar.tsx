import type { Holding, StockGroup } from '../types';

type GroupSidebarProps = {
  groups: StockGroup[];
  holdings: Holding[];
  selectedGroupId: string;
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
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: GroupSidebarProps) => (
  <aside className="group-sidebar card" aria-labelledby="group-sidebar-title">
    <div className="group-sidebar__header">
      <div>
        <p className="eyebrow">分组导航</p>
        <h2 id="group-sidebar-title">持仓分组</h2>
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
            <span>全部持仓</span>
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

            {!group.isSystem ? (
              <div className="group-sidebar__actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`编辑分组 ${group.name}`}
                  onClick={() => onEdit(group)}
                >
                  编辑
                </button>
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  aria-label={`删除分组 ${group.name}`}
                  onClick={() => onDelete(group)}
                >
                  删除
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  </aside>
);
