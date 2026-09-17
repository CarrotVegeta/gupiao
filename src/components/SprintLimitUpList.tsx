import { formatCurrency } from '../lib/quotes';
import { StockIdentity } from './StockIdentity';
import type { SprintLimitUpItem, SprintLimitUpResponse } from '../types';

type SprintLimitUpListProps = {
  data: SprintLimitUpResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const formatTradeDate = (value: string | null): string => {
  if (value === null) {
    return '暂无数据';
  }

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-');
};

const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`;

const formatBoardCount = (value: number | null): string =>
  value === null ? '—' : `${value} 次`;

const formatReason = (value: string | null): string => value ?? '—';

const valueClass = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '';
  }

  return value > 0 ? 'value--rise' : value < 0 ? 'value--fall' : '';
};

const SprintLimitUpList = ({ data, isRefreshing, onRefresh }: SprintLimitUpListProps) => {
  const items: SprintLimitUpItem[] = data.items;

  return (
    <section className="card sprint-limit-up-list" aria-labelledby="sprint-limit-up-list-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">东方财富强势股池</p>
          <h2 id="sprint-limit-up-list-title">冲刺涨停</h2>
        </div>
        <div className="overview__actions limit-up-list__actions">
          <p className="overview__meta">
            {data.tradeDate === null ? (
              '交易日：暂无数据'
            ) : (
              <>
                交易日：<time dateTime={data.tradeDate}>{formatTradeDate(data.tradeDate)}</time>
              </>
            )}
          </p>
          <p className="overview__meta">
            数量：<span>{data.items.length} 只</span>
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? '刷新中…' : '刷新冲刺涨停'}
          </button>
        </div>
      </div>

      <p className="sprint-limit-up-list__source">
        数据源：东方财富强势股池（涨幅 ≥ 7%、涨速 ≥ 0.1%、距离涨停价 ≤ 3%）
      </p>

      {data.status === 'stale' ? (
        <p className="banner banner--warning" role="status">
          数据已过期
        </p>
      ) : null}

      {data.status === 'unavailable' ? (
        <>
          <p className="banner banner--warning" role="status">
            冲刺涨停数据暂不可用
          </p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </>
      ) : null}

      {items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>{data.status === 'unavailable' ? '暂无可用冲刺涨停数据' : '暂无冲刺涨停数据'}</p>
        </div>
      ) : (
        <div className="sprint-limit-up-list__table-wrap">
          {/* 独立滚动容器：数据超出时只滚这个方块，不带动整页 */}
          <table aria-label="冲刺涨停列表">
            <thead>
              <tr>
                <th scope="col">股票</th>
                <th scope="col">涨停次数</th>
                <th scope="col">涨幅</th>
                <th scope="col">涨速</th>
                <th scope="col">最新价</th>
                <th scope="col">涨停原因</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.symbol}>
                  <th scope="row">
                    <StockIdentity
                      name={item.name}
                      code={item.symbol}
                      tag={formatBoardCount(item.boardCount)}
                    />
                  </th>
                  <td>{formatBoardCount(item.boardCount)}</td>
                  <td className={valueClass(item.pct)}>{formatSignedPercent(item.pct)}</td>
                  <td className={valueClass(item.speed)}>{formatSignedPercent(item.speed)}</td>
                  <td className={valueClass(item.pct)}>{formatCurrency(item.price)}</td>
                  <td className="sprint-limit-up-list__reason">{formatReason(item.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export { SprintLimitUpList };
