import { useCallback, useEffect, useState } from 'react';
import type { ThemeItem, ThemeStockItem, ThemeStocksResponse, ThemeStockRole } from '../types';
import { THEME_STOCK_ROLES } from '../types';
import { fetchThemeStocks, unavailableThemeStocks } from '../lib/screener';
import { StockIdentity } from './StockIdentity';
import { formatPrice } from '../lib/quotes';

type ThemeDetailProps = {
  theme: ThemeItem;
  onBack: () => void;
};

const ROLE_LABELS: Record<ThemeStockRole, string> = {
  leader: '主线龙头',
  turnover: '主线换手核心',
  trend: '主线趋势中军',
  laggard: '主线低位补涨',
};

/** 「主线趋势中军」相关的回测提示：均线多头是毒源，这里只展示不筛除 */
const TREND_ROLE_NOTE =
  '本标签不再把「MA5>MA10>MA20」当硬条件——回测显示只加这一个条件，主线池 T+10 超额就从 +0.084% 崩到 −2.426%（t=−2.25）。均线排列只作为展示列。';

const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatAmount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value / 1e8).toFixed(2)} 亿`;

const pctClass = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '' : value >= 0 ? ' is-up' : ' is-down';

const maView = (item: ThemeStockItem): { bull: boolean | null } => ({
  bull: item.ma5 === null || item.ma10 === null || item.ma20 === null ? null : item.maBull,
});

export const ThemeDetail = ({ theme, onBack }: ThemeDetailProps) => {
  const [role, setRole] = useState<ThemeStockRole>('leader');
  const [data, setData] = useState<ThemeStocksResponse>(() =>
    unavailableThemeStocks('leader', '加载中'),
  );
  const [isRefreshing, setRefreshing] = useState(false);

  const refresh = useCallback(
    async (nextRole: ThemeStockRole) => {
      setRefreshing(true);
      try {
        setData(await fetchThemeStocks(theme.code, nextRole));
      } catch (error) {
        setData(
          unavailableThemeStocks(
            nextRole,
            error instanceof Error ? error.message : '题材详情请求失败',
          ),
        );
      } finally {
        setRefreshing(false);
      }
    },
    [theme.code],
  );

  useEffect(() => {
    void refresh(role);
  }, [refresh, role]);

  const items = data.items;

  return (
    <section className="card" aria-labelledby="theme-detail-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">
            <button className="link-button" type="button" onClick={onBack}>
              ← 返回题材列表
            </button>
          </p>
          <h2 id="theme-detail-title">
            {theme.name} · {theme.limitUpCount} 只涨停 · 最高 {theme.maxBoardLabel ?? '—'} · 持续{' '}
            {theme.durationDays} 天
          </h2>
        </div>
        <div className="overview__actions limit-up-list__actions">
          <p className="overview__meta">
            评分：<span>{theme.score}/8</span>
          </p>
          <p className="overview__meta">
            扫描：<span>{data.scanned} 只</span> · 命中：<span>{items.length} 只</span>
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void refresh(role)}
            disabled={isRefreshing}
          >
            {isRefreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <ul className="theme-detail__metrics">
        {theme.metrics.map((metric) => (
          <li
            key={metric.key}
            className={`theme-detail__metric${metric.hit ? ' theme-detail__metric--hit' : ''}`}
            title={metric.detail}
          >
            <span className="theme-detail__metric-label">{metric.label}</span>
            <span className="theme-detail__metric-value">{metric.value}</span>
          </li>
        ))}
      </ul>

      {theme.catalysts.length > 0 ? (
        <p className="status-note">涨停原因：{theme.catalysts.join(' · ')}</p>
      ) : null}

      <div className="limit-up-focus-tabs" role="tablist" aria-label="题材标签">
        {THEME_STOCK_ROLES.map((key) => (
          <button
            key={key}
            className="limit-up-focus-tabs__tab"
            type="button"
            role="tab"
            aria-selected={role === key}
            onClick={() => setRole(key)}
          >
            {ROLE_LABELS[key]}
          </button>
        ))}
      </div>

      {role === 'trend' ? <p className="status-note">{TREND_ROLE_NOTE}</p> : null}

      {data.status === 'unavailable' ? (
        <div className="banner banner--warning" role="status">
          <p>该标签数据暂不可用。</p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>
            {isRefreshing
              ? '正在筛选中…'
              : `没有满足「${ROLE_LABELS[role]}」硬条件的股票（这里只显示达标项，未达标原因不列出）`}
          </p>
        </div>
      ) : (
        <div className="screener-table-wrap">
          <table className="screener-table screener-table--stocks" aria-label={`${theme.name} ${ROLE_LABELS[role]}`}>
            <thead>
              <tr>
                <th scope="col">股票 / 涨停原因</th>
                <th scope="col">现价 / 涨跌幅</th>
                <th scope="col">连板 / 首封</th>
                <th scope="col">封板 / 开板</th>
                <th scope="col">封单 / 换手</th>
                <th scope="col">成交额 / 近3日均额</th>
                <th scope="col">流通市值</th>
                <th scope="col">形态（均线 / 距5日线 / 10日站上）</th>
                <th scope="col">纯正</th>
                <th scope="col">命中 / 未命中</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const ma = maView(item);
                return (
                  <tr key={item.symbol}>
                    <th scope="row">
                      <StockIdentity
                        name={item.name}
                        code={item.symbol}
                        tag={item.boardCount === null ? null : `${item.boardCount} 连板`}
                      />
                      {item.reason ? (
                        <span className="screener-table__sub">{item.reason}</span>
                      ) : null}
                    </th>
                    <td className="screener-table__stack">
                      <span className="screener-table__price">{formatPrice(item.price)}</span>
                      <span className={`screener-table__pct${pctClass(item.pct)}`}>
                        {formatSignedPercent(item.pct)}
                      </span>
                    </td>
                    <td className="screener-table__stack">
                      <span>{item.boardCount === null ? '—' : `${item.boardCount} 连板`}</span>
                      <span className="screener-table__sub">{item.firstSealTime ?? '无首封时间'}</span>
                    </td>
                    <td className="screener-table__stack">
                      <span>{item.sealType ?? '—'}</span>
                      <span className="screener-table__sub">
                        {item.openCount === null ? '开板 —' : `开板 ${item.openCount} 次`}
                      </span>
                    </td>
                    <td className="screener-table__stack">
                      <span>{formatAmount(item.sealAmount)}</span>
                      <span className="screener-table__sub">
                        {item.turnoverRate === null ? '换手 —' : `换手 ${item.turnoverRate.toFixed(1)}%`}
                      </span>
                    </td>
                    <td className="screener-table__stack">
                      <span>{formatAmount(item.amount)}</span>
                      <span className="screener-table__sub">近 3 日均 {formatAmount(item.avgAmount3d)}</span>
                    </td>
                    <td className="screener-table__num">{formatAmount(item.floatMarketCap)}</td>
                    <td className="screener-table__stack">
                      <span className={`screener-table__badge${ma.bull === true ? ' is-on' : ''}`}>
                        {ma.bull === null ? '—' : ma.bull ? '多头' : '非多头'}
                      </span>
                      <span className="screener-table__sub">
                        距 5 日线 {formatSignedPercent(item.distMa5)}
                      </span>
                      <span className="screener-table__sub">
                        10 日站上 {item.stableDays10 === null ? '—' : `${item.stableDays10} 天`}
                      </span>
                    </td>
                    <td className="screener-table__num">
                      {item.precise === null ? '—' : item.precise ? '是' : '否'}
                    </td>
                    <td className="screener-table__verdict">
                      <ul className="theme-verdict">
                        {item.hits.map((hit) => (
                          <li key={`hit-${hit}`} className="theme-verdict__hit">
                            ✔ {hit}
                          </li>
                        ))}
                        {item.misses.map((miss) => (
                          <li key={`miss-${miss}`} className="theme-verdict__miss">
                            ✘ {miss}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="status-note">
        口径说明：这里的「达标」只代表满足该标签的硬条件，不代表任何收益预期。
        依赖盘中 / 次日数据的条目（如「次日竞价强于板块平均」）会明确标成「待次日验证」。
        均线排列只作展示，不参与筛选。
      </p>
    </section>
  );
};
