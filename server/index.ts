import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuotesResponse } from '../src/types';
import { fetchEastmoneyQuotes, normalizeSymbol } from './quotes/eastmoney';

const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
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

export const createApp = () => {
  const app = express();

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
    return res.status(404).json({ message: 'Not Found' });
  });

  return app;
};

const app = createApp();
const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
