import { useState } from 'react';
import { StockIdentity } from './StockIdentity';
import type { AuctionResponse, AuctionResult } from '../types';

type AuctionRailProps = {
  data: AuctionResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenAll: () => void;
};

/** 侧栏默认只列概率最高的几只，避免把整张表塞进窄栏 */
const RAIL_LIMIT = 7;

type RailTier = Extract<AuctionResult, 'qualified' | 'watch'>;

const tierOrder: RailTier[] = ['qualified', 'watch'];

const tierLabels: Record<RailTier, string> = {
  qualified: '合格',
  watch: '观察',
};

/** 侧栏常驻的竞价候选：默认列概率最高的几只，点「合格 / 观察」就地筛档 */
export const AuctionRail = ({ data, isRefreshing, onRefresh, onOpenAll }: AuctionRailProps) => {
  // null = 不筛档；再点一次已选中的档位回到不筛档
  const [tier, setTier] = useState<RailTier | null>(null);

  const ranked = [...data.items]
    .filter((item) => item.limitUpProbability !== null)
    .sort((left, right) => (right.limitUpProbability ?? 0) - (left.limitUpProbability ?? 0));
  const tierCounts = tierOrder.reduce<Record<RailTier, number>>(
    (counts, current) => ({
      ...counts,
      [current]: data.items.filter((item) => item.result === current).length,
    }),
    { qualified: 0, watch: 0 },
  );
  const items = tier === null ? ranked.slice(0, RAIL_LIMIT) : ranked.filter((item) => item.result === tier);
  const isUnavailable = data.status === 'unavailable';

  return (
    <section className="card rail-card" aria-labelledby="auction-rail-title">
      <div className="panel-header panel-header--tight">
        <div className="panel-header__title">
          <h2 id="auction-rail-title">竞价候选</h2>
          {data.status === 'fresh' ? (
            <span className="panel-header__count">{data.items.length}</span>
          ) : null}
        </div>
        <div className="panel-header__actions">
          {/* 稿子 F：这两个档位统计沿用卡片头的分段控件样式，并且可以直接筛档 */}
          <div className="segmented" role="group" aria-label="按档位筛选竞价候选">
            {tierOrder.map((current) => (
              <button
                key={current}
                type="button"
                className={`segmented__item${tier === current ? ' segmented__item--on' : ''}`}
                aria-pressed={tier === current}
                title={
                  tier === current
                    ? `取消「${tierLabels[current]}」筛选`
                    : `只看「${tierLabels[current]}」`
                }
                onClick={() => setTier((active) => (active === current ? null : current))}
              >
                {tierLabels[current]} {tierCounts[current]}
              </button>
            ))}
          </div>
          <button
            className="button button--secondary button--compact"
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
            aria-label="刷新竞价"
          >
            {isRefreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {isUnavailable && items.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>{isRefreshing ? '正在拉取竞价快照…' : '竞价数据暂不可用'}</p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <div className="empty-state empty-state--subtle">
              <p>{tier === null ? '暂无竞价候选' : `「${tierLabels[tier]}」档暂无候选`}</p>
              {tier === null ? null : (
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => setTier(null)}
                >
                  显示全部 {ranked.length} 只
                </button>
              )}
            </div>
          ) : (
            <ul className="rail-list">
              {items.map((item) => (
                <li key={item.symbol} className="rail-list__item">
                  <div className="rail-list__left">
                    <StockIdentity
                      name={item.name}
                      code={item.symbol}
                      tag={item.boardCount === null ? null : `${item.boardCount} 连板`}
                    />
                    <span className="rail-list__meta">
                      竞价
                      {item.auctionPct === null
                        ? ' —'
                        : ` ${item.auctionPct >= 0 ? '+' : ''}${item.auctionPct.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="rail-list__right">
                    <span className={`rail-list__prob tier-${item.result}`}>
                      {Math.round((item.limitUpProbability ?? 0) * 100)}%
                    </span>
                    <span className="rail-meter" aria-hidden="true">
                      <span
                        className={`rail-meter__fill tier-${item.result}`}
                        style={{ width: `${Math.round((item.limitUpProbability ?? 0) * 100)}%` }}
                      />
                    </span>
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
