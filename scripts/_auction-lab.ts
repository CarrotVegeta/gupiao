/**
 * 竞价可买样本实验台共享数据层：样本重建、特征库、评估工具。
 * 由 scripts/auction-buyable-lab.ts 与 scripts/auction-buyable-region.ts 共用。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isSealedAtAuction, limitUpPct } from '../server/auction/model-features.js';
import { fitLogistic, predictLogistic, type LogisticModel } from '../server/auction/training.js';

// ---------------------------------------------------------------- 数据载入

export type Tick = {
  date: string; symbol: string; name: string; gapPct: number; board: number; prevOneWord: boolean;
  prevTurnover: number | null; floatCap: number | null; prevLimitCount: number; prevBrokenCount: number;
  indexGapPct: number | null; sealedToday: boolean; touchedToday: boolean; retNextOpen: number | null;
  prevGapPct: number; prevShrink: number | null; limitCount10: number; ztSpan: number; pct20: number | null;
  distHigh60: number | null; prevAmplitude: number | null; prevBrokenRatio: number | null;
  prevMultiBoard: number; indexPrevPct: number | null; index5dPct: number | null; index20dPct: number | null;
  retSameDay: number; retNextClose: number | null; mfe: number; mae: number;
};
export type SealedRow = { date: string; symbol: string; board: number };

const raw = readFileSync('scripts/output/limit-up-history.json', 'utf8');
export const history = JSON.parse(raw) as { dates: string[]; ticks: Tick[]; sealed: SealedRow[] };
const barCache = new Map<string, Map<string, { open: number; previousClose: number }>>();
const priceHashes: string[] = [];
export function bars(symbol: string) {
  if (!barCache.has(symbol)) {
    const source = readFileSync(`scripts/output/cache/sina-k-${symbol}.txt`, 'utf8');
    priceHashes.push(`${symbol}:${createHash('sha256').update(source).digest('hex')}`);
    const list = JSON.parse(source) as { day: string; open: string; close: string }[];
    const byDate = new Map<string, { open: number; previousClose: number }>();
    list.forEach((r, i) => {
      if (i > 0) byDate.set(r.day.replaceAll('-', ''), { open: +r.open, previousClose: +list[i - 1].close });
    });
    barCache.set(symbol, byDate);
  }
  return barCache.get(symbol)!;
}

// 板块归属（抓取时点快照，用于「同板块昨日涨停家数」这类题材强度因子）
export const boardOf = new Map<string, string[]>();
{
  for (const file of readdirSync('scripts/output/cache')) {
    if (!file.startsWith('f10-boards-')) continue;
    try {
      const payload = JSON.parse(readFileSync(`scripts/output/cache/${file}`, 'utf8')) as {
        result?: { data?: { SECURITY_CODE?: string; BOARD_NAME?: string }[] };
      };
      for (const row of payload.result?.data ?? []) {
        if (!row.SECURITY_CODE || !row.BOARD_NAME) continue;
        const list = boardOf.get(row.SECURITY_CODE) ?? [];
        list.push(row.BOARD_NAME);
        boardOf.set(row.SECURITY_CODE, list);
      }
    } catch { /* 忽略坏缓存 */ }
  }
}

/** 昨日各板块涨停家数 + 板块内最高连板 */
const sectorByDate = new Map<string, { count: Map<string, number>; top: Map<string, number> }>();
for (const row of history.sealed) {
  const entry = sectorByDate.get(row.date) ?? { count: new Map(), top: new Map() };
  for (const board of boardOf.get(row.symbol) ?? []) {
    entry.count.set(board, (entry.count.get(board) ?? 0) + 1);
    entry.top.set(board, Math.max(entry.top.get(board) ?? 0, row.board));
  }
  sectorByDate.set(row.date, entry);
}

/** 板块成分股数量：用于把「同板块涨停家数」换成「板块涨停密度」，抵消大概念股的稀释 */
export const boardSize = new Map<string, number>();
for (const boards of boardOf.values()) {
  for (const board of new Set(boards)) boardSize.set(board, (boardSize.get(board) ?? 0) + 1);
}

export const previousDate = new Map<string, string>();
history.dates.forEach((date, i) => { if (i > 0) previousDate.set(date, history.dates[i - 1]); });

// ---------------------------------------------------------------- 特征库

export type Sample = Tick & {
  limitPct: number; sealedAtAuction: boolean;
  y: number; touched: number;
  sectorHeat: number; sectorBoardCount: number; sectorMaxBoard: number; sectorIsLeader: number;
  sectorHeatRank: number; sectorDensity: number; sectorDensitySum: number;
  gapRel: number; boardCapped: number; prevGapRel: number;
  // 横截面（当日候选池内相对位置），只需 09:25 的池子信息
  gapRankDay: number; gapRelDay: number; boardRankDay: number; capRankDay: number;
  turnoverRelDay: number; poolSizeDay: number; heatRankDay: number;
};

const pctRank = (value: number, list: number[]): number =>
  list.length < 2 ? 0.5 : list.filter(v => v <= value).length / list.length;

export const contaminated = history.ticks.filter(t => /st/i.test(t.name) && /^(30|688|8|4|92)/.test(t.symbol));
export const samples: Sample[] = history.ticks
  .filter(t => !(/st/i.test(t.name) && /^(30|688|8|4|92)/.test(t.symbol)))
  .flatMap(t => {
    const bar = bars(t.symbol).get(t.date);
    if (!bar) throw new Error(`缺少历史开盘价/昨收：${t.date} ${t.symbol}`);
    const sealedAtAuction = isSealedAtAuction(t.symbol, t.name, bar.open, bar.previousClose);
    if (sealedAtAuction === null) throw new Error('历史价格无效');
    const boards = boardOf.get(t.symbol) ?? [];
    const sector = sectorByDate.get(previousDate.get(t.date) ?? '') ?? { count: new Map(), top: new Map() };
    const counts = boards.map(b => sector.count.get(b) ?? 0);
    const toppers = boards.map(b => sector.top.get(b) ?? 0);
    const sectorHeat = counts.length ? Math.max(...counts) : 0;
    const allLimitCounts = [...new Set(sector.count.values())].sort((a, b) => a - b);
    const sectorHeatRank = allLimitCounts.length ? allLimitCounts.filter(v => v <= sectorHeat).length / allLimitCounts.length : 0;
    const densities = boards.map(b => (sector.count.get(b) ?? 0) / Math.max(1, boardSize.get(b) ?? 1));
    return [{
      ...t,
      limitPct: limitUpPct(t.symbol, t.name),
      sealedAtAuction,
      y: +t.sealedToday,
      touched: +t.touchedToday,
      sectorHeat,
      sectorBoardCount: counts.length ? counts.reduce((a, b) => a + b, 0) : 0,
      sectorMaxBoard: toppers.length ? Math.max(...toppers) : 0,
      sectorIsLeader: toppers.length ? +(t.board >= Math.max(...toppers)) : 0,
      sectorHeatRank,
      sectorDensity: densities.length ? Math.max(...densities) : 0,
      sectorDensitySum: densities.length ? densities.reduce((a, b) => a + b, 0) : 0,
      gapRel: t.gapPct / limitUpPct(t.symbol, t.name),
      boardCapped: Math.min(t.board, 5),
      prevGapRel: t.prevGapPct / limitUpPct(t.symbol, t.name),
      gapRankDay: 0.5, gapRelDay: 0, boardRankDay: 0.5, capRankDay: 0.5,
      turnoverRelDay: 0, poolSizeDay: 0, heatRankDay: 0.5,
    }];
  });

// 横截面特征：当日全部候选（含竞价已封板）内的相对位置，09:25 全部可知
{
  const byDate = new Map<string, Sample[]>();
  for (const s of samples) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  for (const list of byDate.values()) {
    const gaps = list.map(s => s.gapPct);
    const boardList = list.map(s => s.board);
    const capList = list.map(s => s.floatCap ?? 0);
    const turnList = list.map(s => s.prevTurnover ?? -1);
    const heatList = list.map(s => s.sectorHeat);
    const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    for (const s of list) {
      s.gapRankDay = pctRank(s.gapPct, gaps);
      s.gapRelDay = s.gapPct - medianGap;
      s.boardRankDay = pctRank(s.board, boardList);
      s.capRankDay = pctRank(s.floatCap ?? 0, capList);
      s.turnoverRelDay = s.prevTurnover === null ? 0 : s.prevTurnover - (turnList.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0);
      s.heatRankDay = pctRank(s.sectorHeat, heatList);
      s.poolSizeDay = list.length;
    }
  }
}

// ---------------------------------------------------------------- 特征定义

const logOrNull = (v: number | null, positive = true): number | null =>
  v === null || !Number.isFinite(v) || (positive && v <= 0) ? null : Math.log(v);

const log1p = (v: number | null): number | null => v === null || !Number.isFinite(v) ? null : Math.log1p(Math.max(0, v));

export type Feature = { name: string; label: string; pick: (s: Sample) => number | null };

export const F = {
  gapRel: { name: 'gapRel', label: '竞价涨幅/涨停幅度', pick: s => s.gapRel },
  board: { name: 'board', label: '昨日连板数', pick: s => s.boardCapped },
  oneWord: { name: 'oneWord', label: '昨日一字板', pick: s => +s.prevOneWord },
  turnover: { name: 'turnover', label: '昨日换手率', pick: s => s.prevTurnover },
  floatCap: { name: 'floatCap', label: '流通市值对数', pick: s => logOrNull(s.floatCap) },
  shrink: { name: 'shrink', label: '昨量/前5日均量', pick: s => s.prevShrink },
  limitCount10: { name: 'limitCount10', label: '近10日涨停次数', pick: s => s.limitCount10 },
  ztSpan: { name: 'ztSpan', label: '涨停簇跨度', pick: s => s.ztSpan },
  pct20: { name: 'pct20', label: '20日涨幅', pick: s => s.pct20 },
  distHigh60: { name: 'distHigh60', label: '距60日高点', pick: s => s.distHigh60 },
  prevAmplitude: { name: 'prevAmplitude', label: '昨日振幅', pick: s => s.prevAmplitude },
  prevBrokenRatio: { name: 'prevBrokenRatio', label: '昨日炸板率', pick: s => s.prevBrokenRatio },
  marketLimit: { name: 'marketLimit', label: '昨日涨停家数', pick: s => s.prevLimitCount },
  marketBroken: { name: 'marketBroken', label: '昨日炸板家数', pick: s => s.prevBrokenCount },
  marketMulti: { name: 'marketMulti', label: '昨日连板家数', pick: s => s.prevMultiBoard },
  indexGap: { name: 'indexGap', label: '大盘竞价缺口', pick: s => s.indexGapPct },
  indexPrev: { name: 'indexPrev', label: '大盘昨日涨幅', pick: s => s.indexPrevPct },
  index5d: { name: 'index5d', label: '大盘5日涨幅', pick: s => s.index5dPct },
  index20d: { name: 'index20d', label: '大盘20日涨幅', pick: s => s.index20dPct },
  prevGap: { name: 'prevGap', label: '昨日竞价溢价', pick: s => s.prevGapPct },
  sectorHeat: { name: 'sectorHeat', label: '同板块昨日涨停家数', pick: s => s.sectorHeat },
  sectorHeatLog: { name: 'sectorHeatLog', label: '同板块涨停家数(log)', pick: s => log1p(s.sectorHeat) },
  sectorBoardCount: { name: 'sectorBoardCount', label: '所属板块涨停合计', pick: s => s.sectorBoardCount },
  sectorMaxBoard: { name: 'sectorMaxBoard', label: '同板块最高连板', pick: s => s.sectorMaxBoard },
  sectorIsLeader: { name: 'sectorIsLeader', label: '是否板块最高板', pick: s => s.sectorIsLeader },
  sectorHeatRank: { name: 'sectorHeatRank', label: '板块热度分位', pick: s => s.sectorHeatRank },
  sectorDensity: { name: 'sectorDensity', label: '板块涨停密度', pick: s => s.sectorDensity },
  sectorDensitySum: { name: 'sectorDensitySum', label: '板块涨停密度合计', pick: s => s.sectorDensitySum },
  gapRankDay: { name: 'gapRankDay', label: '当日竞价涨幅分位', pick: s => s.gapRankDay },
  gapRelDay: { name: 'gapRelDay', label: '竞价涨幅-池中位数', pick: s => s.gapRelDay },
  boardRankDay: { name: 'boardRankDay', label: '当日连板高度分位', pick: s => s.boardRankDay },
  capRankDay: { name: 'capRankDay', label: '当日流通市值分位', pick: s => s.capRankDay },
  turnoverRelDay: { name: 'turnoverRelDay', label: '换手-池中位数', pick: s => s.turnoverRelDay },
  heatRankDay: { name: 'heatRankDay', label: '当日板块热度分位', pick: s => s.heatRankDay },
  poolSizeDay: { name: 'poolSizeDay', label: '当日候选只数', pick: s => s.poolSizeDay },
  prevGapRel: { name: 'prevGapRel', label: '昨日竞价强度', pick: s => s.prevGapRel },
  // 非线性 / 交互
  gapNear: { name: 'gapNear', label: '竞价接近涨停', pick: s => +(s.gapRel >= 0.7) },
  gapHigh: { name: 'gapHigh', label: '竞价≥7%', pick: s => +(s.gapPct >= 7) },
  gapLow: { name: 'gapLow', label: '竞价低开', pick: s => +(s.gapPct < 0) },
  gapBoard: { name: 'gapBoard', label: '竞价×连板', pick: s => s.gapRel * s.boardCapped },
  gapSq: { name: 'gapSq', label: '竞价强度平方', pick: s => s.gapRel * s.gapRel },
  heatGap: { name: 'heatGap', label: '板块热度×竞价', pick: s => log1p(s.sectorHeat) * s.gapRel },
  // 高换手 × 高竞价：换手率在线上模型里被标准化和 L2 抹平，这里显式给阈值与交互
  turnoverHi: { name: 'turnoverHi', label: '昨日换手≥10%', pick: s => +(s.prevTurnover !== null && s.prevTurnover >= 10) },
  turnoverMid: { name: 'turnoverMid', label: '昨日换手5~10%', pick: s => +(s.prevTurnover !== null && s.prevTurnover >= 5 && s.prevTurnover < 10) },
  turnoverCap: { name: 'turnoverCap', label: '换手上限20%', pick: s => s.prevTurnover === null ? null : Math.min(s.prevTurnover, 20) },
  turnoverHiGap: { name: 'turnoverHiGap', label: '高换手×竞价强度', pick: s => s.prevTurnover !== null && s.prevTurnover >= 10 ? s.gapRel : 0 },
  turnoverGap: { name: 'turnoverGap', label: '换手×竞价强度', pick: s => s.prevTurnover === null ? null : Math.min(s.prevTurnover, 20) * s.gapRel },
  capSmall: { name: 'capSmall', label: '流通市值≤30亿', pick: s => +(s.floatCap !== null && s.floatCap <= 30) },
  capSmallGap: { name: 'capSmallGap', label: '小市值×竞价强度', pick: s => s.floatCap !== null && s.floatCap <= 30 ? s.gapRel : 0 },
} satisfies Record<string, Feature>;

export type FeatureKey = keyof typeof F;

export const BASE: FeatureKey[] = ['gapRel', 'board', 'oneWord', 'turnover', 'floatCap'];

// ---------------------------------------------------------------- 评估工具

export const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function auc(rows: { p: number; y: number }[]) {
  const ordered = [...rows].sort((a, b) => a.p - b.p);
  const positives = rows.filter(r => r.y === 1).length;
  if (!positives || positives === rows.length) return null;
  let ranks = 0;
  for (let i = 0; i < ordered.length;) {
    let j = i + 1;
    while (j < ordered.length && ordered[j].p === ordered[i].p) j++;
    for (let k = i; k < j; k++) if (ordered[k].y) ranks += (i + 1 + j) / 2;
    i = j;
  }
  return (ranks - positives * (positives + 1) / 2) / (positives * (rows.length - positives));
}

export type Pred = Sample & { p: number };

/** 只保留特征集内全部有限的行；线上模型也只在这些完整样本上拟合。 */
export const completeRows = (keys: FeatureKey[], rows: Sample[]): Sample[] =>
  rows.filter(r => keys.every(k => {
    const v = F[k].pick(r);
    return v !== null && Number.isFinite(v);
  }));

/** 走前验证：只用预测日之前的样本拟合，每 refitEvery 天重拟合。 */
export function walkForwardPooled(keys: FeatureKey[], rows: Sample[], minTrainDays = 25, refitEvery = 10): Pred[] {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const out: Pred[] = [];
  let model: LogisticModel | null = null;
  for (let i = minTrainDays; i < dates.length; i += 1) {
    const date = dates[i];
    if ((i - minTrainDays) % refitEvery === 0) {
      const train = rows.filter(r => r.date < date);
      model = fitLogistic(train.map(r => keys.map(k => F[k].pick(r)) as number[]), train.map(r => r.y));
    }
    for (const row of rows.filter(r => r.date === date)) {
      out.push({ ...row, p: predictLogistic(model!, keys.map(k => F[k].pick(row))) });
    }
  }
  return out;
}

/** 时间序切分：前 65% 训练、后 35% 测试，只拟合一次，用于快速横向筛选。 */
export function splitEval(keys: FeatureKey[], rows: Sample[], ratio = 0.65): Pred[] {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const cutoff = dates[Math.floor(dates.length * ratio)];
  const train = rows.filter(r => r.date < cutoff);
  const test = rows.filter(r => r.date >= cutoff);
  const model = fitLogistic(train.map(r => keys.map(k => F[k].pick(r)) as number[]), train.map(r => r.y));
  return test.map(r => ({ ...r, p: predictLogistic(model, keys.map(k => F[k].pick(r))) }));
}

export function metrics(rows: Pred[], label: string) {
  const days = [...new Set(rows.map(r => r.date))];
  const topN = (n: number) => days.flatMap(d => rows.filter(r => r.date === d).sort((a, b) => b.p - a.p).slice(0, n));
  const tier = (lo: number, hi = 1.01) => rows.filter(r => r.p >= lo && r.p < hi);
  const stat = (set: Pred[]) => set.length === 0 ? null : ({
    n: set.length,
    seal: avg(set.map(r => r.y)),
    touched: avg(set.map(r => r.touched)),
    nextOpen: avg(set.flatMap(r => r.retNextOpen === null ? [] : [r.retNextOpen])),
    sameDay: avg(set.map(r => r.retSameDay)),
  });
  return {
    label, n: rows.length, base: avg(rows.map(r => r.y)), auc: auc(rows),
    brier: avg(rows.map(r => (r.p - r.y) ** 2)),
    t40: stat(tier(0.4)), t50: stat(tier(0.5)), t60: stat(tier(0.6)),
    top1: stat(topN(1)), top3: stat(topN(3)), top5: stat(topN(5)),
  };
}

export const pct = (v: number | null | undefined, digits = 1) => v === null || v === undefined ? '  —  ' : `${(v * 100).toFixed(digits)}%`.padStart(6);
export const num = (v: number | null | undefined, digits = 2) => v === null || v === undefined ? '  —  ' : v.toFixed(digits).padStart(6);

export function row(label: string, m: ReturnType<typeof metrics>): string {
  return [
    label.padEnd(26),
    String(m.n).padStart(5),
    pct(m.auc, 3),
    num(m.brier, 4),
    pct(m.base),
    m.t40 ? `${pct(m.t40.seal)}/${String(m.t40.n).padStart(4)}` : '   —      ',
    m.t50 ? `${pct(m.t50.seal)}/${String(m.t50.n).padStart(4)}` : '   —      ',
    m.t60 ? `${pct(m.t60.seal)}/${String(m.t60.n).padStart(4)}` : '   —      ',
    m.top3 ? pct(m.top3.seal) : '  —  ',
    m.top3 ? num(m.top3.nextOpen) : '  —  ',
  ].join(' ');
}

export const HEADER = [
  '模型'.padEnd(26), '   n ', '  AUC', 'Brier', ' 基准', 'p≥.4 封/条', 'p≥.5 封/条', 'p≥.6 封/条', ' 前3封 ', ' 前3次开',
].join(' ');

