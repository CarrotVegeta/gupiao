import { describe, expect, it } from 'vitest';
import { fetchEastmoneyDragonTiger, mapEastmoneyDragonTigerItem } from './eastmoney.js';

const validRow = {
  SECURITY_CODE: '600000',
  SECURITY_NAME_ABBR: '浦发银行',
  TRADE_DATE: '2026-08-19',
  CLOSE_PRICE: 12.34,
  CHANGE_RATE: 5.67,
  EXPLANATION: '日涨幅偏离值达到7%的前5只证券',
  BILLBOARD_BUY_AMT: 234_567_890.12,
  BILLBOARD_SELL_AMT: 123_456_789.01,
  BILLBOARD_NET_AMT: 111_111_101.11,
};

describe('eastmoney dragon-tiger adapter', () => {
  it('maps Eastmoney daily billboard fields into a normalized item', () => {
    expect(mapEastmoneyDragonTigerItem(validRow)).toEqual({
      symbol: '600000',
      name: '浦发银行',
      closePrice: 12.34,
      changePct: 5.67,
      reason: '日涨幅偏离值达到7%的前5只证券',
      buyAmount: 234_567_890.12,
      sellAmount: 123_456_789.01,
      netAmount: 111_111_101.11,
    });
  });

  it('ignores rows without a usable symbol or name and normalizes nullable fields', () => {
    expect(mapEastmoneyDragonTigerItem({ ...validRow, SECURITY_CODE: '' })).toBeNull();
    expect(mapEastmoneyDragonTigerItem({ ...validRow, SECURITY_NAME_ABBR: '' })).toBeNull();
    expect(
      mapEastmoneyDragonTigerItem({
        ...validRow,
        SECURITY_CODE: '1.600000',
        CLOSE_PRICE: '-',
        CHANGE_RATE: undefined,
        EXPLANATION: ' ',
        BILLBOARD_BUY_AMT: null,
        BILLBOARD_SELL_AMT: '',
        BILLBOARD_NET_AMT: 'not-a-number',
      }),
    ).toEqual({
      symbol: '600000',
      name: '浦发银行',
      closePrice: null,
      changePct: null,
      reason: null,
      buyAmount: null,
      sellAmount: null,
      netAmount: null,
    });
  });

  it('requests a single trade date and returns a fresh response', async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      expect(url.searchParams.get('reportName')).toBe('RPT_DAILYBILLBOARD_DETAILSNEW');
      expect(url.searchParams.get('sortColumns')).toBe('BILLBOARD_NET_AMT');
      expect(url.searchParams.get('sortTypes')).toBe('-1');
      expect(url.searchParams.get('filter')).toContain("TRADE_DATE='2026-08-19'");

      return new Response(JSON.stringify({ result: { data: [validRow], pages: 1, count: 1 } }));
    };

    await expect(fetchEastmoneyDragonTiger('20260819', fetchImpl)).resolves.toMatchObject({
      tradeDate: '20260819',
      items: [
        expect.objectContaining({ symbol: '600000', netAmount: 111_111_101.11 }),
      ],
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    });
  });

  it('returns a fresh empty response when the upstream has no rows', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ result: { data: [], pages: 0, count: 0 } }));

    await expect(fetchEastmoneyDragonTiger('20260819', fetchImpl)).resolves.toMatchObject({
      tradeDate: '20260819',
      items: [],
      status: 'fresh',
      error: null,
    });
  });

  it('returns stable unavailable responses for upstream failures and malformed payloads', async () => {
    const failedFetch = async (): Promise<Response> => new Response('busy', { status: 503 });
    const malformedFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ result: { data: {} } }));

    await expect(fetchEastmoneyDragonTiger('20260819', failedFetch)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '龙虎榜上游请求失败（HTTP 503）',
    });
    await expect(fetchEastmoneyDragonTiger('20260819', malformedFetch)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      status: 'unavailable',
      error: '龙虎榜上游数据格式错误',
    });
  });
});
