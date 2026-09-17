import { describe, expect, it, vi } from 'vitest';
import { fetchTencentMarket, mapTencentMarket } from './tencent.js';
import { TENCENT_FIELD } from '../tencent/client.js';

const GBK_NAME: Record<string, string> = {
  sh000001: 'c9cfd6a4d6b8cafd',
  sz399001: 'c9eed6a4b3c9d6b8',
  sz399006: 'b4b4d2b5b0e5d6b8',
};

const gbkNameToBytes = (hex: string): number[] =>
  (hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16));

const asciiToBytes = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const buildIndexLine = (code: string, overrides: Record<number, string> = {}): Uint8Array => {
  const symbol = code.slice(2);
  const fields = new Array<string>(60).fill('0');
  fields[TENCENT_FIELD.name] = '@NAME@';
  fields[TENCENT_FIELD.symbol] = symbol;
  fields[TENCENT_FIELD.price] = '3875.46';
  fields[TENCENT_FIELD.preClose] = '3891.60';
  fields[TENCENT_FIELD.change] = '-16.14';
  fields[TENCENT_FIELD.pct] = '-0.41';
  fields[TENCENT_FIELD.amount] = '86877307';
  fields[TENCENT_FIELD.updatedAt] = '20260917142548';
  for (const [index, value] of Object.entries(overrides)) {
    fields[Number(index)] = value;
  }

  const [head, tail] = `v_${code}="${fields.join('~')}";`.split('@NAME@');
  return Uint8Array.from([
    ...asciiToBytes(head),
    ...gbkNameToBytes(GBK_NAME[code] ?? ''),
    ...asciiToBytes(tail),
  ]);
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

const allIndexLines = (): Uint8Array[] =>
  Object.keys(GBK_NAME).map((code) => buildIndexLine(code));

describe('tencent market adapter', () => {
  it('maps the three board indices in a fixed order', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(gbkResponse(allIndexLines()));

    const result = await fetchTencentMarket(fetchImpl);

    expect(result.source).toBe('tencent');
    expect(result.errors).toEqual([]);
    expect(result.indices).toEqual([
      { symbol: '000001', name: '上证指数', price: 3875.46, change: -16.14, pct: -0.41, amount: 868_773_070_000, updatedAt: result.fetchedAt, status: 'fresh' },
      { symbol: '399001', name: '深证成指', price: 3875.46, change: -16.14, pct: -0.41, amount: 868_773_070_000, updatedAt: result.fetchedAt, status: 'fresh' },
      { symbol: '399006', name: '创业板指', price: 3875.46, change: -16.14, pct: -0.41, amount: 868_773_070_000, updatedAt: result.fetchedAt, status: 'fresh' },
    ]);
  });

  it('requests the indices with explicit market prefixes', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(gbkResponse([]));

    await fetchTencentMarket(fetchImpl);

    const url = String(fetchImpl.mock.calls[0]?.[0]);
    // 000001 在上证是上证指数、在深证是平安银行，必须带前缀区分
    expect(url).toContain('sh000001');
    expect(url).toContain('sz399001');
    expect(url).toContain('sz399006');
  });

  it('marks an index unavailable when its fields are incomplete', () => {
    const rows = new Map<string, string[]>([
      [
        'sh000001',
        (() => {
          const fields = new Array<string>(60).fill('0');
          fields[TENCENT_FIELD.price] = '-';
          return fields;
        })(),
      ],
    ]);

    const result = mapTencentMarket(rows, '2026-09-17T06:25:48.000Z');

    expect(result.indices[0]).toMatchObject({ symbol: '000001', status: 'unavailable', price: null });
    expect(result.errors).toContainEqual({ symbol: '000001', message: '腾讯指数数据不完整' });
    expect(result.indices.filter((index) => index.status === 'fresh')).toHaveLength(0);
  });
});
