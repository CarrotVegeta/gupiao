import { formatCurrency, formatPercent } from '../lib/quotes';
import type { Holding, QuoteMap } from '../types';

type WatchlistProps = {
  holdings: Holding[];
  quotes: QuoteMap;
  onEdit: (holding: Holding) => void;
  onDelete: (holding: Holding) => void;
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
  `${value >= 0 ? '+' : '−'}${formatCurrency(Math.abs(value))}`;

const formatSignedPercent = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${formatPercent(Math.abs(value))}`;

export const Watchlist = ({
  holdings,
  quotes,
  onEdit,
  onDelete,
}: WatchlistProps) => {
  if (holdings.length === 0) {
    return (
      <section className="card holding-list holding-list--empty">
        <p>当前范围暂无自选股票</p>
      </section>
    );
  }

  return (
    <section className="holding-list" aria-label="自选列表">
      {holdings.map((holding) => {
        const quote = quotes[holding.symbol];
        const hasLiveQuote =
          quote !== undefined && quote.status !== 'unavailable' && quote.price !== null;
        const displayName = quote?.name?.trim() || holding.name || holding.symbol;

        return (
          <article key={holding.id} className="quote-row">
            <div className="quote-row__identity">
              <h3 className="quote-table__name">{displayName}</h3>
              <p className="holding-card__symbol">{holding.symbol}</p>
              {holding.note ? (
                <p className="holding-card__note">
                  <span className="holding-card__note-label">备注：</span>
                  {holding.note}
                </p>
              ) : null}
            </div>

            <dl className="quote-row__quotes">
              <div>
                <dt>最新价</dt>
                <dd className={hasLiveQuote ? getValueToneClass(quote?.change) : 'value--neutral'}>
                  {hasLiveQuote ? formatCurrency(quote.price as number) : '暂无行情'}
                </dd>
              </div>
              <div>
                <dt>涨跌额</dt>
                <dd className={getValueToneClass(quote?.change)}>
                  {quote?.change === null || quote?.change === undefined
                    ? '—'
                    : formatSignedCurrency(quote.change)}
                </dd>
              </div>
              <div>
                <dt>换手</dt>
                <dd>
                  {quote?.turnover === null || quote?.turnover === undefined
                    ? '—'
                    : formatPercent(quote.turnover)}
                </dd>
              </div>
            </dl>

            <div className={`quote-row__chg ${getValueToneClass(quote?.pct)}`}>
              <span>涨跌幅</span>
              <strong className={getValueToneClass(quote?.pct)}>
                {quote?.pct === null || quote?.pct === undefined
                  ? '—'
                  : formatSignedPercent(quote.pct)}
              </strong>
            </div>

            <div className="holding-card__actions">
              <button
                className="icon-button"
                type="button"
                aria-label={`编辑 ${displayName}`}
                onClick={() => onEdit(holding)}
              >
                编辑
              </button>
              <button
                className="icon-button icon-button--danger"
                type="button"
                aria-label={`删除 ${displayName}`}
                onClick={() => onDelete(holding)}
              >
                删除
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
};
