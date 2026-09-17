import { describe, expect, it } from 'vitest';
import {
  fetchEastmoneySprintLimitUp,
  mapEastmoneySprintLimitUpItem,
} from './eastmoney.js';

const validRow = {
  c: '600000',
  n: '浦发银行',
  p: 12340,
  ztp: 12700,
  zdp: 9.87,
  zs: 2.35,
  zttj: { days: 3, ct: 2 },
  cc: 1,
  hybk: '银行',
};

describe('eastmoney sprint limit-up adapter', () => {
  it('maps the official strong-pool fields without applying a local threshold', () => {
    expect(mapEastmoneySprintLimitUpItem(validRow)).toEqual({
      symbol: '600000',
      name: '浦发银行',
      price: 12.34,
      pct: 9.87,
      speed: 2.35,
      boardCount: 2,
      probability: null,
      reason: '60日新高',
    });
  });

  it('keeps nullable upstream values and ignores rows without stock identity', () => {
    expect(mapEastmoneySprintLimitUpItem({ ...validRow, c: '' })).toBeNull();
    expect(
      mapEastmoneySprintLimitUpItem({
        ...validRow,
        c: 'SH600000',
        n: ' 浦发银行 ',
        p: null,
        zdp: undefined,
        zs: 'not-a-number',
        zttj: null,
        cc: null,
        hybk: ' ',
      }),
    ).toEqual({
      symbol: '600000',
      name: '浦发银行',
      price: null,
      pct: null,
      speed: null,
      boardCount: null,
      probability: null,
      reason: null,
    });
  });

  it('keeps only stocks with strong gains, positive speed, and a small gap to the limit-up price', async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      expect(String(input)).toBe(
        'https://push2ex.eastmoney.com/getTopicQSPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=100&sort=zdp%3Adesc&date=20260827',
      );

      return new Response(
        JSON.stringify({
          rc: 0,
          data: {
            qdate: 20260827,
            tc: 4,
            pool: [
              validRow,
              { ...validRow, c: '000001', n: '平安银行', p: 12700, ztp: 12700 },
              { ...validRow, c: '000002', n: '低涨幅', p: 12000, ztp: 13000, zdp: 6.8 },
              { ...validRow, c: '000003', n: '低涨速', p: 12600, ztp: 13000, zs: 0.09 },
            ],
          },
        }),
      );
    };

    await expect(fetchEastmoneySprintLimitUp('20260827', fetchImpl)).resolves.toMatchObject({
      tradeDate: '20260827',
      items: [
        expect.objectContaining({ symbol: '600000' }),
      ],
      source: 'eastmoney',
      status: 'fresh',
      error: null,
    });
  });

  it('returns stable unavailable responses for upstream failures and malformed payloads', async () => {
    const failedFetch = async (): Promise<Response> => new Response('busy', { status: 503 });
    const malformedFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ rc: 0, data: { pool: {} } }));

    await expect(fetchEastmoneySprintLimitUp('20260827', failedFetch)).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '冲刺涨停上游请求失败（HTTP 503）',
    });
    await expect(
      fetchEastmoneySprintLimitUp('20260827', malformedFetch),
    ).resolves.toMatchObject({
      tradeDate: null,
      items: [],
      source: 'eastmoney',
      status: 'unavailable',
      error: '冲刺涨停上游数据格式错误',
    });
  });
});
