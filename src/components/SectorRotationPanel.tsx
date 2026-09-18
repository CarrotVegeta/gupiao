import { useEffect, useState } from 'react';
import type { SectorRotationResponse } from '../types';
import {
  DEFAULT_ROTATION_DAYS,
  ROTATION_DAY_OPTIONS,
  fetchSectorRotation,
  type RotationDays,
} from '../lib/sectorRotation';
import { WarningNotesPanel, WarningNotesToggle, useWarningNotes } from './WarningNotes';

/**
 * 板块轮动（财联社）：近 4 / 30 个交易日每日涨幅 top10 的汇总。
 *
 * 自取数、不依赖题材页的日期选择 —— 上游这个接口**没有日期参数**，
 * 它按自己的交易日窗口返回，和「当前查看哪一天」无关。
 * 因此这里只在挂载和切换窗口时各请求一次。
 */
const formatPct = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatDate = (value: string): string =>
  /^\d{8}$/.test(value) ? `${value.slice(4, 6)}-${value.slice(6, 8)}` : value;

/** 只展示进入 top10 次数最多的前 N 个板块：轮动看的是「反复上榜」而不是单日爆发 */
const VISIBLE_LIMIT = 12;

/** 与下面面板里的 <p> 条数一致，只用于按钮上的「（N 条）」 */
const ROTATION_NOTES_COUNT = 4;

/** 稳定引用：`data?.tradeDates ?? []` 每次都新建数组，会让摘要 effect 空转 */
const EMPTY_DATES: string[] = [];

/** 取数结果摘要，交给宿主（导航计数、空状态判断） */
export type RotationSummary = {
  isLoading: boolean;
  hasData: boolean;
  /** 窗口内上榜过的板块总数（不是页面上展示的前 N 个） */
  plateCount: number;
  tradeDates: string[];
};

type SectorRotationPanelProps = {
  /** 每次取数结果变化时回调；用 `useCallback` 稳定引用避免重复触发 */
  onSummary?: (summary: RotationSummary) => void;
};

export const SectorRotationPanel = ({ onSummary }: SectorRotationPanelProps = {}) => {
  const [days, setDays] = useState<RotationDays>(DEFAULT_ROTATION_DAYS);
  const [data, setData] = useState<SectorRotationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void fetchSectorRotation(days).then((response) => {
      if (!cancelled) {
        setData(response);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [days]);

  const notes = useWarningNotes();
  const visible = data?.items.slice(0, VISIBLE_LIMIT) ?? [];
  const hasData = data !== null && data.status !== 'unavailable' && visible.length > 0;

  /*
   * 摘要交给宿主（导航计数）。依赖里放的是具体字段而不是 data 对象：
   * 每次切换窗口都会换一个新对象，只看 data 会让宿主每次都重渲染。
   */
  const plateCount = data?.items.length ?? 0;
  const tradeDates = data?.tradeDates ?? EMPTY_DATES;
  const dataStatus = data?.status ?? null;
  useEffect(() => {
    onSummary?.({
      isLoading,
      hasData: dataStatus !== null && dataStatus !== 'unavailable' && plateCount > 0,
      plateCount,
      tradeDates,
    });
  }, [onSummary, isLoading, dataStatus, plateCount, tradeDates]);

  return (
    <section className="card" aria-labelledby="theme-rotation-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">财联社 · 历史板块口径</p>
          <div className="theme-title-row">
            <h2 id="theme-rotation-title">板块轮动</h2>
            {/* 按钮紧跟标题；正文面板渲染在表头之外（见下方），展开不会挤动右侧控件 */}
            <WarningNotesToggle
              title="数据说明与限制"
              count={ROTATION_NOTES_COUNT}
              open={notes.open}
              panelId={notes.panelId}
              onToggle={notes.toggle}
            />
          </div>
        </div>
        <div className="sector-rotation__controls">
          <p className="overview__meta">
            {isLoading ? (
              '加载中…'
            ) : hasData ? (
              <>
                <span>{data.tradeDates.length}</span> 个交易日
                {data.tradeDates.length > 0 ? (
                  <>
                    （{formatDate(data.tradeDates[0] ?? '')} ~ {formatDate(data.tradeDates.at(-1) ?? '')}）
                  </>
                ) : null}
              </>
            ) : (
              '暂无数据'
            )}
          </p>
          <div className="sector-rotation__tabs" role="group" aria-label="轮动窗口">
            {ROTATION_DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`sector-rotation__tab${days === option ? ' is-active' : ''}`}
                aria-pressed={days === option}
                onClick={() => setDays(option)}
              >
                近 {option} 日
              </button>
            ))}
          </div>
        </div>
      </div>

      <WarningNotesPanel panelId={notes.panelId} open={notes.open}>
        <p>
          数据来自财联社板块轮动接口，窗口内每个交易日涨幅前 10 的板块。上游<b>只支持 4 日与 30 日</b>两个窗口，
          其它天数它不认。
        </p>
        <p>
          「上榜」指当日进入涨幅 top10，<b>不是</b>题材页那种按涨停家数定的主线 / 支线口径：两者板块划分不同
          （财联社概念 vs 东财板块 / 同花顺涨停原因），家数不可直接对齐。
        </p>
        <p>这个接口没有日期参数，返回的是它自己的最近窗口，与页面上正在查看的交易日无关。</p>
        <p>这里给的是板块涨跌幅，不参与题材的主线 / 支线判定，也不构成任何买卖建议。</p>
      </WarningNotesPanel>

      {hasData ? (
        <div className="sector-rotation__list">
          {visible.map((item, index) => (
            <div className="sector-rotation__row" key={item.plateCode}>
              <span className="sector-rotation__rank">{index + 1}</span>
              <span className="sector-rotation__name">{item.plateName}</span>
              <span
                className={`sector-rotation__pct${(item.latestChange ?? 0) >= 0 ? ' is-up' : ' is-down'}`}
                title="最近一个交易日的板块涨跌幅"
              >
                {formatPct(item.latestChange)}
              </span>
              <span className="sector-rotation__stat" title={`窗口内 ${days} 个交易日里进入涨幅 top10 的次数`}>
                上榜 <b>{item.appearCount}</b>/{days}
              </span>
              <span className="sector-rotation__stat" title="窗口内上榜日的单日最大涨幅">
                最大 <b>{formatPct(item.maxChange)}</b>
              </span>
              <span className="sector-rotation__stat" title="窗口内上榜日的平均涨幅">
                均值 <b>{formatPct(item.avgChange)}</b>
              </span>
              <span className="sector-rotation__span" title="首次上榜 → 最近一次上榜">
                {formatDate(item.firstSeen)} → {formatDate(item.lastSeen)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="overview__empty">
          {isLoading ? '正在加载板块轮动…' : (data?.error ?? '财联社板块轮动暂不可用，不影响其它数据')}
        </p>
      )}
    </section>
  );
};
