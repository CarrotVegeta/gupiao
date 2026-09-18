/**
 * 主线判定方法 · 回测（设计稿 §18）。
 *
 * 回答一个问题：**按这套评分表选出来的板块，第二天有没有超额。**
 *
 * 收益口径（设计稿 §18.1）：
 *   - **不用板块指数**（不可交易），用「该板块当日的涨停成员」等权持有
 *   - 买入价 = 次一交易日开盘，卖出价 = 次一交易日收盘（T+1 日内）
 *   - 成员集合用**信号日当天**的成员，避免用今天的成分股回算的前视偏差
 *
 * 基准：
 *   - 全市场等权（用同日全部涨停股等权，近似市场平均）
 *   - 「涨停家数前三」朴素口径
 *
 * 分层：按 §6 评分分档（主线 ≥10 / 候选 7~9 / 支线 4~6 / 一日游 ≤3）
 *
 * 已知降级（必须披露）：历史没有资金流，`capitalReturn` 与 `coreTroop` 两项
 * 在历史里不可判定，所以回测的是**降级版评分表**。
 *
 *   MAINLINE_BACKTEST_DAYS=60 node node_modules/vitest/vitest.mjs run server/mainline/mainline.backtest.test.ts
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildUniverse } from './universe.js';
import { buildDay, buildBoardHistories } from './build.js';
import { fetchBoardYearKline, amountOn } from './client.js';
import { fetchBlockTop, fetchLimitUpPool, fetchStockKline, type KlineBar } from '../themes/tenjqka.js';

const enabled = process.env.MAINLINE_BACKTEST === '1';
const TARGET_DAYS = Number(process.env.MAINLINE_BACKTEST_DAYS ?? 60);
/** 从 2025-09-03（block_top 最早可用日）开始 */
const START = process.env.MAINLINE_BACKTEST_START ?? '20250903';
const END = process.env.MAINLINE_BACKTEST_END ?? '20260918';

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

/** 交易日历：block_top 有数据的日子就是交易日 */
const tradeDates = async (from: string, to: string, fetchImpl: typeof fetch): Promise<string[]> => {
  const universe = await buildUniverse(dateRange(from, to), fetchImpl, 6);
  return universe.hitDates;
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/** 样本标准差 */
const stdev = (values: number[]): number | null => {
  if (values.length < 2) return null;
  const avg = mean(values) as number;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
};

/** 单样本 t 值 */
const tStat = (values: number[]): number | null => {
  const avg = mean(values);
  const sd = stdev(values);
  if (avg === null || sd === null || sd === 0) return null;
  return avg / (sd / Math.sqrt(values.length));
};

const fmtPct = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(2)}%`;
const fmtT = (value: number | null): string => (value === null ? '—' : value.toFixed(2));

describe.skipIf(!enabled)('主线方法回测（联网）', () => {
  it('按评分分档统计 T+1 等权收益', async () => {
    const dates = await tradeDates(START, END, fetch);
    // 取最近 TARGET_DAYS 个交易日（留出最后一天用于次日收益）
    const window = dates.slice(-TARGET_DAYS);
    console.log(`\n回测区间：${window[0]} ~ ${window[window.length - 1]}（${window.length} 个交易日）`);

    // ---- 装配每一天 ----
    const klineYearCache = new Map<string, Awaited<ReturnType<typeof fetchBoardYearKline>>['bars']>();
    const partials = [];
    for (const date of window) {
      const { rows } = await fetchBlockTop(date, fetch);
      const year = Number(date.slice(0, 4));
      const amountByCode = new Map<string, number>();
      for (const row of rows) {
        const key = `${row.code}|${year}`;
        let bars = klineYearCache.get(key);
        if (bars === undefined) {
          bars = (await fetchBoardYearKline(row.code, year, fetch)).bars;
          klineYearCache.set(key, bars);
        }
        const amount = amountOn(bars, date);
        if (amount !== null) amountByCode.set(row.code, amount);
      }
      const pool = await fetchLimitUpPool(date, fetch);
      const marketMaxBoard =
        pool.rows.length === 0 ? null : Math.max(...pool.rows.map((item) => item.boardCount ?? 1));
      partials.push(buildDay({ date, rows, amountByCode, mainNetByCode: new Map(), marketMaxBoard }));
    }

    const histories = buildBoardHistories(partials);
    const byDate = new Map(histories.flatMap((history) => history.days.map((day) => [`${day.date}|${day.code}`, day] as const)));

    // ---- 交易日序列索引（用于找次一交易日）----
    const dateIndex = new Map(window.map((date, index) => [date, index]));

    // ---- 个股日K缓存：只对候选成员拉 ----
    const stockKlineCache = new Map<string, KlineBar[]>();
    const stockKline = async (symbol: string): Promise<KlineBar[]> => {
      const cached = stockKlineCache.get(symbol);
      if (cached !== undefined) return cached;
      const bars = await fetchStockKline(symbol, fetch);
      stockKlineCache.set(symbol, bars);
      return bars;
    };

    /** 某只票在指定日期的开/收盘 */
    const barOn = (bars: KlineBar[], date: string): KlineBar | undefined =>
      bars.find((bar) => bar.date === date);

    /**
     * T+1 日内收益：信号日 d 的成员，等权在 d+1 开盘买入、d+1 收盘卖出。
     * 取不到 d+1 价格的成员从样本里剔除（不拿 0 顶）。
     */
    const t1Return = async (
      date: string,
      members: string[],
    ): Promise<{ value: number; used: number; total: number } | null> => {
      const nextIndex = (dateIndex.get(date) ?? -1) + 1;
      if (nextIndex <= 0 || nextIndex >= window.length) return null;
      const nextDate = window[nextIndex];

      const returns: number[] = [];
      for (const symbol of members) {
        const bars = await stockKline(symbol);
        const next = barOn(bars, nextDate);
        if (next === undefined || !Number.isFinite(next.open) || next.open <= 0) continue;
        returns.push(next.close / next.open - 1);
      }
      const value = mean(returns);
      if (value === null) return null;
      return { value, used: returns.length, total: members.length };
    };

    // ---- 逐日收集样本 ----
    type Sample = { date: string; code: string; name: string; tier: string; score: number; ret: number };
    const samples: Sample[] = [];
    /** 朴素口径：涨停家数前三 */
    const naiveSamples: Sample[] = [];
    const marketSamples: Sample[] = [];

    for (const date of window) {
      const dayEntries = [...byDate.entries()]
        .filter(([key]) => key.startsWith(`${date}|`))
        .map(([, day]) => day)
        .filter((day) => day.ladder !== null && day.ladder.leader !== null);
      if (dayEntries.length === 0) continue;

      // 全市场近似：当日所有 Top20 板块的涨停成员等权
      const marketMembers = [...new Set(dayEntries.flatMap((day) => (day.ladder?.firstBoard ?? []).map((item) => item.symbol).concat((day.ladder?.frontRow ?? []).map((item) => item.symbol)).concat(day.ladder?.leader ? [day.ladder.leader.symbol] : [])))];
      const marketRet = await t1Return(date, marketMembers);
      if (marketRet !== null) marketSamples.push({ date, code: '*', name: '全市场近似', tier: 'market', score: 0, ret: marketRet.value });

      const naive = [...dayEntries].sort((a, b) => b.limitUpCount - a.limitUpCount).slice(0, 3);
      for (const day of naive) {
        const members = [
          ...(day.ladder?.leader ? [day.ladder.leader.symbol] : []),
          ...(day.ladder?.frontRow ?? []).map((item) => item.symbol),
          ...(day.ladder?.firstBoard ?? []).map((item) => item.symbol),
        ];
        const ret = await t1Return(date, members);
        if (ret !== null) naiveSamples.push({ date, code: day.code, name: day.name, tier: 'naive', score: day.judge?.total ?? 0, ret: ret.value });
      }

      for (const day of dayEntries) {
        const members = [
          ...(day.ladder?.leader ? [day.ladder.leader.symbol] : []),
          ...(day.ladder?.frontRow ?? []).map((item) => item.symbol),
          ...(day.ladder?.firstBoard ?? []).map((item) => item.symbol),
        ];
        const ret = await t1Return(date, members);
        if (ret === null) continue;
        samples.push({
          date,
          code: day.code,
          name: day.name,
          tier: day.judge?.tier ?? 'unknown',
          score: day.judge?.total ?? 0,
          ret: ret.value,
        });
      }
    }

    // ---- 统计 ----
    const report: string[] = [];
    const line = (text: string): void => {
      console.log(text);
      report.push(text);
    };

    line(`\n=== 样本量 ===`);
    line(`  板块样本 ${samples.length}  朴素口径 ${naiveSamples.length}  全市场近似 ${marketSamples.length}`);
    line(`  个股日K 缓存 ${stockKlineCache.size} 只`);

    const tierOrder = ['mainline', 'candidate', 'branch', 'one_day'];
    const tierLabel: Record<string, string> = {
      mainline: '市场主线(≥10)',
      candidate: '候选(7~9)',
      branch: '支线(4~6)',
      one_day: '一日游(≤3)',
    };

    const marketAvg = mean(marketSamples.map((item) => item.ret));
    const naiveAvg = mean(naiveSamples.map((item) => item.ret));

    line(`\n=== T+1 日内收益（次日开盘买 → 次日收盘卖，成员等权）===`);
    line(`  基准           样本   均值      超额(vs全市场)  t值    胜率`);
    line(
      `  全市场近似     ${String(marketSamples.length).padStart(5)}  ${fmtPct(marketAvg).padStart(8)}  ${fmtPct(0).padStart(12)}  ${fmtT(tStat(marketSamples.map((i) => i.ret))).padStart(6)}  ${fmtPct(mean(marketSamples.map((i) => (i.ret > 0 ? 1 : 0))))}`,
    );
    line(
      `  涨停家数前三   ${String(naiveSamples.length).padStart(5)}  ${fmtPct(naiveAvg).padStart(8)}  ${fmtPct(naiveAvg !== null && marketAvg !== null ? naiveAvg - marketAvg : null).padStart(12)}  ${fmtT(tStat(naiveSamples.map((i) => i.ret))).padStart(6)}  ${fmtPct(mean(naiveSamples.map((i) => (i.ret > 0 ? 1 : 0))))}`,
    );

    line(`\n=== 按评分分档 ===`);
    line(`  分档              样本   均值      超额(vs全市场)  t值    胜率`);
    for (const tier of tierOrder) {
      const group = samples.filter((item) => item.tier === tier);
      if (group.length === 0) {
        line(`  ${tierLabel[tier].padEnd(14)} ${String(0).padStart(5)}  （无样本）`);
        continue;
      }
      const avg = mean(group.map((item) => item.ret));
      line(
        `  ${tierLabel[tier].padEnd(14)} ${String(group.length).padStart(5)}  ${fmtPct(avg).padStart(8)}  ` +
          `${fmtPct(avg !== null && marketAvg !== null ? avg - marketAvg : null).padStart(12)}  ` +
          `${fmtT(tStat(group.map((i) => i.ret))).padStart(6)}  ${fmtPct(mean(group.map((i) => (i.ret > 0 ? 1 : 0))))}`,
      );
    }

    // ---- 消融：逐项去掉一个条件，看分数是否还有区分度 ----
    line(`\n=== 消融：按「去掉某一项后的分数」重新分档，看主线圈层的收益是否还在 ===`);
    const ablationKeys = [
      'limitUpTop3',
      'marketHeightBoard',
      'coreTroop',
      'amountTop5',
      'streak3',
      'capitalReturn',
      'fullLadder',
    ];
    line(`  去掉的条件          主线档样本  主线档均值   对比全市场超额   t值`);
    for (const key of ablationKeys) {
      const rescored = samples.map((item) => {
        const day = byDate.get(`${item.date}|${item.code}`);
        const removed = day?.judge?.conditions.find((condition) => condition.key === key);
        const delta = removed?.score ?? 0;
        const total = item.score - delta;
        const tier = total >= 10 ? 'mainline' : total >= 7 ? 'candidate' : total >= 4 ? 'branch' : 'one_day';
        return { ...item, total, tier };
      });
      const group = rescored.filter((item) => item.tier === 'mainline');
      const avg = mean(group.map((item) => item.ret));
      line(
        `  ${key.padEnd(18)} ${String(group.length).padStart(9)}  ${fmtPct(avg).padStart(9)}  ` +
          `${fmtPct(avg !== null && marketAvg !== null ? avg - marketAvg : null).padStart(13)}  ${fmtT(tStat(group.map((i) => i.ret))).padStart(6)}`,
      );
    }

    // 落盘
    const outDir = path.resolve(process.cwd(), 'scripts', 'output');
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'mainline-backtest.log');
    writeFileSync(outFile, report.join('\n'), 'utf8');
    console.log(`\n结果已写入 ${outFile}`);

    expect(samples.length).toBeGreaterThan(0);
  }, 1_800_000);
});
