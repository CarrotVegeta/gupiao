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

const formatIndexValue = (value: number): string =>
  new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatSignedNumber = (value: number): string =>
  `${value >= 0 ? '+' : '-'}${formatIndexValue(Math.abs(value))}`;

const formatSignedPercent = (value: number): string =>
  `${value >= 0 ? '+' : '-'}${formatPercent(Math.abs(value))}`;

const formatDateTime = (value: string | null): string =>
  value === null
    ? '未刷新'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value));

export const MarketOverview = ({
  indices,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: MarketOverviewProps) => (
  <section className="overview card" aria-labelledby="market-overview-title">
    <div className="overview__header">
      <div>
        <p className="eyebrow">涨停聚焦</p>
        <h2 id="market-overview-title">大盘概览</h2>
      </div>
      <div className="overview__actions">
        <p className="overview__meta" aria-live="polite">
          最后刷新：{formatDateTime(lastUpdated)}
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

    <dl className="overview__metrics">
      {indices.map((index) => (
        <div key={index.symbol} className="metric-card">
          <dt>{index.name}</dt>
          <dd className={getValueToneClass(index.change)}>{formatIndexValue(index.price)}</dd>
          <p className={getValueToneClass(index.change)}>{formatSignedNumber(index.change)}</p>
          <p className={getValueToneClass(index.pct)}>{formatSignedPercent(index.pct)}</p>
        </div>
      ))}
    </dl>
  </section>
);
