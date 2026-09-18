/**
 * 给东财涨停池补上同花顺的字段：**涨停原因**（标签串 + 长文）、封单额、开板次数、换手率、流通市值。
 *
 * 为什么要 join 而不是换源：
 *   - 东财池是这一页的既有口径（`/api/limit-up` 的 items 就是它），
 *     「哪些票涨停」以它为准，换源会让涨停家数、炸板次数这些跟着变；
 *   - 同花顺池是补字段最便宜的来源，而且**只有它有涨停原因**（东财池没有这个字段）。
 *
 * 缺口按缺口处理：join 不上的票这些字段就是 null，页面显示「—」，
 * 不拿别的数字顶，也不因为「这家没有」把整行判成异常。
 */
import type { LimitUpItem, LimitUpResponse } from '../../src/types.js';
import { getThsPoolRows } from './pool-cache.js';
import type { LimitUpPoolRow } from '../themes/tenjqka.js';

const joinRows = (
  items: LimitUpItem[],
  rows: LimitUpPoolRow[],
): { items: LimitUpItem[]; joined: number } => {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  let joined = 0;

  const merged = items.map((item) => {
    const row = bySymbol.get(item.symbol);
    if (row === undefined) return item;
    joined += 1;
    return {
      ...item,
      reason: row.reasonTags.length > 0 ? row.reasonTags.join('+') : null,
      reasonText: row.reasonText,
      sealAmount: row.sealAmount,
      openCount: row.openCount,
      turnoverRate: row.turnoverRate,
      floatMarketCap: row.floatMarketCap,
    };
  });

  return { items: merged, joined };
};

export const enrichLimitUpWithThs = async (
  tradeDate: string,
  response: LimitUpResponse,
  fetchImpl: typeof fetch = fetch,
): Promise<LimitUpResponse> => {
  // 池子本身不可用时不做无谓的上游请求
  if (response.status === 'unavailable' || response.items.length === 0) return response;

  const { rows } = await getThsPoolRows(tradeDate, fetchImpl);
  /*
   * 补充失败就原样返回：主结果（哪些票涨停、连板、炸板）来自东财池，不该被这一层拖垮。
   * 也**不能**往 error 里写 —— 前端契约（`src/lib/limitUp.ts`）把「fresh + error」判成坏数据，
   * 那样整页会变成不可用，比少几列严重得多。缺口就如实显示「—」。
   */
  if (rows.length === 0) return response;

  const { items } = joinRows(response.items, rows);
  return { ...response, items };
};

/** 单测用：只做 join，不碰网络 */
export const joinThsFieldsForTest = joinRows;
