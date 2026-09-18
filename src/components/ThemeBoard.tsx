import type { ThemeItem, ThemesResponse } from '../types';
import { THEME_EVIDENCE } from '../lib/screener';
import { WarningNotesPanel, WarningNotesToggle, useWarningNotes } from './WarningNotes';

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

/** 8 个旧指标的小圆点：只作观察，不决定主线资格 */
const MetricDots = ({ theme }: { theme: ThemeItem }) => (
  <span className="theme-metrics" aria-label={`旧口径命中 ${theme.score} / 8 项指标（仅观察）`}>
    {theme.metrics.map((metric) => (
      <span
        key={metric.key}
        className={`theme-metrics__dot${metric.hit ? ' theme-metrics__dot--hit' : ''}`}
        title={`${metric.label}：${metric.value}｜${metric.detail}`}
      />
    ))}
  </span>
);

const CountSummary = ({ theme }: { theme: ThemeItem }) =>
  theme.source === 'topic' ? (
    <span className="theme-card__counts">
      <span title="当日涨停原因含该逻辑的涨停股数">涨停 <b>{theme.limitUpCount}</b> 家</span>
      <span title="其中连板（≥2 板）的家数">连板 <b>{theme.continuousCount}</b> 只</span>
      <span title="同一逻辑的写法（同一只票同一标签只算一次）">
        写法 <b>{theme.catalysts.length}</b> 种
      </span>
    </span>
  ) : (
    <span className="theme-card__counts">
      <span title="概念成员涨停数（含仅概念归属）">
        概念涨停 <b>{theme.conceptLimitUpCount ?? '—'}</b>
      </span>
      <span title="本轮驱动有依据的涨停数（参考口径，不决定主线 / 支线）">
        驱动有依据 <b>{theme.supportedLimitUpCount ?? '—'}</b>
      </span>
      <span title="有概念归属但本轮关联未确认">
        待确认 <b>{theme.unresolvedLimitUpCount ?? '—'}</b>
      </span>
    </span>
  );

const ThemeCard = ({
  theme,
  onSelect,
  tone,
}: {
  theme: ThemeItem;
  onSelect: (theme: ThemeItem) => void;
  tone: 'main' | 'branch' | 'pending';
}) => (
  <button
    className={`theme-card theme-card--${tone}`}
    type="button"
    onClick={() => onSelect(theme)}
    aria-label={`查看 ${theme.name} 的题材详情`}
  >
    <span className="theme-card__head">
      <span className="theme-card__name">{theme.name}</span>
      <span
        className={`theme-card__pct${(theme.pct ?? 0) >= 0 ? ' is-up' : ' is-down'}`}
        title={theme.source === 'topic' ? '成员当日平均涨幅（题材没有板块涨幅）' : '板块涨跌幅'}
      >
        {formatPct(theme.pct)}
      </span>
    </span>
    <CountSummary theme={theme} />
    <span className="theme-card__stats">
      <span>
        最高 <b>{theme.maxBoardLabel ?? '—'}</b>
      </span>
      <span>
        持续 <b>{theme.durationDays}</b> 天
      </span>
      <span title="8 项指标里当前可判断且命中的数量（题材口径下成交额 / 市场影响力不可用）">
        {theme.source === 'topic' ? '指标' : '旧口径'} <b>{theme.score}/8</b>
      </span>
    </span>
    {theme.classificationReasons.length > 0 ? (
      <span className="theme-card__reason">{theme.classificationReasons.join('；')}</span>
    ) : null}
    <span className="theme-card__foot">
      <MetricDots theme={theme} />
      <span className="theme-card__leader">
        {theme.leader ? `高度标杆 ${theme.leader.name}` : '高度标杆 —'}
      </span>
    </span>
  </button>
);

export const ThemeBoard = ({ data, isRefreshing, onRefresh, onSelect }: ThemeBoardProps) => {
  const hasData = data.main.length > 0 || data.branch.length > 0 || data.pending.length > 0;
  /** 数据说明与限制的开关：按钮在标题行，正文面板在表头下面 */
  const notes = useWarningNotes();

  return (
    <>
      <section className="card" aria-labelledby="theme-main-title">
        <div className="overview__header">
          <div>
            <p className="eyebrow">
              {data.scope === 'topic' ? '主线题材 · 当日 ≥5 家且前两日各 ≥2' : '主线题材 · 当日概念家数前 3'}
            </p>
            <div className="theme-title-row">
              <h2 id="theme-main-title">主线题材</h2>
              {/* 按钮紧跟标题；正文面板在表头外面（见下方），展开不会挤动右侧刷新按钮 */}
              <WarningNotesToggle
                title="数据说明与限制"
                count={data.warnings.length}
                tooltip="题材家数 / 归属缺口与口径限制；覆盖不足的部分不做结论"
                open={notes.open}
                panelId={notes.panelId}
                onToggle={notes.toggle}
              />
            </div>
          </div>
          <div className="overview__actions limit-up-list__actions">
            <p className="overview__meta">
              交易日：<span>{formatTradeDate(data.tradeDate)}</span> · 数据状态：
              <span>{data.status}</span>
            </p>
            <p className="overview__meta">
              主线：<span>{data.main.length} 个</span> · 支线：<span>{data.branch.length} 个</span> ·
              待确认：<span>{data.pending.length} 个</span>
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

        {/* 数据说明与限制的正文：在表头外面，展开时把下面内容推下去，不动右侧刷新按钮 */}
        <WarningNotesPanel panelId={notes.panelId} open={notes.open}>
          {data.status === 'partial' ? (
            <p className="warning-notes__headline">
              题材数据部分可用：有家数或归属缺口，覆盖不足的部分不做结论。
            </p>
          ) : null}
          {data.warnings.length > 0 ? (
            <ul className="warning-notes__list">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </WarningNotesPanel>

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
              <h2 id="theme-branch-title">支线题材</h2>
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

      {data.pending.length > 0 ? (
        <section className="card" aria-labelledby="theme-pending-title">
          <div className="overview__header">
            <div>
              <p className="eyebrow">待确认</p>
              <h2 id="theme-pending-title">待确认题材</h2>
            </div>
            <p className="overview__meta">
              共 <span>{data.pending.length} 个</span>（证据或覆盖不足，既不算主线也不自动降为支线）
            </p>
          </div>
          <div className="theme-branch-list">
            {data.pending.map((theme) => (
              <ThemeCard key={theme.code} theme={theme} onSelect={onSelect} tone="pending" />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
};
