import { formatCurrency } from '../lib/quotes';
import type { LimitUpResponse } from '../types';

type LimitUpListProps = {
  data: LimitUpResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const formatTradeDate = (value: string): string => {
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

const formatValue = (value: string | null): string => value ?? '—';

const formatSignedPercent = (value: number): string => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`;

export const LimitUpList = ({ data, isRefreshing, onRefresh }: LimitUpListProps) => (
  <section className="card" aria-labelledby="limit-up-list-title">
    <div className="overview__header">
      <div>
        <p className="eyebrow">涨停池</p>
        <h2 id="limit-up-list-title">涨停列表</h2>
      </div>
      <div className="overview__actions">
        <p className="overview__meta">
          交易日：<time dateTime={data.tradeDate}>{formatTradeDate(data.tradeDate)}</time>
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
          {isRefreshing ? '刷新中…' : '刷新涨停池'}
        </button>
      </div>
    </div>

    <div className="overview__status-group">
      <span className="status-pill">包含 ST / 风险标的</span>
    </div>

    {data.status === 'stale' ? (
      <p className="banner banner--warning" role="status">
        数据已过期
      </p>
    ) : null}

    {data.items.length === 0 ? (
      <div className="empty-state empty-state--subtle">
        <p>暂无涨停数据</p>
      </div>
    ) : (
      <table aria-label="涨停列表">
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col">现价</th>
            <th scope="col">涨跌幅</th>
            <th scope="col">连板</th>
            <th scope="col">行业</th>
            <th scope="col">首次封板</th>
            <th scope="col">最后封板</th>
            <th scope="col">炸板次数</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.symbol}>
              <th scope="row">
                {item.name}
                <div>{item.symbol}</div>
              </th>
              <td>{formatCurrency(item.price)}</td>
              <td>{formatSignedPercent(item.pct)}</td>
              <td>{item.boardCount} 连板</td>
              <td>{formatValue(item.industry)}</td>
              <td>{formatValue(item.firstSealTime)}</td>
              <td>{formatValue(item.lastSealTime)}</td>
              <td>{item.breakCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </section>
);
