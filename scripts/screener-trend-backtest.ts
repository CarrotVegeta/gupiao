/**
 * 「主线板块 × 趋势形态」回测
 *
 * 要回答的问题：
 *   用户给的趋势形态条件（5/10/20 日线多头、连续站稳 5 日线、回调缩量、
 *   距 5 日线 ≤4%、近期涨幅 ≤20%）单独用没有优势 —— 这一点已由
 *   scripts/watch-timing-lab.ts 在 39.5 万样本上验证过（T+1/T+2/T+3 全部落在 ±0.2% 内、t<1）。
 *
 *   但用户的原话是「**主线板块里**找……」。真正没被验证过的是
 *   「主线板块 × 趋势形态」这个交互项。本脚本就测它。
 *
 * 口径：
 *   - 判定用 t 日收盘，买入 t 日收盘价，卖出 t+k 日收盘价（与 watch-timing-lab 一致）
 *   - 超额 = 当日组内均值 − 当日全市场均值，再对这条日度差值序列做 t 检验
 *     （同日相对，避免把「这段时间市场整体在涨」误当成信号）
 *   - 按 70% / 30% 切训练段与验证段，两段都要看
 *
 * 数据（本地缓存；板块归属首次运行抓取后落盘，之后离线可复跑）：
 *   scripts/output/cache/sina-k-*.txt      全市场日K（5564 只 × 140 交易日）
 *   scripts/output/limit-up-history.json   自建历史涨停名单（sealed）
 *   scripts/output/cache/em-board-*.json   东财概念/行业板块列表
 *   scripts/output/cache/f10-boards-*.json 东财 F10「股票 → 所属板块」
 *
 * 用法：npx tsx scripts/screener-trend-backtest.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type SealedRow = { date: string; symbol: string; name: string; board: number };
type LimitUpHistory = { dates: string[]; sealed: SealedRow[] };

const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');
const HISTORY_PATH = path.resolve(process.cwd(), 'scripts/output/limit-up-history.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/output/screener-trend-backtest.json');

// ---- 形态口径（= 用户原话） ----
const MA_SHORT = 5;
const MA_MID = 10;
const MA_LONG = 20;
const MIN_STABLE_DAYS = 3;
const MAX_MA5_DIST = 0.04;
const PCT_WINDOW = 10;
const MAX_PCT = 0.2;
const WARMUP = 25;
const MAX_HORIZON = 10;

// ---- 主线板块口径 ----
const MAIN_MIN_LIMIT_UP = 5;
const MAIN_MIN_DURATION = 3;
const MAIN_DAILY_FLOOR = 2;
/** 纯正板块成员数上限：超过这个规模的「板块」是宽口径属性题材（如央国企改革 1444 只），不是主线 */
const MAX_BOARD_SIZE = 800;
/** 主线候选的对照档：阈值 / 是否要求当日涨停家数进前 N（null = 不要求） */
const MAIN_VARIANTS = [
  { key: 'A', label: 'A 家数≥5 + 持续≥3', minCount: 5, topN: null },
  { key: 'B', label: 'B 家数≥8 + 持续≥3', minCount: 8, topN: null },
  { key: 'C', label: 'C 家数≥5 + 持续≥3 + 当日前10', minCount: 5, topN: 10 },
] as const;

const TRAIN_RATIO = 0.7;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - m) ** 2, 0) / (values.length - 1));
};

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// 一、本地数据
// ---------------------------------------------------------------------------

const loadBars = (): Map<string, Bar[]> => {
  const result = new Map<string, Bar[]>();
  for (const file of readdirSync(CACHE_DIR).filter((name) => name.startsWith('sina-k-'))) {
    const symbol = file.slice('sina-k-'.length, 'sina-k-'.length + 6);
    if (!/^\d{6}$/.test(symbol)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path.join(CACHE_DIR, file), 'utf8'));
      if (!Array.isArray(parsed)) continue;
      const bars = parsed
        .map((raw): Bar | null => {
          if (!isRecord(raw)) return null;
          const bar: Bar = {
            date: String(raw.day ?? '').replaceAll('-', ''),
            open: Number(raw.open),
            high: Number(raw.high),
            low: Number(raw.low),
            close: Number(raw.close),
            volume: Number(raw.volume),
          };
          return Number.isFinite(bar.close) && bar.close > 0 ? bar : null;
        })
        .filter((bar): bar is Bar => bar !== null);
      if (bars.length > WARMUP + MAX_HORIZON) result.set(symbol, bars);
    } catch {
      // 坏缓存文件跳过
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// 二、抓东财板块列表 + F10 板块归属（落盘缓存）
// ---------------------------------------------------------------------------

const fetchJsonCached = async (key: string, url: string): Promise<unknown> => {
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
      await sleep(120);
      return payload;
    } catch (error) {
      lastError = error;
      await sleep(Math.min(400 * 2 ** attempt, 8_000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`抓取失败 ${key}：${lastError instanceof Error ? lastError.message : '未知错误'}`);
};

/** 东财板块列表（概念 + 行业）：把 F10 的 BOARD_CODE 限定在真实板块内 */
const fetchBoardCatalog = async (): Promise<Map<string, string>> => {
  const catalog = new Map<string, string>();
  const kinds: Array<[string, string]> = [
    ['concept', 'm:90+t:3'],
    ['industry', 'm:90+t:2'],
  ];

  for (const [label, filter] of kinds) {
    for (let page = 1; page <= 12; page += 1) {
      const url =
        'https://push2delay.eastmoney.com/api/qt/clist/get?' +
        new URLSearchParams({
          pn: String(page),
          pz: '100',
          po: '1',
          np: '1',
          fltt: '2',
          invt: '2',
          fid: 'f3',
          fs: filter,
          fields: 'f12,f14',
        }).toString();
      const payload = await fetchJsonCached(`em-board-${label}-p${page}`, url);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const diff = data && Array.isArray(data.diff) ? data.diff : [];
      if (diff.length === 0) break;
      for (const row of diff) {
        if (!isRecord(row)) continue;
        const code = String(row.f12 ?? '').trim();
        const name = String(row.f14 ?? '').trim();
        if (/^BK\d{4}$/.test(code) && name) catalog.set(code, name);
      }
      if (diff.length < 100) break;
    }
  }
  return catalog;
};

/** F10 的 BOARD_CODE（"900"）→ clist 的板块代码（"BK0900"） */
const toBoardCode = (raw: string): string => `BK${raw.padStart(4, '0')}`;

/** 批量抓「股票 → 所属板块」，50 只一批；返回 symbol → 全市场快照里的名称 */
const loadUniverseNames = (): Map<string, string> => {
  const names = new Map<string, string>();
  for (const file of readdirSync(CACHE_DIR).filter((name) => name.startsWith('universe-'))) {
    try {
      const rows: unknown = JSON.parse(readFileSync(path.join(CACHE_DIR, file), 'utf8'));
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const code = String(row.code ?? '').trim();
        const name = String(row.name ?? '').trim();
        if (/^\d{6}$/.test(code) && name) names.set(code, name);
      }
    } catch {
      // 跳过坏文件
    }
  }
  return names;
};

const fetchSymbolBoards = async (symbols: string[]): Promise<Map<string, string[]>> => {
  const BATCH_SIZE = 50;
  const result = new Map<string, string[]>();

  for (let offset = 0; offset < symbols.length; offset += BATCH_SIZE) {
    const batch = symbols.slice(offset, offset + BATCH_SIZE);
    const filter = `(SECURITY_CODE in (${batch.map((s) => `"${s}"`).join(',')}))`;
    const key = `f10-boards-${String(offset).padStart(5, '0')}`;
    const rows: Array<Record<string, unknown>> = [];

    for (let page = 1; page <= 8; page += 1) {
      const url =
        'https://datacenter.eastmoney.com/securities/api/data/v1/get?' +
        new URLSearchParams({
          reportName: 'RPT_F10_CORETHEME_BOARDTYPE',
          columns: 'SECURITY_CODE,BOARD_CODE,BOARD_NAME,IS_PRECISE',
          filter,
          pageNumber: String(page),
          pageSize: '500',
          source: 'HSF10',
          client: 'PC',
        }).toString();
      const payload = await fetchJsonCached(`${key}-p${page}`, url);
      const root = isRecord(payload) && isRecord(payload.result) ? payload.result : null;
      const data = root && Array.isArray(root.data) ? root.data : [];
      const pages = root ? Number(root.pages ?? 1) : 1;
      for (const row of data) if (isRecord(row)) rows.push(row);
      if (page >= pages || data.length === 0) break;
    }

    for (const row of rows) {
      const symbol = String(row.SECURITY_CODE ?? '').trim();
      const boardRaw = String(row.BOARD_CODE ?? '').trim();
      if (!/^\d{6}$/.test(symbol) || !/^\d+$/.test(boardRaw)) continue;
      if (String(row.IS_PRECISE ?? '') !== '1') continue;
      const list = result.get(symbol) ?? [];
      list.push(toBoardCode(boardRaw));
      result.set(symbol, list);
    }

    process.stdout.write(`\r  F10 抓取 ${Math.min(offset + BATCH_SIZE, symbols.length)}/${symbols.length}`);
  }
  process.stdout.write('\n');

  for (const [symbol, list] of result) result.set(symbol, [...new Set(list)]);
  return result;
};

// ---------------------------------------------------------------------------
// 三、趋势形态判定（纯函数，与线上判定共用同一套口径）
// ---------------------------------------------------------------------------

const countStableDays = (closes: number[]): number => {
  let days = 0;
  for (let end = closes.length; end >= MA_SHORT; end -= 1) {
    if (closes[end - 1] >= mean(closes.slice(end - MA_SHORT, end))) days += 1;
    else break;
  }
  return days;
};

type PatternState = {
  ma5: number;
  ma10: number;
  ma20: number;
  distMa5: number;
  stableDays: number;
  shrink: number;
  pctWindow: number;
};

const matchPattern = (closes: number[], volumes: number[]): PatternState | null => {
  if (closes.length < Math.max(MA_LONG, PCT_WINDOW + 1)) return null;

  const last = closes[closes.length - 1];
  const ma5 = mean(closes.slice(-MA_SHORT));
  const ma10 = mean(closes.slice(-MA_MID));
  const ma20 = mean(closes.slice(-MA_LONG));
  if (!(ma5 > ma10 && ma10 > ma20)) return null;

  const stableDays = countStableDays(closes);
  if (stableDays < MIN_STABLE_DAYS) return null;

  const distMa5 = last / ma5 - 1;
  if (Math.abs(distMa5) > MAX_MA5_DIST) return null;

  const base = closes[closes.length - 1 - PCT_WINDOW];
  if (!(base > 0)) return null;
  const pctWindow = last / base - 1;
  if (pctWindow > MAX_PCT) return null;

  const previous5 = volumes.slice(-6, -1);
  if (previous5.length < 5) return null;
  const avgPrev5 = mean(previous5);
  if (!(avgPrev5 > 0)) return null;
  const shrink = volumes[volumes.length - 1] / avgPrev5;
  if (!(shrink < 1)) return null;

  return {
    ma5,
    ma10,
    ma20,
    distMa5: round(distMa5 * 100, 2),
    stableDays,
    shrink: round(shrink, 4),
    pctWindow: round(pctWindow * 100, 2),
  };
};

// ---------------------------------------------------------------------------
// 四、累计统计（按 日期 × 分组 × 持有期），不把几十万行样本留在内存里
// ---------------------------------------------------------------------------

type Acc = { sum: Float64Array; count: Int32Array; win: Int32Array };
const newAcc = (): Acc => ({
  sum: new Float64Array(MAX_HORIZON),
  count: new Int32Array(MAX_HORIZON),
  win: new Int32Array(MAX_HORIZON),
});

const add = (acc: Acc, horizon: number, value: number): void => {
  acc.sum[horizon] += value;
  acc.count[horizon] += 1;
  if (value > 0) acc.win[horizon] += 1;
};

const main = async (): Promise<void> => {
  console.log('读取本地日K…');
  const bars = loadBars();
  console.log(`  股票数 ${bars.size}`);

  const history: LimitUpHistory = JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) as LimitUpHistory;
  const dates = history.dates;
  const limitUpSymbolsByDate = new Map<string, Set<string>>();
  for (const row of history.sealed) {
    const set = limitUpSymbolsByDate.get(row.date) ?? new Set<string>();
    set.add(row.symbol);
    limitUpSymbolsByDate.set(row.date, set);
  }
  console.log(`  交易日 ${dates.length}（${dates[0]} → ${dates.at(-1)}），涨停样本 ${history.sealed.length}`);

  console.log('读取东财板块列表…');
  const catalog = await fetchBoardCatalog();
  console.log(`  板块 ${catalog.size} 个`);

  console.log('抓取 F10 纯正板块归属（IS_PRECISE=1）…');
  const symbols = [...bars.keys()];
  const rawBoards = await fetchSymbolBoards(symbols);
  const boardSize = new Map<string, number>();
  for (const list of rawBoards.values()) {
    for (const board of list) boardSize.set(board, (boardSize.get(board) ?? 0) + 1);
  }
  const symbolBoards = new Map<string, string[]>();
  for (const [symbol, list] of rawBoards) {
    const kept = list.filter(
      (board) => catalog.has(board) && (boardSize.get(board) ?? 0) <= MAX_BOARD_SIZE,
    );
    if (kept.length > 0) symbolBoards.set(symbol, kept);
  }
  const names = loadUniverseNames();
  const dropped = [...boardSize.entries()]
    .filter(([board, size]) => catalog.has(board) && size > MAX_BOARD_SIZE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`  有可用板块归属的股票 ${symbolBoards.size} / ${symbols.length}；名称 ${names.size} 个`);
  console.log(
    `  因规模 >${MAX_BOARD_SIZE} 被剔除的宽口径板块示例：` +
      dropped.map(([board, size]) => `${catalog.get(board)}(${size})`).join('、'),
  );

  // 每个交易日的「板块 → 涨停家数」
  const countsByDate = new Map<string, Map<string, number>>();
  for (const date of dates) {
    const counts = new Map<string, number>();
    for (const symbol of limitUpSymbolsByDate.get(date) ?? []) {
      for (const board of symbolBoards.get(symbol) ?? []) {
        counts.set(board, (counts.get(board) ?? 0) + 1);
      }
    }
    countsByDate.set(date, counts);
  }

  /** 某板块从 dateIndex 往回连续满足「每日涨停家数 ≥ MAIN_DAILY_FLOOR」的天数 */
  const durationOf = (board: string, dateIndex: number): number => {
    let duration = 1;
    for (let back = 1; back <= 8; back += 1) {
      const index = dateIndex - back;
      if (index < 0) break;
      if ((countsByDate.get(dates[index])?.get(board) ?? 0) >= MAIN_DAILY_FLOOR) duration += 1;
      else break;
    }
    return duration;
  };

  /** 每个变体给出各自的主线板块集合；同时给出支线集合（家数 2~4 且不在任何主线变体里） */
  const judgeBoards = (dateIndex: number) => {
    const today = countsByDate.get(dates[dateIndex]) ?? new Map<string, number>();
    const ranked = [...today.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([board]) => board);
    const topByVariant = new Map<string, Set<string>>();
    for (const variant of MAIN_VARIANTS) {
      topByVariant.set(
        variant.key,
        new Set(variant.topN === null ? [] : ranked.slice(0, variant.topN)),
      );
    }

    const result = new Map<string, Set<string>>();
    const mainUnion = new Set<string>();
    for (const variant of MAIN_VARIANTS) {
      const set = new Set<string>();
      for (const [board, count] of today) {
        if (count < variant.minCount) continue;
        if (variant.topN !== null && !topByVariant.get(variant.key)!.has(board)) continue;
        if (durationOf(board, dateIndex) < MAIN_MIN_DURATION) continue;
        set.add(board);
        mainUnion.add(board);
      }
      result.set(variant.key, set);
    }

    const branch = new Set<string>();
    for (const [board, count] of today) {
      if (count >= 2 && count <= 4 && !mainUnion.has(board)) branch.add(board);
    }
    result.set('branch', branch);
    return result;
  };

  const indexBySymbol = new Map<string, Map<string, number>>();
  for (const [symbol, list] of bars) {
    const map = new Map<string, number>();
    list.forEach((bar, index) => map.set(bar.date, index));
    indexBySymbol.set(symbol, map);
  }

  const GROUP_KEYS = [
    'market-all',
    'market-pattern',
    ...MAIN_VARIANTS.flatMap((v) => [`${v.key}-all`, `${v.key}-pattern`]),
    'branch-pattern',
  ];

  console.log('逐日回测…');
  const daily = new Map<string, Map<string, Acc>>();
  const variantBoardDays = new Map<string, Map<string, number>>();
  const variantPoolSize = new Map<string, number[]>();
  const patternStats: Array<{ distMa5: number; stableDays: number; shrink: number; pctWindow: number }> = [];

  for (let dateIndex = WARMUP; dateIndex < dates.length - 1; dateIndex += 1) {
    const date = dates[dateIndex];
    const boardSets = judgeBoards(dateIndex);
    const limitUpToday = limitUpSymbolsByDate.get(date) ?? new Set<string>();

    for (const [key, set] of boardSets) {
      const counter = variantBoardDays.get(key) ?? new Map<string, number>();
      for (const board of set) counter.set(board, (counter.get(board) ?? 0) + 1);
      variantBoardDays.set(key, counter);
    }

    const perGroup = new Map<string, Acc>();
    for (const key of GROUP_KEYS) perGroup.set(key, newAcc());
    const poolCount = new Map<string, number>();
    for (const variant of MAIN_VARIANTS) poolCount.set(variant.key, 0);

    for (const symbol of symbolBoards.keys()) {
      const list = bars.get(symbol);
      const index = indexBySymbol.get(symbol)?.get(date);
      if (!list || index === undefined) continue;
      if (index < WARMUP || index + MAX_HORIZON >= list.length) continue;

      const window = list.slice(index - 60, index + 1);
      const closes = window.map((bar) => bar.close);
      const volumes = window.map((bar) => bar.volume);
      const state = matchPattern(closes, volumes);
      const boards = symbolBoards.get(symbol) ?? [];

      const inVariant = new Map<string, boolean>();
      for (const variant of MAIN_VARIANTS) {
        const hit = boards.some((board) => boardSets.get(variant.key)!.has(board));
        inVariant.set(variant.key, hit);
        if (hit) poolCount.set(variant.key, (poolCount.get(variant.key) ?? 0) + 1);
      }
      const inBranch = boards.some((board) => boardSets.get('branch')!.has(board));

      const entry = list[index].close;
      if (!(entry > 0)) continue;

      for (let k = 1; k <= MAX_HORIZON; k += 1) {
        const value = (list[index + k].close / entry - 1) * 100;
        add(perGroup.get('market-all')!, k - 1, value);
        if (state) add(perGroup.get('market-pattern')!, k - 1, value);
        for (const variant of MAIN_VARIANTS) {
          if (inVariant.get(variant.key)) add(perGroup.get(`${variant.key}-all`)!, k - 1, value);
          if (inVariant.get(variant.key) && state) add(perGroup.get(`${variant.key}-pattern`)!, k - 1, value);
        }
        if (inBranch && state) add(perGroup.get('branch-pattern')!, k - 1, value);
      }

      if (state) patternStats.push(state);
    }

    for (const variant of MAIN_VARIANTS) {
      const list = variantPoolSize.get(variant.key) ?? [];
      list.push(poolCount.get(variant.key) ?? 0);
      variantPoolSize.set(variant.key, list);
    }
    daily.set(date, perGroup);
  }

  const allDates = [...daily.keys()];
  const splitIndex = Math.floor(allDates.length * TRAIN_RATIO);
  const segments = [
    { label: '全段', dates: allDates },
    { label: '训练段', dates: allDates.slice(0, splitIndex) },
    { label: '验证段', dates: allDates.slice(splitIndex) },
  ];

  const summarize = (key: string, segmentDates: string[]) => {
    const cells = [];
    for (let k = 0; k < MAX_HORIZON; k += 1) {
      const groupMeans: number[] = [];
      const marketMeans: number[] = [];
      let samples = 0;
      let wins = 0;
      for (const date of segmentDates) {
        const perGroup = daily.get(date);
        if (!perGroup) continue;
        const group = perGroup.get(key);
        const market = perGroup.get('market-all');
        if (!group || !market || group.count[k] === 0) continue;
        groupMeans.push(group.sum[k] / group.count[k]);
        marketMeans.push(market.sum[k] / market.count[k]);
        samples += group.count[k];
        wins += group.win[k];
      }
      const excess = groupMeans.map((value, i) => value - (marketMeans[i] ?? 0));
      const sd = stdev(excess);
      cells.push({
        horizon: k + 1,
        samples,
        days: groupMeans.length,
        absolute: round(mean(groupMeans), 4),
        excess: round(mean(excess), 4),
        t: excess.length >= 5 && sd > 0 ? round(mean(excess) / (sd / Math.sqrt(excess.length)), 2) : null,
        winRate: samples > 0 ? round((wins / samples) * 100, 2) : null,
      });
    }
    return cells;
  };

  const groupTitles: Array<{ key: string; title: string }> = [
    { key: 'market-pattern', title: '① 全市场 · 命中趋势形态' },
    ...MAIN_VARIANTS.map((v) => ({ key: `${v.key}-all`, title: `②${v.key} 主线(${v.label}) · 全部股票` })),
    ...MAIN_VARIANTS.map((v) => ({
      key: `${v.key}-pattern`,
      title: `③${v.key} 主线(${v.label}) · 命中趋势形态  ★`,
    })),
    { key: 'branch-pattern', title: '④ 支线板块(2~4家) · 命中趋势形态' },
  ];

  const report: Array<{ title: string; segments: Record<string, unknown> }> = [];
  const printCells = (cells: ReturnType<typeof summarize>): void => {
    for (const cell of cells) {
      console.log(
        `    T+${String(cell.horizon).padStart(2)}  n=${String(cell.samples).padStart(7)}  ` +
          `超额 ${cell.excess.toFixed(3).padStart(7)}%  t=${String(cell.t ?? '—').padStart(6)}  ` +
          `绝对 ${cell.absolute.toFixed(3).padStart(7)}%  胜率 ${String(cell.winRate ?? '—').padStart(6)}%`,
      );
    }
  };

  console.log('\n================ 结果（超额 = 相对当日全市场等权，单位 %） ================');
  for (const segment of segments) {
    console.log(`\n########## ${segment.label}（${segment.dates.length} 个交易日） ##########`);
    for (const group of groupTitles) {
      const cells = summarize(group.key, segment.dates);
      console.log(`\n${group.title}`);
      printCells(cells);
      const found = report.find((item) => item.title === group.title);
      if (found) found.segments[segment.label] = cells;
      else report.push({ title: group.title, segments: { [segment.label]: cells } });
    }
  }

  console.log('\n================ 主线板块判定标定 ================');
  console.log(`剔除条件：仅 IS_PRECISE=1（题材纯正），且纯正成员数 ≤ ${MAX_BOARD_SIZE}`);
  for (const variant of [...MAIN_VARIANTS.map((v) => ({ key: v.key, label: v.label })), { key: 'branch', label: '支线 家数2~4' }]) {
    const counter = variantBoardDays.get(variant.key);
    const boards = counter ? counter.size : 0;
    const perDay = counter
      ? [...counter.values()].reduce((a, b) => a + b, 0) / daily.size
      : 0;
    const pool = variantPoolSize.get(variant.key);
    const poolAvg = pool ? mean(pool) : 0;
    console.log(
      `\n${variant.label}\n  去重板块 ${boards} 个 · 平均每天 ${perDay.toFixed(2)} 个 · ` +
        `平均每天主线池 ${poolAvg.toFixed(0)} 只（占 ${((poolAvg / symbolBoards.size) * 100).toFixed(1)}%）`,
    );
    if (counter) {
      const top = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      console.log('  上榜最多的板块：' + top.map(([b, d]) => `${catalog.get(b) ?? b}(${d}天/成员${boardSize.get(b) ?? 0})`).join('、'));
    }
  }

  const quantile = (values: number[], q: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))], 3);
  };
  console.log('\n================ 命中样本的形态分布 ================');
  console.log(`命中样本数（股票 × 交易日）= ${patternStats.length}`);
  for (const field of ['distMa5', 'stableDays', 'shrink', 'pctWindow'] as const) {
    const values = patternStats.map((s) => s[field]);
    console.log(
      `  ${field.padEnd(12)} p10=${quantile(values, 0.1)}  p50=${quantile(values, 0.5)}  p90=${quantile(values, 0.9)}`,
    );
  }

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        config: {
          MIN_STABLE_DAYS,
          MAX_MA5_DIST,
          PCT_WINDOW,
          MAX_PCT,
          MAIN_MIN_DURATION,
          MAIN_DAILY_FLOOR,
          MAX_BOARD_SIZE,
          MAIN_VARIANTS,
        },
        tradeDates: allDates.length,
        groups: report,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n结果写入 ${OUTPUT_PATH}`);
};

mkdirSync(CACHE_DIR, { recursive: true });
main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
