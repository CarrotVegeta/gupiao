# A 股个人股票看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first A-share portfolio dashboard with live quote refresh, groups, notes, opening prices, per-holding returns, and filtered total returns.

**Architecture:** React + TypeScript + Vite renders the dashboard and stores holdings/groups in browser `localStorage`. A small Express server exposes `/api/quotes` and adapts Eastmoney's public quote response into a stable application `Quote` type; the browser never calls the vendor directly.

**Tech Stack:** React 18, TypeScript, Vite, Express, Vitest, Testing Library, jsdom, `tsx`, and plain CSS with CSS variables.

**Spec:** `/home/secneo/code/gupiao/docs/superpowers/specs/2026-08-18-stock-dashboard-design.md`

## Global Constraints

- Support Chinese A-share symbols as six digits; normalize and validate symbols before saving or requesting quotes.
- Persist groups and holdings in `localStorage`; quote data remains runtime-only and must never overwrite holding input data.
- Use the standard `Quote` shape in the UI; keep Eastmoney field numbers inside `server/quotes/eastmoney.ts`.
- Calculate total return with `Σ(openPrice × quantity)` and `Σ(price × quantity)`; missing prices make the summary partial instead of zero.
- Use Chinese UI copy and Chinese or English code comments consistently; this plan uses Chinese UI copy and English identifiers.
- No authentication, database, transaction history, fees, dividends, or investment advice in this iteration.
- Production claims require fresh output from `npm run typecheck`, `npm test`, and `npm run build`.

## File Map

- Create `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `index.html` for the runnable React + Express project.
- Create `src/main.tsx`, `src/App.tsx`, `src/types.ts`, and `src/styles.css` for application composition and visual layout.
- Create `src/lib/calculations.ts` and `src/lib/calculations.test.ts` for pure performance calculations.
- Create `src/lib/storage.ts` and `src/lib/storage.test.ts` for browser persistence and group migration.
- Create `src/lib/quotes.ts` and `src/lib/quotes.test.ts` for the browser API client.
- Create `src/components/Overview.tsx`, `src/components/GroupSidebar.tsx`, `src/components/HoldingList.tsx`, `src/components/HoldingForm.tsx`, and `src/components/GroupDialog.tsx` for focused UI units.
- Create `src/components/components.test.tsx` for isolated component behavior.
- Create `src/App.test.tsx` for end-to-end-in-the-browser interaction coverage.
- Create `server/index.ts`, `server/quotes/eastmoney.ts`, and `server/quotes/eastmoney.test.ts` for the quote proxy and vendor mapping.

### Task 1: Scaffold the runnable project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/vite-env.d.ts`

**Interfaces:**
- Produces the npm scripts used by every later task: `dev`, `start`, `build`, `typecheck`, `test`, and `test:watch`.
- Produces a Vite dev proxy from `/api` to `http://localhost:3001`.

- [ ] **Step 1: Create package metadata and scripts**

Add this dependency and script contract to `package.json`:

```json
{
  "name": "stock-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"vite\" \"tsx watch server/index.ts\"",
    "start": "tsx server/index.ts",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@testing-library/user-event": "latest",
    "@types/express": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "concurrently": "latest",
    "jsdom": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Add TypeScript, Vite, and Vitest configuration**

Configure strict TypeScript with DOM and Node types. Configure Vite with the React plugin and this dev proxy:

```ts
server: {
  proxy: {
    "/api": "http://localhost:3001",
  },
},
```

Configure Vitest with `environment: "jsdom"`, `globals: true`, and a setup file that imports `@testing-library/jest-dom`.

- [ ] **Step 3: Add the browser entrypoint and minimal shell**

Create `index.html` with `lang="zh-CN"`, a `root` element, and the page title `自选台 · A 股个人看板`. Create `src/main.tsx` that renders `<App />` inside `StrictMode`; create a temporary `src/App.tsx` returning a `<main>` with `自选台` so the scaffold typechecks before feature work.

- [ ] **Step 4: Install dependencies and verify the scaffold**

Run:

```bash
npm install
npm run typecheck
npm test -- --passWithNoTests
npm run build
```

Expected: all commands exit 0; Vite produces `dist/`; the temporary page has no runtime import errors.

### Task 2: Implement and test performance calculations

**Files:**
- Create: `src/types.ts`
- Create: `src/lib/calculations.test.ts`
- Create: `src/lib/calculations.ts`

**Interfaces:**
- `Holding`, `Quote`, `StockGroup`, `HoldingPerformance`, and `PortfolioSummary` types are exported from `src/types.ts`.
- `calculateHoldingPerformance(holding: Holding, quote: Quote | undefined): HoldingPerformance` returns `{ profit, returnPct, hasQuote }`.
- `calculatePortfolioSummary(holdings: Holding[], quotes: Record<string, Quote>): PortfolioSummary` returns `{ invested, marketValue, profit, returnPct, hasPartialQuotes, holdingCount }`.
- When a holding has no usable quote, `profit` and `returnPct` are `null`; when the portfolio has any missing quote, `profit` and `returnPct` are `null` while `marketValue` includes only usable quotes.

Use these exact result shapes:

```ts
type HoldingPerformance = {
  profit: number | null;
  returnPct: number | null;
  hasQuote: boolean;
};

type PortfolioSummary = {
  invested: number;
  marketValue: number;
  profit: number | null;
  returnPct: number | null;
  hasPartialQuotes: boolean;
  holdingCount: number;
};
```

- [ ] **Step 1: Write failing calculation tests**

Add tests with concrete holdings and quotes:

```ts
it("calculates one holding profit and return from the latest price", () => {
  const result = calculateHoldingPerformance(
    holding({ openPrice: 10, quantity: 100 }),
    quote({ price: 12 }),
  );

  expect(result).toEqual({ profit: 200, returnPct: 20, hasQuote: true });
});

it("calculates a weighted portfolio summary", () => {
  const result = calculatePortfolioSummary(
    [holding({ id: "a", symbol: "600519", openPrice: 10, quantity: 100 }),
     holding({ id: "b", symbol: "000001", openPrice: 20, quantity: 50 })],
    { "600519": quote({ symbol: "600519", price: 12 }),
      "000001": quote({ symbol: "000001", price: 18 }) },
  );

  expect(result).toMatchObject({
    invested: 2000,
    marketValue: 2100,
    profit: 100,
    returnPct: 5,
    hasPartialQuotes: false,
    holdingCount: 2,
  });
});

it("marks the summary partial instead of treating a missing quote as zero", () => {
  const result = calculatePortfolioSummary(
    [holding({ symbol: "600519" }), holding({ symbol: "000001" })],
    { "600519": quote({ symbol: "600519", price: 12 }) },
  );

  expect(result.marketValue).toBe(1200);
  expect(result.profit).toBeNull();
  expect(result.returnPct).toBeNull();
  expect(result.hasPartialQuotes).toBe(true);
});

it("rejects a non-positive opening price without returning a valid performance", () => {
  expect(() => calculateHoldingPerformance(holding({ openPrice: 0 }), quote({ price: 12 })))
    .toThrow("开仓价必须大于 0");
});
```

Define these local fixtures at the top of the test file so tests exercise real calculation code rather than mocks:

```ts
const holding = (overrides: Partial<Holding> = {}): Holding => ({
  id: "h-1", symbol: "600519", groupId: "ungrouped", openPrice: 10,
  quantity: 100, note: "", createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z", ...overrides,
});

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  symbol: "600519", name: "贵州茅台", price: 12, change: 2,
  pct: 20, preClose: 10, updatedAt: "2026-08-18T10:30:00.000Z",
  source: "eastmoney", status: "fresh", ...overrides,
});
```

- [ ] **Step 2: Run the focused tests and confirm the expected red state**

Run `npm test -- src/lib/calculations.test.ts`. Expected: FAIL because `src/lib/calculations.ts` and its exported functions do not exist yet; do not continue until the failure is a missing implementation rather than a test setup error.

- [ ] **Step 3: Implement the minimal calculation functions**

Use finite-number guards, preserve `null` for unusable quotes, and calculate totals using exact numeric inputs. Do not round inside the calculation functions; rounding belongs to display formatters so aggregate values remain accurate.

- [ ] **Step 4: Run the focused tests and confirm green**

Run `npm test -- src/lib/calculations.test.ts`; expected: all calculation tests pass.

### Task 3: Add local persistence and group migration

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/storage.test.ts`
- Create: `src/lib/storage.ts`

**Interfaces:**
- `StorageState` is `{ groups: StockGroup[]; holdings: Holding[] }`.
- `createDefaultState(): StorageState` returns the “未分组” system group and no holdings.
- `loadState(storage: Storage): { state: StorageState; recovered: boolean }` reads `stock-dashboard:v1`, validates the required arrays, and recovers defaults for invalid JSON or invalid shape.
- `saveState(storage: Storage, state: StorageState): void` serializes only groups and holdings.
- `moveHoldingsToGroup(state: StorageState, sourceGroupId: string, destinationGroupId: string): StorageState` moves holdings immutably.

- [ ] **Step 1: Write failing storage tests**

Cover defaults, round-trip persistence, malformed JSON recovery, and group deletion migration:

```ts
it("creates one system ungrouped group for a new browser", () => {
  expect(createDefaultState()).toMatchObject({
    groups: [{ id: "ungrouped", name: "未分组", isSystem: true }],
    holdings: [],
  });
});

it("round-trips holdings and groups through localStorage", () => {
  const state = stateWithHolding();
  saveState(localStorage, state);
  expect(loadState(localStorage)).toEqual({ state, recovered: false });
});

it("recovers a usable empty state when localStorage contains invalid JSON", () => {
  localStorage.setItem("stock-dashboard:v1", "{");
  expect(loadState(localStorage).recovered).toBe(true);
  expect(loadState(localStorage).state.holdings).toEqual([]);
});

it("moves holdings into ungrouped without mutating the original state", () => {
  const state = stateWithHolding({ groupId: "growth" });
  const next = moveHoldingsToGroup(state, "growth", "ungrouped");
  expect(next.holdings[0].groupId).toBe("ungrouped");
  expect(state.holdings[0].groupId).toBe("growth");
});
```

Use this fixture in the same test file:

```ts
const stateWithHolding = (overrides: Partial<Holding> = {}): StorageState => ({
  groups: [
    { id: "ungrouped", name: "未分组", isSystem: true, createdAt: "2026-08-18T00:00:00.000Z" },
    { id: "growth", name: "成长股", isSystem: false, createdAt: "2026-08-18T00:00:00.000Z" },
  ],
  holdings: [{
    id: "h-1", symbol: "600519", name: "贵州茅台", groupId: "ungrouped",
    openPrice: 10, quantity: 100, note: "", createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z", ...overrides,
  }],
});
```

- [ ] **Step 2: Run the focused storage tests and confirm red**

Run `npm test -- src/lib/storage.test.ts`; expected: FAIL because the storage module does not exist yet.

- [ ] **Step 3: Implement storage validation and migration helpers**

Use the provided `Storage` object instead of directly importing `window.localStorage` so tests and future persistence adapters can supply their own store. Treat missing arrays, non-string IDs, non-positive prices/quantities, and non-array JSON values as invalid and recover the complete default state.

- [ ] **Step 4: Run focused tests and then the full current suite**

Run `npm test -- src/lib/storage.test.ts` and then `npm test`. Expected: calculation and storage tests pass with no unhandled jsdom errors.

### Task 4: Implement the Eastmoney quote adapter and server endpoint

**Files:**
- Create: `server/quotes/eastmoney.test.ts`
- Create: `server/quotes/eastmoney.ts`
- Create: `server/index.ts`

**Interfaces:**
- `QuoteError` is `{ symbol: string; message: string }` and `QuotesResponse` is `{ quotes: Quote[]; fetchedAt: string; source: "eastmoney"; errors: QuoteError[] }`.
- `normalizeSymbol(value: string): string` returns a six-digit symbol or throws `股票代码必须是 6 位数字`.
- `toEastmoneySecId(symbol: string): string` returns `1.${symbol}` for symbols beginning with `6`, otherwise `0.${symbol}`.
- `mapEastmoneyQuote(payload: EastmoneyQuotePayload, fetchedAt: string): Quote` maps `data.f43/f57/f58/f60/f169/f170/f86` to the stable `Quote` type and returns `status: "fresh"` only when `f43` and `f170` are finite.
- `fetchEastmoneyQuotes(symbols: string[], fetchImpl?: typeof fetch): Promise<{ quotes: Quote[]; errors: QuoteError[] }>` fetches each symbol through `https://push2.eastmoney.com/api/qt/stock/get`, uses a 5-second abort timeout per request, and isolates failures per symbol.
- Express `GET /api/quotes` parses `symbols`, deduplicates and caps at 50 symbols, calls the adapter, and returns `{ quotes, fetchedAt, source: "eastmoney", errors }`.

- [ ] **Step 1: Write failing adapter tests**

Test the market ID mapping, field mapping, percentage units, and per-symbol error isolation:

```ts
it("maps Shanghai and Shenzhen symbols to Eastmoney security ids", () => {
  expect(toEastmoneySecId("600519")).toBe("1.600519");
  expect(toEastmoneySecId("000001")).toBe("0.000001");
});

it("maps the vendor field numbers into a normalized quote", () => {
  expect(mapEastmoneyQuote({
    data: { f43: 168.2, f57: "600519", f58: "贵州茅台", f60: 165,
      f169: 3.2, f170: 1.98, f86: "20260818103000" },
  }, "2026-08-18T10:30:00.000Z")).toMatchObject({
    symbol: "600519", name: "贵州茅台", price: 168.2,
    preClose: 165, change: 3.2, pct: 1.98, status: "fresh",
    source: "eastmoney",
  });
});

it("returns an unavailable quote for an empty vendor payload", () => {
  expect(mapEastmoneyQuote({ data: null }, "2026-08-18T10:30:00.000Z")).toMatchObject({
    symbol: "", price: null, pct: null, status: "unavailable",
  });
});

it("keeps a successful symbol when another symbol request fails", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: validPayload("600519") })))
    .mockRejectedValueOnce(new Error("upstream timeout"));
  const result = await fetchEastmoneyQuotes(["600519", "000001"], fetchImpl);
  expect(result.quotes).toHaveLength(1);
  expect(result.errors).toEqual([{ symbol: "000001", message: "upstream timeout" }]);
});
```

Define `validPayload` as a pure fixture helper returning the vendor shape used by the successful response:

```ts
const validPayload = (symbol: string) => ({
  f43: 168.2, f57: symbol, f58: "贵州茅台", f60: 165,
  f169: 3.2, f170: 1.98, f86: "20260818103000",
});
```

- [ ] **Step 2: Run the adapter tests and verify the expected red state**

Run `npm test -- server/quotes/eastmoney.test.ts`. Expected: FAIL because the adapter module and exports do not exist yet.

- [ ] **Step 3: Implement the normalized adapter**

Keep all vendor-specific URL parameters and field numbers in `eastmoney.ts`. Use `encodeURIComponent` for every symbol request; parse JSON only after checking `response.ok`; return a per-symbol error instead of rejecting the entire batch. Treat `null`, `-`, and non-finite values as missing.

- [ ] **Step 4: Add the Express route and static production server**

In `server/index.ts`, register `GET /api/quotes`, return HTTP 400 for missing or invalid symbols, return HTTP 200 with partial `errors` for upstream failures, serve `dist` when it exists, and fall back to `dist/index.html` for non-API routes. Listen on `Number(process.env.PORT ?? 3001)`.

- [ ] **Step 5: Run adapter tests, typecheck, and build**

Run:

```bash
npm test -- server/quotes/eastmoney.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0. Do not require a live vendor request in automated tests.

### Task 5: Add the browser quote client and shared display helpers

**Files:**
- Create: `src/lib/quotes.test.ts`
- Create: `src/lib/quotes.ts`
- Modify: `src/types.ts`

**Interfaces:**
- `fetchQuotes(symbols: string[], fetchImpl?: typeof fetch): Promise<QuotesResponse>` requests `/api/quotes?symbols=...` and throws a user-facing error for non-2xx responses.
- `mergeQuotes(previous: Record<string, Quote>, response: QuotesResponse): Record<string, Quote>` updates successful quotes and marks previously known but failed quotes as `stale` without deleting them.
- `formatCurrency(value: number | null): string`, `formatPercent(value: number | null): string`, and `formatQuoteTime(value: string | null): string` provide consistent Chinese display formatting.

- [ ] **Step 1: Write failing client tests**

Test URL encoding, non-2xx errors, and stale-cache preservation:

```ts
it("requests deduplicated symbols from the local API", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(validQuotesResponse())));
  await fetchQuotes(["600519", "600519", "000001"], fetchImpl);
  expect(fetchImpl).toHaveBeenCalledWith("/api/quotes?symbols=600519%2C000001");
});

it("marks a previous quote stale when the refresh response reports an error", () => {
  const previous = { "600519": quote({ symbol: "600519", status: "fresh" }) };
  const next = mergeQuotes(previous, { ...validQuotesResponse(), quotes: [], errors: [{ symbol: "600519", message: "timeout" }] });
  expect(next["600519"].status).toBe("stale");
  expect(next["600519"].price).toBe(previous["600519"].price);
});
```

Use a local `validQuotesResponse()` fixture containing one fresh `Quote`, `fetchedAt: "2026-08-18T10:30:00.000Z"`, `source: "eastmoney"`, and `errors: []`; use the `quote` fixture from Task 2 for the stale-cache assertion.

- [ ] **Step 2: Run the focused client tests and verify red**

Run `npm test -- src/lib/quotes.test.ts`; expected: FAIL because the client module does not exist yet.

- [ ] **Step 3: Implement the client and formatters**

Use `encodeURIComponent` for the comma-separated symbol query, preserve numeric values from JSON, and make formatters return `—` for `null`. Use `Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` for currency and percentage strings.

- [ ] **Step 4: Run the focused client tests and full unit suite**

Run `npm test -- src/lib/quotes.test.ts` followed by `npm test`. Expected: all current unit tests pass.

### Task 6: Build overview, group navigation, and holding form components

**Files:**
- Create: `src/components/Overview.tsx`
- Create: `src/components/GroupSidebar.tsx`
- Create: `src/components/HoldingForm.tsx`
- Create: `src/components/GroupDialog.tsx`
- Create: `src/components/HoldingList.tsx`
- Create: `src/components/components.test.tsx`
- Create: `src/styles.css`

**Interfaces:**
- `Overview` receives `summary: PortfolioSummary`, `lastUpdated: string | null`, `isRefreshing: boolean`, and `onRefresh: () => void`.
- `GroupSidebar` receives groups, holdings, `selectedGroupId`, `onSelect`, `onCreate`, `onEdit`, and `onDelete` callbacks.
- `HoldingForm` receives `groups`, optional `initialHolding`, `onSubmit`, and `onCancel`; it validates symbol, opening price, quantity, and note length before calling `onSubmit`.
- `GroupDialog` receives optional `initialGroup`, `existingNames`, `onSubmit`, and `onCancel`.
- `HoldingList` receives filtered holdings, runtime quotes, and `onEdit`/`onDelete` callbacks; it uses `calculateHoldingPerformance` for each row.

- [ ] **Step 1: Add component tests for the form contract before implementation**

Add these isolated component tests to `src/components/components.test.tsx` and use them as the required behavior while implementing the components. Import `render` and `screen` from Testing Library, `userEvent` from `@testing-library/user-event`, and define `holding` with the same required fields as the Task 2 fixture.

```tsx
it("shows validation when a holding is submitted without an opening price", async () => {
  await user.click(screen.getByRole("button", { name: "添加股票" }));
  await user.type(screen.getByLabelText("股票代码"), "600519");
  await user.click(screen.getByRole("button", { name: "保存股票" }));
  expect(screen.getByText("请输入大于 0 的开仓价")).toBeInTheDocument();
});

it("shows an edited note on the holding card", () => {
  render(<HoldingList holdings={[holding({ symbol: "600519", note: "观察业绩" })]} quotes={{}} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText("观察业绩")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component test target and verify red**

Run `npm test -- src/App.test.tsx`; expected: FAIL because the application shell and components have not been implemented.

- [ ] **Step 3: Implement the focused components**

Build accessible controls with visible labels, buttons with explicit names, and inline validation. `HoldingList` must show a clear `暂无行情` state for missing quotes and a `行情已过期` badge for stale quotes. `GroupSidebar` must render “全部持仓” as the selected filter when its id is `all`, while only user groups and “未分组” are assignable in the form. `GroupDialog` must prevent case-insensitive duplicate names.

- [ ] **Step 4: Implement responsive visual styling**

Create a warm off-white canvas, dark navy text, card surfaces, thin borders, semantic red/teal quote colors, rounded controls, and a two-column desktop layout that becomes one column below `900px`. Keep focus outlines visible and do not rely on color alone for positive/negative values; include `+`/`−` and labels.

- [ ] **Step 5: Run focused component tests and typecheck**

Run `npm test -- src/components/components.test.tsx` and `npm run typecheck`. Expected: the form and component behavior tests pass and TypeScript reports no errors.

### Task 7: Compose the application state and complete interaction coverage

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `src/App.test.tsx`

**Interfaces:**
- `App` owns `StorageState`, selected group id, runtime quote map, refresh status, and modal state.
- On mount, `App` calls `loadState(localStorage)`; after each group/holding mutation it calls `saveState(localStorage, state)`.
- The selected group filter is `all`, `ungrouped`, or a user group id; deleting a selected group switches selection to `ungrouped`.
- Quote refresh calls `fetchQuotes(holdings.map(h => h.symbol))`, then `mergeQuotes`, and schedules a 30-second refresh only while the document is visible and holdings exist.

- [ ] **Step 1: Write the full interaction test before replacing the temporary shell**

Use Testing Library and `userEvent` to cover the primary workflow:

```tsx
it("adds a holding, persists its note, and filters by group", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新建分组" }));
  await user.type(screen.getByLabelText("分组名称"), "长期持仓");
  await user.click(screen.getByRole("button", { name: "保存分组" }));

  await user.click(screen.getByRole("button", { name: "添加股票" }));
  await user.type(screen.getByLabelText("股票代码"), "600519");
  await user.selectOptions(screen.getByLabelText("分组"), "长期持仓");
  await user.type(screen.getByLabelText("开仓价"), "160");
  await user.type(screen.getByLabelText("持有数量"), "100");
  await user.type(screen.getByLabelText("备注"), "观察业绩");
  await user.click(screen.getByRole("button", { name: "保存股票" }));

  expect(screen.getByText("600519")).toBeInTheDocument();
  expect(screen.getByText("观察业绩")).toBeInTheDocument();
  expect(localStorage.getItem("stock-dashboard:v1")).toContain("观察业绩");

  await user.click(screen.getByRole("button", { name: "长期持仓" }));
  expect(screen.getByText("600519")).toBeInTheDocument();
});

it("moves holdings to ungrouped when a custom group is deleted", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "新建分组" }));
  await user.type(screen.getByLabelText("分组名称"), "短线观察");
  await user.click(screen.getByRole("button", { name: "保存分组" }));
  await user.click(screen.getByRole("button", { name: "添加股票" }));
  await user.type(screen.getByLabelText("股票代码"), "600519");
  await user.selectOptions(screen.getByLabelText("分组"), "短线观察");
  await user.type(screen.getByLabelText("开仓价"), "160");
  await user.type(screen.getByLabelText("持有数量"), "100");
  await user.click(screen.getByRole("button", { name: "保存股票" }));
  await user.click(screen.getByRole("button", { name: "编辑分组 短线观察" }));
  await user.click(screen.getByRole("button", { name: "删除分组" }));
  expect(screen.getByRole("button", { name: "未分组" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByText("600519")).toBeInTheDocument();
});
```

Mock only the browser `/api/quotes` call in this test with a real `fetch` replacement returning a deterministic normalized quote; do not mock calculations or storage functions.

Install the deterministic response at the start of each test with:

```ts
vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
  quotes: [{ symbol: "600519", name: "贵州茅台", price: 168.2, change: 3.2,
    pct: 1.98, preClose: 165, updatedAt: "2026-08-18T10:30:00.000Z",
    source: "eastmoney", status: "fresh" }],
  fetchedAt: "2026-08-18T10:30:00.000Z", source: "eastmoney", errors: [],
}))));
```

- [ ] **Step 2: Run the application test and confirm red**

Run `npm test -- src/App.test.tsx`; expected: FAIL against the temporary shell because the user workflow is not implemented.

- [ ] **Step 3: Implement the state orchestration in `App.tsx`**

Load recovered storage state, keep modal state local, derive filtered holdings and summary with `useMemo`, and save mutations immediately. When adding a holding, use the returned quote name if available and otherwise use the symbol as the temporary display name. On refresh errors, preserve the previous quote map and show a non-blocking status banner.

- [ ] **Step 4: Add refresh lifecycle and empty/error states**

Call `refreshQuotes` after a successful add and on initial mount; clear the interval when the component unmounts or becomes hidden. Render an empty dashboard prompt for zero holdings, an empty group prompt for a group with no holdings, and a stale-data message when all current values come from the previous refresh.

- [ ] **Step 5: Run the interaction tests and full suite**

Run `npm test` and `npm run typecheck`. Expected: all unit and interaction tests pass with no console errors.

### Task 8: Verify the complete local website

**Files:**
- Modify: `README.md`
- Modify: `src/styles.css` only if verification reveals layout defects.

**Interfaces:**
- Documents the exact local commands and the fact that quote data requires network access to the server-side public provider.

- [ ] **Step 1: Add the runbook**

Document:

```text
npm install
npm run dev
# open http://localhost:5173
```

Also document `npm run typecheck`, `npm test`, and `npm run build`, localStorage behavior, and that the dashboard is a personal tracking tool rather than investment advice.

- [ ] **Step 2: Run all automated verification commands**

Run the complete commands fresh:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0, Vitest reports zero failed tests, and Vite emits a production bundle.

- [ ] **Step 3: Run a local smoke test**

Start `npm run dev`, open `http://localhost:5173`, add `600519` with opening price `160` and quantity `100`, verify the server returns a quote or a visible unavailable state, reload the page, and verify the holding and note remain. Stop the dev process after the smoke test.

- [ ] **Step 4: Inspect the final diff and report limitations**

Review all changed files, confirm no credentials or vendor secrets were added, and report the exact verification results plus the known limitation that the public quote provider may be unavailable outside its trading/data service windows.
