# Final whole-branch review — fix wave report

Branch: `feat/bingx-order-flow`
Date: 2026-07-29

## Finding 1 (CRITICAL) — OCO route bypassing risk layer

File: `src/app/api/bingx/trade/oco-order/route.ts`

Changes:
- Removed the `placeOcoOrder` import (no longer called from this route) and dropped
  the entire order-placement branch.
- Added an early guard: any `action` other than `"cancel"` or `"query"` now returns
  `501` with `{ success: false, error: { message: "OCO order placement is
  temporarily disabled pending risk-limit integration" } }`, with an inline comment
  explaining why (bypasses `preflightOrder`/rate-limit/audit trail; three-price shape
  doesn't map onto `preflightOrder`'s single-price model).
- Moved the api-key lookup to run only for cancel/query (after the guard), and fixed
  it to use `.order("is_primary", { ascending: false }).order("created_at", {
  ascending: true }).limit(1)`, matching the pattern in `trade/order/route.ts` and
  `futures/order/route.ts`.
- Verified via `grep -rn "placeOcoOrder" src` that its only two references were the
  export in `src/lib/bingx/trade.ts` and the now-removed import/call in this route —
  no other caller exists, so nothing else breaks from dropping the import.
- Cancel and query actions remain fully functional and now use the corrected key
  lookup as well.

## Finding 2 (CRITICAL) — TP/SL survives an order-TYPE change

Files: `src/components/trade/order-form/OrderForm.tsx`,
`src/app/api/bingx/futures/order/route.ts`, and all three locale files.

Client fix (`OrderForm.tsx`):
- Imported `TPSL_ATTACHABLE` from `./config`.
- Reset effect now reads:
  ```ts
  useEffect(() => {
    const canAttach = market === "futures" && TPSL_ATTACHABLE.has(orderType);
    if (!canAttach && showTpSl) {
      setShowTpSl(false);
      setTpPrice("");
      setSlPrice("");
    }
  }, [market, orderType, showTpSl]);
  ```
  This clears TP/SL state on any order-type change that leaves the attachable set
  (MARKET/LIMIT), not just on a market change, closing the exact reproduction in the
  finding (futures → MARKET → TP/SL filled → switch to TRAILING_STOP_MARKET).

Server-side guard (`src/app/api/bingx/futures/order/route.ts`):
- Added, right after the trailing-callback validation and before `preflightOrder` is
  called:
  ```ts
  if (!ATTACHABLE_TPSL.has(type) && (Number(takeProfitPrice) > 0 || Number(stopLossPrice) > 0)) {
    return reject("TPSL_NOT_SUPPORTED", "Take-profit/stop-loss cannot be attached to this order type", 400);
  }
  ```
  This uses the route's existing `reject()` helper, which already derives
  `i18nKey: trading.reject.tpsl_not_supported` from the code.

i18n: added exactly one new key, `trading.reject.tpsl_not_supported`, to all three
locale files under the existing `trading.reject` namespace, next to
`invalid_input`:
- zh-CN: "该订单类型不支持附带止盈止损"
- en-US: "Take-profit/stop-loss cannot be attached to this order type"
- ms-MY: "Untung/rugi tidak boleh dilampirkan pada jenis pesanan ini"

Structural-equality check (see Verification section) confirms all three locale
files still have identical key sets (712 keys each) after the addition.

## Finding 3 (Important) — unordered API-key lookup in futures/positions

File: `src/app/api/bingx/futures/positions/route.ts`

Added `.order("is_primary", { ascending: false }).order("created_at", { ascending:
true })` to the api-key query in both the `GET` handler (leverage/margin/positions
reads) and the `POST` handler (closePosition/closeAllPositions/setLeverage/
setMarginType/setPositionTpSl/setPositionMode/adjustMargin), so this route now
selects the same key as `trade/order/route.ts` and `futures/order/route.ts` for a
given user.

## Finding 4 (Important) — futures form priced off spot ticker

Files: `src/hooks/useMarketData.ts`, `src/components/trade/order-form/OrderForm.tsx`

Hook-design choice: added a **new `useFuturesTicker(symbol)` hook** alongside the
existing `useSpotTicker`, rather than parameterizing `useSpotTicker` with a `market`
argument.

Reasoning: `useSpotTicker` merges its REST poll with a WebSocket store
(`useMarketStore.tickers`), and that store is fed exclusively by a spot ticker feed
(confirmed via `src/stores/market.ts` — `tickers: Record<string, BingXTicker>` keyed
only by symbol, populated by whatever calls `setTicker`/`setTickers`, which is the
spot WS subscription). Parameterizing the existing hook would either (a) silently
merge a futures REST poll with a stale/wrong spot WS value keyed by the same symbol,
or (b) require threading a market-aware key through the WS store and its populating
call sites — real scope creep for a fix-wave pass. A small standalone hook that just
polls `/api/bingx/market/ticker?symbol=...&market=futures` (same 5s interval / 2s
staleTime as `useSpotTicker`'s REST layer, no WS merge) is the less invasive change
and is honest about not having a live-push futures feed today.

`OrderForm.tsx` changes:
- Imports both `useSpotTicker` and `useFuturesTicker`.
- Calls `useFuturesTicker(market === "futures" ? symbol : "")` (empty string keeps
  `enabled: !!symbol` false, so it doesn't fire for spot/paper) alongside the
  existing `useSpotTicker(symbol)` call.
- Selects `const ticker = market === "futures" ? futuresTicker : spotTicker;` and
  derives `currentPrice` from that. Paper market intentionally continues to use the
  spot ticker (paper trading matches against spot-equivalent pricing; the finding
  scoped the defect to the futures market specifically, matching the design spec's
  C3 wording "合约取价从 useSpotTicker 改为合约 ticker").
- `refPrice`, the preflight preview, the confirmation modal, and the `referencePrice`
  sent in the futures POST body all derive from `currentPrice`/`ticker`, so they now
  flow from the futures ticker for futures orders without any further changes.

## Finding 5 (Important) — stale docs

Files: `docs/project.md`, `ROADMAP.md`

`docs/project.md`:
- Replaced the `TradeForm.tsx` / `FuturesTradeForm.tsx` / `OrdersPanel.tsx` /
  `PaperOrdersPanel.tsx` / `FuturesInfoPanel.tsx` file-tree block with the current
  `order-form/` directory (`OrderForm.tsx`, `OrderPreview.tsx`, `config.ts`,
  `fields/`), keeping `OrdersPanel.tsx`, `PaperOrdersPanel.tsx`,
  `FuturesInfoPanel.tsx` as-is.
- Added a one-line `lib/trading/` entry to the `lib/` tree describing it as the
  server-side risk/preflight layer.
- Rewrote the §6.4 request-path diagram to show `OrderForm → preflightOrder →
  POST /api/bingx/trade/order 或 /api/bingx/futures/order → decrypt → sign →
  signedRequest → BingX` instead of the deleted `TradeForm` path.
- Rewrote §6.5 ("下单 UI 组件") to describe the single unified `OrderForm` driving
  all three markets via `config.ts`, the TP/SL-attachable-type restriction, the
  confirmed-leverage gate, the preflight layer, and explicitly noted OCO's current
  cancel/query-only state with a pointer to this fix.

`ROADMAP.md`:
- Line ~51: replaced the raw `TradeForm` mention (`mode="paper"`) with a reference to
  the unified `OrderForm` (`market="paper"`).
- Line ~52: replaced the `[TradeForm.tsx](src/components/trade/TradeForm.tsx)` dead
  link with `[OrderForm.tsx](src/components/trade/order-form/OrderForm.tsx)` and a
  note that current/futures/paper are unified and the old files no longer exist.
- Left both docs' changelog narrative and dates untouched — only the passages
  pointing at deleted files/paths were corrected, per the "don't rewrite wholesale"
  instruction.

These are `docs/`-prefixed / `*.md` files; per the finding they may already be
git-ignored by pattern but tracked — will need `git add -f` at commit time if `git
status` shows them ignored (not committed as part of this response since committing
wasn't requested in this dispatch; see note in the returned summary).

## Finding 6 — test coverage for fail-open paths

### 6a — `src/lib/trading/limits.test.ts`

Added to the `mergeLimits` describe block:
- `mergeLimits(null, user)` — global row missing, user override present — asserts
  the result equals the user config exactly.
- User override of literal `0` (`maxOrdersPerDay: 0`) against a non-null global
  value — asserts `0` wins (proving `??` treats `0` as "present", not "absent").
- User override of literal `[]` (`allowedSymbols: []`) against a non-null global
  array — asserts `[]` wins.

Added to the `checkLimits` describe block:
- Daily-limit / leverage / notional all failing simultaneously — asserts
  `DAILY_LIMIT_REACHED` wins (checked first in `checkLimits`'s implementation order,
  after the symbol check).
- Leverage / notional both failing (daily limit not configured) — asserts
  `LEVERAGE_TOO_HIGH` wins over `NOTIONAL_TOO_LARGE`.

Test count for this file went from 12 to 19.

### 6b — `src/lib/trading/preflight.test.ts`

- Added a `makeErroringSupabase()` helper mirroring the existing `makeSupabase()`
  pattern, but whose `.or()` resolves `{ data: null, error: new Error("connection
  reset") }`.
- Added `vi.mock("@sentry/nextjs", ...)` with spy-backed `captureException` /
  `captureMessage`, since `loadLimitsFor`'s error path calls
  `Sentry.captureException` and the test file previously never exercised that
  branch (no existing Sentry mock in this file).
- Exported `loadLimitsFor` is now imported directly (`preflightOrder` and
  `loadLimitsFor` both pulled from the dynamic `await import("./preflight")`) so the
  fail-open behavior can be asserted in isolation rather than through the full
  `preflightOrder` flow.
- New test: `loadLimitsFor fails open (returns unlimited) when the trading_limits
  read errors` — asserts the return value equals
  `{ maxNotionalPerOrder: null, maxOrdersPerDay: null, maxLeverage: null,
  allowedSymbols: null }` and that `sentryCaptureException` was called.

Test count for this file went from 11 to 12.

Total test count: 124 → 130 (all passing).

## Verification output

### `npm test`

```
 ✓ src/lib/trading/rate-limit.test.ts (7 tests) 6ms
 ✓ src/lib/trading/normalize.test.ts (29 tests) 6ms
 ✓ src/lib/trading/errors.test.ts (14 tests) 7ms
 ✓ src/lib/bingx/market.test.ts (4 tests) 4ms
 ✓ src/lib/trading/account-mode.test.ts (10 tests) 8ms
 ✓ src/lib/trading/limits.test.ts (19 tests) 6ms
 ✓ src/lib/trading/sizing.test.ts (26 tests) 9ms
 ✓ src/lib/trading/spec.test.ts (9 tests) 9ms
 ✓ src/lib/trading/preflight.test.ts (12 tests) 8ms

 Test Files  9 passed (9)
      Tests  130 passed (130)
```

### `npx tsc --noEmit`

No output — zero errors.

### `npm run build`

```
 ✓ Compiled successfully in 14.1s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (49/49)
   Finalizing page optimization ...
   Collecting build traces ...
```
Full route manifest printed with no errors; `/api/bingx/trade/oco-order`,
`/api/bingx/futures/order`, `/api/bingx/futures/positions` all present and built.

### i18n structural-equality check

```
keys: 712 712 712
```
No "missing in ..." lines printed — all three locale files have identical key sets
after adding `tpsl_not_supported`.

## Deviations from instructions

None. Scope was kept to exactly what each finding specified:
- OCO was disabled, not wired into `preflightOrder`.
- Exactly one new i18n key (`tpsl_not_supported`) was added across all three
  locales.
- `src/lib/bingx/signed-request.ts`, `src/lib/crypto.ts`, and
  `supabase/migrations/020_trading_limits.sql` were not touched.
- No new dependency was introduced.
- Docs were edited passage-by-passage, not rewritten wholesale.

One judgment call worth flagging explicitly (not a deviation, but worth surfacing):
Finding 4's fix added a **new hook** (`useFuturesTicker`) rather than parameterizing
`useSpotTicker`, for the reasons detailed in the Finding 4 section above (the
existing hook's WS-merge behavior is spot-only and not safely reusable for
futures without deeper changes to the WS store).
