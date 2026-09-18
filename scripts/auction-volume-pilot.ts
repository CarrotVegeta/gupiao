/**
 * 早盘量能代理的预实验。
 *
 * 09:25 集合竞价的成交量没有免费历史接口（腾讯分笔/同花顺分时忽略日期参数，
 * 东财 push2his 断连，网易 502，新浪分钟K线在批量抓取时被限流）。
 * 但集合竞价那一笔会并入当日第一根分钟K线，所以用「首根分钟K线量」当代理：
 *
 *   量比代理(对日线)   = 首根量 / (昨日全天量 / 240 × 段内分钟数)
 *   量比代理(对同段)   = 首根量 / 近5日同一根均量
 *   竞昨比代理         = 首根量 / 昨日全天量
 *   竞价换手率代理     = 首根量 / 流通股本
 *
 * 因为新浪限流，本次只有 96 只（000010~000158，全部深市主板）抓到 m15/m30，
 * 覆盖 434 个候选日。样本小且有板块偏，只能回答「量能到底有没有增量信息」，
 * 不能用来定权重。全天量能数据由 scripts/fetch-sina-minute.ts 抓取。
 *
 * 用法：npx tsx scripts/auction-volume-pilot.ts
 */
import { readFileSync } from 'node:fs';
import { BASE, F, avg, completeRows, samples, type Sample } from './_auction-lab.js';

const CACHE = 'scripts/output/cache';
type Bar = { day: string; open: string; high: string; low: string; close: string; volume: string };

type DayBar = { volume: number; close: number };
const dayCache = new Map<string, Map<string, DayBar>>();
const minuteCache = new Map<string, Map<string, { vol: number; high: number; second: number }>>();

function dailyBars(symbol: string) {
  if (!dayCache.has(symbol)) {
    let map = new Map<string, DayBar>();
    try {
      const rows = JSON.parse(readFileSync(`${CACHE}/sina-k-${symbol}.txt`, 'utf8')) as Bar[];
      map = new Map(rows.map(r => [r.day.replaceAll('-', ''), { volume: Number(r.volume), close: Number(r.close) }]));
    } catch { /* 无缓存 */ }
    dayCache.set(symbol, map);
  }
  return dayCache.get(symbol)!;
}

/** 每天第一根（含 09:25 竞价）和第二根（纯连续竞价，用于对照） */
function minuteBars(symbol: string, scale: number) {
  const key = `${symbol}|${scale}`;
  if (!minuteCache.has(key)) {
    const byDay = new Map<string, { vol: number; high: number; second: number }>();
    try {
      const rows = JSON.parse(readFileSync(`${CACHE}/sina-m${scale}-${symbol}.txt`, 'utf8')) as Bar[];
      const seen = new Map<string, number>();
      for (const row of rows) {
        const date = row.day.slice(0, 10).replaceAll('-', '');
        const n = seen.get(date) ?? 0;
        seen.set(date, n + 1);
        if (n === 0) byDay.set(date, { vol: Number(row.volume), high: Number(row.high), second: 0 });
        else if (n === 1) { const cur = byDay.get(date); if (cur) cur.second = Number(row.volume); }
      }
    } catch { /* 无缓存 */ }
    minuteCache.set(key, byDay);
  }
  return minuteCache.get(key)!;
}

type Enriched = Sample & {
  segMinutes: number;
  openVol: number;
  volRatioD1: number;
  volVs5d: number;
  lbDaily: number;
  lbSame: number;
  openTurnover: number;
  /** 首根K线内就摸到涨停：此时首根量里有封板成交，量比与结果互为因果 */
  sealedInBar: boolean;
  lbSecond: number;
};

const limitPriceOf = (s: Sample, prevClose: number) =>
  Math.round(prevClose * (100 + s.limitPct) + 1e-8) / 100;

function enrich(rows: Sample[], scale: number): Enriched[] {
  const out: Enriched[] = [];
  const segMinutes = scale;
  for (const row of rows) {
    const minutes = minuteBars(row.symbol, scale);
    const bar = minutes.get(row.date);
    if (bar === undefined) continue;
    const openVol = bar.vol;
    const dayBars = dailyBars(row.symbol);
    const dates = [...dayBars.keys()].sort();
    const idx = dates.indexOf(row.date);
    if (idx <= 0) continue;
    const prev = dayBars.get(dates[idx - 1]);
    if (!prev || !prev.volume) continue;
    const prevDayVol = prev.volume;
    const prior = dates.slice(Math.max(0, idx - 5), idx).map(d => minutes.get(d)).filter((v): v is NonNullable<typeof v> => v !== undefined);
    const priorDayVols = dates.slice(Math.max(0, idx - 5), idx).map(d => dayBars.get(d)?.volume).filter((v): v is number => v !== undefined);
    if (prior.length < 3) continue;
    const floatShares = row.prevTurnover && row.prevTurnover > 0 ? (prevDayVol / (row.prevTurnover / 100)) : null;
    const avgDay = avg(priorDayVols) ?? prevDayVol;
    const avgSame = avg(prior.map(p => p.vol)) ?? openVol;
    const priorSecond = prior.map(p => p.second).filter(v => v > 0);
    out.push({
      ...row,
      segMinutes,
      openVol,
      volRatioD1: openVol / prevDayVol,
      volVs5d: openVol / avgSame,
      lbDaily: openVol / (avgDay / 240 * segMinutes),
      lbSame: openVol / avgSame,
      openTurnover: floatShares && floatShares > 0 ? openVol / floatShares * 100 : 0,
      sealedInBar: bar.high >= limitPriceOf(row, prev.close) - 0.001,
      lbSecond: priorSecond.length >= 3 ? bar.second / (avg(priorSecond) ?? bar.second) : 0,
    });
  }
  return out;
}

const buyable = completeRows(BASE, samples.filter(s => !s.sealedAtAuction));
const m15 = enrich(buyable, 15);
const m30 = enrich(buyable, 30);

const pct = (v: number | null | undefined, d = 1) => v === null || v === undefined ? '  —  ' : `${(v * 100).toFixed(d)}%`.padStart(7);
const num = (v: number | null | undefined, d = 2) => v === null || v === undefined ? '  —  ' : v.toFixed(d).padStart(7);
const closeVsPrevClose = (s: Sample) => (1 + s.gapPct / 100) * (1 + s.retSameDay / 100) - 1;
const stat = (set: Enriched[]) => ({
  n: set.length,
  seal: avg(set.map(s => s.y)) ?? 0,
  red: avg(set.map(s => +(closeVsPrevClose(s) > 0))) ?? 0,
  nextOpen: avg(set.flatMap(s => s.retNextOpen === null ? [] : [s.retNextOpen])),
});

console.log(`预实验样本：m15 ${m15.length} 条 / m30 ${m30.length} 条，覆盖 ${new Set(m15.map(s => s.symbol)).size} 只（000010~000158，深市主板）`);
console.log(`其中竞价涨幅 2.8~3.5% 的只有 ${m15.filter(s => s.gapPct >= 2.8 && s.gapPct < 3.5).length} 条 —— 无法验证「黄金区间」的联合条件\n`);

// 两个代理的一致性
{
  const both = m15.filter(a => m30.some(b => b.date === a.date && b.symbol === a.symbol));
  const rank = (arr: number[], v: number) => arr.filter(x => x <= v).length / arr.length;
  const set = both.map(a => {
    const b = m30.find(x => x.date === a.date && x.symbol === a.symbol)!;
    const g15 = m15.map(x => x.lbSame);
    const g30 = m30.map(x => x.lbSame);
    return { a: rank(g15, a.lbSame), b: rank(g30, b.lbSame) };
  });
  const ma = avg(set.map(s => s.a)) ?? 0; const mb = avg(set.map(s => s.b)) ?? 0;
  const cov = set.reduce((t, s) => t + (s.a - ma) * (s.b - mb), 0) / Math.max(1, set.length);
  const sd = Math.sqrt(set.reduce((t, s) => t + (s.a - ma) ** 2, 0) / set.length) * Math.sqrt(set.reduce((t, s) => t + (s.b - mb) ** 2, 0) / set.length);
  console.log(`m15 与 m30 两个「量比代理」的分位相关系数：${sd > 0 ? (cov / sd).toFixed(3) : '—'}（重叠 ${set.length} 条）`);
}

const block = (title: string, rows: Enriched[], rules: Array<[string, (s: Enriched) => boolean]>) => {
  console.log(`\n${title}`);
  console.log(`  ${'分组'.padEnd(26)} ${'样本'.padStart(5)} ${'封板率'.padStart(8)} ${'当日收红'.padStart(9)} ${'次日开盘'.padStart(9)}`);
  for (const [label, pick] of rules) {
    const s = stat(rows.filter(pick));
    console.log(`  ${label.padEnd(26)} ${String(s.n).padStart(5)} ${pct(s.seal)} ${pct(s.red)} ${num(s.nextOpen)}`);
  }
};

for (const [scale, rows] of [[15, m15], [30, m30]] as Array<[number, Enriched[]]>) {
  console.log(`\n================ 代理：${scale} 分钟首根 ================`);
  block(`规则 2 · 量比（对同段近5日均量，阈值取规则的 3 / 5）`, rows, [
    ['量比 <3（规则：剔除）', s => s.lbSame < 3],
    ['量比 3~5（规则：备选）', s => s.lbSame >= 3 && s.lbSame < 5],
    ['量比 >=5（规则：达标）', s => s.lbSame >= 5],
  ]);
  block('规则 2 · 量比（对日线折算）', rows, [
    ['量比 <3', s => s.lbDaily < 3],
    ['量比 3~5', s => s.lbDaily >= 3 && s.lbDaily < 5],
    ['量比 >=5', s => s.lbDaily >= 5],
  ]);
  block('规则 2 · 竞昨比代理（规则：>=3%）', rows, [
    ['竞昨比 <1%', s => s.volRatioD1 < 0.01],
    ['1~3%', s => s.volRatioD1 >= 0.01 && s.volRatioD1 < 0.03],
    ['>=3%（规则：达标）', s => s.volRatioD1 >= 0.03],
    ['>=5%', s => s.volRatioD1 >= 0.05],
  ]);
  block('规则 3 · 竞价换手率代理（规则：小盘>=0.8% / 中盘>=0.5%）', rows, [
    ['<0.5%', s => s.openTurnover < 0.5],
    ['0.5~0.8%', s => s.openTurnover >= 0.5 && s.openTurnover < 0.8],
    ['>=0.8%', s => s.openTurnover >= 0.8],
  ]);
  block('组合：高开幅度 × 量能（规则核心逻辑）', rows, [
    ['涨幅2.8~7% 且 量比<3', s => s.gapPct >= 2.8 && s.gapPct < 7 && s.lbSame < 3],
    ['涨幅2.8~7% 且 量比>=3', s => s.gapPct >= 2.8 && s.gapPct < 7 && s.lbSame >= 3],
    ['涨幅2.8~7% 且 量比>=5', s => s.gapPct >= 2.8 && s.gapPct < 7 && s.lbSame >= 5],
    ['涨幅>=7% 且 量比>=5', s => s.gapPct >= 7 && s.lbSame >= 5],
    ['涨幅>=7% 且 量比<3', s => s.gapPct >= 7 && s.lbSame < 3],
  ]);
}

console.log('\n================ 污染对照：剔除「首根K线内就摸到涨停」的样本 ================');
for (const [scale, rows] of [[15, m15], [30, m30]] as Array<[number, Enriched[]]>) {
  const dirty = rows.filter(s => s.sealedInBar);
  const clean = rows.filter(s => !s.sealedInBar);
  console.log(`\n代理 ${scale} 分钟首根：原始 ${rows.length} 条，其中首根内摸过涨停 ${dirty.length} 条（${(dirty.length / rows.length * 100).toFixed(0)}%）`);
  for (const [label, set] of [['全部样本', rows], ['剔除首根封板（干净）', clean]] as Array<[string, Enriched[]]>) {
    console.log(`  ${label}`);
    for (const [name, pick] of [['量比 <3', (s: Enriched) => s.lbSame < 3], ['量比 3~5', (s: Enriched) => s.lbSame >= 3 && s.lbSame < 5], ['量比 >=5', (s: Enriched) => s.lbSame >= 5]] as Array<[string, (s: Enriched) => boolean]>) {
      const st = stat(set.filter(pick));
      console.log(`    ${name.padEnd(12)} n=${String(st.n).padStart(4)}  封板 ${pct(st.seal)}  收红 ${pct(st.red)}  次日开盘 ${num(st.nextOpen)}`);
    }
  }
  console.log(`  用「第二根K线量比」当对照（完全不包含竞价那一笔）：`);
  for (const [name, pick] of [['量比 <3', (s: Enriched) => s.lbSecond > 0 && s.lbSecond < 3], ['量比 3~5', (s: Enriched) => s.lbSecond >= 3 && s.lbSecond < 5], ['量比 >=5', (s: Enriched) => s.lbSecond >= 5]] as Array<[string, (s: Enriched) => boolean]>) {
    const st = stat(rows.filter(pick));
    console.log(`    ${name.padEnd(12)} n=${String(st.n).padStart(4)}  封板 ${pct(st.seal)}  收红 ${pct(st.red)}  次日开盘 ${num(st.nextOpen)}`);
  }
}

// 量能是否带来增量：在同样本上比较「只用5个线上特征」和「再加量能特征」
console.log('\n================ 增量检验（m15 代理，同样本） ================');
{
  const rows = m15;
  const withVol: Array<[string, number[]]> = rows.map(s => [
    '', [
      s.gapRel, Math.min(s.board, 5), +s.prevOneWord, s.prevTurnover ?? 0,
      s.floatCap && s.floatCap > 0 ? Math.log(s.floatCap) : 0,
      Math.log1p(s.lbSame), Math.log1p(s.volRatioD1 * 100), s.openTurnover,
    ],
  ]);
  const baseX = withVol.map(([, x]) => x.slice(0, 5));
  const volX = withVol.map(([, x]) => x);
  const y = rows.map(s => s.y);
  // 简单 5 折按时间切分，避免样本太小还要走前重拟合
  const evalSplit = (x: number[][], label: string) => {
    const cut = Math.floor(rows.length * 0.6);
    const fit = (xs: number[][], ys: number[]) => {
      const means = xs[0].map((_, j) => avg(xs.map(r => r[j])) ?? 0);
      const stds = means.map((m, j) => Math.sqrt(avg(xs.map(r => (r[j] - m) ** 2)) ?? 1) || 1);
      const z = xs.map(r => r.map((v, j) => (v - means[j]) / stds[j]));
      let bias = Math.log((avg(ys) ?? 0.5) / (1 - (avg(ys) ?? 0.5)));
      const w = means.map(() => 0);
      for (let it = 0; it < 600; it += 1) {
        const g = means.map(() => 0); let gb = 0;
        for (let i = 0; i < z.length; i += 1) {
          const s = 1 / (1 + Math.exp(-(bias + w.reduce((t, wi, j) => t + wi * z[i][j], 0))));
          const e = s - ys[i]; gb += e;
          for (let j = 0; j < w.length; j += 1) g[j] += e * z[i][j];
        }
        for (let j = 0; j < w.length; j += 1) w[j] -= 0.4 * (g[j] / z.length + 0.02 * w[j]);
        bias -= 0.4 * gb / z.length;
      }
      return { w, bias, means, stds };
    };
    const m = fit(x.slice(0, cut), y.slice(0, cut));
    const pred = x.slice(cut).map(r => 1 / (1 + Math.exp(-(m.bias + m.w.reduce((t, w, j) => t + w * (r[j] - m.means[j]) / m.stds[j], 0)))));
    const yt = y.slice(cut);
    const brier = avg(pred.map((p, i) => (p - yt[i]) ** 2)) ?? 0;
    const pos = yt.filter(v => v === 1).length;
    const order = pred.map((p, i) => ({ p, y: yt[i] })).sort((a, b) => a.p - b.p);
    let ranks = 0;
    order.forEach((o, i) => { if (o.y) ranks += i + 1; });
    const aucVal = pos && pos !== yt.length ? (ranks - pos * (pos + 1) / 2) / (pos * (yt.length - pos)) : 0;
    const top = [...pred.map((p, i) => ({ p, y: yt[i] }))].sort((a, b) => b.p - a.p).slice(0, Math.round(yt.length * 0.1));
    console.log(`  ${label.padEnd(28)} n=${yt.length}  样本外 Brier ${brier.toFixed(4)}  AUC ${(aucVal * 100).toFixed(2)}%  前10%封板率 ${pct(avg(top.map(t => t.y)) ?? 0)}`);
  };
  evalSplit(baseX, '线上 5 特征');
  evalSplit(volX, '+ 量能 3 项');
}

void F;
