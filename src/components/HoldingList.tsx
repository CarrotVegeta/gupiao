import { calculateHoldingPerformance } from '../lib/calculations';
import type { Holding, QuoteMap } from '../types';

type HoldingListProps = {
  holdings: Holding[];
  quotes: QuoteMap;
  onEdit: (holding: Holding) => void;
  onDelete: (holding: Holding) => void;
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatSignedCurrency = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${formatCurrency(Math.abs(value))}`;

const formatSignedPercent = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;

const formatQuoteChange = (value: number | null): string => {
  if (value === null) {
    return '—';
  }

  return formatSignedPercent(value);
};

export const HoldingList = ({
  holdings,
  quotes,
  onEdit,
  onDelete,
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
      {holdings.map((holding) => {
        const quote = quotes[holding.symbol];
        const performance = calculateHoldingPerformance(holding, quote);
        const hasLiveQuote =
          quote !== undefined && quote.status !== 'unavailable' && quote.price !== null;

        return (
          <article key={holding.id} className="holding-card card">
            <div className="holding-card__header">
              <div>
                <p className="holding-card__symbol">{holding.symbol}</p>
                <h3>{holding.name}</h3>
              </div>

              <div className="holding-card__actions">
                {quote?.status === 'stale' ? <span className="status-pill">行情已过期</span> : null}
                <button className="icon-button" type="button" onClick={() => onEdit(holding)}>
                  编辑
                </button>
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  onClick={() => onDelete(holding)}
                >
                  删除
                </button>
              </div>
            </div>

            <dl className="holding-card__metrics">
              <div>
                <dt>最新价</dt>
                <dd>{hasLiveQuote ? formatCurrency(quote.price as number) : '暂无行情'}</dd>
              </div>
              <div>
                <dt>当日涨跌</dt>
                <dd>{quote ? formatQuoteChange(quote.pct) : '—'}</dd>
              </div>
              <div>
                <dt>开仓价</dt>
                <dd>{formatCurrency(holding.openPrice)}</dd>
              </div>
              <div>
                <dt>持有数量</dt>
                <dd>{holding.quantity}</dd>
              </div>
            </dl>

            <p className="holding-card__profit">
              {performance.hasQuote
                ? `持仓收益：${formatSignedCurrency(performance.profit as number)}（${formatSignedPercent(
                    performance.returnPct as number,
                  )}）`
                : '持仓收益：—'}
            </p>

            {holding.note ? (
              <p className="holding-card__note">
                <span className="holding-card__note-label">备注：</span>
                {holding.note}
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
};
