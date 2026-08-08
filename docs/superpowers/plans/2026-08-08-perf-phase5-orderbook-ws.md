# 感知性能优化 · 阶段 5（收尾）：订单簿 WebSocket 化 + 遗留项收口

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 订单簿从 2 秒 REST 轮询升级为 WebSocket 推送（实测约 1.15 次/秒），跳变变平滑；同时收掉前四阶段留下的三个遗留项。

**Architecture:** 扩展既有的单例 `BingXWebSocketManager`，把"按 symbol 引用计数"泛化为"按频道（`SYMBOL@ticker` / `SYMBOL@depth20`）引用计数"；深度快照写入 market store；`useOrderBook` 优先读 WS、断线或无数据时自动回落 REST 轮询——对外接口与消费组件零改动。

**Tech Stack:** BingX 现货 WebSocket（`wss://open-api-ws.bingx.com/market`）、zustand、React Query v5、vitest。

## 实测事实（本计划的依据，勿凭文档改写）

以下全部来自对生产 WS/REST 端点的真实探测，与 ccxt 及官方文档均有出入之处以此为准：

1. **订阅消息在现货端点有效**：`{id, reqType:"sub", dataType:"BTC-USDT@depth20"}` 返回 `{"code":0,"msg":"SUCCESS"}`。（ccxt 源码声称现货不发订阅消息——与本项目现状及实测均不符，不采信。）
2. **`@depth20@500ms` 间隔后缀被拒绝**：返回 `{"code":100400,"msg":"dataType is error: BTC-USDT@depth20@500ms"}`。**只能用 `SYMBOL@depth20`**。
3. **推送频率**（20 秒实测）：`depth20` 23 条（≈1.15/s）、`trade` 39 条（≈2/s）、`ticker` 现有实现已在用。
4. **深度载荷**：`{"asks":[[price,qty],...20],"bids":[[price,qty],...20],"lastUpdateId":N}`，**asks 降序（最优/最低价在末尾）、bids 降序（最优/最高价在开头）**。
5. **REST 排序与 WS 完全一致**（asks 降序、bids 降序），但 REST 按 `limit=N` 只回 N 档最优档位；WS 恒回 20 档。
6. **`useRecentTrades` 零消费方**：成交列表 UI 不存在（`RecentTrades.tsx` 无此文件）。故"成交 WS 化"无对象，本计划不做；该 hook 与 `/api/bingx/market/trades` 是否删除留给用户决定。

## Global Constraints

- 订单簿是交易关键展示数据：**WS 断线或数据缺失必须自动回落 REST**，绝不静默展示陈旧盘口。
- 消费组件 `OrderBook.tsx` 零改动——`useOrderBook` 返回值必须保持 `{ data, isLoading, isPlaceholderData }` 三字段语义。
- 沿用现有技术栈，不引入新依赖；不改动任何认证逻辑。
- 每 Task 独立 commit（末尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）；每 Task `npx tsc --noEmit` + `npm run test` 全绿；新增纯逻辑必须带 vitest 测试。

## 背景知识（实施者必读）

1. `src/hooks/useBingXWebSocket.ts` 的 `BingXWebSocketManager` 现在按 symbol 引用计数、硬编码订阅 `${symbol}@ticker`（`subMsg`），消息处理只认 `endsWith("@ticker")`。
2. `src/stores/market.ts` 只有 `tickers` / `wsConnected`；`tickers` **只增不删**——这正是遗留项③（`hasTicks` 门控永久为真）的根因。
3. `src/components/trade/OrderBook.tsx:29-30` 做 `asks.slice(0, 8).reverse()` / `bids.slice(0, 8)`——**这套切片假设输入恰好是 N 档**。WS 的 20 档必须在适配层裁剪成"最优 N 档、保持 REST 排序"，否则会取到最差的 8 档卖单（严重错误显示）。
4. 阶段 2/3 已建立的纪律：交易关键查询 `placeholderData: undefined`；OrderBook 已有 `isPlaceholderData` 降透明度过渡（REST 分支保留该行为）。
5. `src/hooks/useKlineHistory.ts` + `src/lib/chart/kline-history.ts` 的 `mergeOlderKlines` 是遗留项①的战场。
6. `src/components/auth/AuthProvider.tsx` 的 SIGNED_OUT 分支是遗留项②的落点；AuthProvider 位于 QueryProvider 之内，可直接 `useQueryClient()`。

## File Structure（改动全景）

```
src/lib/bingx/depth.ts                    [新建] 深度裁剪纯函数
src/lib/bingx/depth.test.ts               [新建] 单测
src/stores/market.ts                      [修改] depths 切片 + removeTicker
src/hooks/useBingXWebSocket.ts            [修改] 频道化订阅 + depth 处理 + 退订清理
src/hooks/useMarketData.ts                [修改] useOrderBook 走 WS 优先 + REST 回落
src/components/alerts/PaperTpSlWatcher.tsx [修改] 遗留项③收尾核对
src/lib/chart/kline-history.ts + test     [修改] 遗留项①：滑窗空洞
src/hooks/useKlineHistory.ts              [修改] 遗留项①接线
src/components/auth/AuthProvider.tsx      [修改] 遗留项②：登出清缓存
```

---

### Task 1: 深度裁剪纯函数（TDD）

**Files:**
- Create: `src/lib/bingx/depth.ts`、`src/lib/bingx/depth.test.ts`

**Interfaces:**
- Produces: `trimDepth(book: BingXDepth, limit: number): BingXDepth`——把 WS 的 20 档裁成与 REST `limit=N` 完全同形的 N 档：**asks 取末尾 N 条（最优 N 档，保持降序）、bids 取开头 N 条**。档位不足 N 时原样返回。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { trimDepth } from "./depth";

// 实测的真实排序：asks 降序（最优/最低价在末尾）、bids 降序（最优/最高价在开头）
const book = {
  asks: [["105", "1"], ["104", "1"], ["103", "1"], ["102", "1"], ["101", "1"]] as [string, string][],
  bids: [["100", "1"], ["99", "1"], ["98", "1"], ["97", "1"], ["96", "1"]] as [string, string][],
};

describe("trimDepth", () => {
  it("keeps the BEST asks (tail) — not the worst (head)", () => {
    expect(trimDepth(book, 2).asks).toEqual([["102", "1"], ["101", "1"]]);
  });
  it("keeps the best bids (head)", () => {
    expect(trimDepth(book, 2).bids).toEqual([["100", "1"], ["99", "1"]]);
  });
  it("preserves REST ordering convention (asks descending, best last)", () => {
    const t = trimDepth(book, 3);
    expect(Number(t.asks[0][0])).toBeGreaterThan(Number(t.asks[t.asks.length - 1][0]));
    expect(Number(t.bids[0][0])).toBeGreaterThan(Number(t.bids[t.bids.length - 1][0]));
  });
  it("best ask stays above best bid after trimming", () => {
    const t = trimDepth(book, 2);
    expect(Number(t.asks[t.asks.length - 1][0])).toBeGreaterThan(Number(t.bids[0][0]));
  });
  it("returns as-is when fewer levels than limit", () => {
    expect(trimDepth(book, 99)).toEqual(book);
  });
  it("handles empty book", () => {
    expect(trimDepth({ asks: [], bids: [] }, 5)).toEqual({ asks: [], bids: [] });
  });
  it("limit 0 yields empty sides", () => {
    expect(trimDepth(book, 0)).toEqual({ asks: [], bids: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/bingx/depth.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
import type { BingXDepth } from "@/types/bingx";

/**
 * WS 的 `@depth20` 恒回 20 档，而 REST 的 `limit=N` 只回 N 档最优档位；
 * OrderBook 组件的 slice(0, N) 切片假设输入恰好是 N 档。
 *
 * 实测排序（生产端点，REST 与 WS 一致）：
 *   asks 降序——最优（最低）卖价在**末尾**
 *   bids 降序——最优（最高）买价在**开头**
 * 因此"最优 N 档"= asks 取末尾 N 条 + bids 取开头 N 条。
 * 若照搬 bids 的取法对 asks 做 slice(0, N)，会得到最差的 N 档卖单。
 */
export function trimDepth(book: BingXDepth, limit: number): BingXDepth {
  if (limit <= 0) return { asks: [], bids: [] };
  const asks = book.asks.length > limit ? book.asks.slice(book.asks.length - limit) : book.asks;
  const bids = book.bids.length > limit ? book.bids.slice(0, limit) : book.bids;
  return { asks, bids };
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `npx vitest run src/lib/bingx/depth.test.ts` → PASS；`npx tsc --noEmit && npm run test` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/lib/bingx/depth.ts src/lib/bingx/depth.test.ts
git commit -m "feat(depth): trimDepth — WS 20-level book to REST-shaped best-N levels"
```

---

### Task 2: store 支持 depths + ticker 清理

**Files:**
- Modify: `src/stores/market.ts`

**Interfaces:**
- Produces（新增，其余不变）：
  - state `depths: Record<string, { book: BingXDepth; at: number }>`
  - `setDepth(symbol: string, book: BingXDepth): void`
  - `removeTicker(symbol: string): void`——退订时清理，修复 `hasTicks` 永久为真（遗留项③）
  - `removeDepth(symbol: string): void`

- [ ] **Step 1: 扩展 store**

在既有 `MarketState` 上增加（保持既有字段与方法签名不变）：

```ts
import type { BingXTicker, BingXDepth } from "@/types/bingx";

interface MarketState {
  // …既有字段…
  /** symbol → 最新盘口快照（WebSocket 推送） */
  depths: Record<string, { book: BingXDepth; at: number }>;
  setDepth: (symbol: string, book: BingXDepth) => void;
  /** 退订时清理——tickers/depths 只增不删会让"是否有行情"类判断永久为真 */
  removeTicker: (symbol: string) => void;
  removeDepth: (symbol: string) => void;
}
```

实现（沿用既有不可变更新风格）：

```ts
  depths: {},

  setDepth: (symbol, book) =>
    set((state) => ({ depths: { ...state.depths, [symbol]: { book, at: Date.now() } } })),

  removeTicker: (symbol) =>
    set((state) => {
      if (!(symbol in state.tickers)) return state; // 无变化时返回同一引用，避免多余重渲染
      const next = { ...state.tickers };
      delete next[symbol];
      return { tickers: next };
    }),

  removeDepth: (symbol) =>
    set((state) => {
      if (!(symbol in state.depths)) return state;
      const next = { ...state.depths };
      delete next[symbol];
      return { depths: next };
    }),
```

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/stores/market.ts
git commit -m "feat(store): depth snapshots + ticker/depth cleanup on unsubscribe"
```

---

### Task 3: WebSocket 管理器频道化 + 深度订阅

**Files:**
- Modify: `src/hooks/useBingXWebSocket.ts`

**Interfaces:**
- Produces:
  - `useBingXWebSocket(symbols: string[])`——签名与行为不变（内部改走频道化）。
  - `useBingXDepth(symbol: string | null)`——新增：订阅 `SYMBOL@depth20`，数据进 store；传 null/空串则不订阅。
- 约定：退订最后一个引用时，除发送 unsub 外还要清理 store 里对应的 ticker/depth。

- [ ] **Step 1: 管理器改为按频道引用计数**

1. `subMsg(reqType, dataType)` 改为直接收完整 dataType 字符串（调用方传 `${symbol}@ticker` 或 `${symbol}@depth20`）。
2. `refCounts` 的 key 从 symbol 改为完整 dataType；`subscribe(dataTypes: string[])` 接收频道数组。
3. `onopen` 重订阅遍历 `refCounts.keys()`（已是 dataType）——逻辑不变。
4. 退订清理：在发送 unsub 的同一循环里，按 dataType 后缀决定清理哪个 store 分片：

```ts
for (const dt of removed) {
  if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(subMsg("unsub", dt));
  const at = dt.lastIndexOf("@");
  if (at < 0) continue;
  const sym = dt.slice(0, at);
  const chan = dt.slice(at + 1);
  // 退订后不再有数据流入，留着会让"是否有行情"判断永久为真、并展示陈旧盘口
  if (chan === "ticker") useMarketStore.getState().removeTicker(sym);
  else if (chan.startsWith("depth")) useMarketStore.getState().removeDepth(sym);
}
```

5. 消息分发：原先 `if (!dataType.endsWith("@ticker")) return;` 改为按频道分派——`@ticker` 走既有 `mapTicker` 路径；`@depth20` 走新增分支：

```ts
if (dt.endsWith(DEPTH_CHANNEL_SUFFIX)) {
  const sym = dt.slice(0, dt.length - DEPTH_CHANNEL_SUFFIX.length - 1);
  const d = msg.data as { asks?: [string, string][]; bids?: [string, string][] } | undefined;
  if (!sym || !d?.asks || !d?.bids) return;
  useMarketStore.getState().setDepth(sym, { asks: d.asks, bids: d.bids });
  return;
}
```

顶部定义 `const DEPTH_CHANNEL = "depth20"; const DEPTH_CHANNEL_SUFFIX = "@" + DEPTH_CHANNEL;`，并加注释说明**实测 `@depth20@500ms` 会被服务端拒绝（code 100400），不要加间隔后缀**。

6. `useBingXWebSocket(symbols)` 内部改为 `manager.subscribe(symbols.map((s) => s + "@ticker"))`，对外签名与去重逻辑（sorted key）不变。

- [ ] **Step 2: 新增 useBingXDepth**

```ts
/** 订阅单个交易对的盘口推送；数据进 useMarketStore.depths。 */
export function useBingXDepth(symbol: string | null) {
  useEffect(() => {
    if (!manager || !symbol) return;
    return manager.subscribe([`${symbol}${DEPTH_CHANNEL_SUFFIX}`]);
  }, [symbol]);
}
```

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。人工（无需登录）：dev server 打开交易页，控制台无 WS 报错、Network→WS 帧里能看到 depth 推送。

```bash
git add src/hooks/useBingXWebSocket.ts
git commit -m "feat(ws): channel-based ref counting + depth20 subscription + unsubscribe cleanup"
```

---

### Task 4: useOrderBook 走 WS 优先、REST 回落

**Files:**
- Modify: `src/hooks/useMarketData.ts`

**Interfaces:**
- `useOrderBook(symbol: string, limit = 10)` 返回值收窄为稳定三字段 `{ data: BingXDepth | undefined; isLoading: boolean; isPlaceholderData: boolean }`——`OrderBook.tsx` 正是只用这三个，零改动。

- [ ] **Step 1: 改写 useOrderBook**

```ts
// WS 的 depth20 只能服务 limit ≤ 20；更深的请求继续走 REST。
const WS_DEPTH_LEVELS = 20;

export function useOrderBook(symbol: string, limit = 10) {
  const canUseWs = !!symbol && limit <= WS_DEPTH_LEVELS;
  useBingXDepth(canUseWs ? symbol : null);

  const wsConnected = useMarketStore((s) => s.wsConnected);
  const wsEntry = useMarketStore((s) => s.depths[symbol]);
  // 盘口是交易关键展示数据：只在"连接正常且确有本交易对快照"时才用 WS，
  // 断线/切币尚无数据时立刻回落 REST 轮询，绝不静默展示陈旧盘口。
  const useWs = canUseWs && wsConnected && !!wsEntry;

  const query = useQuery({
    queryKey: ["bingx", "depth", symbol, limit],
    queryFn: () => fetchApi<BingXDepth>("depth", { symbol, limit: String(limit) }),
    refetchInterval: useWs ? false : 2_000,
    staleTime: 1_000,
    enabled: !!symbol && !useWs,
  });

  const wsBook = useMemo(
    () => (wsEntry ? trimDepth(wsEntry.book, limit) : undefined),
    [wsEntry, limit]
  );

  if (useWs && wsBook) {
    return { data: wsBook, isLoading: false, isPlaceholderData: false };
  }
  return {
    data: query.data,
    isLoading: query.isPending,
    isPlaceholderData: query.isPlaceholderData,
  };
}
```

需要的 imports：`useMemo`、`useMarketStore`、`useBingXDepth`、`trimDepth`。
要点：`enabled: !useWs` 让 WS 生效期间 REST 查询彻底停摆（省掉 2 秒轮询）；WS 一断 `wsConnected` 翻 false → 重渲染 → REST 立即接管。

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿；`npm run build` 编译通过。

```bash
git add src/hooks/useMarketData.ts
git commit -m "perf(orderbook): live WebSocket book with automatic REST fallback"
```

---

### Task 5: 遗留项②——登出清空查询缓存

**Files:**
- Modify: `src/components/auth/AuthProvider.tsx`

- [ ] **Step 1: SIGNED_OUT 时 clear**

AuthProvider 位于 QueryProvider 之内，直接 `const queryClient = useQueryClient();`（import 自 `@tanstack/react-query`）。在 `onAuthStateChange` 的 `SIGNED_OUT` 分支里，`setAuth(登出态)` 之后加：

```ts
// 账户类缓存（模拟盘/交易/成就等）若不清，换号后会短暂串到下一个用户；
// 极端时序下 PaperTpSlWatcher 可能基于上一个账号的仓位缓存触发平仓。
queryClient.clear();
```

`queryClient` 加入该 effect 的依赖数组（其引用在 QueryProvider 生命周期内稳定，不会造成重复订阅）。

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/components/auth/AuthProvider.tsx
git commit -m "fix(auth): clear query cache on sign-out so account data never bleeds across users"
```

---

### Task 6: 遗留项①——K 线翻页滑窗空洞（TDD）

**Files:**
- Modify: `src/lib/chart/kline-history.ts`、`src/lib/chart/kline-history.test.ts`、`src/hooks/useKlineHistory.ts`

**背景**：`olderCandles` 覆盖 `[E-300, E-1]`，latest 页是 300 根滑动窗口。每收线一根，latest 窗口前移，被挤出的那根既不在 older 也不在新窗口 → 合并数组出现空洞，且 series 与 data 逐渐失同步（翻页→多次收线→再翻页时视野恢复偏移）。

- [ ] **Step 1: 写失败测试**

在 `kline-history.test.ts` 增加：

```ts
it("keeps candles that slid out of the latest window (no hole)", () => {
  const k = (t: number) => ({ openTime: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  const older = [k(1), k(2), k(3)];
  const latestBefore = [k(4), k(5), k(6)];
  const merged1 = mergeOlderKlines(older, latestBefore);
  expect(merged1.map((c) => c.openTime)).toEqual([1, 2, 3, 4, 5, 6]);

  // 窗口前移一根：k(4) 滑出 latest，若不保留就会出现空洞
  const latestAfter = [k(5), k(6), k(7)];
  const merged2 = mergeOlderKlines(merged1, latestAfter);
  expect(merged2.map((c) => c.openTime)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

it("latest page wins on overlapping timestamps (closed candle final values)", () => {
  const a = { openTime: 10, open: 1, high: 1, low: 1, close: 1, volume: 1 };
  const b = { openTime: 10, open: 9, high: 9, low: 9, close: 9, volume: 9 };
  const merged = mergeOlderKlines([a], [b]);
  expect(merged).toHaveLength(1);
  expect(merged[0].close).toBe(9);
});
```

- [ ] **Step 2: 跑测试确认失败** → `npx vitest run src/lib/chart/kline-history.test.ts`

- [ ] **Step 3: 实现**

修改 `mergeOlderKlines`，使其成为"按 openTime 去重的全量并集、latest 覆盖 older、按时间升序"，而不是简单前置拼接：先把 older 放进 Map（key = openTime），再用 latest 覆盖同 key 项，最后按 openTime 升序输出。既有测试的语义（latest 优先、去重、升序）保持不变。

- [ ] **Step 4: 接线**

`useKlineHistory.ts` 的 `candles` useMemo 已经是 `mergeOlderKlines(olderCandles, latestQuery.data)`——只要合并函数变成全量并集即可自动生效；但需确认：`olderCandles` 只在 `loadMore` 成功时更新，滑出的蜡烛来自上一次的 `candles`。因此把滑出的蜡烛并回 `olderCandles`：在 `latestQuery.data` 变化的 effect（或 `candles` useMemo 之外的一个 effect）里，把"上一轮 candles 中早于新 latest 首根、且不在 olderCandles 里"的蜡烛并入 `olderCandles`。**实施时以最小改动达成测试为准**：若 Step 3 的并集语义配合"`candles` 自身作为下次合并的 older 输入"即可闭合，则不需要额外 effect——实施者按实际代码结构选择，并在报告中说明所选方案与理由。

- [ ] **Step 5: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿（含新测试）。

```bash
git add src/lib/chart/kline-history.ts src/lib/chart/kline-history.test.ts src/hooks/useKlineHistory.ts
git commit -m "fix(chart): keep candles sliding out of the latest window — no merge hole after paging"
```

---

### Task 7: 遗留项③收尾 + 阶段验证

**Files:**
- Modify: `src/components/alerts/PaperTpSlWatcher.tsx`（仅在需要时）

- [ ] **Step 1: 核对 hasTicks 门控现已可靠**

Task 2/3 已让 ticker 在退订时从 store 移除，`hasTicks` 因此能真正回落 false。核对 `PaperTpSlWatcher` 的 `hasTicks` selector 无需改动即可正确工作；若发现仍有锁存路径（例如某处订阅从不退订），按实际情况修正并在报告说明。

- [ ] **Step 2: 全量验证**

Run: `npm run test` → 全绿；`npm run build` → 编译成功、三个静态页仍 ●、路由表关键行记录进报告。

- [ ] **Step 3: 留给用户验收的清单（写进报告）**

① 交易页盘口平滑滚动、不再每 2 秒整体跳变；② 断开网络再恢复：盘口自动回落 REST 再切回 WS，全程不显示陈旧数据；③ 切换交易对盘口正确（**重点核对最优买卖价相邻、价差合理**——这是 trimDepth 裁剪方向的验收点）；④ 图表翻页后多次收线再翻页，视野不偏移、无缺口；⑤ 登出后立刻登录另一账号，各页面无上一账号数据残留；⑥ 从交易页切到设置页，`/api/paper/account` 轮询停止。

---

## 明确不做（记录）

- **成交列表 WS 化**：`useRecentTrades` 零消费方、成交列表 UI 不存在，无升级对象。该 hook 与 `/api/bingx/market/trades` 路由是否作为死代码删除，留给用户决定。
- **合约盘口 WS**：合约行情在另一端点（`wss://open-api-swap.bingx.com/swap-market`），当前订单簿组件只服务现货路径；接入需另做端点管理，收益与风险待评估。
- Supabase/Vercel 区域迁移（基础设施决策）、Service Worker 离线缓存扩展——始终在 spec 的"不做"清单内。
