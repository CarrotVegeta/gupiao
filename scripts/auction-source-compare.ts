/**
 * 竞价链路端到端对比：当前实现 vs 对照实现（纯腾讯分笔，不先用批量行情）
 *
 * 同一交易日、同一份候选池，分别跑完整链路，比较「墙钟耗时 / 拿到竞价价的只数 /
 * 拿到竞价量能的只数 / 数据源标记」，量化换源的实际收益。
 *
 * 用法：npx tsx scripts/auction-source-compare.ts [YYYYMMDD]
 */
import { fetchEastmoneyAuction } from '../server/auction/eastmoney.js';

const tradeDate = process.argv[2] ?? new Date().toISOString().slice(0, 10).replaceAll('-', '');
const CONCURRENCY = 4;
const TIMEOUT_MS = 8_000;
const TENCENT_QUOTE = 'https://qt.gtimg.cn/q=';
const TENCENT_DETAIL = 'https://stock.gtimg.cn/data/index.php';
const TENCENT_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const POOL = 'https://push2ex.eastmoney.com/getTopicZTPool';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
};
const toTencentSymbol = (symbol: string): string =>
  symbol.startsWith('6') ? `sh${symbol}` : symbol.startsWith('4') || symbol.startsWith('8') ? `bj${symbol}` : `sz${symbol}`;

const request = async (url: string, accept: 'json' | 'text'): Promise<{ body: string; bytes: number }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept === 'json' ? 'application/json' : 'text/plain' },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { body, bytes: Buffer.byteLength(body) };
  } finally {
    clearTimeout(timer);
  }
};

const mapWithConcurrency = async <T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
};

const daysBefore = (days: number): string => {
  const date = new Date(
    Date.UTC(Number(tradeDate.slice(0, 4)), Number(tradeDate.slice(4, 6)) - 1, Number(tradeDate.slice(6, 8))),
  );
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
};

const fetchPreviousTradeDate = async (): Promise<string | null> => {
  const params = new URLSearchParams({
    param: `sh000001,day,${daysBefore(30).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')},${tradeDate.replace(
      /(\d{4})(\d{2})(\d{2})/,
      '$1-$2-$3',
    )},320,qfq`,
  });
  const { body } = await request(`${TENCENT_KLINE}?${params.toString()}`, 'json');
  const payload = JSON.parse(body) as unknown;
  const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const entry = root && isRecord(root.sh000001) ? root.sh000001 : null;
  const rows = entry ? (Array.isArray(entry.qfqday) ? entry.qfqday : Array.isArray(entry.day) ? entry.day : []) : [];
  const dates = rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => String(row[0]).replaceAll('-', ''))
    .filter((date) => date < tradeDate)
    .sort();
  return dates.at(-1) ?? null;
};

const fetchPool = async (date: string): Promise<Array<{ symbol: string; previousAmount: number | null }>> => {
  const params = new URLSearchParams({
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    sort: 'fbt:asc',
    date,
    pagesize: '100',
    Pageindex: '0',
  });
  const { body } = await request(`${POOL}?${params.toString()}`, 'json');
  const payload = JSON.parse(body) as unknown;
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const pool = data && Array.isArray(data.pool) ? data.pool : [];
  return pool
    .filter(isRecord)
    .map((row) => ({ symbol: String(row.c ?? ''), previousAmount: num(row.amount) }))
    .filter((row) => /^\d{6}$/.test(row.symbol));
};

type TencentDetail = { auctionPrice: number; auctionPct: number; auctionAmount: number | null };

const fetchTencentDetail = async (symbol: string): Promise<TencentDetail | null> => {
  const params = new URLSearchParams({ appn: 'detail', action: 'data', c: toTencentSymbol(symbol), p: '0' });
  const { body } = await request(`${TENCENT_DETAIL}?${params.toString()}`, 'text');
  const payload = body.slice(body.indexOf('=[') + 2).replace(/];?\s*$/, '');
  const ticks = payload
    .split('|')
    .map((chunk) => chunk.split('/'))
    .filter((fields) => fields.length >= 6 && /^\d{2}:\d{2}:\d{2}$/.test(fields[1] ?? ''));
  const tick = ticks.find((fields) => fields[1] >= '09:25:00' && fields[1] < '09:30:00');
  if (!tick) return null;
  const auctionPrice = Number(tick[2]);
  if (!Number.isFinite(auctionPrice) || auctionPrice <= 0) return null;
  // 腾讯分笔字段：[序号, 时间, 价格, 涨跌, 成交量(手), 成交额(元), 方向]
  const amount = Number(tick[5]);
  return { auctionPrice, auctionPct: Number.NaN, auctionAmount: Number.isFinite(amount) ? amount : null };
};

const fetchTencentPreClose = async (symbols: string[]): Promise<Record<string, number>> => {
  const result: Record<string, number> = {};
  for (let offset = 0; offset < symbols.length; offset += 50) {
    const batch = symbols.slice(offset, offset + 50).map(toTencentSymbol).join(',');
    const { body } = await request(`${TENCENT_QUOTE}${batch}`, 'text');
    for (const match of body.matchAll(/v_[a-z]{2}\d{6}="([^"]*)";/gi)) {
      const fields = match[1]?.split('~') ?? [];
      const symbol = String(fields[2] ?? '');
      const preClose = num(fields[4]);
      if (/^\d{6}$/.test(symbol) && preClose !== null && preClose > 0) result[symbol] = preClose;
    }
  }
  return result;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const report = (
  label: string,
  wallMs: number,
  total: number,
  withPrice: number,
  withAmount: number,
  extra: string,
): void => {
  console.log(
    `${label.padEnd(16)} 墙钟 ${String(Math.round(wallMs)).padStart(6)}ms | 候选 ${String(total).padStart(3)} 只 | ` +
      `有竞价价 ${String(withPrice).padStart(3)} | 有量能 ${String(withAmount).padStart(3)} | ${extra}`,
  );
};

const main = async (): Promise<void> => {
  console.log(`竞价链路端到端对比 · 交易日 ${tradeDate} · 并发 ${CONCURRENCY}\n`);

  const startedCurrent = performance.now();
  const current = await fetchEastmoneyAuction(tradeDate);
  const currentMs = performance.now() - startedCurrent;
  report(
    '当前实现',
    currentMs,
    current.items.length,
    current.items.filter((item) => item.auctionPrice !== null).length,
    current.items.filter((item) => item.auctionAmount !== null).length,
    `source=${current.source} status=${current.status} 昨日=${current.previousTradeDate}`,
  );

  // 对照实现：同一候选池，全部走腾讯分笔（不先取批量行情），作为「腾讯分笔单独跑」的基线
  const startedTencent = performance.now();
  const previousTradeDate = await fetchPreviousTradeDate();
  const pool = previousTradeDate ? await fetchPool(previousTradeDate) : [];
  const preCloses = await fetchTencentPreClose(pool.map((row) => row.symbol));
  const tencentDetails = await mapWithConcurrency(pool, CONCURRENCY, (row) =>
    fetchTencentDetail(row.symbol).catch(() => null),
  );
  const tencentMs = performance.now() - startedTencent;

  let withPrice = 0;
  let withAmount = 0;
  const ratios: number[] = [];
  pool.forEach((row, index) => {
    const detail = tencentDetails[index];
    if (!detail) return;
    withPrice += 1;
    if (detail.auctionAmount !== null) withAmount += 1;
    const preClose = preCloses[row.symbol];
    if (detail.auctionAmount !== null && row.previousAmount !== null && row.previousAmount > 0) {
      ratios.push((detail.auctionAmount / row.previousAmount) * 100);
    }
    if (preClose) detail.auctionPct = Number((((detail.auctionPrice - preClose) / preClose) * 100).toFixed(2));
  });
  report(
    '对照:纯腾讯分笔',
    tencentMs,
    pool.length,
    withPrice,
    withAmount,
    `昨日=${previousTradeDate} 量能比中位=${ratios.length > 0 ? percentile(ratios, 50).toFixed(2) : '—'}%`,
  );

  console.log(`\n结论：当前实现 ${(currentMs / tencentMs).toFixed(2)}x 于对照实现耗时`);

  // 逐只核对：两条链路的价格与量能是否一致
  const currentBySymbol = new Map(current.items.map((item) => [item.symbol, item]));
  let compared = 0;
  let priceMismatch = 0;
  let amountMismatch = 0;
  let maxRelDiff = 0;
  const samples: string[] = [];
  pool.forEach((row, index) => {
    const detail = tencentDetails[index];
    const item = currentBySymbol.get(row.symbol);
    if (!detail || !item || item.auctionPrice === null) return;
    compared += 1;
    if (Math.abs(item.auctionPrice - detail.auctionPrice) > 1e-6) {
      priceMismatch += 1;
      samples.push(`${row.symbol} 价 ${item.auctionPrice} vs ${detail.auctionPrice}`);
    }
    if (item.auctionAmount !== null && detail.auctionAmount !== null) {
      const rel = Math.abs(item.auctionAmount - detail.auctionAmount) / Math.max(1, item.auctionAmount);
      maxRelDiff = Math.max(maxRelDiff, rel);
      if (rel > 0.005) {
        amountMismatch += 1;
        samples.push(`${row.symbol} 量能 ${item.auctionAmount} vs ${detail.auctionAmount}`);
      }
    }
  });
  console.log(
    `逐只核对：可比 ${compared} 只 | 价格不一致 ${priceMismatch} 只 | 量能相对误差>0.5% 的 ${amountMismatch} 只 | 最大相对误差 ${(
      maxRelDiff * 100
    ).toFixed(3)}%`,
  );
  for (const line of samples.slice(0, 5)) console.log(`  · ${line}`);
};

await main();
