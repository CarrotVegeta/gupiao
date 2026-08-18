# Stock Dashboard Final Fix Wave Report

Date: 2026-08-18

Base HEAD: `afae390`

Requested commit message: `fix: harden quote, persistence, and accessibility flows`

## Outcome

Implemented every Critical and Important item from the final review as one coherent fix wave. No dependency versions were changed. The pre-existing modification to `.superpowers/sdd/2026-08-18-stock-dashboard/task-2-report.md` was not edited and is excluded from this commit.

## Files changed

- `server/quotes/eastmoney.ts`
  - Requests `f59`, normalizes raw integer prices/change by vendor precision (defaulting to hundredths), normalizes `f170` into percent units, parses Unix-second and 14-digit timestamps, and rejects empty/incomplete per-symbol data.
- `server/quotes/eastmoney.test.ts`
  - Replaces decimal fixtures with raw vendor-shaped fixtures and covers normalized values, ISO timestamps, precision field requests, empty payloads, and incomplete quotes.
- `src/lib/quotes.ts`
  - Adds a complete/fresh quote gate. Unusable responses and symbol errors mark existing quotes stale without replacing numeric values.
- `src/lib/quotes.test.ts`
  - Adds unavailable and incomplete quote preservation regressions.
- `src/lib/storage.ts`
  - Requires the system `ungrouped` group, unique group IDs, and valid holding-to-group references for both load and save.
- `src/lib/storage.test.ts`
  - Adds focused load-recovery and save-rejection tests for all three invalid state classes.
- `src/lib/useDialogFocus.ts`
  - Adds shared initial focus, Escape close, focus restoration, and Tab/Shift+Tab trapping behavior.
- `src/components/HoldingForm.tsx`
  - Adds dialog semantics, focus lifecycle, current-group defaulting, and an exposed busy/disabled submission state.
- `src/components/GroupDialog.tsx`
  - Adds dialog semantics, focus lifecycle, and support for keeping edit-group danger actions inside the active dialog.
- `src/components/HoldingList.tsx`
  - Uses shared formatters and displays runtime name, latest price, change amount, percent, and quote update time.
- `src/components/components.test.tsx`
  - Adds quote field/name/time assertions and focused modal semantics, Escape, restoration, and focus-cycle tests.
- `src/App.tsx`
  - Persists create/edit state before awaiting quotes, refreshes from the next full holding list, prevents duplicate submission, and marks all target cached quotes stale on whole-refresh rejection.
- `src/App.test.tsx`
  - Adds local-first create/edit, failed quote preservation, next-list refresh, selected-group default, and whole-batch stale regressions.
- `src/styles.css`
  - Keeps edit-group danger controls visually separated while inside the same accessible dialog.
- `.superpowers/sdd/2026-08-18-stock-dashboard/final-fix-report.md`
  - This report.

## TDD red/green evidence

All failing states below were observed before the corresponding implementation, except the final next-list check which also received an explicit mutation RED after implementation and was restored to GREEN.

| Behavior | RED command and observed output | GREEN command and observed output |
| --- | --- | --- |
| Eastmoney raw contract, timestamps, empty/incomplete payloads | `npm test -- server/quotes/eastmoney.test.ts` → 1 file failed; 5 failed, 4 passed. Failures showed raw `129799/129309/490/38`, fallback timestamps, empty quote insertion, and missing `f59`. | Same command → 1 file passed; 9 passed. |
| Unusable quote preservation | `npm test -- src/lib/quotes.test.ts` → 1 file failed; 2 failed, 6 passed. Null/incomplete responses replaced historical values. | Same command → 1 file passed; 8 passed. |
| Whole-batch rejection marks cached holding quotes stale | `npm test -- src/App.test.tsx` → 1 file failed; 1 failed, 4 passed. No `行情已过期` badges appeared. | Same command → 1 file passed; 5 passed. |
| Storage relationship integrity | `npm test -- src/lib/storage.test.ts` → 1 file failed; 3 failed, 7 passed. Missing ungrouped, duplicate IDs, and dangling group references were accepted. | Same command → 1 file passed; 10 passed. |
| List change amount and update time | `npm test -- src/components/components.test.tsx` → 1 file failed; 1 failed, 8 passed. `+¥2.00` and update time were absent. | Same command → 1 file passed; 9 passed. |
| Base dialog semantics/focus/Escape | `npm test -- src/components/components.test.tsx` → 1 file failed; 2 failed, 9 passed. Both components exposed `region`, not `dialog`. | Same command → 1 file passed; 11 passed. |
| Local-first create/edit and selected group | `npm test -- src/App.test.tsx` → 1 file failed; 3 failed, 5 passed. Custom group was not selected and storage remained unchanged while refresh was pending. | After implementation and correcting ambiguous duplicate-text selectors: same command → 1 file passed; 9 passed. |
| Edit-group danger controls stay in dialog | `npm test -- src/components/components.test.tsx` → 1 file failed; 1 failed, 11 passed. Tabbing from the sibling delete action escaped to `body`. | Same command → 1 file passed; 12 passed. |
| New holding refresh uses the next full list (mutation check) | Temporarily restored the old single-symbol call, then ran `npm test -- src/App.test.tsx -t 'refreshes all symbols from the next holding list after adding a holding'` → 1 failed, 8 skipped; received `/api/quotes?symbols=000001` instead of `600519%2C000001`. | Restored implementation and reran the same command → 1 passed, 8 skipped. |

Additional focused/regression runs:

- `npm test -- src/App.test.tsx` after stale merge implementation → 1 file passed, 5 passed.
- `npm test -- src/components/components.test.tsx` after integrating danger actions → 1 file passed, 12 passed.
- `npm test -- src/App.test.tsx` after integrating danger actions → 1 file passed, 9 passed.
- Intermediate `npm test` → 6 files passed, 52 tests passed.
- Pre-smoke `npm test` → 6 files passed, 53 tests passed.

## Final verification

### Tests

Command:

```text
npm test
```

Final output:

```text
Test Files  6 passed (6)
Tests       53 passed (53)
Duration    3.63s
```

### TypeScript

Command:

```text
npm run typecheck
```

Final output:

```text
tsc -b --pretty false tsconfig.json tsconfig.server.json
exit 0
```

An intermediate typecheck found `TS2304: Cannot find name 'QuotesResponse'` after an import cleanup. The type-only import was restored, and all subsequent typechecks exited 0.

### Production build

Command:

```text
npm run build
```

Final output:

```text
vite v8.2.1 building client environment for production...
25 modules transformed.
dist/index.html                   0.41 kB | gzip: 0.31 kB
dist/assets/index-c2py-dqT.css    6.27 kB | gzip: 1.84 kB
dist/assets/index-B_sKs7hJ.js   213.84 kB | gzip: 66.58 kB
built in 147ms
exit 0
```

### Dev smoke check

Initial sandboxed `npm run dev` failed before application startup because `tsx watch` could not create `/tmp/tsx-1000/24.pipe` (`listen EPERM`). The same command was rerun with approved sandbox escalation.

Escalated startup output:

```text
VITE v8.2.1 ready in 208 ms
Local: http://localhost:5173/
server listening on http://localhost:3001
```

Smoke requests:

```text
curl -sS -i http://localhost:5173/
→ HTTP/1.1 200 OK; rendered Chinese stock dashboard HTML shell.

curl -sS -i 'http://localhost:5173/api/quotes?symbols=600519'
→ HTTP/1.1 200 OK
→ {"quotes":[{"symbol":"600519","name":"贵州茅台","price":1297.99,
   "change":4.9,"pct":0.38,"preClose":1293.09,
   "updatedAt":"2026-08-18T08:11:49.000Z","source":"eastmoney",
   "status":"fresh"}],"source":"eastmoney","errors":[]}
```

The dev process was stopped with SIGINT after both requests completed.

## Remaining concerns

- Eastmoney is a public upstream and can be unavailable, rate-limited, or return incomplete data. The implementation now isolates each symbol, preserves stale values, and surfaces errors, but cannot guarantee upstream availability.
- If `f59` is absent or invalid, A-share price fields intentionally fall back to hundredths, matching the reviewed live contract.
- The 14-digit compatibility format is interpreted as China Standard Time (`+08:00`); live Unix-second timestamps remain timezone-unambiguous.
- No dependency pinning work was performed because it was not required for tests, typecheck, build, or smoke verification.
