import { useState } from 'react';
import { StockIdentity } from './StockIdentity';
import { AUCTION_POLICY, auctionResultLabels, auctionResultOrder } from '../lib/auction-policy';
import type {
  AuctionItem,
  AuctionPremium,
  AuctionResponse,
  AuctionResult,
  QuoteMap,
} from '../types';

type AuctionListProps = {
  data: AuctionResponse;
  /**
   * 竞价候选的实时行情。09:25 快照里没有现价，
   * 「涨跌幅」这一列只能来自盘中行情（App 每 10 秒刷一轮）。
   */
  quotes: QuoteMap;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const resultLabels = auctionResultLabels;

const premiumLabels: Record<AuctionPremium, string> = {
  discount: '低吸',
  mild: '温和',
  rich: '溢价偏高',
  chase: '追高',
};

type ResultFilter = AuctionResult | 'all';

const formatTradeDate = (value: string | null): string =>
  value && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '暂无数据';

const formatPercent = (value: number | null): string =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatRatio = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(2)}%`;

const formatAmount = (value: number | null): string => {
  if (value === null) {
    return '—';
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  return `${(value / 10_000).toFixed(2)}万`;
};

const SPARK_WIDTH = 88;
const SPARK_HEIGHT = 20;

/**
 * 竞价时段（09:15~09:24）的虚拟匹配价迷你走势。
 *
 * 只画形状、不带坐标轴：这一列的作用是让「竞价是怎么走到最终这个价的」一眼可见，
 * 例如「一路推高、尾段被砸下来」和「低开慢慢抬上来」在数字上都是 +2%，
 * 但形状完全不同。**它不参与合格判定。**
 */
const AuctionMinuteSparkline = ({ path }: { path: number[] }) => {
  if (path.length < 2) {
    return null;
  }

  const min = Math.min(...path);
  const max = Math.max(...path);
  // 全部同价时画一条水平线，避免除零
  const span = max - min || 1;
  const stepX = SPARK_WIDTH / (path.length - 1);
  const points = path
    .map((value, index) => {
      const x = index * stepX;
      const y = SPARK_HEIGHT - ((value - min) / span) * SPARK_HEIGHT;
      // 上下各留 1px，线条不会贴着边框
      return `${x.toFixed(1)},${(Math.min(SPARK_HEIGHT - 1, Math.max(1, y))).toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="auction-sparkline"
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={points} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

/** 与服务端共用排序：合格优先 → 连板降序 → 竞价量比降序 → 代码。 */
const resultRank = (result: AuctionResult): number =>
  result === 'qualified' ? 0 : result === 'unqualified' ? 1 : 2;

const compareItems = (left: AuctionItem, right: AuctionItem): number => {
  const resultDiff = resultRank(left.result) - resultRank(right.result);
  if (resultDiff !== 0) {
    return resultDiff;
  }
  const boardDiff = (right.boardCount ?? -1) - (left.boardCount ?? -1);
  if (boardDiff !== 0) {
    return boardDiff;
  }
  const ratioDiff = (right.auctionRatio ?? -1) - (left.auctionRatio ?? -1);
  return ratioDiff !== 0 ? ratioDiff : left.symbol.localeCompare(right.symbol);
};

/** 现价涨跌幅：行情没拿到就不上色，避免「—」被染成红/绿 */
const quotePctClass = (value: number | null): string =>
  value === null || value === 0 ? 'value--neutral' : value > 0 ? 'value--rise' : 'value--fall';

/** 与服务端共用两个阈值：高开幅度区间 + 竞价量比门槛。 */
const gapPasses = (value: number | null): boolean =>
  value !== null && value >= AUCTION_POLICY.gapMinPct && value <= AUCTION_POLICY.gapMaxPct;

const ratioPasses = (value: number | null): boolean =>
  value !== null && value >= AUCTION_POLICY.ratioMinPct;

export const AuctionList = ({ data, quotes, isRefreshing, onRefresh }: AuctionListProps) => {
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [buyableOnly, setBuyableOnly] = useState(false);
  const items = [...data.items].sort(compareItems);
  const counts = items.reduce<Record<AuctionResult, number>>(
    (result, item) => ({ ...result, [item.result]: result[item.result] + 1 }),
    { qualified: 0, unqualified: 0, insufficient: 0 },
  );
  const buyableCount = items.filter((item) => item.sealedAtAuction === false).length;
  const filterLabel =
    [filter === 'all' ? null : `「${resultLabels[filter]}」`, buyableOnly ? '竞价未涨停' : null]
      .filter((label): label is string => label !== null)
      .join(' + ') || '全部';
  const visibleItems = items
    .filter((item) => (filter === 'all' ? true : item.result === filter))
    .filter((item) => (buyableOnly ? item.sealedAtAuction === false : true));

  return (
    <section className="card auction-list" aria-labelledby="auction-list-title">
      <div className="overview__header auction-list__header">
        <div>
          <p className="eyebrow">昨日涨停 · 今日竞价</p>
          <h2 id="auction-list-title">竞价连板候选</h2>
          <p className="auction-list__description">
            <span>固定快照：09:25</span>
            <span>
              合格只看两条：竞价高开 {AUCTION_POLICY.gapMinPct}%~{AUCTION_POLICY.gapMaxPct}%
              ，且竞价量比 ≥{AUCTION_POLICY.ratioMinPct}%（量比＝竞价成交额 ÷ 昨日全天成交额）
            </span>
            <span>两条都满足才合格，其余一律不合格；不再输出封板概率</span>
            <span>量比 ≥{AUCTION_POLICY.ratioHeavyPct}% 额外标「爆量」</span>
            <span>阈值是经验规则，尚未在本地历史样本上验证；溢价仅表示价格位置</span>
            <span>竞价未涨停仅表示开盘价低于涨停价，不保证成交或收益</span>
            <span>涨跌幅＝现价相对昨收（盘中实时）</span>
            {/* 09:15 前集合竞价还没开始，服务端会把整卡退回上一个完整竞价日 */}
            <span>9:15 前显示上一交易日竞价</span>
          </p>
        </div>
        <div className="auction-list__toolbar">
          <p className="overview__meta">
            竞价日：{formatTradeDate(data.tradeDate)} · 昨日：{formatTradeDate(data.previousTradeDate)}
          </p>
          <button
            className="button button--secondary"
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? '刷新中…' : '刷新竞价'}
          </button>
        </div>
      </div>

      <div className="auction-list__summary" role="group" aria-label="按竞价结论筛选">
        <button
          type="button"
          className={`auction-status auction-status--all auction-filter${
            filter === 'all' ? ' auction-filter--active' : ''
          }`}
          aria-pressed={filter === 'all'}
          title="显示全部候选"
          onClick={() => setFilter('all')}
        >
          全部 {items.length}
        </button>
        {auctionResultOrder.map((result) => (
          <button
            key={result}
            type="button"
            className={`auction-status auction-status--${result} auction-filter${
              filter === result ? ' auction-filter--active' : ''
            }`}
            aria-pressed={filter === result}
            title={filter === result ? '点击取消筛选' : `只看「${resultLabels[result]}」`}
            onClick={() => setFilter((current) => (current === result ? 'all' : result))}
          >
            {resultLabels[result]} {counts[result]}
          </button>
        ))}
        <button
          type="button"
          className={`auction-status auction-status--buyable auction-filter${
            buyableOnly ? ' auction-filter--active' : ''
          }`}
          aria-pressed={buyableOnly}
          title="只显示竞价价低于实际涨停价的候选，不保证实际成交"
          onClick={() => setBuyableOnly((current) => !current)}
        >
          竞价未涨停 {buyableCount}
        </button>
        {filter === 'all' && !buyableOnly ? null : (
          <span className="auction-list__filter-hint" role="status">
            已筛选 {filterLabel}，共 {visibleItems.length} 只
            <button
              type="button"
              className="auction-list__filter-reset"
              onClick={() => {
                setFilter('all');
                setBuyableOnly(false);
              }}
            >
              清除
            </button>
          </span>
        )}
      </div>

      <p className="status-note">
        合格＝竞价高开落在 {AUCTION_POLICY.gapMinPct}%~{AUCTION_POLICY.gapMaxPct}% 且竞价量比 ≥{AUCTION_POLICY.ratioMinPct}%，
        不是买入信号；竞价成交额或昨日成交额缺失时无法判定。
      </p>

      {data.status === 'stale' ? (
        <p className="banner banner--warning" role="status">
          当前显示上一轮竞价快照
        </p>
      ) : null}

      {data.status === 'unavailable' ? (
        <>
          <p className="banner banner--warning" role="status">
            竞价数据暂不可用
          </p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </>
      ) : null}

      {items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>暂无竞价候选</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>当前筛选条件下没有候选</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setFilter('all');
              setBuyableOnly(false);
            }}
          >
            显示全部 {items.length} 只
          </button>
        </div>
      ) : (
        <div className="auction-list__table-wrap" tabIndex={0} aria-label="竞价候选表格滚动区域">
          <table
            aria-label={
              filter === 'all'
                ? '竞价连板候选列表'
                : `竞价连板候选列表（已筛选${resultLabels[filter as AuctionResult]}）`
            }
          >
            <thead>
              <tr>
                <th scope="col">股票</th>
                <th scope="col">昨日连板</th>
                <th scope="col" title={`合格条件一：竞价高开落在 ${AUCTION_POLICY.gapMinPct}%~${AUCTION_POLICY.gapMaxPct}%`}>
                  竞价高开
                </th>
                <th scope="col" title={`合格条件二：竞价量比 ≥${AUCTION_POLICY.ratioMinPct}%`}>
                  竞价量比
                </th>
                <th
                  scope="col"
                  title="09:15~09:24 集合竞价的虚拟匹配价轨迹与匹配量峰值。只描述过程形态，不参与合格判定（样本还不足以验证阈值）"
                >
                  竞价分时
                </th>
                <th scope="col">竞价结论</th>
                <th scope="col">溢价</th>
                <th scope="col" title="现价相对昨收的涨跌幅，盘中实时刷新（09:25 快照里没有现价）">
                  涨跌幅
                </th>
                <th scope="col">竞价金额</th>
                <th scope="col">昨日封板</th>
                <th scope="col">研判依据</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const currentQuote = quotes[item.symbol];
                const currentPct = currentQuote?.pct ?? null;
                const gapOk = gapPasses(item.auctionPct);
                const ratioOk = ratioPasses(item.auctionRatio);
                const heavy = item.auctionRatio !== null && item.auctionRatio >= AUCTION_POLICY.ratioHeavyPct;

                return (
                  <tr key={item.symbol}>
                    <th scope="row">
                      <StockIdentity
                        name={item.name}
                        code={item.symbol}
                        tag={item.boardCount === null ? null : `${item.boardCount} 连板`}
                      />
                    </th>
                    <td>{item.boardCount === null ? '—' : `${item.boardCount} 连板`}</td>
                    <td className={item.auctionPct === null ? undefined : gapOk ? 'auction-check--pass' : 'auction-check--fail'}>
                      <span className="auction-check__mark" aria-hidden="true">{item.auctionPct === null ? '—' : gapOk ? '✓' : '✗'}</span>
                      <span className={item.auctionPct !== null && item.auctionPct >= 0 ? 'value--rise' : 'value--fall'}>
                        {formatPercent(item.auctionPct)}
                      </span>
                    </td>
                    <td className={item.auctionRatio === null ? undefined : ratioOk ? 'auction-check--pass' : 'auction-check--fail'}>
                      <span className="auction-check__mark" aria-hidden="true">{item.auctionRatio === null ? '—' : ratioOk ? '✓' : '✗'}</span>
                      <span>{formatRatio(item.auctionRatio)}</span>
                      {heavy ? <span className="auction-list__subvalue">爆量</span> : null}
                      {item.auctionRatio === null ? (
                        <span className="auction-list__subvalue">量能缺失</span>
                      ) : null}
                    </td>
                    <td
                      className="auction-list__minute"
                      title={
                        item.minuteTrend === null
                          ? '未取到竞价分时（停牌或上游未返回）'
                          : `峰值匹配量 ${item.minuteTrend.maxMatchedVolume}（${item.minuteTrend.peakMatchedTime ?? '—'}）${
                              item.minuteTrend.matchedSharePct === null
                                ? ''
                                : `，为竞价成交量的 ${item.minuteTrend.matchedSharePct.toFixed(0)}%`
                            }`
                      }
                    >
                      {item.minuteTrend === null ? (
                        <span className="auction-list__subvalue">—</span>
                      ) : (
                        <>
                          <AuctionMinuteSparkline path={item.minuteTrend.pricePath} />
                          <span className="auction-list__minute-text">{item.minuteTrend.label}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`auction-status auction-status--${item.result}`}>
                        {resultLabels[item.result]}
                      </span>
                    </td>
                    <td>
                      {item.auctionPremium === null ? (
                        '—'
                      ) : (
                        <span className={`auction-premium auction-premium--${item.auctionPremium}`}>
                          {premiumLabels[item.auctionPremium]}
                        </span>
                      )}
                    </td>
                    <td
                      className={quotePctClass(currentPct)}
                      title={
                        currentQuote?.status === 'stale'
                          ? '行情已过期，显示上一轮'
                          : currentPct === null
                            ? '暂无行情'
                            : undefined
                      }
                    >
                      {formatPercent(currentPct)}
                    </td>
                    <td>
                      {formatAmount(item.auctionAmount)}
                      {item.auctionAmount === null ? (
                        <span className="auction-list__subvalue">量能缺失</span>
                      ) : null}
                    </td>
                    <td>
                      {item.firstSealTime ?? '—'}
                      <span className="auction-list__subvalue">
                        炸板 {item.breakCount === null ? '—' : item.breakCount} 次
                      </span>
                    </td>
                    <td className="auction-list__reasons" title={item.reasons.join('\n')}>
                      <span className="auction-list__reasons-text">{item.reasons.join('；')}</span>
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
