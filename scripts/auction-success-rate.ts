/**
 * 竞价候选「买入后成功率」统计脚本
 *
 * 逻辑：
 * 1. 复用服务端 fetchEastmoneyAuction 拿到当日竞价候选（上一交易日涨停池 + 09:25 竞价价 + 评分）
 * 2. 批量取实时行情，判断每只票今日是否涨停 / 是否触及涨停 / 当前相对竞价价盈亏
 * 3. 按「竞价是否涨停」「评分档位」「连板数」分组输出成功率
 *
 * 用法：npx tsx scripts/auction-success-rate.ts [YYYYMMDD]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchEastmoneyAuction } from '../server/auction/eastmoney.js';

type QuoteRow = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  preClose: number | null;
  turnoverRate: number | null;
  speed: number | null;
  floatCap: number | null;
  limitUpPrice: number | null;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A 股涨停价：主板 10%、创业板/科创板 20%、北交所 30%、ST 5% */
export const limitUpPriceOf = (symbol: string, name: string, preClose: number): number => {
  const isSt = /st|\*st/i.test(name);
  const isStar = symbol.startsWith('68');
  const isGem = symbol.startsWith('30');
  const isBj = symbol.startsWith('8') || symbol.startsWith('4');

  if (isSt) return round2(preClose * 1.05);
  if (isStar || isGem) return round2(preClose * 1.2);
  if (isBj) return round2(preClose * 1.3);
  return round2(preClose * 1.1);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const toTencentSymbol = (symbol: string): string => {
  if (symbol.startsWith('6')) return `sh${symbol}`;
  if (symbol.startsWith('0') || symbol.startsWith('3')) return `sz${symbol}`;
  return `bj${symbol}`;
};

/**
 * 腾讯行情一次可批量返回：现价(3)、昨收(4)、今开(5)、涨跌幅(32)、
 * 最高(33)、最低(34)、换手率(38)、流通市值(44)、涨停价(47)、跌停价(48)。
 */
const fetchQuotes = async (symbols: string[]): Promise<Map<string, QuoteRow>> => {
  const result = new Map<string, QuoteRow>();
  const decoder = new TextDecoder('gbk');

  for (let offset = 0; offset < symbols.length; offset += 50) {
    const batch = symbols.slice(offset, offset + 50).map(toTencentSymbol).join(',');
    const response = await fetch(`https://qt.gtimg.cn/q=${batch}`);
    const buffer = await response.arrayBuffer();
    const text = decoder.decode(buffer);

    for (const match of text.matchAll(/v_[a-z]{2}(\d{6})="([^"]*)";/gi)) {
      const symbol = match[1];
      const fields = match[2]?.split('~') ?? [];
      if (!symbol || fields.length < 49) continue;
      result.set(symbol, {
        symbol,
        name: String(fields[1] ?? ''),
        price: num(fields[3]),
        pct: num(fields[32]),
        high: num(fields[33]),
        low: num(fields[34]),
        open: num(fields[5]),
        preClose: num(fields[4]),
        turnoverRate: num(fields[38]),
        speed: null,
        floatCap: num(fields[44]),
        limitUpPrice: num(fields[47]),
      });
    }
  }

  return result;
};

type Row = QuoteRow & {
  board: number;
  auctionPrice: number | null;
  auctionPct: number | null;
  auctionAmount: number | null;
  auctionRatio: number | null;
  auctionPremium: string | null;
  probability: number | null;
  grade: string;
  reasons: string[];
  limitUpPrice: number | null;
  auctionAtLimit: boolean | null;
  touchedLimit: boolean;
  sealedLimit: boolean;
  pctVsAuction: number | null;
  pctVsOpen: number | null;
};

export const rate = (items: Row[], pick: (row: Row) => boolean): number =>
  items.length === 0 ? 0 : Math.round((items.filter(pick).length / items.length) * 1000) / 10;

const formatProbability = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(0)}%`;

const pctText = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

const avg = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

const main = async (): Promise<void> => {
  const tradeDate = process.argv[2] ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replaceAll('-', '');

  const auction = await fetchEastmoneyAuction(tradeDate);
  if (auction.status !== 'fresh') {
    console.error(`竞价数据不可用：${auction.status} ${auction.error ?? ''}`);
    process.exit(1);
  }

  const withPrice = auction.items.filter((item) => item.auctionPrice !== null);
  const quotes = await fetchQuotes(withPrice.map((item) => item.symbol));

  const rows: Row[] = withPrice.map((item) => {
    const quote = quotes.get(item.symbol);
    const preClose = quote?.preClose ?? null;
    const limitUpPrice =
      quote?.limitUpPrice ??
      (preClose !== null && preClose > 0 ? limitUpPriceOf(item.symbol, item.name, preClose) : null);
    const auctionPrice = item.auctionPrice as number;
    const auctionAtLimit =
      limitUpPrice === null ? null : auctionPrice >= limitUpPrice - 0.001;
    const price = quote?.price ?? null;
    const high = quote?.high ?? null;
    const open = quote?.open ?? null;

    return {
      symbol: item.symbol,
      name: item.name,
      price,
      pct: quote?.pct ?? null,
      high,
      low: quote?.low ?? null,
      open,
      preClose,
      turnoverRate: quote?.turnoverRate ?? null,
      speed: quote?.speed ?? null,
      floatCap: quote?.floatCap ?? null,
      board: item.boardCount ?? 0,
      auctionPrice,
      auctionPct: item.auctionPct,
      auctionAmount: item.auctionAmount,
      auctionRatio: item.auctionRatio,
      auctionPremium: item.auctionPremium,
      probability: item.limitUpProbability,
      grade: item.result,
      reasons: item.reasons,
      limitUpPrice,
      auctionAtLimit,
      touchedLimit:
        limitUpPrice !== null && high !== null ? high >= limitUpPrice - 0.001 : false,
      sealedLimit:
        limitUpPrice !== null && price !== null ? price >= limitUpPrice - 0.001 : false,
      pctVsAuction:
        price !== null && auctionPrice > 0 ? round2(((price - auctionPrice) / auctionPrice) * 100) : null,
      pctVsOpen: price !== null && open !== null && open > 0 ? round2(((price - open) / open) * 100) : null,
    };
  });

  const buyable = rows.filter((row) => row.auctionAtLimit === false);
  const auctionLimit = rows.filter((row) => row.auctionAtLimit === true);

  const group = (
    items: Row[],
    label: string,
  ): Record<string, unknown> => ({
    label,
    count: items.length,
    sealedLimit: items.filter((row) => row.sealedLimit).length,
    sealedRate: rate(items, (row) => row.sealedLimit),
    touchedLimit: items.filter((row) => row.touchedLimit).length,
    touchedRate: rate(items, (row) => row.touchedLimit),
    profitable: items.filter((row) => (row.pctVsAuction ?? -1) > 0).length,
    winRate: rate(items, (row) => (row.pctVsAuction ?? -1) > 0),
    avgReturnVsAuction: avg(items.map((row) => row.pctVsAuction).filter((v): v is number => v !== null)),
    avgReturnVsOpen: avg(items.map((row) => row.pctVsOpen).filter((v): v is number => v !== null)),
  });

  const byGrade = ['qualified', 'watch', 'unqualified'].map((grade) =>
    group(buyable.filter((row) => row.grade === grade), grade),
  );
  const byProbability = [
    ['概率>=55%', buyable.filter((row) => (row.probability ?? -1) >= 0.55)],
    ['30~55%', buyable.filter((row) => (row.probability ?? -1) >= 0.3 && (row.probability ?? -1) < 0.55)],
    ['<30%', buyable.filter((row) => (row.probability ?? 1) < 0.3)],
  ] as Array<[string, Row[]]>;
  const byBoard = [...new Set(buyable.map((row) => row.board))]
    .sort((a, b) => b - a)
    .map((board) => group(buyable.filter((row) => row.board === board), `${board}板`));

  const report = {
    tradeDate,
    previousTradeDate: auction.previousTradeDate,
    snapshotTime: auction.snapshotTime,
    fetchedAt: new Date().toISOString(),
    total: rows.length,
    auctionLimitCount: auctionLimit.length,
    buyableCount: buyable.length,
    all: group(rows, 'all'),
    auctionLimit: group(auctionLimit, '竞价涨停(一字/秒板)'),
    buyable: group(buyable, '竞价未涨停(可买)'),
    byGrade,
    byProbability: byProbability.map(([label, items]) => group(items, label)),
    byBoard,
    rows,
  };

  const outputDir = path.resolve(process.cwd(), 'scripts/output');
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '').slice(0, 15);
  const outputPath = path.join(outputDir, `auction-success-${tradeDate}-${stamp}.json`);
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  const line = (label: string, g: Record<string, unknown>): void => {
    console.log(
      `${label.padEnd(22)} n=${String(g.count).padStart(3)} | 封板 ${String(g.sealedLimit).padStart(
        3,
      )} (${String(g.sealedRate).padStart(5)}%) | 触板 ${String(g.touchedLimit).padStart(3)} (${String(
        g.touchedRate,
      ).padStart(5)}%) | 高于竞价 ${String(g.profitable).padStart(3)} (${String(g.winRate).padStart(
        5,
      )}%) | 均收益(vs竞价) ${String(g.avgReturnVsAuction).padStart(6)}% | 均收益(vs开盘) ${String(
        g.avgReturnVsOpen,
      ).padStart(6)}%`,
    );
  };

  console.log(`\n交易日 ${tradeDate}（候选池来自 ${auction.previousTradeDate}）共 ${rows.length} 只`);
  console.log(`数据时间 ${report.fetchedAt}\n`);
  line('全部候选', report.all as Record<string, unknown>);
  line('其中:竞价涨停', report.auctionLimit as Record<string, unknown>);
  line('其中:竞价未涨停', report.buyable as Record<string, unknown>);
  console.log('');
  for (const g of byGrade) line(`  [${String(g.label)}]`, g);
  console.log('');
  for (const g of byBoard) line(`  [${String(g.label)}]`, g);

  console.log('\n--- 按模型概率分组 ---');
  for (const [label, items] of byProbability) line(`  [${label}]`, group(items, label) as Record<string, unknown>);
  console.log('\n--- 竞价未涨停明细（按模型概率排序）---');
  console.log('代码   名称        连板 竞价%   现价%   最高%   相对竞价  概率 档位');
  for (const row of [...buyable].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1))) {
    console.log(
      `${row.symbol} ${row.name.padEnd(9).slice(0, 9)} ${String(row.board).padStart(3)} ${pctText(
        row.auctionPct,
      ).padStart(7)} ${pctText(row.pct).padStart(7)} ${
        row.high !== null && row.preClose ? pctText(round2(((row.high - row.preClose) / row.preClose) * 100)).padStart(7) : '     —'
      } ${pctText(row.pctVsAuction).padStart(8)} ${formatProbability(row.probability).padStart(5)} ${row.grade}${
        row.sealedLimit ? ' 封板' : row.touchedLimit ? ' 触板' : ''
      }`,
    );
  }

  console.log(`\nJSON 明细已写入 ${outputPath}`);
};

await main();
