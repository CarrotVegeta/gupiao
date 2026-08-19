import { formatPercent } from '../lib/quotes';
import type { MarketIndex } from '../types';

type MarketOverviewProps = {
  indices: MarketIndex[];
  lastUpdated: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const getValueToneClass = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'value--neutral';
  }

  if (value > 0) {
    return 'value--rise';
  }

  if (value < 0) {
    return 'value--fall';
  }

  return 'value--neutral';
};

const getMarketToneClass = (
  status: MarketIndex['status'],
  value: number | null | undefined,
): string => {
  if (status !== 'fresh') {
    return 'value--neutral';
  }

  return getValueToneClass(value);
};

const getStatusText = (status: MarketIndex['status']): string | null => {
  if (status === 'stale') {
    return '数据已过期';
  }

  if (status === 'unavailable') {
    return '无可用数据';
  }

  return null;
};

const formatIndexValue = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatSignedNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '-'}${formatIndexValue(Math.abs(value))}`;

const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '-'}${formatPercent(Math.abs(value))}`;

const formatDateTime = (value: string | null): string => {
  if (value === null) {
    return '未刷新';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '未刷新';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
};

export const MarketOverview = ({
  indices,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: MarketOverviewProps) => (
  <section className="market-overview card" aria-labelledby="market-overview-title">
    <div className="market-overview__header">
      <div className="market-overview__title">
        <p className="eyebrow">MARKET OVERVIEW</p>
        <div className="market-overview__heading-row">
          <h2 id="market-overview-title">大盘概览</h2>
          <span className="market-overview__live">实时指数</span>
        </div>
        <p className="market-overview__description">
          <span>四大核心指数</span>
          <span aria-hidden="true"> · </span>
          <span>及时把握市场节奏</span>
        </p>
      </div>
      <div className="market-overview__toolbar">
        <p className="market-overview__updated" aria-live="polite">
          <span>最后刷新：{formatDateTime(lastUpdated)}</span>
        </p>
        <button
          className="button button--secondary"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? '刷新中…' : '刷新大盘'}
        </button>
      </div>
    </div>

    <dl className="market-overview__grid">
      {indices.map((index) => {
        const statusText = getStatusText(index.status);

        return (
          <div key={index.symbol} className={`market-index-card market-index-card--${index.status}`}>
            <div className="market-index-card__topline">
              <dt>{index.name}</dt>
              {statusText ? (
                <span className="market-index-card__status value--neutral">{statusText}</span>
              ) : (
                <span className="market-index-card__status market-index-card__status--fresh">
                  正常
                </span>
              )}
            </div>
            <dd className={`market-index-card__price ${getMarketToneClass(index.status, index.change)}`}>
              <span>点位</span>
              <strong>{formatIndexValue(index.price)}</strong>
            </dd>
            <div className="market-index-card__changes">
              <p className={getMarketToneClass(index.status, index.change)}>
                <span>涨跌额</span>
                <strong className={getMarketToneClass(index.status, index.change)}>
                  {formatSignedNumber(index.change)}
                </strong>
              </p>
              <p className={getMarketToneClass(index.status, index.pct)}>
                <span>涨跌幅</span>
                <strong className={getMarketToneClass(index.status, index.pct)}>
                  {formatSignedPercent(index.pct)}
                </strong>
              </p>
            </div>
          </div>
        );
      })}
    </dl>
  </section>
);
