import { formatPercent } from '../lib/quotes';
import type { MarketBreadth, MarketEmotion, MarketIndex } from '../types';

type MarketOverviewProps = {
  indices: MarketIndex[];
  /** 两市成交额（元） */
  turnover?: number | null;
  breadth?: MarketBreadth | null;
  /** 财联社情绪：封板率 / 高开率 / 获利率 / 连板梯队，取不到就是 null */
  emotion?: MarketEmotion | null;
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

export const getMarketToneClass = (
  status: MarketIndex['status'],
  value: number | null | undefined,
): string => {
  if (status !== 'fresh') {
    return 'value--neutral';
  }

  return getValueToneClass(value);
};

const getStatusText = (status: MarketIndex['status']): string | null => {
  if (status === 'stale') {
    return '数据已过期';
  }

  if (status === 'unavailable') {
    return '无可用数据';
  }

  return null;
};

export const formatIndexValue = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('zh-CN', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatSignedNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '-'}${formatIndexValue(Math.abs(value))}`;

/** 成交额：万亿 / 亿 / 万 */
const formatIndexAmount = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}万亿`;
  }
  if (value >= 100_000_000) {
    return `${Math.round(value / 100_000_000)}亿`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 10_000)}万`;
  }
  return String(Math.round(value));
};

export const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '-'}${formatPercent(Math.abs(value))}`;

const formatCount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : String(value);

const formatRate = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;

/**
 * 财联社情绪行：封板率 / 高开率 / 获利率 + 连板梯队。
 *
 * 这几个指标是本项目自算口径（`breadth`）拿不到的 —— 自算需要「昨日涨停池」，
 * 而东财只保留约 15 个交易日。两者并列展示，口径不一致本身就是上游异常信号。
 */
const EmotionRow = ({ emotion }: { emotion: MarketEmotion }) => (
  <div className="market-breadth__row" aria-label="财联社情绪">
    <span className="market-breadth__item" title="最终封住 / 触及涨停">
      <span className="visually-hidden">封板率</span>封板率 <b>{formatRate(emotion.sealRate)}</b>
    </span>
    <span className="market-breadth__item" title="昨日涨停股今日高开占比">
      <span className="visually-hidden">高开率</span>高开率 <b>{formatRate(emotion.openRate)}</b>
    </span>
    <span className="market-breadth__item" title="昨日涨停股今日获利的占比">
      <span className="visually-hidden">获利率</span>获利率 <b>{formatRate(emotion.profitRate)}</b>
    </span>
    {emotion.ladder.length > 0 ? (
      <span
        className="market-breadth__item"
        title={emotion.ladder
          .map(
            (rung) =>
              `${rung.name} ${rung.count ?? '—'} 家${
                rung.promotionRate === null ? '' : `（连板率 ${rung.promotionRate}%）`
              }`,
          )
          .join('｜')}
      >
        <span className="visually-hidden">连板梯队</span>连板{' '}
        <b>{emotion.ladder.map((rung) => rung.count ?? '—').join('/')}</b>
      </span>
    ) : null}
  </div>
);

export const MarketOverview = ({
  indices,
  turnover = null,
  breadth = null,
  emotion = null,
}: MarketOverviewProps) => (
  <section className="market-overview" aria-labelledby="market-overview-title">
    <h2 id="market-overview-title" className="visually-hidden">
      大盘概览
    </h2>
    <dl className="market-overview__grid">
      {indices.map((index) => {
        const statusText = getStatusText(index.status);

        return (
          <div key={index.symbol} className={`market-index-card market-index-card--${index.status}`}>
            <div className="market-index-card__topline">
              <dt>{index.name}</dt>
              {statusText ? (
                <span className="market-index-card__status value--neutral">{statusText}</span>
              ) : (
                <span className="market-index-card__status market-index-card__status--fresh" />
              )}
            </div>
            <dd className={`market-index-card__price ${getMarketToneClass(index.status, index.change)}`}>
              <strong>{formatIndexValue(index.price)}</strong>
            </dd>
            <div className="market-index-card__changes">
              <span className={getMarketToneClass(index.status, index.change)}>
                <span className="visually-hidden">涨跌额</span>
                {formatSignedNumber(index.change)}
              </span>
              <span className={getMarketToneClass(index.status, index.pct)}>
                <span className="visually-hidden">涨跌幅</span>
                {formatSignedPercent(index.pct)}
              </span>
              <span className="market-index-card__amount">
                <span className="visually-hidden">成交额</span>
                {formatIndexAmount(index.amount)}
              </span>
            </div>
          </div>
        );
      })}

      {/* 第 4 格对齐 F：两市成交 + 涨停/炸板/晋级率 */}
      <div className="market-index-card market-breadth-card">
        <div className="market-index-card__topline">
          <dt>两市成交</dt>
          {breadth?.status === 'fresh' ? (
            <span className="market-index-card__status market-index-card__status--fresh" />
          ) : (
            <span className="market-index-card__status value--neutral">暂无数据</span>
          )}
        </div>
        <dd className="market-index-card__price">
          <strong>{formatIndexAmount(turnover)}</strong>
        </dd>
        <div className="market-index-card__changes">
          <span className="market-breadth__item">
            <span className="visually-hidden">涨跌家数</span>涨跌数{' '}
            <b className={getValueToneClass(breadth?.riseCount)}>
              {formatCount(breadth?.riseCount ?? null)}
            </b>
            <span className="market-breadth__slash">/</span>
            <b className={getValueToneClass(breadth?.fallCount ? -breadth.fallCount : null)}>
              {formatCount(breadth?.fallCount ?? null)}
            </b>
          </span>
          <span className="market-breadth__item">
            <span className="visually-hidden">涨停家数</span>涨停 <b>{formatCount(breadth?.limitUpCount ?? null)}</b>
          </span>
          <span className="market-breadth__item">
            <span className="visually-hidden">炸板家数</span>炸板 <b>{formatCount(breadth?.brokenCount ?? null)}</b>
          </span>
          <span className="market-breadth__item">
            <span className="visually-hidden">晋级率</span>晋级 <b>{formatRate(breadth?.promotionRate ?? null)}</b>
          </span>
        </div>
        {emotion?.status === 'fresh' ? <EmotionRow emotion={emotion} /> : null}
      </div>
    </dl>
  </section>
);
