/**
 * 补两组检验：
 * A. 还没试过的横截面因子（市值 / 价格 / 波动率 / 中长期动量）
 * B. 市场择时：日级环境指标能不能预测未来 1~3 天全市场收益
 * C. 综合排序：把「无负期望形态 + 低换手 + 贴近均线」做成排序，看头部表现
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const limitPctOf = (symbol: string): number =>
  symbol.startsWith('688') || symbol.startsWith('30') ? 20 : symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92') ? 30 : 10;

const floatShares = new Map<string, number>();
for (const file of readdirSync(CACHE_DIR).filter((n) => n.startsWith('universe-'))) {
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

type Row = {
  date: string; symbol: string; price: number; floatCap: number; turnover: number;
  vol20: number; mom20: number; mom60: number; volRatio20: number; distMa20: number;
  hadLimitUp3: boolean; isLimitUp: boolean; fwd1: number; fwd2: number; fwd3: number;
};
const rows: Row[] = [];

for (const file of readdirSync(CACHE_DIR).filter((n) => n.startsWith('sina-k-'))) {
  const symbol = file.slice(7, 13);
  let bars: Bar[];
  try {
    const parsed = readJson(path.join(CACHE_DIR, file));
    if (!Array.isArray(parsed)) continue;
    bars = (parsed as Array<Record<string, unknown>>).map((raw) => ({
      date: String(raw.day ?? '').replaceAll('-', ''),
      open: Number(raw.open), high: Number(raw.high), low: Number(raw.low),
      close: Number(raw.close), volume: Number(raw.volume),
    }));
  } catch { continue; }
  if (bars.length < 90) continue;
  const shares = floatShares.get(symbol) ?? null;
  const limit = limitPctOf(symbol);
  const closes = bars.map((b) => b.close);

  for (let i = 65; i < bars.length - 3; i += 1) {
    const bar = bars[i]; const prev = bars[i - 1];
    if (prev.close <= 0 || bar.close <= 0) continue;
    const maxMove = limit + 1.5;
    const fwd1 = (bars[i + 1].close / bar.close - 1) * 100;
    const fwd2 = (bars[i + 2].close / bar.close - 1) * 100;
    const fwd3 = (bars[i + 3].close / bar.close - 1) * 100;
    if (Math.abs(fwd1) > maxMove || Math.abs(fwd2) > maxMove * 2 || Math.abs(fwd3) > maxMove * 3) continue;

    const returns20 = closes.slice(i - 19, i + 1).map((c, idx, arr) => (idx === 0 ? 0 : (c / arr[idx - 1] - 1) * 100)).slice(1);
    const sd = Math.sqrt(returns20.reduce((t, v) => t + (v - mean(returns20)) ** 2, 0) / returns20.length);
    const hadLimitUp3 = bars.slice(i - 3, i).some((b, idx) => {
      const dayIndex = i - 3 + idx; const p = bars[dayIndex - 1];
      return p && p.close > 0 && b.close >= Math.round(p.close * (1 + limit / 100) * 100) / 100 - 0.001;
    });

    rows.push({
      date: bar.date, symbol, price: bar.close,
      floatCap: shares ? (shares * bar.close) / 100_000_000 : 0,
      turnover: shares && shares > 0 ? (bar.volume / shares) * 100 : 0,
      vol20: sd,
      mom20: (bar.close / closes[i - 20] - 1) * 100,
      mom60: (bar.close / closes[i - 60] - 1) * 100,
      volRatio20: mean(bars.slice(i - 20, i).map((b) => b.volume)) > 0 ? bar.volume / mean(bars.slice(i - 20, i).map((b) => b.volume)) : 1,
      distMa20: (bar.close / mean(closes.slice(i - 19, i + 1)) - 1) * 100,
      hadLimitUp3,
      isLimitUp: bar.close >= Math.round(prev.close * (1 + limit / 100) * 100) / 100 - 0.001,
      fwd1, fwd2, fwd3,
    });
  }
}

const totalByDay = new Map<string, number>();
for (const r of rows) totalByDay.set(r.date, (totalByDay.get(r.date) ?? 0) + 1);
const validDates = new Set([...totalByDay.entries()].filter(([, c]) => c >= 2000).map(([d]) => d));

const dayEqual = (set: Row[], key: keyof Row) => {
  const byDay = new Map<string, number[]>();
  for (const row of set) {
    if (!validDates.has(row.date)) continue;
    const list = byDay.get(row.date) ?? []; list.push(row[key] as number); byDay.set(row.date, list);
  }
  const means = [...byDay.values()].filter((v) => v.length >= 5).map(mean);
  const avg = mean(means);
  const sd = Math.sqrt(means.reduce((t, v) => t + (v - avg) ** 2, 0) / Math.max(1, means.length - 1));
  return { mean: avg, days: means.length, t: sd > 0 ? avg / (sd / Math.sqrt(means.length)) : 0 };
};

const dates = [...new Set(rows.map((r) => r.date))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];
const q = (set: Row[], key: keyof Row, lo: number, hi: number) => {
  const values = set.map((r) => r[key] as number).sort((a, b) => a - b);
  return [values[Math.floor(values.length * lo)], values[Math.floor(values.length * hi)]];
};

console.log(`样本 ${rows.length}，${validDates.size} 个交易日`);
console.log(`基准 T+1 ${dayEqual(rows, 'fwd1').mean.toFixed(2)}% | T+2 ${dayEqual(rows, 'fwd2').mean.toFixed(2)}% | T+3 ${dayEqual(rows, 'fwd3').mean.toFixed(2)}%\n`);

console.log('=== A. 分位数检验（每组取 20% 分位，五档）===');
for (const [key, label] of [['floatCap', '流通市值(亿)'], ['price', '股价'], ['vol20', '20日波动率'], ['mom20', '20日动量'], ['mom60', '60日动量'], ['turnover', '换手率']] as Array<[keyof Row, string]>) {
  const values = rows.map((r) => r[key] as number).filter((v) => Number.isFinite(v) && v > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => sorted[Math.floor(sorted.length * p)]);
  const cells: string[] = [];
  for (let band = 0; band < 5; band += 1) {
    const lo = band === 0 ? -Infinity : cuts[band - 1];
    const hi = band === 4 ? Infinity : cuts[band];
    const set = rows.filter((r) => (r[key] as number) > lo && (r[key] as number) <= hi);
    const stat = dayEqual(set, 'fwd3');
    cells.push(`${stat.mean >= 0 ? '+' : ''}${stat.mean.toFixed(2)}(${stat.t.toFixed(1)})`);
  }
  console.log(`${label.padEnd(14)} 低→高: ${cells.join('  ')}   [T+3，括号为 t]`);
}

console.log('\n=== B. 市场择时（日级环境 → 次日/次3日全市场等权收益）===');
{
  const byDay = new Map<string, Row[]>();
  for (const r of rows) { const l = byDay.get(r.date) ?? []; l.push(r); byDay.set(r.date, l); }
  const daySeries = dates.filter((d) => validDates.has(d)).map((d) => {
    const set = byDay.get(d) as Row[];
    return {
      date: d,
      mkt1: mean(set.map((r) => r.fwd1)),
      mkt3: mean(set.map((r) => r.fwd3)),
      limitCount: set.filter((r) => r.isLimitUp).length,
      brokenRate: set.filter((r) => r.high / r.close - 1 > 0.05 && !r.isLimitUp).length / Math.max(1, set.length),
      upRatio: set.filter((r) => r.price > 0).length,
      avgTurnover: mean(set.map((r) => r.turnover)),
    };
  });
  const dc = daySeries[Math.floor(daySeries.length * 0.7)]?.date ?? '';
  const probe = (label: string, pick: (d: typeof daySeries[number]) => boolean) => {
    const set = daySeries.filter(pick);
    if (set.length < 10) { console.log(`  ${label.padEnd(22)} 天数不足`); return; }
    const m1 = mean(set.map((d) => d.mkt1)); const m3 = mean(set.map((d) => d.mkt3));
    const train = set.filter((d) => d.date < dc); const test = set.filter((d) => d.date >= dc);
    const t1 = train.length > 2 ? mean(train.map((d) => d.mkt3)) : 0;
    const te = test.length > 2 ? mean(test.map((d) => d.mkt3)) : 0;
    console.log(`  ${label.padEnd(22)} 天数 ${String(set.length).padStart(3)}  次日 ${m1.toFixed(2).padStart(6)}%  次3日 ${m3.toFixed(2).padStart(6)}%  训练 ${t1.toFixed(2).padStart(6)}% 验证 ${te.toFixed(2).padStart(6)}%`);
  };
  const median = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const limitMedian = median(daySeries.map((d) => d.limitCount));
  probe('涨停家数 >= 中位', (d) => d.limitCount >= limitMedian);
  probe('涨停家数 < 中位', (d) => d.limitCount < limitMedian);
  probe('涨停家数 >= 100', (d) => d.limitCount >= 100);
  probe('涨停家数 < 50', (d) => d.limitCount < 50);
}

console.log('\n=== C. 综合排序（无负期望形态 + 低换手 + 贴近MA20）头部表现 ===');
{
  const clean = rows.filter((r) => !r.hadLimitUp3 && !r.isLimitUp && r.turnover < 3 && Math.abs(r.distMa20) <= 5);
  const s1 = dayEqual(clean, 'fwd1'); const s3 = dayEqual(clean, 'fwd3');
  console.log(`  无形态 + 换手<3% + 贴近MA20: n=${clean.length}  T+1 ${s1.mean.toFixed(2)}%(t=${s1.t.toFixed(2)})  T+3 ${s3.mean.toFixed(2)}%(t=${s3.t.toFixed(2)})`);
  const trainC = clean.filter((r) => r.date < cut); const testC = clean.filter((r) => r.date >= cut);
  console.log(`  训练段 T+3 ${dayEqual(trainC, 'fwd3').mean.toFixed(2)}% | 验证段 T+3 ${dayEqual(testC, 'fwd3').mean.toFixed(2)}%`);
}
