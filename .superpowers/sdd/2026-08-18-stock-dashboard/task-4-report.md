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

## Review Fix Round — 2026-08-18

### Changes made

- Added a dedicated production server compile target in `tsconfig.server.json` that emits ESM server files to `dist-server/`.
- Updated `package.json` so:
  - `dev` still runs `tsx watch server/index.ts`
  - `build` cleans `dist-server/`, compiles both app and server TypeScript, then builds the Vite client bundle
  - `start` runs `node dist-server/server/index.js`
- Added `dist-server/` to `.gitignore`.
- Hardened `fetchEastmoneyQuotes` so each public entrypoint symbol is trimmed and validated inside the adapter before any upstream request is built.
- Preserved per-symbol isolation: invalid symbols now return `{ symbol, message }` errors without preventing valid symbols from succeeding.
- Switched server/runtime-relative imports to explicit `.js` ESM specifiers so the emitted Node runtime stays self-contained.
- Changed the unmatched-route 404 response copy to Chinese: `未找到资源`.

### TDD evidence for the review fixes

#### RED

Command:

```bash
npm test -- server/quotes/eastmoney.test.ts
```

Observed failing output before the fix:

```text
FAIL  server/quotes/eastmoney.test.ts > eastmoney quote adapter > normalizes whitespace before building the upstream request
expected ... to contain 'secid=1.600519'

FAIL  server/quotes/eastmoney.test.ts > eastmoney quote adapter > returns a per-symbol error for invalid symbols without calling upstream
expected "vi.fn()" to be called 1 times, but got 2 times
```

This proved the adapter was not normalizing/validating symbols at its public boundary.

#### GREEN

Command:

```bash
npm test -- server/quotes/eastmoney.test.ts
```

Passing output after the fix:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

New coverage added:

- whitespace trimming before `secid` generation
- invalid symbol short-circuiting without upstream request
- valid symbol success preserved when another symbol is invalid

### Verification commands and outputs

Focused adapter suite:

```bash
npm test -- server/quotes/eastmoney.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

TypeScript check:

```bash
npm run typecheck
```

Output:

```text
> typecheck
> tsc -b --pretty false tsconfig.json tsconfig.server.json
```

Production build:

```bash
npm run build
```

Output:

```text
> build
> rm -rf dist-server && tsc -b tsconfig.json tsconfig.server.json && vite build
...
✓ built in 168ms
```

Verified emitted production server files:

```text
dist-server/server/index.js
dist-server/server/quotes/eastmoney.js
```

Full suite:

```bash
npm test
```

Output:

```text
Test Files  3 passed (3)
Tests       18 passed (18)
```

### Self-review

- The production `start` path no longer depends on `tsx` or any devDependency runtime.
- The server build emits executable ESM JavaScript with Node-compatible `.js` import specifiers.
- The static client fallback still resolves from the repository `dist/` directory during both `npm run dev` and `npm start`.
- Adapter validation now protects all external callers, not only the HTTP route.
