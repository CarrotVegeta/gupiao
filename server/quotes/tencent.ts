/**
 * 个股行情：腾讯 qt.gtimg.cn
 *
 * 选它做行情主源的原因（同网络实测，见 scripts/source-benchmark.ts、scripts/output/host-health.json）：
 * * 可用性：`push2.eastmoney.com` 在本机 15/15 次被上游直接断连（RemoteDisconnected），腾讯 15/15 正常
 * * 延迟：腾讯单批 ~50ms，东财 ~250ms（且失败时要等超时）
 * * 体积：腾讯批量 50 只 ~22KB，东财 ulist 单只就要 ~2KB
 * 东财 push2delay 作为兜底仍在 server/quotes/eastmoney.ts 中保留。
 */
import type { Quote, QuoteError } from '../../src/types.js';
import {
  TENCENT_FIELD,
  asNumber,
  fetchTencentQuoteFields,
  parseTencentTime,
  toTencentSymbol,
} from '../tencent/client.js';

export const mapTencentQuote = (
  symbol: string,
  fields: string[],
  fetchedAt: string,
): Quote => {
  // gtimg 会把三字名补空格对齐（「金 螳 螂」「万 科Ａ」），去掉填充空格
  const name = String(fields[TENCENT_FIELD.name] ?? '').replace(/\s+/g, '');
  const price = asNumber(fields[TENCENT_FIELD.price]);
  const change = asNumber(fields[TENCENT_FIELD.change]);
  const pct = asNumber(fields[TENCENT_FIELD.pct]);
  const preClose = asNumber(fields[TENCENT_FIELD.preClose]);
  const turnover = asNumber(fields[TENCENT_FIELD.turnover]);
  const volumeRatio = asNumber(fields[TENCENT_FIELD.volumeRatio]);
  const amountWan = asNumber(fields[TENCENT_FIELD.amount]);
  const updatedAt = parseTencentTime(fields[TENCENT_FIELD.updatedAt]) ?? fetchedAt;
  const isComplete =
    name.length > 0 && price !== null && change !== null && pct !== null && preClose !== null;

  return {
    symbol,
    name,
    price,
    change,
    pct,
    turnover,
    volumeRatio,
    amount: amountWan === null ? null : Math.round(amountWan * 10_000),
    preClose,
    updatedAt,
    source: 'tencent',
    status: isComplete ? 'fresh' : 'stale',
  };
};

/**
 * 批量行情。返回的 error 列表只包含「腾讯整批都没给出这一只」的代码，
 * 由调用方决定是否切东财兜底，而不是在这里就把状态压成 stale。
 */
export const fetchTencentQuotes = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ quotes: Quote[]; errors: QuoteError[] }> => {
  const fetchedAt = new Date().toISOString();
  const unique = Array.from(new Set(symbols));
  const rows = await fetchTencentQuoteFields(unique.map(toTencentSymbol), fetchImpl);

  const quotes: Quote[] = [];
  const errors: QuoteError[] = [];

  for (const symbol of unique) {
    const fields = rows.get(toTencentSymbol(symbol));

    if (!fields) {
      errors.push({ symbol, message: '腾讯未返回行情数据' });
      continue;
    }

    const quote = mapTencentQuote(symbol, fields, fetchedAt);
    if (quote.status === 'fresh') {
      quotes.push(quote);
      continue;
    }

    errors.push({ symbol, message: '腾讯行情数据不完整' });
  }

  return { quotes, errors };
};
