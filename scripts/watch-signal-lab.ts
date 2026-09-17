/**
 * 「观察」板块买入判定的信号验证
 *
 * 口径：尾盘做判定、尾盘价买入（用当日收盘价代理），隔日卖出。
 * 样本：全市场 5536 只 × 140 个交易日（用本地已缓存的日K，不再打上游）。
 *
 * 目标：把每个候选条件单独检验一遍，只保留真正有区分度的，再定权重与阈值。
 *
 * 用法：npx tsx scripts/watch-signal-lab.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

const toSinaSymbol = (symbol: string): string =>
  symbol.startsWith('6') ? `sh${symbol}` : symbol.startsWith('0') || symbol.startsWith('3') ? `sz${symbol}` : `bj${symbol}`;

// ---------- 1. 流通股本（用于换手率） ----------
const floatShares = new Map<string, number>();
for (const file of readdirSync(CACHE_DIR).filter((name) => name.startsWith('universe-'))) {
  const rows = readJson(path.join(CACHE_DIR, file));
  if (!Array.isArray(rows)) continue;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const code = String(record.code ?? '');
    const nmc = Number(record.nmc);
    const trade = Number(record.trade);
    if (/^\d{6}$/.test(code) && Number.isFinite(nmc) && Number.isFinite(trade) && trade > 0) {
      floatShares.set(code, (nmc * 10_000) / trade);
    }
  }
}

// ---------- 2. 市场环境（按交易日） ----------
type DayInfo = { indexPct: number | null; limitCount: number; brokenCount: number; brokenRatio: number };
const dayInfo = new Map<string, DayInfo>();
{
  const history = readJson(path.join(process.cwd(), 'scripts/output/limit-up-history.json')) as {
    days: Array<{ date: string; indexPct: number | null; limitUpCount: number; brokenCount: number }>;
  };
  for (const day of history.days) {
    const total = day.limitUpCount + day.brokenCount;
    dayInfo.set(day.date, {
      indexPct: day.indexPct,
      limitCount: day.limitUpCount,
      brokenCount: day.brokenCount,
      brokenRatio: total > 0 ? (day.brokenCount / total) * 100 : 0,
    });
  }
}

// ---------- 3. 逐只算特征与未来收益 ----------
type Row = {
  date: string;
  symbol: string;
  ret1: number;
  gap: number;
  closePos: number;
  distMa20: number;
  bullStack: boolean;
  aboveMa20: boolean;
  distHigh60: number;
  pct20: number;
  pct5: number;
  downStreak: number;
  distMa20Abs: number;
  volRatio: number;
  turnover: number;
  isLimitUp: boolean;
  fwdOpen1: number;
  fwdClose1: number;
  fwdClose2: number;
};

const limitPctOf = (symbol: string): number =>
  symbol.startsWith('688') || symbol.startsWith('30') ? 20 : symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92') ? 30 : 10;

const legacyLimitPctOf = (symbol: string, name: string): number =>
  /st|\*st/i.test(name) ? 5 : symbol.startsWith('688') || symbol.startsWith('30') ? 20 : symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92') ? 30 : 10;

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

const rows: Row[] = [];
const files = readdirSync(CACHE_DIR).filter((name) => name.startsWith('sina-k-'));

for (const file of files) {
  const symbol = file.slice(7, 13);
  let bars: Bar[];
  try {
    const parsed = readJson(path.join(CACHE_DIR, file));
    if (!Array.isArray(parsed)) continue;
    bars = (parsed as Array<Record<string, unknown>>).map((raw) => ({
      date: String(raw.day ?? '').replaceAll('-', ''),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume),
    }));
  } catch {
    continue;
  }
  if (bars.length < 80) continue;

  const shares = floatShares.get(symbol) ?? null;
  const limit = limitPctOf(symbol);
  // 单日涨跌幅不可能超过板块涨停幅度；超出说明是不复权/脏数据，直接丢弃该行
  const maxMove = limit + 1.5;

  for (let i = 61; i < bars.length - 2; i += 1) {
    const bar = bars[i];
    const previous = bars[i - 1];
    if (previous.close <= 0 || bar.close <= 0) continue;

    const ma5 = mean(bars.slice(i - 4, i + 1).map((b) => b.close));
    const ma10 = mean(bars.slice(i - 9, i + 1).map((b) => b.close));
    const ma20 = mean(bars.slice(i - 19, i + 1).map((b) => b.close));
    const high60 = Math.max(...bars.slice(i - 59, i + 1).map((b) => b.high));
    const range = bar.high - bar.low;
    const forward1 = (bars[i + 1].close / bar.close - 1) * 100;
    const forwardOpen = (bars[i + 1].open / bar.close - 1) * 100;
    const forward2 = (bars[i + 2].close / bar.close - 1) * 100;
    if (Math.abs(forward1) > maxMove || Math.abs(forwardOpen) > maxMove || Math.abs(forward2) > maxMove * 2) {
      continue;
    }

    rows.push({
      date: bar.date,
      symbol,
      ret1: (bar.close / previous.close - 1) * 100,
      gap: (bar.open / previous.close - 1) * 100,
      closePos: range > 0 ? (bar.close - bar.low) / range : 0.5,
      distMa20: (bar.close / ma20 - 1) * 100,
      bullStack: ma5 > ma10 && ma10 > ma20,
      aboveMa20: bar.close > ma20,
      distHigh60: (bar.close / high60 - 1) * 100,
      pct20: (bar.close / bars[i - 20].close - 1) * 100,
      pct5: (bar.close / bars[i - 5].close - 1) * 100,
      downStreak: (() => {
        let streak = 0;
        for (let k = i; k > i - 6 && k > 0; k -= 1) {
          if (bars[k].close < bars[k - 1].close) streak += 1;
          else break;
        }
        return streak;
      })(),
      distMa20Abs: (bar.close / ma20 - 1) * 100,
      volRatio: mean(bars.slice(i - 5, i).map((b) => b.volume)) > 0 ? bar.volume / mean(bars.slice(i - 5, i).map((b) => b.volume)) : 1,
      turnover: shares && shares > 0 ? (bar.volume / shares) * 100 : 0,
      isLimitUp: bar.close >= Math.round(previous.close * (1 + limit / 100) * 100) / 100 - 0.001,
      fwdOpen1: forwardOpen,
      fwdClose1: forward1,
      fwdClose2: forward2,
    });
  }
}

console.log(`样本 ${rows.length} 条，覆盖 ${new Set(rows.map((r) => r.date)).size} 个交易日\n`);

// ---------- 4. 评估工具 ----------
/**
 * 只在「真实交易日」上做日等权聚合：某些日期只有个位数样本（停牌/脏数据），
 * 它们会把日等权均值整体带偏（修之前基准被拉到 -0.64%，真实是 -0.12%）。
 */
const totalByDay = new Map<string, number>();
for (const row of rows) {
  totalByDay.set(row.date, (totalByDay.get(row.date) ?? 0) + 1);
}
const validDates = new Set(
  [...totalByDay.entries()].filter(([, count]) => count >= 2000).map(([date]) => date),
);
/** 子集在单个交易日至少要有这么多只票，才计入 */
const MIN_SUBSET_PER_DAY = 5;

const dayEqual = (set: Row[], key: keyof Row) => {
  const byDay = new Map<string, number[]>();
  for (const row of set) {
    if (!validDates.has(row.date)) continue;
    const list = byDay.get(row.date) ?? [];
    list.push(row[key] as number);
    byDay.set(row.date, list);
  }
  const means = [...byDay.values()].filter((values) => values.length >= MIN_SUBSET_PER_DAY).map(mean);
  const avg = mean(means);
  const sd = Math.sqrt(means.reduce((t, v) => t + (v - avg) ** 2, 0) / Math.max(1, means.length - 1));
  return { mean: avg, days: means.length, t: sd > 0 ? avg / (sd / Math.sqrt(means.length)) : 0 };
};

const baseline = dayEqual(rows, 'fwdClose1');
console.log(`基准（全部样本，尾盘买次日收盘卖）：${baseline.mean.toFixed(2)}%  t=${baseline.t.toFixed(2)}  天数=${baseline.days}`);
console.log('（同期上证/全市场整体是走平略跌，所以基准为负）\n');

const conditions: Array<[string, (row: Row) => boolean]> = [
  ['均线多头 MA5>MA10>MA20', (r) => r.bullStack],
  ['跌破 MA20（现价<MA20）', (r) => !r.aboveMa20],
  ['站上 MA20', (r) => r.aboveMa20],
  ['距 60 日高点 ≤5%', (r) => r.distHigh60 >= -5],
  ['距 60 日高点 ≥25%（深跌）', (r) => r.distHigh60 <= -25],
  ['20 日涨幅 0~25%', (r) => r.pct20 >= 0 && r.pct20 <= 25],
  ['20 日涨幅 >40%', (r) => r.pct20 > 40],
  ['量比 ≥1.2', (r) => r.volRatio >= 1.2],
  ['量比 ≥2', (r) => r.volRatio >= 2],
  ['量比 <0.8（缩量）', (r) => r.volRatio < 0.8],
  ['换手 3%~15%', (r) => r.turnover >= 3 && r.turnover <= 15],
  ['换手 >25%', (r) => r.turnover > 25],
  ['今日红盘 ret1>0', (r) => r.ret1 > 0],
  ['今日跌超 3%', (r) => r.ret1 < -3],
  ['收在当日振幅上 1/3', (r) => r.closePos >= 0.67],
  ['收在当日振幅下 1/3', (r) => r.closePos <= 0.33],
  ['开盘溢价 ≤3%', (r) => r.gap <= 3],
  ['高开 ≥5%', (r) => r.gap >= 5],
  ['低开 <-2%', (r) => r.gap < -2],
  ['今日未涨停', (r) => !r.isLimitUp],
  ['今日涨停', (r) => r.isLimitUp],
  ['今日涨停 且 首板', (r) => r.isLimitUp && r.pct20 < 15],
  ['5 日跌幅 >10%', (r) => r.pct5 < -10],
  ['5 日涨幅 >15%', (r) => r.pct5 > 15],
  ['20 日跌幅 >20%', (r) => r.pct20 < -20],
  ['连跌 ≥3 天', (r) => r.downStreak >= 3],
  ['低于 MA20 超 10%', (r) => r.distMa20Abs < -10],
  ['高于 MA20 超 15%', (r) => r.distMa20Abs > 15],
  ['今日大跌 3~8%', (r) => r.ret1 < -3 && r.ret1 > -8],
  ['缩量下跌', (r) => r.ret1 < 0 && r.volRatio < 0.8],
];

console.log('单个条件（尾盘买、次日收盘卖）');
console.log('条件                          样本     平均收益    t      胜率    与基准差');
for (const [label, pick] of conditions) {
  const set = rows.filter(pick);
  if (set.length < 200) {
    console.log(`${label.padEnd(28)} 样本不足`);
    continue;
  }
  const stat = dayEqual(set, 'fwdClose1');
  const win = (set.filter((r) => r.fwdClose1 > 0).length / set.length) * 100;
  console.log(
    `${label.padEnd(28)} ${String(set.length).padStart(7)}  ${stat.mean.toFixed(2).padStart(8)}%  ${stat.t.toFixed(2).padStart(6)}  ${win.toFixed(1).padStart(5)}%  ${(stat.mean - baseline.mean).toFixed(2).padStart(6)}%`,
  );
}

console.log('\n交互检验：条件之间会不会互相抵消');
for (const [label, pick] of [
  ['涨停 且 偏离MA20<=15%', (r: Row) => r.isLimitUp && r.distMa20Abs <= 15],
  ['涨停 且 偏离MA20>15%', (r: Row) => r.isLimitUp && r.distMa20Abs > 15],
  ['涨停 且 缺口<=-2%', (r: Row) => r.isLimitUp && r.gap <= -2],
  ['涨停 且 换手>25%', (r: Row) => r.isLimitUp && r.turnover > 25],
  ['涨停 且 量比>=2', (r: Row) => r.isLimitUp && r.volRatio >= 2],
  ['涨停 且 20日涨幅>40%', (r: Row) => r.isLimitUp && r.pct20 > 40],
  ['偏离MA20>15% 但未涨停', (r: Row) => !r.isLimitUp && r.distMa20Abs > 15],
  ['偏离MA20>15% 全样本', (r: Row) => r.distMa20Abs > 15],
  ['低开<=-2% 但未涨停', (r: Row) => !r.isLimitUp && r.gap <= -2],
  ['换手>25% 但未涨停', (r: Row) => !r.isLimitUp && r.turnover > 25],
  ['放量下跌 但未涨停', (r: Row) => !r.isLimitUp && r.volRatio >= 2 && r.ret1 < 0],
  ['当日跌超3% 但未涨停', (r: Row) => !r.isLimitUp && r.ret1 < -3],
] as Array<[string, (row: Row) => boolean]>) {
  const set = rows.filter(pick);
  if (set.length < 100) {
    console.log(`  ${label.padEnd(26)} 样本不足 (${set.length})`);
    continue;
  }
  const stat = dayEqual(set, 'fwdClose1');
  const win = (set.filter((r) => r.fwdClose1 > 0).length / set.length) * 100;
  console.log(`  ${label.padEnd(26)} n=${String(set.length).padStart(6)}  平均 ${stat.mean.toFixed(2).padStart(6)}%  t=${stat.t.toFixed(2).padStart(6)}  胜率 ${win.toFixed(1)}%`);
}

// ---------- 5. 组合打分 ----------
const score = (r: Row): number => {
  let total = 0;
  if (r.bullStack) total += 2;
  if (r.aboveMa20) total += 1;
  if (r.distHigh60 >= -5) total += 1;
  if (r.distHigh60 <= -25) total -= 1;
  if (r.pct20 >= 0 && r.pct20 <= 25) total += 1;
  if (r.pct20 > 40) total -= 1;
  if (r.volRatio >= 1.2) total += 1;
  if (r.volRatio >= 2) total += 1;
  if (r.turnover >= 3 && r.turnover <= 15) total += 1;
  if (r.ret1 > 0) total += 1;
  if (r.closePos >= 0.67) total += 1;
  if (r.gap >= 5) total -= 1;
  return total;
};

const veto = (r: Row): boolean => {
  const day = dayInfo.get(r.date);
  if (!r.aboveMa20 && !r.bullStack) return true;
  if (r.isLimitUp) return true;
  if (day && day.indexPct !== null && day.indexPct < -1.5) return true;
  return false;
};

console.log('\n组合打分分档（尾盘买、次日收盘卖）');
console.log('分数区间        样本     平均收益    t      胜率   被否决占比');
for (const [lo, hi] of [[0, 3], [3, 5], [5, 7], [7, 9], [9, 20]] as Array<[number, number]>) {
  const set = rows.filter((r) => !veto(r) && score(r) >= lo && score(r) < hi);
  if (set.length < 100) {
    console.log(`${lo}~${hi} 分        样本不足`);
    continue;
  }
  const stat = dayEqual(set, 'fwdClose1');
  const win = (set.filter((r) => r.fwdClose1 > 0).length / set.length) * 100;
  const vetoed = (rows.filter((r) => score(r) >= lo && score(r) < hi && veto(r)).length / rows.filter((r) => score(r) >= lo && score(r) < hi).length) * 100;
  console.log(
    `${String(lo) + '~' + String(hi)} 分`.padEnd(14) + `${String(set.length).padStart(7)}  ${stat.mean.toFixed(2).padStart(8)}%  ${stat.t.toFixed(2).padStart(6)}  ${win.toFixed(1).padStart(5)}%  ${vetoed.toFixed(1).padStart(6)}%`,
  );
}

console.log('\n不同卖出方式（≥9 分且未被否决）');
{
  const set = rows.filter((r) => !veto(r) && score(r) >= 9);
  for (const key of ['fwdOpen1', 'fwdClose1', 'fwdClose2'] as Array<keyof Row>) {
    const stat = dayEqual(set, key);
    const win = (set.filter((r) => (r[key] as number) > 0).length / set.length) * 100;
    console.log(`  ${String(key).padEnd(11)} 平均 ${stat.mean.toFixed(2).padStart(6)}%  t=${stat.t.toFixed(2).padStart(6)}  胜率 ${win.toFixed(1)}%  样本 ${set.length}`);
  }
}

// ---------- 6. 时间稳定性 ----------
console.log('\n时间稳定性（≥9 分且未被否决，次日收盘卖）');
{
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const cut = dates[Math.floor(dates.length * 0.7)];
  for (const [label, set] of [
    [`训练段 <${cut}`, rows.filter((r) => r.date < cut)],
    [`验证段 ≥${cut}`, rows.filter((r) => r.date >= cut)],
  ] as Array<[string, Row[]]>) {
    const picked = set.filter((r) => !veto(r) && score(r) >= 9);
    if (picked.length < 50) {
      console.log(`  ${label} 样本不足`);
      continue;
    }
    const stat = dayEqual(picked, 'fwdClose1');
    const win = (picked.filter((r) => r.fwdClose1 > 0).length / picked.length) * 100;
    console.log(`  ${label}  n=${String(picked.length).padStart(5)}  平均 ${stat.mean.toFixed(2).padStart(6)}%  t=${stat.t.toFixed(2).padStart(6)}  胜率 ${win.toFixed(1)}%`);
  }
}
