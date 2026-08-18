import { describe, expect, it, vi } from 'vitest';
import {
  fetchEastmoneyQuotes,
  mapEastmoneyQuote,
  toEastmoneySecId,
} from './eastmoney.js';

const validPayload = (symbol: string) => ({
  f43: 168.2,
  f57: symbol,
  f58: '贵州茅台',
  f60: 165,
  f169: 3.2,
  f170: 1.98,
  f86: '20260818103000',
});

describe('eastmoney quote adapter', () => {
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
      price: 168.2,
      preClose: 165,
      change: 3.2,
      pct: 1.98,
      status: 'fresh',
      source: 'eastmoney',
    });
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: validPayload('600519') })))
      .mockRejectedValueOnce(new Error('upstream timeout'));

    const result = await fetchEastmoneyQuotes(['600519', '000001'], fetchImpl);

    expect(result.quotes).toHaveLength(1);
    expect(result.errors).toEqual([{ symbol: '000001', message: 'upstream timeout' }]);
  });

  it('normalizes whitespace before building the upstream request', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: validPayload('600519') })));

    const result = await fetchEastmoneyQuotes([' 600519 '], fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('secid=1.600519');
    expect(result.quotes).toMatchObject([{ symbol: '600519', status: 'fresh' }]);
    expect(result.errors).toEqual([]);
  });

  it('returns a per-symbol error for invalid symbols without calling upstream', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: validPayload('000001') })));

    const result = await fetchEastmoneyQuotes(['sh600519', '000001'], fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.quotes).toMatchObject([{ symbol: '000001', status: 'fresh' }]);
    expect(result.errors).toContainEqual({
      symbol: 'sh600519',
      message: '股票代码必须是 6 位数字',
    });
  });
});
