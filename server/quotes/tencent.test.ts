import { describe, expect, it, vi } from 'vitest';
import { fetchTencentQuotes, mapTencentQuote } from './tencent.js';
import { TENCENT_FIELD } from '../tencent/client.js';

/** 贵州茅台 / 平安银行 的 GBK 字节（腾讯 qt 返回 GBK，用 UTF-8 解会变乱码） */
const GBK_NAME = {
  maotai: 'b9f3d6ddc3a9cca8',
  pingan: 'c6bdb0b2d2f8d0d0',
} as const;

const gbkNameToBytes = (hex: string): number[] =>
  (hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16));

const asciiToBytes = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

/** 造一行 gtimg 返回：`v_sh600519="1~贵州茅台~600519~1263.10~...";` */
const buildQuoteLine = (
  market: string,
  code: string,
  nameHex: string,
  overrides: Record<number, string> = {},
): Uint8Array => {
  const fields = new Array<string>(60).fill('0');
  fields[TENCENT_FIELD.name] = '@NAME@';
  fields[TENCENT_FIELD.symbol] = code;
  fields[TENCENT_FIELD.price] = '1263.10';
  fields[TENCENT_FIELD.preClose] = '1258.00';
  fields[TENCENT_FIELD.open] = '1257.98';
  fields[TENCENT_FIELD.updatedAt] = '20260917142547';
  fields[TENCENT_FIELD.change] = '5.10';
  fields[TENCENT_FIELD.pct] = '0.41';
  fields[TENCENT_FIELD.turnover] = '0.12';
  fields[TENCENT_FIELD.volumeRatio] = '1.20';
  fields[TENCENT_FIELD.amount] = '64000';
  for (const [index, value] of Object.entries(overrides)) {
    fields[Number(index)] = value;
  }

  const [head, tail] = `v_${market}${code}="${fields.join('~')}";`.split('@NAME@');
  return Uint8Array.from([...asciiToBytes(head), ...gbkNameToBytes(nameHex), ...asciiToBytes(tail)]);
};

const gbkResponse = (lines: Uint8Array[]): Response => {
  const total = lines.reduce((sum, line) => sum + line.length + 1, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const line of lines) {
    body.set(line, offset);
    offset += line.length;
    body[offset] = 0x0a;
    offset += 1;
  }

  return new Response(body);
};

describe('tencent quote adapter', () => {
  it('strips the padding spaces gtimg inserts into three-character names', () => {
    const fields = new Array<string>(60).fill('0');
    fields[TENCENT_FIELD.name] = '金 螳 螂';
    fields[TENCENT_FIELD.symbol] = '002081';
    fields[TENCENT_FIELD.price] = '4.80';
    fields[TENCENT_FIELD.preClose] = '4.86';
    fields[TENCENT_FIELD.change] = '-0.06';
    fields[TENCENT_FIELD.pct] = '-1.23';
    fields[TENCENT_FIELD.updatedAt] = '20260917142547';

    expect(mapTencentQuote('002081', fields, '2026-09-17T06:00:00.000Z').name).toBe('金螳螂');
  });

  it('maps gtimg fields into a fresh quote', () => {
    const fields = new Array<string>(60).fill('0');
    fields[TENCENT_FIELD.name] = '贵州茅台';
    fields[TENCENT_FIELD.symbol] = '600519';
    fields[TENCENT_FIELD.price] = '1263.10';
    fields[TENCENT_FIELD.preClose] = '1258.00';
    fields[TENCENT_FIELD.change] = '5.10';
    fields[TENCENT_FIELD.pct] = '0.41';
    fields[TENCENT_FIELD.turnover] = '0.12';
  fields[TENCENT_FIELD.volumeRatio] = '1.20';
  fields[TENCENT_FIELD.amount] = '64000';
    fields[TENCENT_FIELD.updatedAt] = '20260917142547';

    expect(mapTencentQuote('600519', fields, '2026-09-17T06:00:00.000Z')).toEqual({
      symbol: '600519',
      name: '贵州茅台',
      price: 1263.1,
      change: 5.1,
      pct: 0.41,
      turnover: 0.12,
      volumeRatio: 1.2,
      amount: 640_000_000,
      preClose: 1258,
      updatedAt: '2026-09-17T06:25:47.000Z',
      source: 'tencent',
      status: 'fresh',
    });
  });

  it('marks a quote without a usable price as stale', () => {
    const fields = new Array<string>(60).fill('-');
    fields[TENCENT_FIELD.name] = '停牌股';

    expect(mapTencentQuote('600519', fields, '2026-09-17T06:00:00.000Z')).toMatchObject({
      status: 'stale',
      price: null,
      updatedAt: '2026-09-17T06:00:00.000Z',
    });
  });

  it('decodes GBK names from the upstream body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      gbkResponse([
        buildQuoteLine('sh', '600519', GBK_NAME.maotai),
        buildQuoteLine('sz', '000001', GBK_NAME.pingan),
      ]),
    );

    const result = await fetchTencentQuotes(['600519', '000001'], fetchImpl);

    expect(result.quotes.map((quote) => [quote.symbol, quote.name])).toEqual([
      ['600519', '贵州茅台'],
      ['000001', '平安银行'],
    ]);
    expect(result.errors).toEqual([]);
  });

  it('reports symbols the upstream did not return', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(gbkResponse([buildQuoteLine('sh', '600519', GBK_NAME.maotai)]));

    const result = await fetchTencentQuotes(['600519', '300750'], fetchImpl);

    expect(result.quotes).toHaveLength(1);
    expect(result.errors).toEqual([{ symbol: '300750', message: '腾讯未返回行情数据' }]);
  });

  it('splits more than fifty symbols into batched requests', async () => {
    const symbols = Array.from({ length: 51 }, (_value, index) =>
      `6005${String(index).padStart(2, '0')}`,
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(gbkResponse([]));

    await fetchTencentQuotes(symbols, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const requests = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(requests[0]?.split('=')[1]?.split(',')).toHaveLength(50);
    expect(requests[1]?.split('=')[1]?.split(',')).toHaveLength(1);
  });

  it('reports every symbol when the upstream request throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket hang up'));

    const result = await fetchTencentQuotes(['600519'], fetchImpl);

    expect(result.quotes).toEqual([]);
    expect(result.errors).toEqual([{ symbol: '600519', message: '腾讯未返回行情数据' }]);
  });
});
