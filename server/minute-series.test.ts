import { describe, expect, it } from 'vitest';
import { fetchMinuteSeries, parseTencentMinuteSeries } from './minute-series.js';

/** 固件取自腾讯 `ifzq.gtimg.cn/appstock/app/minute/query` 的真实返回结构 */
const payloadOf = (code: string, rows: string[]) => ({
  code: 0,
  msg: '',
  data: {
    [code]: {
      data: { data: rows },
      qt: { [code]: ['1', '贵州茅台', '600519'] },
    },
  },
});

describe('parseTencentMinuteSeries', () => {
  it('解析 `HHMM 价 量 额` 行，按时间升序返回价格', () => {
    const parsed = parseTencentMinuteSeries(
      payloadOf('sh600519', [
        '0930 1262.99 113 14271787.32',
        '0931 1259.18 529 66704818.26',
        '0932 1261.44 913 115121045.89',
      ]),
      '600519',
    );

    expect(parsed).toEqual({
      points: [1262.99, 1259.18, 1261.44],
      times: ['0930', '0931', '0932'],
    });
  });

  it('交易所前缀由代码推导，不看请求顺序', () => {
    expect(parseTencentMinuteSeries(payloadOf('sz000001', ['0930 10.5 1 1']), '000001')).not.toBeNull();
    expect(parseTencentMinuteSeries(payloadOf('bj920092', ['0930 24.88 157 1']), '920092')).not.toBeNull();
    // 同上但键不匹配 → 认不出来，返回 null 而不是错拿别的票
    expect(parseTencentMinuteSeries(payloadOf('sz000001', ['0930 10.5 1 1']), '600519')).toBeNull();
  });

  it('跳过格式异常与零价的行，而不是塞进 0 画出假跳水', () => {
    const parsed = parseTencentMinuteSeries(
      payloadOf('sh600519', [
        '0930 1262.99 113 14271787.32',
        'garbage',
        '0931',
        '0932 0 0 0',
        '0933 -1 5 5',
        '0934 1261.00 20 20',
      ]),
      '600519',
    );

    expect(parsed?.points).toEqual([1262.99, 1261]);
    expect(parsed?.times).toEqual(['0930', '0934']);
  });

  it('结构不对时返回 null（上游改版不会抛异常）', () => {
    expect(parseTencentMinuteSeries(null, '600519')).toBeNull();
    expect(parseTencentMinuteSeries({ code: -1, msg: 'code param error' }, '600519')).toBeNull();
    expect(parseTencentMinuteSeries({ data: { sh600519: {} } }, '600519')).toBeNull();
    expect(parseTencentMinuteSeries(payloadOf('sh600519', []), '600519')).toBeNull();
  });
});

describe('fetchMinuteSeries', () => {
  const jsonResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response;

  it('带上昨收，并把缺失的票排除在结果之外', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('sh600519')) {
        return jsonResponse(payloadOf('sh600519', ['0930 1262.99 1 1', '0931 1259.18 1 1']));
      }
      // 北交所/停牌：上游返回空结构
      return jsonResponse({ code: 0, data: { sz000920: { data: { data: [] } } } });
    }) as unknown as typeof fetch;

    const series = await fetchMinuteSeries(
      ['600519', '000920'],
      new Map([
        ['600519', 1266.98],
        ['000920', null],
      ]),
      fetchImpl,
    );

    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({
      symbol: '600519',
      preClose: 1266.98,
      points: [1262.99, 1259.18],
      times: ['0930', '0931'],
    });
  });

  it('昨收缺失时给 null，不用 0 冒充', async () => {
    const fetchImpl = (async () =>
      jsonResponse(payloadOf('sh600519', ['0930 1262.99 1 1']))) as unknown as typeof fetch;

    const [series] = await fetchMinuteSeries(['600519'], new Map(), fetchImpl);

    expect(series.preClose).toBeNull();
  });

  it('单只票失败不影响其它票，也不抛异常', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes('sh600519')) {
        throw new Error('boom');
      }
      return jsonResponse(payloadOf('sz000001', ['0930 10.5 1 1']));
    }) as unknown as typeof fetch;

    const series = await fetchMinuteSeries(['600519', '000001'], new Map(), fetchImpl);

    expect(series.map((item) => item.symbol)).toEqual(['000001']);
  });

  it('空输入不打上游', async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;

    expect(await fetchMinuteSeries([], new Map(), fetchImpl)).toEqual([]);
    expect(called).toBe(0);
  });
});
