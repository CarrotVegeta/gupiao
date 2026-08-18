# Task 4 Report — Eastmoney Quote Adapter and Server Endpoint

## Summary

Implemented Task 4 with the required Eastmoney adapter, focused adapter tests, and Express quote endpoint:

- `server/quotes/eastmoney.test.ts`
- `server/quotes/eastmoney.ts`
- `server/index.ts`
- `src/types.ts`
- `tsconfig.json`

The change stays within Task 4 scope plus the strictly necessary shared quote response types and TypeScript include update for the new server files.

## TDD Evidence

### RED

Command:

```bash
npm test -- server/quotes/eastmoney.test.ts
```

Expected red output observed:

```text
FAIL  server/quotes/eastmoney.test.ts [ server/quotes/eastmoney.test.ts ]
Error: Failed to resolve import "./eastmoney" from "server/quotes/eastmoney.test.ts". Does the file exist?
```

This verified the adapter module and exports did not exist before implementation.

### GREEN

Command:

```bash
npm test -- server/quotes/eastmoney.test.ts
```

Passing output:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

Covered behaviors:

- Shanghai / Shenzhen `secid` mapping
- vendor field normalization into stable `Quote`
- empty payload fallback to `unavailable`
- per-symbol upstream failure isolation

## Verification

Focused adapter suite:

```bash
npm test -- server/quotes/eastmoney.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

TypeScript check:

```bash
npm run typecheck
```

Result: exit 0.

Production build:

```bash
npm run build
```

Result: exit 0, Vite production bundle built successfully.

Full test suite:

```bash
npm test
```

Result:

```text
Test Files  3 passed (3)
Tests       16 passed (16)
```

## Implementation Notes

- `normalizeSymbol(value: string)` enforces six-digit symbols and throws `股票代码必须是 6 位数字`.
- `toEastmoneySecId(symbol: string)` maps `6xxxxx` to `1.` and others to `0.`.
- `fetchEastmoneyQuotes` accepts injected `fetch`, uses a 5-second abort timeout per request, checks `response.ok` before JSON parsing, and returns per-symbol errors without failing the whole batch.
- `GET /api/quotes` parses `symbols`, deduplicates, caps at 50 symbols, returns HTTP 400 for missing/invalid input, and returns HTTP 200 with partial `errors` for upstream failures.
- The server serves `dist` when `dist/index.html` exists and falls back to `dist/index.html` for non-API routes.

## Self-review

- Kept all Eastmoney-specific field numbers and URL details isolated in `server/quotes/eastmoney.ts`.
- Preserved the stable shared `Quote` shape and added only the shared `QuoteError` / `QuotesResponse` types required by the brief.
- Avoided live upstream network calls in tests by injecting `fetch`.
- Verified that one symbol failure does not remove successful symbols from the batch response.
- Confirmed the new server files are included in TypeScript verification via `tsconfig.json`.

## Concerns

- No blocking concerns after the final focused test, typecheck, build, and full-suite verification.
