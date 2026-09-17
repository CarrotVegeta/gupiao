/**
 * 用日K自建「涨停历史」，绕开东财涨停池只保留 ~15 个交易日 的限制。
 *
 * 数据源：新浪（股票列表 + 日K，约 7 个月）
 * 输出：scripts/output/limit-up-history.json
 *   days: 每个交易日的涨停/炸板名单 + 情绪指标 + 大盘
 *   ticks: 每个「上一交易日涨停股」次日的可执行收益（T+1）
 *
 * 用法：npx tsx scripts/limit-up-history.ts
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');
mkdirSync(CACHE_DIR, { recursive: true });

const KLINE_DAYS = 140;
const CONCURRENCY = 5;
const MIN_REQUEST_INTERVAL_MS = 120;
const MAX_ATTEMPTS = 6;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let nextSlotAt = 0;
const throttle = async (): Promise<void> => {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = now + wait + MIN_REQUEST_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
};

const fetchTextCached = async (key: string, url: string): Promise<string> => {
  const cachePath = path.join(CACHE_DIR, `${key}.txt`);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf8');
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      await throttle();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.trim().length === 0) throw new Error('empty body');
      writeFileSync(cachePath, text, 'utf8');
      return text;
    } catch (error) {
      lastError = error;
      await sleep(Math.min(500 * 2 ** attempt, 20_000));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed');
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
      done += 1;
      if (done % 400 === 0) {
        console.log(`    进度 ${done}/${values.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
};

type Stock = { symbol: string; name: string; floatShares: number | null };

const fetchUniverse = async (): Promise<Stock[]> => {
  const stocks: Stock[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 80; page += 1) {
    const url =
      'http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      `Market_Center.getHQNodeData?page=${page}&num=100&sort=symbol&asc=1&node=hs_a`;
    let rows: unknown;
    try {
      rows = JSON.parse(await fetchTextCached(`universe-${page}`, url));
    } catch {
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as Record<string, unknown>;
      const symbol = String(record.code ?? '');
      const name = String(record.name ?? '').trim();
      const nmc = Number(record.nmc);
      const trade = Number(record.trade);
      const floatShares =
        Number.isFinite(nmc) && Number.isFinite(trade) && trade > 0 ? (nmc * 10_000) / trade : null;
      if (/^\d{6}$/.test(symbol) && name && !seen.has(symbol)) {
        seen.add(symbol);
        stocks.push({ symbol, name, floatShares });
      }
    }
  }

  return stocks;
};

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

const toSinaSymbol = (symbol: string): string => {
  if (symbol.startsWith('6')) return `sh${symbol}`;
  if (symbol.startsWith('0') || symbol.startsWith('3')) return `sz${symbol}`;
  return `bj${symbol}`;
};

const fetchKline = async (symbol: string): Promise<Bar[]> => {
  const url =
    'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
    `CN_MarketData.getKLineData?symbol=${toSinaSymbol(symbol)}&scale=240&ma=no&datalen=${KLINE_DAYS}`;
  try {
    const text = await fetchTextCached(`sina-k-${symbol}`, url);
    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          date: String(record.day ?? '').replaceAll('-', ''),
          open: Number(record.open),
          high: Number(record.high),
          low: Number(record.low),
          close: Number(record.close),
          volume: Number(record.volume),
        };
      })
      .filter((bar) => /^\d{8}$/.test(bar.date) && Number.isFinite(bar.close) && bar.close > 0);
  } catch {
    return [];
  }
};

/** 涨停幅度：科创板/创业板 20%，北交所 30%，ST 5%，其余 10% */
const limitRatio = (symbol: string, name: string): number => {
  if (/st|\*st/i.test(name)) return 0.05;
  if (symbol.startsWith('688') || symbol.startsWith('30')) return 0.2;
  if (symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92')) return 0.3;
  return 0.1;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

type DayStock = {
  symbol: string;
  name: string;
  pct: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  /** 昨日涨停、今日又涨停的连续天数 */
  board: number;
  /** 一字板（开盘即涨停且全天未打开） */
  oneWord: boolean;
  /** 盘中触及涨停但收盘未封住 */
  broken: boolean;
  /** 今日竞价溢价（开盘 / 昨收 - 1） */
  gapPct: number;
  /** 相对昨日成交量的放量倍数 */
  volumeRatio: number | null;
};

type DaySummary = {
  date: string;
  limitUps: DayStock[];
  brokenCount: number;
  limitUpCount: number;
  multiBoardCount: number;
  /** 昨日涨停股今日平均表现（次日情绪参考，09:25 不可知） */
  indexPct: number | null;
  indexGapPct: number | null;
  indexPrevPct: number | null;
  index5dPct: number | null;
  index20dPct: number | null;
};

const main = async (): Promise<void> => {
  const universe = await fetchUniverse();
  console.log(`股票池 ${universe.length} 只`);

  const names = new Map(universe.map((stock) => [stock.symbol, stock.name]));
  const floatSharesMap = new Map(
    universe.filter((stock) => stock.floatShares !== null).map((stock) => [stock.symbol, stock.floatShares!]),
  );
  const klines = await mapWithConcurrency(universe, CONCURRENCY, (stock) =>
    fetchKline(stock.symbol),
  );
  const covered = klines.filter((bars) => bars.length > 30).length;
  console.log(`K线可用 ${covered}/${universe.length} 只`);

  const barsBySymbol = new Map<string, Bar[]>();
  universe.forEach((stock, index) => {
    if (klines[index].length > 30) barsBySymbol.set(stock.symbol, klines[index]);
  });

  // 交易日历取覆盖最全的个股序列（用上证指数更稳，这里用最长序列的日期集合）
  const dateCount = new Map<string, number>();
  for (const bars of barsBySymbol.values()) {
    for (const bar of bars) dateCount.set(bar.date, (dateCount.get(bar.date) ?? 0) + 1);
  }
  const dates = [...dateCount.entries()]
    .filter(([, count]) => count > barsBySymbol.size * 0.5)
    .map(([date]) => date)
    .sort();

  const indexBars = await fetchKline('000001');
  const indexByDate = new Map(indexBars.map((bar) => [bar.date, bar]));

  // 每个交易日的涨停名单 / 触板名单
  const sealedByDate = new Map<string, DayStock[]>();
  const touchedByDate = new Map<string, DayStock[]>();
  const streak = new Map<string, number>();

  for (const date of dates) {
    const list: DayStock[] = [];

    for (const [symbol, bars] of barsBySymbol) {
      const barIndex = bars.findIndex((bar) => bar.date === date);
      if (barIndex <= 0) continue;
      const bar = bars[barIndex];
      const previous = bars[barIndex - 1];
      if (previous.close <= 0) continue;

      const name = names.get(symbol) ?? '';
      const ratio = limitRatio(symbol, name);
      const limitPrice = round2(previous.close * (1 + ratio));
      const atLimitClose = bar.close >= limitPrice - 0.001;
      const touched = bar.high >= limitPrice - 0.001;
      const pct = Number(((bar.close / previous.close - 1) * 100).toFixed(2));

      const previousBoard = streak.get(symbol) ?? 0;
      if (atLimitClose) {
        streak.set(symbol, previousBoard + 1);
      } else {
        streak.delete(symbol);
      }

      if (!atLimitClose && !touched) continue;

      list.push({
        symbol,
        name,
        pct,
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        board: atLimitClose ? previousBoard + 1 : 0,
        oneWord: atLimitClose && bar.open >= limitPrice - 0.001 && bar.low >= limitPrice - 0.001,
        broken: touched && !atLimitClose,
        gapPct: Number(((bar.open / previous.close - 1) * 100).toFixed(2)),
        volumeRatio:
          previous.volume > 0 ? Number((bar.volume / previous.volume).toFixed(2)) : null,
      });
    }

    sealedByDate.set(
      date,
      list.filter((item) => item.board > 0),
    );
    touchedByDate.set(date, list);
  }

  const flagsBySymbol = new Map<string, boolean[]>();
  for (const [symbol, bars] of barsBySymbol) {
    const ratio = limitRatio(symbol, names.get(symbol) ?? '');
    flagsBySymbol.set(
      symbol,
      bars.map((bar, position) => {
        if (position === 0) return false;
        const previous = bars[position - 1];
        if (previous.close <= 0) return false;
        return bar.close >= round2(previous.close * (1 + ratio)) - 0.001;
      }),
    );
  }

  const indexReturn = (
    map: Map<string, Bar>,
    dayList: string[],
    endIndex: number,
    back: number,
  ): number | null => {
    const end = dayList[endIndex];
    const start = dayList[endIndex - back];
    if (!end || !start) return null;
    const endBar = map.get(end);
    const startBar = map.get(start);
    if (!endBar || !startBar || startBar.close <= 0) return null;
    return Number(((endBar.close / startBar.close - 1) * 100).toFixed(2));
  };

  const days: DaySummary[] = [];
  for (const date of dates) {
    const list = sealedByDate.get(date) ?? [];
    const touchedList = touchedByDate.get(date) ?? [];
    const barIndex = dates.indexOf(date);
    const indexBar = indexByDate.get(date);
    const prevIndexBar = barIndex > 0 ? indexByDate.get(dates[barIndex - 1]) : undefined;
    const prevPrevIndexBar = barIndex > 1 ? indexByDate.get(dates[barIndex - 2]) : undefined;

    days.push({
      date,
      limitUps: list,
      limitUpCount: list.length,
      brokenCount: touchedList.filter((item) => item.broken).length,
      multiBoardCount: list.filter((item) => item.board >= 2).length,
      indexPct: indexBar && prevIndexBar ? Number(((indexBar.close / prevIndexBar.close - 1) * 100).toFixed(2)) : null,
      indexGapPct: indexBar && prevIndexBar ? Number(((indexBar.open / prevIndexBar.close - 1) * 100).toFixed(2)) : null,
      indexPrevPct:
        prevIndexBar && prevPrevIndexBar
          ? Number(((prevIndexBar.close / prevPrevIndexBar.close - 1) * 100).toFixed(2))
          : null,
      index5dPct: indexReturn(indexByDate, dates, barIndex - 1, 5),
      index20dPct: indexReturn(indexByDate, dates, barIndex - 1, 20),
    });
  }

  // 次日可执行收益：上一交易日涨停股 → 今日竞价买入 → 次日卖出
  type Tick = {
    date: string;
    symbol: string;
    name: string;
    board: number;
    /** 昨日竞价溢价 */
    prevGapPct: number;
    /** 昨日是否一字板 */
    prevOneWord: boolean;
    /** 昨日换手率 %（按流通股本估算） */
    prevTurnover: number | null;
    /** 昨日成交量 / 前5日均量（缩量涨停是好信号） */
    prevShrink: number | null;
    /** 流通市值（亿元，按昨收估算） */
    floatCap: number | null;
    /** 近 10 个交易日涨停次数（含昨日） */
    limitCount10: number;
    /** 本波涨停簇跨度：从最近一次中断之后的第一个涨停到今天 */
    ztSpan: number;
    /** 昨日收盘相对 20 个交易日前的涨幅 % */
    pct20: number | null;
    /** 昨日收盘距离近 60 日最高价 % */
    distHigh60: number | null;
    /** 昨日振幅 % */
    prevAmplitude: number | null;
    /** 昨日炸板率 %（炸板 / (涨停 + 炸板)） */
    prevBrokenRatio: number | null;
    gapPct: number;
    oneWord: boolean;
    prevLimitCount: number;
    prevBrokenCount: number;
    prevMultiBoard: number;
    indexGapPct: number | null;
    indexPrevPct: number | null;
    index5dPct: number | null;
    index20dPct: number | null;
    sealedToday: boolean;
    touchedToday: boolean;
    retSameDay: number;
    retNextOpen: number | null;
    retNextClose: number | null;
    mfe: number;
    mae: number;
  };

  const ticks: Tick[] = [];

  for (let index = 1; index < dates.length; index += 1) {
    const date = dates[index];
    const previousDate = dates[index - 1];
    const nextDate = dates[index + 1];
    const previousDay = days.find((day) => day.date === previousDate);
    const todayDay = days.find((day) => day.date === date);
    if (!previousDay || !todayDay) continue;

    const todaySealed = new Set(todayDay.limitUps.map((item) => item.symbol));
    const todayTouched = new Set((touchedByDate.get(date) ?? []).map((item) => item.symbol));

    for (const candidate of previousDay.limitUps) {
      const bars = barsBySymbol.get(candidate.symbol);
      if (!bars) continue;
      const barIndex = bars.findIndex((bar) => bar.date === date);
      if (barIndex <= 0) continue;
      const today = bars[barIndex];
      const tomorrow = nextDate ? bars.find((bar) => bar.date === nextDate) : undefined;
      if (today.open <= 0) continue;

      const previousBar = bars[barIndex - 1];
      const previousClose = previousBar.close;
      const gapPct = Number(((today.open / previousClose - 1) * 100).toFixed(2));
      const prevPrevClose = barIndex >= 2 ? bars[barIndex - 2].close : null;
      const prevGapPct =
        prevPrevClose && prevPrevClose > 0
          ? Number(((previousBar.open / prevPrevClose - 1) * 100).toFixed(2))
          : 0;
      const history5 = bars.slice(Math.max(0, barIndex - 6), barIndex - 1);
      const avgVolume5 =
        history5.length > 0 ? history5.reduce((total, bar) => total + bar.volume, 0) / history5.length : null;
      const floatShares = floatSharesMap.get(candidate.symbol) ?? null;
      const flags = flagsBySymbol.get(candidate.symbol) ?? [];
      const previousIndex = barIndex - 1;
      const limitCount10 = flags
        .slice(Math.max(0, previousIndex - 9), previousIndex + 1)
        .filter(Boolean).length;

      let firstLimitIndex = previousIndex;
      for (let cursor = previousIndex - 1; cursor >= 0; cursor -= 1) {
        if (flags[cursor]) {
          firstLimitIndex = cursor;
          continue;
        }
        // 连续两个交易日没有涨停就认为这一波结束
        if (cursor - 1 < 0 || !flags[cursor - 1]) break;
      }
      const ztSpan = previousIndex - firstLimitIndex + 1;
      const pct20 =
        previousIndex >= 20 && bars[previousIndex - 20].close > 0
          ? Number(((previousBar.close / bars[previousIndex - 20].close - 1) * 100).toFixed(2))
          : null;
      const window60 = bars.slice(Math.max(0, previousIndex - 59), previousIndex + 1);
      const high60 = window60.reduce((max, bar) => Math.max(max, bar.high), 0);
      const distHigh60 =
        high60 > 0 ? Number(((previousBar.close / high60 - 1) * 100).toFixed(2)) : null;
      const prevAmplitude =
        prevPrevClose && prevPrevClose > 0
          ? Number((((previousBar.high - previousBar.low) / prevPrevClose) * 100).toFixed(2))
          : null;
      const prevBrokenRatio =
        previousDay.limitUpCount + previousDay.brokenCount > 0
          ? Number(
              (
                (previousDay.brokenCount / (previousDay.limitUpCount + previousDay.brokenCount)) *
                100
              ).toFixed(2),
            )
          : null;

      ticks.push({
        date,
        symbol: candidate.symbol,
        name: candidate.name,
        board: candidate.board,
        prevGapPct,
        prevOneWord: candidate.oneWord,
        // 新浪日K的 volume 单位是股
        prevTurnover:
          floatShares && floatShares > 0
            ? Number(((previousBar.volume / floatShares) * 100).toFixed(2))
            : null,
        prevShrink:
          avgVolume5 && avgVolume5 > 0 ? Number((previousBar.volume / avgVolume5).toFixed(2)) : null,
        floatCap: floatShares ? Number(((floatShares * previousBar.close) / 100_000_000).toFixed(1)) : null,
        limitCount10,
        ztSpan,
        pct20,
        distHigh60,
        prevAmplitude,
        prevBrokenRatio,
        gapPct,
        oneWord: candidate.oneWord,
        prevLimitCount: previousDay.limitUpCount,
        prevBrokenCount: previousDay.brokenCount,
        prevMultiBoard: previousDay.multiBoardCount,
        indexGapPct: todayDay.indexGapPct,
        indexPrevPct: previousDay.indexPct,
        index5dPct: previousDay.index5dPct,
        index20dPct: previousDay.index20dPct,
        sealedToday: todaySealed.has(candidate.symbol),
        touchedToday: todayTouched.has(candidate.symbol),
        retSameDay: Number(((today.close / today.open - 1) * 100).toFixed(2)),
        retNextOpen: tomorrow ? Number(((tomorrow.open / today.open - 1) * 100).toFixed(2)) : null,
        retNextClose: tomorrow ? Number(((tomorrow.close / today.open - 1) * 100).toFixed(2)) : null,
        mfe: Number(((today.high / today.open - 1) * 100).toFixed(2)),
        mae: Number(((today.low / today.open - 1) * 100).toFixed(2)),
      });
    }
  }

  // 涨停当日全样本：用于「尾盘打板买涨停价」的可执行口径
  const sealedRows: Array<{
    date: string;
    symbol: string;
    name: string;
    board: number;
    oneWord: boolean;
    gapPct: number;
    close: number;
    nextOpen: number | null;
    nextClose: number | null;
  }> = [];

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const nextDate = dates[index + 1];
    for (const item of sealedByDate.get(date) ?? []) {
      const bars = barsBySymbol.get(item.symbol);
      if (!bars) continue;
      const barIndex = bars.findIndex((bar) => bar.date === date);
      if (barIndex < 0) continue;
      const tomorrow = nextDate ? bars.find((bar) => bar.date === nextDate) : undefined;
      sealedRows.push({
        date,
        symbol: item.symbol,
        name: item.name,
        board: item.board,
        oneWord: item.oneWord,
        gapPct: item.gapPct,
        close: item.close,
        nextOpen: tomorrow ? Number(((tomorrow.open / item.close - 1) * 100).toFixed(2)) : null,
        nextClose: tomorrow ? Number(((tomorrow.close / item.close - 1) * 100).toFixed(2)) : null,
      });
    }
  }

  const outputPath = path.join(process.cwd(), 'scripts/output', 'limit-up-history.json');
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dates,
        days: days.map((day) => ({
          date: day.date,
          limitUpCount: day.limitUpCount,
          brokenCount: day.brokenCount,
          multiBoardCount: day.multiBoardCount,
          indexPct: day.indexPct,
          indexGapPct: day.indexGapPct,
          indexPrevPct: day.indexPrevPct,
        })),
        ticks,
        sealed: sealedRows,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`\n交易日 ${dates.length} 天（${dates[0]} ~ ${dates.at(-1)}）`);
  console.log(`样本 ${ticks.length} 条，涨停当日样本 ${sealedRows.length} 条 → ${outputPath}`);
};

await main();
