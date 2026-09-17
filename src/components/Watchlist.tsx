import { useCallback } from 'react';
import { StockIdentity } from './StockIdentity';
import { SortableHeader } from './SortableHeader';
import { formatLimitUpTag, type LimitUpInfoMap } from '../lib/limitUpInfo';
import { formatPercent, formatPrice } from '../lib/quotes';
import { useSortedRows, type SortValue } from '../lib/tableSort';
import {
  calculateWatchReturn,
  formatWatchDate,
  formatWatchDateTime,
  formatWatchReturn,
  watchDateSortValue,
} from '../lib/watchlist';
import type { Holding, QuoteMap } from '../types';

type WatchlistSortKey =
  | 'stock'
  | 'price'
  | 'pct'
  | 'change'
  | 'turnover'
  | 'volumeRatio'
  | 'amount'
  | 'watchPrice'
  | 'watchReturn'
  | 'watchDate';

type WatchlistProps = {
  holdings: Holding[];
  quotes: QuoteMap;
  onEdit: (holding: Holding) => void;
  /** 涨停池换算出的连板标识；缺省表示没有涨停数据（不显示连板标签） */
  limitUpInfo?: LimitUpInfoMap;
};

/** 取行情数值；缺行情统一给 null，排序时沉到底部 */
const quoteNumber = (
  quotes: QuoteMap,
  holding: Holding,
  read: (quote: NonNullable<QuoteMap[string]>) => number | null,
): number | null => {
  const quote = quotes[holding.symbol];
  return quote === undefined ? null : read(quote);
};

const watchlistSortValues: Record<
  WatchlistSortKey,
  (holding: Holding, quotes: QuoteMap) => SortValue
> = {
    stock: (holding) => holding.symbol,
    price: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.price),
    pct: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.pct),
    change: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.change),
    turnover: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.turnover),
    volumeRatio: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.volumeRatio),
    amount: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.amount),
    // 自选收益：只有「加入时记下了基准价」且现在有行情的行才有值，其余沉底
    watchReturn: (holding, quotes) => calculateWatchReturn(holding, quotes[holding.symbol]),
    // 自选日是 ISO 串，按字典序比就是时间序
    watchDate: (holding) => watchDateSortValue(holding),
    // 自选价：加入自选当时记下的基准价，缺的行沉底
    watchPrice: (holding) => holding.watchPrice ?? null,
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

const formatSignedPrice = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${formatPrice(Math.abs(value))}`;

const formatSignedPercent = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${formatPercent(Math.abs(value))}`;

/** 成交额：亿元 / 万元，和行情软件口径一致 */
const formatAmount = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}亿`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 10_000)}万`;
  }
  return String(Math.round(value));
};

const formatRatio = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);

export const Watchlist = ({ holdings, quotes, onEdit, limitUpInfo = {} }: WatchlistProps) => {
  const { rows, sort, toggle } = useSortedRows<Holding, WatchlistSortKey>({
    rows: holdings,
    getValueFor: useCallback(
      (key: WatchlistSortKey) => (holding: Holding) => watchlistSortValues[key](holding, quotes),
      [quotes],
    ),
  });

  if (holdings.length === 0) {    return (
      <section className="card holding-list holding-list--empty">
        <p>当前范围暂无自选股票</p>
      </section>
    );
  }

  const header = (key: WatchlistSortKey, label: string) => (
    <SortableHeader
      label={label}
      active={sort?.key === key}
      direction={sort?.direction ?? 'default'}
      onToggle={() => toggle(key)}
    />
  );

  return (
    <section className="holding-list" aria-label="自选列表">
      <div className="quote-table-wrap">
        <table className="quote-table quote-table--watchlist">
          <thead>
            <tr>
              {header('stock', '股票')}
              {header('price', '最新价')}
              {header('pct', '涨跌幅')}
              {header('change', '涨跌额')}
              {header('turnover', '换手')}
              {header('volumeRatio', '量比')}
              {header('amount', '成交额')}
              {header('watchDate', '自选日')}
              {header('watchPrice', '自选价')}
              {header('watchReturn', '自选收益')}
            </tr>
          </thead>
          <tbody>
            {rows.map((holding) => {
              const quote = quotes[holding.symbol];
              const pct = quote?.pct ?? null;
              const isUp = pct !== null && pct > 0;
              /* 显示用行情名（拿不到行情时退回本地名），首字头像仍取本地名 */
              const displayName = quote?.name?.trim() || holding.name || holding.symbol;
              /*
               * 自选收益＝自选以来的涨跌幅，基准是「加入自选时记下的价」。
               * 缺基准价（本功能上线前的旧记录、或加入时没行情）时是 null：
               * 这时候显示「—」，不拿现价顶替（那会算出个假的 0%）。
               */
              const watchReturn = calculateWatchReturn(holding, quote);
              const watchDateSource = holding.watchPriceAt ?? holding.createdAt;

              return (
                <tr key={holding.id} className="quote-table__row">
                  {/* 只有「股票」列可点：点名称/代码打开编辑弹窗，数字列是纯展示 */}
                  <th scope="row" className="quote-table__stock-cell">
                    <button
                      type="button"
                      className="quote-table__stock watch-stock"
                      aria-label={`编辑 ${holding.name}`}
                      onClick={() => onEdit(holding)}
                    >
                      <StockIdentity
                        name={displayName}
                        code={holding.symbol}
                        tag={holding.note}
                        limitUpTag={formatLimitUpTag(limitUpInfo[holding.symbol])}
                        /* 首字头像取本地保存的名称，和编辑弹窗里的名字对得上 */
                        avatarText={holding.name}
                      />
                    </button>
                  </th>
                  <td>{formatPrice(quote?.price ?? null)}</td>
                  <td>
                    {pct === null ? (
                      '—'
                    ) : (
                      <span className={`watch-pct ${isUp ? 'watch-pct--up' : 'watch-pct--down'}`}>
                        {formatSignedPercent(pct)}
                      </span>
                    )}
                  </td>
                  <td className={`watch-delta ${getValueToneClass(quote?.change)}`}>
                    {quote?.change === null || quote?.change === undefined
                      ? '—'
                      : formatSignedPrice(quote.change)}
                  </td>
                  <td>{formatPercent(quote?.turnover ?? null)}</td>
                  <td>{formatRatio(quote?.volumeRatio ?? null)}</td>
                  <td>{formatAmount(quote?.amount ?? null)}</td>
                  {/* 只到日；完整时刻（含秒）挂在悬停提示里，不占列宽 */}
                  <td className="quote-table__watch-date" title={formatWatchDateTime(watchDateSource)}>
                    {formatWatchDate(watchDateSource)}
                  </td>
                  {/* 自选收益的基准价（加入自选那一刻的价），和「自选收益」配成一组看 */}
                  <td className="quote-table__watch-price">
                    {formatPrice(holding.watchPrice ?? null)}
                  </td>
                  <td className="quote-table__watch-return">
                    {watchReturn === null ? (
                      '—'
                    ) : (
                      /* 带色百分比：涨红跌绿，和「涨跌幅」列同一套 value--rise/fall */
                      <span className={`watch-pct ${getValueToneClass(watchReturn)}`}>
                        {formatWatchReturn(watchReturn)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
