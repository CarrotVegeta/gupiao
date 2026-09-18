/**
 * 主线引擎 · 板块宇宙（设计稿 §10.2）。
 *
 * 只用同花顺时有一个结构性限制：`block_top` 单日**固定只给涨停板块 Top 20**，
 * 没有「全量概念板块实时行情」接口（361 个概念板块的代码形态是 3xxxxx，
 * 查不到行情；能查行情的是 885xxx/886xxx）。
 *
 * 所以板块宇宙靠**历史累积**：连续拉很多天的 block_top 做并集。
 * 实测 25 个有效交易日 → 114 个板块（见设计稿 §10.2）。
 *
 * 这张「出现天数」表本身就是原方法要的「反复出现的板块」——
 * 出现天数多 = 长期反复进涨停家数 Top 20。
 */
import { fetchBlockTop } from '../themes/tenjqka.js';
import type { BlockTopRow } from '../themes/tenjqka.js';
import type { QuoteError } from '../../src/types.js';
import type { UniverseEntry } from './types.js';

export type UniverseBuildResult = {
  entries: UniverseEntry[];
  /** 真正返回过数据的交易日（block_top 在周末/无数据日返回空） */
  hitDates: string[];
  /** 拉取过但没数据的日期（周末、节假日、或早于 2025-09-03） */
  missedDates: string[];
  errors: QuoteError[];
};

/** 把若干天的 block_top 结果并成板块宇宙 */
export const accumulateUniverse = (
  days: Array<{ date: string; rows: BlockTopRow[] }>,
): { entries: UniverseEntry[]; hitDates: string[]; missedDates: string[] } => {
  const byCode = new Map<string, UniverseEntry>();
  const hitDates: string[] = [];
  const missedDates: string[] = [];

  for (const { date, rows } of days) {
    if (rows.length === 0) {
      missedDates.push(date);
      continue;
    }
    hitDates.push(date);
    for (const row of rows) {
      const existing = byCode.get(row.code);
      if (existing === undefined) {
        byCode.set(row.code, {
          code: row.code,
          name: row.name,
          days: 1,
          maxLimitUpCount: row.limitUpCount ?? 0,
          firstSeen: date,
          lastSeen: date,
        });
        continue;
      }
      existing.days += 1;
      existing.maxLimitUpCount = Math.max(existing.maxLimitUpCount, row.limitUpCount ?? 0);
      existing.lastSeen = date;
      if (date < existing.firstSeen) existing.firstSeen = date;
      if (date > existing.lastSeen) existing.lastSeen = date;
      // 板块改名时用最近一次的名字
      if (date === existing.lastSeen) existing.name = row.name;
    }
  }

  const entries = [...byCode.values()].sort(
    (a, b) => b.days - a.days || b.maxLimitUpCount - a.maxLimitUpCount || a.code.localeCompare(b.code),
  );
  hitDates.sort();
  missedDates.sort();
  return { entries, hitDates, missedDates };
};

/**
 * 拉一批日期的 block_top 并累积成宇宙。
 *
 * `concurrency` 默认 4：同花顺对并发不敏感（实测 12 并发无失败），
 * 但拉一年的数据是几百个请求，保守取 4 避免给上游压力。
 */
export const buildUniverse = async (
  dates: string[],
  fetchImpl: typeof fetch = fetch,
  concurrency = 4,
): Promise<UniverseBuildResult> => {
  const errors: QuoteError[] = [];
  const results: Array<{ date: string; rows: BlockTopRow[] }> = new Array(dates.length);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, dates.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= dates.length) return;
      const date = dates[index];
      const { rows, error } = await fetchBlockTop(date, fetchImpl);
      if (error) errors.push(error);
      results[index] = { date, rows };
    }
  });
  await Promise.all(workers);

  const { entries, hitDates, missedDates } = accumulateUniverse(results.filter(Boolean));
  return { entries, hitDates, missedDates, errors };
};
