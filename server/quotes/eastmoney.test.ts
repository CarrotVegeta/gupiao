import { describe, expect, it, vi } from 'vitest';
import {
  fetchEastmoneyQuotes,
  fetchEastmoneySearch,
  mapEastmoneyQuote,
  mapEastmoneySearch,
  toEastmoneySecId,
} from './eastmoney.js';

const validPayload = (symbol: string) => ({
  f43: 129799,
  f57: symbol,
  f58: '贵州茅台',
  f59: 2,
  f60: 129309,
  f169: 490,
  f170: 38,
  f168: 17,
  f86: 1787020200,
});

describe('eastmoney quote adapter', () => {
  it('maps search suggestions into stock choices', () => {
    expect(
      mapEastmoneySearch({
        QuotationCodeTable: {
          Data: [
            { Code: '600519', Name: '贵州茅台', QuoteID: '1.600519', MktNum: '1' },
            { Code: '000001', Name: '平安银行', QuoteID: '0.000001', MktNum: '0' },
          ],
        },
      }),
    ).toEqual([
      { symbol: '600519', name: '贵州茅台' },
      { symbol: '000001', name: '平安银行' },
    ]);
  });

  it('ignores malformed search suggestions', () => {
    expect(
      mapEastmoneySearch({
        QuotationCodeTable: {
          Data: [
            { Code: '600519', Name: '贵州茅台' },
            { Code: 'sh600519', Name: '非法代码' },
            { Code: '000001', Name: '' },
          ],
        },
      }),
    ).toEqual([{ symbol: '600519', name: '贵州茅台' }]);
  });

  it('fetches suggestions through the Eastmoney search endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          QuotationCodeTable: { Data: [{ Code: '600519', Name: '贵州茅台' }] },
        }),
      ),
    );

    await expect(fetchEastmoneySearch('贵州茅台', fetchImpl)).resolves.toEqual([
      { symbol: '600519', name: '贵州茅台' },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('input=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0');
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('count=8');
  });

  it('maps Shanghai and Shenzhen symbols to Eastmoney security ids', () => {
    expect(toEastmoneySecId('600519')).toBe('1.600519');
    expect(toEastmoneySecId('000001')).toBe('0.000001');
  });

  it('maps the vendor field numbers into a normalized quote', () => {
    expect(
      mapEastmoneyQuote(
        {
          data: validPayload('600519'),
        },
        '2026-08-18T10:30:00.000Z',
      ),
    ).toMatchObject({
      symbol: '600519',
      name: '贵州茅台',
      price: 1297.99,
      preClose: 1293.09,
      change: 4.9,
      pct: 0.38,
      turnover: 0.17,
      updatedAt: '2026-08-18T02:30:00.000Z',
      status: 'fresh',
      source: 'eastmoney',
    });
  });

  it('preserves support for a 14-digit vendor timestamp string', () => {
    expect(
      mapEastmoneyQuote(
        {
          data: { ...validPayload('600519'), f86: '20260818103000' },
        },
        '2026-08-18T11:00:00.000Z',
      ).updatedAt,
    ).toBe('2026-08-18T02:30:00.000Z');
  });

  it('returns an unavailable quote for an empty vendor payload', () => {
    expect(mapEastmoneyQuote({ data: null }, '2026-08-18T10:30:00.000Z')).toMatchObject({
      symbol: '',
      price: null,
      pct: null,
      status: 'unavailable',
    });
  });

  it('keeps a successful symbol when another symbol request fails', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              diff: [
                {
                  f2: 1297.99,
                  f3: 0.38,
                  f4: 4.9,
                  f8: 0.17,
                  f12: '600519',
                  f14: '贵州茅台',
                  f18: 1293.09,
                },
              ],
            },
          }),
        ),
      )
      .mockRejectedValueOnce(new Error('upstream timeout'));

    const result = await fetchEastmoneyQuotes(['600519', '000001'], fetchImpl);

    expect(result.quotes).toHaveLength(1);
    expect(result.errors).toEqual([{ symbol: '000001', message: 'upstream timeout' }]);
  });

  it('reports an empty payload against the requested symbol', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { diff: [] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })));

    const result = await fetchEastmoneyQuotes(['600519'], fetchImpl);

    expect(result.quotes).toEqual([]);
    expect(result.errors).toEqual([{ symbol: '600519', message: '上游未返回行情数据' }]);
  });

  it('reports an incomplete quote against the requested symbol', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { diff: [] } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { ...validPayload('600519'), f169: '-' },
          }),
        ),
      );

    const result = await fetchEastmoneyQuotes(['600519'], fetchImpl);

    expect(result.quotes).toEqual([]);
    expect(result.errors).toEqual([{ symbol: '600519', message: '上游行情数据不完整' }]);
  });

  it('normalizes whitespace before building the upstream request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            diff: [
              {
                f2: 1297.99,
                f3: 0.38,
                f4: 4.9,
                f8: 0.17,
                f12: '600519',
                f14: '贵州茅台',
                f18: 1293.09,
              },
            ],
          },
        }),
      ),
    );

    const result = await fetchEastmoneyQuotes([' 600519 '], fetchImpl);

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('secids=1.600519');
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('ulist.np/get');
    expect(result.quotes).toMatchObject([{ symbol: '600519', status: 'fresh' }]);
    expect(result.errors).toEqual([]);
  });

  it('returns a per-symbol error for invalid symbols without calling upstream', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            diff: [
              {
                f2: 12.3,
                f3: 0.82,
                f4: 0.1,
                f8: 1.1,
                f12: '000001',
                f14: '平安银行',
                f18: 12.2,
              },
            ],
          },
        }),
      ),
    );

    const result = await fetchEastmoneyQuotes(['sh600519', '000001'], fetchImpl);

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('secids=0.000001');
    expect(result.quotes).toMatchObject([{ symbol: '000001', status: 'fresh' }]);
    expect(result.errors).toContainEqual({
      symbol: 'sh600519',
      message: '股票代码必须是 6 位数字',
    });
  });
});
