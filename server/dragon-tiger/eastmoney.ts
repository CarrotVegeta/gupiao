import type { DragonTigerItem, DragonTigerResponse } from '../../src/types.js';

type EastmoneyDragonTigerRow = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 5_000;
const REQUEST_PAGE_SIZE = 500;
const DRAGON_TIGER_ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const DRAGON_TIGER_COLUMNS = [
  'SECURITY_CODE',
  'SECURITY_NAME_ABBR',
  'TRADE_DATE',
  'EXPLAIN',
  'EXPLANATION',
  'CLOSE_PRICE',
  'CHANGE_RATE',
  'BILLBOARD_NET_AMT',
  'BILLBOARD_BUY_AMT',
  'BILLBOARD_SELL_AMT',
].join(',');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAbortError = (error: unknown): boolean => isRecord(error) && error.name === 'AbortError';

const createAbortError = (): Error => {
  const error = new Error('request aborted');
  error.name = 'AbortError';
  return error;
};

const asNumber = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && (value.trim() === '' || value.trim() === '-'))
  ) {
    return null;
  }

  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeSymbol = (value: unknown): string => {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 999_999
      ? String(value).padStart(6, '0')
      : '';
  }

  if (typeof value !== 'string') {
    return '';
  }

  const raw = value.trim().toUpperCase();

  if (/^\d{1,6}$/.test(raw)) {
    return raw.padStart(6, '0');
  }

  const prefixed = raw.match(/^(?:SH|SZ|BJ)(\d{6})$/);
  if (prefixed) {
    return prefixed[1];
  }

  const quoteId = raw.match(/^(?:[01]\.)?(\d{6})(?:\.(?:SH|SZ|BJ))?$/);
  return quoteId?.[1] ?? '';
};

const toIsoTradeDate = (tradeDate: string): string =>
  `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;

const buildUnavailableResponse = (
  message: string,
  fetchedAt = new Date().toISOString(),
): DragonTigerResponse => ({
  tradeDate: null,
  items: [],
  fetchedAt,
  source: 'eastmoney',
  status: 'unavailable',
  error: message,
});

export const mapEastmoneyDragonTigerItem = (
  raw: EastmoneyDragonTigerRow,
): DragonTigerItem | null => {
  const symbol = normalizeSymbol(raw.SECURITY_CODE ?? raw.SECUCODE);
  const name = asString(raw.SECURITY_NAME_ABBR ?? raw.SECURITY_NAME);

  if (!symbol || !name) {
    return null;
  }

  return {
    symbol,
    name,
    closePrice: asNumber(raw.CLOSE_PRICE),
    changePct: asNumber(raw.CHANGE_RATE),
    reason: asString(raw.EXPLANATION ?? raw.EXPLAIN) || null,
    buyAmount: asNumber(raw.BILLBOARD_BUY_AMT),
    sellAmount: asNumber(raw.BILLBOARD_SELL_AMT),
    netAmount: asNumber(raw.BILLBOARD_NET_AMT),
  };
};

const toRequestUrl = (tradeDate: string): string => {
  const isoDate = toIsoTradeDate(tradeDate);
  const params = new URLSearchParams({
    reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
    columns: DRAGON_TIGER_COLUMNS,
    source: 'WEB',
    client: 'WEB',
    filter: `(TRADE_DATE='${isoDate}')`,
    sortColumns: 'BILLBOARD_NET_AMT',
    sortTypes: '-1',
    pageSize: String(REQUEST_PAGE_SIZE),
    pageNumber: '1',
  });

  return `${DRAGON_TIGER_ENDPOINT}?${params.toString()}`;
};

export const fetchEastmoneyDragonTiger = async (
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DragonTigerResponse> => {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(toRequestUrl(tradeDate), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return buildUnavailableResponse(
        `龙虎榜上游请求失败（HTTP ${response.status}）`,
        fetchedAt,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw createAbortError();
      }

      return buildUnavailableResponse('龙虎榜上游响应格式错误', fetchedAt);
    }

    if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.data)) {
      return buildUnavailableResponse('龙虎榜上游数据格式错误', fetchedAt);
    }

    const items: DragonTigerItem[] = [];
    const seen = new Set<string>();

    for (const raw of payload.result.data) {
      const item = isRecord(raw) ? mapEastmoneyDragonTigerItem(raw) : null;

      if (!item || seen.has(item.symbol)) {
        continue;
      }

      seen.add(item.symbol);
      items.push(item);
    }

    return {
      tradeDate,
      items,
      fetchedAt,
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    };
  } catch (error) {
    return buildUnavailableResponse(
      controller.signal.aborted || isAbortError(error)
        ? '龙虎榜上游请求超时'
        : '龙虎榜上游请求失败',
      fetchedAt,
    );
  } finally {
    clearTimeout(timer);
  }
};
