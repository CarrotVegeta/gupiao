import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendAuctionSnapshot,
  readAuctionSnapshots,
  resetSnapshotStateForTests,
  snapshotFile,
} from './snapshot-log.js';
import type { AuctionItem, AuctionResponse } from '../../src/types.js';

const item = (symbol: string): AuctionItem => ({
  symbol,
  name: `股票${symbol}`,
  boardCount: 2,
  firstSealTime: '09:31:12',
  lastSealTime: '14:57:00',
  breakCount: 1,
  previousAmount: 800_000_000,
  sealAmount: 120_000_000,
  floatMarketCap: 5_000_000_000,
  turnoverRate: 12.5,
  auctionPrice: 12.34,
  auctionPct: 4.2,
  auctionAmount: 24_000_000,
  auctionRatio: 3.0,
  auctionPremium: 'rich',
  sealedAtAuction: false,
  minuteTrend: null,
  auctionAmountSource: 'tick',
  result: 'unqualified',
  reasons: ['测试'],
});

const responseOf = (tradeDate: string, items: AuctionItem[], status: AuctionResponse['status'] = 'fresh'): AuctionResponse => ({
  tradeDate,
  previousTradeDate: '20260818',
  snapshotTime: '09:25:00',
  items,
  fetchedAt: '2026-08-19T01:25:03.000Z',
  source: 'eastmoney+tencent',
  status,
  error: null,
});

let dir = '';
let file = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'auction-snapshot-'));
  file = path.join(dir, 'nested', 'auction-snapshots.jsonl');
  process.env.AUCTION_SNAPSHOT_FILE = file;
  resetSnapshotStateForTests();
});

afterEach(() => {
  delete process.env.AUCTION_SNAPSHOT_FILE;
  resetSnapshotStateForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('auction snapshot log', () => {
  it('creates the directory and appends one line per trade date', () => {
    expect(snapshotFile()).toBe(file);

    expect(appendAuctionSnapshot(responseOf('20260819', [item('600519')]))).toBe(true);

    const rows = readFileSync(file, 'utf8').trim().split('\n');
    expect(rows).toHaveLength(1);
    const record = JSON.parse(rows[0]) as { tradeDate: string; rows: unknown[] };
    expect(record.tradeDate).toBe('20260819');
    expect(record.rows).toHaveLength(1);
  });

  it('keeps the 09:25 volume fields needed for the unbacktestable factors', () => {
    appendAuctionSnapshot(responseOf('20260819', [item('600519')]));

    const [row] = readAuctionSnapshots()[0].rows;
    expect(row.auctionAmount).toBe(24_000_000);
    expect(row.auctionRatio).toBe(3.0);
    expect(row.previousAmount).toBe(800_000_000);
    expect(row.floatMarketCap).toBe(5_000_000_000);
    expect(row.auctionPrice).toBe(12.34);
    expect(row.turnoverRate).toBe(12.5);
  });

  it('keeps the auction minute shape so the process factors stay backtestable later', () => {
    const shaped: AuctionItem = {
      ...item('600519'),
      auctionAmountSource: 'minute',
      minuteTrend: {
        trend: 'rising',
        trendPct: 10.01,
        lateShiftPct: -4.07,
        maxMatchedVolume: 67864,
        peakMatchedTime: '09:16',
        lateRush: false,
        matchedSharePct: 195.75,
        touchedLimitUp: true,
        label: '竞价走高 10.01%，尾段下砸 4.07%，摸板未封',
        pricePath: [19.88, 21.87, 21.87],
      },
    };
    appendAuctionSnapshot(responseOf('20260819', [shaped]));

    const [row] = readAuctionSnapshots()[0].rows;
    expect(row.minuteTrend?.lateShiftPct).toBe(-4.07);
    expect(row.minuteTrend?.touchedLimitUp).toBe(true);
    expect(row.minuteTrend?.pricePath).toEqual([19.88, 21.87, 21.87]);
    expect(row.amountSource).toBe('minute');
  });

  it('keeps a null minute shape as null instead of dropping the field', () => {
    appendAuctionSnapshot(responseOf('20260819', [item('600519')]));

    const [row] = readAuctionSnapshots()[0].rows;
    expect(row.minuteTrend).toBeNull();
    expect(row.amountSource).toBe('tick');
  });

  it('does not write the same trade date twice', () => {
    expect(appendAuctionSnapshot(responseOf('20260819', [item('600519')]))).toBe(true);
    expect(appendAuctionSnapshot(responseOf('20260819', [item('600519')]))).toBe(false);

    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('skips stale, empty and dateless responses', () => {
    expect(appendAuctionSnapshot(responseOf('20260819', [item('600519')], 'stale'))).toBe(false);
    expect(appendAuctionSnapshot(responseOf('20260819', []))).toBe(false);
    expect(appendAuctionSnapshot(responseOf('20260818', [], 'fresh'))).toBe(false);
  });

  it('skips malformed lines instead of losing the whole history', () => {
    appendAuctionSnapshot(responseOf('20260819', [item('600519')]));
    writeFileSync(file, `${readFileSync(file, 'utf8')}{ 坏行\n`, 'utf8');

    expect(readAuctionSnapshots()).toHaveLength(1);
    expect(readAuctionSnapshots()[0].tradeDate).toBe('20260819');
  });

  it('resumes dedupe from an existing file after a restart', () => {
    appendAuctionSnapshot(responseOf('20260819', [item('600519')]));

    // 模拟进程重启：只清内存状态，文件保留
    resetSnapshotStateForTests();

    expect(appendAuctionSnapshot(responseOf('20260819', [item('600519')]))).toBe(false);
    expect(appendAuctionSnapshot(responseOf('20260820', [item('600519')]))).toBe(true);
  });

  it('never throws when the target path is not writable', () => {
    process.env.AUCTION_SNAPSHOT_FILE = path.join(dir, 'auction-snapshots.jsonl');
    // 用同名目录占住文件路径，制造写入失败
    const blocking = path.join(dir, 'auction-snapshots.jsonl');
    rmSync(blocking, { force: true });
    mkdtempSync(path.join(dir, 'blocker-'));

    resetSnapshotStateForTests();
    expect(() => appendAuctionSnapshot(responseOf('20260819', [item('600519')]))).not.toThrow();
  });
});
