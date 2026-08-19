import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LimitUpResponse,
  MarketOverviewResponse,
  QuotesResponse,
  StockSearchResponse,
} from '../src/types.js';
import { fetchEastmoneyLimitUp } from './limit-up/eastmoney.js';
import { fetchEastmoneyMarket } from './market/eastmoney.js';
import {
  fetchEastmoneyQuotes,
  fetchEastmoneySearch,
  normalizeSymbol,
} from './quotes/eastmoney.js';

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

export const parseTradeDate = (input: unknown): string | null => {
  if (input === undefined) {
    return getShanghaiToday();
  }

  const value = String(input).trim();
  return /^\d{8}$/.test(value) ? value : null;
};

export const createApp = () => {
  const app = express();

  app.get('/api/market-overview', async (_req, res) => {
    const body: MarketOverviewResponse = await fetchEastmoneyMarket();
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
    const result = await fetchEastmoneyQuotes(symbols);
    const body: QuotesResponse = {
      quotes: result.quotes,
      fetchedAt,
      source: 'eastmoney',
      errors: result.errors,
    };

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
