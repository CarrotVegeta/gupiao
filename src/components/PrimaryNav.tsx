type PrimaryNavProps = {
  activePage: 'holdings' | 'watchlist' | 'limit-up';
  holdingCount: number;
  watchlistCount: number;
  limitUpCount: number | null;
  onNavigate: (page: 'holdings' | 'watchlist' | 'limit-up') => void;
};

const navItems: Array<{
  page: PrimaryNavProps['activePage'];
  label: string;
  getCount: (props: PrimaryNavProps) => string | number;
}> = [
  {
    page: 'watchlist',
    label: '自选',
    getCount: ({ watchlistCount }) => watchlistCount,
  },
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
  watchlistCount,
  limitUpCount,
  onNavigate,
}: PrimaryNavProps) => {
  const props = { activePage, holdingCount, watchlistCount, limitUpCount, onNavigate };

  return (
    <header className="app-topbar">
      <p className="app-topbar__brand">A股个人看板</p>
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
    </header>
  );
};
