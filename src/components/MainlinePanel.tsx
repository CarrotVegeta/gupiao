import { memo, useMemo, useState } from 'react';
import type {
  MainlineBoardReport,
  MainlineDay,
  MainlineReport,
  MainlineTier,
} from '../types';

const TIER_LABEL: Record<MainlineTier, string> = {
  mainline: '市场主线',
  candidate: '主线候选',
  branch: '支线题材',
  one_day: '一日游',
};

const TIER_TONE: Record<MainlineTier, string> = {
  mainline: 'is-mainline',
  candidate: 'is-candidate',
  branch: 'is-branch',
  one_day: 'is-oneday',
};

const RANK_LABEL: Record<string, string> = {
  pct: '涨幅',
  limitUp: '涨停家数',
  flow: '主力净流入',
  amount: '成交额',
};

const DAY_KIND_LABEL: Record<MainlineDay['dayKind'], string> = {
  strong: '强势',
  divergence: '分歧',
  weak: '弱',
};

/** 章节跳转目标：id 与下面 h3 的 id 一一对应 */
const JUMP_TARGETS = [
  { id: 'mainline-section-ranks', label: '一 · 四榜并列' },
  { id: 'mainline-section-repeat', label: '二 · 反复出现' },
  { id: 'mainline-section-overview', label: '三 · 板块总览' },
  { id: 'mainline-section-detail', label: '四 · 重点明细' },
] as const;

const yi = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${(value / 1e8).toFixed(1)}亿`;

const pctText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const latestOf = (board: MainlineBoardReport): MainlineDay | null =>
  board.days.length === 0 ? null : board.days[board.days.length - 1];

/** 分歧后状态：+1 回流 / 0 未确认 / -1 退潮 / null 没出现分歧日 */
const returnText = (value: number | null): string => {
  if (value === 1) return '已回流';
  if (value === -1) return '退潮';
  if (value === 0) return '未确认';
  return '—';
};

const returnTone = (value: number | null): string => {
  if (value === 1) return 'is-up';
  if (value === -1) return 'is-down';
  return '';
};

export type MainlineLoadState = 'idle' | 'loading' | 'ready' | 'ready-empty' | 'error';

type MainlinePanelProps = {
  data: MainlineReport;
  /**
   * 加载状态。**必须与「有没有数据」分开**：
   * 5 天窗口的请求实测约 7 秒，这期间如果按「没有数据」渲染，
   * 用户看到的就是「暂时没有主线数据」——把加载中误报成没数据。
   */
  loadState: MainlineLoadState;
  loadError: string | null;
  onRefresh: () => void;
};

/**
 * 选股页「主线」档。
 *
 * 这是原方法那套收盘后动作序列的页面形态，四段对应四个动作：
 *   ① 四榜并列（涨幅 / 涨停家数 / 主力净流入 / 成交额）
 *   ② 反复出现的板块（连续在同一个榜的前列）
 *   ③ 当日板块总览（得分 / 分档 / 梯队摘要）
 *   ④ 重点板块明细（五档阵容 + 题材 + 逐日轨迹 + 评分逐项）
 *
 * 三条展示纪律：
 *   1. 算不出来的字段显示「—」并在依据里写「不可判定」，**不拿别的数字顶**；
 *   2. 评分不是买卖信号 —— 页头与分档标签都要能看出这一点；
 *   3. 内容很长（一屏放不下），所以给章节跳转，避免让人以为下面没内容。
 */
export const MainlinePanel = memo(function MainlinePanel({
  data,
  loadState,
  loadError,
  onRefresh,
}: MainlinePanelProps) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const selectable = useMemo(
    () => data.boards.filter((board) => board.score !== null),
    [data.boards],
  );
  const selected =
    selectable.find((board) => board.code === selectedCode) ?? selectable[0] ?? null;

  const repeat = useMemo(
    () => selectable.filter((board) => board.maxRankStreak >= 3),
    [selectable],
  );

  const hasData = data.boards.length > 0;
  /** 有数据时刷新，旧数据继续显示；没有数据时才算「正在加载」 */
  const isLoading = loadState === 'loading' || loadState === 'idle';
  const showLoading = isLoading && !hasData;
  const showEmpty = !hasData && (loadState === 'ready' || loadState === 'ready-empty');
  const showError = !hasData && loadState === 'error';

  const jumpTo = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <>
      <section className="card" aria-labelledby="mainline-title">
        <div className="overview__header">
          <div>
            <p className="eyebrow">主线复盘 · 收盘后固定动作</p>
            <div className="theme-title-row">
              <h2 id="mainline-title">主线</h2>
              <span className="theme-card__badge">
                {showLoading
                  ? '正在拉取'
                  : data.tradeDates.length > 0
                    ? `${data.tradeDates[0]} ~ ${data.latestDate}（${data.tradeDates.length} 个交易日）`
                    : '暂无交易日'}
              </span>
            </div>
          </div>
          <div className="overview__actions limit-up-list__actions">
            <p className="overview__meta">板块宇宙：同花顺涨停板块 Top 20 历史并集</p>
            <p className="overview__meta">
              主力净流入：{showLoading ? '—' : data.flowAvailable ? '可用' : '不可用'}
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
            >
              {isLoading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        {data.warnings.length > 0 ? (
          <details className="warning-notes">
            <summary className="warning-notes__headline">数据说明与限制</summary>
            <ul className="warning-notes__list">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}

        {hasData ? (
          <nav className="mainline-jump" aria-label="主线报告章节">
            {JUMP_TARGETS.map((target) => (
              <button
                className="mainline-jump__item"
                key={target.id}
                type="button"
                onClick={() => jumpTo(target.id)}
              >
                {target.label}
              </button>
            ))}
          </nav>
        ) : null}

        {showLoading ? (
          /* 加载中：只报「正在拉取」，绝不说「没有数据」 */
          <div className="empty-state empty-state--subtle" role="status" aria-live="polite">
            <p>正在拉取主线数据…</p>
            <p className="status-note">
              5 天窗口大约需要 7 秒（要先拉这几天的涨停板块、涨停池和板块实时行情）。
            </p>
          </div>
        ) : showError ? (
          <div className="banner banner--warning" role="status">
            <p>主线数据拉取失败。</p>
            {loadError ? <p className="status-note">{loadError}</p> : null}
            <p className="status-note">点右上角「刷新」重试；这里不会用旧数据顶上。</p>
          </div>
        ) : showEmpty ? (
          <div className="empty-state empty-state--subtle">
            <p>拉取完成，但当前窗口内没有可用的主线数据。</p>
            <p className="status-note">
              常见原因是所选区间没有交易日（周末 / 节假日 / 数据尚未生成）。
            </p>
          </div>
        ) : (
          <div className="mainline-body">
            {/* ① 四榜并列 */}
            <h3 className="mainline-section-title" id="mainline-section-ranks">
              一、四榜并列（最新交易日）
            </h3>
            <div className="mainline-rank-grid">
              {data.ranks.map((table) => (
                <div className="mainline-rank-card" key={table.key}>
                  <p className="eyebrow">{table.label}</p>
                  <ol className="mainline-rank-list">
                    {table.rows.slice(0, 10).map((board, index) => {
                      const latest = latestOf(board);
                      return (
                        <li key={board.code}>
                          <span className="mainline-rank-list__no">{index + 1}</span>
                          <button
                            className="mainline-rank-list__name"
                            type="button"
                            onClick={() => setSelectedCode(board.code)}
                          >
                            {board.name}
                          </button>
                          <span className="mainline-rank-list__value">
                            {table.key === 'limitUp'
                              ? `${latest?.limitUpCount ?? '—'} 家`
                              : table.key === 'pct'
                                ? pctText(latest?.pct)
                                : table.key === 'flow'
                                  ? yi(latest?.mainNet)
                                  : yi(latest?.amount)}
                          </span>
                          <span
                            className={`mainline-rank-list__streak${board.maxRankStreak >= 3 ? ' is-hot' : ''}`}
                          >
                            {board.maxRankStreak >= 2 ? `连${board.maxRankStreak}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>

            {/* ② 反复出现的板块 */}
            <h3 className="mainline-section-title" id="mainline-section-repeat">
              二、反复出现的板块（连续 3 天以上在同一个榜的前列）
            </h3>
            {repeat.length === 0 ? (
              <div className="banner banner--warning" role="status">
                <p>窗口内没有板块达成连续 3 天在任一榜的前列。</p>
              </div>
            ) : (
              <div className="mainline-repeat-list">
                {repeat.map((board) => {
                  const latest = latestOf(board);
                  return (
                    <button
                      className="mainline-repeat-card"
                      type="button"
                      key={board.code}
                      onClick={() => setSelectedCode(board.code)}
                      aria-current={selected?.code === board.code}
                    >
                      <span className="mainline-repeat-card__head">
                        <span className="theme-card__name">{board.name}</span>
                        <span className={`theme-card__tier ${TIER_TONE[board.score?.tier ?? 'one_day']}`}>
                          {board.score ? TIER_LABEL[board.score.tier] : '—'}
                        </span>
                      </span>
                      <span className="theme-card__stats">
                        <span>连榜 {board.maxRankStreak} 天</span>
                        <span>{board.maxRankKey ? RANK_LABEL[board.maxRankKey] : '—'}</span>
                        <span>涨停 {latest?.limitUpCount ?? '—'}</span>
                        <span>最高 {latest?.maxBoard ?? '—'} 板</span>
                      </span>
                      <span className="theme-card__stats">
                        <span>得分 {board.score?.total ?? '—'}</span>
                        <span className={returnTone(board.capitalReturn)}>
                          分歧后：{returnText(board.capitalReturn)}
                        </span>
                        <span>出现 {board.appearDays} 天</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ③ 当日板块总览 */}
            <h3 className="mainline-section-title" id="mainline-section-overview">
              三、当日板块总览（按得分排序）
            </h3>
            <div className="mainline-table-wrap">
              <table className="mainline-table">
                <thead>
                  <tr>
                    <th scope="col">板块</th>
                    <th scope="col">得分</th>
                    <th scope="col">分档</th>
                    <th scope="col">涨停</th>
                    <th scope="col">连板</th>
                    <th scope="col">最高板</th>
                    <th scope="col">涨幅</th>
                    <th scope="col">主力净流入</th>
                    <th scope="col">成交额</th>
                    <th scope="col">四榜名次 涨/停/资/额</th>
                    <th scope="col">连榜</th>
                    <th scope="col">连续</th>
                  </tr>
                </thead>
                <tbody>
                  {selectable.map((board) => {
                    const latest = latestOf(board);
                    return (
                      <tr
                        key={board.code}
                        className={selected?.code === board.code ? 'is-selected' : undefined}
                      >
                        <th scope="row">
                          <button
                            className="mainline-table__pick"
                            type="button"
                            onClick={() => setSelectedCode(board.code)}
                          >
                            {board.name}
                          </button>
                        </th>
                        <td>{board.score?.total ?? '—'}</td>
                        <td>
                          <span className={`theme-card__tier ${TIER_TONE[board.score?.tier ?? 'one_day']}`}>
                            {board.score ? TIER_LABEL[board.score.tier] : '—'}
                          </span>
                        </td>
                        <td>{latest?.limitUpCount ?? '—'}</td>
                        <td>{latest?.continuousCount ?? '—'}</td>
                        <td>{latest?.maxBoard ?? '—'}</td>
                        <td className={(latest?.pct ?? 0) >= 0 ? 'is-up' : 'is-down'}>
                          {pctText(latest?.pct)}
                        </td>
                        <td>{yi(latest?.mainNet)}</td>
                        <td>{yi(latest?.amount)}</td>
                        <td className="mainline-table__ranks">
                          {`${latest?.rank.pct ?? '—'}/${latest?.rank.limitUp ?? '—'}/${latest?.rank.flow ?? '—'}/${latest?.rank.amount ?? '—'}`}
                        </td>
                        <td>{board.maxRankStreak}</td>
                        <td>{latest?.streak ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ④ 重点板块明细 */}
            {selected !== null ? (
              <>
                <h3 className="mainline-section-title" id="mainline-section-detail">
                  四、重点板块明细 —— {selected.name}（{selected.score?.total ?? '—'} 分，
                  {selected.score ? TIER_LABEL[selected.score.tier] : '—'}）
                </h3>

                <div className="mainline-detail-grid">
                  <div className="mainline-detail-block">
                    <p className="eyebrow">五档阵容</p>
                    <ul className="mainline-ladder">
                      <li>
                        <span className="mainline-ladder__slot">高度龙头</span>
                        <span>
                          {selected.ladder.leader
                            ? `${selected.ladder.leader.name}（${selected.ladder.leader.highLabel ?? `${selected.ladder.leader.boardCount}板`}）`
                            : '—'}
                        </span>
                      </li>
                      <li>
                        <span className="mainline-ladder__slot">前排核心</span>
                        <span>
                          {selected.ladder.frontRow.length === 0
                            ? '—'
                            : selected.ladder.frontRow
                                .map((item) => `${item.name}(${item.highLabel ?? `${item.boardCount}板`})`)
                                .join('、')}
                        </span>
                      </li>
                      <li>
                        <span className="mainline-ladder__slot">中军</span>
                        <span>
                          {!selected.ladder.coreAvailable
                            ? '不可判定（成员成交额缺失）'
                            : selected.ladder.core.length === 0
                              ? '无'
                              : selected.ladder.core
                                  .map(
                                    (item) =>
                                      `${item.name}（流通${yi(item.floatMarketCap)}/换手${item.turnoverRate?.toFixed(1) ?? '—'}%）`,
                                  )
                                  .join('、')}
                        </span>
                      </li>
                      <li>
                        <span className="mainline-ladder__slot">首板助攻</span>
                        <span>
                          {selected.ladder.firstBoard.length === 0
                            ? '—'
                            : selected.ladder.firstBoard.map((item) => item.name).join('、')}
                        </span>
                      </li>
                      <li>
                        <span className="mainline-ladder__slot">完整梯队</span>
                        <span>
                          {selected.ladder.full ? '是' : '否'}
                          <span className="status-note">（模板：3板以上龙头 + 前排至少 2 + 首板至少 3 + 中军）</span>
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="mainline-detail-block">
                    <p className="eyebrow">从板块里找题材（涨停原因归一后 2 家以上成题）</p>
                    {selected.themes.length === 0 ? (
                      <p className="status-note">
                        没有 2 家以上的题材 —— 这个板块的涨停股各炒各的，属宽概念。
                      </p>
                    ) : (
                      <ul className="mainline-theme-list">
                        {selected.themes.map((theme) => (
                          <li key={theme.key}>
                            <span className="mainline-theme-list__key">{theme.key}</span>
                            <span className="mainline-theme-list__meta">
                              {theme.count} 家 · 最高 {theme.maxBoard} 板 · 连续 {theme.streak} 天 · 蔓延{' '}
                              {theme.boardSpread} 个板块
                            </span>
                            <span className="mainline-theme-list__members">
                              {theme.members.join('、')}
                              {theme.variants.length > 1 ? (
                                <span className="status-note">（归一自：{theme.variants.join(' / ')}）</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="mainline-detail-block">
                  <p className="eyebrow">逐日轨迹</p>
                  <div className="mainline-table-wrap">
                    <table className="mainline-table mainline-table--compact">
                      <thead>
                        <tr>
                          <th scope="col">日期</th>
                          <th scope="col">涨幅</th>
                          <th scope="col">涨停</th>
                          <th scope="col">最高板</th>
                          <th scope="col">类型</th>
                          <th scope="col">连续</th>
                          <th scope="col">连榜</th>
                          <th scope="col">上榜</th>
                          <th scope="col">分歧后</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.days.map((day) => (
                          <tr key={day.date}>
                            <th scope="row">{day.date}</th>
                            <td className={(day.pct ?? 0) >= 0 ? 'is-up' : 'is-down'}>
                              {pctText(day.pct)}
                            </td>
                            <td>{day.limitUpCount}</td>
                            <td>{day.maxBoard}</td>
                            <td>{DAY_KIND_LABEL[day.dayKind]}</td>
                            <td>{day.streak}</td>
                            <td>{day.streakHit}</td>
                            <td>{day.hit}/4</td>
                            <td className={returnTone(day.capitalReturn)}>
                              {returnText(day.capitalReturn)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mainline-detail-block">
                  <p className="eyebrow">评分明细</p>
                  <div className="mainline-table-wrap">
                    <table className="mainline-table mainline-table--compact">
                      <thead>
                        <tr>
                          <th scope="col">条件</th>
                          <th scope="col">命中</th>
                          <th scope="col">分</th>
                          <th scope="col">依据</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected.score?.conditions ?? []).map((condition) => (
                          <tr key={condition.key}>
                            <th scope="row">{condition.label}</th>
                            <td>{condition.hit ? '✔' : '✘'}</td>
                            <td>{condition.score}</td>
                            <td className="mainline-table__evidence">{condition.evidence ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="status-note">
                    分数不是买卖信号，用于防止被当天涨幅迷惑。
                    {selected.score?.degraded ? '（本次部分字段不可用，按缺失处理）' : ''}
                    {selected.score?.ebb ? ' 已判退潮。' : ''}
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
});
