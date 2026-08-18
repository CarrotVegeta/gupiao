import type { PortfolioSummary } from '../types';

type OverviewProps = {
  summary: PortfolioSummary;
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

const formatCurrency = (value: number | null): string => {
  if (value === null) {
    return '—';
  }

  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatPercent = (value: number | null): string => {
  if (value === null) {
    return '—';
  }

  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
};

const formatDateTime = (value: string | null): string =>
  value === null
    ? '未刷新'
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));

export const Overview = ({
  summary,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: OverviewProps) => (
  <section className="overview card" aria-labelledby="overview-title">
    <div className="overview__header">
      <div>
        <p className="eyebrow">当前范围总览</p>
        <h2 id="overview-title">总收益率</h2>
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
          {isRefreshing ? '刷新中…' : '刷新行情'}
        </button>
      </div>
    </div>

    <div className="overview__hero">
      <p className={`overview__hero-value ${getValueToneClass(summary.returnPct)}`}>
        {formatPercent(summary.returnPct)}
      </p>
      <div className="overview__status-group">
        <span className="status-pill">{summary.hasPartialQuotes ? '部分行情' : '行情完整'}</span>
        <span className="status-note">持仓数量：{summary.holdingCount}</span>
      </div>
    </div>

    <dl className="overview__metrics">
      <div className="metric-card">
        <dt>总收益额</dt>
        <dd className={getValueToneClass(summary.profit)}>{formatCurrency(summary.profit)}</dd>
      </div>
      <div className="metric-card">
        <dt>总投入</dt>
        <dd className="value--neutral">{formatCurrency(summary.invested)}</dd>
      </div>
      <div className="metric-card">
        <dt>当前市值</dt>
        <dd className="value--neutral">{formatCurrency(summary.marketValue)}</dd>
      </div>
      <div className="metric-card">
        <dt>持仓数量</dt>
        <dd className="value--neutral">{summary.holdingCount}</dd>
      </div>
    </dl>
  </section>
);
