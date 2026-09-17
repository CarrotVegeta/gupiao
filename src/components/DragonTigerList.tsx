import { formatPrice } from '../lib/quotes';
import { StockIdentity } from './StockIdentity';
import type { DragonTigerItem, DragonTigerResponse } from '../types';

type DragonTigerListProps = {
  data: DragonTigerResponse;
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

const formatAmount = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }

  const absolute = Math.abs(value);
  const suffix = absolute >= 100_000_000 ? '亿' : absolute >= 10_000 ? '万' : '';
  const divisor = absolute >= 100_000_000 ? 100_000_000 : absolute >= 10_000 ? 10_000 : 1;
  const amount = (absolute / divisor).toFixed(2);

  return `${value < 0 ? '-' : ''}${amount} ${suffix}`.trim();
};

const compareNetAmountDesc = (left: DragonTigerItem, right: DragonTigerItem): number => {
  if (left.netAmount === null && right.netAmount === null) {
    return left.symbol.localeCompare(right.symbol, 'zh-CN');
  }

  if (left.netAmount === null) {
    return 1;
  }

  if (right.netAmount === null) {
    return -1;
  }

  return right.netAmount - left.netAmount || left.symbol.localeCompare(right.symbol, 'zh-CN');
};

const valueClass = (value: number | null): string => {
  if (value === null || value === 0) {
    return '';
  }

  return value > 0 ? 'value--rise' : 'value--fall';
};

export const DragonTigerList = ({ data, isRefreshing, onRefresh }: DragonTigerListProps) => {
  const items = [...data.items].sort(compareNetAmountDesc);

  return (
    <section className="card dragon-tiger-list" aria-labelledby="dragon-tiger-list-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">龙虎榜单</p>
          <h2 id="dragon-tiger-list-title">龙虎榜</h2>
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
            {isRefreshing ? '刷新中…' : '刷新龙虎榜'}
          </button>
        </div>
      </div>

      {data.status === 'stale' ? (
        <p className="banner banner--warning" role="status">
          数据已过期
        </p>
      ) : null}

      {data.status === 'unavailable' ? (
        <>
          <p className="banner banner--warning" role="status">
            龙虎榜数据暂不可用
          </p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </>
      ) : null}

      {items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>{data.status === 'unavailable' ? '暂无可用龙虎榜数据' : '暂无龙虎榜数据'}</p>
        </div>
      ) : (
        <div className="dragon-tiger-list__table-wrap">
          {/* 独立滚动容器：数据超出时只滚这个方块，不带动整页 */}
          <table aria-label="龙虎榜列表">
            <thead>
              <tr>
                <th scope="col">股票</th>
                <th scope="col">收盘价</th>
                <th scope="col">涨跌幅</th>
                <th scope="col">上榜原因</th>
                <th scope="col">买入额</th>
                <th scope="col">卖出额</th>
                <th scope="col">净买入额</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.symbol}>
                  <th scope="row">
                    {/* 上榜原因通常很长（如「日涨幅偏离值达到7%的前5只证券」），
                        标签只截前 8 个字示意，完整原因仍在「上榜原因」列 */}
                    <StockIdentity
                      name={item.name}
                      code={item.symbol}
                      tag={item.reason ? item.reason.slice(0, 8) : null}
                    />
                  </th>
                  <td>{formatPrice(item.closePrice)}</td>
                  <td className={valueClass(item.changePct)}>{formatSignedPercent(item.changePct)}</td>
                  <td>{item.reason ?? '—'}</td>
                  <td>{formatAmount(item.buyAmount)}</td>
                  <td>{formatAmount(item.sellAmount)}</td>
                  <td className={valueClass(item.netAmount)}>{formatAmount(item.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
