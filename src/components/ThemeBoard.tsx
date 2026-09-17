import type { ThemeItem, ThemesResponse } from '../types';
import { THEME_EVIDENCE } from '../lib/screener';

type ThemeBoardProps = {
  data: ThemesResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSelect: (theme: ThemeItem) => void;
};

const formatPct = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatTradeDate = (value: string | null): string =>
  value !== null && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '—';

/** 8 个指标的小圆点：命中填色，未命中空心，鼠标悬停看判定依据 */
const MetricDots = ({ theme }: { theme: ThemeItem }) => (
  <span className="theme-metrics" aria-label={`命中 ${theme.score} / 8 项指标`}>
    {theme.metrics.map((metric) => (
      <span
        key={metric.key}
        className={`theme-metrics__dot${metric.hit ? ' theme-metrics__dot--hit' : ''}`}
        title={`${metric.label}：${metric.value}｜${metric.detail}`}
      />
    ))}
  </span>
);

const ThemeCard = ({
  theme,
  onSelect,
  tone,
}: {
  theme: ThemeItem;
  onSelect: (theme: ThemeItem) => void;
  tone: 'main' | 'branch';
}) => (
  <button
    className={`theme-card theme-card--${tone}`}
    type="button"
    onClick={() => onSelect(theme)}
    aria-label={`查看 ${theme.name} 的题材详情`}
  >
    <span className="theme-card__head">
      <span className="theme-card__name">{theme.name}</span>
      <span className={`theme-card__pct${(theme.pct ?? 0) >= 0 ? ' is-up' : ' is-down'}`}>
        {formatPct(theme.pct)}
      </span>
    </span>
    <span className="theme-card__stats">
      <span>
        涨停 <b>{theme.limitUpCount}</b> 只
      </span>
      <span>
        最高 <b>{theme.maxBoardLabel ?? '—'}</b>
      </span>
      <span>
        持续 <b>{theme.durationDays}</b> 天
      </span>
      <span>
        评分 <b>{theme.score}/8</b>
      </span>
    </span>
    <span className="theme-card__foot">
      <MetricDots theme={theme} />
      <span className="theme-card__leader">
        {theme.leader ? `龙头 ${theme.leader.name}` : '龙头 —'}
      </span>
    </span>
  </button>
);

export const ThemeBoard = ({ data, isRefreshing, onRefresh, onSelect }: ThemeBoardProps) => {
  const hasData = data.main.length > 0 || data.branch.length > 0;

  return (
    <>
      <section className="card" aria-labelledby="theme-main-title">
        <div className="overview__header">
          <div>
            <p className="eyebrow">主线题材</p>
            <h2 id="theme-main-title">主线题材</h2>
          </div>
          <div className="overview__actions limit-up-list__actions">
            <p className="overview__meta">
              交易日：<span>{formatTradeDate(data.tradeDate)}</span>
            </p>
            <p className="overview__meta">
              主线：<span>{data.main.length} 个</span> · 支线：<span>{data.branch.length} 个</span>
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? '刷新中…' : '刷新题材'}
            </button>
          </div>
        </div>

        <p className="status-note">{THEME_EVIDENCE}</p>

        {data.status === 'stale' ? (
          <div className="banner banner--warning" role="status">
            <p>题材数据已过期，展示的是上一轮成功结果。</p>
            {data.error ? <p className="status-note">{data.error}</p> : null}
          </div>
        ) : null}

        {data.status === 'unavailable' ? (
          <div className="banner banner--warning" role="status">
            <p>题材数据暂不可用。</p>
            {data.error ? <p className="status-note">{data.error}</p> : null}
          </div>
        ) : null}

        {!hasData ? (
          <div className="empty-state empty-state--subtle">
            <p>{isRefreshing ? '正在扫描题材…' : '暂无题材数据（可能不是交易日）'}</p>
          </div>
        ) : (
          <div className="theme-grid">
            {data.main.map((theme) => (
              <ThemeCard key={theme.code} theme={theme} onSelect={onSelect} tone="main" />
            ))}
          </div>
        )}
      </section>

      {data.branch.length > 0 ? (
        <section className="card" aria-labelledby="theme-branch-title">
          <div className="overview__header">
            <div>
              <p className="eyebrow">支线题材</p>
              <h2 id="theme-branch-title">支线题材（涨停 2~4 只）</h2>
            </div>
            <p className="overview__meta">
              共 <span>{data.branch.length} 个</span>
            </p>
          </div>
          <div className="theme-branch-list">
            {data.branch.map((theme) => (
              <ThemeCard key={theme.code} theme={theme} onSelect={onSelect} tone="branch" />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
};
