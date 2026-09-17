type PrimaryNavProps = {
  activePage: 'holdings' | 'watchlist' | 'limit-up' | 'auction' | 'dragon-tiger';
  holdingCount: number;
  watchlistCount: number;
  limitUpCount: number | null;
  auctionCount?: number | null;
  dragonTigerCount?: number | null;
  onNavigate: (page: 'holdings' | 'watchlist' | 'limit-up' | 'auction' | 'dragon-tiger') => void;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onAddHolding?: () => void;
  lastUpdated?: string | null;
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
  {
    page: 'auction',
    label: '竞价',
    getCount: ({ auctionCount }) => (auctionCount == null ? '—' : auctionCount),
  },
  {
    page: 'dragon-tiger',
    label: '龙虎榜',
    getCount: ({ dragonTigerCount }) => (dragonTigerCount == null ? '—' : dragonTigerCount),
  },
];

export const PrimaryNav = ({
  activePage,
  holdingCount,
  watchlistCount,
  limitUpCount,
  auctionCount = null,
  dragonTigerCount = null,
  onNavigate,
  isRefreshing = false,
  onRefresh,
  onAddHolding,
  lastUpdated = null,
}: PrimaryNavProps) => {
  const props = {
    activePage,
    holdingCount,
    watchlistCount,
    limitUpCount,
    auctionCount,
    dragonTigerCount,
    onNavigate,
  };

  return (
    <header className="app-topbar">
      <p className="app-topbar__brand">
        <span className="app-topbar__mark" aria-hidden="true">
          A
        </span>
        A股看板
      </p>
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
                  {/* 稿子 F 的导航只有文字；数量保留在 aria-label 里给读屏 */}
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {onRefresh || onAddHolding ? (
        <div className="app-topbar__actions">
          {lastUpdated ? (
            <span className="app-topbar__stamp">
              {/* 稿子 F 的时间戳是 09-17 15:00（用 - 分隔，不是 zh-CN 默认的 /） */}
              {new Intl.DateTimeFormat('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })
                .format(new Date(lastUpdated))
                .replace(/\//g, '-')}
            </span>
          ) : null}
          {onRefresh ? (
            <button
              className="button button--secondary button--compact"
              type="button"
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              {isRefreshing ? '刷新中…' : '刷新行情'}
            </button>
          ) : null}
          {onAddHolding ? (
            <button className="button button--compact" type="button" onClick={onAddHolding}>
              <span aria-hidden="true">+</span> 添加股票
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
};
