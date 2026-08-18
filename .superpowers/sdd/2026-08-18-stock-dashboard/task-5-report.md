# Task 5 Report — Browser quote client and shared display helpers

## RED evidence

- Focused test command: `npm test -- src/lib/quotes.test.ts`
- Expected red result before implementation: failed import resolution for `./quotes`
- Observed failure: `Error: Failed to resolve import "./quotes" from "src/lib/quotes.test.ts". Does the file exist?`

## GREEN evidence

- Focused test command: `npm test -- src/lib/quotes.test.ts` → passed
- Full unit suite: `npm test` → passed
- Typecheck: `npm run typecheck` → passed
- Build: `npm run build` → passed

## Files changed

- `src/lib/quotes.test.ts`
- `src/lib/quotes.ts`
- `src/types.ts`

## What changed

- Added `fetchQuotes()` to call `/api/quotes?symbols=...` with deduplicated, URL-encoded symbols.
- Added `mergeQuotes()` to refresh successful quotes and mark previously known failed quotes as `stale` without deleting them.
- Added `formatCurrency()`, `formatPercent()`, and `formatQuoteTime()` with consistent Chinese display formatting and `—` for `null`.
- Added the shared `QuoteMap` type for clearer quote-cache handling.

## Self-review

- Symbol deduplication preserves first-seen order and trims empty inputs.
- Non-2xx responses throw a user-facing error with the HTTP status.
- Refresh failures preserve prior numeric quote data and only flip status to `stale`.
- Formatter behavior is stable under the current locale/timezone assumptions used by the helper.

## Concerns

- There is an unrelated pre-existing modification in `.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md` that I did not change or include in the commit.

---

# Task 5 Fix Report — Symbol validation hardening

## Issue fixed

- `fetchQuotes()` now normalizes surrounding whitespace and rejects any non-six-digit ASCII A-share symbol before calling `fetch`.
- Invalid input fails fast with the existing user-facing message: `股票代码必须是 6 位数字`.
- Fetch is not called when any input symbol is invalid.

## New/updated tests

- Updated the API request test to cover whitespace normalization plus deduplication.
- Added a focused test that invalid input rejects before any request is made.

## Verification

- `npm test -- src/lib/quotes.test.ts` → passed
- `npm test` → passed
- `npm run typecheck` → passed
- `npm run build` → passed

## Notes

- `mergeQuotes()` and the rest of the public helper contract remain unchanged.
