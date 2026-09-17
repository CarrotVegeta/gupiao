import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type {
  MarketIndicesResponse,
  AuctionResponse,
  DragonTigerResponse,
  LimitUpResponse,
  LimitUpLadderResponse,
  MarketOverviewResponse,
  QuotesResponse,
  SprintLimitUpResponse,
  StockSearchResponse,
  ThemeDetailResponseV2,
  ThemeStocksResponse,
  ThemesResponse,
  TrendScanResponse,
} from '../src/types.js';
import { fetchEastmoneyDragonTiger } from './dragon-tiger/eastmoney.js';
import { fetchEastmoneyAuction, msUntilCallAuction } from './auction/eastmoney.js';
import { createAuctionCache } from './auction/cache.js';
import { mergeMarketIndices, mergeQuoteBundles } from './merge.js';
import { fetchEastmoneyLimitUp } from './limit-up/eastmoney.js';
import { fetchLimitUpLadder } from './limit-up/ladder.js';
import { fetchMarketBreadth } from './market/breadth.js';
import { fetchEastmoneyMarket } from './market/eastmoney.js';
import { fetchTencentMarket } from './market/tencent.js';
import { fetchEastmoneySprintLimitUp } from './sprint-limit-up/eastmoney.js';
import { buildThemeDetail, buildThemes, buildThemeStocks } from './themes/service.js';
import { parseTrendFilters, scanTrend } from './screener/trend.js';
import {
  fetchEastmoneyQuotes,
  fetchEastmoneySearch,
  normalizeSymbol,
} from './quotes/eastmoney.js';
import { fetchTencentQuotes } from './quotes/tencent.js';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const HAS_DIST = fs.existsSync(INDEX_HTML);

const parseSymbols = (input: unknown): string[] => {
  const values = Array.isArray(input) ? input : [input];

  const normalized = values
    .flatMap((value) => String(value ?? '').split(','))
    .map((value) => normalizeSymbol(value))
    .filter((value, index, items) => items.indexOf(value) === index);

  return normalized.slice(0, 50);
};

const getShanghaiToday = (): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';

  return `${year}${month}${day}`;
};

/** 服务器当前日期（东八区）的 YYYYMMDD，作为默认交易日 */
export const toTodayTradeDate = (): string => {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
};

export const parseTradeDate = (input: unknown): string | null => {
  if (input === undefined) {
    return getShanghaiToday();
  }

  const value = String(input).trim();
  return /^\d{8}$/.test(value) ? value : null;
};

export const createApp = () => {
  const app = express();
  const auctionCache = createAuctionCache();

  app.get('/api/market-overview', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date) ?? toTodayTradeDate();

    // 指数和情绪各走各的源，互不阻塞
    const [primary, breadth] = await Promise.all([
      fetchTencentMarket(),
      fetchMarketBreadth(tradeDate).catch(() => null),
    ]);

    const merged: MarketIndicesResponse = primary.indices.every(
      (index) => index.status === 'fresh',
    )
      ? primary
      : mergeMarketIndices(primary, await fetchEastmoneyMarket());

    // 两市成交 = 沪市 + 深市（上证指数 / 深证成指的成交额就是两市总额）
    const shanghai = merged.indices.find((index) => index.symbol === '000001')?.amount ?? null;
    const shenzhen = merged.indices.find((index) => index.symbol === '399001')?.amount ?? null;
    const turnover =
      shanghai !== null && shenzhen !== null ? shanghai + shenzhen : (shanghai ?? shenzhen);

    const body: MarketOverviewResponse = { ...merged, turnover, breadth };
    return res.status(200).json(body);
  });

  app.get('/api/limit-up', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);

    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const body: LimitUpResponse = await fetchEastmoneyLimitUp(tradeDate);
    return res.status(200).json(body);
  });

  app.get('/api/limit-up-ladder', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);

    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const body: LimitUpLadderResponse = await fetchLimitUpLadder(tradeDate);
    return res.status(200).json(body);
  });

  app.get('/api/sprint-limit-up', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);

    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const body: SprintLimitUpResponse = await fetchEastmoneySprintLimitUp(tradeDate);
    return res.status(200).json(body);
  });

  app.get('/api/dragon-tiger', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);

    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const body: DragonTigerResponse = await fetchEastmoneyDragonTiger(tradeDate);
    return res.status(200).json(body);
  });

  app.get('/api/auction', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);

    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const cached = auctionCache.get(tradeDate);
    if (cached !== null) {
      return res.status(200).json(cached);
    }

    const body: AuctionResponse = await fetchEastmoneyAuction(tradeDate);

    // 只缓存成功结果：失败结果留给下次请求重试，避免把偶发故障固化 5 分钟。
    if (body.status === 'fresh') {
      /*
       * 09:15 之前请求「今天」时，返回的是上一个交易日的整卡快照（tradeDate 被回退）：
       * 那份数据在开盘前不会再变，缓存到集合竞价开始即可 —— 既不用反复打上游，
       * 也能在 09:15 一到就自然过期、立刻换回当天的竞价。
       */
      const isPreviousSession = body.tradeDate !== null && body.tradeDate !== tradeDate;
      auctionCache.set(
        tradeDate,
        body,
        isPreviousSession ? Math.max(msUntilCallAuction(), 5_000) : undefined,
      );
    }

    return res.status(200).json(body);
  });

  app.get('/api/themes', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);
    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const body: ThemesResponse = await buildThemes(tradeDate);
    return res.status(200).json(body);
  });

  // 新接口：一个题材一张去重股票表（响应为 ThemeDetailResponseV2，不接收 role）
  app.get('/api/themes/:code/detail', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);
    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const code = String(req.params.code ?? '').trim().toUpperCase();
    if (!/^BK\d{4}$/.test(code)) {
      return res.status(400).json({ message: 'code 必须是 BK 开头的板块代码' });
    }

    const body: ThemeDetailResponseV2 = await buildThemeDetail(tradeDate, code);
    return res.status(200).json(body);
  });

  // 兼容包装：调用同一个新服务，再按 roles 包含指定角色筛选。已无调用方时后续单独清理。
  app.get('/api/themes/:code/stocks', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);
    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const code = String(req.params.code ?? '').trim().toUpperCase();
    if (!/^BK\d{4}$/.test(code)) {
      return res.status(400).json({ message: 'code 必须是 BK 开头的板块代码' });
    }

    const role = String(req.query.role ?? 'leader');
    if (role !== 'leader' && role !== 'turnover' && role !== 'trend' && role !== 'laggard') {
      return res.status(400).json({ message: 'role 必须是 leader / turnover / trend / laggard' });
    }

    const body: ThemeStocksResponse = await buildThemeStocks(tradeDate, code, role);
    return res.status(200).json(body);
  });

  app.get('/api/screener/trend', async (req, res) => {
    const tradeDate = parseTradeDate(req.query.date);
    if (tradeDate === null) {
      return res.status(400).json({ message: 'date 必须是 YYYYMMDD 格式' });
    }

    const filters = parseTrendFilters(req.query as Record<string, unknown>);
    const body: TrendScanResponse = await scanTrend(tradeDate, filters);
    return res.status(200).json(body);
  });

  app.get('/api/quotes', async (req, res) => {
    const rawSymbols = req.query.symbols;
    if (rawSymbols === undefined) {
      return res.status(400).json({ message: '缺少 symbols 查询参数' });
    }

    let symbols: string[];
    try {
      symbols = parseSymbols(rawSymbols);
    } catch (error) {
      return res.status(400).json({
        message: error instanceof Error ? error.message : '请求参数不合法',
      });
    }

    if (symbols.length === 0) {
      return res.status(400).json({ message: '缺少 symbols 查询参数' });
    }

    const fetchedAt = new Date().toISOString();
    const primary = await fetchTencentQuotes(symbols);
    const resolved = new Set(primary.quotes.map((quote) => quote.symbol));
    const missing = symbols.filter((symbol) => !resolved.has(symbol));
    const fallback =
      missing.length > 0 ? await fetchEastmoneyQuotes(missing) : { quotes: [], errors: [] };

    const body: QuotesResponse = mergeQuoteBundles(primary, fallback, fetchedAt);

    return res.status(200).json(body);
  });

  app.get('/api/stock-search', async (req, res) => {
    const query = String(req.query.query ?? '').trim();

    if (!query) {
      return res.status(400).json({ message: '缺少 query 查询参数' });
    }

    if (query.length > 40) {
      return res.status(400).json({ message: '搜索内容不能超过 40 个字符' });
    }

    try {
      const body: StockSearchResponse = {
        results: await fetchEastmoneySearch(query),
        source: 'eastmoney',
      };

      return res.status(200).json(body);
    } catch (error) {
      return res.status(502).json({
        message: error instanceof Error ? error.message : '股票搜索失败',
      });
    }
  });

  if (HAS_DIST) {
    app.use(express.static(DIST_DIR));

    app.get(/^(?!\/api\/).*/, (_req, res) => {
      return res.sendFile(INDEX_HTML);
    });
  } else {
    app.get(/^(?!\/api\/).*/, (_req, _res, next) => {
      return next();
    });
  }

  app.use((_req, res) => {
    return res.status(404).json({ message: '未找到资源' });
  });

  return app;
};

const app = createApp();
const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
