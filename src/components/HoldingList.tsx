import { useCallback } from 'react';
import { calculateHoldingPerformance } from '../lib/calculations';
import { formatLimitUpTag, type LimitUpInfoMap } from '../lib/limitUpInfo';
import { formatCurrency, formatPercent, formatPrice } from '../lib/quotes';
import { useSortedRows, type SortValue } from '../lib/tableSort';
import { tierClassNames, tierOfChange, turnoverLevel, wordClassNames } from '../lib/valueTier';
import { MinuteChart } from './MinuteChart';
import { StockIdentity } from './StockIdentity';
import { SortableHeader } from './SortableHeader';
import type { Holding, MinuteSeriesMap, QuoteMap } from '../types';

type HoldingSortKey =
  | 'stock'
  | 'price'
  | 'change'
  | 'pct'
  | 'turnover'
  | 'openPrice'
  | 'quantity'
  | 'profit';

type HoldingListProps = {
  holdings: Holding[];
  quotes: QuoteMap;
  onEdit: (holding: Holding) => void;
  /** 当日分时序列，按代码索引；缺省表示还没取到（该列显示「—」） */
  minuteSeries?: MinuteSeriesMap;
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

const holdingSortValues: Record<
  HoldingSortKey,
  (holding: Holding, quotes: QuoteMap) => SortValue
> = {
  stock: (holding) => holding.symbol,
  price: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.price),
  change: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.change),
  pct: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.pct),
  turnover: (holding, quotes) => quoteNumber(quotes, holding, (quote) => quote.turnover),
  openPrice: (holding) => holding.openPrice,
  quantity: (holding) => holding.quantity,
  // 没补录开仓价/数量或没有行情时 profit 是 null，排在最后
  profit: (holding, quotes) =>
    calculateHoldingPerformance(holding, quotes[holding.symbol]).profit,
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

const formatSignedCurrency = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${formatPrice(Math.abs(value))}`;

const formatSignedPercent = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${formatPercent(Math.abs(value))}`;

export const HoldingList = ({
  holdings,
  quotes,
  onEdit,
  minuteSeries = {},
  limitUpInfo = {},
}: HoldingListProps) => {
  const { rows, sort, toggle } = useSortedRows<Holding, HoldingSortKey>({
    rows: holdings,
    getValueFor: useCallback(
      (key: HoldingSortKey) => (holding: Holding) => holdingSortValues[key](holding, quotes),
      [quotes],
    ),
  });

  if (holdings.length === 0) {
    return (
      <section className="card holding-list holding-list--empty">
        <p>当前范围暂无持仓</p>
      </section>
    );
  }

  const header = (key: HoldingSortKey, label: string) => (
    <SortableHeader
      label={label}
      active={sort?.key === key}
      direction={sort?.direction ?? 'default'}
      onToggle={() => toggle(key)}
    />
  );

  return (
    <section className="holding-list" aria-label="持仓列表">
      <div className="quote-table-wrap">
        <table className="quote-table quote-table--holdings">
          <thead>
            <tr>
              {header('stock', '股票')}
              <th scope="col" title="当日分时（09:30~15:00，价格线 + 昨收基准虚线，按末点相对昨收染色）">
                分时图
              </th>
              {header('price', '最新价')}
              {header('change', '涨跌额')}
              {header('pct', '涨跌幅')}
              {header('turnover', '换手')}
              {header('openPrice', '开仓价')}
              {header('quantity', '持有数量')}
              {header('profit', '持仓收益')}
            </tr>
          </thead>
          <tbody>
            {rows.map((holding) => {
              const quote = quotes[holding.symbol];
              const minute = minuteSeries[holding.symbol];
              const performance = calculateHoldingPerformance(holding, quote);
              const hasLiveQuote =
                quote !== undefined && quote.status !== 'unavailable' && quote.price !== null;
              const displayName = quote?.name?.trim() || holding.name || holding.symbol;
              /* 涨跌幅与持仓收益按档变色，换手带档位词（量比不是持仓页的字段，不显示） */
              const pctTier = tierOfChange(quote?.pct);
              const profitTier = performance.hasQuote ? tierOfChange(performance.returnPct) : null;
              const turnover = turnoverLevel(quote?.turnover ?? null);
              const profitLabel =
                holding.openPrice === null || holding.quantity === null
                  ? '观察项：补录开仓价和持有数量后计算收益'
                  : performance.hasQuote
                    ? `${formatSignedCurrency(performance.profit as number)}（${formatSignedPercent(
                        performance.returnPct as number,
                      )}）`
                    : '—';

              return (
                <tr key={holding.id} className="quote-table__row">
                  {/* 只有「股票」列可点：点名称/代码打开编辑弹窗，数字列是纯展示 */}
                  <th scope="row" className="quote-table__stock-cell">
                    <button
                      type="button"
                      className="quote-table__stock quote-table__stock--stacked"
                      aria-label={`编辑 ${displayName}`}
                      onClick={() => onEdit(holding)}
                    >
                      {/* 和自选页同款：首字头像 + 名称，备注/涨停收成名称右边的红色标签 */}
                      <StockIdentity
                        name={displayName}
                        code={holding.symbol}
                        tag={holding.note}
                        limitUpTag={formatLimitUpTag(limitUpInfo[holding.symbol])}
                      />
                    </button>
                  </th>
                  <td className="quote-table__minute-cell">
                    {minute ? (
                      <MinuteChart points={minute.points} preClose={minute.preClose ?? quote?.preClose ?? null} />
                    ) : (
                      <span className="minute-chart minute-chart--empty">—</span>
                    )}
                  </td>
                  <td className={hasLiveQuote ? getValueToneClass(quote?.change) : 'value--neutral'}>
                    {hasLiveQuote ? formatPrice(quote.price as number) : '暂无行情'}
                  </td>
                  <td className={`watch-delta ${getValueToneClass(quote?.change)}`}>
                    {quote?.change === null || quote?.change === undefined
                      ? '—'
                      : formatSignedCurrency(quote.change)}
                  </td>
                  <td>
                    <div
                      className={`quote-row__chg ${getValueToneClass(quote?.pct)}${pctTier === null ? '' : ` ${tierClassNames(pctTier)}`}`}
                    >
                      <span>涨跌幅</span>
                      <strong className={getValueToneClass(quote?.pct)}>
                        {quote?.pct === null || quote?.pct === undefined
                          ? '—'
                          : formatSignedPercent(quote.pct)}
                      </strong>
                    </div>
                  </td>
                  {/* 换手：数值下面挂一个档位词（绝对定位，不加宽列也不撑高行） */}
                  <td className={turnover === null ? undefined : 'value-word-host'}>
                    {quote?.turnover === null || quote?.turnover === undefined
                      ? '—'
                      : formatPercent(quote.turnover)}
                    {turnover === null ? null : (
                      <span className={wordClassNames(turnover)}>{turnover.word}</span>
                    )}
                  </td>
                  <td>{holding.openPrice === null ? '未填写' : formatCurrency(holding.openPrice)}</td>
                  <td>{holding.quantity === null ? '未填写' : holding.quantity}</td>
                  <td>
                    <p
                      className={`holding-card__profit ${getValueToneClass(
                        performance.hasQuote ? performance.profit : null,
                      )}`}
                    >
                      {/* 档位底色只包住数字，不整格铺满 */}
                      {profitTier === null ? (
                        profitLabel
                      ) : (
                        <span className={tierClassNames(profitTier, { pad: true })}>{profitLabel}</span>
                      )}
                    </p>
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
