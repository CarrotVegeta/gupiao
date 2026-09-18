/**
 * 端到端冒烟（vitest 跑，避免 Node 类型剥离不支持 `.js` → `.ts` 重写）。
 *
 * 这是**联网**测试：默认跳过，需要显式打开。
 *   MAINLINE_SMOKE=1 node node_modules/vitest/vitest.mjs run server/mainline/mainline.smoke.test.ts
 *
 * 目的：确认「宇宙累积 → 逐日装配 → 跨日历史 → 评分」在真实数据上不崩、输出可解释。
 */
import { describe, expect, it } from 'vitest';
import { buildUniverse } from './universe.js';
import { buildDay, buildBoardHistories } from './build.js';
import { fetchBoardYearKline, amountOn } from './client.js';
import { fetchBlockTop, fetchLimitUpPool } from '../themes/tenjqka.js';

const enabled = process.env.MAINLINE_SMOKE === '1';

const dateRange = (from: string, to: string): string[] => {
  const dates: string[] = [];
  const cursor = new Date(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}T00:00:00Z`);
  const last = new Date(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(
      `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`,
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

describe.skipIf(!enabled)('主线引擎端到端冒烟（联网）', () => {
  it('装配一周真实数据并给出可解释的评分', async () => {
    const allDates = dateRange('20260908', '20260918');
    const universe = await buildUniverse(allDates, fetch, 4);

    console.log(`\n[1] 板块宇宙 ${universe.entries.length} 个（有效交易日 ${universe.hitDates.length}）`);
    for (const entry of universe.entries.slice(0, 10)) {
      console.log(`    ${entry.code} ${entry.name.padEnd(16)} 上榜 ${entry.days} 天  最高涨停 ${entry.maxLimitUpCount}`);
    }
    expect(universe.entries.length).toBeGreaterThan(10);

    const tradeDates = universe.hitDates;
    const klineCache = new Map<string, Awaited<ReturnType<typeof fetchBoardYearKline>>['bars']>();
    const partials = [];

    for (const date of tradeDates) {
      const { rows } = await fetchBlockTop(date, fetch);
      const amountByCode = new Map<string, number>();
      for (const row of rows) {
        let bars = klineCache.get(row.code);
        if (bars === undefined) {
          bars = (await fetchBoardYearKline(row.code, Number(date.slice(0, 4)), fetch)).bars;
          klineCache.set(row.code, bars);
        }
        const amount = amountOn(bars, date);
        if (amount !== null) amountByCode.set(row.code, amount);
      }

      const pool = await fetchLimitUpPool(date, fetch);
      const marketMaxBoard =
        pool.rows.length === 0 ? null : Math.max(...pool.rows.map((item) => item.boardCount ?? 1));

      partials.push(
        buildDay({ date, rows, amountByCode, mainNetByCode: new Map(), marketMaxBoard }),
      );
    }

    const histories = buildBoardHistories(partials);
    const lastDate = tradeDates[tradeDates.length - 1];
    const latest = histories
      .map((history) => ({ history, day: history.days.find((item) => item.date === lastDate) }))
      .filter((item): item is { history: typeof histories[number]; day: NonNullable<typeof item.day> } => item.day !== undefined)
      .sort((a, b) => (b.day.judge?.total ?? 0) - (a.day.judge?.total ?? 0));

    console.log(`\n[2] ${lastDate} 评分排序 Top 12（共 ${latest.length} 个板块）`);
    console.log('    板块              涨停 最高 连榜 连续 hit  得分 分档');
    for (const { day } of latest.slice(0, 12)) {
      console.log(
        `    ${day.name.padEnd(16)} ${String(day.limitUpCount).padStart(3)} ${String(day.maxBoard).padStart(3)} ` +
          `${String(day.streakHit).padStart(4)} ${String(day.streak).padStart(4)} ${String(day.hit).padStart(3)} ` +
          `${String(day.judge?.total ?? '—').padStart(5)}  ${day.judge?.tier ?? '—'}`,
      );
    }

    const focus = latest[0];
    console.log(`\n[3] 明细：${focus.day.name}（${focus.day.code}）`);
    console.log(
      `    题材：${focus.day.themes.map((t) => `${t.key}×${t.count}(连续${t.streak}/扩散${t.boardSpread})`).join('  ') || '（无 ≥2 家的题材）'}`,
    );
    console.log(
      `    梯队：最高 ${focus.day.ladder?.maxBoard ?? 0} 板，前排 ${focus.day.ladder?.frontRow.length ?? 0}，首板 ${focus.day.ladder?.firstBoard.length ?? 0}，中军 ${focus.day.ladder?.core.length ?? 0}（可判定=${focus.day.ladder?.coreAvailable ?? false}）`,
    );
    for (const day of focus.history.days) {
      console.log(
        `    ${day.date} 涨 ${String(day.pct).padStart(6)}% 涨停 ${String(day.limitUpCount).padStart(3)} ` +
          `${day.dayKind.padEnd(10)} 连续 ${String(day.streak).padStart(2)} ` +
          `名次 涨${day.rank.pct ?? '—'}/停${day.rank.limitUp ?? '—'}/资${day.rank.flow ?? '—'}/额${day.rank.amount ?? '—'} 分 ${day.judge?.total ?? '—'}`,
      );
    }
    console.log('    评分明细：');
    for (const condition of focus.day.judge?.conditions ?? []) {
      console.log(
        `      ${condition.hit ? '✔' : '✘'} ${condition.label.padEnd(18)} ${String(condition.score).padStart(3)}  ${condition.evidence}`,
      );
    }
    console.log(`    degraded=${focus.day.judge?.degraded}  ebb=${focus.day.judge?.ebb}`);

    expect(latest.length).toBeGreaterThan(0);
    expect(focus.day.judge).not.toBeNull();
  }, 240_000);
});
