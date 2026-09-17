/**
 * 「观察」板块的当日买入判定
 *
 * 结论来自全市场 422338 个「股票×交易日」样本的回测（scripts/watch-signal-lab.ts）：
 * 直觉上的买强条件（均线多头、放量、红盘、收在当日高位）在 A 股隔日口径下**全部无效甚至反向**，
 * 唯一有正期望的是「今日封板」，另外有几个条件有统计显著的负期望，值得作为规避信号。
 *
 * 口径：尾盘做判定、尾盘价买入，次日收盘卖出。收益数字均不含手续费。
 */
import type { WatchCheckItem, WatchCheckResponse, WatchVerdict } from '../../src/types.js';

const REQUEST_TIMEOUT_MS = 8_000;
const KLINE_DAYS = 90;
const QUOTE_BATCH_SIZE = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const fetchWithTimeout = async (url: string, fetchImpl: typeof fetch): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const toTencentSymbol = (symbol: string): string =>
  symbol.startsWith('6') ? `sh${symbol}` : symbol.startsWith('0') || symbol.startsWith('3') ? `sz${symbol}` : `bj${symbol}`;

/** 涨停幅度：ST 5%，科创板/创业板 20%，北交所 30%，其余 10% */
export const limitUpPct = (symbol: string, name: string): number => {
  if (/st|\*st/i.test(name)) return 5;
  if (symbol.startsWith('688') || symbol.startsWith('30')) return 20;
  if (symbol.startsWith('8') || symbol.startsWith('4') || symbol.startsWith('92')) return 30;
  return 10;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** 六个因子标准化后取负相加；任一因子缺失则该项按 0 计入（等于取市场平均） */
const scoreOf = (factors: Record<string, number | null>): number => {
  let total = 0;
  for (const factor of AMBUSH_FACTORS) {
    const value = factors[factor.key];
    total += value === null || !Number.isFinite(value) ? 0 : (value - factor.mean) / factor.std;
  }
  return Number((-total / AMBUSH_FACTORS.length).toFixed(4));
};

type Quote = {
  symbol: string;
  name: string;
  price: number | null;
  preClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  pct: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  floatMarketCapYi: number | null;
};

export const fetchWatchQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, Quote>> => {
  const result = new Map<string, Quote>();

  for (let offset = 0; offset < symbols.length; offset += QUOTE_BATCH_SIZE) {
    const batch = symbols.slice(offset, offset + QUOTE_BATCH_SIZE).map(toTencentSymbol).join(',');
    try {
      const response = await fetchWithTimeout(`https://qt.gtimg.cn/q=${batch}`, fetchImpl);
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buffer);

      for (const match of text.matchAll(/v_[a-z]{2}(\d{6})="([^"]*)";/gi)) {
        const symbol = match[1];
        const fields = match[2]?.split('~') ?? [];
        if (!symbol || fields.length < 50) continue;
        result.set(symbol, {
          symbol,
          name: String(fields[1] ?? '').trim(),
          price: asNumber(fields[3]),
          preClose: asNumber(fields[4]),
          open: asNumber(fields[5]),
          high: asNumber(fields[33]),
          low: asNumber(fields[34]),
          pct: asNumber(fields[32]),
          turnoverRate: asNumber(fields[38]),
          volumeRatio: asNumber(fields[49]),
          floatMarketCapYi: asNumber(fields[44]),
        });
      }
    } catch {
      // 整批失败时跳过，未拿到行情的票会标记为数据不足
    }
  }

  return result;
};

export type WatchBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

export const fetchWatchKline = async (
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WatchBar[]> => {
  const params = new URLSearchParams({
    param: `${toTencentSymbol(symbol)},day,,,${KLINE_DAYS},qfq`,
  });
  try {
    const response = await fetchWithTimeout(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params.toString()}`,
      fetchImpl,
    );
    const payload: unknown = await response.json();
    const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const raw = root ? root[toTencentSymbol(symbol)] : null;
    const entry: Record<string, unknown> | null = isRecord(raw) ? raw : null;
    const rows = entry ? (entry.qfqday ?? entry.day) : null;

    return (Array.isArray(rows) ? rows : [])
      .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 6)
      .map((row) => ({
        date: String(row[0]).replaceAll('-', ''),
        open: Number(row[1]),
        close: Number(row[2]),
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5]),
      }))
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
  } catch {
    return [];
  }
};

/** 日K一天只变一次，按交易日缓存，避免每次刷新都逐只重拉 */
const KLINE_TTL_MS = 10 * 60 * 1000;
const klineCache = new Map<string, { bars: WatchBar[]; expiresAt: number }>();

export const clearWatchKlineCache = (): void => klineCache.clear();

const fetchWatchKlineCached = async (
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<WatchBar[]> => {
  const key = `${symbol}|${new Date().toISOString().slice(0, 10)}`;
  const cached = klineCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.bars;
  }
  const bars = await fetchWatchKline(symbol, fetchImpl);
  if (bars.length > 0) {
    klineCache.set(key, { bars, expiresAt: Date.now() + KLINE_TTL_MS });
  }
  return bars;
};

export {};

/** 最近 withinDays 个交易日（不含今天）是否有过涨停 */
export const hadRecentLimitUp = (
  bars: WatchBar[],
  limitPct: number,
  withinDays = 3,
): boolean => {
  const end = bars.length - 1;
  for (let index = end - withinDays; index < end; index += 1) {
    if (index <= 0) continue;
    const bar = bars[index];
    const previous = bars[index - 1];
    if (previous.close > 0 && bar.close >= round2(previous.close * (1 + limitPct / 100)) - 0.001) {
      return true;
    }
  }
  return false;
};

/**
 * 「埋伏分」= 六个因子标准化后取负相加（越低越好）：20日动量、60日动量、换手率、
 * 20日波动率、流通市值、股价。日截面排序后，前 10% 的历史 T+5 +0.84%（t=2.0）、
 * 后 20% -1.52%（t=-2.0），单调性完整，训练段/验证段一致（+1.04% / +0.36%）。
 *
 * 均值和标准差来自全市场 383158 个样本（scripts/watch-ambush-lab.ts），
 * 运行时用同一组参数即可精确复现当时的排序。
 */
const AMBUSH_FACTORS = [
  { key: 'mom20', mean: -2.9026, std: 17.3362 },
  { key: 'mom60', mean: -9.2321, std: 29.5113 },
  { key: 'turnover', mean: 3.3239, std: 3.613 },
  { key: 'vol20', mean: 3.3401, std: 1.6352 },
  { key: 'floatCap', mean: 184.6925, std: 762.7092 },
  { key: 'price', mean: 28.3711, std: 62.4895 },
] as const;

/** 埋伏分的市场分位（来自同一次回测） */
const AMBUSH_PERCENTILE_CURVE: Array<[score: number, percentile: number]> = [
  [-1.101, 5],
  [-0.647, 10],
  [-0.252, 20],
  [-0.048, 30],
  [0.082, 40],
  [0.174, 50],
  [0.246, 60],
  [0.31, 70],
  [0.375, 80],
  [0.457, 90],
];

export const ambushPercentileOf = (score: number): number => {
  const curve = AMBUSH_PERCENTILE_CURVE;
  if (score <= curve[0][0]) return Math.max(1, Math.round(curve[0][1] * (score / curve[0][0])));
  if (score >= curve.at(-1)![0]) return 99;
  for (let index = 1; index < curve.length; index += 1) {
    const [lowScore, lowPct] = curve[index - 1];
    const [highScore, highPct] = curve[index];
    if (score <= highScore) {
      const ratio = (score - lowScore) / (highScore - lowScore);
      return Math.round((lowPct + ratio * (highPct - lowPct)) * 10) / 10;
    }
  }
  return 99;
};

export type WatchMetrics = {
  hadLimitUpWithin3Days: boolean;
  /** 埋伏分：越高越符合「安静、冷门、没涨过、小盘、低价」的埋伏特征 */
  ambushScore: number | null;
  ambushPercentile: number | null;
  vol20: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  distMa20: number | null;
  distHigh60: number | null;
  pct5: number | null;
  pct20: number | null;
  volumeRatioFromKline: number | null;
};

export const computeMetrics = (
  bars: WatchBar[],
  price: number | null,
  limitPct = 10,
  context: { turnoverRate: number | null; floatMarketCapYi: number | null } = {
    turnoverRate: null,
    floatMarketCapYi: null,
  },
): WatchMetrics => {
  // 当日K线在盘中尚未收盘，用实时价替换最后一根
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  if (price !== null && closes.length > 0) closes[closes.length - 1] = price;

  const tail = (count: number): number[] => closes.slice(Math.max(0, closes.length - count));
  const highs = bars.slice(Math.max(0, bars.length - 60)).map((bar) => bar.high);
  const high60 = highs.length > 0 ? Math.max(...highs) : null;
  const previous5 = volumes.slice(Math.max(0, volumes.length - 6), volumes.length - 1);

  const safe = (value: number | null): number | null =>
    value !== null && Number.isFinite(value) ? round2(value) : null;

  const liveCloses = bars.map((bar) => bar.close);
  if (price !== null && liveCloses.length > 0) liveCloses[liveCloses.length - 1] = price;
  const returns = liveCloses
    .slice(Math.max(1, liveCloses.length - 20))
    .map((value, index, array) => (index === 0 ? 0 : (value / array[index - 1] - 1) * 100))
    .slice(1);
  const vol20 =
    returns.length > 2
      ? Math.sqrt(returns.reduce((total, value) => total + (value - mean(returns)) ** 2, 0) / returns.length)
      : null;

  return {
    hadLimitUpWithin3Days: hadRecentLimitUp(bars, limitPct),
    vol20: vol20 === null ? null : safe(vol20),
    ma5: closes.length >= 5 ? safe(mean(tail(5))) : null,
    ma10: closes.length >= 10 ? safe(mean(tail(10))) : null,
    ma20: closes.length >= 20 ? safe(mean(tail(20))) : null,
    distMa20:
      closes.length >= 20 && closes[closes.length - 1] > 0
        ? safe((closes[closes.length - 1] / mean(tail(20)) - 1) * 100)
        : null,
    distHigh60:
      high60 !== null && high60 > 0 && closes.length > 0
        ? safe((closes[closes.length - 1] / high60 - 1) * 100)
        : null,
    pct5: closes.length >= 6 ? safe((closes[closes.length - 1] / closes[closes.length - 6] - 1) * 100) : null,
    pct20: closes.length >= 21 ? safe((closes[closes.length - 1] / closes[closes.length - 21] - 1) * 100) : null,
    ambushScore: scoreOf({
      mom20: closes.length >= 21 ? (closes[closes.length - 1] / closes[closes.length - 21] - 1) * 100 : null,
      mom60: closes.length >= 61 ? (closes[closes.length - 1] / closes[closes.length - 61] - 1) * 100 : null,
      turnover: context.turnoverRate,
      vol20,
      floatCap: context.floatMarketCapYi,
      price: closes.length > 0 ? closes[closes.length - 1] : null,
    }),
    ambushPercentile: null,
    volumeRatioFromKline:
      previous5.length > 0 && mean(previous5) > 0 && volumes.length > 0
        ? safe(volumes[volumes.length - 1] / mean(previous5))
        : null,
  };
};

/**
 * 判定规则：全部来自 394724 个「股票×交易日」样本、T+1/T+2/T+3 三个周期的回测
 * （scripts/watch-timing-lab.ts）。
 *
 * 结论必须先说清楚：**日K预测不了未来 1~3 天涨跌**。
 * 全市场基准 T+1 -0.08% / T+2 -0.17% / T+3 -0.25%，
 * 回调、缩量、回踩均线、平台整理、超跌反弹这些"买点"条件全部落在 ±0.2% 以内、t 值都小于 1。
 * 能可靠识别的是「容易亏钱的形态」，所以这里给的是**风险提示**，不是买入信号。
 *
 * 最强的一条：3 日内有涨停、今日却没封板（回调或滞涨）→ T+3 -1.36%（t=-3.1），
 * 且 T+1 -0.51% → T+2 -0.89% → T+3 -1.36% 单调恶化。涨停后追进去 / 接回调是被反复验证的亏损形态。
 */
export const judgeWatchItem = (
  quote: Quote,
  metricsInput: WatchMetrics,
): { verdict: WatchVerdict; reasons: string[] } => {
  const metrics: WatchMetrics = {
    ...metricsInput,
    ambushPercentile:
      metricsInput.ambushPercentile ??
      (metricsInput.ambushScore === null ? null : ambushPercentileOf(metricsInput.ambushScore)),
  };
  const limit = limitUpPct(quote.symbol, quote.name);
  const sealed =
    quote.price !== null &&
    quote.preClose !== null &&
    quote.preClose > 0 &&
    quote.price >= round2(quote.preClose * (1 + limit / 100)) - 0.001;
  const volumeRatio = quote.volumeRatio ?? metrics.volumeRatioFromKline;
  const gap =
    quote.open !== null && quote.preClose !== null && quote.preClose > 0
      ? ((quote.open - quote.preClose) / quote.preClose) * 100
      : null;

  if (sealed) {
    if (quote.turnoverRate !== null && quote.turnoverRate > 25) {
      return {
        verdict: 'avoid',
        reasons: [
          `封板但换手 ${quote.turnoverRate.toFixed(1)}% 过高：历史 T+1 -2.07%、胜率 46.3%（n=160）`,
          '高换手封板说明分歧极大，次日容易大幅高开后回落',
        ],
      };
    }
    return {
      verdict: 'edge',
      reasons: [
        `今日封板（+${limit}% 涨停）：历史 T+1 平均 +1.27%、胜率 53.9%（t=6.58，n=6080）`,
        '这是全部检验里唯一有正期望的形态；连板高度、偏离 MA20、量比放大都不影响它',
        '口径是尾盘按涨停价买入、次日卖出，需要能成交',
      ],
    };
  }

  // 最强的一档：三日内涨停过却没封住，T+1/T+2/T+3 单调恶化
  if (metrics.hadLimitUpWithin3Days) {
    return {
      verdict: 'avoid',
      reasons: [
        '3 日内有涨停、今天没封住：历史 T+3 -1.36%、T+2 -0.89%、T+1 -0.51%（t=-3.1，n=7941）',
        '涨停后回调接刀是被反复验证的亏损形态，且持有越久越差',
      ],
    };
  }

  // 次级：单看每条只有 -0.4% ~ -0.8%，够不上「高风险」，但值得注意
  const cautions: string[] = [];
  if (volumeRatio !== null && volumeRatio > 1.5) {
    cautions.push(`放量（量比 ${volumeRatio.toFixed(2)}）且未封板：历史 T+3 -0.69%（t=-2.2）`);
  }
  if (quote.turnoverRate !== null && quote.turnoverRate > 25) {
    cautions.push(`换手 ${quote.turnoverRate.toFixed(1)}% 过高：历史 T+1 -0.62%、胜率 41.1%`);
  }
  if (gap !== null && gap <= -2) {
    cautions.push(`低开 ${gap.toFixed(2)}%：历史 T+1 -0.80%、胜率 46.6%（t=-3.26）`);
  }
  if (metrics.distMa20 !== null && metrics.distMa20 > 15) {
    cautions.push(`偏离 MA20 +${metrics.distMa20.toFixed(1)}%：历史 T+1 -0.81%（t=-3.08）`);
  }
  if (quote.pct !== null && quote.pct < -3) {
    cautions.push(`当日跌 ${quote.pct.toFixed(2)}%：历史 T+1 -0.43%`);
  }

  if (cautions.length > 0) {
    return { verdict: 'caution', reasons: cautions };
  }

  const percentile = metrics.ambushPercentile;
  const state = `当前状态：距 MA20 ${metrics.distMa20?.toFixed(1) ?? '—'}%、距 60 日高 ${metrics.distHigh60?.toFixed(1) ?? '—'}%、5 日 ${metrics.pct5?.toFixed(1) ?? '—'}%、20 日 ${metrics.pct20?.toFixed(1) ?? '—'}%、量比 ${volumeRatio?.toFixed(2) ?? '—'}`;

  if (percentile !== null && percentile >= 90) {
    return {
      verdict: 'edge',
      reasons: [
        `埋伏分 ${metrics.ambushScore?.toFixed(2)}，位于市场前 ${(100 - percentile).toFixed(0)}%（分位 ${percentile}）`,
        '埋伏分 = 低动量 + 低换手 + 低波动 + 小市值 + 低价；历史前 10% 的 T+5 +0.84%（t=2.0），后 20% -1.52%',
        '注意这是相对全市场的超额（基准 T+5 约 -0.4%），不是保证上涨；扣手续费后绝对收益有限',
        state,
      ],
    };
  }

  return {
    verdict: 'neutral',
    reasons: [
      percentile === null
        ? '埋伏分无法计算（K线不足）'
        : `埋伏分 ${metrics.ambushScore?.toFixed(2)}，市场分位 ${percentile}，未进入前 10%`,
      '没有明显亏损形态，也没有进入历史占优区间',
      state,
    ],
  };
};

export const checkWatchSymbols = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<WatchCheckResponse> => {
  const fetchedAt = new Date().toISOString();
  const quotes = await fetchWatchQuotes(symbols, fetchImpl);

  const items: WatchCheckItem[] = [];
  for (const symbol of symbols) {
    const quote = quotes.get(symbol);
    if (!quote) {
      items.push({
        symbol,
        name: '',
        price: null,
        pct: null,
        open: null,
        high: null,
        low: null,
        preClose: null,
        turnoverRate: null,
        volumeRatio: null,
        ma5: null,
        ma10: null,
        ma20: null,
        distMa20: null,
        distHigh60: null,
        pct5: null,
        pct20: null,
        ambushScore: null,
        ambushPercentile: null,
        verdict: 'insufficient',
        reasons: ['未取到行情数据'],
      });
      continue;
    }

    const bars = await fetchWatchKlineCached(symbol, fetchImpl);
    const metrics = computeMetrics(bars, quote.price, limitUpPct(symbol, quote.name), {
      turnoverRate: quote.turnoverRate,
      floatMarketCapYi: quote.floatMarketCapYi,
    });
    const judged = judgeWatchItem(quote, metrics);

    items.push({
      symbol,
      name: quote.name,
      price: quote.price,
      pct: quote.pct,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      preClose: quote.preClose,
      turnoverRate: quote.turnoverRate,
      volumeRatio: quote.volumeRatio ?? metrics.volumeRatioFromKline,
      ma5: metrics.ma5,
      ma10: metrics.ma10,
      ma20: metrics.ma20,
      distMa20: metrics.distMa20,
      distHigh60: metrics.distHigh60,
      pct5: metrics.pct5,
      pct20: metrics.pct20,
      ambushScore: metrics.ambushScore,
      ambushPercentile:
        metrics.ambushScore === null ? null : ambushPercentileOf(metrics.ambushScore),
      verdict: judged.verdict,
      reasons: judged.reasons,
    });
  }

  return { items, fetchedAt, source: 'tencent', errors: [] };
};
