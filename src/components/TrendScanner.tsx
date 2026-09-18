import { useEffect, useMemo, useState } from 'react';
import type { TrendFilters, TrendPick, TrendScanResponse } from '../types';
import { AddToWatchlistButton } from './AddToWatchlistButton';
import { StockIdentity } from './StockIdentity';
import { formatPrice } from '../lib/quotes';

/**
 * 趋势「形态扫描」页面（第一期纠错版）。
 *
 * 这里刻意没有复用 `src/lib/screener.ts` 里的 fetchTrendScan：
 *   1. 它不接受 AbortSignal，做不了「旧请求晚返回不覆盖新条件」；
 *   2. 它按字段重建响应对象，会把新增的 coverage / matchedTotal / truncated 等披露字段丢掉。
 * 所以趋势页自己带一份最小解析与请求，字段缺失时宁可说「无法确认」，也不假装扫完了。
 *
 * 口径要点（对应实施说明任务 6）：
 *   - 「缩量」只描述量能比（最近已完成日成交量 / 此前 5 日均量），不判断回调；
 *   - 未完成的当日 K 线不参与全天量比较；
 *   - 板块范围筛选已取消，一律全市场（服务端忽略 themeScope）；
 *   - 覆盖 / 截断 / 数据截止日如实披露。
 */

const TREND_ENDPOINT = '/api/screener/trend';
const FORMAT_ERROR = '形态扫描响应数据格式错误';

/** 与服务端 server/screener/trend.ts 的 MAX_SCAN / MAX_ITEMS 对应，只用于界面文案 */
const MAX_SCAN = 260;
const MAX_ROWS = 120;
/** 拉日K上限：0 = 全部（服务端不截断），与服务端 SCAN_ALL 对应 */
const SCAN_ALL = 0;

/** 「拉日K上限」档位：决定实际扫描深度，候选范围本身一律是全市场 */
const SCAN_LIMIT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: MAX_SCAN, label: `${MAX_SCAN} 只（快速，默认）` },
  { value: 1000, label: '1000 只' },
  { value: SCAN_ALL, label: '全部（全市场，约 30~60 秒）' },
];

const scanLimitLabel = (limit: number): string =>
  limit <= SCAN_ALL ? '全部' : `前 ${limit} 只`;

const scanLimitFrom = (value: unknown): number => {
  const next = Number(value);
  return SCAN_LIMIT_OPTIONS.some((option) => option.value === next) ? next : MAX_SCAN;
};

/** 研究结论正文面板的 id：标题行上的按钮用 aria-controls 指过来 */
const RESEARCH_PANEL_ID = 'trend-research-panel';

const DEFAULT_FILTERS: TrendFilters = {
  // 2026-09-18：取消「板块范围」筛选，趋势一律全市场扫描（服务端忽略 themeScope）
  themeScope: 'all',
  maxMa5Dist: 4,
  maxPct: 20,
  pctWindow: 10,
  minStableDays: 3,
  minAmountYi: 5,
  minScore: 5,
  mainOnly: false,
  excludeSt: false,
  // 默认快速扫描 260 只；改成 0 就是全市场拉日K
  scanLimit: MAX_SCAN,
};

/** 缩量列：表头用短标签（长口径写进 title，否则这一列会被撑到数据宽度的两三倍） */
const SHRINK_HEADER = '缩量比';
const SHRINK_TITLE =
  '缩量（最近已完成日成交量/此前5日均量）：<1 表示比最近已完成交易日成交量所对应的此前 5 日均量缩小';

/**
 * 研究结论：审查报告第 8 节的受限表述。
 * 原文里「已被回测否定」「毒源」这类确定性说法不再出现——样本限制不支持把结论说得那么满。
 */
const TREND_RESEARCH_NOTE = {
  /** 折叠条的摘要（折叠状态下直接可见） */
  summary: '研究结论的适用范围（受限）：原五条件组合在既有样本里不支持收益优势',
  /** 折叠状态下也保留的免责声明 */
  disclaimer: '不构成任何买入建议。',
  headline: '研究结论的适用范围（受限）',
  conclusion:
    '本项目既有样本中，原五条件组合的表现不支持收益优势。该研究存在历史归属和执行口径等限制，不代表所有趋势方法无效；当前页面用于形态与板块结构观察。',
  parameterScope:
    '参数变化后，这份结论只针对原配置（默认五条件）；改过条件就属于另一套配置，不能沿用这里的样本结论。',
  details: [
    '全市场命中形态：次日开盘超额 −0.141%（t=−2.56），T+10 −1.440%（t=−3.28）',
    '主线板块 ∩ 形态：次日开盘 −0.162%（t=−2.60），T+10 −1.788%（t=−3.73）—— 加「主线」过滤反而更差',
    '配对检验（加主线过滤）：T+1 −0.173%（t=−2.53）',
    '归因：只加「MA5>MA10>MA20」这一步，主线池 T+10 超额从 +0.084% 崩到 −2.426%（t=−2.25）',
    '样本里唯一有正面作用的是「缩量」条件，但救不回整体',
  ],
  limitations: [
    '回测的主线定义为家数门槛加持续天数，线上为家数加 8 项命中数，两者不是同一套口径。',
    '回测五条件不是原聊天里的完整趋势方法，未覆盖所有均线斜率、阶段位置和加速过滤。',
    '脚本用收盘信息判定，再按同一收盘价入场，属于理想化研究口径。',
    '使用当前板块归属回溯历史，存在前视偏差。',
    '多日收益窗口重叠，t 值按普通均值/标准误计算，未考虑序列相关。',
    '成本、滑点、涨跌停无法成交和停牌等约束没有在脚本里建模。',
  ],
  footer:
    '样本 2026-02-26 ~ 2026-09-16，114 个交易日，超额口径为「相对当日全市场等权」。本页只展示形态分布，不构成任何买入建议。',
};

// ---------------------------------------------------------------------------
// 响应解析（披露字段缺失时降级，不谎称扫描范围）
// ---------------------------------------------------------------------------

type ScanCoverageView = {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unscanned: number;
};

/** 单行的增量字段：服务端在基础 TrendPick 上补的说明项 */
type TrendPickView = TrendPick & {
  industry?: string | null;
  metricsTradeDate?: string | null;
  lastBarCompleted?: boolean | null;
  notes?: string[];
};

type TrendScanView = {
  tradeDate: string | null;
  items: TrendPickView[];
  scanned: number;
  candidates: number;
  filters: TrendFilters;
  fetchedAt: string;
  source: TrendScanResponse['source'];
  status: TrendScanResponse['status'];
  error: string | null;
  coverage: ScanCoverageView | null;
  matchedTotal: number | null;
  returnedCount: number | null;
  truncated: boolean;
  metricsTradeDate: string | null;
  quoteAsOf: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const countField = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const isTradeDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{8}$/.test(value);

const isDateTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

const parseCoverage = (value: unknown): ScanCoverageView | null => {
  if (!isRecord(value)) return null;
  const total = countField(value.total);
  const attempted = countField(value.attempted);
  const succeeded = countField(value.succeeded);
  const failed = countField(value.failed);
  const unscanned = countField(value.unscanned);
  if (
    total === null ||
    attempted === null ||
    succeeded === null ||
    failed === null ||
    unscanned === null
  ) {
    return null;
  }
  // 覆盖数必须自洽，否则宁可不显示，也不能给一个对不上的范围
  if (attempted !== succeeded + failed) return null;
  if (total !== attempted + unscanned) return null;
  return { total, attempted, succeeded, failed, unscanned };
};

const unavailableView = (error: string): TrendScanView => ({
  tradeDate: null,
  items: [],
  scanned: 0,
  candidates: 0,
  filters: DEFAULT_FILTERS,
  fetchedAt: new Date().toISOString(),
  source: 'eastmoney',
  status: 'unavailable',
  error,
  coverage: null,
  matchedTotal: null,
  returnedCount: null,
  truncated: false,
  metricsTradeDate: null,
  quoteAsOf: null,
});

const isPickLike = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && typeof value.symbol === 'string' && /^\d{6}$/.test(value.symbol);

const parseTrendScanView = (payload: unknown): TrendScanView | null => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isPickLike) ||
    (payload.status !== 'fresh' && payload.status !== 'stale' && payload.status !== 'unavailable')
  ) {
    return null;
  }

  if (payload.status === 'unavailable') {
    return unavailableView(typeof payload.error === 'string' ? payload.error : FORMAT_ERROR);
  }

  const rawFilters = isRecord(payload.filters) ? payload.filters : {};
  return {
    tradeDate: isTradeDate(payload.tradeDate) ? payload.tradeDate : null,
    items: payload.items as TrendPickView[],
    scanned: countField(payload.scanned) ?? 0,
    candidates: countField(payload.candidates) ?? 0,
    filters: {
      // 板块范围固定为全市场：对外不再暴露这一档筛选
      themeScope: 'all',
      maxMa5Dist: Number(rawFilters.maxMa5Dist ?? DEFAULT_FILTERS.maxMa5Dist),
      maxPct: Number(rawFilters.maxPct ?? DEFAULT_FILTERS.maxPct),
      pctWindow: Number(rawFilters.pctWindow ?? DEFAULT_FILTERS.pctWindow),
      minStableDays: Number(rawFilters.minStableDays ?? DEFAULT_FILTERS.minStableDays),
      minAmountYi: Number(rawFilters.minAmountYi ?? DEFAULT_FILTERS.minAmountYi),
      minScore: Number(rawFilters.minScore ?? DEFAULT_FILTERS.minScore),
      mainOnly: rawFilters.mainOnly === true,
      excludeSt: rawFilters.excludeSt === true,
      scanLimit: scanLimitFrom(rawFilters.scanLimit ?? DEFAULT_FILTERS.scanLimit),
    },
    fetchedAt: isDateTime(payload.fetchedAt) ? payload.fetchedAt : new Date().toISOString(),
    source: 'eastmoney',
    status: payload.status,
    error: typeof payload.error === 'string' ? payload.error : null,
    coverage: parseCoverage(payload.coverage),
    matchedTotal: countField(payload.matchedTotal),
    returnedCount: countField(payload.returnedCount),
    truncated: payload.truncated === true,
    metricsTradeDate: isTradeDate(payload.metricsTradeDate) ? payload.metricsTradeDate : null,
    quoteAsOf: isDateTime(payload.quoteAsOf) ? payload.quoteAsOf : null,
  };
};

const fetchTrendScanView = async (
  filters: TrendFilters,
  signal: AbortSignal,
): Promise<TrendScanView> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    params.set(key, String(value));
  }

  const response = await fetch(`${TREND_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`形态扫描请求失败（${response.status}）`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailableView(FORMAT_ERROR);
  }

  // 格式不认识时按「暂不可用」处理：页面明确说不可用，好过显示一份对不上的结果
  return parseTrendScanView(payload) ?? unavailableView(FORMAT_ERROR);
};

// ---------------------------------------------------------------------------
// 草稿条件与校验（空输入不转 0、非整数天数与越界都给字段错误）
// ---------------------------------------------------------------------------

type TrendDraft = {
  maxMa5Dist: string;
  maxPct: string;
  pctWindow: number;
  minStableDays: string;
  minAmountYi: string;
  minScore: number;
  mainOnly: boolean;
  excludeSt: boolean;
  /** 拉日K上限：只从固定档位里选，所以没有字段级校验 */
  scanLimit: number;
};

type DraftNumberField = 'maxMa5Dist' | 'maxPct' | 'minStableDays' | 'minAmountYi';

const FIELD_RULES: Record<
  DraftNumberField,
  { label: string; min: number; max: number; step: number; integer: boolean }
> = {
  maxMa5Dist: { label: '距 5 日线绝对偏离上限（%）', min: 0, max: 30, step: 0.5, integer: false },
  maxPct: { label: '近期涨幅上限（%）', min: 0, max: 200, step: 1, integer: false },
  minStableDays: { label: '连续站稳 5 日线（天）', min: 1, max: 10, step: 1, integer: true },
  minAmountYi: { label: '日均成交额下限（亿）', min: 0, max: 500, step: 0.5, integer: false },
};

const DRAFT_NUMBER_FIELDS = Object.keys(FIELD_RULES) as DraftNumberField[];

const draftFrom = (filters: TrendFilters): TrendDraft => ({
  maxMa5Dist: String(filters.maxMa5Dist),
  maxPct: String(filters.maxPct),
  pctWindow: filters.pctWindow,
  minStableDays: String(filters.minStableDays),
  minAmountYi: String(filters.minAmountYi),
  minScore: filters.minScore,
  mainOnly: filters.mainOnly,
  excludeSt: filters.excludeSt,
  scanLimit: scanLimitFrom(filters.scanLimit),
});

const validateDraft = (
  draft: TrendDraft,
): { filters: TrendFilters | null; errors: Partial<Record<DraftNumberField, string>> } => {
  const errors: Partial<Record<DraftNumberField, string>> = {};

  for (const key of DRAFT_NUMBER_FIELDS) {
    const raw = draft[key].trim();
    if (raw === '') {
      errors[key] = '不能为空（空值不会按 0 处理）';
      continue;
    }
    const value = Number(raw);
    const rule = FIELD_RULES[key];
    if (!Number.isFinite(value)) {
      errors[key] = '必须是数字';
      continue;
    }
    if (rule.integer && !Number.isInteger(value)) {
      errors[key] = '必须是整数天数';
      continue;
    }
    if (value < rule.min || value > rule.max) {
      errors[key] = `必须在 ${rule.min} ~ ${rule.max} 之间`;
    }
  }

  if (Object.keys(errors).length > 0) return { filters: null, errors };

  return {
    filters: {
      // 板块范围固定为全市场：对外不再暴露这一档筛选
      themeScope: 'all',
      maxMa5Dist: Number(draft.maxMa5Dist),
      maxPct: Number(draft.maxPct),
      pctWindow: draft.pctWindow,
      minStableDays: Number(draft.minStableDays),
      minAmountYi: Number(draft.minAmountYi),
      minScore: draft.minScore,
      mainOnly: draft.mainOnly,
      excludeSt: draft.excludeSt,
      scanLimit: scanLimitFrom(draft.scanLimit),
    },
    errors,
  };
};

/** 生效条件的稳定键：参数没变就不重复打上游，也用来判断旧结果属不属于当前条件 */
const filtersKey = (filters: TrendFilters): string =>
  [
    filters.themeScope,
    filters.maxMa5Dist,
    filters.maxPct,
    filters.pctWindow,
    filters.minStableDays,
    filters.minAmountYi,
    filters.minScore,
    filters.mainOnly,
    filters.excludeSt,
    filters.scanLimit,
  ].join('|');

// ---------------------------------------------------------------------------
// 展示格式
// ---------------------------------------------------------------------------

const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatAmount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value / 1e8).toFixed(2)} 亿`;

const pctClass = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '' : value >= 0 ? ' is-up' : ' is-down';

const formatIndustry = (value: unknown): string => {
  if (typeof value !== 'string') return '—';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '—';
};

const formatAsOf = (value: string | null): string => {
  if (value === null) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  // 统一按东八区显示，避免浏览器时区把日期看成前一天
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

/** 均线排列只表达「是不是多头排列」这一个结论，具体均线数值不在这张表里展示 */
const maView = (item: TrendPickView): { bull: boolean | null } => {
  if (item.ma5 === null || item.ma10 === null || item.ma20 === null) return { bull: null };
  return { bull: item.ma5 > item.ma10 && item.ma10 > item.ma20 };
};

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

type TrendScannerProps = {
  onAddToWatchlist?: (stock: { symbol: string; name: string }) => void;
  watchlistSymbols?: ReadonlySet<string>;
};

export const TrendScanner = ({
  onAddToWatchlist,
  watchlistSymbols,
}: TrendScannerProps = {}) => {
  const [draft, setDraft] = useState<TrendDraft>(() => draftFrom(DEFAULT_FILTERS));
  const [applied, setApplied] = useState<TrendFilters>(DEFAULT_FILTERS);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DraftNumberField, string>>>({});
  const [view, setView] = useState<{ key: string; data: TrendScanView } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [isRefreshing, setRefreshing] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  /** 研究结论默认不占版面：只有点了标题行上的警示按钮才展开正文 */
  const [researchOpen, setResearchOpen] = useState(false);

  const appliedKey = useMemo(() => filtersKey(applied), [applied]);

  /**
   * 最新请求保护：切换条件时旧条件的结果不再展示，旧请求晚返回也必须丢弃。
   * 失败时只保留「同一查询键」的旧结果并标过期。
   */
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const key = appliedKey;
    setRefreshing(true);

    fetchTrendScanView(applied, controller.signal)
      .then((next) => {
        if (!active) return;
        setView({ key, data: next });
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return;
        setFailure({
          key,
          message: error instanceof Error ? error.message : '形态扫描请求失败',
        });
        // 同一查询键失败：保留上一轮结果并标成过期，不把已有数据清空
        setView((previous) =>
          previous !== null && previous.key === key
            ? { key, data: { ...previous.data, status: 'stale' } }
            : previous,
        );
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [applied, appliedKey, refreshToken]);

  const current = view !== null && view.key === appliedKey ? view.data : null;
  const currentFailure = failure !== null && failure.key === appliedKey ? failure.message : null;

  const applyDraft = (): void => {
    const { filters, errors } = validateDraft(draft);
    setFieldErrors(errors);
    if (filters === null) return;
    // 条件没变就不重复打上游
    if (filtersKey(filters) === appliedKey) return;
    setApplied(filters);
  };

  const rescan = (): void => setRefreshToken((value) => value + 1);

  const coverage = current?.coverage ?? null;
  const matchedTotal = current === null ? 0 : (current.matchedTotal ?? current.items.length);
  const hiddenRows =
    current !== null && current.matchedTotal !== null && current.returnedCount !== null
      ? Math.max(current.matchedTotal - current.returnedCount, 0)
      : null;

  return (
    <section className="card" aria-labelledby="trend-scanner-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">形态扫描</p>
          <div className="trend-title-row">
            <h2 id="trend-scanner-title">趋势形态扫描（不是选股信号）</h2>

            {/*
              研究结论的开关：警示图标按钮紧跟在标题后面（不是放到标题与统计中间）。
              正文仍在下面原位置（标题下面、表格上面）展开。
            */}
            <button
              className="warning-notes__toggle warning-notes__toggle--warning trend-research__toggle"
              type="button"
              aria-expanded={researchOpen}
              aria-controls={RESEARCH_PANEL_ID}
              title={`${TREND_RESEARCH_NOTE.summary}。${TREND_RESEARCH_NOTE.disclaimer}`}
              onClick={() => setResearchOpen((open) => !open)}
            >
              <span className="warning-notes__icon" aria-hidden="true">
                ⚠
              </span>
              <span>研究结论</span>
              <span className="warning-notes__caret" aria-hidden="true">
                {researchOpen ? '▾' : '▸'}
              </span>
            </button>
          </div>
        </div>

        <div className="overview__actions limit-up-list__actions">
          <p className="overview__meta">
            候选：<span>{current?.candidates ?? 0} 只</span> · 拉日K：
            <span>{current?.scanned ?? 0} 只</span> · 命中：<span>{matchedTotal} 只</span>
            （已扫描范围内）
          </p>
        </div>
      </div>

      {/*
        研究结论正文：由标题行上的「⚠ 研究结论」按钮开关，位置保持不变（标题下面、表格上面），
        展开时把下面的内容推下去，和原来的折叠条行为一致。
      */}
      <div
        className="trend-research trend-research--panel"
        id={RESEARCH_PANEL_ID}
        hidden={!researchOpen}
      >
        <p className="trend-research__headline">{TREND_RESEARCH_NOTE.headline}</p>
        <p>{TREND_RESEARCH_NOTE.conclusion}</p>
        <p className="status-note">{TREND_RESEARCH_NOTE.parameterScope}</p>
        <details className="trend-research__details">
          <summary>展开原研究细节与已知限制</summary>
          <ul>
            {TREND_RESEARCH_NOTE.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="status-note">已知限制：</p>
          <ul>
            {TREND_RESEARCH_NOTE.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
        <p className="status-note">{TREND_RESEARCH_NOTE.footer}</p>
      </div>

      {/* 条件筛选 + 生效条件 + 覆盖说明整体折叠：折叠态只留一行「条件与扫描范围」摘要 */}
      <details className="trend-settings">
        <summary className="trend-settings__summary">
          <span className="trend-settings__summary-text">
            条件与扫描范围：{applied.minScore}/5 档 · 偏离 ≤{applied.maxMa5Dist}% · 近{applied.pctWindow}
            日涨幅 ≤{applied.maxPct}% · 站稳 {applied.minStableDays} 日 · 5日均额 ≥{applied.minAmountYi} 亿
            · 全市场 · 拉日K {scanLimitLabel(applied.scanLimit)}
          </span>
          <span className="trend-settings__summary-note">
            {coverage === null
              ? '覆盖未披露'
              : `已扫描 ${coverage.attempted} / ${coverage.total} 只${
                  coverage.unscanned > 0 ? `（未扫描 ${coverage.unscanned}）` : ''
                }`}
            {' · '}
            点开可改条件
          </span>
        </summary>

        <div className="trend-settings__body">
          {/* noValidate：校验统一由 validateDraft 给中文字段错误，而不是浏览器原生气泡 */}
          <form
            className="trend-filters"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              applyDraft();
            }}
          >
            {/* 候选范围固定全市场（旧的「仅主线板块」筛选已取消）；深度由下面的「拉日K上限」决定 */}
            <p className="trend-filters__scope" role="note">
              候选范围：<b>全市场</b>（已取消「仅主线板块」筛选，这里改不动）；下面「拉日K上限」
              决定实际扫描深度
            </p>

            <label className="trend-filters__field">
              <span>拉日K上限</span>
              <select
                value={draft.scanLimit}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((previous) => ({ ...previous, scanLimit: value }));
                }}
              >
                {SCAN_LIMIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="trend-filters__field">
              <span>{FIELD_RULES.maxMa5Dist.label}</span>
              <input
                type="number"
                min={FIELD_RULES.maxMa5Dist.min}
                max={FIELD_RULES.maxMa5Dist.max}
                step={FIELD_RULES.maxMa5Dist.step}
                value={draft.maxMa5Dist}
                aria-invalid={fieldErrors.maxMa5Dist ? true : undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) => ({ ...previous, maxMa5Dist: value }));
                }}
              />
              {fieldErrors.maxMa5Dist ? (
                <span className="trend-filters__error" role="alert">
                  {fieldErrors.maxMa5Dist}
                </span>
              ) : null}
            </label>

            <label className="trend-filters__field">
              <span>{FIELD_RULES.maxPct.label}</span>
              <input
                type="number"
                min={FIELD_RULES.maxPct.min}
                max={FIELD_RULES.maxPct.max}
                step={FIELD_RULES.maxPct.step}
                value={draft.maxPct}
                aria-invalid={fieldErrors.maxPct ? true : undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) => ({ ...previous, maxPct: value }));
                }}
              />
              {fieldErrors.maxPct ? (
                <span className="trend-filters__error" role="alert">
                  {fieldErrors.maxPct}
                </span>
              ) : null}
            </label>

            <label className="trend-filters__field">
              <span>涨幅窗口</span>
              <select
                value={draft.pctWindow}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((previous) => ({ ...previous, pctWindow: value }));
                }}
              >
                <option value={5}>5 日</option>
                <option value={10}>10 日</option>
                <option value={20}>20 日</option>
              </select>
            </label>

            <label className="trend-filters__field">
              <span>{FIELD_RULES.minStableDays.label}</span>
              <input
                type="number"
                min={FIELD_RULES.minStableDays.min}
                max={FIELD_RULES.minStableDays.max}
                step={FIELD_RULES.minStableDays.step}
                value={draft.minStableDays}
                aria-invalid={fieldErrors.minStableDays ? true : undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) => ({ ...previous, minStableDays: value }));
                }}
              />
              {fieldErrors.minStableDays ? (
                <span className="trend-filters__error" role="alert">
                  {fieldErrors.minStableDays}
                </span>
              ) : null}
            </label>

            <label className="trend-filters__field">
              <span>{FIELD_RULES.minAmountYi.label}</span>
              <input
                type="number"
                min={FIELD_RULES.minAmountYi.min}
                max={FIELD_RULES.minAmountYi.max}
                step={FIELD_RULES.minAmountYi.step}
                value={draft.minAmountYi}
                aria-invalid={fieldErrors.minAmountYi ? true : undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) => ({ ...previous, minAmountYi: value }));
                }}
              />
              {fieldErrors.minAmountYi ? (
                <span className="trend-filters__error" role="alert">
                  {fieldErrors.minAmountYi}
                </span>
              ) : null}
            </label>

            <label className="trend-filters__field">
              <span>至少满足条件数</span>
              <select
                value={draft.minScore}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((previous) => ({ ...previous, minScore: value }));
                }}
              >
                <option value={5}>5/5（5 个形态条件全中）</option>
                <option value={4}>4/5（看差一点）</option>
                <option value={3}>3/5（放宽）</option>
              </select>
            </label>

            <label className="trend-filters__check">
              <input
                type="checkbox"
                checked={draft.mainOnly}
                onChange={(event) => {
                  const value = event.target.checked;
                  setDraft((previous) => ({ ...previous, mainOnly: value }));
                }}
              />
              <span>仅沪深主板</span>
            </label>

            <label className="trend-filters__check">
              <input
                type="checkbox"
                checked={draft.excludeSt}
                onChange={(event) => {
                  const value = event.target.checked;
                  setDraft((previous) => ({ ...previous, excludeSt: value }));
                }}
              />
              <span>排除 ST</span>
            </label>

            <div className="trend-filters__actions">
              <button className="button" type="submit">
                应用
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={rescan}
                disabled={isRefreshing}
              >
                {isRefreshing ? '扫描中…' : '重新扫描'}
              </button>
            </div>
          </form>

          <p className="status-note">
            生效条件：{applied.minScore}/5 档 · 距 5 日线绝对偏离 ≤{applied.maxMa5Dist}% · 近{' '}
            {applied.pctWindow} 日涨幅 ≤{applied.maxPct}% · 连续站稳 {applied.minStableDays} 日 · 近5日均额 ≥
            {applied.minAmountYi} 亿 · 全市场 · 拉日K {scanLimitLabel(applied.scanLimit)}
            （改动输入后点「应用」才生效；「重新扫描」用这组已生效条件）
          </p>

          {applied.scanLimit <= SCAN_ALL ? (
            <p className="status-note" role="note">
              当前是「全部」扫描：一次请求要把全市场候选（约 5900 只）的日K都拉完，首次实测约 36 秒，
              期间页面会停在「扫描中…」，请不要重复点「应用 / 重新扫描」。日K 缓存 10 分钟，
              期间再扫（包括点「重新扫描」）只补没拉到的部分。
            </p>
          ) : null}

          {currentFailure === null && current !== null && current.status !== 'unavailable' ? (
            <div className="trend-coverage" role="note">
              {coverage === null ? (
                <p>服务端未返回可用的覆盖数据，无法确认扫描范围与未扫描数量。</p>
              ) : (
                <>
                  <p>
                    扫描范围 {coverage.total} 只 · 已拉日K {coverage.attempted} 只（成功 {coverage.succeeded} /
                    失败 {coverage.failed}） · 未扫描 {coverage.unscanned} 只
                  </p>
                  {coverage.unscanned > 0 ? (
                    <p className="status-note">
                      本次只拉了 {applied.scanLimit > SCAN_ALL ? applied.scanLimit : coverage.attempted}{' '}
                      只日K（按当日成交额从高到低取），还有 {coverage.unscanned} 只未扫描，
                      不代表全市场筛选完成；把「拉日K上限」改成「全部」可以覆盖全市场。
                    </p>
                  ) : null}
                  {coverage.failed > 0 ? (
                    <p className="status-note">
                      失败 {coverage.failed} 只是「上游没给可用日K」，不是被条件筛掉：以 43 / 83 开头的老
                      北交所代码段实测无日K，另外还有上市不足 20 根、停牌与退市的票；它们不参与形态判定，
                      也不算进命中数。
                    </p>
                  ) : null}
                  {hiddenRows !== null && hiddenRows > 0 ? (
                    <p className="status-note">
                      结果最多显示 {MAX_ROWS} 行，已显示 {current.returnedCount} 行，还有 {hiddenRows} 条未显示。
                    </p>
                  ) : null}
                  {current.truncated && coverage.unscanned === 0 && (hiddenRows ?? 0) <= 0 ? (
                    <p className="status-note">结果被截断，未覆盖全部候选。</p>
                  ) : null}
                </>
              )}
              <p className="status-note">
                日K截止日：{current.metricsTradeDate ?? '未知（没有取得已完成日K）'}
                （参与计算的最新已完成交易日，个别停牌股会更早） · 报价观察时间：
                {formatAsOf(current.quoteAsOf)}（上游快照不带逐条报价时间，这里是抓取时刻）
              </p>
            </div>
          ) : null}
        </div>
      </details>

      {current !== null && current.filters.minScore < 5 ? (
        <p className="status-note" role="note">
          当前是 {current.filters.minScore}/5 档的旧模板研究模式：只放宽了「命中条件数」，没命中的项仍逐条列在
          「命中条件」列里，不等于所有硬条件都已通过。
        </p>
      ) : null}

      {currentFailure !== null ? (
        <div className="banner banner--warning" role="status">
          <p>
            {current !== null && current.status === 'stale'
              ? '本次扫描请求失败，下面是同一条件下的上一轮结果（可能已过期）。'
              : '形态扫描请求失败。'}
          </p>
          <p className="status-note">{currentFailure}</p>
        </div>
      ) : null}

      {current === null ? (
        <div className="empty-state empty-state--subtle">
          <p>{isRefreshing ? '正在扫描…' : '还没有可用结果。'}</p>
        </div>
      ) : current.status === 'unavailable' ? (
        <div className="banner banner--warning" role="status">
          <p>形态扫描暂不可用。</p>
          {current.error ? <p className="status-note">{current.error}</p> : null}
        </div>
      ) : current.items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>
            {isRefreshing
              ? '正在扫描…'
              : `已扫描范围内没有满足 ${current.filters.minScore}/5 个形态条件、且近5日均额不低于 ${current.filters.minAmountYi} 亿的股票，可以放宽条件后重新应用。`}
          </p>
        </div>
      ) : (
        <div className="screener-table-wrap">
          {/* 独立滚动容器：列多时横向滚，不靠压缩每列宽度来塞 */}
          <table className="screener-table screener-table--trend" aria-label="趋势形态扫描结果">
            <thead>
              <tr>
                <th scope="col" className="is-left">
                  股票
                </th>
                <th
                  scope="col"
                  className="is-left"
                  title="所属行业板块，来自上游行情快照的板块归属"
                >
                  板块
                </th>
                <th scope="col" className="is-right">
                  现价
                </th>
                <th scope="col" className="is-right">
                  涨跌幅
                </th>
                <th scope="col" className="is-center">
                  均线排列
                </th>
                <th
                  scope="col"
                  className="is-right"
                  title="距 5 日线的有向偏离（%）：正数在 5 日线上方，负数在下方"
                >
                  距5日线偏离
                </th>
                <th scope="col" className="is-right" title="连续站稳 5 日线的天数">
                  连续站稳
                </th>
                <th scope="col" className="is-right" title={SHRINK_TITLE}>
                  {SHRINK_HEADER}
                </th>
                <th
                  scope="col"
                  className="is-right"
                  title={`近 ${current.filters.pctWindow} 个交易日的区间涨幅`}
                >
                  {current.filters.pctWindow}日涨幅
                </th>
                <th scope="col" className="is-right">
                  5日均额
                </th>
                <th scope="col" className="is-left">
                  命中条件
                </th>
                <th scope="col" className="is-center">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {current.items.map((item) => {
                const ma = maView(item);
                const added = watchlistSymbols?.has(item.symbol) ?? false;
                return (
                  <tr key={item.symbol}>
                    <th scope="row" className="is-left">
                      <StockIdentity name={item.name} code={item.symbol} />
                    </th>
                    <td className="is-left">{formatIndustry(item.industry)}</td>
                    <td className="is-right">
                      <span className="screener-table__price">{formatPrice(item.price)}</span>
                    </td>
                    <td className="is-right">
                      <span className={`screener-table__pct${pctClass(item.pct)}`}>
                        {formatSignedPercent(item.pct)}
                      </span>
                    </td>
                    <td className="is-center">
                      <span className={`screener-table__badge${ma.bull === true ? ' is-on' : ''}`}>
                        {ma.bull === null ? '—' : ma.bull ? '多头' : '非多头'}
                      </span>
                    </td>
                    <td className="screener-table__num is-right">
                      {formatSignedPercent(item.distMa5)}
                    </td>
                    <td className="screener-table__num is-right">
                      {item.stableDays === null ? '—' : `${item.stableDays} 天`}
                    </td>
                    <td
                      className="screener-table__num is-right"
                      title={
                        item.metricsTradeDate
                          ? `${SHRINK_HEADER}取自最近已完成交易日 ${item.metricsTradeDate}`
                          : `${SHRINK_HEADER}没有可用的已完成交易日`
                      }
                    >
                      {item.shrink === null ? '—' : item.shrink.toFixed(2)}
                    </td>
                    <td className="screener-table__num is-right">
                      {formatSignedPercent(item.pctWindow)}
                    </td>
                    <td className="screener-table__num is-right">
                      {formatAmount(item.avgAmount5d)}
                    </td>
                    <td className="screener-table__verdict is-left">
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
                      {(item.notes ?? []).map((note) => (
                        <p key={note} className="theme-verdict__note">
                          {note}
                        </p>
                      ))}
                    </td>
                    <td className="is-center">
                      {onAddToWatchlist ? (
                        <AddToWatchlistButton
                          symbol={item.symbol}
                          name={item.name}
                          added={added}
                          onAdd={onAddToWatchlist}
                        />
                      ) : null}
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
