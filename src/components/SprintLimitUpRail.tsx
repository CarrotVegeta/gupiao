import { formatPrice } from '../lib/quotes';
import { formatSignedPercent, valueClass } from '../lib/limitUpFormat';
import { StockIdentity } from './StockIdentity';
import type { SprintLimitUpResponse } from '../types';

type SprintLimitUpRailProps = {
  data: SprintLimitUpResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenAll: () => void;
};

/** 侧栏默认只列先冲起来的一批（接口按涨跌幅降序），避免把整池塞进 348px 的窄栏 */
const RAIL_LIMIT = 7;

/**
 * 涨停次数只在有值时上标签：冲刺池里绝大多数是「还没封板」（`lbc = 0`），
 * 名称旁挂一个「0 次」只是噪声；没有标签就是 0 次，完整次数在冲刺涨停整页里看。
 */
const boardTag = (value: number | null): string | null =>
  value === null || value <= 0 ? null : `${value} 次`;

/**
 * 自选页右栏常驻的冲刺涨停：三行把整页的六列压进窄栏 ——
 * 名称 +（N 次）/ 代码 + 涨速 + 涨停原因 / 涨幅大字 + 最新价，
 * 「查看全部」跳到涨停聚焦的冲刺涨停页签看完整表格。
 */
const SprintLimitUpRail = ({ data, isRefreshing, onRefresh, onOpenAll }: SprintLimitUpRailProps) => {
  const items = data.items.slice(0, RAIL_LIMIT);
  const isUnavailable = data.status === 'unavailable';

  return (
    <section className="card rail-card" aria-labelledby="sprint-rail-title">
      <div className="panel-header panel-header--tight">
        <div className="panel-header__title">
          <h2 id="sprint-rail-title">冲刺涨停</h2>
          {data.status === 'fresh' ? (
            <span className="panel-header__count">{data.items.length}</span>
          ) : null}
        </div>
        <div className="panel-header__actions">
          <button
            className="button button--secondary button--compact"
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
            aria-label="刷新冲刺涨停"
          >
            {isRefreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {isUnavailable && items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>{isRefreshing ? '正在拉取冲刺涨停…' : '冲刺涨停数据暂不可用'}</p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <p>暂无冲刺涨停</p>
            </div>
          ) : (
            <ul className="rail-list">
              {items.map((item) => (
                <li key={item.symbol} className="rail-list__item">
                  <div className="rail-list__left">
                    <StockIdentity
                      name={item.name}
                      code={item.symbol}
                      tag={boardTag(item.boardCount)}
                    />
                    {/* 涨速是「冲刺」的判据，涨幅在右侧放大；涨停原因是这一行的由头 */}
                    {/* 窄栏里这一行会被截断，完整文案挂在 title 上（原因往往比栏宽长） */}
                    <span
                      className="rail-list__meta"
                      title={`涨速 ${formatSignedPercent(item.speed)} · ${item.reason ?? '—'}`}
                    >
                      涨速 {formatSignedPercent(item.speed)} · {item.reason ?? '—'}
                    </span>
                  </div>
                  <div className="rail-list__right">
                    <span className={`sprint-rail__pct ${valueClass(item.pct)}`}>
                      {formatSignedPercent(item.pct)}
                    </span>
                    <span className="sprint-rail__price">{formatPrice(item.price)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button className="rail-card__more" type="button" onClick={onOpenAll}>
            查看全部 {data.items.length} 只 →
          </button>
        </>
      )}
    </section>
  );
};

export { SprintLimitUpRail };
