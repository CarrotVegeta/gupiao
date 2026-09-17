import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CheckResult,
  RoleTag,
  ThemeDetailResponseV2,
  ThemeItem,
  ThemeRelation,
  ThemeStockRole,
  ThemeStockV2,
} from '../types';
import { fetchThemeDetail, unavailableThemeDetail } from '../lib/screener';
import { AddToWatchlistButton } from './AddToWatchlistButton';
import { StockIdentity } from './StockIdentity';
import { WarningNotesPanel, WarningNotesToggle, useWarningNotes } from './WarningNotes';
import { formatPrice } from '../lib/quotes';

type ThemeDetailProps = {
  theme: ThemeItem;
  /**
   * 保留但不再使用：详情页的「← 返回题材列表」按钮已去掉，
   * 回列表改由点「题材」标签页承担（ScreenerPanel 会清掉选中项）。
   * 字段留着是为了不打断既有调用方。
   */
  onBack?: () => void;
  /** 请求的交易日（YYYYMMDD）；不传则由服务端按东八区当天判断 */
  tradeDate?: string;
  /** 行尾「添加自选」：往自选列表里加一条观察记录 */
  onAddToWatchlist: (stock: { symbol: string; name: string }) => void;
  /** 已经在自选里的代码集合，用来把按钮置灰 */
  watchlistSymbols: ReadonlySet<string>;
};

const ROLE_LABELS: Record<ThemeStockRole, string> = {
  leader: '龙头候选',
  turnover: '核心候选（换手核心口径）',
  trend: '趋势中军候选',
  laggard: '潜在低位补涨',
};

const RELATION_LABELS: Record<ThemeRelation['state'], string> = {
  supported: '驱动有依据',
  possible: '可能相关',
  membership_only: '仅概念归属',
  other_driver: '存在其他驱动',
  unknown: '关联未知',
};

const CHECK_STATE_LABELS: Record<CheckResult['state'], string> = {
  pass: '通过',
  fail: '不满足',
  pending: '待确认',
  missing: '数据缺失',
};

const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatAmount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value / 1e8).toFixed(2)} 亿`;

const pctClass = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '' : value >= 0 ? ' is-up' : ' is-down';

const formatTradeDate = (value: string | null): string =>
  value !== null && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '—';

/** 角色标签：同一股票多标签合并显示在一行，绝不拆成多行 */
const RoleBadges = ({ roles }: { roles: RoleTag[] }) => {
  if (roles.length === 0) return <span className="theme-role-badges__empty">—</span>;
  return (
    <span className="theme-role-badges">
      {roles.map((tag) => (
        <span
          key={tag.role}
          className={`theme-role-badge theme-role-badge--${tag.role}`}
          title={[...tag.reasons, ...tag.missingEvidence].join('\n')}
        >
          {ROLE_LABELS[tag.role]}
        </span>
      ))}
    </span>
  );
};

const RelationCell = ({ relation }: { relation: ThemeRelation }) => (
  <span className={`theme-relation theme-relation--${relation.state}`}>
    <span className="theme-relation__state">{RELATION_LABELS[relation.state]}</span>
    {relation.reasons.length > 0 ? (
      <span className="screener-table__sub">{relation.reasons[0]}</span>
    ) : null}
  </span>
);

/** 展开行：条件判定逐项列出（含缺失 / 待确认），并附证据与风险 */
const StockEvidence = ({
  item,
  evidenceText,
}: {
  item: ThemeStockV2;
  evidenceText: (ids: string[]) => string[];
}) => {
  const roleEntries = Object.entries(item.checks) as Array<[ThemeStockRole, CheckResult[]]>;
  return (
    <div className="theme-evidence">
      {roleEntries.length === 0 ? (
        <p className="status-note">
          {item.metricsState === 'ready'
            ? '未进入角色比较（本轮关联未确认，或缺少必要资格）'
            : item.metricsState === 'failed'
              ? '日K取数失败，指标按数据缺失处理，不当作不达标'
              : '未扫描或日K不足，指标缺失'}
        </p>
      ) : null}

      {roleEntries.map(([role, checks]) => (
        <div key={role} className="theme-evidence__group">
          <p className="theme-evidence__title">{ROLE_LABELS[role]}</p>
          <ul className="theme-verdict">
            {checks.map((check) => (
              <li
                key={`${role}-${check.key}`}
                className={`theme-verdict__${check.state === 'pass' ? 'hit' : 'miss'}`}
              >
                {check.state === 'pass' ? '✔' : check.state === 'fail' ? '✘' : '…'} {check.reason}（
                {CHECK_STATE_LABELS[check.state]}）
                {evidenceText(check.evidenceIds).length > 0 ? (
                  <span className="screener-table__sub">
                    证据：{evidenceText(check.evidenceIds).join('；')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="theme-evidence__group">
        <p className="theme-evidence__title">本轮关联依据</p>
        <ul className="theme-verdict">
          <li className="theme-verdict__miss">
            {RELATION_LABELS[item.relation.state]}：{item.relation.reasons.join('；') || '无说明'}
          </li>
          {item.relation.alternativeThemeCodes.length > 0 ? (
            <li className="theme-verdict__miss">
              其他可能驱动：{item.relation.alternativeThemeCodes.join('、')}
            </li>
          ) : null}
        </ul>
      </div>

      <div className="theme-evidence__group">
        <p className="theme-evidence__title">风险</p>
        <p className="status-note">
          {item.risksChecked
            ? item.risks.length > 0
              ? item.risks.join('；')
              : '已核验，未见减持 / 业绩 / ST 风险'
            : '未核验（不能说「无风险」）'}
        </p>
      </div>

      <p className="status-note">
        指标截止：{formatTradeDate(item.metricsTradeDate)} · 行情时间：{item.quoteAsOf ?? '—'}
      </p>
    </div>
  );
};

/**
 * 一行成员（含展开行）。
 *
 * 为什么要单独成组件并 `memo`：
 * 展开状态原本直接放在 ThemeDetail 里，而整张表是 ThemeDetail 的渲染产物，于是「点一行展开」
 * 会让父组件重跑整个 `visibleItems.map(...)`：宽基概念（如新能源车 700+ 只成员）下，每次点击
 * 都要重新创建整张表的元素树并逐个 diff。实测点击到下一帧 200–440ms（4× CPU 降速；dev 下 1.5–2s），
 * 而真正变化的 DOM 只有一行。
 * 抽成 memo 组件后，唯一变化的 isOpen（只有被点的那一行是 true）让其余行全部跳过渲染。
 * **前提是父组件传下来的其余 props 引用稳定**，否则 memo 形同虚设：
 *   - item：直接来自接口数据，父组件不会重新构造；
 *   - onToggle / evidenceById：父组件用 useCallback / useMemo 固定；
 *   - watchlistSymbols / onAddToWatchlist：由 App 用 useMemo / useCallback 传进来。
 */
type ThemeRowProps = {
  item: ThemeStockV2;
  /** 父组件持有，所以「同时只展开一行」；只有被点的那一行会拿到 true */
  isOpen: boolean;
  onToggle: (symbol: string) => void;
  evidenceById: Map<string, string>;
  watchlistSymbols: ReadonlySet<string>;
  onAddToWatchlist: (stock: { symbol: string; name: string }) => void;
};

/**
 * 测试/诊断探针：行组件真正渲染了几次。
 * 不是给业务用的状态，只是让「点一行只重渲染一行」「轮询不重渲染这张表」这两条结论
 * 能被自动化测试钉住（见 ThemeDetail.memo.test.tsx）。
 */
export const themeRowRenderCount = { current: 0 };

const ThemeRow = memo(function ThemeRow({
  item,
  isOpen,
  onToggle,
  evidenceById,
  watchlistSymbols,
  onAddToWatchlist,
}: ThemeRowProps) {
  themeRowRenderCount.current += 1;
  const evidenceText = (ids: string[]): string[] =>
    ids.map((id) => evidenceById.get(id) ?? id).filter((text) => text.length > 0);

  return (
    <>
      <tr
        className={`screener-table__row--toggle${isOpen ? ' is-expanded' : ''}`}
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => onToggle(item.symbol)}
        onKeyDown={(event) => {
          // 行不是原生控件，键盘要自己接 Enter / 空格
          if (event.key !== 'Enter' && event.key !== ' ') return;
          // 事件来自行内的按钮（添加自选）时不算「点了这一行」
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          onToggle(item.symbol);
        }}
      >
        <th scope="row" className="is-left">
          <span className="screener-table__toggle-cell">
            <span className="screener-table__caret" aria-hidden="true">
              {isOpen ? '▾' : '▸'}
            </span>
            <StockIdentity
              name={item.name}
              code={item.symbol}
              tag={item.boardCount === null ? null : `${item.boardCount} 连板`}
            />
          </span>
          <span className="visually-hidden">
            {`${item.name} 判断详情，点击或按回车${isOpen ? '收起' : '展开'}`}
          </span>
          {item.reason ? <span className="screener-table__sub">{item.reason}</span> : null}
        </th>
        <td className="is-center">
          <RoleBadges roles={item.roles} />
        </td>
        <td className="is-left">
          <RelationCell relation={item.relation} />
        </td>
        <td className="is-right">
          <span className="screener-table__price">{formatPrice(item.price)}</span>
        </td>
        <td className="is-right">
          <span className={`screener-table__pct${pctClass(item.pct)}`}>
            {formatSignedPercent(item.pct)}
          </span>
        </td>
        <td className="screener-table__num is-right">{formatAmount(item.avgAmount5d)}</td>
        <td className="screener-table__verdict is-left">
          {item.roles.length > 0 ? (
            <ul className="theme-verdict">
              {item.roles
                .flatMap((tag) => tag.reasons.slice(0, 2))
                .map((reason) => (
                  <li key={reason} className="theme-verdict__hit">
                    ✔ {reason}
                  </li>
                ))}
            </ul>
          ) : (
            <span className="screener-table__sub">
              {item.relation.state === 'membership_only'
                ? '仅概念归属，不发确定角色'
                : '暂无确定角色'}
            </span>
          )}
          <span className="screener-table__sub">
            风险：
            {item.risksChecked
              ? item.risks.length > 0
                ? item.risks.join('；')
                : '未见'
              : '未核验'}
          </span>
        </td>
        <td className="screener-table__stack is-right">
          <span>
            {item.metricsState === 'ready'
              ? '已计算'
              : item.metricsState === 'failed'
                ? '计算失败'
                : '未扫描 / 缺数据'}
          </span>
          <span className="screener-table__sub">截止 {formatTradeDate(item.metricsTradeDate)}</span>
        </td>
        <td className="screener-table__action is-center">
          <AddToWatchlistButton
            symbol={item.symbol}
            name={item.name}
            added={watchlistSymbols.has(item.symbol)}
            onAdd={onAddToWatchlist}
          />
        </td>
      </tr>
      {isOpen ? (
        <tr>
          <td colSpan={9}>
            <StockEvidence item={item} evidenceText={evidenceText} />
          </td>
        </tr>
      ) : null}
    </>
  );
});

export const ThemeDetail = ({
  theme,
  tradeDate,
  onAddToWatchlist,
  watchlistSymbols,
}: ThemeDetailProps) => {
  const [data, setData] = useState<ThemeDetailResponseV2>(() => unavailableThemeDetail('加载中'));
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [isRefreshing, setRefreshing] = useState(false);
  const [onlyTagged, setOnlyTagged] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  /** 数据说明与限制的开关：按钮在标题行，正文面板在表头下面 */
  const notes = useWarningNotes();

  // 最新请求保护：切题材 / 刷新时旧请求会被 abort，晚返回不会覆盖新结果
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // 加载时清除不同键（不同题材或不同日期）的结果，避免新标题配旧股票
    setData((previous) =>
      previous.theme?.code === theme.code && previous.tradeDate !== null
        ? previous
        : unavailableThemeDetail('加载中'),
    );
    setRefreshing(true);

    fetchThemeDetail(theme.code, tradeDate, controller.signal)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return;
        const message = error instanceof Error ? error.message : '题材详情请求失败';
        // 只保留当前 code/date 键的缓存并标 stale；无同键缓存才显示 unavailable
        setData((previous) =>
          previous.theme?.code === theme.code && previous.tradeDate !== null
            ? { ...previous, status: 'stale', error: message }
            : unavailableThemeDetail(message),
        );
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [theme.code, tradeDate, refreshCounter]);

  const evidenceById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data.evidence) map.set(item.id, `${item.sourceName}：${item.text}`);
    return map;
  }, [data.evidence]);

  /**
   * 展开开关：父组件持有「当前展开哪一行」，用 useCallback 固定引用，
   * 否则每次渲染都换一个新函数，ThemeRow 的 memo 会被整体击穿。
   */
  const toggleExpanded = useCallback((symbol: string) => {
    setExpanded((current) => (current === symbol ? null : symbol));
  }, []);

  const visibleItems = useMemo(() => {
    const keyword = query.trim();
    return data.items
      .filter((item) => (onlyTagged ? item.roles.length > 0 : true))
      .filter((item) =>
        keyword.length === 0 ? true : item.symbol.includes(keyword) || item.name.includes(keyword),
      )
      .sort((a, b) => Number(b.roles.length > 0) - Number(a.roles.length > 0));
  }, [data.items, onlyTagged, query]);

  const counts = data.items.reduce(
    (accumulator, item) => {
      if (item.relation.state === 'supported') accumulator.supported += 1;
      if (item.relation.state === 'membership_only') accumulator.membershipOnly += 1;
      return accumulator;
    },
    { supported: 0, membershipOnly: 0 },
  );

  return (
    <section className="card" aria-labelledby="theme-detail-title">
      <div className="overview__header">
        <div>
          {/* 「← 返回题材列表」按钮已去掉：切回「题材」标签页即可回到列表，不用两个入口 */}
          <div className="theme-title-row">
            <h2 id="theme-detail-title">
              {data.theme?.name ?? theme.name} · 概念成员涨停{' '}
              {theme.conceptLimitUpCount ?? theme.limitUpCount} 只
            </h2>
            {/*
              警示按钮紧跟在标题后面；正文面板渲染在表头外面（下面），
              这样展开时既不会把右侧统计/刷新挤下去，也不会遮住表格。
            */}
            <WarningNotesToggle
              title="数据说明与限制"
              count={data.warnings.length}
              tooltip="覆盖缺口与口径限制；覆盖不足的部分不做结论"
              open={notes.open}
              panelId={notes.panelId}
              onToggle={notes.toggle}
            />
          </div>
          <p className="status-note">
            交易日 {formatTradeDate(data.tradeDate ?? tradeDate ?? null)} · 更新时间{' '}
            {data.asOf} · 数据状态 {data.status} · 规则版本 {data.ruleVersion}
          </p>
        </div>
        <div className="overview__actions limit-up-list__actions">
          <p className="overview__meta">
            概念成员涨停：<span>{theme.conceptLimitUpCount ?? '—'}</span> · 驱动有依据：
            <span>{theme.supportedLimitUpCount ?? '—'}</span> · 待确认：
            <span>{theme.unresolvedLimitUpCount ?? '—'}</span>
          </p>
          <p className="overview__meta">
            覆盖：总成员 <span>{data.coverage.total}</span> · 已计算{' '}
            <span>{data.coverage.succeeded}</span> · 失败 <span>{data.coverage.failed}</span> ·
            未扫描 <span>{data.coverage.unscanned}</span>
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setRefreshCounter((value) => value + 1)}
            disabled={isRefreshing}
          >
            {isRefreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {/* 数据说明与限制的正文：渲染在表头外面，展开时把下面内容推下去，不遮住表格 */}
      <WarningNotesPanel panelId={notes.panelId} open={notes.open}>
        {data.status === 'partial' ? (
          <p className="warning-notes__headline">
            本次结果不完整（有失败或未扫描成员），角色只在已扫描范围内比较。
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

      {/* 分类依据 + 旧 8 项观察指标一起折叠：让主表默认占据更多可视高度 */}
      <details className="theme-detail__classification">
        <summary className="theme-detail__classification-summary">
          分类依据与观察指标
          {theme.classificationReasons.length > 0 ? (
            <span className="theme-detail__classification-note">
              等 {theme.classificationReasons.length} 条依据
            </span>
          ) : null}
        </summary>

        <div className="theme-detail__classification-body">
          {theme.classificationReasons.length > 1 ? (
            <ul className="theme-detail__reasons">
              {theme.classificationReasons.slice(1).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          {theme.metrics.length > 0 ? (
            <>
              <p className="status-note">旧 8 项观察指标（不决定主线资格，仅逐项展示）</p>
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
            </>
          ) : null}
        </div>
      </details>

      {data.status === 'stale' ? (
        <div className="banner banner--warning" role="status">
          <p>本轮刷新失败，展示的是同一题材上一轮成功结果。</p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </div>
      ) : null}

      {data.status === 'unavailable' ? (
        <div className="banner banner--warning" role="status">
          <p>该题材数据暂不可用。</p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </div>
      ) : null}

      <div className="theme-detail__controls">
        <label className="trend-filters__check">
          <input
            type="checkbox"
            checked={onlyTagged}
            onChange={(event) => setOnlyTagged(event.target.checked)}
          />
          <span>只看有角色标签</span>
        </label>
        <p className="overview__meta">
          {/*
            分母必须是「本轮参与计算的成员数」而不是 coverage.total：
            items 只包含扫过的成员，拿 total 当分母会得到「显示 120 / 717」这种永远差 597 的错觉。
            未扫描数量由 coverage.unscanned 单独说明，覆盖口径不在表里被悄悄改掉。
          */}
          显示 <span>{visibleItems.length}</span> / {data.items.length} 只（本轮已计算{' '}
          <span>{data.coverage.attempted}</span> 只，共 <span>{data.coverage.total}</span>{' '}
          只成员，
          {data.coverage.unscanned > 0 ? (
            <>
              另有 <span>{data.coverage.unscanned}</span> 只未扫描
            </>
          ) : (
            '无未扫描成员'
          )}
          ） · 驱动有依据 <span>{counts.supported}</span> 只 · 仅概念归属{' '}
          <span>{counts.membershipOnly}</span> 只
        </p>
        {/* 搜索框放在最后（靠右），不再占一行；「搜索股票」四个字去掉，只留占位符 */}
        <label className="theme-detail__search">
          <input
            className="input"
            type="search"
            value={query}
            placeholder="搜索代码或名称"
            aria-label="搜索股票"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>
            {isRefreshing
              ? '正在计算…'
              : data.status === 'unavailable'
                ? '数据不可用，无法展示股票明细。'
                : onlyTagged && data.items.every((item) => item.roles.length === 0)
                  ? '当前没有获得角色标签的股票（不代表其他成员不合格）'
                  : '没有匹配的成员'}
          </p>
        </div>
      ) : (
        <div className="screener-table-wrap">
          <table
            className="screener-table screener-table--stocks"
            aria-label={`${theme.name} 题材成员`}
          >
            <thead>
              <tr>
                <th scope="col" className="is-left">
                  股票 / 涨停原因
                </th>
                <th
                  scope="col"
                  className="is-center"
                  title="该股票在本题材内的相对位置（v1 一律是「候选」）"
                >
                  角色
                </th>
                <th scope="col" className="is-left">
                  本轮关联
                </th>
                <th scope="col" className="is-right">
                  现价
                </th>
                <th scope="col" className="is-right">
                  涨跌幅
                </th>
                <th scope="col" className="is-right">
                  5日均额
                </th>
                <th scope="col" className="is-left">
                  依据 / 风险
                </th>
                <th scope="col" className="is-right">
                  数据状态
                </th>
                <th scope="col" className="is-center">
                  自选
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <ThemeRow
                  key={item.symbol}
                  item={item}
                  isOpen={expanded === item.symbol}
                  onToggle={toggleExpanded}
                  evidenceById={evidenceById}
                  watchlistSymbols={watchlistSymbols}
                  onAddToWatchlist={onAddToWatchlist}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
