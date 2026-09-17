/**
 * 数据源对比基准：腾讯 vs 东财（同一份数据、同一台机器、同一时刻）
 *
 * 覆盖竞价链路里 4 类上游请求，逐项对比「成功率 / 延迟分位 / 载荷体积 / 数据是否一致」：
 *   1. 交易日历      : 腾讯指数日K        vs 东财 push2his 日K
 *   2. 大盘竞价缺口  : 腾讯 qt.gtimg.cn   vs 东财 push2 单只行情
 *   3. 批量竞价价    : 腾讯 qt 批量       vs 东财 ulist.np
 *   4. 单只 09:25 分笔: 腾讯 stock.gtimg  vs 东财 push2 / push2delay 明细
 *
 * 用法：npx tsx scripts/source-benchmark.ts [轮数=6] [并发=4]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROUNDS = Number(process.argv[2] ?? 6);
const CONCURRENCY = Number(process.argv[3] ?? 4);
const TIMEOUT_MS = 8_000;
const TENCENT_QUOTE = 'https://qt.gtimg.cn/q=';
const TENCENT_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const TENCENT_DETAIL = 'https://stock.gtimg.cn/data/index.php';
const EM_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_INDEX_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_ULIST = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const EM_DETAIL = 'https://push2.eastmoney.com/api/qt/stock/details/get';
const EM_DETAIL_DELAY = 'https://push2delay.eastmoney.com/api/qt/stock/details/get';
const POOL = 'https://push2ex.eastmoney.com/getTopicZTPool';

const FALLBACK_SYMBOLS = [
  '600000', '600519', '000001', '000002', '300750', '601318', '000858', '002594',
  '600036', '601899', '300059', '002415', '600030', '601012', '000333', '002352',
  '600276', '603259', '601888', '000651',
];

const FALLBACK_POOL_SYMBOLS = FALLBACK_SYMBOLS.slice(0, 12);

type ProbeValue = Record<string, unknown>;

type ProbeResult = { bytes: number; value: ProbeValue };

type Probe = {
  id: string;
  role: string;
  label: string;
  vendor: 'tencent' | 'eastmoney';
  run: () => Promise<ProbeResult>;
};

type Sample = { ok: boolean; ms: number; bytes: number; error: string | null };

const today = new Date();
const tradeDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
  today.getDate(),
).padStart(2, '0')}`;
const isoToday = `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;

const daysBefore = (days: number): string => {
  const date = new Date(
    Date.UTC(Number(tradeDate.slice(0, 4)), Number(tradeDate.slice(4, 6)) - 1, Number(tradeDate.slice(6, 8))),
  );
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

const request = async (
  url: string,
  accept: 'json' | 'text',
): Promise<{ body: string; bytes: number }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept === 'json' ? 'application/json' : 'text/plain' },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${body.slice(0, 60)}`);
    }
    return { body, bytes: Buffer.byteLength(body) };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? '';
    throw new Error(`${(error as Error).message}${detail ? ` (${detail})` : ''}`);
  } finally {
    clearTimeout(timer);
  }
};

const parseJson = (body: string): unknown => JSON.parse(body);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
};

const toSecId = (symbol: string): string =>
  symbol.startsWith('6') ? `1.${symbol}` : symbol.startsWith('4') || symbol.startsWith('8') ? `0.${symbol}` : `0.${symbol}`;

const toTencentSymbol = (symbol: string): string =>
  symbol.startsWith('6') ? `sh${symbol}` : symbol.startsWith('4') || symbol.startsWith('8') ? `bj${symbol}` : `sz${symbol}`;

/** 09:25:00~09:29:59 的第一条即集合竞价成交 */
const extractAuctionTick = (rows: Array<{ time: string; price: number; lots: number }>) =>
  rows.find((row) => row.time >= '09:25:00' && row.time < '09:30:00') ?? null;

const fetchPoolSymbols = async (): Promise<string[]> => {
  // 取上一交易日涨停池，作为「真实工作量」样本（竞价链路一次要打 80~90 只）
  const params = new URLSearchParams({
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    sort: 'fbt:asc',
    date: daysBefore(1).replaceAll('-', ''),
    pagesize: '100',
    Pageindex: '0',
  });
  try {
    const { body } = await request(`${POOL}?${params.toString()}`, 'json');
    const payload = parseJson(body);
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const pool = data && Array.isArray(data.pool) ? data.pool : [];
    const symbols = pool
      .map((row) => (isRecord(row) ? String(row.c ?? '') : ''))
      .filter((symbol) => /^\d{6}$/.test(symbol));
    return symbols;
  } catch {
    return FALLBACK_POOL_SYMBOLS;
  }
};

const buildProbes = (symbols: string[], poolCount: number): Probe[] => {
  const probes: Probe[] = [];

  probes.push({
    id: 'kline-tencent',
    role: '交易日历',
    label: '腾讯 指数日K (fqkline)',
    vendor: 'tencent',
    run: async () => {
      const params = new URLSearchParams({
        param: `sh000001,day,${daysBefore(30)},${isoToday},320,qfq`,
      });
      const { body, bytes } = await request(`${TENCENT_KLINE}?${params.toString()}`, 'json');
      const payload = parseJson(body);
      const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const entry = root && isRecord(root.sh000001) ? root.sh000001 : null;
      // 带日期区间时腾讯返回 day，不带时返回 qfqday —— 与 server/auction 同一套兼容逻辑
      const rows = entry ? (Array.isArray(entry.qfqday) ? entry.qfqday : Array.isArray(entry.day) ? entry.day : []) : [];
      const dates = rows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => String(row[0]).replaceAll('-', ''));
      return { bytes, value: { rows: dates.length, last: dates.at(-1) ?? null, dates } };
    },
  });

  probes.push({
    id: 'kline-eastmoney',
    role: '交易日历',
    label: '东财 push2his 日K',
    vendor: 'eastmoney',
    run: async () => {
      const params = new URLSearchParams({
        secid: '1.000001',
        klt: '101',
        fqt: '0',
        beg: daysBefore(30).replaceAll('-', ''),
        end: tradeDate,
        fields1: 'f1',
        fields2: 'f51',
      });
      const { body, bytes } = await request(`${EM_KLINE}?${params.toString()}`, 'json');
      const payload = parseJson(body);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const rows = data && Array.isArray(data.klines) ? data.klines : [];
      const dates = rows.map((row) => String(row).slice(0, 10).replaceAll('-', ''));
      return { bytes, value: { rows: dates.length, last: dates.at(-1) ?? null, dates } };
    },
  });

  probes.push({
    id: 'gap-tencent',
    role: '大盘缺口',
    label: '腾讯 qt.gtimg.cn 上证',
    vendor: 'tencent',
    run: async () => {
      const { body, bytes } = await request(`${TENCENT_QUOTE}sh000001`, 'text');
      const fields = body.match(/v_sh000001="([^"]*)"/i)?.[1]?.split('~') ?? [];
      const preClose = num(fields[4]);
      const open = num(fields[5]);
      if (open === null || preClose === null || open <= 0 || preClose <= 0) {
        throw new Error(`字段缺失: ${body.slice(0, 80)}`);
      }
      return {
        bytes,
        value: { preClose, open, gapPct: Number((((open - preClose) / preClose) * 100).toFixed(2)) },
      };
    },
  });

  probes.push({
    id: 'gap-eastmoney',
    role: '大盘缺口',
    label: '东财 push2 单只行情',
    vendor: 'eastmoney',
    run: async () => {
      const params = new URLSearchParams({ secid: '1.000001', fields: 'f46,f60' });
      const { body, bytes } = await request(`${EM_INDEX_QUOTE}?${params.toString()}`, 'json');
      const payload = parseJson(body);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const open = num(data?.f46);
      const preClose = num(data?.f60);
      if (open === null || preClose === null || open <= 0 || preClose <= 0) {
        throw new Error(`字段缺失: ${body.slice(0, 80)}`);
      }
      return {
        bytes,
        value: { preClose, open, gapPct: Number((((open - preClose) / preClose) * 100).toFixed(2)) },
      };
    },
  });

  const batch = symbols.slice(0, 50);

  probes.push({
    id: 'batch-tencent',
    role: '批量竞价价',
    label: `腾讯 qt 批量 ${batch.length} 只`,
    vendor: 'tencent',
    run: async () => {
      const codes = batch.map(toTencentSymbol).join(',');
      const { body, bytes } = await request(`${TENCENT_QUOTE}${codes}`, 'text');
      const values: Record<string, unknown> = {};
      for (const match of body.matchAll(/v_[a-z]{2}\d{6}="([^"]*)";/gi)) {
        const fields = match[1]?.split('~') ?? [];
        const symbol = String(fields[2] ?? '');
        const preClose = num(fields[4]);
        const open = num(fields[5]);
        if (!/^\d{6}$/.test(symbol) || open === null || preClose === null || open <= 0 || preClose <= 0) continue;
        values[symbol] = {
          open,
          preClose,
          gapPct: Number((((open - preClose) / preClose) * 100).toFixed(2)),
        };
      }
      if (Object.keys(values).length === 0) throw new Error(`无有效行: ${body.slice(0, 80)}`);
      return { bytes, value: { count: Object.keys(values).length, quotes: values } };
    },
  });

  probes.push({
    id: 'batch-eastmoney',
    role: '批量竞价价',
    label: `东财 ulist.np 批量 ${batch.length} 只`,
    vendor: 'eastmoney',
    run: async () => {
      const params = new URLSearchParams({
        fltt: '2',
        invt: '2',
        fields: 'f12,f17,f18',
        secids: batch.map(toSecId).join(','),
      });
      const { body, bytes } = await request(`${EM_ULIST}?${params.toString()}`, 'json');
      const payload = parseJson(body);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const rows = data && Array.isArray(data.diff) ? data.diff : [];
      const values: Record<string, unknown> = {};
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const symbol = String(row.f12 ?? '');
        const open = num(row.f17);
        const preClose = num(row.f18);
        if (!/^\d{6}$/.test(symbol) || open === null || preClose === null || open <= 0 || preClose <= 0) continue;
        values[symbol] = {
          open,
          preClose,
          gapPct: Number((((open - preClose) / preClose) * 100).toFixed(2)),
        };
      }
      if (Object.keys(values).length === 0) throw new Error(`无有效行: ${body.slice(0, 80)}`);
      return { bytes, value: { count: Object.keys(values).length, quotes: values } };
    },
  });

  const detailSymbols = symbols.slice(0, 12).length > 0 ? symbols.slice(0, 12) : FALLBACK_POOL_SYMBOLS;

  for (const symbol of detailSymbols) {
    probes.push({
      id: `detail-tencent-${symbol}`,
      role: '单只分笔',
      label: `腾讯 stock.gtimg 分笔 ${symbol}`,
      vendor: 'tencent',
      run: async () => {
        const params = new URLSearchParams({ appn: 'detail', action: 'data', c: toTencentSymbol(symbol), p: '0' });
        const { body, bytes } = await request(`${TENCENT_DETAIL}?${params.toString()}`, 'text');
        const payload = body.match(/=\[(.*)\];?\s*$/)?.[1] ?? '';
        const ticks = payload
          .split('|')
          .map((chunk) => chunk.split('/'))
          .filter((fields) => fields.length >= 6 && /^\d{2}:\d{2}:\d{2}$/.test(fields[1] ?? ''))
          .map((fields) => ({ time: fields[1], price: Number(fields[2]), lots: Number(fields[4]), amount: Number(fields[5]) }));
        if (ticks.length === 0) throw new Error(`空分笔: ${body.slice(0, 80)}`);
        const tick = extractAuctionTick(ticks);
        return {
          bytes,
          value: {
            symbol,
            ticks: ticks.length,
            first: ticks[0],
            auctionPrice: tick?.price ?? null,
            auctionLots: tick?.lots ?? null,
            auctionAmount: tick?.amount ?? null,
          },
        };
      },
    });
  }

  for (const [id, label, endpoint] of [
    ['em', '东财 push2 明细', EM_DETAIL],
    ['emdelay', '东财 push2delay 明细', EM_DETAIL_DELAY],
  ] as const) {
    for (const symbol of detailSymbols) {
      probes.push({
        id: `detail-${id}-${symbol}`,
        role: '单只分笔',
        label: `${label} ${symbol}`,
        vendor: 'eastmoney',
        run: async () => {
          const params = new URLSearchParams({
            secid: toSecId(symbol),
            fields1: 'f1,f2,f3,f4,f5',
            fields2: 'f51,f52,f53,f54,f55',
            pos: '-100000',
            iscca: '1',
          });
          const { body, bytes } = await request(`${endpoint}?${params.toString()}`, 'json');
          const payload = parseJson(body);
          const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
          const details = data && Array.isArray(data.details) ? data.details : [];
          const rows = details
            .filter((row): row is string => typeof row === 'string')
            .map((row) => row.split(','))
            .filter((fields) => fields.length >= 3)
            .map((fields) => ({ time: fields[0], price: Number(fields[1]), lots: Number(fields[2]) }));
          if (rows.length === 0) throw new Error(`空明细: ${body.slice(0, 80)}`);
          const tick = extractAuctionTick(rows);
          return {
            bytes,
            value: {
              symbol,
              ticks: rows.length,
              first: rows[0],
              auctionPrice: tick?.price ?? null,
              auctionLots: tick?.lots ?? null,
              auctionAmount: tick ? Number((tick.price * tick.lots * 100).toFixed(2)) : null,
            },
          };
        },
      });
    }
  }

  probes.push({
    id: 'pool-push2ex',
    role: '候选池',
    label: `东财 push2ex 涨停池 (${poolCount} 只)`,
    vendor: 'eastmoney',
    run: async () => {
      const params = new URLSearchParams({
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        dpt: 'wz.ztzt',
        sort: 'fbt:asc',
        date: daysBefore(1).replaceAll('-', ''),
        pagesize: '100',
        Pageindex: '0',
      });
      const { body, bytes } = await request(`${POOL}?${params.toString()}`, 'json');
      const payload = parseJson(body);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const pool = data && Array.isArray(data.pool) ? data.pool : [];
      return { bytes, value: { total: num(data?.tc), received: pool.length } };
    },
  });

  return probes;
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const mapWithConcurrency = async <T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
};

const main = async (): Promise<void> => {
  console.log(`数据源基准 · ${new Date().toISOString()} · ${ROUNDS} 轮 / 并发 ${CONCURRENCY} / 超时 ${TIMEOUT_MS}ms`);

  const poolSymbols = await fetchPoolSymbols();
  const symbols = poolSymbols.length > 0 ? poolSymbols : FALLBACK_SYMBOLS;
  const probes = buildProbes(symbols, poolSymbols.length);
  console.log(`样本：${symbols.length} 只（上一交易日涨停池），逐笔对比取前 12 只；探针 ${probes.length} 个\n`);

  const samples = new Map<string, Sample[]>(probes.map((probe) => [probe.id, []]));
  const lastValue = new Map<string, ProbeValue>();

  for (let round = 1; round <= ROUNDS; round += 1) {
    const started = Date.now();
    await mapWithConcurrency(probes, CONCURRENCY, async (probe) => {
      const start = performance.now();
      try {
        const { bytes, value } = await probe.run();
        const ms = performance.now() - start;
        samples.get(probe.id)!.push({ ok: true, ms, bytes, error: null });
        lastValue.set(probe.id, value);
      } catch (error) {
        const ms = performance.now() - start;
        samples.get(probe.id)!.push({ ok: false, ms, bytes: 0, error: (error as Error).message });
      }
    });
    const ok = [...samples.values()].flat().filter((sample) => sample.ok).length;
    const total = [...samples.values()].flat().length;
    console.log(`第 ${round}/${ROUNDS} 轮完成：${ok}/${total} 成功，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const summary = probes.map((probe) => {
    const list = samples.get(probe.id)!;
    const okList = list.filter((sample) => sample.ok);
    const latencies = okList.map((sample) => sample.ms).sort((a, b) => a - b);
    const errors = [...new Set(list.filter((sample) => !sample.ok).map((sample) => sample.error ?? ''))];
    return {
      id: probe.id,
      role: probe.role,
      label: probe.label,
      vendor: probe.vendor,
      attempts: list.length,
      ok: okList.length,
      successRate: Number(((okList.length / list.length) * 100).toFixed(1)),
      p50: Number(percentile(latencies, 50).toFixed(0)),
      p95: Number(percentile(latencies, 95).toFixed(0)),
      max: Number((latencies.at(-1) ?? 0).toFixed(0)),
      bytes: okList.length > 0 ? Math.round(okList.reduce((sum, sample) => sum + sample.bytes, 0) / okList.length) : 0,
      errors: errors.slice(0, 2),
      value: lastValue.get(probe.id) ?? null,
    };
  });

  const pad = (value: string | number, width: number): string => String(value).padEnd(width);
  const num6 = (value: number): string => String(value).padStart(6);
  const pct6 = (value: number): string => `${value.toFixed(0)}%`.padStart(6);

  for (const role of [...new Set(summary.map((row) => row.role))]) {
    const rows = summary.filter((row) => row.role === role);
    console.log(`\n=== ${role} ===`);
    console.log(`${pad('源', 30)}${pad('成功', 10)}${pad('p50', 8)}${pad('p95', 8)}${pad('max', 8)}${pad('字节', 10)}`);
    for (const row of rows) {
      console.log(
        `${pad(row.label.slice(0, 28), 30)}${pad(`${row.ok}/${row.attempts}`, 10)}${num6(row.p50)}ms${num6(
          row.p95,
        )}ms${num6(row.max)}ms${pad(row.bytes, 10)}${row.successRate < 100 ? `  ✗ ${row.errors[0] ?? ''}` : ''}`,
      );
    }
  }

  // 一致性检查：同类数据的两个源是否给出同一个数
  const consistency: string[] = [];
  const find = (id: string) => summary.find((row) => row.id === id);
  const failure = (id: string): string => {
    const row = find(id);
    if (!row) return '未测';
    return row.ok > 0 ? '—' : `${row.errors[0] ?? '失败'}`;
  };
  const gapTencent = find('gap-tencent')?.value as { gapPct?: number } | null;
  const gapEastmoney = find('gap-eastmoney')?.value as { gapPct?: number } | null;
  consistency.push(
    `大盘缺口：腾讯 ${gapTencent?.gapPct ?? failure('gap-tencent')}% vs 东财 ${
      gapEastmoney?.gapPct ?? failure('gap-eastmoney')
    }%`,
  );

  const batchTencent = find('batch-tencent')?.value as { quotes?: Record<string, { open: number }> } | null;
  const batchEastmoney = find('batch-eastmoney')?.value as { quotes?: Record<string, { open: number }> } | null;
  const batchSymbols = Object.keys(batchEastmoney?.quotes ?? {});
  const mismatch: string[] = [];
  for (const symbol of batchSymbols) {
    const left = batchTencent?.quotes?.[symbol]?.open;
    const right = batchEastmoney?.quotes?.[symbol]?.open;
    if (left !== undefined && right !== undefined && Math.abs(left - right) > 1e-6) {
      mismatch.push(`${symbol}: 腾讯 ${left} / 东财 ${right}`);
    }
  }
  consistency.push(
    `批量竞价价：东财 ${batchSymbols.length} 只 / 腾讯 ${Object.keys(batchTencent?.quotes ?? {}).length} 只，不一致 ${mismatch.length} 只${
      mismatch.length > 0 ? `（${mismatch.slice(0, 5).join('; ')}）` : ''
    }`,
  );

  const detailSymbols = symbols.slice(0, 12);
  const detailMismatch: string[] = [];
  for (const symbol of detailSymbols) {
    const tencent = find(`detail-tencent-${symbol}`)?.value as { auctionPrice?: number; auctionAmount?: number } | null;
    const delay = find(`detail-emdelay-${symbol}`)?.value as { auctionPrice?: number; auctionAmount?: number } | null;
    if (!tencent || !delay) continue;
    const priceSame = tencent.auctionPrice === delay.auctionPrice;
    // 腾讯给的成交额是真实金额，东财是「价 × 手数 × 100」的估算，允许 0.5% 的相对误差
    const amountDelta =
      tencent.auctionAmount !== null && delay.auctionAmount !== null && tencent.auctionAmount !== undefined
        ? Math.abs((tencent.auctionAmount ?? 0) - (delay.auctionAmount ?? 0)) /
          Math.max(1, Math.abs(delay.auctionAmount ?? 1))
        : null;
    if (!priceSame || (amountDelta !== null && amountDelta > 0.005)) {
      detailMismatch.push(
        `${symbol}: 腾讯 ${tencent.auctionPrice}/${tencent.auctionAmount} vs 东财 ${delay.auctionPrice}/${delay.auctionAmount}`,
      );
    }
  }
  consistency.push(
    `09:25 竞价首笔：可比 ${detailSymbols.length} 只，不一致 ${detailMismatch.length} 只${
      detailMismatch.length > 0 ? `（${detailMismatch.slice(0, 5).join('; ')}）` : ''
    }`,
  );

  console.log('\n=== 一致性 ===');
  for (const line of consistency) console.log(`- ${line}`);

  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '').slice(0, 16);
  const outputPath = path.join(outputDir, `source-benchmark-${stamp}.json`);
  writeFileSync(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), rounds: ROUNDS, concurrency: CONCURRENCY, symbols, summary, consistency }, null, 2)}\n`,
    'utf8',
  );
  console.log(`\n明细已写入 ${path.relative(process.cwd(), outputPath)}`);
};

await main();
