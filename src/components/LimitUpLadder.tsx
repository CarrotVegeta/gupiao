import { useEffect, useState } from 'react';
import type { LimitUpLadderGroup, LimitUpLadderResponse } from '../types';
import {
  formatBoardLevel,
  formatPercent,
  formatSignedPercent,
  formatTradeDate,
  valueClass,
} from '../lib/limitUpFormat';
import { StockIdentity } from './StockIdentity';

type LimitUpLadderProps = {
  data: LimitUpLadderResponse;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const groupKey = (group: LimitUpLadderGroup): string =>
  group.boardCount === null ? 'unknown' : String(group.boardCount);

const groupLabel = (group: LimitUpLadderGroup): string =>
  group.boardCount === null ? '连板未知' : `${group.boardCount} 板`;

const countAt = (data: LimitUpLadderResponse, boardCount: number): number =>
  data.ladder.find((group) => group.boardCount === boardCount)?.items.length ?? 0;

/** 晋级率按「昨日涨停今天再涨停 / 昨日涨停」算；昨日池子没拿到时显示 —，不用 0% 冒充 */
const formatPromotionRate = (data: LimitUpLadderResponse): string =>
  data.previousAvailable ? formatPercent(data.promotionRate) : '—';

/**
 * 换交易日就重置折叠状态：**默认全部展开**。
 * 收起某一档只是临时收纳，点这一档的表头就能再展开。
 * 放在 effect 里而不是渲染期：渲染期 setState 会让组件在数据到位的那一帧先渲染一次旧折叠态。
 */
const useCollapsedTiers = (data: LimitUpLadderResponse): [
  Record<string, boolean>,
  (key: string) => void,
] => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const tradeDate = data.tradeDate;
  const ladderSignature = data.ladder.map((group) => groupKey(group)).join(',');

  useEffect(() => {
    setCollapsed({});
    // ladderSignature 让「同一天但数据换了档位」也能回到默认（全展开）
  }, [tradeDate, ladderSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string): void =>
    setCollapsed((current) => ({ ...current, [key]: !(current[key] ?? false) }));

  return [collapsed, toggle];
};

const LimitUpLadder = ({ data, isRefreshing, onRefresh }: LimitUpLadderProps) => {
  const [collapsed, toggle] = useCollapsedTiers(data);

  return (
    <section className="card limit-up-ladder" aria-labelledby="limit-up-ladder-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">东方财富涨停池</p>
          <h2 id="limit-up-ladder-title">连板天梯</h2>
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
            最高板：
            <span>{data.ladder.length === 0 ? '—' : formatBoardLevel(data.ladder[0].boardCount)}</span>
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? '刷新中…' : '刷新连板天梯'}
          </button>
        </div>
      </div>

      {data.status === 'stale' ? (
        <p className="banner banner--warning" role="status">
          数据已过期
        </p>
      ) : null}

      {data.status === 'unavailable' ? (
        <>
          <p className="banner banner--warning" role="status">
            连板天梯数据暂不可用
          </p>
          {data.error ? <p className="status-note">{data.error}</p> : null}
        </>
      ) : null}

      {/*
       * 昨日池子没取到时只有「今日天梯」这一半可用：晋级率是「昨日涨停今天再涨停」的口径，
       * 没有昨日池子就只能显示 —，并且把原因写出来，不能显示成 0%。
       */}
      {data.status !== 'unavailable' && !data.previousAvailable ? (
        <p className="status-note" role="status">
          上一交易日涨停池暂不可用，晋级率与今/昨对比无法计算。
        </p>
      ) : null}

      {data.status !== 'unavailable' ? (
        <div className="limit-up-ladder__stats">
          <div className="limit-up-ladder__stat">
            <span className="limit-up-ladder__stat-label">全部</span>
            <b className="limit-up-ladder__stat-value">{data.items.length}</b>
          </div>
          <div className="limit-up-ladder__stat">
            <span className="limit-up-ladder__stat-label">首板</span>
            <b className="limit-up-ladder__stat-value">{countAt(data, 1)}</b>
          </div>
          <div className="limit-up-ladder__stat">
            <span className="limit-up-ladder__stat-label">2 板</span>
            <b className="limit-up-ladder__stat-value">{countAt(data, 2)}</b>
          </div>
          <div className="limit-up-ladder__stat">
            <span className="limit-up-ladder__stat-label">
              晋级率
              {data.previousTradeDate === null
                ? ''
                : `（对 ${formatTradeDate(data.previousTradeDate)}）`}
            </span>
            <b className="limit-up-ladder__stat-value">{formatPromotionRate(data)}</b>
          </div>
        </div>
      ) : null}

      {data.ladder.length === 0 ? (
        <div className="empty-state empty-state--subtle">
          <p>{data.status === 'unavailable' ? '暂无可用连板天梯数据' : '暂无涨停数据'}</p>
        </div>
      ) : (
        <div className="limit-up-ladder__list">
          {data.ladder.map((group) => {
            const key = groupKey(group);
            const isCollapsed = collapsed[key] ?? false;

            return (
              <section
                className="limit-up-ladder__group"
                key={key}
                aria-label={`${groupLabel(group)} ${group.items.length} 只`}
              >
                {/* 整行表头就是展开/收起开关：不再单放一个 +/- 按钮 */}
                <button
                  className="limit-up-ladder__group-head"
                  type="button"
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? '展开' : '收起'}${groupLabel(group)}`}
                  onClick={() => toggle(key)}
                >
                  <span className="limit-up-ladder__chevron" aria-hidden="true">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="limit-up-ladder__group-label">{groupLabel(group)}</span>
                  <span className="limit-up-ladder__group-count">{group.items.length} 只</span>
                  <span className="limit-up-ladder__hint">
                    {isCollapsed ? '点击展开' : '点击收起'}
                  </span>
                </button>

                {isCollapsed ? null : (
                  <ul className="limit-up-ladder__stocks">
                    {group.items.map((item) => (
                      <li className="limit-up-ladder__stock" key={item.symbol}>
                        <StockIdentity name={item.name} code={item.symbol} />
                        <span className={`limit-up-ladder__pct ${valueClass(item.pct)}`}>
                          {formatSignedPercent(item.pct)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
};

export { LimitUpLadder };
