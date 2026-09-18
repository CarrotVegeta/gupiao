/**
 * 抓取新浪分钟K线，用于重建「早盘开盘量能」代理。
 *
 * 背景：09:25 集合竞价的成交量没有免费的历史接口（腾讯分笔忽略日期参数、
 * 网易 cjmx 在本机 502、东财 push2his 直接断连）。但集合竞价那一笔会并入当日
 * 第一根分钟K线，所以可以用「首根分钟K线量」作为「竞价量能」的代理：
 *   竞价量能代理 = 首根分钟K线成交量 / 昨日全天成交量
 *   量比代理     = 首根分钟K线成交量 / 近5日同段均量
 * scale 越大覆盖越久但代理越粗（scale=15 首根 09:45，scale=30 首根 10:00）。
 *
 * 用法：npx tsx scripts/fetch-sina-minute.ts [15,30]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.resolve(process.cwd(), 'scripts/output/cache');
mkdirSync(CACHE_DIR, { recursive: true });

const SCALES = (process.argv[2] ?? '15,30').split(',').map(Number).filter(Number.isFinite);
const MIN_REQUEST_INTERVAL_MS = 90;
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
let nextSlotAt = 0;
const throttle = async () => {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = now + wait + MIN_REQUEST_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
};

const toSinaSymbol = (symbol: string): string => {
  if (symbol.startsWith('6')) return `sh${symbol}`;
  if (symbol.startsWith('0') || symbol.startsWith('3')) return `sz${symbol}`;
  return `bj${symbol}`;
};

const fetchCached = async (key: string, url: string): Promise<string | null> => {
  const cachePath = path.join(CACHE_DIR, `${key}.txt`);
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
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
    } catch {
      await sleep(Math.min(500 * 2 ** attempt, 10_000));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
};

const history = JSON.parse(readFileSync('scripts/output/limit-up-history.json', 'utf8')) as {
  ticks: { symbol: string }[];
};
const symbols = [...new Set(history.ticks.map(t => t.symbol))].sort();
console.log(`候选股票 ${symbols.length} 只，抓取 scale=${SCALES.join(',')}`);

let nextIndex = 0;
let done = 0;
let failed = 0;
const worker = async () => {
  while (nextIndex < symbols.length) {
    const symbol = symbols[nextIndex];
    nextIndex += 1;
    for (const scale of SCALES) {
      const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
        `CN_MarketData.getKLineData?symbol=${toSinaSymbol(symbol)}&scale=${scale}&ma=no&datalen=1023`;
      const text = await fetchCached(`sina-m${scale}-${symbol}`, url);
      if (text === null) failed += 1;
    }
    done += 1;
    if (done % 200 === 0) console.log(`  进度 ${done}/${symbols.length}，失败 ${failed}`);
  }
};

await Promise.all(Array.from({ length: 5 }, () => worker()));
console.log(`完成：${done} 只，失败请求 ${failed}`);
