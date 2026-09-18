/**
 * 主线复盘报告 CLI（设计稿 §8 的收盘后固定动作）。
 *
 *   npx tsx scripts/mainline-report.ts                 # 默认回看 5 个交易日
 *   npx tsx scripts/mainline-report.ts --days 10       # 回看 10 个交易日
 *   npx tsx scripts/mainline-report.ts --date 20260918 # 指定结束交易日
 *   npx tsx scripts/mainline-report.ts --json          # 只输出 JSON（供程序消费）
 *   npx tsx scripts/mainline-report.ts --out data/mainline-20260918.md
 *
 * 输出同时打印到 stdout 并写入 `data/mainline/<日期>.md`（除非 --no-write）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildReport, renderReport } from '../server/mainline/report.js';

type Args = {
  days: number;
  date: string | null;
  json: boolean;
  write: boolean;
  out: string | null;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { days: 5, date: null, json: false, write: true, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--days') {
      args.days = Number(argv[index + 1] ?? 5);
      index += 1;
    } else if (token === '--date') {
      args.date = argv[index + 1] ?? null;
      index += 1;
    } else if (token === '--json') {
      args.json = true;
    } else if (token === '--no-write') {
      args.write = false;
    } else if (token === '--out') {
      args.out = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport({ days: args.days, endDate: args.date ?? undefined });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const markdown = renderReport(report);
    process.stdout.write(`${markdown}\n`);

    if (args.write) {
      const target =
        args.out ??
        path.resolve(process.cwd(), 'data', 'mainline', `${report.latestDate}.md`);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, markdown, 'utf8');
      process.stdout.write(`\n报告已写入 ${target}\n`);
    }
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
