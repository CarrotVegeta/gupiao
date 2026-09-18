import type { AuctionItem, AuctionMinuteTrend, AuctionResponse } from '../../src/types.js';
import { evaluateAuctionQualification } from '../../src/lib/auction-policy.js';
import { toEastmoneySecId } from '../quotes/eastmoney.js';
import { TENCENT_FIELD, fetchTencentQuoteFields, toTencentSymbol } from '../tencent/client.js';
import { fetchAuctionMinutes } from './minute.js';
import { classifyAuctionPremium, isSealedAtAuction } from './model.js';

type AuctionPoolItem = Pick<
  AuctionItem,
  | 'symbol'
  | 'name'
  | 'boardCount'
  | 'firstSealTime'
  | 'lastSealTime'
  | 'breakCount'
  | 'previousAmount'
  | 'sealAmount'
  | 'floatMarketCap'
  | 'turnoverRate'
>;

type AuctionDetail = {
  preClose: number;
  limitUpPrice?: number | null;
  auctionPrice: number;
  auctionPct: number;
  auctionAmount: number | null;
  /** 竞价分时形态；只有分时链路能提供 */
  minuteTrend?: AuctionMinuteTrend | null;
  /** 竞价价/量由谁提供，用于观测链路命中情况 */
  amountSource?: 'tick' | 'minute' | null;
};

type SortableAuctionItem = Pick<AuctionItem, 'symbol' | 'boardCount' | 'auctionRatio' | 'result'>;

/**
 * 09:25 时刻可知的市场环境。
 * 新版判定只看竞价高开幅度和竞价量比，这里的市场家数/大盘缺口暂时不参与。
 */
export type AuctionMarketContext = {
  /** 昨日涨停家数（= 候选池规模） */
  previousLimitUpCount: number;
  /** 昨日炸板家数 */
  previousBrokenCount: number | null;
  /** 上证竞价缺口（%） */
  indexGapPct: number | null;
};

export const createAuctionMarketContext = (
  previousLimitUpCount: number,
): AuctionMarketContext => ({
  previousLimitUpCount,
  previousBrokenCount: null,
  indexGapPct: null,
});

const CALENDAR_ENDPOINT = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const LIMIT_UP_ENDPOINT = 'https://push2ex.eastmoney.com/getTopicZTPool';
/** 逐笔明细：push2 在部分网络会被上游直接断连，push2delay 是同一份数据的镜像 */
const DETAIL_ENDPOINTS = [
  'https://push2.eastmoney.com/api/qt/stock/details/get',
  'https://push2delay.eastmoney.com/api/qt/stock/details/get',
] as const;
/** 腾讯分笔：只提供最近一个交易日，p=0 即当日最早那一段（09:25 竞价成交在第一条） */
const TENCENT_DETAIL_ENDPOINT = 'https://stock.gtimg.cn/data/index.php';
const QUOTE_LIST_ENDPOINT = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const TENCENT_QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q=';
const TENCENT_KLINE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const REQUEST_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 4;
const DETAIL_ATTEMPTS = 3;
const DETAIL_RETRY_BASE_MS = 200;
/** 连续失败到该阈值就认为明细源整体不可用，本次请求不再逐只尝试 */
const DETAIL_FAILURE_THRESHOLD = 8;

/** 开盘集合竞价 09:15 开始接单；在这之前当天不可能有任何竞价成交 */
const CALL_AUCTION_OPEN_MINUTES = 9 * 60 + 15;

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SHANGHAI_CLOCK_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 上海时区的今天（YYYYMMDD）。和 server/index.ts 的 getShanghaiToday 同一口径，放这里避免循环依赖 */
export const toShanghaiTradeDate = (now: Date = new Date()): string =>
  SHANGHAI_DATE_FORMATTER.format(now).replaceAll('-', '');

/** 距离当天 09:15 还有多少毫秒；已经过了就是 0 */
export const msUntilCallAuction = (now: Date = new Date()): number => {
  const [hour, minute, second] = SHANGHAI_CLOCK_FORMATTER.format(now)
    .split(':')
    .map((part) => Number(part));
  const elapsedMs = (hour * 60 + minute) * 60_000 + second * 1_000;

  return Math.max(0, CALL_AUCTION_OPEN_MINUTES * 60_000 - elapsedMs);
};

/**
 * 09:15 之前请求「今天」的竞价：集合竞价还没开始，
 * 行情源里的今开、分笔、大盘缺口都还停在**上一个交易日**，
 * 按今天算会得到一张「池子是昨天、价格是昨天、日期写今天」的卡。
 *
 * 请求历史日期不受影响：那些日子的竞价早就结束了。
 */
export const isPreOpenAuctionFallback = (tradeDate: string, now: Date = new Date()): boolean =>
  tradeDate === toShanghaiTradeDate(now) && msUntilCallAuction(now) > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') {
    return null;
  }

  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
};

const asInteger = (value: unknown): number | null => {
  const result = asNumber(value);
  return result !== null && Number.isInteger(result) ? result : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeSymbol = (value: unknown): string => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (/^\d{1,6}$/.test(raw)) {
    return raw.padStart(6, '0');
  }

  return raw.match(/^(?:SH|SZ|BJ)?(\d{6})$/)?.[1] ?? '';
};

const formatTradeTime = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,6}$/.test(raw)) {
    return null;
  }

  const normalized = raw.padStart(6, '0');
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  const second = Number(normalized.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}:${normalized.slice(4, 6)}`;
};

const fetchJson = async (url: string, fetchImpl: typeof fetch): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const fetchText = async (url: string, fetchImpl: typeof fetch): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const dateDaysBefore = (tradeDate: string, days: number): string => {
  const date = new Date(
    Date.UTC(
      Number(tradeDate.slice(0, 4)),
      Number(tradeDate.slice(4, 6)) - 1,
      Number(tradeDate.slice(6, 8)),
    ),
  );
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
};

const unavailableResponse = (message: string, fetchedAt: string): AuctionResponse => ({
  tradeDate: null,
  previousTradeDate: null,
  snapshotTime: '09:25:00',
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: message,
});

export const findPreviousTradeDate = (
  dates: string[],
  tradeDate: string,
): string | null => {
  const normalizedDates = dates
    .map((date) => date.replaceAll('-', ''))
    .filter((date) => /^\d{8}$/.test(date) && date < tradeDate)
    .sort();
  return normalizedDates.at(-1) ?? null;
};

export const mapEastmoneyAuctionPoolItem = (raw: unknown): AuctionPoolItem | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const symbol = normalizeSymbol(raw.c);
  const name = asString(raw.n);
  if (!symbol || !name) {
    return null;
  }

  return {
    symbol,
    name,
    boardCount: asInteger(raw.lbc),
    firstSealTime: formatTradeTime(raw.fbt),
    lastSealTime: formatTradeTime(raw.lbt),
    breakCount: asInteger(raw.zbc),
    previousAmount: asNumber(raw.amount),
    sealAmount: asNumber(raw.fund ?? raw.fd),
    floatMarketCap: asNumber(raw.ltsz),
    turnoverRate: asNumber(raw.hs),
  };
};

export const mapEastmoneyAuctionDetail = (raw: unknown): AuctionDetail | null => {
  if (!isRecord(raw) || !Array.isArray(raw.details)) {
    return null;
  }

  const prePrice = asNumber(raw.prePrice);
  // 集合竞价的成交回报不总是正好戳在 09:25:00：实测约三分之一会落到 09:25:01~09:25:59。
  // 09:25:00 ~ 09:29:59 之间不存在连续竞价成交，取这个窗口内的第一条即为竞价成交。
  const match = raw.details.find(
    (detail): detail is string =>
      typeof detail === 'string' &&
      detail.length >= 8 &&
      detail.slice(0, 8) >= '09:25:00' &&
      detail.slice(0, 8) < '09:30:00',
  );
  if (prePrice === null || prePrice <= 0 || !match) {
    return null;
  }

  const fields = match.split(',');
  const auctionPrice = asNumber(fields[1]);
  const auctionLots = asNumber(fields[2]);
  if (auctionPrice === null || auctionPrice <= 0 || auctionLots === null || auctionLots < 0) {
    return null;
  }

  return {
    preClose: prePrice,
    auctionPrice,
    auctionPct: Number((((auctionPrice - prePrice) / prePrice) * 100).toFixed(2)),
    auctionAmount: Number((auctionPrice * auctionLots * 100).toFixed(2)),
  };
};

export type TencentAuctionTick = {
  auctionPrice: number;
  auctionAmount: number | null;
};

/**
 * 腾讯分笔：`v_detail_data_sh600519=[页码,"序号/时间/价格/涨跌/成交量(手)/成交额(元)/方向|..."]`
 *
 * 与东财的两点差别：
 * - 成交额是**真实金额**（东财要用「价 × 手数 × 100」估算，实测相对误差 ~0.01%）
 * - 不返回昨收，溢价率要用行情里的昨收自己算
 * 取 09:25:00~09:29:59 的第一条：这段时间不存在连续竞价成交，第一条即集合竞价成交。
 */
export const mapTencentAuctionTick = (text: string): TencentAuctionTick | null => {
  const start = text.indexOf('=[');
  if (start === -1) {
    return null;
  }

  const payload = text.slice(start + 2).replace(/];?\s*$/, '');
  const tick = payload
    .split('|')
    .map((chunk) => chunk.split('/'))
    .find(
      (fields) =>
        fields.length >= 6 &&
        typeof fields[1] === 'string' &&
        fields[1] >= '09:25:00' &&
        fields[1] < '09:30:00',
    );
  if (!tick) {
    return null;
  }

  const auctionPrice = asNumber(tick[2]);
  if (auctionPrice === null || auctionPrice <= 0) {
    return null;
  }

  const amount = asNumber(tick[5]);
  return {
    auctionPrice,
    auctionAmount: amount !== null && amount >= 0 ? Number(amount.toFixed(2)) : null,
  };
};

const fetchTencentAuctionTick = async (
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<TencentAuctionTick | null> => {
  const params = new URLSearchParams({
    appn: 'detail',
    action: 'data',
    c: toTencentSymbol(symbol),
    p: '0',
  });

  const body = await fetchText(`${TENCENT_DETAIL_ENDPOINT}?${params.toString()}`, fetchImpl);
  return mapTencentAuctionTick(body);
};

/**
 * 腾讯优先的 09:25 竞价明细。
 *
 * 为什么先取批量行情、而不是直接逐只取分笔：
 * - 行情里的**今开就等于 09:25 竞价成交价**（开盘价由集合竞价撮合产生），两个批量请求就能覆盖全部候选
 * - 「今开 > 0」同时是护栏：09:25 之前今开为 0，而分笔这时还在吐**上一交易日**的数据。
 *   用数据自身判断「今日是否已开盘」，比读本机时钟可靠（不依赖机器时区与时间是否准确）
 * - 昨收来自同一批行情，用来算竞价溢价
 *
 * 分笔只用来补「竞价成交额」——量能比需要它，行情接口里只有全天累计成交额。
 * 分笔拿不到时仍返回价格（量能缺失），与东财 ulist 兜底的行为一致。
 */
const fetchTencentAuctionDetails = async (
  symbols: string[],
  fetchImpl: typeof fetch,
): Promise<Map<string, AuctionDetail>> => {
  const details = new Map<string, AuctionDetail>();
  if (symbols.length === 0) {
    return details;
  }

  const quotes = await fetchTencentQuoteFields(symbols.map(toTencentSymbol), fetchImpl);
  const targets: Array<{ symbol: string; open: number; preClose: number }> = [];

  for (const symbol of symbols) {
    const fields = quotes.get(toTencentSymbol(symbol));
    if (!fields) {
      continue;
    }

    const open = asNumber(fields[TENCENT_FIELD.open]);
    const preClose = asNumber(fields[TENCENT_FIELD.preClose]);
    if (open === null || open <= 0 || preClose === null || preClose <= 0) {
      continue;
    }

    targets.push({ symbol, open, preClose });
  }

  const ticks = await mapWithConcurrency(targets, DETAIL_CONCURRENCY, (target) =>
    fetchTencentAuctionTick(target.symbol, fetchImpl).catch(() => null),
  );

  targets.forEach((target, index) => {
    const tickAmount = ticks[index]?.auctionAmount ?? null;
    details.set(target.symbol, {
      preClose: target.preClose,
      limitUpPrice: asNumber(quotes.get(toTencentSymbol(target.symbol))?.[TENCENT_FIELD.limitUpPrice]),
      auctionPrice: target.open,
      auctionPct: Number((((target.open - target.preClose) / target.preClose) * 100).toFixed(2)),
      auctionAmount: tickAmount,
      amountSource: tickAmount === null ? null : 'tick',
    });
  });

  return details;
};

/** 昨日一字板：09:25 就封板且全天没炸过 */
export const isPreviousOneWord = (
  firstSealTime: string | null,
  breakCount: number | null,
): boolean | null => {
  if (firstSealTime === null || breakCount === null) {
    return null;
  }
  return firstSealTime <= '09:25:00' && breakCount === 0;
};

/**
 * 判定一只候选票：数值全部来自 09:25 时点信息。
 * 合格只看两个条件 —— 竞价高开幅度落在策略区间内、竞价量比达到门槛；
 * 不再计算「今日收盘继续涨停」的概率。溢价档位只描述价格位置，不参与判定。
 */
export const evaluateAuctionCandidate = (
  poolItem: AuctionPoolItem,
  detail: AuctionDetail | null,
  context: AuctionMarketContext,
): AuctionItem => {
  void context;
  if (detail === null) {
    return {
      ...poolItem,
      auctionPrice: null,
      auctionPct: null,
      auctionAmount: null,
      auctionRatio: null,
      auctionPremium: null,
      sealedAtAuction: null,
      minuteTrend: null,
      auctionAmountSource: null,
      result: 'insufficient',
      reasons: ['缺少 09:25 竞价成交数据'],
    };
  }

  const auctionRatio =
    detail.auctionAmount !== null &&
    poolItem.previousAmount !== null &&
    poolItem.previousAmount > 0
      ? Number(((detail.auctionAmount / poolItem.previousAmount) * 100).toFixed(2))
      : null;
  const sealedAtAuction = isSealedAtAuction(poolItem.symbol, poolItem.name,
    detail.auctionPrice, detail.preClose, detail.limitUpPrice);
  const premium = classifyAuctionPremium(detail.auctionPct);
  const qualification = evaluateAuctionQualification(detail.auctionPct, auctionRatio);

  return {
    ...poolItem,
    auctionPrice: detail.auctionPrice,
    auctionPct: detail.auctionPct,
    auctionAmount: detail.auctionAmount,
    auctionRatio,
    auctionPremium: premium.level,
    sealedAtAuction,
    minuteTrend: detail.minuteTrend ?? null,
    auctionAmountSource: detail.amountSource ?? null,
    result: qualification.result,
    reasons: [
      ...qualification.reasons,
      ...(sealedAtAuction === null
        ? ['缺少涨停价，无法判断竞价是否已封板']
        : sealedAtAuction
          ? ['竞价已封板，实际上买不到']
          : []),
      `竞价价 ${detail.auctionPrice.toFixed(2)} 元（${premium.reason}）`,
      // 形态只作为观察项附在后面，不参与合格判定
      ...(detail.minuteTrend ? [`竞价分时：${detail.minuteTrend.label}`] : []),
    ],
  };
};
/**
 * 排序：合格在前，其次昨日连板数降序，再按竞价量比降序（量能是这套判定的核心），最后按代码。
 */
export const sortAuctionItems = <T extends SortableAuctionItem>(items: T[]): T[] =>
  [...items].sort((left, right) => {
    const rank = (item: T) => (item.result === 'qualified' ? 0 : item.result === 'unqualified' ? 1 : 2);
    const resultDiff = rank(left) - rank(right);
    if (resultDiff !== 0) {
      return resultDiff;
    }

    const boardDiff = (right.boardCount ?? -1) - (left.boardCount ?? -1);
    if (boardDiff !== 0) {
      return boardDiff;
    }

    const ratioDiff = (right.auctionRatio ?? -1) - (left.auctionRatio ?? -1);
    return ratioDiff !== 0 ? ratioDiff : left.symbol.localeCompare(right.symbol);
  });

const toIsoDate = (date: string): string =>
  `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

/**
 * 上一交易日：优先用腾讯指数日K（稳定、一个请求），
 * 东财 push2his 作为备用——它在部分网络会被上游断连。
 * 两个源都失败时，上层会退化为按日期回扫涨停池。
 */
const fetchPreviousTradeDate = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<string | null> => {
  try {
    const params = new URLSearchParams({
      param: `sh000001,day,${toIsoDate(dateDaysBefore(tradeDate, 30))},${toIsoDate(tradeDate)},320,qfq`,
    });
    const payload = await fetchJson(`${TENCENT_KLINE_ENDPOINT}?${params.toString()}`, fetchImpl);
    const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const raw = root ? root.sh000001 : null;
    const entry: Record<string, unknown> | null = isRecord(raw) ? raw : null;
    const rows = entry ? (entry.qfqday ?? entry.day) : null;
    const dates = (Array.isArray(rows) ? rows : [])
      .filter((row): row is unknown[] => Array.isArray(row) && row.length > 0)
      .map((row) => String(row[0]).replaceAll('-', ''));

    return findPreviousTradeDate(dates, tradeDate);
  } catch {
    // 落到东财源
  }

  const params = new URLSearchParams({
    secid: '1.000001',
    klt: '101',
    fqt: '0',
    beg: dateDaysBefore(tradeDate, 30),
    end: tradeDate,
    fields1: 'f1',
    fields2: 'f51',
  });
  const payload = await fetchJson(`${CALENDAR_ENDPOINT}?${params.toString()}`, fetchImpl);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  return findPreviousTradeDate(
    data && Array.isArray(data.klines)
      ? data.klines.filter((item): item is string => typeof item === 'string')
      : [],
    tradeDate,
  );
};

const fetchAuctionPool = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<AuctionPoolItem[]> => {
  const items: AuctionPoolItem[] = [];
  const seen = new Set<string>();
  let received = 0;
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      ut: '7eea3edcaed734bea9cbfc24409ed989',
      dpt: 'wz.ztzt',
      sort: 'fbt:asc',
      date: tradeDate,
      pagesize: String(PAGE_SIZE),
      Pageindex: String(page),
    });
    const payload = await fetchJson(`${LIMIT_UP_ENDPOINT}?${params.toString()}`, fetchImpl);
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    if (!data || !Array.isArray(data.pool)) {
      throw new Error('invalid pool');
    }

    const reportedTotal = asInteger(data.tc);
    if (reportedTotal !== null && reportedTotal >= 0) {
      total = reportedTotal;
    }
    received += data.pool.length;

    for (const raw of data.pool) {
      const item = mapEastmoneyAuctionPoolItem(raw);
      if (item && !seen.has(item.symbol)) {
        seen.add(item.symbol);
        items.push(item);
      }
    }

    if (data.pool.length === 0 || (total !== null && received >= total)) {
      return items;
    }
  }

  throw new Error('incomplete pool');
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 逐笔明细是「竞价量能」评分项的唯一来源，而该接口在并发偏高时会偶发断连。
 * 只在传输层失败时重试：一旦上游给出合法响应（哪怕是空结果），立即返回，
 * 避免个别请求失败导致量能项被静默清零、评分与档位随刷新跳变。
 */
/**
 * 按源熔断：某个明细源连续失败到阈值就本次请求不再碰它，但继续尝试其它镜像源。
 * 全部源都熔断后，剩下的股票直接跳过，避免对 80~90 只票逐个空转重试。
 */
export type DetailEndpointHealth = { consecutiveFailures: number; disabled: boolean };

export type DetailSourceHealth = {
  endpoints: DetailEndpointHealth[];
  disabled: boolean;
  skipped: number;
};

export const createDetailSourceHealth = (): DetailSourceHealth => ({
  endpoints: DETAIL_ENDPOINTS.map(() => ({ consecutiveFailures: 0, disabled: false })),
  disabled: false,
  skipped: 0,
});

const fetchAuctionDetail = async (
  symbol: string,
  fetchImpl: typeof fetch,
  health: DetailSourceHealth,
): Promise<AuctionDetail | null> => {
  if (health.disabled) {
    health.skipped += 1;
    return null;
  }

  const params = new URLSearchParams({
    secid: toEastmoneySecId(symbol),
    fields1: 'f1,f2,f3,f4,f5',
    fields2: 'f51,f52,f53,f54,f55',
    pos: '-100000',
    iscca: '1',
  });

  for (let index = 0; index < DETAIL_ENDPOINTS.length; index += 1) {
    const endpointHealth = health.endpoints[index];
    if (endpointHealth.disabled) {
      continue;
    }

    for (let attempt = 1; attempt <= DETAIL_ATTEMPTS; attempt += 1) {
      try {
        const payload = await fetchJson(`${DETAIL_ENDPOINTS[index]}?${params.toString()}`, fetchImpl);
        endpointHealth.consecutiveFailures = 0;
        // 拿到合法响应就返回（即便没有 09:25 成交，也不必再试镜像）
        return mapEastmoneyAuctionDetail(isRecord(payload) ? payload.data : null);
      } catch {
        endpointHealth.consecutiveFailures += 1;
        if (endpointHealth.consecutiveFailures >= DETAIL_FAILURE_THRESHOLD) {
          endpointHealth.disabled = true;
          break;
        }
        if (attempt < DETAIL_ATTEMPTS) {
          await delay(DETAIL_RETRY_BASE_MS * attempt);
        }
      }
    }
  }

  if (health.endpoints.every((endpoint) => endpoint.disabled)) {
    health.disabled = true;
    health.skipped += 1;
  }

  return null;
};

const fetchAuctionOpenQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch,
): Promise<Record<string, AuctionDetail>> => {
  const result: Record<string, AuctionDetail> = {};

  for (let offset = 0; offset < symbols.length; offset += 50) {
    const batch = symbols.slice(offset, offset + 50);
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f12,f17,f18',
      secids: batch.map(toEastmoneySecId).join(','),
    });
    const payload = await fetchJson(`${QUOTE_LIST_ENDPOINT}?${params.toString()}`, fetchImpl);
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const rows = data && Array.isArray(data.diff) ? data.diff : [];

    for (const raw of rows) {
      if (!isRecord(raw)) {
        continue;
      }
      const symbol = normalizeSymbol(raw.f12);
      const auctionPrice = asNumber(raw.f17);
      const prePrice = asNumber(raw.f18);
      if (!symbol || auctionPrice === null || auctionPrice <= 0 || prePrice === null || prePrice <= 0) {
        continue;
      }
      result[symbol] = {
        preClose: prePrice,
        auctionPrice,
        auctionPct: Number((((auctionPrice - prePrice) / prePrice) * 100).toFixed(2)),
        auctionAmount: null,
      };
    }
  }

  return result;
};

const fetchTencentOpenQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch,
): Promise<Record<string, AuctionDetail>> => {
  const result: Record<string, AuctionDetail> = {};

  for (let offset = 0; offset < symbols.length; offset += 50) {
    const batch = symbols.slice(offset, offset + 50).map(toTencentSymbol).join(',');
    const payload = await fetchText(`${TENCENT_QUOTE_ENDPOINT}${batch}`, fetchImpl);

    for (const match of payload.matchAll(/v_[a-z]{2}\d{6}="([^"]*)";/gi)) {
      const fields = match[1]?.split('~') ?? [];
      const symbol = normalizeSymbol(fields[2]);
      const prePrice = asNumber(fields[4]);
      const auctionPrice = asNumber(fields[5]);
      if (!symbol || prePrice === null || prePrice <= 0 || auctionPrice === null || auctionPrice <= 0) {
        continue;
      }
      result[symbol] = {
        preClose: prePrice,
        auctionPrice,
        auctionPct: Number((((auctionPrice - prePrice) / prePrice) * 100).toFixed(2)),
        auctionAmount: null,
      };
    }
  }

  return result;
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
};

const isWeekend = (tradeDate: string): boolean => {
  const date = new Date(
    Date.UTC(
      Number(tradeDate.slice(0, 4)),
      Number(tradeDate.slice(4, 6)) - 1,
      Number(tradeDate.slice(6, 8)),
    ),
  );
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
};

const fetchFallbackPreviousPool = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
): Promise<{ previousTradeDate: string; pool: AuctionPoolItem[] } | null> => {
  for (let daysBefore = 1; daysBefore <= 20; daysBefore += 1) {
    const candidateDate = dateDaysBefore(tradeDate, daysBefore);
    if (isWeekend(candidateDate)) {
      continue;
    }

    try {
      const pool = await fetchAuctionPool(candidateDate, fetchImpl);
      if (pool.length > 0) {
        return { previousTradeDate: candidateDate, pool };
      }
    } catch {
      // 继续尝试更早的日期，避免单日接口异常阻断整个候选池。
    }
  }

  return null;
};

/**
 * 真正该展示的竞价日：09:15 前请求「今天」时退回到上一个交易日，
 * 其余情况原样返回请求的日期（历史日期照查）。
 */
const resolveAuctionDate = async (
  tradeDate: string,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<string> => {
  if (!isPreOpenAuctionFallback(tradeDate, now)) {
    return tradeDate;
  }

  try {
    return (await fetchPreviousTradeDate(tradeDate, fetchImpl)) ?? tradeDate;
  } catch {
    // 交易日历也拿不到时退回「按日期回扫涨停池」的上一交易日：
    // 两条日历源同时挂掉的概率极低，但也不该让卡片退化成「今天的日期 + 昨天的价格」。
    const fallback = await fetchFallbackPreviousPool(tradeDate, fetchImpl);
    return fallback?.previousTradeDate ?? tradeDate;
  }
};

export const fetchEastmoneyAuction = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<AuctionResponse> => {
  const fetchedAt = new Date().toISOString();

  try {
    // 09:15 前整卡退回上一个完整竞价日：竞价日 = 上一交易日，
    // 昨日涨停 = 它的上一交易日涨停池，价格/缺口也正好都是那一天的 09:25。
    const auctionDate = await resolveAuctionDate(tradeDate, fetchImpl, now);

    let previousTradeDate: string | null = null;
    try {
      previousTradeDate = await fetchPreviousTradeDate(auctionDate, fetchImpl);
    } catch {
      previousTradeDate = null;
    }

    let pool: AuctionPoolItem[];
    if (previousTradeDate !== null) {
      pool = await fetchAuctionPool(previousTradeDate, fetchImpl);
    } else {
      const fallback = await fetchFallbackPreviousPool(auctionDate, fetchImpl);
      if (fallback === null) {
        return unavailableResponse('未找到上一交易日涨停池', fetchedAt);
      }
      previousTradeDate = fallback.previousTradeDate;
      pool = fallback.pool;
    }

    // 新判定只用竞价高开幅度和竞价量比，不再拉取炸板家数与大盘缺口：
    // 少两个上游请求，也就少两个可能失败的环节。
    const context: AuctionMarketContext = createAuctionMarketContext(pool.length);

    // 腾讯优先：两个批量请求就能拿到全部候选的 09:25 竞价价，再逐只取分笔补竞价成交额
    const tencentDetails = await fetchTencentAuctionDetails(
      pool.map((item) => item.symbol),
      fetchImpl,
    );
    const details: Array<AuctionDetail | null> = pool.map(
      (item) => tencentDetails.get(item.symbol) ?? null,
    );
    let usedTencent = details.some((detail) => detail !== null);

    // 腾讯没覆盖到的（09:25 之前、停牌、腾讯缺分笔）再走东财明细链
    const pending = pool
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => details[index] === null);
    if (pending.length > 0) {
      const health = createDetailSourceHealth();
      const fetched = await mapWithConcurrency(pending, DETAIL_CONCURRENCY, ({ item }) =>
        fetchAuctionDetail(item.symbol, fetchImpl, health),
      );
      pending.forEach(({ index }, position) => {
        details[index] = fetched[position];
      });
    }

    // 第三步：竞价分时。两个作用 ——
    // 1) 给还缺竞价成交额的票补上量能（分时首个有量点 = 09:25 竞价成交，实测与分笔一致）；
    //    最典型的是北交所：分笔返回空，分时能拿到。
    // 2) 给所有拿得到的票补「竞价过程形态」（09:15~09:24 的虚拟匹配价/量轨迹）。
    const minuteSymbols = pool
      .map((item, index) => ({ symbol: item.symbol, index }))
      .filter(({ index }) => details[index]?.auctionAmount == null || details[index]?.minuteTrend == null);
    if (minuteSymbols.length > 0) {
      // 涨停价批量行情里已经有了，直接复用，不用让分时链路再猜一次涨停幅度
      const limitUpPrices = new Map(
        minuteSymbols.map(({ symbol, index }) => [symbol, details[index]?.limitUpPrice ?? null]),
      );
      const minutes = await fetchAuctionMinutes(
        minuteSymbols.map(({ symbol }) => symbol),
        fetchImpl,
        limitUpPrices,
      );
      for (const { symbol, index } of minuteSymbols) {
        const minute = minutes.get(symbol);
        if (!minute) {
          continue;
        }
        const minuteTrend = {
          ...minute.features,
          pricePath: minute.data.points.map((point) => point.matchPrice),
        };
        const existing = details[index];
        const minutePct =
          minute.data.preClose !== null && minute.data.preClose > 0
            ? Number(
                (((minute.data.auctionPrice - minute.data.preClose) / minute.data.preClose) * 100).toFixed(2),
              )
            : 0;

        if (existing === undefined || existing === null) {
          details[index] = {
            preClose: minute.data.preClose ?? 0,
            auctionPrice: minute.data.auctionPrice,
            auctionPct: minutePct,
            auctionAmount: minute.data.auctionAmount,
            minuteTrend,
            amountSource: 'minute',
          };
          continue;
        }

        // 已有分笔结果时只补形态；分笔缺额（北交所等）才用分时兜底
        const needsAmount = existing.auctionAmount === null;
        details[index] = {
          ...existing,
          auctionAmount: needsAmount ? minute.data.auctionAmount : existing.auctionAmount,
          amountSource: needsAmount ? 'minute' : existing.amountSource ?? null,
          minuteTrend,
        };
      }
    }

    const missingSymbols = pool
      .filter((_item, index) => details[index] === null)
      .map((item) => item.symbol);
    let openQuotes: Record<string, AuctionDetail> = {};
    if (missingSymbols.length > 0) {
      try {
        openQuotes = await fetchAuctionOpenQuotes(missingSymbols, fetchImpl);
      } catch {
        openQuotes = {};
      }

      const unresolvedSymbols = missingSymbols.filter((symbol) => openQuotes[symbol] === undefined);
      if (unresolvedSymbols.length > 0) {
        try {
          const tencentQuotes = await fetchTencentOpenQuotes(unresolvedSymbols, fetchImpl);
          if (Object.keys(tencentQuotes).length > 0) {
            usedTencent = true;
            openQuotes = { ...openQuotes, ...tencentQuotes };
          }
        } catch {
          // 两个报价源都不可用时，保留“数据不足”状态，不猜测竞价结果。
        }
      }
    }
    const items = sortAuctionItems(
      pool.map((item, index) =>
        evaluateAuctionCandidate(item, details[index] ?? openQuotes[item.symbol] ?? null, context),
      ),
    );

    return {
      tradeDate: auctionDate,
      previousTradeDate,
      snapshotTime: '09:25:00',
      items,
      fetchedAt,
      source: usedTencent ? 'eastmoney+tencent' : 'eastmoney',
      status: 'fresh',
      error: null,
    };
  } catch {
    return unavailableResponse('竞价上游数据获取失败', fetchedAt);
  }
};
