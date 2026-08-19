type PrimaryNavProps = {
  activePage: 'holdings' | 'limit-up';
  holdingCount: number;
  limitUpCount: number | null;
  onNavigate: (page: 'holdings' | 'limit-up') => void;
};

const navItems: Array<{
  page: PrimaryNavProps['activePage'];
  label: string;
  getCount: (props: PrimaryNavProps) => string | number;
}> = [
  {
    page: 'holdings',
    label: '持仓',
    getCount: ({ holdingCount }) => holdingCount,
  },
  {
    page: 'limit-up',
    label: '涨停聚焦',
    getCount: ({ limitUpCount }) => (limitUpCount === null ? '—' : limitUpCount),
  },
];

export const PrimaryNav = ({
  activePage,
  holdingCount,
  limitUpCount,
  onNavigate,
}: PrimaryNavProps) => {
  const props = { activePage, holdingCount, limitUpCount, onNavigate };

  return (
    <nav className="card" aria-label="一级导航">
      <ul className="group-sidebar__list">
        {navItems.map((item) => {
          const count = item.getCount(props);

          return (
            <li key={item.page} className="group-sidebar__item">
              <button
                className="group-sidebar__select"
                type="button"
                aria-label={`${item.label} ${count}`}
                aria-current={activePage === item.page ? 'page' : undefined}
                onClick={() => onNavigate(item.page)}
              >
                <span>{item.label}</span>
                <span className="group-sidebar__count">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
