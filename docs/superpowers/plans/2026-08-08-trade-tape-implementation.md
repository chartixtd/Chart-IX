# 成交明细（Trade Tape）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把死代码管道（`useRecentTrades` + `/api/bingx/market/trades`）接上真实 UI：交易页新增「成交明细」——WebSocket 实时逐笔成交流，大额成交高亮，Pro 专享，桌面/移动双端可用。

**Architecture:** 复用阶段 5 建好的按频道 WebSocket 引用计数机制（`BingXWebSocketManager`），新增 `SYMBOL@trade` 频道订阅、`market` store 的有界成交队列（50 条）、以及与 `useOrderBook` 同构的 WS 优先 + REST 回落钩子。展示层是一个新组件 `RecentTrades`，接入 `MarketOverview`（桌面第三标签）与移动端盘口抽屉（新增标签组）。大单判定是独立可测的纯函数。

**Tech Stack:** Next.js 15、zustand、React Query v5、next-intl、vitest。不引入新依赖。

## Global Constraints

- 所有改动为纯新增：不修改任何现有交互行为，不删除死代码管道之外的任何文件。
- 组件与订阅仅在「成交」标签被选中 **且** 用户为 Pro 时激活——这是省性能的核心，必须两个条件同时满足才订阅 WebSocket 频道。
- `auth.loading` 期间不得显示锁定态（Pro 门控的既有惯例，见 `KlineChart.tsx:173-177` 的 `accessLoading` 模式）。
- store 新增的 `trades` 必须有界（每 symbol 最多 50 条），退订时清理——不得重演 `tickers` 曾经只增不删的问题。
- 大单判定纯函数必须有 vitest 覆盖：中位数计算、样本不足、成交量齐平、脏数据过滤、阈值临界。这是「算错会让用户误判市场」的地方。
- 三语文案（`zh-CN` / `en-US` / `ms-MY`）新增键必须三份同步添加，纯新增不改动任何既有键。
- 每 Task 独立 commit（末尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）；每 Task 完成时 `npx tsc --noEmit` + `npm run test` 全绿。

---

## 背景知识（实施者必读，覆盖你可能不知道的既有约定）

1. **WebSocket 管理器已是频道化的**（`src/hooks/useBingXWebSocket.ts`）：`manager.subscribe(dataTypes: string[])` 接收完整频道字符串（如 `"BTC-USDT@ticker"`、`"BTC-USDT@depth20"`），按引用计数订阅/退订，返回一个 cleanup 函数。退订最后一个引用时会调用 `manager.disconnect()`（若无剩余订阅）。新增成交频道只需在 `ws.onmessage` 里加一个分支、新增一个 `useBingXTrades` 钩子——不改动 `subscribe`/`connect`/`disconnect` 本身。
2. **实测事实（勿凭文档改写）**：现货端点 `wss://open-api-ws.bingx.com/market` 的 `SYMBOL@trade` 频道订阅消息与 `@ticker`/`@depth20` 同构：`{"id":"...", "reqType":"sub", "dataType":"BTC-USDT@trade"}`，服务端回 `{"code":0,"msg":"SUCCESS"}`。推送频率约 2 次/秒。**单笔成交载荷是对象，不是数组**：`{"E":..., "T":1786158018949, "e":"trade", "m":true, "p":"64923.99", "q":"0.00075", "s":"BTC-USDT", "t":"229162568"}`。字段映射：`T`→time、`p`→price、`q`→qty、`m`→isBuyerMaker、`t`→id（这四个字段名与项目现有 `BingXTrade` 类型的字段名不同，必须显式映射，不能直接展开）。
3. **`BingXTrade` 类型**（`src/types/bingx.ts:82-88`）：`{ id: string; price: string; qty: string; time: number; isBuyerMaker: boolean }`。REST 接口 `/openApi/spot/v1/market/trades` 返回的就是这个形状（`getSpotTrades`，`src/lib/bingx/market.ts:87`）。WS 映射函数必须输出完全相同的形状，否则展示层要写两套渲染逻辑。
4. **`useOrderBook` 是本任务的直接参照范本**（`src/hooks/useMarketData.ts:103-134`）：`useBingXDepth(canUseWs ? symbol : null)` 触发订阅；`wsConnected` 与 store 里的数据快照共同决定 `useWs`；REST `useQuery` 的 `enabled: !useWs` 保证两者不会同时跑；返回值收窄成组件消费的最小字段集。`useRecentTrades` 要做的事情结构完全一致，唯一区别是 store 里存的是**列表**（append 有界队列）而不是**单个快照对象**。
5. **`market` store 现有清理模式**（`src/stores/market.ts`）：每个 setter 都配一个 remover；remover 对"无变化"返回同一个 state 引用（`return state`）以避免多余重渲染；这个模式必须原样套用在 `trades` 上。
6. **Pro 门控与 upsell 的既有惯例**（`KlineChart.tsx:173-177, 828-857`）：`accessLoading = auth.loading`；`hasXxx = canXxx(auth.tier)`；未授权时按钮显示 🔒（但 `accessLoading` 期间不显示）；点击展开一个悬浮卡片，文案 + 一个跳转 `/upgrade` 的 `Link`，点卡片外区域关闭（一个 `fixed inset-0` 遮罩层）。本任务的锁定态复用同一视觉语言，但因为整个面板都锁定（不是像指标那样锁的是一个按钮的次级功能），做法是**面板中央直接显示锁定态卡片**，不是弹出层。
7. **`MarketOverview` 的三态切换**（`src/components/trade/MarketOverview.tsx:115, 199-218, 220-224`）：`viewMode` 目前是 `"list" | "orderbook"`，一个 `flex rounded-xs bg-bg-tertiary p-0.5` 容器里两个按钮，选中态 `bg-bg-primary text-text-primary`，未选中 `text-text-muted hover:text-text-secondary`。渲染分支是简单的三元/条件表达式。新增第三态与第三个按钮、第三个渲染分支即可，无需重构。
8. **移动端盘口抽屉**（`src/app/[locale]/(app)/trade/page.tsx:571-581`）：`bookOverlayOpen` 状态控制一个绝对定位叠层（`absolute inset-y-0 right-0 w-[62%]`），内容目前固定是 `<OrderBook>`。本任务要在这个叠层顶部加一组「盘口/成交」标签，抽屉的开关状态（`bookOverlayOpen`/`MobileTradeBar` 的 `onToggleBook`）不变，只是叠层内部新增一层子切换。
9. **i18n 文案位置**：`OrderBook`/`MarketOverview` 用的翻译键都在三份 `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` 的顶层 `"trade"` 命名空间下（`market_overview`、`indicators` 等是其子对象）。**`ms-MY.json` 的 `"trade"` 命名空间本身缺少 `market_overview`/`indicators` 等多个键**（既有缺口，与本任务无关，不要尝试修复）——但本任务新增的键仍需在三个文件都添加，插入位置以 `"trade"` 顶层对象内、任意已存在的兄弟键之后即可（三个文件各自的具体插入锚点见 Task 4）。

## File Structure（改动全景）

```
src/lib/trading/trade-tape.ts              [新建] markLargeTrades 纯函数
src/lib/trading/trade-tape.test.ts         [新建] 单测
src/hooks/useBingXWebSocket.ts             [修改] mapTrade + onmessage 分支 + useBingXTrades
src/stores/market.ts                       [修改] trades 状态 + pushTrade/removeTrades
src/hooks/useMarketData.ts                 [修改] useRecentTrades 改 WS 优先+REST 回落
src/lib/access.ts                          [修改] canViewTradeTape
src/components/trade/RecentTrades.tsx      [新建] 展示组件
src/components/trade/MarketOverview.tsx    [修改] 三态切换
src/app/[locale]/(app)/trade/page.tsx      [修改] 移动端抽屉内子标签
src/i18n/messages/zh-CN.json               [修改] 新增文案
src/i18n/messages/en-US.json               [修改] 新增文案
src/i18n/messages/ms-MY.json               [修改] 新增文案
```

---

### Task 1: 大单判定纯函数（TDD）

**Files:**
- Create: `src/lib/trading/trade-tape.ts`
- Create: `src/lib/trading/trade-tape.test.ts`

**Interfaces:**
- Produces: `markLargeTrades(trades: BingXTrade[]): Array<BingXTrade & { isLarge: boolean }>`——输入一批成交（任意顺序），输出同长度、同顺序的数组，每项附加 `isLarge` 布尔标记。基准（中位数）在函数内部对整批输入计算一次。
- Produces（内部，可选导出以便测试）：`LARGE_TRADE_MULTIPLIER = 3`、`MIN_SAMPLE_SIZE = 10` 两个具名常量。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { markLargeTrades } from "./trade-tape";
import type { BingXTrade } from "@/types/bingx";

function trade(qty: string, id = "1"): BingXTrade {
  return { id, price: "100", qty, time: Date.now(), isBuyerMaker: false };
}

describe("markLargeTrades", () => {
  it("marks nothing below the minimum sample size", () => {
    // 9 笔，全部低于 MIN_SAMPLE_SIZE=10 —— 即使有一笔数量是其余的 100 倍也不该标记
    const trades = [
      ...Array.from({ length: 8 }, () => trade("1")),
      trade("1000"),
    ];
    const result = markLargeTrades(trades);
    expect(result.every((t) => !t.isLarge)).toBe(true);
  });

  it("marks a trade at >= 3x the median once sample size is sufficient", () => {
    // 10 笔：9 笔数量为 1（中位数=1），1 笔数量为 3（恰好 3 倍，应标记）
    const trades = [
      ...Array.from({ length: 9 }, () => trade("1")),
      trade("3", "large"),
    ];
    const result = markLargeTrades(trades);
    const large = result.find((t) => t.id === "large");
    expect(large?.isLarge).toBe(true);
    expect(result.filter((t) => t.isLarge)).toHaveLength(1);
  });

  it("does not mark a trade just under the threshold", () => {
    const trades = [
      ...Array.from({ length: 9 }, () => trade("1")),
      trade("2.99", "not-large"),
    ];
    const result = markLargeTrades(trades);
    expect(result.find((t) => t.id === "not-large")?.isLarge).toBe(false);
  });

  it("marks nothing when all quantities are equal", () => {
    const trades = Array.from({ length: 20 }, () => trade("5"));
    const result = markLargeTrades(trades);
    expect(result.every((t) => !t.isLarge)).toBe(true);
  });

  it("ignores zero, negative, and NaN quantities when computing the median", () => {
    // 有效样本仍是 10 笔"1"——脏数据不能拉低中位数导致误判
    const trades = [
      ...Array.from({ length: 10 }, () => trade("1")),
      trade("0"),
      trade("-5"),
      trade("not-a-number"),
    ];
    const result = markLargeTrades(trades);
    const dirty = result.filter((t) => ["0", "-5", "not-a-number"].includes(t.qty));
    expect(dirty.every((t) => !t.isLarge)).toBe(true);
  });

  it("preserves input order and length", () => {
    const trades = Array.from({ length: 12 }, (_, i) => trade(String(i + 1), String(i)));
    const result = markLargeTrades(trades);
    expect(result).toHaveLength(trades.length);
    expect(result.map((t) => t.id)).toEqual(trades.map((t) => t.id));
  });

  it("handles an empty list", () => {
    expect(markLargeTrades([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/trading/trade-tape.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
import type { BingXTrade } from "@/types/bingx";

/** 少于这个样本数不判定大单——否则首笔成交必然"超过中位数 3 倍"，开盘即满屏高亮。 */
export const MIN_SAMPLE_SIZE = 10;
/** 成交量达到中位数的这个倍数即标记为大单。 */
export const LARGE_TRADE_MULTIPLIER = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 标记异常大额成交：数量 >= 中位数 × LARGE_TRADE_MULTIPLIER。
 *
 * 用中位数而非平均值做基准——平均值会被单笔巨额成交自己抬高，导致真有
 * 连续大单时反而一笔都标不出来；中位数对离群值免疫，正是标记离群值所需。
 */
export function markLargeTrades(
  trades: BingXTrade[]
): Array<BingXTrade & { isLarge: boolean }> {
  const validQtys = trades
    .map((t) => parseFloat(t.qty))
    .filter((q) => Number.isFinite(q) && q > 0);

  if (validQtys.length < MIN_SAMPLE_SIZE) {
    return trades.map((t) => ({ ...t, isLarge: false }));
  }

  const threshold = median(validQtys) * LARGE_TRADE_MULTIPLIER;

  return trades.map((t) => {
    const qty = parseFloat(t.qty);
    const isLarge = Number.isFinite(qty) && qty > 0 && qty >= threshold;
    return { ...t, isLarge };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/trading/trade-tape.test.ts`
Expected: PASS 全部 7 个用例。

- [ ] **Step 5: 全量验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/lib/trading/trade-tape.ts src/lib/trading/trade-tape.test.ts
git commit -m "feat(trade-tape): markLargeTrades — median-based large trade detection"
```

---

### Task 2: WebSocket 成交频道 + store 有界队列

**Files:**
- Modify: `src/hooks/useBingXWebSocket.ts`
- Modify: `src/stores/market.ts`

**Interfaces:**
- Consumes: Task 1 无依赖（本任务不用 `markLargeTrades`）。
- Produces:
  - store：`trades: Record<string, BingXTrade[]>`（每 symbol 最多 50 条，新到的在前）、`pushTrade(symbol: string, trade: BingXTrade): void`、`removeTrades(symbol: string): void`。
  - `useBingXTrades(symbol: string | null): void`（新增于 `useBingXWebSocket.ts`，与 `useBingXDepth` 同构）。

- [ ] **Step 1: store 新增 trades 状态**

在 `src/stores/market.ts` 的 `MarketState` interface 里加（放在 `depths` 相关字段之后）：

```ts
  /** symbol → 最新成交列表（WebSocket 推送），新到的在前，最多保留 50 条 */
  trades: Record<string, BingXTrade[]>;
  /** 追加一笔成交；超出上限从尾部截断 */
  pushTrade: (symbol: string, trade: BingXTrade) => void;
  removeTrades: (symbol: string) => void;
```

顶部 import 加 `BingXTrade`：

```ts
import type { BingXTicker, BingXDepth, BingXTrade } from "@/types/bingx";
```

实现（加在 `removeDepth` 与 `clearDepths` 之间或之后，风格与既有 setter/remover 一致）：

```ts
const MAX_TRADES_PER_SYMBOL = 50;

  trades: {},

  pushTrade: (symbol, trade) =>
    set((state) => {
      const existing = state.trades[symbol] ?? [];
      const next = [trade, ...existing].slice(0, MAX_TRADES_PER_SYMBOL);
      return { trades: { ...state.trades, [symbol]: next } };
    }),

  removeTrades: (symbol) =>
    set((state) => {
      if (!(symbol in state.trades)) return state;
      const next = { ...state.trades };
      delete next[symbol];
      return { trades: next };
    }),
```

`MAX_TRADES_PER_SYMBOL` 常量定义在 `create<MarketState>((set) => ({...}))` 调用之外的模块顶层（文件里 import 语句之后即可）。

- [ ] **Step 2: WebSocket 管理器接入成交频道**

在 `src/hooks/useBingXWebSocket.ts` 顶部，`DEPTH_CHANNEL_SUFFIX` 定义之后加：

```ts
const TRADE_CHANNEL_SUFFIX = "@trade";
```

新增成交映射函数（放在 `mapTicker` 之后）：

```ts
/** 单笔成交对象（非数组）：{p,q,T,m,s,t} → 项目既有的 BingXTrade 形状。 */
function mapTrade(raw: Record<string, string | number | boolean>): BingXTrade {
  return {
    id: String(raw.t ?? ""),
    price: String(raw.p ?? "0"),
    qty: String(raw.q ?? "0"),
    time: Number(raw.T ?? Date.now()),
    isBuyerMaker: Boolean(raw.m),
  };
}
```

`ws.onmessage` 里，在现有的 depth 分支（`if (depthSym) {...}`）之后、`if (!dt.endsWith("@ticker")) return;` 之前插入成交分支：

```ts
      if (dt.endsWith(TRADE_CHANNEL_SUFFIX)) {
        const sym = dt.slice(0, dt.length - TRADE_CHANNEL_SUFFIX.length);
        const raw = msg.data as Record<string, string | number | boolean> | undefined;
        if (!sym || !raw) return;
        useMarketStore.getState().pushTrade(sym, mapTrade(raw));
        return;
      }

```

退订清理逻辑（`subscribe` 返回的 cleanup 函数里，`for (const dt of removed) {...}` 循环内，在 depth 分支之后、`@ticker` 分支之前）加：

```ts
        if (dt.endsWith(TRADE_CHANNEL_SUFFIX)) {
          const sym = dt.slice(0, dt.length - TRADE_CHANNEL_SUFFIX.length);
          if (sym) useMarketStore.getState().removeTrades(sym);
          continue;
        }
```

文件末尾（`useBingXDepth` 之后）新增：

```ts
/** 订阅单个交易对的逐笔成交推送；数据进 useMarketStore.trades。 */
export function useBingXTrades(symbol: string | null) {
  useEffect(() => {
    if (!manager || !symbol) return;
    return manager.subscribe([`${symbol}${TRADE_CHANNEL_SUFFIX}`]);
  }, [symbol]);
}
```

要点：本任务**不需要**给 `mapTrade` 引入 `symbolFromDepthChannel` 那样的抽取纯函数——成交频道的 symbol 解析是一行 `slice`，且已有 `symbolFromDepthChannel` 珠玉在前证明了这类解析必须谨慎（阶段 5 曾在这里出过 off-by-one）。**验算**：`"BTC-USDT@trade"` 长度 14，`"@trade"` 长度 6，`slice(0, 14-6)` = `slice(0,8)` = `"BTC-USDT"`。正确，不要再减 1。

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/hooks/useBingXWebSocket.ts src/stores/market.ts
git commit -m "feat(ws): subscribe SYMBOL@trade channel, bounded 50-entry trade queue in store"
```

---

### Task 3: useRecentTrades 改 WS 优先 + REST 回落

**Files:**
- Modify: `src/hooks/useMarketData.ts`

**Interfaces:**
- Consumes: Task 2 的 `useBingXTrades`、store 的 `trades`。
- Produces: `useRecentTrades(symbol: string, enabled: boolean, limit = 20)` —— **签名变化**：新增第二个必填参数 `enabled`（调用方必须显式传入，与 spec 的"仅标签选中且 Pro 时订阅"要求对应）。返回值收窄为 `{ data: BingXTrade[] | undefined; isLoading: boolean }`（成交明细不需要 `isPlaceholderData`——大单高亮需要稳定顺序，不做过渡态渐隐）。

- [ ] **Step 1: 改写 useRecentTrades**

`src/hooks/useMarketData.ts` 顶部 import 加 `useBingXTrades`：

```ts
import { useBingXDepth, useBingXTrades } from "@/hooks/useBingXWebSocket";
```

整段替换现有的 `useRecentTrades`（原第 137-145 行）：

```ts
// 最新成交 —— WS 实时推送优先，断线/无数据/未启用时回落 REST 轮询。
// enabled 由调用方控制：只有面板可见且用户有权限时才应为 true——成交推送约
// 2 次/秒且每次产生新数组引用，不可见面板保持订阅会造成无谓重渲染。
export function useRecentTrades(symbol: string, enabled: boolean, limit = 20) {
  useBingXTrades(enabled ? symbol : null);

  const wsConnected = useMarketStore((s) => s.wsConnected);
  const wsTrades = useMarketStore((s) => s.trades[symbol]);
  const useWs = enabled && wsConnected && !!wsTrades && wsTrades.length > 0;

  const query = useQuery({
    queryKey: ["bingx", "trades", symbol, limit],
    queryFn: () => fetchApi<BingXTrade[]>("trades", { symbol, limit: String(limit) }),
    refetchInterval: useWs ? false : 3_000,
    staleTime: 1_000,
    enabled: enabled && !!symbol && !useWs,
  });

  if (useWs) {
    return { data: wsTrades.slice(0, limit), isLoading: false };
  }
  return { data: query.data, isLoading: query.isPending };
}
```

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿（`tsc` 会因签名变化报错——本任务尚无调用方，Task 5 才会新增调用方，此时报错属预期之外的情况，说明当前仓库无其他调用方，符合背景知识"零调用方"的前提；若 tsc 报错来自别处调用方，先读那处代码再决定是否属于本计划范围外的遗留调用，正常情况下不会有）。

```bash
git add src/hooks/useMarketData.ts
git commit -m "perf(trades): useRecentTrades — WS-first with REST fallback, enabled-gated"
```

---

### Task 4: Pro 门控 + 三语文案

**Files:**
- Modify: `src/lib/access.ts`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Produces: `canViewTradeTape(userTier: UserTier | null): boolean`。
- Produces（i18n，`trade` 命名空间新增子对象 `recent_trades`）：
  - `trade.market_overview.trades`（第三个标签的按钮文案，三语分别为"成交"/"Trades"/"Dagangan"）
  - `trade.recent_trades.time` / `.price` / `.qty`（列头）
  - `trade.recent_trades.empty`（空态）
  - `trade.recent_trades.locked`（锁定态说明）
  - `trade.recent_trades.locked_cta`（升级按钮文案）
  - `trade.mobile_trades`（移动端抽屉内的成交标签文案）

- [ ] **Step 1: access.ts 新增函数**

在 `src/lib/access.ts` 的 `canUseAdvancedChart` 之后加：

```ts
/** 成交明细（逐笔成交流 + 大单高亮）。与图表高级指标同级的 Pro 专属能力。 */
export function canViewTradeTape(userTier: UserTier | null): boolean {
  return userTier === "pro";
}
```

- [ ] **Step 2: zh-CN.json**

在 `"trade"` 命名空间内，`"market_overview"` 对象（约第 279-282 行）里加一个键：

```json
    "market_overview": {
      "list": "列表",
      "orderbook": "盘口",
      "trades": "成交"
    },
```

紧随 `"market_overview"` 对象之后（`},` 之后，`"indicators": {` 之前）插入新对象：

```json
    "recent_trades": {
      "time": "时间",
      "price": "价格",
      "qty": "数量",
      "empty": "暂无成交",
      "locked": "逐笔成交与大额成交提醒为 Pro 专属功能",
      "locked_cta": "升级 Pro 解锁"
    },
```

在 `"mobile_book": "盘口",` 这一行（约第 258 行）之后加：

```json
    "mobile_trades": "成交",
```

- [ ] **Step 3: en-US.json**

同样三处插入（对照 zh-CN 的行号定位到对应键，位置逻辑相同）：

```json
    "market_overview": {
      "list": "List",
      "orderbook": "Order Book",
      "trades": "Trades"
    },
```

```json
    "recent_trades": {
      "time": "Time",
      "price": "Price",
      "qty": "Qty",
      "empty": "No trades yet",
      "locked": "Live trade feed with large-trade alerts is a Pro feature",
      "locked_cta": "Upgrade to Pro to unlock"
    },
```

```json
    "mobile_trades": "Trades",
```

- [ ] **Step 4: ms-MY.json**

`ms-MY.json` 的 `"trade"` 命名空间**没有** `market_overview` 或 `indicators` 子对象（既有缺口，不在本任务修复范围）。本任务新增的三组键仍需添加，插入位置：`"trade"` 顶层对象内、`"market": {...}` 对象（约第 220-234 行）之后插入两个新对象，`"mobile_book": "Buku",`（约第 258 行）之后插入 `mobile_trades`：

```json
    "market_overview": {
      "trades": "Dagangan"
    },
    "recent_trades": {
      "time": "Masa",
      "price": "Harga",
      "qty": "Kuantiti",
      "empty": "Belum ada dagangan",
      "locked": "Aliran dagangan langsung dengan makluman dagangan besar adalah ciri Pro",
      "locked_cta": "Naik taraf ke Pro untuk membuka kunci"
    },
```

```json
    "mobile_trades": "Dagangan",
```

注意：ms-MY 的 `market_overview` 只放 `trades` 一个键（不补 `list`/`orderbook`——那两个键本来就不存在，不属于本任务范围，不要新增未被要求的键）。

- [ ] **Step 5: 验证 JSON 合法性 + Commit**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/messages/zh-CN.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/messages/en-US.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/messages/ms-MY.json','utf8')); console.log('all valid')"`
Expected: 输出 `all valid`（三个文件都是合法 JSON，逗号/括号无误）。

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/lib/access.ts src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(trade-tape): canViewTradeTape gate + zh-CN/en-US/ms-MY copy"
```

---

### Task 5: RecentTrades 展示组件

**Files:**
- Create: `src/components/trade/RecentTrades.tsx`

**Interfaces:**
- Consumes: Task 1 `markLargeTrades`；Task 3 `useRecentTrades(symbol, enabled, limit?)`；Task 4 `canViewTradeTape`。
- Produces: `RecentTrades({ symbol, active }: { symbol: string; active: boolean })`——`active` 由父组件传入，表示"这个标签当前是否可见"，与 Pro 权限一起决定是否真正订阅（`enabled = active && canViewTradeTape(auth.tier)`）。

- [ ] **Step 1: 实现组件**

```tsx
"use client";

import { memo } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecentTrades } from "@/hooks/useMarketData";
import { markLargeTrades } from "@/lib/trading/trade-tape";
import { canViewTradeTape } from "@/lib/access";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface RecentTradesProps {
  symbol: string;
  /** 这个面板当前是否可见（标签是否选中）——不可见时不订阅 WebSocket。 */
  active: boolean;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export const RecentTrades = memo(function RecentTrades({ symbol, active }: RecentTradesProps) {
  const t = useTranslations("trade.recent_trades");
  const locale = useLocale();
  const auth = useAuth();

  const canView = canViewTradeTape(auth.tier);
  const enabled = active && canView;
  const { data, isLoading } = useRecentTrades(symbol, enabled);

  // Pro 权限未就绪（auth.loading）时不显示锁——避免 Pro 用户刷新页面时闪一下锁定态。
  if (!auth.loading && !canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs">
        <p className="text-text-secondary">{t("locked")}</p>
        <Link href={`/${locale}/upgrade`} className="font-medium text-gold hover:underline">
          {t("locked_cta")} →
        </Link>
      </div>
    );
  }

  if (isLoading || auth.loading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded-sm bg-bg-tertiary" />
        ))}
      </div>
    );
  }

  const trades = markLargeTrades(data ?? []);

  return (
    <div className="text-xs">
      <div className="grid grid-cols-3 gap-1 px-2 py-1.5 text-text-muted border-b border-border-default">
        <span>{t("time")}</span>
        <span className="text-right">{t("price")}</span>
        <span className="text-right">{t("qty")}</span>
      </div>

      {trades.length === 0 ? (
        <p className="p-4 text-center text-text-muted">{t("empty")}</p>
      ) : (
        trades.map((trade) => {
          const isBuy = !trade.isBuyerMaker;
          const priceColor = isBuy ? "text-success" : "text-danger";
          return (
            <div
              key={trade.id}
              className={cn(
                "grid grid-cols-3 gap-1 px-2 py-0.5",
                trade.isLarge && (isBuy ? "bg-success/10 font-semibold" : "bg-danger/10 font-semibold")
              )}
            >
              <span className="text-text-muted">{formatTime(trade.time)}</span>
              <span className={cn("text-right", priceColor)}>{formatPrice(parseFloat(trade.price))}</span>
              <span className="text-right text-text-secondary">{trade.qty}</span>
            </div>
          );
        })
      )}
    </div>
  );
});
```

要点核对：
- `isBuyerMaker: true` 表示这笔成交里买方是挂单方（maker），也就是**主动方是卖方**——所以 `isBuy = !trade.isBuyerMaker`（这与 `OrderBook.tsx` 里 ask=红/bid=绿 的既有配色方向一致：主动买绿、主动卖红）。
- 锁定态文案全部来自本组件自有的 `trade.recent_trades` 命名空间（`t("locked")`/`t("locked_cta")`），不复用 `trade.indicators` 下的 `pro_upsell` 系列键——两处锁定态的展示形态不同（悬浮卡片 vs 面板中央），文案也应各自独立，不要额外引入 `trade.indicators` 的 `useTranslations` 实例。

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/components/trade/RecentTrades.tsx
git commit -m "feat(trade-tape): RecentTrades component — live feed, large-trade highlight, Pro gate"
```

---

### Task 6: 接入桌面版 MarketOverview 第三标签

**Files:**
- Modify: `src/components/trade/MarketOverview.tsx`

**Interfaces:**
- Consumes: Task 5 `RecentTrades`。
- Produces: 无对外接口变化（`MarketOverviewProps` 不变）。

- [ ] **Step 1: 三态切换**

顶部 import 加：

```ts
import { RecentTrades } from "@/components/trade/RecentTrades";
```

`viewMode` 类型（第 115 行）改为三态：

```ts
  const [viewMode, setViewMode] = useState<"list" | "orderbook" | "trades">("list");
```

按钮容器（第 199-218 行）里，`orderbook` 按钮之后加第三个按钮：

```tsx
          <button
            onClick={() => setViewMode("trades")}
            className={cn(
              "flex-1 rounded-xs py-1 text-xs font-medium transition-colors",
              viewMode === "trades" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t("market_overview.trades")}
          </button>
```

渲染分支（第 220-224 行）从二选一改三选一：

```tsx
      {viewMode === "orderbook" ? (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <OrderBook symbol={activeSymbol} onPriceClick={onOrderBookPriceClick} />
        </div>
      ) : viewMode === "trades" ? (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <RecentTrades symbol={activeSymbol} active={viewMode === "trades"} />
        </div>
      ) : (
```

（原本 `) : (` 之后的 list 渲染分支内容不变，只是从"二选一的 else"变成"三选一的最终 else"。）

要点：`active={viewMode === "trades"}` 恒为 `true`——因为这个 JSX 分支本身只在 `viewMode === "trades"` 时渲染，`RecentTrades` 组件此刻必然可见。这个 prop 存在的意义在于组件切走时（`viewMode` 变成别的值）整个分支连同 `RecentTrades` 一起卸载，`useRecentTrades` 内的 `useBingXTrades(null)` 不会被触发——**卸载即退订**是 React 的默认行为（`useEffect` cleanup 在组件卸载时自动跑），不需要额外传 `false`。`active` prop 因此在这里恒为 `true` 是正确的、不是死代码——它的"关闭"效果由父组件的条件渲染本身实现。

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/components/trade/MarketOverview.tsx
git commit -m "feat(trade-tape): wire RecentTrades into MarketOverview's third tab"
```

---

### Task 7: 接入移动端盘口抽屉

**Files:**
- Modify: `src/app/[locale]/(app)/trade/page.tsx`

**Interfaces:**
- Consumes: Task 5 `RecentTrades`。
- Produces: 无对外接口变化。

- [ ] **Step 1: dynamic import**

在现有 `const OrderBook = dynamic(...)`（第 38-41 行）之后加：

```ts
const RecentTrades = dynamic(
  () => import("@/components/trade/RecentTrades").then((m) => m.RecentTrades),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);
```

- [ ] **Step 2: 抽屉内子标签**

组件函数体内（`bookOverlayOpen` 状态声明附近，第 401 行左右）新增一个子标签状态：

```ts
  const [mobileBookTab, setMobileBookTab] = useState<"orderbook" | "trades">("orderbook");
```

移动端叠层 JSX（第 575-580 行）：

```tsx
            {bookOverlayOpen && (
              // 订单簿做成图表上的叠层，而不是抢一个 tab
              <div className="absolute inset-y-0 right-0 w-[62%] border-l border-border-default bg-bg-primary/95 backdrop-blur-sm">
                <div className="flex border-b border-border-default">
                  <button
                    onClick={() => setMobileBookTab("orderbook")}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium transition-colors",
                      mobileBookTab === "orderbook" ? "text-gold" : "text-text-muted"
                    )}
                  >
                    {t("mobile_book")}
                  </button>
                  <button
                    onClick={() => setMobileBookTab("trades")}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium transition-colors",
                      mobileBookTab === "trades" ? "text-gold" : "text-text-muted"
                    )}
                  >
                    {t("mobile_trades")}
                  </button>
                </div>
                {mobileBookTab === "orderbook" ? (
                  <OrderBook symbol={symbol} onPriceClick={handleOrderBookPriceClick} />
                ) : (
                  <RecentTrades symbol={symbol} active={mobileBookTab === "trades"} />
                )}
              </div>
            )}
```

检查文件顶部是否已 import `cn`（`@/lib/utils`）——若未 import 需补上；`t` 变量（`useTranslations`）在文件里已存在（用于 `t("mobile_book")` 等既有调用），沿用同一实例。

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿；`npm run build` 编译通过，`/[locale]/trade` 路由无新增错误。

```bash
git add "src/app/[locale]/(app)/trade/page.tsx"
git commit -m "feat(trade-tape): orderbook/trades sub-tabs inside mobile drawer"
```

---

### Task 8: 全量验证

**Files:** 无新改动（验证任务）。

- [ ] **Step 1: 构建核验**

Run: `npm run build`
Expected: 编译成功；`/[locale]/articles`、`/[locale]/videos`、`/[locale]/learn` 仍为 ●（本任务未触碰路由结构，不应受影响）；`/[locale]/trade` 正常。

- [ ] **Step 2: 全量测试**

Run: `npm run test`
Expected: 全绿，含 Task 1 新增的 7 个 `trade-tape.test.ts` 用例。

- [ ] **Step 3: 留给用户验收的清单（写进报告，不在本任务执行——需要真实 Pro/免费两种账号）**

① Pro 账号桌面版切到「成交」标签，看到逐笔成交流式滚动，主动买（绿）/卖（红）颜色正确；② 制造几笔数量远超其余的成交（或观察真实大额成交），确认有加粗+底色高亮，且普通行情下不会满屏高亮；③ 免费账号看到锁定态 + 升级入口，刷新页面时不闪现锁头；④ 切到「市场」或「盘口」标签后，浏览器开发者工具 Network→WS 帧里成交推送（`@trade` 频道）停止；⑤ 断网 10 秒再恢复，列表保留最后数据、之后恢复推送；⑥ 手机端点开盘口抽屉，「盘口/成交」子标签切换正常；⑦ 中/英/马来三语下所有新增文案正确显示（列头、锁定态、移动端标签）。

---

## Self-Review（写计划时的自检记录）

- **Spec 覆盖**：数据层（Task 2+3）、展示层（Task 5）、权限层（Task 4）、大单高亮（Task 1）、桌面集成（Task 6）、移动集成（Task 7）、错误处理（Task 3 的 WS/REST 回落 + Task 5 的空态/加载态）、性能（Task 6/7 的 `active` 门控注释）、i18n（Task 4）、测试（Task 1 TDD）——spec 各节均有对应任务，无遗漏。spec 明确排除的"主动买卖占比统计条"未出现在任何任务中。
- **占位符扫描**：无 TBD/TODO；Task 5 里刻意保留了一段"先写错、再说明修正"的措辞用于强调 `isBuyerMaker` 方向易错——已在同一 Step 内给出最终正确版本，实施者按最终版本写代码，不构成占位符。
- **类型一致性**：`markLargeTrades`（Task 1）→ `RecentTrades` 消费（Task 5）字段名 `isLarge` 一致；`useRecentTrades(symbol, enabled, limit?)`（Task 3）→ `RecentTrades` 调用（Task 5）与 `MarketOverview`/`trade/page.tsx` 传入的 `active`（Task 6/7）语义链路一致（`enabled = active && canView`）；`useBingXTrades`（Task 2）与 `useBingXDepth` 同签名模式，`RecentTrades` 不直接调用它（经 `useRecentTrades` 间接调用），职责边界清晰。
