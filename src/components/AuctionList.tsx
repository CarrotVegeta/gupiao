import { useState } from 'react';
import { StockIdentity } from './StockIdentity';
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

const resultLabels: Record<AuctionResult, string> = {
  qualified: '合格',
  watch: '观察',
  unqualified: '不合格',
  insufficient: '数据不足',
};

const premiumLabels: Record<AuctionPremium, string> = {
  discount: '低吸',
  mild: '温和',
  rich: '溢价偏高',
  chase: '追高',
};

const resultOrder: AuctionResult[] = ['qualified', 'watch', 'unqualified', 'insufficient'];

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

const compareItems = (left: AuctionItem, right: AuctionItem): number => {
  const boardDiff = (right.boardCount ?? -1) - (left.boardCount ?? -1);
  if (boardDiff !== 0) {
    return boardDiff;
  }
  const probabilityDiff = (right.limitUpProbability ?? -1) - (left.limitUpProbability ?? -1);
  return probabilityDiff !== 0 ? probabilityDiff : left.symbol.localeCompare(right.symbol);
};

const formatProbability = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(0)}%`;

/** 现价涨跌幅：行情没拿到就不上色，避免「—」被染成红/绿 */
const quotePctClass = (value: number | null): string =>
  value === null || value === 0 ? 'value--neutral' : value > 0 ? 'value--rise' : 'value--fall';

/** 概率分档的配色：≥55% 合格、30~55% 观察、其余不合格 */
const probabilityClass = (value: number | null): string =>
  value === null
    ? 'auction-probability--unknown'
    : value >= 0.55
      ? 'auction-probability--high'
      : value >= 0.3
        ? 'auction-probability--mid'
        : 'auction-probability--low';

export const AuctionList = ({ data, quotes, isRefreshing, onRefresh }: AuctionListProps) => {
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [buyableOnly, setBuyableOnly] = useState(false);
  const items = [...data.items].sort(compareItems);
  const counts = items.reduce<Record<AuctionResult, number>>(
    (result, item) => ({ ...result, [item.result]: result[item.result] + 1 }),
    { qualified: 0, watch: 0, unqualified: 0, insufficient: 0 },
  );
  const buyableCount = items.filter((item) => item.sealedAtAuction === false).length;
  const filterLabel =
    [filter === 'all' ? null : `「${resultLabels[filter]}」`, buyableOnly ? '只看可买' : null]
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
            <span>概率＝今日收盘继续涨停的概率，溢价＝按竞价价买入的性价比</span>
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
        {resultOrder.map((result) => (
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
          title="只看竞价未封板、按竞价价买得到的票"
          onClick={() => setBuyableOnly((current) => !current)}
        >
          只看可买 {buyableCount}
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
        概率 ≥55% 的一档平均 2.5 只/天。回测见 README「为什么竞价买入没有优势」：
        涨停股次日普遍高开，按竞价价买入拿不到这个溢价。
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
                <th scope="col">涨停概率</th>
                <th scope="col">竞价结论</th>
                <th scope="col">溢价</th>
                <th scope="col">竞价涨幅</th>
                <th scope="col" title="现价相对昨收的涨跌幅，盘中实时刷新（09:25 快照里没有现价）">
                  涨跌幅
                </th>
                <th scope="col">竞价金额</th>
                <th scope="col">竞价/昨成交</th>
                <th scope="col">昨日封板</th>
                <th scope="col">研判依据</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const currentQuote = quotes[item.symbol];
                const currentPct = currentQuote?.pct ?? null;

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
                    <td>
                      <span className={`auction-probability ${probabilityClass(item.limitUpProbability)}`}>
                        {formatProbability(item.limitUpProbability)}
                      </span>
                      {item.probabilityMissing > 0 ? (
                        <span className="auction-list__subvalue">
                          {item.probabilityMissing} 项特征缺失
                        </span>
                      ) : null}
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
                    <td className={item.auctionPct !== null && item.auctionPct >= 0 ? 'value--rise' : 'value--fall'}>
                      {formatPercent(item.auctionPct)}
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
                    <td>{formatRatio(item.auctionRatio)}</td>
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
