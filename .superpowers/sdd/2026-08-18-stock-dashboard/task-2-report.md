# Task 2 Report — Performance Calculations

## Summary

Implemented the shared stock dashboard calculation types and pure performance helpers:

- `src/types.ts`
- `src/lib/calculations.ts`
- `src/lib/calculations.test.ts`

The implementation follows the task brief exactly for holding performance and portfolio summary shapes, including partial-quote handling and the non-positive open price error.

## TDD Evidence

### RED

Command:

```bash
npm test -- src/lib/calculations.test.ts
```

Output excerpt:

```text
FAIL  src/lib/calculations.test.ts [ src/lib/calculations.test.ts ]
Error: Failed to resolve import "./calculations" from "src/lib/calculations.test.ts". Does the file exist?
```

This is the expected red state before implementing `src/lib/calculations.ts`.

### GREEN

Command:

```bash
npm test -- src/lib/calculations.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

## Verification

Focused calculation suite:

```bash
npm test -- src/lib/calculations.test.ts
```

TypeScript check:

```bash
npm run typecheck
```

Full test suite:

```bash
npm test
```

All three checks passed after the implementation fix.

## Self-review

- The exported types in `src/types.ts` match the task brief and the stock dashboard spec.
- `calculateHoldingPerformance` throws `开仓价必须大于 0` for non-positive open prices.
- Missing or unusable quotes return `profit: null`, `returnPct: null`, and `hasQuote: false`.
- Portfolio summaries sum only usable quote values, mark partial data with `hasPartialQuotes: true`, and keep `profit` / `returnPct` nullable when any quote is missing.
- No rounding is performed inside the calculation functions.

## Concerns

- None at the moment. The current behavior is covered by focused tests, typecheck, and the full suite.

## Fix follow-up — quantity validation

### What changed

- Added strict finite-and-positive validation for `holding.quantity` in `src/lib/calculations.ts`.
- The calculation helpers now reject `NaN`, `Infinity`, and non-positive quantities with `持有数量必须大于 0`.
- This prevents invalid quantities from leaking `NaN` / `Infinity` into `profit`, `invested`, and `marketValue`.

### Covering test files

- `src/lib/calculations.test.ts`

### Verification commands and passing output

Focused regression suite:

```bash
npm test -- src/lib/calculations.test.ts
```

Passing output:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

TypeScript check:

```bash
npm run typecheck
```

Passing output:

```text
> typecheck
> tsc -b --pretty false
```

Full suite:

```bash
npm test
```

Passing output:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

### Fix commit SHA

- `e5b4ba9` — `fix: guard invalid holding quantities`
