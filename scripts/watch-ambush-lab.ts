/**
 * 「提前埋伏」排序验证
 *
 * 基于 watch-rank-lab 的分位数结论：低动量 / 低换手 / 低波动 / 低价 / 小市值 五档全部单调，
 * 方向一致（越安静越好）。这里把它们做成日截面排序，检验头部组合的样本外表现。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const limitPctOf = (s: string): number =>
  s.startsWith('688') || s.startsWith('30') ? 20 : s.startsWith('8') || s.startsWith('4') || s.startsWith('92') ? 30 : 10;

const floatShares = new Map<string, number>();
for (const file of readdirSync(CACHE_DIR).filter((n) => n.startsWith('universe-'))) {
  const rows = readJson(path.join(CACHE_DIR, file));
  if (!Array.isArray(rows)) continue;
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const code = String(r.code ?? ''); const nmc = Number(r.nmc); const trade = Number(r.trade);
    if (/^\d{6}$/.test(code) && Number.isFinite(nmc) && Number.isFinite(trade) && trade > 0) {
      floatShares.set(code, (nmc * 10_000) / trade);
    }
  }
}

type Row = {
  date: string; symbol: string; price: number; floatCap: number; turnover: number;
  vol20: number; mom20: number; mom60: number; distMa20: number; range10: number;
  hadLimitUp3: boolean; isLimitUp: boolean; volumeRatio: number;
  fwd1: number; fwd3: number; fwd5: number;
};
const rows: Row[] = [];

for (const file of readdirSync(CACHE_DIR).filter((n) => n.startsWith('sina-k-'))) {
  const symbol = file.slice(7, 13);
  let bars: Bar[];
  try {
    const p = readJson(path.join(CACHE_DIR, file));
    if (!Array.isArray(p)) continue;
    bars = (p as Array<Record<string, unknown>>).map((raw) => ({
      date: String(raw.day ?? '').replaceAll('-', ''),
      open: Number(raw.open), high: Number(raw.high), low: Number(raw.low),
      close: Number(raw.close), volume: Number(raw.volume),
    }));
  } catch { continue; }
  if (bars.length < 90) continue;
  const shares = floatShares.get(symbol) ?? null;
  const limit = limitPctOf(symbol);
  const closes = bars.map((b) => b.close);

  for (let i = 65; i < bars.length - 5; i += 1) {
    const bar = bars[i]; const prev = bars[i - 1];
    if (prev.close <= 0 || bar.close <= 0) continue;
    const maxMove = limit + 1.5;
    const fwd1 = (bars[i + 1].close / bar.close - 1) * 100;
    const fwd3 = (bars[i + 3].close / bar.close - 1) * 100;
    const fwd5 = (bars[i + 5].close / bar.close - 1) * 100;
    if (Math.abs(fwd1) > maxMove || Math.abs(fwd3) > maxMove * 3 || Math.abs(fwd5) > maxMove * 5) continue;

    const rets = closes.slice(i - 19, i + 1).map((c, k, arr) => (k === 0 ? 0 : (c / arr[k - 1] - 1) * 100)).slice(1);
    const sd = Math.sqrt(rets.reduce((t, v) => t + (v - mean(rets)) ** 2, 0) / rets.length);
    const window10 = bars.slice(i - 9, i + 1);
    const hadLimitUp3 = bars.slice(i - 3, i).some((b, k) => {
      const di = i - 3 + k; const p2 = bars[di - 1];
      return p2 && p2.close > 0 && b.close >= Math.round(p2.close * (1 + limit / 100) * 100) / 100 - 0.001;
    });

    rows.push({
      date: bar.date, symbol, price: bar.close,
      floatCap: shares ? (shares * bar.close) / 100_000_000 : 0,
      turnover: shares && shares > 0 ? (bar.volume / shares) * 100 : 0,
      vol20: sd,
      mom20: (bar.close / closes[i - 20] - 1) * 100,
      mom60: (bar.close / closes[i - 60] - 1) * 100,
      distMa20: (bar.close / mean(closes.slice(i - 19, i + 1)) - 1) * 100,
      range10: (Math.max(...window10.map((b) => b.high)) / Math.min(...window10.map((b) => b.low)) - 1) * 100,
      hadLimitUp3,
      isLimitUp: bar.close >= Math.round(prev.close * (1 + limit / 100) * 100) / 100 - 0.001,
      volumeRatio: mean(bars.slice(i - 5, i).map((b) => b.volume)) > 0 ? bar.volume / mean(bars.slice(i - 5, i).map((b) => b.volume)) : 1,
      fwd1, fwd3, fwd5,
    });
  }
}

const totalByDay = new Map<string, number>();
for (const r of rows) totalByDay.set(r.date, (totalByDay.get(r.date) ?? 0) + 1);
const validDates = new Set([...totalByDay.entries()].filter(([, c]) => c >= 2000).map(([d]) => d));
const clean = rows.filter((r) => validDates.has(r.date));

// 日截面排名：每个因子先转成当日分位（0~1），越低越好
const byDay = new Map<string, Row[]>();
for (const r of clean) { const l = byDay.get(r.date) ?? []; l.push(r); byDay.set(r.date, l); }

const FR = (value: number, sorted: number[]): number => {
  let lo = 0; let hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  return lo / Math.max(1, sorted.length - 1);
};

type Scored = Row & { ambush: number; rank: number };

/** 运行时可直接复现的打分：六个因子标准化后取负相加（越低越好） */
const FACTORS: Array<[string, (r: Row) => number]> = [
  ['mom20', (r) => r.mom20],
  ['mom60', (r) => r.mom60],
  ['turnover', (r) => r.turnover],
  ['vol20', (r) => r.vol20],
  ['floatCap', (r) => r.floatCap],
  ['price', (r) => r.price],
];
const stats = new Map<string, { mean: number; std: number }>();
for (const [name, pick] of FACTORS) {
  const values = clean.map(pick).filter((v) => Number.isFinite(v));
  const m = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2))) || 1;
  stats.set(name, { mean: m, std: sd });
}
const ambushOf = (r: Row): number => {
  let total = 0;
  for (const [name, pick] of FACTORS) {
    const { mean: m, std: sd } = stats.get(name) as { mean: number; std: number };
    total += (pick(r) - m) / sd;
  }
  return -total / FACTORS.length;
};

const scored: Scored[] = [];
for (const [date, set] of byDay) {
  const withScore = set.map((r) => ({ ...r, ambush: ambushOf(r), rank: 0 }));
  withScore.sort((a, b) => b.ambush - a.ambush);
  withScore.forEach((r, index) => { r.rank = index / withScore.length; });
  scored.push(...withScore);
  void date;
}

const dates = [...new Set(scored.map((r) => r.date))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];

const stat = (set: Scored[], key: 'fwd1' | 'fwd3' | 'fwd5') => {
  const perDay = new Map<string, number[]>();
  for (const r of set) { const l = perDay.get(r.date) ?? []; l.push(r[key]); perDay.set(r.date, l); }
  const means = [...perDay.values()].filter((v) => v.length >= 3).map(mean);
  const avg = mean(means);
  const sd = Math.sqrt(means.reduce((t, v) => t + (v - avg) ** 2, 0) / Math.max(1, means.length - 1));
  return { mean: avg, t: sd > 0 ? avg / (sd / Math.sqrt(means.length)) : 0, days: means.length };
};

console.log(`样本 ${scored.length}，${dates.length} 个交易日，训练段 <${cut}\n`);
console.log('分位（埋伏分从高到低）   n      T+1            T+3            T+5');
for (const [lo, hi, label] of [[0, 0.1, '前 10%'], [0.1, 0.2, '10~20%'], [0.2, 0.4, '20~40%'], [0.4, 0.6, '40~60%'], [0.6, 0.8, '60~80%'], [0.8, 1.01, '后 20%']] as Array<[number, number, string]>) {
  const set = scored.filter((r) => r.rank >= lo && r.rank < hi);
  const a = stat(set, 'fwd1'); const b = stat(set, 'fwd3'); const c = stat(set, 'fwd5');
  console.log(
    `${label.padEnd(22)} ${String(set.length).padStart(6)}  ${(a.mean >= 0 ? '+' : '') + a.mean.toFixed(2)}%(${a.t.toFixed(1).padStart(5)})  ${(b.mean >= 0 ? '+' : '') + b.mean.toFixed(2)}%(${b.t.toFixed(1).padStart(5)})  ${(c.mean >= 0 ? '+' : '') + c.mean.toFixed(2)}%(${c.t.toFixed(1).padStart(5)})`,
  );
}

console.log('\n加上「排除负期望形态」过滤后（剔除 3 日内涨停未封 / 放量>1.5 / 涨停）');
const filtered = scored.filter((r) => !r.hadLimitUp3 && !r.isLimitUp && r.volumeRatio <= 1.5);
console.log('分位                     n      T+1            T+3            T+5');
for (const [lo, hi, label] of [[0, 0.1, '前 10%'], [0.1, 0.3, '10~30%'], [0.3, 0.5, '30~50%'], [0.5, 1.01, '后 50%']] as Array<[number, number, string]>) {
  const set = filtered.filter((r) => r.rank >= lo && r.rank < hi);
  const a = stat(set, 'fwd1'); const b = stat(set, 'fwd3'); const c = stat(set, 'fwd5');
  console.log(
    `${label.padEnd(22)} ${String(set.length).padStart(6)}  ${(a.mean >= 0 ? '+' : '') + a.mean.toFixed(2)}%(${a.t.toFixed(1).padStart(5)})  ${(b.mean >= 0 ? '+' : '') + b.mean.toFixed(2)}%(${b.t.toFixed(1).padStart(5)})  ${(c.mean >= 0 ? '+' : '') + c.mean.toFixed(2)}%(${c.t.toFixed(1).padStart(5)})`,
  );
}

console.log('\n=== 运行时参数（可直接内嵌） ===');
for (const [name] of FACTORS) {
  const st = stats.get(name) as { mean: number; std: number };
  console.log(`  ${name.padEnd(9)} mean=${st.mean.toFixed(4)} std=${st.std.toFixed(4)}`);
}
{
  const scores = scored.map((r) => r.ambush).sort((a, b) => a - b);
  const pct = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => scores[Math.floor(scores.length * p)]);
  console.log('  埋伏分分位(5,10,20,...,90):', pct.map((v) => v.toFixed(3)).join(', '));
}

console.log('\n样本外检验（前 10%，含过滤）');
for (const [label, set] of [['训练段', filtered.filter((r) => r.date < cut && r.rank < 0.1)], ['验证段', filtered.filter((r) => r.date >= cut && r.rank < 0.1)]] as Array<[string, Scored[]]>) {
  const a = stat(set, 'fwd1'); const b = stat(set, 'fwd3'); const c = stat(set, 'fwd5');
  console.log(`  ${label} n=${String(set.length).padStart(5)}  T+1 ${a.mean.toFixed(2)}%  T+3 ${b.mean.toFixed(2)}%(t=${b.t.toFixed(2)})  T+5 ${c.mean.toFixed(2)}%(t=${c.t.toFixed(2)})`);
}
