# 感知性能优化 · 阶段 3：交易页顺滑 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** K 线图消除 10 秒周期卡顿与价格线闪烁；切换交易对平滑过渡；桌面首帧不再闪手机布局、图表只初始化一次；交易页面板按需加载。

**Architecture:** 核心洞察——每 10 秒的卡顿主要来自"全量 `setData` 强制全部 series 重绘"，而指标的纯计算是 O(n) 算术、对 1500 根仅毫秒级。因此增量方案为：**计算照跑、渲染只 update 尾部**（而非逐指标改造"追加计算"——那需要给每个指标实现有状态追加模式，风险高收益同）。这是对 spec §3 改动 2 的实现级修正，spec 自身已允许该退化路径。

**Tech Stack:** lightweight-charts v5（series.update / createPriceLine / setMarkers）、React Query v5（isPlaceholderData）、next/dynamic。

**Spec:** docs/superpowers/specs/2026-08-07-perceived-performance-design.md 第 3 节。阶段 1/2 已合并（路由组结构 + 全局 keepPreviousData + 交易关键 hook 已豁免）。

## Global Constraints

- 所有功能与交互逻辑保持不变（指标、画线工具、翻页加载历史、实时价 rAF 路径、Pro 权限门控全部照旧）。
- 交易关键数据（余额/杠杆/持仓/挂单/规格）已豁免 keepPreviousData，本阶段不得回退这些豁免。
- 行情展示类（K 线/盘口/成交）按 spec 用"旧数据 + 降透明度"过渡，isPlaceholderData 是判定信号。
- 每个 Task 独立 commit，信息末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；每 Task 完成时 `npx tsc --noEmit` + `npm run test` 全绿。
- 新增纯逻辑必须带 vitest 单测（spec §5：增量判定、签名 diff 是"算错会展示错误数据"的地方）。

## 背景知识（实施者必读）

1. `src/components/trade/KlineChart.tsx` 的"Candles + all indicator data" effect（约 L396-505）目前每次 `bars` 变化（10 秒轮询产生新数组）都全量 `candleSeries.setData` + 每个指标 `def.compute` 全序列 + 每个 plot `setData`。翻 5 页历史后是 1500+ 根 × (1 + 指标 plot 数) 次全量重绘。
2. `useKlineHistory`（src/hooks/useKlineHistory.ts）的 latestQuery 受全局 keepPreviousData 影响：切换 symbol 瞬间 `latestQuery.data` 是旧 symbol 的数据（`isPlaceholderData: true`），渲染期 reset 已保证不会新旧拼接，但旧 symbol 的整条 K 线会短暂显示在新 symbol 名下——阶段 2 遗留、本阶段用降透明度语义收编。
3. 价格线 effect（约 L605-630）每次 `priceLines` prop 引用变化（useChartOverlay 5 秒轮询产生新数组）都全部 removePriceLine 再 createPriceLine——内容没变也闪一次。markers effect（约 L581-602）同理每 5 秒 setMarkers。
4. `useMediaQuery`（src/hooks/useMediaQuery.ts）SSR 阶段返回 false，水合后翻转——桌面用户首帧渲染手机版全屏图表，然后整树卸载重挂（KlineChart 初始化两次）。文件注释已解释为何不能 CSS 双挂载（副作用组件会跑两份）。
5. `PaperOrdersPanel`（src/components/trade/PaperOrdersPanel.tsx L109-160）手写 fetch + setInterval(5s) + visibility 开关轮询 /api/paper/limit-orders——迁 React Query 后这些手工逻辑全部免费获得。
6. 交易页 `src/app/[locale]/(app)/trade/page.tsx` 静态导入全部面板组件（约 L12、L32-36）；KlineChart 本身已是 next/dynamic。

## File Structure（改动全景）

```
src/lib/chart/incremental.ts                       [新建] 增量判定纯函数 + 签名构建
src/lib/chart/incremental.test.ts                  [新建] 单测
src/components/trade/KlineChart.tsx                [修改] 增量渲染路径 + 线/标记签名跳过 + placeholder 遮罩
src/hooks/useKlineHistory.ts                       [修改] 暴露 isPlaceholder
src/components/trade/OrderBook.tsx                 [修改] placeholder 降透明度
src/components/trade/RecentTrades.tsx              [修改] 同上（如该组件存在同构 isLoading 骨架）
src/hooks/useMediaQuery.ts                         [修改] lazy 初始化
src/hooks/useHydrated.ts                           [新建] 水合完成信号
src/app/[locale]/(app)/trade/page.tsx              [修改] 水合门控 + 面板 next/dynamic
src/components/trade/PaperOrdersPanel.tsx          [修改] 轮询迁 React Query
（下单成功路径所在文件，实施时定位）              [修改] 补 orders 两个 key 的 invalidate
```

---

### Task 1: 增量判定纯函数 + KlineChart 增量渲染

**Files:**
- Create: `src/lib/chart/incremental.ts`
- Create: `src/lib/chart/incremental.test.ts`
- Modify: `src/components/trade/KlineChart.tsx`

**Interfaces:**
- Produces: `classifyBarsUpdate(prev: { earliest: number | null; count: number }, times: number[]): "full" | "tick" | "append"` —— `"tick"` = 同一根尾蜡烛在变（earliest 相同、数量相同）；`"append"` = 恰好多了一根（收线，earliest 相同、count+1）；其余一律 `"full"`（首载、换 symbol、prepend 翻页、数据修剪等）。
- KlineChart 对外 props 不变。

- [ ] **Step 1: 写失败测试**

`src/lib/chart/incremental.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { classifyBarsUpdate, overlaySignature } from "./incremental";

describe("classifyBarsUpdate", () => {
  const prev = { earliest: 100, count: 3 };
  it("first load is full", () => {
    expect(classifyBarsUpdate({ earliest: null, count: 0 }, [100, 200, 300])).toBe("full");
  });
  it("same earliest same count is tick", () => {
    expect(classifyBarsUpdate(prev, [100, 200, 300])).toBe("tick");
  });
  it("same earliest count+1 is append", () => {
    expect(classifyBarsUpdate(prev, [100, 200, 300, 400])).toBe("append");
  });
  it("earlier first bar (prepend) is full", () => {
    expect(classifyBarsUpdate(prev, [50, 100, 200, 300])).toBe("full");
  });
  it("different earliest (symbol switch) is full", () => {
    expect(classifyBarsUpdate(prev, [900, 1000, 1100])).toBe("full");
  });
  it("count shrank is full", () => {
    expect(classifyBarsUpdate(prev, [100, 200])).toBe("full");
  });
  it("count grew by more than 1 is full", () => {
    expect(classifyBarsUpdate(prev, [100, 200, 300, 400, 500])).toBe("full");
  });
  it("empty times is full", () => {
    expect(classifyBarsUpdate(prev, [])).toBe("full");
  });
});

describe("overlaySignature", () => {
  it("is stable for same content in same order", () => {
    const a = overlaySignature([{ price: 1, color: "#f00", dashed: true, title: "TP" }]);
    const b = overlaySignature([{ price: 1, color: "#f00", dashed: true, title: "TP" }]);
    expect(a).toBe(b);
  });
  it("changes when any field changes", () => {
    const base = [{ price: 1, color: "#f00", dashed: true, title: "TP" }];
    expect(overlaySignature(base)).not.toBe(
      overlaySignature([{ ...base[0], price: 2 }])
    );
  });
  it("empty array has its own signature", () => {
    expect(overlaySignature([])).toBe("[]");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/chart/incremental.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 incremental.ts**

```ts
/** Pure helpers for KlineChart's incremental render path. */

export interface PrevBarsMeta {
  earliest: number | null;
  count: number;
}

export type BarsUpdateKind = "full" | "tick" | "append";

/**
 * Decide how the chart should apply a new bars array.
 * "tick": the same tail candle changed (poll refresh) — update() only.
 * "append": exactly one candle closed — update() the last two points.
 * "full": anything else (first load, symbol switch, prepend, trim) — setData().
 */
export function classifyBarsUpdate(prev: PrevBarsMeta, times: number[]): BarsUpdateKind {
  if (!times.length || prev.earliest === null || prev.count === 0) return "full";
  if (times[0] !== prev.earliest) return "full";
  if (times.length === prev.count) return "tick";
  if (times.length === prev.count + 1) return "append";
  return "full";
}

/** Content signature for price lines / markers — skip chart writes when unchanged. */
export function overlaySignature(items: ReadonlyArray<Record<string, unknown>>): string {
  return JSON.stringify(items);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/chart/incremental.test.ts`
Expected: PASS 全部。

- [ ] **Step 5: KlineChart 接入增量路径**

改造"Candles + all indicator data" effect（保持依赖数组不变）：

1. 新增 refs（组件顶部，与现有 refs 放一起）：

```ts
// 上一次走全量路径时的结构身份——三者任一变化都必须回到全量 setData
const lastAppliedRef = useRef<typeof applied | null>(null);
const lastAdvancedRef = useRef<boolean | null>(null);
```

2. effect 开头计算更新类型（在现有 `isPrepend` 判定之前）：

```ts
const kind =
  applied !== lastAppliedRef.current || hasAdvancedChart !== lastAdvancedRef.current
    ? "full"
    : classifyBarsUpdate(
        { earliest: prevEarliestTimeRef.current, count: prevBarCountRef.current },
        times as unknown as number[]
      );
```

（`isFirstDataRef.current` 为 true 时 `prevEarliestTimeRef` 已被 symbol/interval reset effect 置 null，classify 自然返回 "full"，无需额外分支。）

3. `kind === "tick" | "append"` 走增量分支后 **提前 return**，不执行现有全量代码：

```ts
if (kind === "tick" || kind === "append") {
  const lastIdx = times.length - 1;
  // 收线时前一根的最终值也要落盘（轮询返回的收盘价可能与 rAF 实时价有微差）
  const idxs = kind === "append" ? [lastIdx - 1, lastIdx] : [lastIdx];
  for (const i of idxs) {
    if (i < 0) continue;
    candleSeries.update({
      time: times[i],
      open: input.open[i],
      high: input.high[i],
      low: input.low[i],
      close: input.close[i],
    });
  }

  for (const a of applied) {
    const def = INDICATOR_BY_ID.get(a.defId);
    const entries = seriesMapRef.current.get(a.instanceId);
    if (!def || !entries) continue;
    let out: Record<string, (number | null)[]>;
    try { out = def.compute(input, a.params); } catch { continue; }
    for (const e of entries) {
      const plot = def.plots.find((p) => p.key === e.plotKey);
      const values = out[e.plotKey];
      if (!plot || !values) continue;
      const resolvedStyle = resolvePlotStyle(def, a.styleOverrides, e.plotKey);
      for (const i of idxs) {
        const v = values[i];
        // series.update() 不能"删点"：尾值为 null（如指标窗口未满）就跳过，
        // 该点本来也不存在于序列里，行为与全量路径一致。
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        if (plot.kind === "histogram") {
          e.series.update({
            time: times[i],
            value: v,
            color: plot.barColor ? plot.barColor({ i, value: v, input }) : resolvedStyle.color,
          });
        } else {
          e.series.update({ time: times[i], value: v });
        }
      }
    }
  }

  // 与全量路径同样维护尾蜡烛 ref 与 meta
  lastCandleRef.current = {
    time: times[lastIdx],
    open: input.open[lastIdx],
    high: input.high[lastIdx],
    low: input.low[lastIdx],
    close: input.close[lastIdx],
    volume: input.volume[lastIdx],
  };
  prevEarliestTimeRef.current = times[0] ?? null;
  prevBarCountRef.current = times.length;
  return;
}
```

4. 全量路径末尾（`isFirstDataRef` 判定处附近）记录结构身份：

```ts
lastAppliedRef.current = applied;
lastAdvancedRef.current = hasAdvancedChart;
```

5. 图表卸载 cleanup（create chart once effect 的 return）里补 `lastAppliedRef.current = null; lastAdvancedRef.current = null;`。

要点：增量分支里 `def.compute` 仍是全序列计算（O(n) 算术，毫秒级）——省掉的是 `setData` 引发的全 series 重绘，这才是卡顿源。param 编辑/显隐切换会改变 `applied` 引用 → 自动回全量路径，行为不变。

- [ ] **Step 6: 全量验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿（含新增测试）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/chart/incremental.ts src/lib/chart/incremental.test.ts src/components/trade/KlineChart.tsx
git commit -m "perf(chart): incremental tail updates on poll — kill the 10s full-redraw jank"
```

---

### Task 2: 价格线与标记按内容签名跳过重建

**Files:**
- Modify: `src/components/trade/KlineChart.tsx`

**Interfaces:**
- Consumes: Task 1 的 `overlaySignature`。
- Produces: 对外无变化；行为约定——持仓/挂单没变时价格线与标记零写入，变了才重建（消除 5 秒闪烁）。

- [ ] **Step 1: 价格线 effect 加签名短路**

在价格线 effect（`priceLines, candleSeries` 依赖）开头：

```ts
const renderable = (priceLines ?? []).filter(
  (pl) => !pl.editable && isFinite(pl.price) && pl.price > 0
);
const sig = overlaySignature(
  renderable.map((pl) => ({ p: pl.price, c: pl.color, d: pl.dashed, t: pl.title }))
);
if (sig === priceLinesSigRef.current) return;
priceLinesSigRef.current = sig;
```

新增 `const priceLinesSigRef = useRef<string | null>(null);`；后续 remove/create 循环改为遍历 `renderable`（过滤逻辑已上移）。candleSeries 变化（重建图表）时需强制重画：在 create-chart effect 的 cleanup 里把 `priceLinesSigRef.current = null`。

- [ ] **Step 2: markers effect 加签名短路**

同理：构建完 `markers` 数组后：

```ts
const sig = overlaySignature(markers as unknown as Record<string, unknown>[]);
if (sig === markersSigRef.current) return;
markersSigRef.current = sig;
markersPluginRef.current.setMarkers(markers);
```

新增 `markersSigRef`，cleanup 时置 null。（interval 在 marker 的 bucket 计算里，已隐含在内容里，无需单独进签名。）

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/components/trade/KlineChart.tsx
git commit -m "perf(chart): skip price-line/marker rebuilds when content unchanged — no more 5s flicker"
```

---

### Task 3: 切换交易对的视觉连续性（placeholder 语义）

**Files:**
- Modify: `src/hooks/useKlineHistory.ts`
- Modify: `src/components/trade/KlineChart.tsx`
- Modify: `src/components/trade/OrderBook.tsx`
- Modify: `src/components/trade/RecentTrades.tsx`（若该文件不存在或无 isLoading 骨架，报告里说明并跳过）

**Interfaces:**
- `useKlineHistory` 返回值新增 `isPlaceholder: boolean`（= latestQuery.isPlaceholderData）；其余字段不变。
- `KlineChart` 新增可选 prop `isPlaceholder?: boolean`；调用方（trade/page.tsx 里的 ChartPanel/相应位置）透传。

- [ ] **Step 1: useKlineHistory 暴露 isPlaceholder**

`UseKlineHistoryResult` 加 `isPlaceholder: boolean`；返回 `isPlaceholder: latestQuery.isPlaceholderData`。

- [ ] **Step 2: KlineChart 处理 placeholder**

1. props 加 `isPlaceholder?: boolean`。
2. **fitContent 延迟到真实数据**：全量路径里 `if (isFirstDataRef.current)` 改为 `if (isFirstDataRef.current && !isPlaceholder)`——否则换 symbol 时会对旧数据 fitContent 一次、真实数据到达后视野却停在旧范围。effect 依赖数组补 `isPlaceholder`。
3. 降透明度遮罩（放在 isLoading 遮罩旁边）：

```tsx
{!isLoading && isPlaceholder && (
  <div className="pointer-events-none absolute inset-0 z-[6] bg-bg-primary/40" />
)}
```

4. 调用方透传：trade 页里渲染 `<KlineChart>` 处，从 `useKlineHistory` 解构 `isPlaceholder` 并传入（找到现有 candles/isLoading 的传递点照样接线）。

- [ ] **Step 3: 盘口/成交降透明度**

OrderBook.tsx：`const { data, isLoading, isPlaceholderData } = useOrderBook(symbol, 8);`（该 hook 返回 useQuery 结果对象，字段天然存在；若 hook 做了收窄封装则先在 hook 里透出）。内容根元素类名加 `cn(isPlaceholderData && "opacity-60 transition-opacity")`。RecentTrades 同构处理。

- [ ] **Step 4: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/hooks/useKlineHistory.ts src/components/trade/KlineChart.tsx src/components/trade/OrderBook.tsx src/components/trade/RecentTrades.tsx
git commit -m "feat(trade): dimmed old data during symbol switch instead of skeleton collapse"
```

---

### Task 4: 桌面首帧——水合门控，图表只建一次

**Files:**
- Create: `src/hooks/useHydrated.ts`
- Modify: `src/hooks/useMediaQuery.ts`
- Modify: `src/app/[locale]/(app)/trade/page.tsx`

**Interfaces:**
- Produces: `useHydrated(): boolean` —— SSR 与水合首帧返回 false，之后恒 true。
- `useMediaQuery` 签名不变；行为变化：客户端首次渲染即返回真实断点（lazy 初始化），不再"false→翻转"。

- [ ] **Step 1: useHydrated.ts**

```ts
"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * False during SSR and the hydration render, true afterwards.
 * Lets a page whose desktop/mobile trees differ structurally render a
 * neutral skeleton for the (single) hydration frame, then mount the
 * correct tree once — instead of hydrating the mobile tree on desktop
 * and remounting everything (chart included) after the breakpoint flips.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
```

- [ ] **Step 2: useMediaQuery lazy 初始化**

`useState(false)` 改为：

```ts
const [matches, setMatches] = useState(() =>
  typeof window !== "undefined" ? window.matchMedia(query).matches : false
);
```

effect 保留（订阅 change；`setMatches(mql.matches)` 一行可留可去，留着无害）。更新文件头注释：SSR 仍返回 false，但客户端首次渲染即为真实值；**消费方若在水合首帧就用它分叉结构，必须配合 useHydrated 门控**（否则水合不一致）。

- [ ] **Step 3: trade 页水合门控**

`trade/page.tsx` 的页面组件里（`isDesktop` 分叉之前）：

```tsx
const hydrated = useHydrated();
...
if (!hydrated) {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-2 p-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="min-h-0 flex-1" />
      <Skeleton className="h-40 w-full lg:h-56" />
    </div>
  );
}
```

（骨架与 `(app)/trade/loading.tsx` 同形，视觉上是"路由骨架→同形骨架→正确布局"，无跳变。）`Skeleton` 需 import。之后 `isDesktop` 首值即正确，两棵树只挂载正确的一棵，KlineChart 只初始化一次。

- [ ] **Step 4: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。人工（无需登录）：dev server 桌面宽度打开 /zh-CN/trade，观察不再出现"手机布局一闪→桌面布局"（骨架直接到桌面 4 栏）。

```bash
git add src/hooks/useHydrated.ts src/hooks/useMediaQuery.ts "src/app/[locale]/(app)/trade/page.tsx"
git commit -m "fix(trade): hydration-gated breakpoint — desktop first frame correct, chart mounts once"
```

---

### Task 5: 交易页面板 next/dynamic 按需加载

**Files:**
- Modify: `src/app/[locale]/(app)/trade/page.tsx`

**Interfaces:** 对外无变化。约定：KlineChart 已是 dynamic，保持；新转 dynamic 的组件 loading 占位用 `<Skeleton className="h-full w-full" />` 或区块同形骨架。

- [ ] **Step 1: 转换静态导入**

把 `MarketOverview`、`OrderForm`、`OrdersPanel`、`PaperOrdersPanel`、`FuturesInfoPanel`、`FuturesWalletSummary`、`OrderBook` 的静态 import 改为：

```tsx
const OrderForm = dynamic(() => import("@/components/trade/order-form/OrderForm").then((m) => m.OrderForm), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});
```

（每个组件对应其实际导出名与路径——先读文件顶部现有 import 逐一对应；named export 用 `.then((m) => m.X)`。）保持组件在 JSX 中的用法不变。若某组件被同文件的类型引用（如 props 类型），用 `import type` 保留类型导入。

- [ ] **Step 2: 验证 bundle 收益 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿；`npm run build` → 对比 `/[locale]/trade` 的 First Load JS（此前 ~326kB），报告记录前后数值；三个静态页仍为 ●。

```bash
git add "src/app/[locale]/(app)/trade/page.tsx"
git commit -m "perf(trade): lazy-load trade panels — smaller first-screen bundle per market/breakpoint"
```

---

### Task 6: PaperOrdersPanel 迁 React Query + 下单后 invalidate

**Files:**
- Modify: `src/components/trade/PaperOrdersPanel.tsx`
- Modify: 下单成功路径所在文件（实施时用 grep 定位：现货/合约/模拟下单的 mutation 或提交函数成功回调）

**Interfaces:** 对外无变化。

- [ ] **Step 1: 轮询迁移**

删除 `limitOrders`/`limitLoading` state、`fetchLimitOrders`、整个 setInterval+visibility effect（L109-160 区域），换成：

```ts
const limitOrdersQuery = useQuery({
  queryKey: ["paper", "limit-orders"],
  queryFn: async () => {
    const res = await fetch("/api/paper/limit-orders");
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message ?? "failed");
    return (json.data as PaperLimitOrderRow[]) ?? [];
  },
  refetchInterval: 5_000,
  // 交易数据：不展示旧 key 数据（静态 key 下是防御性 no-op，与 useTradingAccount 纪律一致）
  placeholderData: undefined,
});
const limitOrders = limitOrdersQuery.data ?? [];
const limitLoading = limitOrdersQuery.isPending;
```

React Query 默认 `refetchIntervalInBackground: false`，后台标签页自动停轮询——原手写 visibility 逻辑整段删除。组件内改单/撤单成功后调 `queryClient.invalidateQueries({ queryKey: ["paper", "limit-orders"] })` 替代原先的手动 `fetchLimitOrders()` 调用点。

- [ ] **Step 2: 下单成功补 invalidate（阶段 2 遗留项收口）**

grep 定位真实/模拟下单提交成功的代码路径（`/api/bingx/*/order`、`/api/paper/order` 的调用方），在成功分支加：

```ts
queryClient.invalidateQueries({ queryKey: ["orders", "history"] });
queryClient.invalidateQueries({ queryKey: ["dashboard", "orders"] });
```

（两个 key 分别是 /orders 页与 dashboard 账本区的订单查询——下单后 15 秒内两处就能一致，消除"一处更新一处没更新"的矛盾窗口。）若提交路径没有 queryClient 可用，则在其所在组件/hook 引入 `useQueryClient`。

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/components/trade/PaperOrdersPanel.tsx <下单路径文件>
git commit -m "perf(paper): limit-orders polling via React Query; invalidate order lists after trade"
```

---

### Task 7: 阶段验证

- [ ] **Step 1:** `npm run build` —— 编译成功、三个静态页 ●、`/[locale]/trade` First Load JS 较基线下降（记录数值）。
- [ ] **Step 2:** `npm run test` —— 全绿（含 incremental 新测试）。
- [ ] **Step 3:** 留给用户验收的清单（写进报告）：① 图表挂 2-3 个指标、往左翻 5 页历史后静置观察 1 分钟——不再每 10 秒卡顿；② 有持仓/挂单时观察价格线 10 秒——不再周期性闪烁；③ 快速切换交易对——图表/盘口显示降透明度的旧数据平滑过渡，无骨架塌陷，且新交易对图上无旧交易对残留价格线；④ 桌面硬刷新 /trade——直接骨架到桌面布局，无手机布局闪现；⑤ 模拟盘挂单面板切后台标签页轮询自动停；⑥ 下单后 /orders 与 dashboard 订单区 15 秒内一致。

---

## 明确不做（记录）

- 指标的有状态追加计算（per-indicator append mode）——本计划用"计算照跑、渲染只 update 尾部"达成同一目标，风险更低；若未来单指标计算本身成为瓶颈再议。
- videos/[id] 同实例切换的旧数据展示（阶段 2 已加写侧 guard，展示侧当前无触发路径）——永久搁置，除非新增相关视频链接。
- 盘口/成交 WebSocket 化——spec 既定二期项。

完成后进入阶段 4 计划（API 提速：本地 JWT 校验、密钥缓存、SWR 缓存、watcher 降载、admin 中间件收敛、optimizePackageImports）。
