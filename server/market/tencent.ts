/**
 * 大盘指数：腾讯 qt.gtimg.cn
 *
 * 与个股行情同源（server/tencent/client.ts），只是指数必须用带市场前缀的代码：
 * `000001` 在腾讯里既是上证指数(sh000001)又是平安银行(sz000001)，不能用 toTencentSymbol 推导。
 */
import type { MarketIndex, MarketIndicesResponse, QuoteError } from '../../src/types.js';
import { TENCENT_FIELD, asNumber, fetchTencentQuoteFields } from '../tencent/client.js';

/** 与 server/market/eastmoney.ts 保持同一组指数、同一顺序 */
export const MARKET_INDEX_CONFIG = [
  { symbol: '000001', name: '上证指数', code: 'sh000001' },
  { symbol: '399001', name: '深证成指', code: 'sz399001' },
  { symbol: '399006', name: '创业板指', code: 'sz399006' },
] as const;

const unavailableIndex = (symbol: string, name: string, message: string): { index: MarketIndex; error: QuoteError } => ({
  index: {
    symbol,
    name,
    price: null,
    change: null,
    pct: null,
    amount: null,
    updatedAt: null,
    status: 'unavailable',
  },
  error: { symbol, message },
});

export const mapTencentMarket = (
  rows: Map<string, string[]>,
  fetchedAt: string,
): MarketIndicesResponse => {
  const indices: MarketIndex[] = [];
  const errors: QuoteError[] = [];

  for (const config of MARKET_INDEX_CONFIG) {
    const fields = rows.get(config.code);
    const price = fields ? asNumber(fields[TENCENT_FIELD.price]) : null;
    const change = fields ? asNumber(fields[TENCENT_FIELD.change]) : null;
    const pct = fields ? asNumber(fields[TENCENT_FIELD.pct]) : null;
    const amountWan = fields ? asNumber(fields[TENCENT_FIELD.amount]) : null;

    if (!fields || price === null || change === null || pct === null) {
      const { index, error } = unavailableIndex(config.symbol, config.name, '腾讯指数数据不完整');
      indices.push(index);
      errors.push(error);
      continue;
    }

    indices.push({
      symbol: config.symbol,
      name: config.name,
      price,
      change,
      pct,
      amount: amountWan === null ? null : Math.round(amountWan * 10_000),
      updatedAt: fetchedAt,
      status: 'fresh',
    });
  }

  return { indices, fetchedAt, source: 'tencent', errors };
};

export const fetchTencentMarket = async (
  fetchImpl: typeof fetch = fetch,
): Promise<MarketIndicesResponse> => {
  const fetchedAt = new Date().toISOString();
  const rows = await fetchTencentQuoteFields(
    MARKET_INDEX_CONFIG.map((config) => config.code),
    fetchImpl,
  );

  return mapTencentMarket(rows, fetchedAt);
};
