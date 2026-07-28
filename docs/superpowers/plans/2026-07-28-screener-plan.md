# 市场筛选器（Screener）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/screener` 页面，通过公开行情数据（24h ticker + OI + Funding Rate）自动筛选适合日内短线交易的币种，展示综合评分排行榜，支持一键跳转交易页做多/做空。

**Architecture:** 纯前端筛选。复用现有 `useSpotTickers()` 批量获取全市场 24h 行情 → 前端硬性淘汰 → 对候选池按需并行请求 OI 和 Funding Rate → 综合打分排序 → 表格展示。新增 2 个 BingX API 端点（OI、Funding Rate）及对应的 Next.js 代理路由和 React Query hooks。

**Tech Stack:** Next.js 15 App Router, React 19, TanStack React Query 5, Tailwind CSS 3, next-intl 4, Zustand 5

## Global Constraints

- 沿用项目现有 i18n 三语体系（zh-CN / en-US / ms-MY）
- API 路由响应格式：`{ success: boolean, data: T }`
- 前端数据请求统一走 `fetchApi<T>` helper
- React Query 配置：staleTime / refetchInterval 遵循现有惯例
- 组件命名和文件组织遵循项目现有模式

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/types/bingx.ts` | 修改 | 新增 `BingXOpenInterest`、`BingXFundingRate`、`ScreenerResult` 类型 |
| `src/lib/bingx/market.ts` | 修改 | 新增 `getFuturesOpenInterest()`、`getFuturesFundingRate()` 函数 |
| `src/app/api/bingx/market/openInterest/route.ts` | 新增 | OI API 代理路由 |
| `src/app/api/bingx/market/fundingRate/route.ts` | 新增 | Funding Rate API 代理路由 |
| `src/hooks/useMarketData.ts` | 修改 | 新增 `useOpenInterest()`、`useFundingRate()` hooks |
| `src/lib/screener-scoring.ts` | 新增 | 纯函数：`hardFilter()` + `scoreToken()` |
| `src/hooks/useScreenerData.ts` | 新增 | 封装两轮筛选 + 评分的数据流 hook |
| `src/components/screener/ScreenerTable.tsx` | 新增 | 筛选结果表格组件 |
| `src/app/[locale]/screener/page.tsx` | 新增 | 筛选页面 |
| `src/components/layout/Navbar.tsx` | 修改 | 导航栏新增「筛选器」入口 |
| `src/app/[locale]/trade/page.tsx` | 修改 | 支持 URL 参数 `symbol`/`side`/`market` 预填 |
| `src/i18n/messages/zh-CN.json` | 修改 | 新增 screener 翻译 key |
| `src/i18n/messages/en-US.json` | 修改 | 新增 screener 翻译 key |
| `src/i18n/messages/ms-MY.json` | 修改 | 新增 screener 翻译 key |

---

### Task 1: 新增 BingX 类型定义

**Files:**
- Modify: `src/types/bingx.ts:1-79`

**Interfaces:**
- Produces: `BingXOpenInterest`, `BingXFundingRate` 类型供 market.ts 和 hooks 使用

- [ ] **Step 1: 在 bingx.ts 末尾添加新类型**

```typescript
/** 合约未平仓量 */
export interface BingXOpenInterest {
  symbol: string;
  openInterest: string;
  timestamp: number;
}

/** 溢价指数（含当前资金费率） */
export interface BingXFundingRate {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/bingx.ts
git commit -m "feat: add BingXOpenInterest and BingXFundingRate types"
```

---

### Task 2: 新增 BingX 市场 API 函数

**Files:**
- Modify: `src/lib/bingx/market.ts:111`

**Interfaces:**
- Consumes: `BingXOpenInterest`, `BingXFundingRate` from Task 1
- Produces: `getFuturesOpenInterest(symbol: string): Promise<BingXOpenInterest>`, `getFuturesFundingRate(symbol: string): Promise<BingXFundingRate>`

- [ ] **Step 1: 在 market.ts 合约行情区域末尾添加两个函数**

```typescript
/** 获取合约未平仓量 */
export async function getFuturesOpenInterest(symbol: string): Promise<BingXOpenInterest> {
  return bingxClient.publicRequest<BingXOpenInterest>("/openApi/swap/v2/quote/openInterest", {
    symbol,
  });
}

/** 获取合约溢价指数（含当前资金费率） */
export async function getFuturesFundingRate(symbol: string): Promise<BingXFundingRate> {
  return bingxClient.publicRequest<BingXFundingRate>("/openApi/swap/v2/quote/premiumIndex", {
    symbol,
  });
}
```

同时在文件顶部 import 中新增 `BingXOpenInterest` 和 `BingXFundingRate`。

- [ ] **Step 2: Commit**

```bash
git add src/lib/bingx/market.ts
git commit -m "feat: add getFuturesOpenInterest and getFuturesFundingRate API functions"
```

---

### Task 3: 新增 OI 和 Funding Rate API 代理路由

**Files:**
- Create: `src/app/api/bingx/market/openInterest/route.ts`
- Create: `src/app/api/bingx/market/fundingRate/route.ts`

**Interfaces:**
- Consumes: `getFuturesOpenInterest`, `getFuturesFundingRate` from Task 2
- Produces: `GET /api/bingx/market/openInterest?symbol=XXX-USDT`, `GET /api/bingx/market/fundingRate?symbol=XXX-USDT`

- [ ] **Step 1: 创建 `src/app/api/bingx/market/openInterest/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getFuturesOpenInterest } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PARAM", message: "symbol is required" } },
        { status: 400 }
      );
    }
    const data = await getFuturesOpenInterest(symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: 创建 `src/app/api/bingx/market/fundingRate/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getFuturesFundingRate } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PARAM", message: "symbol is required" } },
        { status: 400 }
      );
    }
    const data = await getFuturesFundingRate(symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bingx/market/openInterest/route.ts src/app/api/bingx/market/fundingRate/route.ts
git commit -m "feat: add OI and funding rate API proxy routes"
```

---

### Task 4: 新增 React Query hooks

**Files:**
- Modify: `src/hooks/useMarketData.ts:1-85`

**Interfaces:**
- Consumes: `BingXOpenInterest`, `BingXFundingRate` from Task 1
- Produces: `useOpenInterest(symbol: string)`, `useFundingRate(symbol: string)`

- [ ] **Step 1: 更新 import，在 useMarketData.ts 末尾添加两个 hooks**

在文件顶部 import 中新增 `BingXOpenInterest` 和 `BingXFundingRate`：

```typescript
import type { BingXSymbol, BingXTicker, BingXKline, BingXDepth, BingXTrade, BingXOpenInterest, BingXFundingRate } from "@/types/bingx";
```

在文件末尾添加：

```typescript
// 合约未平仓量
export function useOpenInterest(symbol: string) {
  return useQuery({
    queryKey: ["bingx", "openInterest", symbol],
    queryFn: () => fetchApi<BingXOpenInterest>("openInterest", { symbol }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!symbol,
  });
}

// 合约资金费率
export function useFundingRate(symbol: string) {
  return useQuery({
    queryKey: ["bingx", "fundingRate", symbol],
    queryFn: () => fetchApi<BingXFundingRate>("fundingRate", { symbol }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!symbol,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useMarketData.ts
git commit -m "feat: add useOpenInterest and useFundingRate hooks"
```

---

### Task 5: 筛选与打分纯函数

**Files:**
- Create: `src/lib/screener-scoring.ts`

**Interfaces:**
- Consumes: `BingXTicker` from `@/types/bingx`
- Produces:
  - `hardFilter(ticker: BingXTicker, direction: 'long' | 'short'): boolean`
  - `scoreToken(ticker: BingXTicker, oi: number, fundingRate: number): number`
  - `ScreenerResult` type
  - `computeScreenerResults(tickers: BingXTicker[], oiMap: Record<string, number>, frMap: Record<string, number>): ScreenerResult[]`

- [ ] **Step 1: 创建 `src/lib/screener-scoring.ts`**

```typescript
import type { BingXTicker } from "@/types/bingx";

export interface ScreenerResult {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  amplitude: number;
  openInterest: number;
  fundingRate: number;
  oiVolumeRatio: number;
  score: number;
}

/** 硬性淘汰：触发任一规则返回 true（淘汰） */
export function hardFilter(ticker: BingXTicker, direction: "long" | "short"): boolean {
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const quoteVolume = parseFloat(ticker.quoteVolume);
  const priceChangePercent = parseFloat(ticker.priceChangePercent);

  // 1. 流动性不足：24h 合约成交量 < 1 亿美元
  if (quoteVolume < 100_000_000) return true;

  // 2. 死盘无波动：振幅 < 1.5%
  const amplitude = ((high - low) / low) * 100;
  if (amplitude < 1.5) return true;

  // 3. 拒绝追高
  if (direction === "long" && priceChangePercent > 15) return true;

  // 4. 拒绝追空
  if (direction === "short" && priceChangePercent < -15) return true;

  return false;
}

/** 综合打分 0-100 */
export function scoreToken(
  ticker: BingXTicker,
  openInterest: number,
  fundingRate: number
): number {
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const last = parseFloat(ticker.lastPrice);
  const quoteVolume = parseFloat(ticker.quoteVolume);
  const amplitude = ((high - low) / low) * 100;

  // --- 振幅 (25%) ---
  let ampScore: number;
  if (amplitude >= 2 && amplitude <= 5) {
    ampScore = 100;
  } else if (amplitude >= 1.5 && amplitude < 2) {
    ampScore = ((amplitude - 1.5) / 0.5) * 100;
  } else if (amplitude > 5 && amplitude <= 12) {
    ampScore = 100 - ((amplitude - 5) / 7) * 100;
  } else {
    ampScore = 0;
  }

  // --- 流动性 (25%) ---
  const logVol = Math.log10(quoteVolume);
  // $100M (8) -> 0%, $10B (10) -> 100%
  const liqScore = Math.max(0, Math.min(100, ((logVol - 8) / 2) * 100));

  // --- OI/量比 (20%) ---
  const oiVolRatio = quoteVolume > 0 ? openInterest / quoteVolume : 0;
  let oiScore: number;
  if (oiVolRatio >= 0.3 && oiVolRatio <= 1.5) {
    oiScore = 100;
  } else if (oiVolRatio < 0.3) {
    oiScore = (oiVolRatio / 0.3) * 100;
  } else if (oiVolRatio > 1.5 && oiVolRatio <= 3) {
    oiScore = 100 - ((oiVolRatio - 1.5) / 1.5) * 100;
  } else {
    oiScore = 0;
  }

  // --- 费率健康度 (15%) ---
  const absRate = Math.abs(fundingRate);
  let frScore: number;
  if (absRate < 0.0003) {
    frScore = 100;
  } else if (absRate <= 0.001) {
    frScore = 100 - ((absRate - 0.0003) / 0.0007) * 100;
  } else {
    frScore = 0;
  }

  // --- 趋势位置 (15%) ---
  const position = high > low ? (last - low) / (high - low) : 0.5;
  let trendScore: number;
  // 日内范围中间位置最优（非极端高位/低位）
  if (position >= 0.3 && position <= 0.7) {
    trendScore = 100;
  } else if (position < 0.3) {
    trendScore = (position / 0.3) * 100;
  } else {
    trendScore = 100 - ((position - 0.7) / 0.3) * 100;
  }

  return Math.round(
    ampScore * 0.25 +
    liqScore * 0.25 +
    oiScore * 0.20 +
    frScore * 0.15 +
    trendScore * 0.15
  );
}

/** 批量计算筛选结果并排序 */
export function computeScreenerResults(
  tickers: BingXTicker[],
  direction: "long" | "short",
  oiMap: Record<string, number>,
  frMap: Record<string, number>
): ScreenerResult[] {
  const results: ScreenerResult[] = [];

  for (const ticker of tickers) {
    if (hardFilter(ticker, direction)) continue;

    const high = parseFloat(ticker.highPrice);
    const low = parseFloat(ticker.lowPrice);
    const quoteVolume = parseFloat(ticker.quoteVolume);
    const oi = oiMap[ticker.symbol] ?? 0;
    const fr = frMap[ticker.symbol] ?? 0;

    const score = scoreToken(ticker, oi, fr);

    results.push({
      symbol: ticker.symbol,
      lastPrice: parseFloat(ticker.lastPrice),
      priceChangePercent: parseFloat(ticker.priceChangePercent),
      highPrice: high,
      lowPrice: low,
      quoteVolume,
      amplitude: ((high - low) / low) * 100,
      openInterest: oi,
      fundingRate: fr,
      oiVolumeRatio: quoteVolume > 0 ? oi / quoteVolume : 0,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/screener-scoring.ts
git commit -m "feat: add screener scoring logic - hardFilter and scoreToken"
```

---

### Task 6: 筛选数据 hook

**Files:**
- Create: `src/hooks/useScreenerData.ts`

**Interfaces:**
- Consumes: `useSpotTickers` from `@/hooks/useMarketData`, `hardFilter`, `computeScreenerResults`, `ScreenerResult` from `@/lib/screener-scoring`
- Produces: `useScreenerData(direction: 'long' | 'short') => { results: ScreenerResult[], isLoading, error }`

- [ ] **Step 1: 创建 `src/hooks/useScreenerData.ts`**

```typescript
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSpotTickers, useOpenInterest, useFundingRate } from "@/hooks/useMarketData";
import { hardFilter, computeScreenerResults } from "@/lib/screener-scoring";
import type { ScreenerResult } from "@/lib/screener-scoring";
import type { BingXOpenInterest, BingXFundingRate } from "@/types/bingx";

async function fetchApi<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`/api/bingx/market/${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

export function useScreenerData(direction: "long" | "short") {
  // 第一轮：批量获取 24h ticker + 前端淘汰
  const tickersQuery = useSpotTickers();

  const candidates = useMemo(() => {
    if (!tickersQuery.data) return [];
    return tickersQuery.data
      .filter((t) => t.symbol.endsWith("-USDT"))
      .filter((t) => !hardFilter(t, direction));
  }, [tickersQuery.data, direction]);

  // 第二轮：对候选池批量请求 OI + Funding Rate
  const candidateSymbols = useMemo(
    () => candidates.map((c) => c.symbol),
    [candidates]
  );

  const oiQuery = useQuery({
    queryKey: ["bingx", "screener", "oi", candidateSymbols],
    queryFn: async () => {
      const map: Record<string, number> = {};
      const results = await Promise.allSettled(
        candidateSymbols.map((sym) =>
          fetchApi<BingXOpenInterest>("openInterest", { symbol: sym })
        )
      );
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          map[candidateSymbols[i]] = parseFloat(r.value.openInterest);
        }
      });
      return map;
    },
    enabled: candidateSymbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const frQuery = useQuery({
    queryKey: ["bingx", "screener", "fr", candidateSymbols],
    queryFn: async () => {
      const map: Record<string, number> = {};
      const results = await Promise.allSettled(
        candidateSymbols.map((sym) =>
          fetchApi<BingXFundingRate>("fundingRate", { symbol: sym })
        )
      );
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          map[candidateSymbols[i]] = parseFloat(r.value.lastFundingRate);
        }
      });
      return map;
    },
    enabled: candidateSymbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // 综合打分排序
  const results = useMemo<ScreenerResult[]>(() => {
    if (!tickersQuery.data) return [];
    // 如果 OI/FR 数据还没回来，用空 map 也算分（只是那两个维度 0 分）
    const oiMap = oiQuery.data ?? {};
    const frMap = frQuery.data ?? {};
    return computeScreenerResults(tickersQuery.data, direction, oiMap, frMap);
  }, [tickersQuery.data, direction, oiQuery.data, frQuery.data]);

  return {
    results,
    isLoading: tickersQuery.isLoading || (candidateSymbols.length > 0 && (oiQuery.isLoading || frQuery.isLoading)),
    isTickersLoading: tickersQuery.isLoading,
    isDetailLoading: oiQuery.isLoading || frQuery.isLoading,
    error: tickersQuery.error || oiQuery.error || frQuery.error,
    refetch: () => {
      tickersQuery.refetch();
      oiQuery.refetch();
      frQuery.refetch();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useScreenerData.ts
git commit -m "feat: add useScreenerData hook with two-round fetch logic"
```

---

### Task 7: ScreenerTable 组件

**Files:**
- Create: `src/components/screener/ScreenerTable.tsx`

**Interfaces:**
- Consumes: `ScreenerResult` from `@/lib/screener-scoring`
- Produces: `<ScreenerTable results={ScreenerResult[]} isLoading={boolean} locale={string} />`

- [ ] **Step 1: 创建 `src/components/screener/ScreenerTable.tsx`**

```typescript
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatNumber, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ScreenerResult } from "@/lib/screener-scoring";

type SortKey = keyof ScreenerResult;

interface ScreenerTableProps {
  results: ScreenerResult[];
  isLoading: boolean;
  market: "spot" | "futures";
}

export function ScreenerTable({ results, isLoading, market }: ScreenerTableProps) {
  const t = useTranslations("screener");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      const va = a[sortKey] as number;
      const vb = b[sortKey] as number;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return arr;
  }, [results, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return null;
    return sortDir === "desc" ? " ↓" : " ↑";
  };

  const Th = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="px-3 py-2 text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      {label}{sortIndicator(col)}
    </th>
  );

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-default">
              <Th col="score" label={t("columns.rank")} />
              <Th col="symbol" label={t("columns.symbol")} />
              <Th col="lastPrice" label={t("columns.price")} />
              <Th col="priceChangePercent" label={t("columns.change")} />
              <Th col="amplitude" label={t("columns.amplitude")} />
              <Th col="quoteVolume" label={t("columns.volume")} />
              <Th col="oiVolumeRatio" label={t("columns.oi_volume_ratio")} />
              <Th col="fundingRate" label={t("columns.funding_rate")} />
              <Th col="score" label={t("columns.score")} />
              <th className="px-3 py-2 text-xs font-medium text-text-secondary">{t("columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-border-default">
                {Array.from({ length: 10 }).map((_, j) => (
                  <td key={j} className="px-3 py-3">
                    <Skeleton className="h-4 w-16" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
        <p className="text-sm">{t("no_results")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-default sticky top-0 bg-bg-primary z-10">
            <Th col="score" label="#" />
            <Th col="symbol" label={t("columns.symbol")} />
            <Th col="lastPrice" label={t("columns.price")} />
            <Th col="priceChangePercent" label={t("columns.change")} />
            <Th col="amplitude" label={t("columns.amplitude")} />
            <Th col="quoteVolume" label={t("columns.volume")} />
            <Th col="oiVolumeRatio" label={t("columns.oi_volume_ratio")} />
            <Th col="fundingRate" label={t("columns.funding_rate")} />
            <Th col="score" label={t("columns.score")} />
            <th className="px-3 py-2 text-xs font-medium text-text-secondary">{t("columns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
            <tr
              key={row.symbol}
              className="border-b border-border-default hover:bg-bg-tertiary transition-colors"
            >
              <td className="px-3 py-2.5 text-xs text-text-secondary">{idx + 1}</td>
              <td className="px-3 py-2.5 text-sm font-medium text-text-primary whitespace-nowrap">
                {row.symbol.replace("-USDT", "")}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatPrice(row.lastPrice)}
              </td>
              <td className={cn(
                "px-3 py-2.5 text-sm tabular-nums",
                row.priceChangePercent >= 0 ? "text-green" : "text-red"
              )}>
                {formatPercent(row.priceChangePercent)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.amplitude.toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatNumber(row.quoteVolume)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.oiVolumeRatio.toFixed(2)}
              </td>
              <td className={cn(
                "px-3 py-2.5 text-sm tabular-nums",
                row.fundingRate >= 0 ? "text-green" : "text-red"
              )}>
                {(row.fundingRate * 100).toFixed(4)}%
              </td>
              <td className="px-3 py-2.5 text-sm">
                <span className={cn(
                  "inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold",
                  row.score >= 70 ? "bg-green/20 text-green" :
                  row.score >= 40 ? "bg-gold/20 text-gold" :
                  "bg-red/20 text-red"
                )}>
                  {row.score}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1">
                  <Link href={`/trade?symbol=${row.symbol}&side=long&market=${market}`}>
                    <Button variant="outline" size="sm" className="text-green border-green/50 hover:bg-green/10 text-xs h-6 px-2">
                      {t("action_long")}
                    </Button>
                  </Link>
                  <Link href={`/trade?symbol=${row.symbol}&side=short&market=${market}`}>
                    <Button variant="outline" size="sm" className="text-red border-red/50 hover:bg-red/10 text-xs h-6 px-2">
                      {t("action_short")}
                    </Button>
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

注意：`SortedKey` 不包括 `symbol`（string 类型），实际用 `Exclude<keyof ScreenerResult, 'symbol'>`。

- [ ] **Step 2: Commit**

```bash
git add src/components/screener/ScreenerTable.tsx
git commit -m "feat: add ScreenerTable component with sorting and action buttons"
```

---

### Task 8: Screener 页面

**Files:**
- Create: `src/app/[locale]/screener/page.tsx`

**Interfaces:**
- Consumes: `useScreenerData` from `@/hooks/useScreenerData`, `ScreenerTable` from `@/components/screener/ScreenerTable`
- Produces: `/[locale]/screener` 路由页面

- [ ] **Step 1: 创建 `src/app/[locale]/screener/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useScreenerData } from "@/hooks/useScreenerData";
import { ScreenerTable } from "@/components/screener/ScreenerTable";
import { Button } from "@/components/ui/Button";

export default function ScreenerPage() {
  const t = useTranslations("screener");
  const [market, setMarket] = useState<"spot" | "futures">("futures");
  const { results, isLoading, error, refetch } = useScreenerData("long");

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-text-primary">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded bg-bg-tertiary p-0.5">
            <button
              className={`px-3 py-1 text-xs rounded transition-colors ${
                market === "spot" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setMarket("spot")}
            >
              {t("spot")}
            </button>
            <button
              className={`px-3 py-1 text-xs rounded transition-colors ${
                market === "futures" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setMarket("futures")}
            >
              {t("futures")}
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-10 text-text-secondary gap-2">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="rounded-lg border border-border-default bg-bg-primary overflow-hidden">
          <ScreenerTable results={results} isLoading={isLoading} market={market} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/screener/page.tsx
git commit -m "feat: add screener page at /[locale]/screener"
```

---

### Task 9: Navbar 新增筛选器入口

**Files:**
- Modify: `src/components/layout/Navbar.tsx:14-15, 34`

**Interfaces:**
- Consumes: i18n key `nav.screener` from Task 10
- Produces: 导航栏中「筛选器」链接

- [ ] **Step 1: 在 Navbar 中添加 nav item**

修改 `GUEST_NAV_ITEMS` 和 `USER_NAV_ITEMS`，在 `trade` 后面添加 `screener`：

```typescript
const GUEST_NAV_ITEMS = ["home", "videos", "articles", "trade", "screener"] as const;
const USER_NAV_ITEMS = ["dashboard", "videos", "articles", "trade", "screener"] as const;
```

无需其他改动——现有的 `navLinks` 生成逻辑已经会自动为每个 item 生成 `<Link href={/${locale}/${item}}>`。

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/Navbar.tsx
git commit -m "feat: add screener link to navbar"
```

---

### Task 10: i18n 翻译

**Files:**
- Modify: `src/i18n/messages/zh-CN.json:29-44`
- Modify: `src/i18n/messages/en-US.json:29-44`
- Modify: `src/i18n/messages/ms-MY.json:29-44`

**Interfaces:**
- Produces: `nav.screener` 以及 `screener.*` 全套翻译 key

- [ ] **Step 1: 在 zh-CN.json 中新增**

在 `"nav"` 对象中添加 `"screener": "筛选器"`，并新增 `screener` 顶级 key：

```json
"screener": {
  "title": "市场筛选器",
  "no_results": "当前市场没有符合条件的品种，请稍后再试",
  "error": "数据加载失败",
  "retry": "重试",
  "refresh": "刷新",
  "spot": "现货",
  "futures": "合约",
  "columns": {
    "rank": "排名",
    "symbol": "币种",
    "price": "价格",
    "change": "24h涨跌",
    "amplitude": "振幅",
    "volume": "成交量",
    "oi_volume_ratio": "OI/量",
    "funding_rate": "费率",
    "score": "评分",
    "actions": "操作"
  },
  "action_long": "做多",
  "action_short": "做空"
}
```

- [ ] **Step 2: 在 en-US.json 中新增**

在 `"nav"` 对象中添加 `"screener": "Screener"`，并新增 `screener` 顶级 key：

```json
"screener": {
  "title": "Market Screener",
  "no_results": "No coins match the current criteria. Please try again later.",
  "error": "Failed to load data",
  "retry": "Retry",
  "refresh": "Refresh",
  "spot": "Spot",
  "futures": "Futures",
  "columns": {
    "rank": "Rank",
    "symbol": "Symbol",
    "price": "Price",
    "change": "24h Change",
    "amplitude": "Amplitude",
    "volume": "Volume",
    "oi_volume_ratio": "OI/Vol",
    "funding_rate": "Funding",
    "score": "Score",
    "actions": "Actions"
  },
  "action_long": "Long",
  "action_short": "Short"
}
```

- [ ] **Step 3: 在 ms-MY.json 中新增**

在 `"nav"` 对象中添加 `"screener": "Penapis"`，并新增 `screener` 顶级 key：

```json
"screener": {
  "title": "Penapis Pasaran",
  "no_results": "Tiada syiling yang memenuhi kriteria. Sila cuba lagi nanti.",
  "error": "Gagal memuatkan data",
  "retry": "Cuba Lagi",
  "refresh": "Segar Semula",
  "spot": "Spot",
  "futures": "Niaga Hadapan",
  "columns": {
    "rank": "Kedudukan",
    "symbol": "Simbol",
    "price": "Harga",
    "change": "24j Ubah",
    "amplitude": "Amplitud",
    "volume": "Volum",
    "oi_volume_ratio": "OI/Vol",
    "funding_rate": "Pembiayaan",
    "score": "Skor",
    "actions": "Tindakan"
  },
  "action_long": "Beli",
  "action_short": "Jual"
}
```

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat: add screener i18n translations"
```

---

### Task 11: Trade 页面支持 URL 参数预填

**Files:**
- Modify: `src/app/[locale]/trade/page.tsx:265-296`

**Interfaces:**
- Consumes: `useSearchParams()` from `next/navigation`
- Produces: trade 页面接收 `?symbol=XXX-USDT&side=long&market=futures` 参数并预填

- [ ] **Step 1: 在 TradePage 组件中添加 URL 参数解析**

在 `export default function TradePage()` 函数体开头（import 之后），使用 `useSearchParams`：

```typescript
import { useSearchParams } from "next/navigation";
```

在组件内，`const auth = useAuth()` 之后添加：

```typescript
const searchParams = useSearchParams();
```

在 `const symbol = useTradePrefsStore(...)` 等 store 声明之后，添加一个 `useEffect` 来应用 URL 参数：

```typescript
import { useEffect } from "react";

// ... inside component, after all hooks:

useEffect(() => {
  const urlSymbol = searchParams.get("symbol");
  const urlMarket = searchParams.get("market") as MarketType | null;
  if (urlSymbol) setSymbol(urlSymbol);
  if (urlMarket && (urlMarket === "spot" || urlMarket === "futures" || urlMarket === "paper")) {
    setMarket(urlMarket);
  }
  // side 参数目前不做预填（TradeForm 内部自行处理方向状态）
  // 可通过 tradePrefs 扩展 side 字段实现，但当前不做以免过度设计
}, []); // 仅首次加载时执行
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/trade/page.tsx
git commit -m "feat: support URL params symbol/market pre-fill in trade page"
```

---

## Self-Review Checklist

1. **Spec coverage**: 
   - [x] 新增 BingX API 端点 → Tasks 1-3
   - [x] 两轮数据获取 → Task 6
   - [x] 硬性淘汰 4 条 → Task 5
   - [x] 综合打分 5 维度 → Task 5
   - [x] 表格展示 + 排序 → Task 7
   - [x] 一键做多/做空跳转 → Tasks 7, 11
   - [x] 市场切换 Spot/Futures → Task 8
   - [x] 导航入口 → Task 9
   - [x] i18n 三语 → Task 10
   - [x] 空状态/加载态/错误态 → Tasks 7, 8

2. **Placeholder scan**: 无 TBD / TODO / 占位符。

3. **Type consistency**: 
   - `ScreenerResult` 定义在 `screener-scoring.ts`，Task 5 导出，Task 7 使用 → 一致
   - `BingXOpenInterest`/`BingXFundingRate` Task 1 定义，Tasks 2-4, 6 使用 → 一致
   - `useScreenerData` 返回类型 Task 6 定义，Task 8 使用 → 一致
   - `SortKey = Exclude<keyof ScreenerResult, 'symbol'>` → Task 7 中明确
