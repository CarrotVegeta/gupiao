/**
 * 上游主机健康巡检：把竞价/行情用到的每个上游都打一遍，统计成功率与延迟。
 *
 * 用途：行情「大片缺失」时先跑这个，判断是**某一家整站挂了**还是**单个接口变了字段**。
 * 2026-09-17 实测结论：push2 / push2his 15/15 次被上游直接断连（RemoteDisconnected），
 * 其余上游 15/15 正常 —— 这正是「东财老是行情缺失」的根因。
 *
 * 用法：npx tsx scripts/_host-health.ts [轮数=15]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROUNDS = Number(process.argv[2] ?? 15);
const TIMEOUT_MS = 8_000;

const TARGETS: Array<{ label: string; url: string }> = [
  {
    label: '东财 push2 单只行情',
    url: 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f57,f58,f59,f60,f168,f169,f170,f86',
  },
  {
    label: '东财 push2 批量行情',
    url: 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3,f4,f8,f18&secids=1.600519,0.000001,0.300750',
  },
  {
    label: '东财 push2 大盘指数',
    url: 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001,0.399006,1.000688&fields=f2,f3,f4,f12,f14',
  },
  {
    label: '东财 push2his 日K',
    url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=0&beg=20260901&end=20260917&fields1=f1&fields2=f51',
  },
  {
    label: '东财 push2ex 涨停池',
    url: 'https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&sort=fbt:asc&date=20260916&pagesize=100&Pageindex=0',
  },
  {
    label: '东财 push2ex 强势池',
    url: 'https://push2ex.eastmoney.com/getTopicQSPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&sort=zdp:desc&date=20260917&pagesize=100&Pageindex=0',
  },
  {
    label: '东财 push2delay 批量行情',
    url: 'https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3,f4,f8,f18&secids=1.600519,0.000001,0.300750',
  },
  {
    label: '东财 push2delay 分笔明细',
    url: 'https://push2delay.eastmoney.com/api/qt/stock/details/get?secid=1.600519&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55&pos=-100000&iscca=1',
  },
  {
    label: '东财 datacenter 龙虎榜',
    url: "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_NET_AMT&source=WEB&client=WEB&filter=(TRADE_DATE='2026-09-16')&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1&pageSize=500&pageNumber=1",
  },
  {
    label: '东财 searchapi 搜索',
    url: 'https://searchapi.eastmoney.com/api/suggest/get?input=%E8%B4%B5%E5%B7%9E&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=8',
  },
  { label: '腾讯 qt 单只行情', url: 'https://qt.gtimg.cn/q=sh600519' },
  {
    label: '腾讯 qt 批量行情(50)',
    url: `https://qt.gtimg.cn/q=${[
      ...Array.from({ length: 25 }, (_value, index) => `sh6005${String(index).padStart(2, '0')}`),
      ...Array.from({ length: 25 }, (_value, index) => `sz0000${String(index + 1).padStart(2, '0')}`),
    ].join(',')}`,
  },
  {
    label: '腾讯 ifzq 指数日K',
    url: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,2026-08-18,2026-09-17,320,qfq',
  },
  { label: '腾讯 stock 分笔', url: 'https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=sh600519&p=0' },
  { label: '腾讯 smartbox 搜索', url: 'https://smartbox.gtimg.cn/s3/?q=%E8%B4%B5%E5%B7%9E&t=all' },
];

type Sample = { ok: boolean; ms: number; bytes: number; error: string | null };

const hit = async (url: string): Promise<Sample> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0' },
    });
    const body = await response.arrayBuffer();
    if (!response.ok || body.byteLength === 0) {
      return { ok: false, ms: performance.now() - started, bytes: 0, error: `HTTP ${response.status}` };
    }

    return { ok: true, ms: performance.now() - started, bytes: body.byteLength, error: null };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    const detail = cause?.code ?? (error as Error).message;
    return { ok: false, ms: performance.now() - started, bytes: 0, error: detail.slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
};

const main = async (): Promise<void> => {
  console.log(`上游健康巡检 · ${new Date().toISOString()} · ${ROUNDS} 轮\n`);

  const results: Array<{
    label: string;
    ok: number;
    rounds: number;
    rate: number;
    p50: number;
    p95: number;
    bytes: number;
    errors: Record<string, number>;
  }> = [];

  for (const target of TARGETS) {
    const samples: Sample[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      samples.push(await hit(target.url));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const okSamples = samples.filter((sample) => sample.ok);
    const errors: Record<string, number> = {};
    for (const sample of samples.filter((item) => !item.ok)) {
      const key = sample.error ?? '未知错误';
      errors[key] = (errors[key] ?? 0) + 1;
    }

    const row = {
      label: target.label,
      ok: okSamples.length,
      rounds: ROUNDS,
      rate: Number(((okSamples.length / ROUNDS) * 100).toFixed(1)),
      p50: percentile(okSamples.map((sample) => sample.ms), 50),
      p95: percentile(okSamples.map((sample) => sample.ms), 95),
      bytes: Math.round(
        okSamples.reduce((sum, sample) => sum + sample.bytes, 0) / Math.max(1, okSamples.length),
      ),
      errors,
    };
    results.push(row);

    console.log(
      `${row.label.padEnd(24)} ${String(row.ok).padStart(2)}/${ROUNDS} ${String(row.rate).padStart(5)}%` +
        `  p50=${String(row.p50).padStart(4)}ms p95=${String(row.p95).padStart(4)}ms bytes=${String(row.bytes).padStart(7)}` +
        `  ${JSON.stringify(errors)}`,
    );
  }

  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'host-health.json');
  writeFileSync(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), rounds: ROUNDS, results }, null, 2)}\n`,
    'utf8',
  );
  console.log(`\n已写入 ${path.relative(process.cwd(), outputPath)}`);
};

await main();
