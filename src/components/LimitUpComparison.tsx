import type { CSSProperties } from 'react';
import type {
  LimitUpComparisonItem,
  LimitUpComparisonStock,
  LimitUpLadderResponse,
  Quote,
} from '../types';
import {
  formatBoardLevel,
  formatPercent,
  formatSignedPercent,
  formatTradeDate,
  valueClass,
} from '../lib/limitUpFormat';
import { StockIdentity } from './StockIdentity';

type LimitUpComparisonProps = {
  data: LimitUpLadderResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
  /**
   * 昨日涨停股今天的行情。
   *
   * 断板那批**不在今天的涨停池里**，池子给不出它今天的涨幅（池子里的 pct 是它昨天涨停当天那根），
   * 所以这一列只能走行情接口；拿不到就显示「—」，绝不拿昨天的涨幅冒充今天的。
   */
  quotes: Record<string, Quote>;
};

/** 今天（上海时区）的 YYYYMMDD，用来判断拿到的池子是不是「今天」的 */
const todayTradeDate = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');

const bucketKey = (bucket: LimitUpComparisonItem): string =>
  bucket.boardCount === null ? 'unknown' : String(bucket.boardCount);

/** 昨日 N 板今天继续涨停就是 N+1 板：表头按晋级后的板位写，读数才和池子的连板数口径一致 */
const nextBoardLevel = (boardCount: number | null): number | null =>
  boardCount === null ? null : boardCount + 1;

/** 涨幅降序，拿不到涨幅的排最后 */
const comparePercentDesc = (left: number | null, right: number | null): number => {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
};

/**
 * 今/昨对比：一档 = 昨日同一个板位，一档两栏逐行对齐。
 *
 * 左栏是这一档**全部**涨停股（今天晋级的排在前面），右栏是其中今天晋级到下一板位的那些，
 * 同一行就是「同一只票」；两栏的涨幅都是**今天**的实时涨跌幅
 * （断板那批不在今日池子里，走行情接口，拿不到就显示「—」）。
 */
const LimitUpComparison = ({ data, isRefreshing, onRefresh, quotes }: LimitUpComparisonProps) => {
  const pctFor = (stock: LimitUpComparisonStock, carried: boolean): number | null =>
    quotes[stock.symbol]?.pct ?? (carried ? stock.pct : null);

  // 今天还没有池子（盘前 / 非交易日）时后端会把交易日落到最近那个有数据的日子，这里如实说明
  const todayHasNoPool = data.tradeDate !== null && data.tradeDate < todayTradeDate();

  return (
    <section className="card limit-up-comparison" aria-labelledby="limit-up-comparison-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">东方财富涨停池</p>
          <h2 id="limit-up-comparison-title">今/昨对比</h2>
        </div>
        <div className="overview__actions limit-up-list__actions">
          <p className="overview__meta">
            {data.tradeDate === null ? (
              '交易日：暂无数据'
            ) : (
              <>
                交易日：<time dateTime={data.tradeDate}>{formatTradeDate(data.tradeDate)}</time>
              </>
            )}
          </p>
          <p className="overview__meta">
            昨日：
            <span>
              {data.previousTradeDate === null ? '—' : formatTradeDate(data.previousTradeDate)}
            </span>
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? '刷新中…' : '刷新今/昨对比'}
          </button>
        </div>
      </div>

      {todayHasNoPool ? (
        <p className="status-note">
          今天还没有涨停池数据（未开盘或非交易日），下面是最近一个交易日
          {formatTradeDate(data.tradeDate)}的对比。
        </p>
      ) : null}

      {data.status === 'stale' ? (
        <p className="banner banner--warning" role="status">
          数据已过期
        </p>
      ) : null}

      {data.status === 'unavailable' ? (
        <>
          <p className="banner banner--warning" role="status">
            今/昨对比数据暂不可用
          </p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </>
      ) : null}

      {/*
       * 昨日池子缺失时整张对比表都失去意义：这里给的是「昨天那一档今天怎么样了」，
       * 没有昨日板位就只能整表说明原因，而不是拿今日池子硬凑一张对比表。
       */}
      {data.status !== 'unavailable' && !data.previousAvailable ? (
        <div className="empty-state empty-state--subtle">
          <p>上一交易日涨停池暂不可用，无法对比。</p>
          <p className="status-note">稍后重试，或先看「连板天梯」的今日部分。</p>
        </div>
      ) : null}

      {data.status !== 'unavailable' && data.previousAvailable ? (
        <div className="limit-up-comparison__summary">
          <div className="limit-up-comparison__summary-item">
            <span className="limit-up-comparison__summary-label">昨日涨停</span>
            <b className="limit-up-comparison__summary-value">{data.previousCount} 只</b>
          </div>
          <div className="limit-up-comparison__summary-item">
            <span className="limit-up-comparison__summary-label">今日晋级</span>
            <b className="limit-up-comparison__summary-value value--rise">{data.carriedCount} 只</b>
          </div>
          <div className="limit-up-comparison__summary-item">
            <span className="limit-up-comparison__summary-label">晋级率</span>
            <b className="limit-up-comparison__summary-value">
              {formatPercent(data.promotionRate)}
            </b>
          </div>
        </div>
      ) : null}

      {data.status !== 'unavailable' && data.previousAvailable && data.comparison.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>昨日涨停池为空，没有可对比的票。</p>
        </div>
      ) : null}

      {data.comparison.length > 0 ? (
        <div className="limit-up-comparison__body">
          <p className="limit-up-comparison__caption">
            一档就是昨日同一个板位的涨停股，今天继续涨停的那几只标红；涨幅都是今天的实时涨跌幅。
          </p>

          <div className="limit-up-comparison__levels">
            {data.comparison.map((bucket, levelIndex) => {
              const promoted = bucket.carried;
              // 断板那批按今天的涨幅从高到低，强势的排前面
              const rest = bucket.fallen
                .map((stock) => ({ stock, pct: pctFor(stock, false) }))
                .sort(
                  (left, right) =>
                    comparePercentDesc(left.pct, right.pct) ||
                    left.stock.symbol.localeCompare(right.stock.symbol, 'zh-CN'),
                )
                .map((entry) => entry.stock);
              const previousRows = [...promoted, ...rest];
              const bucketRate =
                bucket.total === 0 ? null : (promoted.length / bucket.total) * 100;

              return (
                <section
                  className="limit-up-comparison__level"
                  key={bucketKey(bucket)}
                  style={{ '--i': levelIndex } as CSSProperties}
                  aria-label={`昨日 ${formatBoardLevel(bucket.boardCount)} ${bucket.total} 只`}
                >
                  <header className="limit-up-comparison__level-head">
                    <span className="limit-up-comparison__level-badge">
                      昨日 {formatBoardLevel(bucket.boardCount)}
                    </span>
                    <span className="limit-up-comparison__level-count">{bucket.total} 只</span>
                    <span className="limit-up-comparison__arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="limit-up-comparison__level-next">
                      今日 {formatBoardLevel(nextBoardLevel(bucket.boardCount))}
                      {promoted.length === 0 ? '' : ` ${promoted.length} 只`}
                    </span>
                    <span className="limit-up-comparison__level-rate">
                      晋级 {formatPercent(bucketRate)}
                    </span>
                  </header>

                  {/* 晋级率进度条：进场时从左长出来（reduced-motion 下直接是终态） */}
                  <div className="limit-up-comparison__bar" aria-hidden="true">
                    <i
                      style={
                        { '--rate': `${Math.max(bucketRate ?? 0, 0.8).toFixed(1)}%` } as CSSProperties
                      }
                    />
                  </div>

                  <ul className="limit-up-comparison__list">
                    {previousRows.map((stock, index) => {
                      const carried = index < promoted.length;
                      const pct = pctFor(stock, carried);

                      return (
                        <li
                          className={`limit-up-comparison__row${
                            carried ? ' limit-up-comparison__row--carried' : ''
                          }`}
                          key={stock.symbol}
                        >
                          {/* 和自选/持仓/涨停池/连板天梯一样：首字头像 + 名称 + 代码 */}
                          <StockIdentity name={stock.name} code={stock.symbol} />
                          <span className={`limit-up-comparison__pct ${valueClass(pct)}`}>
                            {formatSignedPercent(pct)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
};

export { LimitUpComparison };