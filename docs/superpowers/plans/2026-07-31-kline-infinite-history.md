# K线无限滚动历史（Phase 2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 图表向左滚动到已加载数据的起点附近时，自动向后翻页拉取更早的K线并无缝拼接（不产生视觉跳动），直到 BingX 没有更早的数据可拉（能拿多少拿多少）。

**Architecture:** 新增一个纯函数模块（合并去重、判断是否还有更多、计算下一页的 `endTime`）和一个 `useKlineHistory` hook（最新一页用 React Query 轮询保鲜，历史页按需拉取、拉过一次就不再重拉）。`KlineChart` 把 `useKlines` 换成 `useKlineHistory`，监听图表可视区间变化触发翻页，并在 `setData` 之后把可视区间平移相应的新增K线数，避免用户视角跳动。合约K线接口目前不支持 `startTime`/`endTime`，需要先补上（原设计文档误以为已经支持，这里在读代码时发现并纠正）。

**Tech Stack:** TanStack Query v5、lightweight-charts（`subscribeVisibleLogicalRangeChange`/`setVisibleLogicalRange`）、Vitest。

## Global Constraints

- 分页方向：只向后（更早）翻页，不涉及"未来"数据
- 页大小：`300` 根K线每页（比现状的 200 更大，减少翻页次数，仍在 BingX 单次请求上限内）
- 终止条件：某次翻页请求返回的数量为 0，或小于请求的 `limit`，即视为"没有更早的数据了"，停止继续翻页——不需要预先知道交易对的上市时间
- `endTime` 语义：BingX 的 `endTime` 是闭区间（包含该时间点的K线），因此下一页请求要用"当前已加载最早一根K线的 `openTime` − 1ms"作为新 `endTime`，避免重复拉到边界那一根
- 最新一页继续保持轮询保鲜（10秒，与现状一致）；历史页一旦拉到就不再自动重拉，因为已收盘的K线不会再变
- 现货与合约两条K线接口都要支持 `startTime`/`endTime` 透传——现状只有现货支持，本计划要先把合约那边补齐
- 本阶段不改变K线图表的其它任何行为（指标、画线、TP/SL价格线、实时价格驱动当前K线）——只新增"向左滚动自动加载更早数据"这一件事
- K线接口是公开行情数据，不需要登录/API Key，因此本计划的验证可以走真实的 dev server + 真实 BingX 请求，不受"沙箱无凭证"限制

---

## File Structure

```
src/lib/bingx/
  market.ts                 修改：getFuturesKlines 补上 startTime/endTime 参数
  market.test.ts            修改：新增 getSpotKlines/getFuturesKlines 参数透传的测试

src/app/api/bingx/market/klines/
  route.ts                  修改：解析并透传 startTime/endTime 查询参数

src/lib/chart/
  kline-history.ts          新增：合并去重 / 判断是否还有更多 / 计算下一页 endTime 的纯函数
  kline-history.test.ts     新增

src/hooks/
  useKlineHistory.ts        新增：最新页轮询 + 历史页按需翻页的组合 hook

src/components/trade/
  KlineChart.tsx             修改：接入 useKlineHistory，监听滚动触发翻页，setData 后平移可视区间
```

---

### Task 1: 合约K线接口补齐 startTime/endTime + 路由透传

**Files:**
- Modify: `src/lib/bingx/market.ts`（`getFuturesKlines` 函数，紧邻 `getSpotKlines` 之后）
- Modify: `src/lib/bingx/market.test.ts`
- Modify: `src/app/api/bingx/market/klines/route.ts`

**Interfaces:**
- Consumes: 无新依赖
- Produces：
  - `getFuturesKlines(symbol: string, interval?: string, limit?: number, startTime?: number, endTime?: number): Promise<BingXKline[]>`（新增两个可选参数，签名其余部分不变）
  - 路由 `GET /api/bingx/market/klines` 新支持可选查询参数 `startTime`、`endTime`（毫秒时间戳），透传给现货/合约两条底层函数

供 Task 3 的 `useKlineHistory` 通过 HTTP 调用这条路由时使用。

- [ ] **Step 1: 写失败测试**

在 `src/lib/bingx/market.test.ts` 顶部的 `await import("./market")` 那一行加上新导入：

```typescript
const { getSpotTicker, getSpotKlines, getFuturesKlines } = await import("./market");
```

在文件末尾追加：

```typescript
describe("getSpotKlines", () => {
  it("passes startTime/endTime through to the public request when provided", async () => {
    publicRequest.mockResolvedValue([]);
    await getSpotKlines("BTC-USDT", "1h", 300, 1000, 2000);
    expect(publicRequest).toHaveBeenCalledWith(
      "/openApi/spot/v1/market/kline",
      { symbol: "BTC-USDT", interval: "1h", limit: 300, startTime: 1000, endTime: 2000 }
    );
  });

  it("maps raw kline rows into BingXKline objects", async () => {
    publicRequest.mockResolvedValue([
      [1700000000000, "63000", "63500", "62800", "63200", "12.5", 1700003599999, "789000", 42],
    ]);
    const klines = await getSpotKlines("BTC-USDT");
    expect(klines).toEqual([{
      openTime: 1700000000000,
      open: 63000,
      high: 63500,
      low: 62800,
      close: 63200,
      volume: 12.5,
      closeTime: 1700003599999,
      quoteVolume: 789000,
      trades: 42,
    }]);
  });
});

describe("getFuturesKlines", () => {
  it("passes startTime/endTime through to the public request when provided", async () => {
    publicRequest.mockResolvedValue([]);
    await getFuturesKlines("BTC-USDT", "1h", 300, 1000, 2000);
    expect(publicRequest).toHaveBeenCalledWith(
      "/openApi/swap/v3/quote/klines",
      { symbol: "BTC-USDT", interval: "1h", limit: 300, startTime: 1000, endTime: 2000 }
    );
  });

  it("omits startTime/endTime from the params object when not provided", async () => {
    publicRequest.mockResolvedValue([]);
    await getFuturesKlines("BTC-USDT", "1h", 100);
    expect(publicRequest).toHaveBeenCalledWith(
      "/openApi/swap/v3/quote/klines",
      { symbol: "BTC-USDT", interval: "1h", limit: 100, startTime: undefined, endTime: undefined }
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/bingx/market.test.ts`
Expected: `getFuturesKlines` 相关用例 FAIL（当前函数只接受 3 个参数，多传的 `startTime`/`endTime` 会被忽略，断言的调用参数对不上）

- [ ] **Step 3: 修改 `getFuturesKlines`**

在 `src/lib/bingx/market.ts` 中，把：

```typescript
/** 获取合约K线 */
export async function getFuturesKlines(
  symbol: string,
  interval = "1h",
  limit = 100
): Promise<BingXKline[]> {
  const rows = await bingxClient.publicRequest<BingXKlineRow[]>(
    "/openApi/swap/v3/quote/klines",
    { symbol, interval, limit }
  );
```

改成：

```typescript
/** 获取合约K线 */
export async function getFuturesKlines(
  symbol: string,
  interval = "1h",
  limit = 100,
  startTime?: number,
  endTime?: number
): Promise<BingXKline[]> {
  const rows = await bingxClient.publicRequest<BingXKlineRow[]>(
    "/openApi/swap/v3/quote/klines",
    { symbol, interval, limit, startTime, endTime }
  );
```

函数体其余部分（`rows.map(...)` 那一段）不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/bingx/market.test.ts`
Expected: PASS（全部用例，含新增的 4 个）

- [ ] **Step 5: 路由透传 startTime/endTime**

把 `src/app/api/bingx/market/klines/route.ts` 整个文件内容替换为：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSpotKlines, getFuturesKlines } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const interval = searchParams.get("interval") || "1h";
    const limit = parseInt(searchParams.get("limit") || "100");
    const market = searchParams.get("market") || "spot";
    const startTimeParam = searchParams.get("startTime");
    const endTimeParam = searchParams.get("endTime");
    const startTime = startTimeParam ? parseInt(startTimeParam) : undefined;
    const endTime = endTimeParam ? parseInt(endTimeParam) : undefined;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "symbol is required" } },
        { status: 400 }
      );
    }

    if (market === "futures") {
      const data = await getFuturesKlines(symbol, interval, limit, startTime, endTime);
      return NextResponse.json({ success: true, data });
    }

    const data = await getSpotKlines(symbol, interval, limit, startTime, endTime);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 手动验证路由（公开接口，不需要登录）**

启动 dev server（`npm run dev`），访问：

```
http://localhost:3000/api/bingx/market/klines?symbol=BTC-USDT&interval=1h&limit=5
```

Expected: 返回最近 5 根K线的 JSON。再访问一次，这次带上 `endTime`（用上一次返回结果里最早一根的 `openTime` 减 1）：

```
http://localhost:3000/api/bingx/market/klines?symbol=BTC-USDT&interval=1h&limit=5&endTime=<openTime-1>
```

Expected: 返回更早的 5 根K线，且和第一次的结果不重叠。用 `market=futures` 再重复一遍同样的两次请求，确认合约那条路径现在也支持 `endTime`。

- [ ] **Step 8: Commit**

```bash
git add src/lib/bingx/market.ts src/lib/bingx/market.test.ts src/app/api/bingx/market/klines/route.ts
git commit -m "feat(chart): add startTime/endTime pagination to futures klines and the klines route"
```

---

### Task 2: 分页纯函数（合并去重 / 是否还有更多 / 下一页 endTime）

**Files:**
- Create: `src/lib/chart/kline-history.ts`
- Test: `src/lib/chart/kline-history.test.ts`

**Interfaces:**
- Consumes: `BingXKline` type from `@/types/bingx`
- Produces：
  - `mergeOlderKlines(a: BingXKline[], b: BingXKline[]): BingXKline[]`
  - `determineHasMore(receivedCount: number, requestedLimit: number): boolean`
  - `computeNextEndTime(earliestOpenTimeMs: number): number`

供 Task 3 的 `useKlineHistory` 使用。

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/chart/kline-history.test.ts
import { describe, it, expect } from "vitest";
import { mergeOlderKlines, determineHasMore, computeNextEndTime } from "./kline-history";
import type { BingXKline } from "@/types/bingx";

function kline(openTime: number): BingXKline {
  return {
    openTime,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    closeTime: openTime + 999,
    quoteVolume: 15,
  };
}

describe("mergeOlderKlines", () => {
  it("combines two non-overlapping batches into ascending openTime order", () => {
    const older = [kline(1000), kline(2000)];
    const existing = [kline(3000), kline(4000)];
    expect(mergeOlderKlines(older, existing).map((k) => k.openTime)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("de-duplicates a shared boundary candle instead of keeping two entries for the same openTime", () => {
    const older = [kline(1000), kline(2000), kline(3000)];
    const existing = [kline(3000), kline(4000)];
    const merged = mergeOlderKlines(older, existing);
    expect(merged.map((k) => k.openTime)).toEqual([1000, 2000, 3000, 4000]);
    expect(merged).toHaveLength(4);
  });

  it("works regardless of input order (unsorted inputs still come out ascending)", () => {
    const older = [kline(2000), kline(1000)];
    const existing = [kline(4000), kline(3000)];
    expect(mergeOlderKlines(older, existing).map((k) => k.openTime)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(mergeOlderKlines([], [])).toEqual([]);
  });
});

describe("determineHasMore", () => {
  it("is true when a full page was returned", () => {
    expect(determineHasMore(300, 300)).toBe(true);
  });

  it("is false when fewer rows than requested came back (history exhausted)", () => {
    expect(determineHasMore(47, 300)).toBe(false);
  });

  it("is false when nothing came back", () => {
    expect(determineHasMore(0, 300)).toBe(false);
  });
});

describe("computeNextEndTime", () => {
  it("is one millisecond before the earliest loaded candle", () => {
    expect(computeNextEndTime(1700000000000)).toBe(1699999999999);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/chart/kline-history.test.ts`
Expected: FAIL（`Cannot find module './kline-history'`）

- [ ] **Step 3: 写实现**

```typescript
// src/lib/chart/kline-history.ts
import type { BingXKline } from "@/types/bingx";

/**
 * 合并两批K线为一个按 openTime 升序、去重后的数组。既用于"把翻页拉到的更早
 * 一批拼到已加载数据前面"，也用于"把累积的历史页和最新页轮询结果合并成给图
 * 表用的完整数组"——两种场景本质是同一个操作：两批可能有重叠的数据合成一批。
 */
export function mergeOlderKlines(a: BingXKline[], b: BingXKline[]): BingXKline[] {
  const byOpenTime = new Map<number, BingXKline>();
  for (const k of a) byOpenTime.set(k.openTime, k);
  for (const k of b) byOpenTime.set(k.openTime, k);
  return Array.from(byOpenTime.values()).sort((x, y) => x.openTime - y.openTime);
}

/**
 * BingX 的K线接口单次最多返回 `limit` 根。翻页请求如果返回数量少于请求的
 * limit（含 0），说明再往前已经没有数据了——这是唯一可用的信号，两个接口都
 * 不会告诉你某个交易对的上市时间。
 */
export function determineHasMore(receivedCount: number, requestedLimit: number): boolean {
  return receivedCount > 0 && receivedCount >= requestedLimit;
}

/**
 * 下一页翻页请求要用的 endTime：当前已加载最早一根K线的 openTime 往前推
 * 1 毫秒，避免因为 BingX 的 endTime 是闭区间而重复拉到边界那一根。
 */
export function computeNextEndTime(earliestOpenTimeMs: number): number {
  return earliestOpenTimeMs - 1;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/chart/kline-history.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart/kline-history.ts src/lib/chart/kline-history.test.ts
git commit -m "feat(chart): add pure helpers for kline backward-pagination"
```

---

### Task 3: `useKlineHistory` hook

**Files:**
- Create: `src/hooks/useKlineHistory.ts`

**Interfaces:**
- Consumes: `mergeOlderKlines`/`determineHasMore`/`computeNextEndTime` from `@/lib/chart/kline-history`（Task 2）；`GET /api/bingx/market/klines`（Task 1，含 `startTime`/`endTime` 支持）；`BingXKline` type from `@/types/bingx`
- Produces: `useKlineHistory(symbol: string, interval: string, market?: string): { candles: BingXKline[] | null; isLoading: boolean; isLoadingMore: boolean; hasMore: boolean; loadMore: () => void }` — 供 Task 4 的 `KlineChart` 使用，替代原来的 `useKlines`

这个 hook 本身不写单测——本仓库所有类似的数据获取 hook（`useKlines`、`useTradingAccount.ts` 里的每一个）都没有单测（`src/hooks/**` 不在 Vitest 的 `include` 范围内），可测的核心逻辑已经拆到 Task 2 的纯函数并测过了。

- [ ] **Step 1: 写实现**

```typescript
// src/hooks/useKlineHistory.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BingXKline } from "@/types/bingx";
import { mergeOlderKlines, determineHasMore, computeNextEndTime } from "@/lib/chart/kline-history";

const PAGE_SIZE = 300;

interface UseKlineHistoryResult {
  /** null 直到最新一页首次加载完成 */
  candles: BingXKline[] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

async function fetchKlinesPage(
  symbol: string,
  interval: string,
  market: string,
  endTime?: number
): Promise<BingXKline[]> {
  const url = new URL("/api/bingx/market/klines", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("market", market);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (endTime !== undefined) url.searchParams.set("endTime", String(endTime));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data as BingXKline[];
}

function earliestOpenTime(klines: BingXKline[]): number | undefined {
  if (!klines.length) return undefined;
  return klines.reduce((min, k) => Math.min(min, k.openTime), klines[0].openTime);
}

/**
 * 给图表加载K线，支持向后翻页：`loadMore()` 拉取更早一页并拼接到已加载数据
 * 前面。最新一页继续用 React Query 轮询保鲜（当前/刚收盘的K线会变）；历史页
 * 只拉一次、不自动重拉（已收盘的K线不会再变）。
 */
export function useKlineHistory(symbol: string, interval: string, market = "spot"): UseKlineHistoryResult {
  const latestQuery = useQuery({
    queryKey: ["bingx", "klines-latest", market, symbol, interval],
    queryFn: () => fetchKlinesPage(symbol, interval, market),
    refetchInterval: 10_000,
    staleTime: 5_000,
    enabled: !!symbol,
  });

  const [olderCandles, setOlderCandles] = useState<BingXKline[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // 同步的重入保护 / 陈旧请求丢弃——state 更新是异步的，不能只靠 state 判断
  const isLoadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const requestIdRef = useRef(0);

  // symbol/interval/market 换了 = 换了一条完全不同的序列，累积的历史清空，
  // 交给最新一页的查询重新播种
  useEffect(() => {
    requestIdRef.current++;
    setOlderCandles([]);
    setHasMore(true);
    hasMoreRef.current = true;
    setIsLoadingMore(false);
    isLoadingMoreRef.current = false;
  }, [symbol, interval, market]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMoreRef.current) return;
    const earliest = earliestOpenTime(olderCandles.length ? olderCandles : latestQuery.data ?? []);
    if (earliest === undefined) return;

    const myRequestId = ++requestIdRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    fetchKlinesPage(symbol, interval, market, computeNextEndTime(earliest))
      .then((page) => {
        if (myRequestId !== requestIdRef.current) return; // 期间 symbol/interval 变了，丢弃
        const more = determineHasMore(page.length, PAGE_SIZE);
        hasMoreRef.current = more;
        setHasMore(more);
        setOlderCandles((prev) => mergeOlderKlines(page, prev));
      })
      .catch(() => {
        if (myRequestId !== requestIdRef.current) return;
        // 拉取失败就不再重试——避免对一个持续失败的请求反复轰炸；用户已加载
        // 的部分仍然可见
        hasMoreRef.current = false;
        setHasMore(false);
      })
      .finally(() => {
        if (myRequestId === requestIdRef.current) {
          isLoadingMoreRef.current = false;
          setIsLoadingMore(false);
        }
      });
  }, [olderCandles, latestQuery.data, symbol, interval, market]);

  const candles = latestQuery.data ? mergeOlderKlines(olderCandles, latestQuery.data) : null;

  return { candles, isLoading: latestQuery.isLoading, isLoadingMore, hasMore, loadMore };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useKlineHistory.ts
git commit -m "feat(chart): add useKlineHistory hook with backward pagination"
```

---

### Task 4: 接入 `KlineChart` —— 滚动触发翻页 + 无跳动拼接

**Files:**
- Modify: `src/components/trade/KlineChart.tsx`

**Interfaces:**
- Consumes: `useKlineHistory` from `@/hooks/useKlineHistory`（Task 3）

只做这一件事：把数据源从 `useKlines` 换成 `useKlineHistory`，加上滚动触发翻页和无跳动拼接。图表的其它行为（指标、画线、TP/SL、实时价格驱动当前K线）不动。

- [ ] **Step 1: 换数据源 import**

把：

```typescript
import { useKlines } from "@/hooks/useMarketData";
```

改成：

```typescript
import { useKlineHistory } from "@/hooks/useKlineHistory";
```

- [ ] **Step 2: lightweight-charts 的类型导入里加上 `LogicalRange`**

把顶部的：

```typescript
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
```

改成（只加了一行 `type LogicalRange,`）：

```typescript
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
  type LogicalRange,
} from "lightweight-charts";
```

- [ ] **Step 3: 换取数调用**

把：

```typescript
  const { data: klines, isLoading } = useKlines(symbol, interval);
```

改成：

```typescript
  const { candles: klines, isLoading, isLoadingMore, hasMore, loadMore } = useKlineHistory(symbol, interval);
```

- [ ] **Step 4: 新增翻页相关的 ref**

在 `const isFirstDataRef = useRef(true);` 这一行之后加上：

```typescript
  const isFirstDataRef = useRef(true);
  // 翻页拼接用的簿记：让"candles 数据更新"那个 effect 能分清"更早一页拼接
  // 进来了"和"换了新symbol/新一轮最新页轮询"，只在前者才需要平移可视区间
  const prevEarliestTimeRef = useRef<UTCTimestamp | null>(null);
  const prevBarCountRef = useRef(0);
  // 最新值 ref：让滚动触发翻页的订阅不用每次渲染都重新订阅（loadMore 的
  // identity 会随着 olderCandles 增长而变化）——和下面的 appliedRef 是同一个模式
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const loadMoreRef = useRef(loadMore);
  hasMoreRef.current = hasMore;
  isLoadingMoreRef.current = isLoadingMore;
  loadMoreRef.current = loadMore;
```

（原来紧接着的 `const markersPluginRef = ...` 等其它 ref 声明保持原位不变，只是在它们之前插入了上面这段。）

- [ ] **Step 5: 重置 effect 里补上新 ref 的重置**

把：

```typescript
  // ---- Reset when symbol/interval changes ----
  useEffect(() => {
    isFirstDataRef.current = true;
    lastCandleRef.current = null;
  }, [symbol, interval]);
```

改成：

```typescript
  // ---- Reset when symbol/interval changes ----
  useEffect(() => {
    isFirstDataRef.current = true;
    lastCandleRef.current = null;
    prevEarliestTimeRef.current = null;
    prevBarCountRef.current = 0;
  }, [symbol, interval]);
```

- [ ] **Step 6: 在"K线数据更新"的 effect 里加上无跳动拼接逻辑**

找到这个 effect（"---- Candles + all indicator data ----"），把：

```typescript
  useEffect(() => {
    if (!chartApi || !candleSeries || !bars) return;
    const { times, input } = bars;

    const candleData: CandlestickData[] = times.map((time, i) => ({
      time,
      open: input.open[i],
      high: input.high[i],
      low: input.low[i],
      close: input.close[i],
    }));
    candleSeries.setData(candleData);

    for (const a of applied) {
```

改成：

```typescript
  useEffect(() => {
    if (!chartApi || !candleSeries || !bars) return;
    const { times, input } = bars;

    // 判断这次数据更新是不是"翻页拼接了更早一批"（而不是换了新 symbol，
    // 也不是最新页轮询刷新了同一批起点）：新数组的第一根K线比之前记录的
    // 起点更早。是的话，先记下当前可视区间，setData 之后要把它平移回去，
    // 不然用户视角会因为坐标系起点变了而看起来"跳了一下"。
    const isPrepend =
      !isFirstDataRef.current &&
      prevEarliestTimeRef.current !== null &&
      times.length > 0 &&
      times[0] < prevEarliestTimeRef.current;
    const savedRange = isPrepend ? chartApi.timeScale().getVisibleLogicalRange() : null;

    const candleData: CandlestickData[] = times.map((time, i) => ({
      time,
      open: input.open[i],
      high: input.high[i],
      low: input.low[i],
      close: input.close[i],
    }));
    candleSeries.setData(candleData);

    if (savedRange) {
      const addedBars = times.length - prevBarCountRef.current;
      try {
        chartApi.timeScale().setVisibleLogicalRange({
          from: savedRange.from + addedBars,
          to: savedRange.to + addedBars,
        });
      } catch { /* 图表还没准备好接受手动设置区间时忽略 */ }
    }
    prevEarliestTimeRef.current = times[0] ?? null;
    prevBarCountRef.current = times.length;

    for (const a of applied) {
```

这个 effect 后面的部分（指标数据、`lastCandleRef` 更新、`isFirstDataRef` 首次 `fitContent`）保持不变。

- [ ] **Step 7: 新增"滚动到左边缘触发翻页"的 effect**

在"---- Price lines ----"那个 effect 之后（`return (` JSX 之前）插入一个新 effect：

```typescript
  // ---- 滚动到已加载数据的左边缘附近时，加载更早一页 ----
  useEffect(() => {
    if (!chartApi) return;
    const timeScale = chartApi.timeScale();

    function handleRangeChange(range: LogicalRange | null) {
      if (!range) return;
      // 距离已加载最早一根还有 20 根左右时就开始拉，用户实际滚到头之前
      // 数据已经补上了
      if (range.from < 20 && hasMoreRef.current && !isLoadingMoreRef.current) {
        loadMoreRef.current();
      }
    }

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  }, [chartApi]);
```

- [ ] **Step 8: 加一个轻量的"加载历史中"提示**

在渲染部分，找到：

```typescript
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/60">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          </div>
        )}
```

在它后面（同一层级）加上：

```typescript
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/60">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          </div>
        )}

        {!isLoading && isLoadingMore && (
          <div className="absolute left-1/2 top-2 z-[7] -translate-x-1/2 rounded-xs border border-border-default bg-bg-secondary/90 px-2 py-0.5 text-[11px] text-text-muted backdrop-blur-sm">
            加载历史K线…
          </div>
        )}
```

（和首次加载的全屏遮罩不同，这个提示不挡住图表，翻页期间用户仍然能继续操作图表。）

- [ ] **Step 9: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 10: 手动验证（公开行情数据，不需要登录）**

启动 dev server，打开 `/trade`（默认现货 BTC-USDT），打开浏览器 DevTools → Network，筛选 `klines`：

1. 页面首次加载应该看到一条不带 `endTime` 的请求，返回最近 300 根K线
2. 用鼠标在图表上向右拖动（把最早的K线拖到视野里，即向左滚动图表）
3. 快滚到已加载数据最左边时，应该自动再发一条带 `endTime` 参数的请求
4. 新数据到达后，图表上出现更早的K线，但**当前正在看的那部分K线的相对位置不应该跳动**——用户拖动到哪儿，松手后继续待在同一段时间范围附近
5. 一直往左滚动、反复触发翻页，直到某次请求返回的K线数量少于 300（或返回空），确认之后再滚动不会再发新请求（说明 `hasMore` 正确变成了 `false`，"加载历史K线…" 提示也不再出现）
6. 切换到合约市场（如果账号有 Pro 权限），对合约K线重复步骤 2-5，确认合约这条路径的翻页也正常工作
7. 确认已有功能没有回归：切换K线周期、打开一个技术指标（如 MA）、图表上的绘图工具，都应该照常工作

- [ ] **Step 11: Commit**

```bash
git add src/components/trade/KlineChart.tsx
git commit -m "feat(chart): wire KlineChart to infinite-scroll kline history"
```
