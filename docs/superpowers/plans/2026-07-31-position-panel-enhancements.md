# 挂单持仓面板增强（Phase 4）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给合约持仓/挂单面板加上历史订单、成交记录两个新标签页，以及仓位行上的部分平仓快捷按钮和一键反向按钮，同时把已经变复杂的持仓行拆成独立组件。

**Architecture:** BingX 合约的历史订单/成交记录接口（`getFuturesAllOrders`/`getFuturesFillHistory`）已经在 `src/lib/bingx/futures.ts` 里实现好了，只是没有路由暴露、没有 hook、没有 UI——本阶段把这三层补齐。部分平仓和一键反向是新的写操作：`closePosition`（现有接口）只支持整仓平掉、不接受数量参数，所以部分平仓改成下一张相反方向、`reduceOnly: true`、数量为持仓量按比例折算的市价单；一键反向是"先整仓平掉、再按原数量反向开仓"两步操作，第二步失败要显式告诉用户（不能静默）。这两个操作都不需要经过 `preflightOrder` 的名义额风控——它们要么是纯粹的减仓（不增加风险敞口），要么是维持敞口大小不变、只是方向反转（用户此刻已经承担着这个规模的风险），跟现有的 `closePosition` 一样，是风险中性/降低的操作，不是新开仓。`FuturesInfoPanel.tsx` 目前是一个 372 行的大文件，持仓行的展示+编辑逻辑本阶段还要再加两块新交互，先拆成独立的 `FuturesPositionRow` 组件再往上加，不然文件会失控。

**Tech Stack:** Next.js API routes、React Query、现有的 `src/lib/trading/spec.ts`/`sizing.ts`（合约精度对齐）、`src/lib/trading/account-mode.ts`（单向/双向持仓模式判断）。

## Global Constraints

- 部分平仓的数量按服务端重新拉取的最新持仓量计算（`positionAmt`），不信任客户端传来的任何数量——客户端只传一个 0-100 的百分比
- 部分平仓/一键反向都不经过 `preflightOrder`（名义额风控层），原因见上面 Architecture 段——这是本阶段刻意的范围决定，不是遗漏
- 一键反向失败在"平仓成功、反向开仓失败"这一步时，必须返回一个明确说明"已平仓但反向开仓失败"的错误，不能返回一个笼统的失败让用户以为整个操作都没发生
- 历史订单/成交记录两个新 tab 不接入 `useUserDataStream` 的实时失效（WS 只推送开仓/挂单/余额变化的失效信号，不包括这两个新 query key）——这两个 tab 是"打开时看一眼"的历史数据，不是需要实时刷新的数据，属于本阶段的范围边界，不是疏漏
- `FuturesInfoPanel.tsx` 现有的其它行为（挂单改价/撤单、钱包展示、`useUserDataStream` 接入）一律不变，只是把持仓行的渲染搬进新组件、加两个新 tab
- 本阶段涉及的都是合约真实资金操作（部分平仓、反向都会调用 BingX 下单接口），实现时要认真对待，不能为了"看起来能跑"而跳过服务端重新拉取持仓量这一步

---

## File Structure

```
src/lib/bingx/futures.ts                          不需要改动，getFuturesAllOrders/getFuturesFillHistory 已存在

src/app/api/bingx/futures/
  history-orders/route.ts                          新增：GET，包 getFuturesAllOrders
  fill-history/route.ts                            新增：GET，包 getFuturesFillHistory
  positions/route.ts                                修改：POST 新增 reduceOnlyClose / reversePosition 两个 action

src/hooks/useTradingAccount.ts                      修改：新增 useFuturesOrderHistory / useFuturesFillHistory

src/components/trade/
  FuturesPositionRow.tsx                            新增：单条持仓行（TP/SL 编辑、部分平仓、一键反向、整仓平仓）
  FuturesOrderHistoryTab.tsx                        新增：历史订单列表
  FuturesFillHistoryTab.tsx                         新增：成交记录列表
  FuturesInfoPanel.tsx                              修改：加 Positions/Orders/History/Fills 四个 tab，持仓行换成 FuturesPositionRow
```

---

### Task 1: 历史订单/成交记录路由 + hook

**Files:**
- Create: `src/app/api/bingx/futures/history-orders/route.ts`
- Create: `src/app/api/bingx/futures/fill-history/route.ts`
- Modify: `src/hooks/useTradingAccount.ts`

**Interfaces:**
- Consumes: `getFuturesAllOrders`/`getFuturesFillHistory` from `@/lib/bingx/futures`（已存在）；两者导出的 `FuturesOrder`/`FuturesFillRecord` 类型
- Produces：
  - `GET /api/bingx/futures/history-orders?symbol=&limit=` → `{ success: true, data: FuturesOrder[] }`
  - `GET /api/bingx/futures/fill-history?symbol=&limit=` → `{ success: true, data: FuturesFillRecord[] }`
  - `useFuturesOrderHistory(enabled = true): UseQueryResult<FuturesOrder[]>` — queryKey `["trading", "futures-order-history"]`
  - `useFuturesFillHistory(enabled = true): UseQueryResult<FuturesFillRecord[]>` — queryKey `["trading", "futures-fill-history"]`

供 Task 4（`FuturesOrderHistoryTab`/`FuturesFillHistoryTab`）使用。这两条路由没有集成测试基础设施（和本仓库其它交易路由一样），验证走手动请求。

- [ ] **Step 1: 写 history-orders 路由**

```typescript
// src/app/api/bingx/futures/history-orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getFuturesAllOrders } from "@/lib/bingx/futures";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol") || undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam) : undefined;

    const data = await getFuturesAllOrders(apiKey, secret, { symbol, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: 写 fill-history 路由**

```typescript
// src/app/api/bingx/futures/fill-history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getFuturesFillHistory } from "@/lib/bingx/futures";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol") || undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam) : undefined;

    const data = await getFuturesFillHistory(apiKey, secret, { symbol, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 3: 加两个 hook**

在 `src/hooks/useTradingAccount.ts` 顶部的 import 区域，把：

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
```

改成：

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import type { FuturesOrder, FuturesFillRecord } from "@/lib/bingx/futures";

export type { FuturesOrder, FuturesFillRecord };
```

在文件末尾追加：

```typescript
/** 历史订单（不限 symbol，账户全部合约历史） */
export function useFuturesOrderHistory(enabled = true) {
  return useQuery<FuturesOrder[]>({
    queryKey: ["trading", "futures-order-history"],
    queryFn: async () => {
      const raw = await getJson<FuturesOrder[] | { orders: FuturesOrder[] }>("/api/bingx/futures/history-orders");
      return Array.isArray(raw) ? raw : raw?.orders ?? [];
    },
    staleTime: 30_000,
    enabled,
    retry: false,
  });
}

/** 成交记录（不限 symbol，账户全部合约成交） */
export function useFuturesFillHistory(enabled = true) {
  return useQuery<FuturesFillRecord[]>({
    queryKey: ["trading", "futures-fill-history"],
    queryFn: async () => {
      const raw = await getJson<FuturesFillRecord[] | { fills: FuturesFillRecord[] }>("/api/bingx/futures/fill-history");
      return Array.isArray(raw) ? raw : raw?.fills ?? [];
    },
    staleTime: 30_000,
    enabled,
    retry: false,
  });
}
```

（这两个 hook 沿用文件里已有的 `getJson<T>` 私有 helper，不需要新增。）

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 手动验证（需要登录 + 绑定合约 API Key）**

用浏览器 devtools 或 curl 带上登录态 cookie，分别 GET 两条新路由，确认都返回 `{success:true, data:[...]}`（哪怕数组是空的，只要 `success:true` 就算通过——历史数据为空是完全合法的情况，不代表接口有问题）。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/bingx/futures/history-orders/route.ts src/app/api/bingx/futures/fill-history/route.ts src/hooks/useTradingAccount.ts
git commit -m "feat(trade): add futures order history and fill history routes + hooks"
```

---

### Task 2: 部分平仓 / 一键反向 —— 后端 action

**Files:**
- Modify: `src/app/api/bingx/futures/positions/route.ts`

**Interfaces:**
- Consumes: `getFuturesPositions`/`placeFuturesOrder`/`closePosition` from `@/lib/bingx/futures`（已存在，`closePosition` 已被 import）；`getDualSideMode` from `@/lib/trading/account-mode`（已被 import）；`getSymbolSpec` from `@/lib/trading/spec`；`formatQty` from `@/lib/trading/sizing`
- Produces：
  - `POST /api/bingx/futures/positions` 新支持 `action: "reduceOnlyClose"`，body `{ symbol, positionId, positionSide, percent }`（`percent` 是 1-100 的整数或小数）
  - `POST /api/bingx/futures/positions` 新支持 `action: "reversePosition"`，body `{ symbol, positionId, positionSide }`

供 Task 3（`FuturesPositionRow`）通过 Task 5 里 `FuturesInfoPanel.tsx` 新增的两个处理函数调用。

- [ ] **Step 1: 加两个新 import**

把：

```typescript
import {
  getFuturesPositions, closePosition, getFuturesBalance,
  getLeverage, setLeverage, getMarginType, setMarginType,
  getPositionSideDual, setPositionTpSl, closeAllPositions, adjustPositionMargin,
} from "@/lib/bingx/futures";
import { invalidateDualSideMode, getDualSideMode } from "@/lib/trading/account-mode";
import { describeBingXError } from "@/lib/trading/errors";
```

改成：

```typescript
import {
  getFuturesPositions, closePosition, getFuturesBalance,
  getLeverage, setLeverage, getMarginType, setMarginType,
  getPositionSideDual, setPositionTpSl, closeAllPositions, adjustPositionMargin,
  placeFuturesOrder,
} from "@/lib/bingx/futures";
import { invalidateDualSideMode, getDualSideMode } from "@/lib/trading/account-mode";
import { describeBingXError } from "@/lib/trading/errors";
import { getSymbolSpec } from "@/lib/trading/spec";
import { formatQty } from "@/lib/trading/sizing";
```

- [ ] **Step 2: 请求体解构加上 percent 字段**

把：

```typescript
    const body = await request.json();
    const { action, symbol, positionSide, positionId, leverage, marginType, stopLossPrice, takeProfitPrice, amount, directionType } = body;
```

改成：

```typescript
    const body = await request.json();
    const { action, symbol, positionSide, positionId, leverage, marginType, stopLossPrice, takeProfitPrice, amount, directionType, percent } = body;
```

- [ ] **Step 3: 加两个新 case**

在现有的 `case "closePosition": { ... }` 这个 case 块（结束于 `}` 之后紧接着 `case "closeAllPositions":`）之前，插入两个新 case：

```typescript
        case "reduceOnlyClose": {
          if (!positionId) {
            return NextResponse.json(
              { success: false, error: { message: "positionId is required" } },
              { status: 400 }
            );
          }
          const pct = Number(percent);
          if (!(pct > 0) || pct > 100) {
            return NextResponse.json(
              { success: false, error: { message: "percent must be between 0 and 100" } },
              { status: 400 }
            );
          }

          // 数量按服务端重新拉取的最新持仓量算，不信任客户端传来的任何数量——
          // 客户端只负责传一个百分比
          const positions = await getFuturesPositions(apiKey, secret, symbol);
          const pos = positions.find((p) => p.positionId === positionId);
          if (!pos) {
            return NextResponse.json(
              { success: false, error: { message: "Position not found" } },
              { status: 404 }
            );
          }

          const spec = await getSymbolSpec(symbol, "futures", pos.positionSide === "SHORT" ? "SHORT" : "LONG");
          if (!spec) {
            return NextResponse.json(
              { success: false, error: { message: "Symbol spec unavailable" } },
              { status: 502 }
            );
          }

          const fullQty = Math.abs(parseFloat(pos.positionAmt));
          const closeQty = formatQty((fullQty * pct) / 100, spec);
          if (!(parseFloat(closeQty) > 0)) {
            return NextResponse.json(
              { success: false, error: { message: "Computed close quantity rounds to zero" } },
              { status: 400 }
            );
          }

          const closeSide = pos.positionSide === "LONG" ? "SELL" : "BUY";
          const dualSide = await getDualSideMode(authData.user.id, apiKey, secret);
          const result = await placeFuturesOrder(apiKey, secret, {
            symbol,
            side: closeSide,
            positionSide: dualSide ? pos.positionSide : "BOTH",
            type: "MARKET",
            quantity: closeQty,
            reduceOnly: true,
          });
          return NextResponse.json({ success: true, data: result });
        }
        case "reversePosition": {
          if (!positionId) {
            return NextResponse.json(
              { success: false, error: { message: "positionId is required" } },
              { status: 400 }
            );
          }

          const positions = await getFuturesPositions(apiKey, secret, symbol);
          const pos = positions.find((p) => p.positionId === positionId);
          if (!pos) {
            return NextResponse.json(
              { success: false, error: { message: "Position not found" } },
              { status: 404 }
            );
          }

          const qty = Math.abs(parseFloat(pos.positionAmt));
          if (!(qty > 0)) {
            return NextResponse.json(
              { success: false, error: { message: "Position has no open quantity" } },
              { status: 400 }
            );
          }

          // 第一步：整仓平掉
          await closePosition(apiKey, secret, positionId);

          // 第二步：按原数量反向开仓。这一步如果失败必须显式告诉用户"已平仓但
          // 反向开仓失败"——不能让调用方以为整个操作都没发生
          const newPositionSide = pos.positionSide === "LONG" ? "SHORT" : "LONG";
          const openSide = newPositionSide === "LONG" ? "BUY" : "SELL";
          try {
            const spec = await getSymbolSpec(symbol, "futures", newPositionSide);
            if (!spec) {
              throw new Error("Symbol spec unavailable for reopening leg");
            }
            const dualSide = await getDualSideMode(authData.user.id, apiKey, secret);
            const result = await placeFuturesOrder(apiKey, secret, {
              symbol,
              side: openSide,
              positionSide: dualSide ? newPositionSide : "BOTH",
              type: "MARKET",
              quantity: formatQty(qty, spec),
              reduceOnly: false,
            });
            return NextResponse.json({ success: true, data: result });
          } catch (reopenError) {
            const described = describeBingXError(reopenError);
            return NextResponse.json(
              {
                success: false,
                error: {
                  message: `Position closed but failed to reopen in the opposite direction: ${described.rawMessage}`,
                  i18nKey: "trading.reverse_reopen_failed",
                  code: described.code,
                },
              },
              { status: 502 }
            );
          }
        }
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 手动验证（需要登录 + 绑定合约 API Key + 一个真实的小额测试仓位）**

这两个 action 会真的调用 BingX 下单接口，测试时务必用极小仓位（比如最小名义额附近）：

1. 开一个很小的测试仓位，然后 POST `action: "reduceOnlyClose", percent: 50`，确认仓位数量减半，且是市价成交（不是新开一个方向相反的仓位）
2. 再 POST `action: "reduceOnlyClose", percent: 100`，确认仓位被完全平掉
3. 再开一个小仓位，POST `action: "reversePosition"`，确认原仓位消失、出现一个相反方向、大致相同数量的新仓位
4. 传一个不存在的 `positionId`，确认收到 404 "Position not found" 而不是把请求转发给 BingX

Expected: 部分平仓/反向都通过市价单完成，且都是基于服务端重新查询到的最新持仓量计算的数量

- [ ] **Step 6: Commit**

```bash
git add src/app/api/bingx/futures/positions/route.ts
git commit -m "feat(trade): add reduce-only partial close and one-click position reverse"
```

---

### Task 3: FuturesPositionRow 组件

**Files:**
- Create: `src/components/trade/FuturesPositionRow.tsx`

**Interfaces:**
- Consumes: `FuturesPosition` type from `@/hooks/useTradingAccount`（已存在，Phase 1 导出）
- Produces: `FuturesPositionRow({ position, highlighted, onClose, onReduceOnlyClose, onReverse, onSaveTpSl }): JSX.Element` —— 供 Task 5 的 `FuturesInfoPanel.tsx` 使用

这是一个纯展示+本地状态组件，本仓库的交易 UI 组件一贯不写单测，验证走 Task 5 合并之后的整体手动检查。

- [ ] **Step 1: 写组件**

```tsx
// src/components/trade/FuturesPositionRow.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FuturesPosition } from "@/hooks/useTradingAccount";

interface ActionResult {
  ok: boolean;
  message?: string;
}

interface FuturesPositionRowProps {
  position: FuturesPosition;
  /** 当前图表 symbol 是否匹配这条持仓——只影响高亮，不影响列表内容 */
  highlighted: boolean;
  onClose: (position: FuturesPosition) => Promise<ActionResult>;
  onReduceOnlyClose: (position: FuturesPosition, percent: number) => Promise<ActionResult>;
  onReverse: (position: FuturesPosition) => Promise<ActionResult>;
  onSaveTpSl: (position: FuturesPosition, tp: string, sl: string) => Promise<ActionResult>;
}

const CLOSE_PERCENTS = [25, 50, 75, 100];

export function FuturesPositionRow({
  position: pos, highlighted, onClose, onReduceOnlyClose, onReverse, onSaveTpSl,
}: FuturesPositionRowProps) {
  const [closing, setClosing] = useState(false);
  const [reducingPct, setReducingPct] = useState<number | null>(null);
  const [reversing, setReversing] = useState(false);
  const [reverseConfirmOpen, setReverseConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingTpSl, setEditingTpSl] = useState(false);
  const [tpValue, setTpValue] = useState("");
  const [slValue, setSlValue] = useState("");
  const [savingTpSl, setSavingTpSl] = useState(false);
  const [tpSlError, setTpSlError] = useState<string | null>(null);

  const pnl = parseFloat(pos.unrealizedProfit);
  const isLong = pos.positionSide === "LONG";
  const mark = parseFloat(pos.markPrice);

  const startTpSl = () => {
    setTpValue("");
    setSlValue("");
    setTpSlError(null);
    setEditingTpSl(true);
  };

  const saveTpSl = async () => {
    const tp = parseFloat(tpValue);
    const sl = parseFloat(slValue);
    const hasTp = tp > 0;
    const hasSl = sl > 0;
    if (!hasTp && !hasSl) {
      setTpSlError("Enter a take-profit and/or stop-loss price");
      return;
    }
    if (hasTp && (isLong ? tp <= mark : tp >= mark)) {
      setTpSlError(isLong ? "Take-profit must be above mark price" : "Take-profit must be below mark price");
      return;
    }
    if (hasSl && (isLong ? sl >= mark : sl <= mark)) {
      setTpSlError(isLong ? "Stop-loss must be below mark price" : "Stop-loss must be above mark price");
      return;
    }
    setSavingTpSl(true);
    setTpSlError(null);
    const result = await onSaveTpSl(pos, hasTp ? String(tp) : "", hasSl ? String(sl) : "");
    setSavingTpSl(false);
    if (!result.ok) {
      setTpSlError(result.message ?? "Failed to save TP/SL");
      return;
    }
    setEditingTpSl(false);
  };

  const handleClose = async () => {
    setClosing(true);
    setActionError(null);
    const result = await onClose(pos);
    setClosing(false);
    if (!result.ok) setActionError(result.message ?? "Failed to close position");
  };

  const handleReduceOnlyClose = async (percent: number) => {
    setReducingPct(percent);
    setActionError(null);
    const result = await onReduceOnlyClose(pos, percent);
    setReducingPct(null);
    if (!result.ok) setActionError(result.message ?? "Failed to reduce position");
  };

  const handleReverse = async () => {
    setReversing(true);
    setActionError(null);
    const result = await onReverse(pos);
    setReversing(false);
    setReverseConfirmOpen(false);
    if (!result.ok) setActionError(result.message ?? "Failed to reverse position");
  };

  return (
    <div className={cn("px-3 py-2 hover:bg-bg-hover/50", highlighted && "bg-gold/5")}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary">{pos.symbol}</span>
          <span className={cn("text-xs font-semibold", isLong ? "text-success" : "text-danger")}>
            {isLong ? "LONG" : "SHORT"}
          </span>
          <span className="text-xs text-text-muted">{pos.isolated ? "isolated" : "cross"} · {pos.leverage}x</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => (editingTpSl ? setEditingTpSl(false) : startTpSl())} className="text-xs text-text-muted hover:text-gold">
            {editingTpSl ? "取消" : "TP/SL"}
          </button>
          <button
            onClick={() => setReverseConfirmOpen(true)}
            disabled={reversing}
            className="text-xs text-text-muted hover:text-gold disabled:opacity-50"
          >
            {reversing ? "..." : "Reverse"}
          </button>
          <button
            onClick={handleClose}
            disabled={closing || reducingPct !== null}
            className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
          >
            {closing ? "..." : "Close"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 text-xs">
        <span className="text-text-muted">Size</span><span className="text-text-primary text-right">{parseFloat(pos.positionAmt).toFixed(4)}</span>
        <span className="text-text-muted">Entry</span><span className="text-text-primary text-right">{parseFloat(pos.avgPrice).toFixed(4)}</span>
        <span className="text-text-muted">Mark</span><span className="text-text-primary text-right">{parseFloat(pos.markPrice).toFixed(4)}</span>
        <span className="text-text-muted">Liq</span><span className="text-text-primary text-right">{parseFloat(pos.liquidationPrice).toFixed(4)}</span>
        <span className="text-text-muted">PnL</span>
        <span className={cn("text-right font-medium", pnl >= 0 ? "text-success" : "text-danger")}>
          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USDT
        </span>
      </div>

      {/* 部分平仓：按比例快捷按钮，点了直接下市价只减仓单，不需要额外输入数量 */}
      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-xs text-text-muted mr-1">Reduce</span>
        {CLOSE_PERCENTS.map((p) => (
          <button
            key={p}
            onClick={() => handleReduceOnlyClose(p)}
            disabled={reducingPct !== null || closing}
            className="rounded-xs border border-border-default px-1.5 py-0.5 text-xs text-text-muted hover:border-gold hover:text-gold disabled:opacity-50"
          >
            {reducingPct === p ? "..." : `${p}%`}
          </button>
        ))}
      </div>

      {actionError && <p className="mt-1 text-xs text-danger">{actionError}</p>}

      {editingTpSl && (
        <div className="mt-2 space-y-1.5 rounded border border-border-default p-2">
          <div className="flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-xs text-text-muted">TP</span>
            <input
              type="number"
              value={tpValue}
              onChange={(e) => setTpValue(e.target.value)}
              placeholder={mark.toFixed(4)}
              className="min-w-0 flex-1 rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-xs text-text-primary placeholder:text-text-muted"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-xs text-text-muted">SL</span>
            <input
              type="number"
              value={slValue}
              onChange={(e) => setSlValue(e.target.value)}
              placeholder={mark.toFixed(4)}
              className="min-w-0 flex-1 rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-xs text-text-primary placeholder:text-text-muted"
            />
          </div>
          {tpSlError && <p className="text-xs text-danger">{tpSlError}</p>}
          <button
            onClick={saveTpSl}
            disabled={savingTpSl}
            className="w-full rounded bg-gold py-1 text-xs font-medium text-black disabled:opacity-50"
          >
            {savingTpSl ? "..." : "Set TP/SL"}
          </button>
        </div>
      )}

      {reverseConfirmOpen && (
        <div className="mt-2 space-y-1.5 rounded border border-gold/40 bg-gold/5 p-2">
          <p className="text-xs text-text-secondary">
            Reverse position: this is two separate orders (market close, then market open the opposite side at the same size). Price may move between the two — the reopened size could differ slightly. Continue?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setReverseConfirmOpen(false)} className="text-xs text-text-muted hover:text-text-primary">
              Cancel
            </button>
            <button
              onClick={handleReverse}
              disabled={reversing}
              className="rounded bg-gold px-2 py-1 text-xs font-medium text-black disabled:opacity-50"
            >
              {reversing ? "..." : "Confirm Reverse"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（这个文件还没被任何地方 import，只检查它自身没有类型错误）

- [ ] **Step 3: Commit**

```bash
git add src/components/trade/FuturesPositionRow.tsx
git commit -m "feat(trade): extract FuturesPositionRow with partial close and reverse actions"
```

---

### Task 4: 历史订单 / 成交记录 Tab 组件

**Files:**
- Create: `src/components/trade/FuturesOrderHistoryTab.tsx`
- Create: `src/components/trade/FuturesFillHistoryTab.tsx`

**Interfaces:**
- Consumes: `useFuturesOrderHistory`/`useFuturesFillHistory` from `@/hooks/useTradingAccount`（Task 1）
- Produces: `FuturesOrderHistoryTab(): JSX.Element`、`FuturesFillHistoryTab(): JSX.Element` —— 供 Task 5 使用

- [ ] **Step 1: 写 FuturesOrderHistoryTab**

```tsx
// src/components/trade/FuturesOrderHistoryTab.tsx
"use client";

import { useFuturesOrderHistory } from "@/hooks/useTradingAccount";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  FILLED: "text-success",
  PARTIALLY_FILLED: "text-gold",
  CANCELLED: "text-text-muted",
  CANCELED: "text-text-muted",
  REJECTED: "text-danger",
  EXPIRED: "text-text-muted",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FuturesOrderHistoryTab() {
  const { data: orders = [], isLoading } = useFuturesOrderHistory();

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  if (orders.length === 0) {
    return <p className="px-3 py-4 text-xs text-text-muted text-center">No order history</p>;
  }

  return (
    <div className="divide-y divide-border-default/50">
      {orders.map((o) => (
        <div key={o.orderId} className="px-3 py-2 text-xs hover:bg-bg-hover/50">
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-text-primary font-medium">{o.symbol}</span>
              <span className={cn("font-semibold", o.positionSide === "LONG" ? "text-success" : "text-danger")}>
                {o.positionSide}
              </span>
              <span className="text-text-muted">{o.type}</span>
            </div>
            <span className={STATUS_COLORS[o.status] || "text-text-muted"}>{o.status}</span>
          </div>
          <div className="flex items-center justify-between text-text-muted">
            <span>
              {o.type === "MARKET" ? "MKT" : parseFloat(o.price).toFixed(4)} · {parseFloat(o.executedQty)}/{parseFloat(o.origQty)}
            </span>
            <span>{formatTime(o.time)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 FuturesFillHistoryTab**

```tsx
// src/components/trade/FuturesFillHistoryTab.tsx
"use client";

import { useFuturesFillHistory } from "@/hooks/useTradingAccount";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FuturesFillHistoryTab() {
  const { data: fills = [], isLoading } = useFuturesFillHistory();

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  if (fills.length === 0) {
    return <p className="px-3 py-4 text-xs text-text-muted text-center">No fills</p>;
  }

  return (
    <div className="divide-y divide-border-default/50">
      {fills.map((f) => (
        <div key={`${f.orderId}-${f.tradeId ?? f.time}`} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-bg-hover/50">
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary font-medium">{f.symbol}</span>
            <span className={cn("font-semibold", f.side === "BUY" ? "text-success" : "text-danger")}>
              {f.side}
            </span>
            <span className="text-text-primary">{parseFloat(f.qty)}</span>
          </div>
          <div className="flex items-center gap-3 text-text-muted">
            <span>{parseFloat(f.price).toFixed(4)}</span>
            <span>{formatTime(f.time)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/FuturesOrderHistoryTab.tsx src/components/trade/FuturesFillHistoryTab.tsx
git commit -m "feat(trade): add futures order history and fill history tab components"
```

---

### Task 5: 接入 FuturesInfoPanel —— 四个 Tab

**Files:**
- Modify: `src/components/trade/FuturesInfoPanel.tsx`

**Interfaces:**
- Consumes: `FuturesPositionRow` from `./FuturesPositionRow`（Task 3）；`FuturesOrderHistoryTab`/`FuturesFillHistoryTab` from `./FuturesOrderHistoryTab`/`./FuturesFillHistoryTab`（Task 4）；`reduceOnlyClose`/`reversePosition` actions on `/api/bingx/futures/positions`（Task 2）

把整个文件替换为下面的内容。这不是增量 diff——持仓行的渲染和状态管理整块搬进了 `FuturesPositionRow`，`handleClose`/`handleSaveTpSl` 的返回值形状也从"内部设 state"改成"返回 `{ok, message}` 给行组件自己展示"，与其在一堆离散的 diff 锚点里做这个改动，不如整文件替换更不容易出错。

- [ ] **Step 1: 整文件替换**

```tsx
// src/components/trade/FuturesInfoPanel.tsx
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { translateError } from "@/components/trade/order-form/OrderForm";
import {
  useFuturesPositions, useFuturesOpenOrders, useFuturesBalance,
  type FuturesPosition, type FuturesOpenOrder,
} from "@/hooks/useTradingAccount";
import { useUserDataStream } from "@/hooks/useUserDataStream";
import { useAuth } from "@/components/auth/AuthProvider";
import { FuturesPositionRow } from "./FuturesPositionRow";
import { FuturesOrderHistoryTab } from "./FuturesOrderHistoryTab";
import { FuturesFillHistoryTab } from "./FuturesFillHistoryTab";

interface FuturesInfoPanelProps {
  /** Only used to highlight this symbol's position row; the list itself always
   *  shows every open futures position/order, not just this symbol. */
  symbol: string;
}

type Tab = "positions" | "orders" | "history" | "fills";

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function FuturesInfoPanel({ symbol }: FuturesInfoPanelProps) {
  const t = useTranslations();
  const auth = useAuth();

  useUserDataStream({ market: "futures", enabled: !!auth.userId });

  const queryClient = useQueryClient();
  const { data: positions = [], isLoading: positionsLoading } = useFuturesPositions();
  const { data: orders = [], isLoading: ordersLoading } = useFuturesOpenOrders();
  const { data: balance = null } = useFuturesBalance();
  const loading = positionsLoading || ordersLoading;

  const [tab, setTab] = useState<Tab>("positions");

  function refetchAll() {
    queryClient.invalidateQueries({ queryKey: ["trading", "futures-positions"] });
    queryClient.invalidateQueries({ queryKey: ["trading", "futures-open-orders"] });
    queryClient.invalidateQueries({ queryKey: ["trading", "futures-balance"] });
  }

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [amending, setAmending] = useState(false);

  const handleCancel = async (order: FuturesOpenOrder) => {
    setCancelling(order.orderId);
    await fetch("/api/bingx/futures/open-orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", symbol: order.symbol, orderId: order.orderId }),
    });
    setCancelling(null);
    refetchAll();
  };

  // 条件单（止盈止损/触发单）的触发价在 stopPrice 字段；限价单改 price 字段
  // 市价单不会出现在挂单列表（即时成交），所以出现在这里的都能改
  const isConditionalOrder = (type: string) =>
    type.toUpperCase().includes("STOP") ||
    type.toUpperCase().includes("TAKE_PROFIT");

  const startEdit = (order: FuturesOpenOrder) => {
    const currentVal = isConditionalOrder(order.type) && order.stopPrice
      ? order.stopPrice
      : order.price;
    setEditValue(currentVal);
    setEditing(order.orderId);
  };

  const handleAmend = async (order: FuturesOpenOrder) => {
    const val = parseFloat(editValue);
    if (!(val > 0)) return;
    setAmending(true);
    try {
      const body: Record<string, unknown> = {
        symbol: order.symbol,
        orderId: order.orderId,
      };
      if (isConditionalOrder(order.type)) {
        body.stopPrice = val;
      } else {
        body.price = val;
      }
      await fetch("/api/bingx/futures/order/amend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* ignore */ }
    setAmending(false);
    setEditing(null);
    refetchAll();
  };

  const handleClose = async (position: FuturesPosition) => {
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "closePosition", symbol: position.symbol, positionId: position.positionId,
      });
      if (!json.success) return { ok: false, message: translateError(json, t) };
      return { ok: true };
    } catch {
      return { ok: false, message: t("bingx_error.network") };
    } finally {
      refetchAll();
    }
  };

  const handleReduceOnlyClose = async (position: FuturesPosition, percent: number) => {
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "reduceOnlyClose", symbol: position.symbol, positionId: position.positionId,
        positionSide: position.positionSide, percent,
      });
      if (!json.success) return { ok: false, message: translateError(json, t) };
      return { ok: true };
    } catch {
      return { ok: false, message: t("bingx_error.network") };
    } finally {
      refetchAll();
    }
  };

  const handleReverse = async (position: FuturesPosition) => {
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "reversePosition", symbol: position.symbol, positionId: position.positionId,
        positionSide: position.positionSide,
      });
      if (!json.success) return { ok: false, message: translateError(json, t) };
      return { ok: true };
    } catch {
      return { ok: false, message: t("bingx_error.network") };
    } finally {
      refetchAll();
    }
  };

  const handleSaveTpSl = async (position: FuturesPosition, tp: string, sl: string) => {
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "setPositionTpSl", symbol: position.symbol, positionSide: position.positionSide,
        takeProfitPrice: tp || undefined, stopLossPrice: sl || undefined,
      });
      if (!json.success) return { ok: false, message: translateError(json, t) };
      refetchAll();
      return { ok: true };
    } catch {
      return { ok: false, message: t("bingx_error.network") };
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "positions", label: `Positions (${positions.length})` },
    { key: "orders", label: `Orders (${orders.length})` },
    { key: "history", label: "History" },
    { key: "fills", label: "Fills" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border-default shrink-0">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 px-2 py-2 text-xs font-medium transition-colors",
              tab === key ? "text-text-primary border-b-2 border-gold" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "positions" && (
          positions.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted text-center">No positions</p>
          ) : (
            <div className="divide-y divide-border-default/50">
              {positions.map((pos) => (
                <FuturesPositionRow
                  key={pos.positionId}
                  position={pos}
                  highlighted={pos.symbol === symbol}
                  onClose={handleClose}
                  onReduceOnlyClose={handleReduceOnlyClose}
                  onReverse={handleReverse}
                  onSaveTpSl={handleSaveTpSl}
                />
              ))}
            </div>
          )
        )}

        {tab === "orders" && (
          orders.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted text-center">No open orders</p>
          ) : (
            <div className="divide-y divide-border-default/50">
              {orders.map((o) => (
                <div key={o.orderId} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-bg-hover/50">
                  <div>
                    <span className="text-text-primary font-medium">{o.symbol}</span>
                    <span className={cn("font-semibold ml-1", o.positionSide === "LONG" ? "text-success" : "text-danger")}>
                      {o.positionSide}
                    </span>
                    <span className="text-text-muted ml-1">{o.type} {o.side}</span>
                  </div>
                  {editing === o.orderId ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-muted text-xs">
                        {isConditionalOrder(o.type) ? "Stop" : "Price"}:
                      </span>
                      <input
                        type="number"
                        step="any"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAmend(o); }}
                        className="w-24 bg-bg-input border border-border-default rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        autoFocus
                      />
                      <button
                        onClick={() => handleAmend(o)}
                        disabled={amending || !(parseFloat(editValue) > 0)}
                        className="text-xs text-gold hover:text-gold-light disabled:opacity-40"
                      >
                        {amending ? "…" : "OK"}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-text-muted hover:text-text-primary"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted">
                        {o.type === "LIMIT" ? parseFloat(o.price).toFixed(4) : "MKT"}
                      </span>
                      <span className="text-text-primary">{parseFloat(o.origQty)}</span>
                      <button
                        onClick={() => startEdit(o)}
                        className="text-text-muted hover:text-gold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleCancel(o)}
                        disabled={cancelling === o.orderId}
                        className="text-text-muted hover:text-danger disabled:opacity-50"
                      >
                        {cancelling === o.orderId ? "×" : "Cancel"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {tab === "history" && <FuturesOrderHistoryTab />}
        {tab === "fills" && <FuturesFillHistoryTab />}
      </div>

      {/* Wallet — futures account margin/equity, always visible at the bottom */}
      <div className="shrink-0 border-t border-border-default px-3 py-2">
        <span className="text-xs font-medium text-text-secondary">合约钱包</span>
        {balance ? (
          <div className="mt-1 grid grid-cols-2 gap-x-2 text-xs">
            <span className="text-text-muted">权益 Equity</span>
            <span className="text-text-primary text-right">{parseFloat(balance.equity).toFixed(2)} USDT</span>
            <span className="text-text-muted">可用保证金</span>
            <span className="text-text-primary text-right">{parseFloat(balance.availableMargin).toFixed(2)} USDT</span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-text-muted">—</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 手动验证**

启动 dev server，打开 `/trade`，切到 Futures（需要 Pro 权限 + 绑定合约 API Key）：

1. 面板顶部应该看到四个 tab：Positions / Orders / History / Fills
2. Positions tab：如果有持仓，应该看到每条持仓下方多了一行"Reduce 25% 50% 75% 100%"按钮和"Reverse"按钮，原有的 TP/SL、Close 按钮还在
3. 点 History/Fills tab：应该分别显示历史订单和成交记录列表（哪怕是空的也应该显示"No order history"/"No fills"而不是报错或一直转圈）
4. 挂单/撤单/改价（Orders tab）行为应该和之前完全一样，没有回归
5. 如果有小额测试仓位，点一次 25% 的 Reduce 按钮，确认仓位数量按比例减少；点 Reverse 会弹出二次确认框，确认后仓位方向反转

Expected: 四个 tab 都能正常切换，持仓行的新增交互和原有交互共存不冲突

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/FuturesInfoPanel.tsx
git commit -m "feat(trade): wire history/fills tabs and position row actions into FuturesInfoPanel"
```
