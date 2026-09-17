/**
 * 「最近几天K线 → 明天后天会不会涨」信号研究
 *
 * 与上一版（watch-signal-lab）的区别：
 * 1. 目标从「次日」扩到 T+1 / T+2 / T+3，因为用户要的是「明天后天有没有涨幅」
 * 2. 条件从「买强」换成「择时」：回调、缩量、均线支撑、平台整理、涨停后回踩
 * 3. 每个条件都看训练段/验证段是否同时为正，避免挑出噪声
 *
 * 用法：npx tsx scripts/watch-timing-lab.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

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

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const limitPctOf = (symbol: string): number =>
  symbol.startsWith('688') || symbol.startsWith('30') ? 20 : symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92') ? 30 : 10;

type Row = {
  date: string;
  symbol: string;
  ret1: number;
  drawdown20: number;
  ret3: number;
  ret5: number;
  ret10: number;
  volRatio: number;
  turnover: number;
  distMa10: number;
  distMa20: number;
  distMa60: number;
  range10: number;
  excess20: number;
  hadLimitUp3: boolean;
  isLimitUp: boolean;
  isUp: boolean;
  lowerShadow: number;
  fwd1: number;
  fwd2: number;
  fwd3: number;
};

const rows: Row[] = [];

for (const file of readdirSync(CACHE_DIR).filter((name) => name.startsWith('sina-k-'))) {
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
  if (bars.length < 90) continue;

  const shares = floatShares.get(symbol) ?? null;
  const limit = limitPctOf(symbol);

  for (let i = 65; i < bars.length - 3; i += 1) {
    const bar = bars[i];
    const previous = bars[i - 1];
    if (previous.close <= 0 || bar.close <= 0) continue;

    const maxMove = limit + 1.5;
    const fwd1 = (bars[i + 1].close / bar.close - 1) * 100;
    const fwd2 = (bars[i + 2].close / bar.close - 1) * 100;
    const fwd3 = (bars[i + 3].close / bar.close - 1) * 100;
    if (Math.abs(fwd1) > maxMove || Math.abs(fwd2) > maxMove * 2 || Math.abs(fwd3) > maxMove * 3) continue;

    const closes = bars.map((b) => b.close);
    const high20 = Math.max(...bars.slice(i - 19, i + 1).map((b) => b.high));
    const range = bar.high - bar.low;
    const ma10 = mean(closes.slice(i - 9, i + 1));
    const ma20 = mean(closes.slice(i - 19, i + 1));
    const ma60 = mean(closes.slice(i - 59, i + 1));
    const previous5 = bars.slice(i - 5, i).map((b) => b.volume);

    rows.push({
      date: bar.date,
      symbol,
      ret1: (bar.close / previous.close - 1) * 100,
      drawdown20: (bar.close / high20 - 1) * 100,
      ret3: (bar.close / bars[i - 3].close - 1) * 100,
      ret5: (bar.close / bars[i - 5].close - 1) * 100,
      ret10: (bar.close / bars[i - 10].close - 1) * 100,
      volRatio: mean(previous5) > 0 ? bar.volume / mean(previous5) : 1,
      turnover: shares && shares > 0 ? (bar.volume / shares) * 100 : 0,
      distMa10: (bar.close / ma10 - 1) * 100,
      distMa20: (bar.close / ma20 - 1) * 100,
      distMa60: (bar.close / ma60 - 1) * 100,
      range10: ((Math.max(...bars.slice(i - 9, i + 1).map((b) => b.high)) / Math.min(...bars.slice(i - 9, i + 1).map((b) => b.low)) - 1) * 100),
      excess20: (bar.close / bars[i - 20].close - 1) * 100,
      hadLimitUp3: bars.slice(i - 3, i).some((b, index) => {
        const dayIndex = i - 3 + index;
        const prev = bars[dayIndex - 1];
        return prev && prev.close > 0 && b.close >= Math.round(prev.close * (1 + limit / 100) * 100) / 100 - 0.001;
      }),
      isLimitUp: bar.close >= Math.round(previous.close * (1 + limit / 100) * 100) / 100 - 0.001,
      isUp: bar.close > previous.close,
      lowerShadow: range > 0 ? ((Math.min(bar.open, bar.close) - bar.low) / range) * 100 : 0,
      fwd1,
      fwd2,
      fwd3,
    });
  }
}

const totalByDay = new Map<string, number>();
for (const row of rows) totalByDay.set(row.date, (totalByDay.get(row.date) ?? 0) + 1);
const validDates = new Set([...totalByDay.entries()].filter(([, c]) => c >= 2000).map(([d]) => d));

const dayEqual = (set: Row[], key: keyof Row) => {
  const byDay = new Map<string, number[]>();
  for (const row of set) {
    if (!validDates.has(row.date)) continue;
    const list = byDay.get(row.date) ?? [];
    list.push(row[key] as number);
    byDay.set(row.date, list);
  }
  const means = [...byDay.values()].filter((v) => v.length >= 5).map(mean);
  const avg = mean(means);
  const sd = Math.sqrt(means.reduce((t, v) => t + (v - avg) ** 2, 0) / Math.max(1, means.length - 1));
  return { mean: avg, days: means.length, t: sd > 0 ? avg / (sd / Math.sqrt(means.length)) : 0 };
};

const dates = [...new Set(rows.map((r) => r.date))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];

console.log(`样本 ${rows.length} 条，${validDates.size} 个交易日（${dates[0]} ~ ${dates.at(-1)}）`);
console.log(`训练段 <${cut}，验证段 ≥${cut}\n`);
const base1 = dayEqual(rows, 'fwd1');
const base2 = dayEqual(rows, 'fwd2');
const base3 = dayEqual(rows, 'fwd3');
console.log(`全市场基准：T+1 ${base1.mean.toFixed(2)}% | T+2 ${base2.mean.toFixed(2)}% | T+3 ${base3.mean.toFixed(2)}%\n`);

type Cond = [string, (row: Row) => boolean];
const conditions: Cond[] = [
  ['回调到 20 日高点 -5%~-15%', (r) => r.drawdown20 <= -5 && r.drawdown20 >= -15],
  ['回调到 20 日高点 -15%~-30%', (r) => r.drawdown20 < -15 && r.drawdown20 >= -30],
  ['深度回调 <-30%', (r) => r.drawdown20 < -30],
  ['贴近 20 日高点 >-3%', (r) => r.drawdown20 > -3],
  ['5 日跌 3%~10%', (r) => r.ret5 <= -3 && r.ret5 >= -10],
  ['10 日跌 5%~15%', (r) => r.ret10 <= -5 && r.ret10 >= -15],
  ['缩量（量比<0.8）', (r) => r.volRatio < 0.8],
  ['放量（量比>1.5）', (r) => r.volRatio > 1.5],
  ['回调 + 缩量', (r) => r.drawdown20 <= -8 && r.volRatio < 0.85],
  ['回踩 MA20（-3%~+3%）', (r) => Math.abs(r.distMa20) <= 3],
  ['贴近 MA10（-2%~+2%）', (r) => Math.abs(r.distMa10) <= 2],
  ['站上 MA20 且 MA20 向上', (r) => r.distMa20 > 0 && r.distMa60 > 0],
  ['10 日振幅 <8%（平台整理）', (r) => r.range10 < 8],
  ['平台整理 + 缩量', (r) => r.range10 < 10 && r.volRatio < 0.8],
  ['3 日内有涨停 且 今日缩量', (r) => r.hadLimitUp3 && r.volRatio < 0.9],
  ['3 日内有涨停 且 今日回调', (r) => r.hadLimitUp3 && r.ret1 < 0],
  ['今日收阳', (r) => r.isUp],
  ['今日长下影（>40%）', (r) => r.lowerShadow > 40],
  ['今日缩量收阴', (r) => !r.isUp && r.volRatio < 0.8],
  ['换手 3%~10%', (r) => r.turnover >= 3 && r.turnover <= 10],
  ['换手 <2%（冷清）', (r) => r.turnover > 0 && r.turnover < 2],
  ['20 日跑输大盘 10% 以上', (r) => r.excess20 < 0],
];

console.log('条件                              n      T+1               T+2               T+3');
for (const [label, pick] of conditions) {
  const set = rows.filter(pick);
  if (set.length < 300) {
    console.log(`${label.padEnd(32)} 样本不足`);
    continue;
  }
  const cells: string[] = [];
  for (const key of ['fwd1', 'fwd2', 'fwd3'] as Array<keyof Row>) {
    const all = dayEqual(set, key);
    const train = dayEqual(set.filter((r) => r.date < cut), key);
    const test = dayEqual(set.filter((r) => r.date >= cut), key);
    cells.push(`${all.mean.toFixed(2).padStart(6)}%(${all.t.toFixed(1).padStart(5)}) ${train.mean >= 0 && test.mean >= 0 ? '✓' : ' '}`);
  }
  console.log(`${label.padEnd(32)} ${String(set.length).padStart(6)}  ${cells.join('  ')}`);
}
console.log('\n括号内为 t 值；✓ 表示训练段与验证段同时为正');
