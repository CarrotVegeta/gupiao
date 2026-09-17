import { calculateHoldingPerformance } from '../lib/calculations';
import { formatLimitUpTag, type LimitUpInfoMap } from '../lib/limitUpInfo';
import { formatCurrency, formatPercent, formatPrice } from '../lib/quotes';
import { StockIdentity } from './StockIdentity';
import type { Holding, QuoteMap } from '../types';

type HoldingListProps = {
  holdings: Holding[];
  quotes: QuoteMap;
  onEdit: (holding: Holding) => void;
  /** 涨停池换算出的连板标识；缺省表示没有涨停数据（不显示连板标签） */
  limitUpInfo?: LimitUpInfoMap;
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
  limitUpInfo = {},
}: HoldingListProps) => {
  if (holdings.length === 0) {
    return (
      <section className="card holding-list holding-list--empty">
        <p>当前范围暂无持仓</p>
      </section>
    );
  }

  return (
    <section className="holding-list" aria-label="持仓列表">
      <div className="quote-table-wrap">
        <table className="quote-table quote-table--holdings">
          <thead>
            <tr>
              <th scope="col">股票</th>
              <th scope="col">最新价</th>
              <th scope="col">涨跌额</th>
              <th scope="col">涨跌幅</th>
              <th scope="col">换手</th>
              <th scope="col">开仓价</th>
              <th scope="col">持有数量</th>
              <th scope="col">持仓收益</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const quote = quotes[holding.symbol];
              const performance = calculateHoldingPerformance(holding, quote);
              const hasLiveQuote =
                quote !== undefined && quote.status !== 'unavailable' && quote.price !== null;
              const displayName = quote?.name?.trim() || holding.name || holding.symbol;
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
                  <td className={hasLiveQuote ? getValueToneClass(quote?.change) : 'value--neutral'}>
                    {hasLiveQuote ? formatPrice(quote.price as number) : '暂无行情'}
                  </td>
                  <td className={`watch-delta ${getValueToneClass(quote?.change)}`}>
                    {quote?.change === null || quote?.change === undefined
                      ? '—'
                      : formatSignedCurrency(quote.change)}
                  </td>
                  <td>
                    <div className={`quote-row__chg ${getValueToneClass(quote?.pct)}`}>
                      <span>涨跌幅</span>
                      <strong className={getValueToneClass(quote?.pct)}>
                        {quote?.pct === null || quote?.pct === undefined
                          ? '—'
                          : formatSignedPercent(quote.pct)}
                      </strong>
                    </div>
                  </td>
                  <td>
                    {quote?.turnover === null || quote?.turnover === undefined
                      ? '—'
                      : formatPercent(quote.turnover)}
                  </td>
                  <td>{holding.openPrice === null ? '未填写' : formatCurrency(holding.openPrice)}</td>
                  <td>{holding.quantity === null ? '未填写' : holding.quantity}</td>
                  <td>
                    <p
                      className={`holding-card__profit ${getValueToneClass(
                        performance.hasQuote ? performance.profit : null,
                      )}`}
                    >
                      {profitLabel}
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
