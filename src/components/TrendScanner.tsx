import { useCallback, useEffect, useState } from 'react';
import type { TrendFilters, TrendPick, TrendScanResponse } from '../types';
import { fetchTrendScan, TREND_EVIDENCE, unavailableTrend } from '../lib/screener';
import { StockIdentity } from './StockIdentity';
import { formatPrice } from '../lib/quotes';

const DEFAULT_FILTERS: TrendFilters = {
  themeScope: 'main',
  maxMa5Dist: 4,
  maxPct: 20,
  pctWindow: 10,
  minStableDays: 3,
  minAmountYi: 5,
  minScore: 5,
  mainOnly: false,
  excludeSt: false,
};

const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatAmount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value / 1e8).toFixed(2)} 亿`;

const pctClass = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '' : value >= 0 ? ' is-up' : ' is-down';

type MaView = { bull: boolean | null; values: string | null };

const maView = (item: TrendPick): MaView => {
  if (item.ma5 === null || item.ma10 === null || item.ma20 === null) {
    return { bull: null, values: null };
  }
  return {
    bull: item.ma5 > item.ma10 && item.ma10 > item.ma20,
    values: `${item.ma5.toFixed(2)}/${item.ma10.toFixed(2)}/${item.ma20.toFixed(2)}`,
  };
};

export const TrendScanner = () => {
  const [filters, setFilters] = useState<TrendFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<TrendScanResponse>(() => unavailableTrend('加载中'));
  const [isRefreshing, setRefreshing] = useState(false);

  const run = useCallback(async (next: TrendFilters) => {
    setRefreshing(true);
    try {
      setData(await fetchTrendScan(next));
    } catch (error) {
      setData(unavailableTrend(error instanceof Error ? error.message : '形态扫描请求失败'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void run(DEFAULT_FILTERS);
  }, [run]);

  const patch = (next: Partial<TrendFilters>): void => {
    const merged = { ...filters, ...next };
    setFilters(merged);
    void run(merged);
  };

  return (
    <section className="card" aria-labelledby="trend-scanner-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">形态扫描</p>
          <h2 id="trend-scanner-title">趋势形态扫描（不是选股信号）</h2>
        </div>
        <div className="overview__actions limit-up-list__actions">
          <p className="overview__meta">
            候选：<span>{data.candidates} 只</span> · 拉日K：<span>{data.scanned} 只</span> · 命中：
            <span>{data.items.length} 只</span>
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void run(filters)}
            disabled={isRefreshing}
          >
            {isRefreshing ? '扫描中…' : '重新扫描'}
          </button>
        </div>
      </div>

      <div className="trend-evidence" role="note">
        <p className="trend-evidence__headline">⚠ {TREND_EVIDENCE.headline}</p>
        <ul>
          {TREND_EVIDENCE.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="status-note">{TREND_EVIDENCE.footer}</p>
      </div>

      <div className="trend-filters">
        <label className="trend-filters__field">
          <span>板块范围</span>
          <select
            value={filters.themeScope}
            onChange={(event) =>
              patch({ themeScope: event.target.value === 'all' ? 'all' : 'main' })
            }
          >
            <option value="main">仅主线题材</option>
            <option value="all">全市场（对照）</option>
          </select>
        </label>

        <label className="trend-filters__field">
          <span>距 5 日线上限（%）</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={filters.maxMa5Dist}
            onChange={(event) => patch({ maxMa5Dist: Number(event.target.value) })}
          />
        </label>

        <label className="trend-filters__field">
          <span>近期涨幅上限（%）</span>
          <input
            type="number"
            min={0}
            max={200}
            step={1}
            value={filters.maxPct}
            onChange={(event) => patch({ maxPct: Number(event.target.value) })}
          />
        </label>

        <label className="trend-filters__field">
          <span>涨幅窗口</span>
          <select
            value={filters.pctWindow}
            onChange={(event) => patch({ pctWindow: Number(event.target.value) })}
          >
            <option value={5}>5 日</option>
            <option value={10}>10 日</option>
            <option value={20}>20 日</option>
          </select>
        </label>

        <label className="trend-filters__field">
          <span>连续站稳 5 日线（天）</span>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={filters.minStableDays}
            onChange={(event) => patch({ minStableDays: Number(event.target.value) })}
          />
        </label>

        <label className="trend-filters__field">
          <span>日均成交额下限（亿）</span>
          <input
            type="number"
            min={0}
            max={500}
            step={0.5}
            value={filters.minAmountYi}
            onChange={(event) => patch({ minAmountYi: Number(event.target.value) })}
          />
        </label>

        <label className="trend-filters__field">
          <span>至少满足条件数</span>
          <select
            value={filters.minScore}
            onChange={(event) => patch({ minScore: Number(event.target.value) })}
          >
            <option value={5}>5/5 全部满足</option>
            <option value={4}>4/5（看差一点）</option>
            <option value={3}>3/5（放宽）</option>
          </select>
        </label>

        <label className="trend-filters__check">
          <input
            type="checkbox"
            checked={filters.mainOnly}
            onChange={(event) => patch({ mainOnly: event.target.checked })}
          />
          <span>仅沪深主板</span>
        </label>

        <label className="trend-filters__check">
          <input
            type="checkbox"
            checked={filters.excludeSt}
            onChange={(event) => patch({ excludeSt: event.target.checked })}
          />
          <span>排除 ST</span>
        </label>
      </div>

      {data.status === 'unavailable' ? (
        <div className="banner banner--warning" role="status">
          <p>形态扫描暂不可用。</p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </div>
      ) : null}

      {data.items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>
            {isRefreshing
              ? '正在扫描…'
              : `当前条件下没有满足 ${data.filters.minScore}/5 个形态条件的股票，可以放宽条件或调低「至少满足条件数」`}
          </p>
        </div>
      ) : (
        <div className="screener-table-wrap">
          {/* 独立滚动容器：列多时横向滚，不靠压缩每列宽度来塞 */}
          <table className="screener-table screener-table--trend" aria-label="趋势形态扫描结果">
            <thead>
              <tr>
                <th scope="col">股票 / 所属主线板块</th>
                <th scope="col">现价 / 涨跌幅</th>
                <th scope="col">均线排列</th>
                <th scope="col">距 5 日线</th>
                <th scope="col">连续站稳</th>
                <th scope="col">量能比</th>
                <th scope="col">近 {data.filters.pctWindow} 日涨幅</th>
                <th scope="col">日均成交额</th>
                <th scope="col">命中条件</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const ma = maView(item);
                return (
                  <tr key={item.symbol}>
                    <th scope="row">
                      <StockIdentity name={item.name} code={item.symbol} />
                      <span className="screener-table__sub">
                        {item.themes.length > 0
                          ? item.themes.map((theme) => theme.name).join(' · ')
                          : '全市场口径'}
                      </span>
                    </th>
                    <td className="screener-table__stack">
                      <span className="screener-table__price">{formatPrice(item.price)}</span>
                      <span className={`screener-table__pct${pctClass(item.pct)}`}>
                        {formatSignedPercent(item.pct)}
                      </span>
                    </td>
                    <td>
                      <span className={`screener-table__badge${ma.bull === true ? ' is-on' : ''}`}>
                        {ma.bull === null ? '—' : ma.bull ? '多头' : '非多头'}
                      </span>
                      <span className="screener-table__sub screener-table__sub--nowrap">
                        {ma.values ?? '均线不足'}
                      </span>
                    </td>
                    <td className="screener-table__num">{formatSignedPercent(item.distMa5)}</td>
                    <td className="screener-table__num">
                      {item.stableDays === null ? '—' : `${item.stableDays} 天`}
                    </td>
                    <td className="screener-table__num">
                      {item.shrink === null ? '—' : item.shrink.toFixed(2)}
                    </td>
                    <td className="screener-table__num">{formatSignedPercent(item.pctWindow)}</td>
                    <td className="screener-table__num">{formatAmount(item.avgAmount5d)}</td>
                    <td className="screener-table__verdict">
                      <ul className="theme-verdict">
                        {item.matched.map((hit) => (
                          <li key={`hit-${hit}`} className="theme-verdict__hit">
                            ✔ {hit}
                          </li>
                        ))}
                        {item.unmatched.map((miss) => (
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
    </section>
  );
};
