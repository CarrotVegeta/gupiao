import { useCallback, useEffect, useState } from 'react';
import type { MarketEmotion } from '../types';
import { fetchMarketOverview } from '../lib/market';
import { SectorRotationPanel, type RotationSummary } from './SectorRotationPanel';
import { PlateStockList } from './PlateStockList';
import { WarningNotesPanel, WarningNotesToggle, useWarningNotes } from './WarningNotes';

type RotationPageProps = {
  /** 导航计数用的摘要（窗口内上榜过的板块数） */
  onSummary?: (summary: RotationSummary) => void;
};

const formatRate = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;

const formatCount = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : String(value);

/** 成交额：万亿 / 亿 */
const formatAmount = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}万亿`;
  }
  if (value >= 100_000_000) {
    return `${Math.round(value / 100_000_000)}亿`;
  }
  return String(Math.round(value));
};

const EMOTION_NOTES_COUNT = 3;

/**
 * 市场情绪卡（财联社）。
 *
 * ⚠️ 只有当天快照：上游 `/v2/quote/a/stock/emotion` 没有日期参数。
 * 这里的「交易日」是**取数当天**，不是可选的历史日期 —— 所以本页不像其它页那样有日期选择。
 */
const EmotionCard = ({
  emotion,
  isLoading,
  onRefresh,
}: {
  emotion: MarketEmotion | null;
  isLoading: boolean;
  onRefresh: () => void;
}) => {
  const notes = useWarningNotes();
  const fresh = emotion?.status === 'fresh';

  return (
    <section className="card" aria-labelledby="rotation-emotion-title">
      <div className="overview__header">
        <div>
          <p className="eyebrow">财联社 · 仅当天</p>
          <div className="theme-title-row">
            <h2 id="rotation-emotion-title">市场情绪</h2>
            <WarningNotesToggle
              title="数据说明与限制"
              count={EMOTION_NOTES_COUNT}
              open={notes.open}
              panelId={notes.panelId}
              onToggle={notes.toggle}
            />
          </div>
        </div>
        <div className="sector-rotation__controls">
          <p className="overview__meta">
            {isLoading ? '加载中…' : fresh ? `交易日 ${emotion.tradeDate ?? '—'}` : '暂无数据'}
          </p>
          <button
            className="button button--secondary button--compact"
            type="button"
            disabled={isLoading}
            onClick={onRefresh}
          >
            {isLoading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <WarningNotesPanel panelId={notes.panelId} open={notes.open}>
        <p>
          数据来自财联社市场情绪接口。这几个指标本项目的自算口径（涨跌家数 / 涨停 / 炸板 / 晋级率）
          拿不到 —— 自算它们需要「昨日涨停池」，而东财涨停池只保留约 15 个交易日。
        </p>
        <p>
          <b>只有当天实时快照，没有历史</b>：接口没有日期参数，所以本页不提供日期选择，
          页头的「交易日」是取数当天。
        </p>
        <p>
          「封板率」= 最终封住 ÷ 触及涨停；「连板率」= 该板位晋级到下一板的比例 —— 两者口径不同，
          不要混着读。所有数字仅作情绪观察，不构成任何买卖建议。
        </p>
      </WarningNotesPanel>

      {isLoading && !emotion ? (
        <p className="overview__empty">正在加载市场情绪…</p>
      ) : fresh ? (
        <div className="rotation-emotion">
          <dl className="rotation-emotion__grid">
            <div className="rotation-emotion__cell">
              <dt>市场热度</dt>
              <dd>{formatCount(emotion.marketDegree)}</dd>
            </div>
            <div className="rotation-emotion__cell">
              <dt>封板率</dt>
              <dd>{formatRate(emotion.sealRate)}</dd>
            </div>
            <div className="rotation-emotion__cell">
              <dt>高开率</dt>
              <dd>{formatRate(emotion.openRate)}</dd>
            </div>
            <div className="rotation-emotion__cell">
              <dt>获利率</dt>
              <dd>{formatRate(emotion.profitRate)}</dd>
            </div>
            <div className="rotation-emotion__cell">
              <dt>封板 / 炸板</dt>
              <dd>
                {formatCount(emotion.sealCount)} / {formatCount(emotion.brokenCount)}
              </dd>
            </div>
            <div className="rotation-emotion__cell">
              <dt>昨涨停今表现</dt>
              <dd>{formatRate(emotion.yesterdayLimitUpPerformance)}</dd>
            </div>
            <div className="rotation-emotion__cell">
              <dt>两市成交额</dt>
              <dd>{formatAmount(emotion.turnover)}</dd>
            </div>
            {emotion.ladder.length > 0 ? (
              <div className="rotation-emotion__cell rotation-emotion__cell--wide">
                <dt>连板梯队（家数 / 连板率）</dt>
                <dd>
                  {emotion.ladder
                    .map(
                      (rung) =>
                        `${rung.name} ${rung.count ?? '—'}${
                          rung.promotionRate === null ? '' : `（${rung.promotionRate}%）`
                        }`,
                    )
                    .join(' ｜ ')}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <p className="overview__empty">
          市场情绪暂不可用（财联社情绪只有当天快照，非交易时段或上游异常时会是这样），不影响左栏板块轮动。
        </p>
      )}
    </section>
  );
};

/**
 * 右栏的板块成分股卡片：宽屏下点开板块时，它**顶掉**「市场情绪」。
 *
 * 没有「收起」按钮：收起 = 再点一次左栏那个板块行（左栏那一行同时是展开/收起开关，
 * 保留两个开关容易让人以为状态不一致）。已展开的行在左栏有高亮 + ▾ 标记。
 */
const PlateStockPanel = ({
  plateCode,
  plateName,
}: {
  plateCode: string;
  plateName: string;
}) => (
  <section className="card plate-detail" aria-labelledby="plate-detail-title">
    <div className="overview__header">
      <div>
        <p className="eyebrow">财联社 · 板块成分股</p>
        <div className="theme-title-row">
          <h2 id="plate-detail-title">{plateName}</h2>
          <span className="theme-card__badge">当前快照</span>
        </div>
      </div>
      <p className="overview__meta">再点左侧该板块可收起</p>
    </div>
    <PlateStockList plateCode={plateCode} variant="panel" />
  </section>
);

/**
 * 「轮动」一级页：板块轮动（历史口径）+ 市场情绪（当天快照）。
 *
 * 为什么单独开一页而不是塞进选股页的板块档：
 * 轮动是**历史板块口径**，与选股页「板块」档的当日主线 / 支线是两套不同的东西，
 * 混在一屏里容易被当成同一口径读（板块划分和家数都对不上）。
 */
export const RotationPage = ({ onSummary }: RotationPageProps) => {
  const [emotion, setEmotion] = useState<MarketEmotion | null>(null);
  const [isEmotionLoading, setIsEmotionLoading] = useState(true);
  /**
   * 当前展开的板块。
   *
   * 状态放在页面级而不是 `SectorRotationPanel` 内部：展开的成分股要渲染在**右栏**，
   * 并且在展开期间**顶掉右栏的「市场情绪」**（用户口径：点开就看成分股，别再挤一屏）。
   * 窄屏下页面降为单列，成分股会按 DOM 顺序自然落到列表下方。
   */
  const [expandedPlate, setExpandedPlate] = useState<{ code: string; name: string } | null>(null);

  const refreshEmotion = useCallback(async (): Promise<void> => {
    setIsEmotionLoading(true);
    try {
      const response = await fetchMarketOverview();
      setEmotion(response.emotion ?? null);
    } catch {
      setEmotion(null);
    } finally {
      setIsEmotionLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEmotion();
  }, [refreshEmotion]);

  return (
    <div className={`rotation-page${expandedPlate !== null ? ' rotation-page--plate' : ''}`}>
      <div className="rotation-page__column">
        <SectorRotationPanel
          onSummary={onSummary}
          expandedPlate={expandedPlate?.code ?? null}
          onExpandedChange={setExpandedPlate}
        />
      </div>
      <div className="rotation-page__column">
        {expandedPlate !== null ? (
          <PlateStockPanel plateCode={expandedPlate.code} plateName={expandedPlate.name} />
        ) : (
          <EmotionCard
            emotion={emotion}
            isLoading={isEmotionLoading}
            onRefresh={() => void refreshEmotion()}
          />
        )}
      </div>
    </div>
  );
};
