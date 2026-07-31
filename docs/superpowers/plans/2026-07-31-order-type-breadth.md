# 下单种类补全（Phase 3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给限价类订单加上可选的成交时效（GTC/PostOnly/IOC/FOK），给合约订单加上"只减仓"开关，并把现货 OCO 单从"后端已实现但下单被硬编码禁用"改成真正可下单——同时补上它一直缺失的服务端风控换算（名义额→数量、精度对齐、限额校验），不能绕过这一层直接下单。

**Architecture:** 现货订单路由（`trade/order/route.ts`）已经支持 `timeInForce` 透传，只是前端从没发过这个字段——本阶段只需要给前端加选择器。合约订单路由（`futures/order/route.ts`）目前把 `timeInForce` 写死成 `"GTC"`、完全没读 `reduceOnly`，需要先把这两个参数打通。OCO 路由（`trade/oco-order/route.ts`）目前对 `action !== "cancel" && action !== "query"` 直接拒绝并返回 501，注释里写明原因是"还没接入服务端风控层"——本阶段新增 `action: "place"` 分支，复用现货订单路由同一套 `preflightOrder`→`roundPrice`→下单→`recordOrder` 流程，OCO 由于是三价格（限价单价 + 触发价 + 触发后限价）、单笔独立表单，不适合塞进现有 `OrderForm` 的统一 `orderType` 渲染逻辑，做成一个独立的 `OcoTicket` 子组件，在现货专业模式的订单类型里选中"OCO"时替换掉常规的价格/数量/预览/提交区块。

**Tech Stack:** Next.js API routes、现有的 `src/lib/trading/preflight.ts` 风控换算层、React、next-intl（三个语言包）。

## Global Constraints

- `timeInForce` 只对限价类订单类型有意义（现货：`LIMIT`/`TAKE_STOP_LIMIT`/`TRIGGER_LIMIT`；合约：`LIMIT`/`STOP`/`TAKE_PROFIT`，即 `config.ts` 里已有的 `LIMIT_TYPES` 集合），可选值固定为 `GTC`/`PostOnly`/`IOC`/`FOK`（`src/lib/bingx/futures.ts` 已导出 `FuturesTimeInForce` 类型、`src/lib/bingx/trade.ts` 已导出 `TimeInForce` 类型，两边值完全一致，直接复用）
- `reduceOnly` 只对合约订单类型有意义，现货/模拟盘不涉及
- 简单模式（`uiMode === "simple"`）不显示 TIF 选择器，默认沿用现状（不传即为 `GTC`）；专业模式（`uiMode === "pro"`）在限价类订单类型下显示
- OCO 只在现货、专业模式下可选（合约/模拟盘不支持 OCO，`config.ts` 的 `FUTURES_TYPES`/`paper.proTypes` 不加这个选项）
- OCO 下单必须经过和现货普通下单同一套服务端风控换算（`preflightOrder` + `roundPrice`），不能直接把用户输入的名义额/价格转发给 BingX——这是 `oco-order/route.ts` 现有注释里明确写的、之前被暂缓实现的原因，本阶段要把这个缺口补上，不能跳过
- OCO 下单也要走现有的 `checkRateLimit`（复用 `RATE_LIMITS.SPOT_TRADE`，因为 OCO 是现货功能，和普通现货下单共享同一限流维度是合理的，不需要新增一档限流）和 `recordOrder` 落库（`orderType` 记成 `"OCO"`，`price` 记 `limitPrice`，`stopPrice` 记 `triggerPrice`——`orders` 表本身没有第三个价格字段，`orderPrice` 不落库，够用于展示历史记录即可，不是本阶段要解决的完整 OCO 历史查看功能）
- 三个语言包文件（`src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`）新增的 key 结构必须完全一致（同样的 key 名、同样的嵌套层级），只有文案不同——这是这三个文件一直以来的既有约定
- `trading.type.oco` 这个翻译 key 在三个语言包里已经存在（早前预留的），本阶段不需要新增，直接复用

---

## File Structure

```
src/app/api/bingx/futures/order/route.ts     修改：读取并校验 timeInForce/reduceOnly，透传给 placeFuturesOrder
src/app/api/bingx/trade/oco-order/route.ts   修改：新增 action="place" 分支，接入 preflightOrder 风控换算

src/components/trade/order-form/
  config.ts                       修改：SPOT_TYPES 追加 "OCO"
  fields/TifField.tsx              新增：TIF 选择器
  fields/ReduceOnlyField.tsx       新增：只减仓开关
  OcoTicket.tsx                    新增：OCO 独立下单表单
  OrderForm.tsx                    修改：接入 TIF/ReduceOnly 状态与请求体，orderType==="OCO" 时切换渲染 OcoTicket

src/i18n/messages/
  zh-CN.json / en-US.json / ms-MY.json   修改：新增 trading.time_in_force / trading.tif.* / trading.reduce_only / trading.reduce_only_hint / trading.oco.*
```

---

### Task 1: 合约下单路由补上 timeInForce/reduceOnly

**Files:**
- Modify: `src/app/api/bingx/futures/order/route.ts`

**Interfaces:**
- Consumes: `placeFuturesOrder`/`testFuturesOrder`（已存在，`params.timeInForce`/`params.reduceOnly` 已经支持，见 `src/lib/bingx/futures.ts` 的 `PlaceFuturesOrderParams`）；`FuturesTimeInForce` type from `@/lib/bingx/futures`
- Produces: `POST /api/bingx/futures/order` 的请求体新支持可选字段 `timeInForce`（`"GTC"|"IOC"|"FOK"|"PostOnly"`，仅限价类订单类型生效）、`reduceOnly`（boolean，任意订单类型都可传）——供 Task 4（`OrderForm.tsx`）调用

这条路由目前没有集成测试基础设施（和本仓库其它路由一样，只有 `lib/` 层做单测），验证走手动请求（Step 4）。

- [ ] **Step 1: 加类型导入 + 校验常量**

在 `src/app/api/bingx/futures/order/route.ts` 顶部，把：

```typescript
import type { FuturesOrderType } from "@/lib/bingx/futures";
```

改成：

```typescript
import type { FuturesOrderType, FuturesTimeInForce } from "@/lib/bingx/futures";
```

在 `const ATTACHABLE_TPSL = new Set<FuturesOrderType>(["MARKET", "LIMIT"]);` 这一行之后加上：

```typescript
const VALID_TIF: FuturesTimeInForce[] = ["GTC", "IOC", "FOK", "PostOnly"];
```

- [ ] **Step 2: 解析并校验请求体里的新字段**

把：

```typescript
  const {
    test, symbol, direction, type, notionalUsdt, referencePrice, leverage,
    price, stopPrice, priceRatePercent, workingType,
    stopLossPrice, takeProfitPrice,
  } = body;
```

改成：

```typescript
  const {
    test, symbol, direction, type, notionalUsdt, referencePrice, leverage,
    price, stopPrice, priceRatePercent, workingType,
    stopLossPrice, takeProfitPrice, timeInForce, reduceOnly,
  } = body;
```

在 `if (!VALID_TYPES.includes(type)) return reject("INVALID_TYPE", "Invalid order type", 400);` 这一行之后加上：

```typescript
  if (timeInForce && !VALID_TIF.includes(timeInForce)) {
    return reject("INVALID_TIF", "Invalid timeInForce", 400);
  }
```

- [ ] **Step 3: 把写死的 GTC 换成客户端传入的值，透传 reduceOnly**

在 `send` 函数里，把：

```typescript
      price: LIMIT_TYPES.has(type) ? roundPrice(Number(price), pre.spec) : undefined,
      stopPrice: STOP_TYPES.has(type) ? roundPrice(Number(stopPrice), pre.spec) : undefined,
      priceRate,
      timeInForce: LIMIT_TYPES.has(type) ? ("GTC" as const) : undefined,
      workingType: workingType || undefined,
```

改成：

```typescript
      price: LIMIT_TYPES.has(type) ? roundPrice(Number(price), pre.spec) : undefined,
      stopPrice: STOP_TYPES.has(type) ? roundPrice(Number(stopPrice), pre.spec) : undefined,
      priceRate,
      timeInForce: LIMIT_TYPES.has(type) ? ((timeInForce as FuturesTimeInForce) || "GTC") : undefined,
      workingType: workingType || undefined,
      reduceOnly: reduceOnly === true ? true : undefined,
```

（这一段后面紧接着的 `stopLoss`/`takeProfit` 字段保持不变。）

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 手动验证（需要登录 + 绑定合约 API Key + Pro 权限）**

用浏览器 devtools 或 curl 带上登录态 cookie，POST 一个带 `timeInForce: "PostOnly"` 的合约限价单（数量很小、价格远离市价避免真的成交），确认响应成功且没有校验报错；再 POST 一个带 `timeInForce: "NOT_A_REAL_VALUE"` 的请求，确认收到 400 `INVALID_TIF`。

Expected: 合法值透传成功、非法值被拒绝

- [ ] **Step 6: Commit**

```bash
git add src/app/api/bingx/futures/order/route.ts
git commit -m "feat(trade): support client-selected timeInForce and reduceOnly on futures orders"
```

---

### Task 2: TIF 选择器 + 只减仓开关组件

**Files:**
- Create: `src/components/trade/order-form/fields/TifField.tsx`
- Create: `src/components/trade/order-form/fields/ReduceOnlyField.tsx`

**Interfaces:**
- Consumes: `LIMIT_TYPES` from `../config`（`TifField` 内部不需要，由 `OrderForm.tsx` 在调用处判断是否渲染）
- Produces：
  - `TifField({ value: "GTC"|"PostOnly"|"IOC"|"FOK", onChange: (v) => void })` — 供 Task 4 使用
  - `ReduceOnlyField({ value: boolean, onChange: (v: boolean) => void })` — 供 Task 4 使用

这两个是纯展示组件（沿用 `PriceFields.tsx` 的 props 风格），本仓库的 UI 组件一贯不写单测，验证走 Task 4 里合到 `OrderForm.tsx` 之后的整体手动检查。

- [ ] **Step 1: 写 TifField**

```tsx
// src/components/trade/order-form/fields/TifField.tsx
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type TimeInForceOption = "GTC" | "PostOnly" | "IOC" | "FOK";

const OPTIONS: TimeInForceOption[] = ["GTC", "PostOnly", "IOC", "FOK"];

interface TifFieldProps {
  value: TimeInForceOption;
  onChange: (v: TimeInForceOption) => void;
}

/** 限价单的成交时效选择——只在专业模式下由 OrderForm 决定是否渲染 */
export function TifField({ value, onChange }: TifFieldProps) {
  const t = useTranslations();

  return (
    <div>
      <div className="mb-1 text-xs text-text-muted">{t("trading.time_in_force")}</div>
      <div className="grid grid-cols-4 gap-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-xs py-1 text-xs font-medium",
              value === opt ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t(`trading.tif.${opt.toLowerCase()}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 ReduceOnlyField**

```tsx
// src/components/trade/order-form/fields/ReduceOnlyField.tsx
"use client";

import { useTranslations } from "next-intl";

interface ReduceOnlyFieldProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

/** 合约"只减仓"开关——开启后 BingX 会拒绝任何会增加持仓的方向 */
export function ReduceOnlyField({ value, onChange }: ReduceOnlyFieldProps) {
  const t = useTranslations();

  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
      <input
        type="checkbox"
        checked={value}
        className="rounded-xs"
        onChange={(e) => onChange(e.target.checked)}
      />
      {t("trading.reduce_only")}
      <span className="text-text-muted/60">({t("trading.reduce_only_hint")})</span>
    </label>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（这两个文件还没被任何地方 import，只检查它们自身没有类型错误）

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/order-form/fields/TifField.tsx src/components/trade/order-form/fields/ReduceOnlyField.tsx
git commit -m "feat(trade): add TIF selector and reduce-only toggle components"
```

---

### Task 3: 三个语言包新增翻译 key

**Files:**
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Produces: `trading.time_in_force`、`trading.tif.{gtc,postonly,ioc,fok}`、`trading.reduce_only`、`trading.reduce_only_hint`、`trading.oco.{hint,limit_price,trigger_price,order_price}` —— 供 Task 2 的组件和 Task 5 的 `OcoTicket` 使用

三个文件里 `trading` 对象目前的最后一个 key 是 `"reject"`（一个大对象）。在 `"type"` 这个 key（也就是 `trading.type.*`，`oco` 已经在里面）之后、`"reject"` 之前插入新 key。

- [ ] **Step 1: 在 `zh-CN.json` 里插入**

在 `src/i18n/messages/zh-CN.json` 的 `trading` 对象内，找到 `"type": { ... "oco": "OCO" }` 这一段结束的地方（也就是 `"type"` 这个 key 后面），在它和 `"reject"` 之间插入：

```json
    "time_in_force": "有效方式",
    "tif": {
      "gtc": "GTC",
      "postonly": "只挂单",
      "ioc": "IOC",
      "fok": "FOK"
    },
    "reduce_only": "只减仓",
    "reduce_only_hint": "只能减少持仓，不会开新仓",
    "oco": {
      "hint": "限价单立即挂出；触发价被突破时，自动改挂另一笔限价单。两笔单一旦有一笔成交，另一笔自动取消。",
      "limit_price": "限价（立即挂单）",
      "trigger_price": "触发价",
      "order_price": "触发后限价"
    },
```

（注意 JSON 语法：插入位置前后都要保证逗号正确，不要产生多余或缺失的逗号导致文件解析失败。)

- [ ] **Step 2: 在 `en-US.json` 里插入相同结构**

同样的位置（`"type"` 之后、`"reject"` 之前）：

```json
    "time_in_force": "Time in Force",
    "tif": {
      "gtc": "GTC",
      "postonly": "Post Only",
      "ioc": "IOC",
      "fok": "FOK"
    },
    "reduce_only": "Reduce Only",
    "reduce_only_hint": "Can only reduce your position, never open new exposure",
    "oco": {
      "hint": "The limit order goes live immediately; when the trigger price is crossed, the other limit order is placed automatically. Whichever leg fills first cancels the other.",
      "limit_price": "Limit Price (live now)",
      "trigger_price": "Trigger Price",
      "order_price": "Order Price (after trigger)"
    },
```

- [ ] **Step 3: 在 `ms-MY.json` 里插入相同结构**

同样的位置：

```json
    "time_in_force": "Tempoh Sah",
    "tif": {
      "gtc": "GTC",
      "postonly": "Hanya Letak",
      "ioc": "IOC",
      "fok": "FOK"
    },
    "reduce_only": "Hanya Kurangkan",
    "reduce_only_hint": "Hanya boleh kurangkan kedudukan, tidak akan buka kedudukan baharu",
    "oco": {
      "hint": "Pesanan had terus aktif; apabila harga pencetus dilepasi, satu lagi pesanan had diletakkan secara automatik. Mana-mana kaki yang dipenuhi dahulu akan membatalkan yang satu lagi.",
      "limit_price": "Harga Had (aktif sekarang)",
      "trigger_price": "Harga Pencetus",
      "order_price": "Harga Pesanan (selepas pencetus)"
    },
```

- [ ] **Step 4: 校验 JSON 合法性 + 三个文件的 key 结构一致**

Run:

```bash
node -e "
for (const loc of ['zh-CN','en-US','ms-MY']) {
  const d = require('./src/i18n/messages/' + loc + '.json');
  const t = d.trading;
  console.log(loc, 'time_in_force:', t.time_in_force);
  console.log(loc, 'tif keys:', Object.keys(t.tif));
  console.log(loc, 'oco keys:', Object.keys(t.oco));
}
"
```

Expected: 三个文件都能正常 `require`（JSON 语法没错），`tif`/`oco` 的 key 列表在三个文件里完全一致（`['gtc','postonly','ioc','fok']` / `['hint','limit_price','trigger_price','order_price']`）

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: Commit**

```bash
git add src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(trade): add i18n keys for TIF, reduce-only, and OCO fields"
```

---

### Task 4: 接入 OrderForm —— TIF/ReduceOnly 状态与请求体

**Files:**
- Modify: `src/components/trade/order-form/OrderForm.tsx`

**Interfaces:**
- Consumes: `TifField`/`TimeInForceOption` from `./fields/TifField`（Task 2）；`ReduceOnlyField` from `./fields/ReduceOnlyField`（Task 2）；`LIMIT_TYPES` from `./config`（已存在）；Task 1 补齐的合约路由字段、现货路由已有的 `timeInForce` 支持

只加这一件事：TIF 选择器（限价类 + 专业模式下显示）和只减仓开关（合约市场下显示），并把它们的值塞进下单请求体。不改动其它任何逻辑（杠杆、TP/SL、金额、预览、确认弹窗）。

- [ ] **Step 1: 新增状态**

在 `const [showTpSl, setShowTpSl] = useState(false);` 这一行之后加上：

```typescript
  const [timeInForce, setTimeInForce] = useState<TimeInForceOption>("GTC");
  const [reduceOnly, setReduceOnly] = useState(false);
```

在文件顶部的 import 区域，把：

```typescript
import { AmountField } from "./fields/AmountField";
import { LeverageField } from "./fields/LeverageField";
import { PriceFields } from "./fields/PriceFields";
```

改成：

```typescript
import { AmountField } from "./fields/AmountField";
import { LeverageField } from "./fields/LeverageField";
import { PriceFields } from "./fields/PriceFields";
import { TifField, type TimeInForceOption } from "./fields/TifField";
import { ReduceOnlyField } from "./fields/ReduceOnlyField";
```

- [ ] **Step 2: 订单类型切换时重置 TIF/ReduceOnly（不带到不支持它们的类型/市场上）**

找到这个已有的 effect（TP/SL 重置）：

```typescript
  // TP/SL 只对合约有意义（现货/模拟盘下单接口根本不接受这两个字段）；
  // 切到不支持的市场或方向变化后残留的旧值不应该悄悄带入下一次下单
  useEffect(() => {
    const canAttach = market === "futures" && TPSL_ATTACHABLE.has(orderType);
    if (!canAttach && showTpSl) {
      setShowTpSl(false);
      setTpPrice("");
      setSlPrice("");
    }
  }, [market, orderType, showTpSl]);
```

在它之后加一个新 effect：

```typescript
  // TIF 只对限价类订单类型有意义；切到市价类订单时残留的旧选择不该悄悄带入
  // 下一次下单（比如切成市价单又切回限价单，理应回到默认 GTC）
  useEffect(() => {
    if (!LIMIT_TYPES.has(orderType) && timeInForce !== "GTC") {
      setTimeInForce("GTC");
    }
  }, [orderType, timeInForce]);

  // 只减仓只对合约有意义；切到现货/模拟盘时清掉，避免残留状态带进下一次
  // 合约下单（虽然现货/模拟盘请求体压根不读这个字段，这里是防御性清理）
  useEffect(() => {
    if (market !== "futures" && reduceOnly) {
      setReduceOnly(false);
    }
  }, [market, reduceOnly]);
```

- [ ] **Step 3: 把两个字段塞进下单请求体**

在 `execute` 函数里，找到现货分支：

```typescript
      } else if (market === "spot") {
        const json = await postOrder("/api/bingx/trade/order", {
          symbol, side: direction === "LONG" ? "BUY" : "SELL", type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          timeInForce: isLimit ? "GTC" : undefined,
        });
```

改成：

```typescript
      } else if (market === "spot") {
        const json = await postOrder("/api/bingx/trade/order", {
          symbol, side: direction === "LONG" ? "BUY" : "SELL", type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          timeInForce: isLimit ? timeInForce : undefined,
        });
```

紧接着的合约分支：

```typescript
      } else {
        const json = await postOrder("/api/bingx/futures/order", {
          symbol, direction, type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice, leverage,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          priceRatePercent: TRAILING_TYPES.has(orderType) ? callbackPercent : undefined,
          takeProfitPrice: showTpSl && tpPrice ? tpPrice : undefined,
          stopLossPrice: showTpSl && slPrice ? slPrice : undefined,
        });
```

改成：

```typescript
      } else {
        const json = await postOrder("/api/bingx/futures/order", {
          symbol, direction, type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice, leverage,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          priceRatePercent: TRAILING_TYPES.has(orderType) ? callbackPercent : undefined,
          takeProfitPrice: showTpSl && tpPrice ? tpPrice : undefined,
          stopLossPrice: showTpSl && slPrice ? slPrice : undefined,
          timeInForce: isLimit ? timeInForce : undefined,
          reduceOnly: reduceOnly || undefined,
        });
```

- [ ] **Step 4: 渲染 TIF 选择器 + 只减仓开关**

找到 `PriceFields` 的渲染位置：

```typescript
        <PriceFields
          orderType={orderType}
          currentPrice={currentPrice}
          price={price} onPriceChange={setPrice}
          stopPrice={stopPrice} onStopPriceChange={setStopPrice}
          callbackPercent={callbackPercent} onCallbackPercentChange={setCallbackPercent}
          tpPrice={tpPrice} onTpPriceChange={setTpPrice}
          slPrice={slPrice} onSlPriceChange={setSlPrice}
          showTpSl={showTpSl} onToggleTpSl={setShowTpSl}
          allowTpSl={market === "futures"}
        />
```

在它之后加上：

```typescript
        <PriceFields
          orderType={orderType}
          currentPrice={currentPrice}
          price={price} onPriceChange={setPrice}
          stopPrice={stopPrice} onStopPriceChange={setStopPrice}
          callbackPercent={callbackPercent} onCallbackPercentChange={setCallbackPercent}
          tpPrice={tpPrice} onTpPriceChange={setTpPrice}
          slPrice={slPrice} onSlPriceChange={setSlPrice}
          showTpSl={showTpSl} onToggleTpSl={setShowTpSl}
          allowTpSl={market === "futures"}
        />

        {uiMode === "pro" && isLimit && (
          <TifField value={timeInForce} onChange={setTimeInForce} />
        )}

        {market === "futures" && (
          <ReduceOnlyField value={reduceOnly} onChange={setReduceOnly} />
        )}
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: 手动验证**

启动 dev server，打开 `/trade`：

1. 现货市场，切到专业模式，选限价单：应该看到 TIF 选择器（GTC/只挂单/IOC/FOK 四个按钮），点选后再切成市价单，TIF 选择器消失；切回限价单，应该回到默认 GTC（不是残留刚才选的值）
2. 合约市场（需要 Pro 权限）：不管订单类型是什么，都应该看到"只减仓"开关；切回现货，开关消失
3. 简单模式下（`uiMode === "simple"`）不应该看到 TIF 选择器（只有专业模式才显示，符合设计决策）
4. 挂一个小额限价单，Network 面板确认请求体里带上了选中的 `timeInForce`

Expected: 交互符合预期，现有的下单/预览/确认流程没有回归

- [ ] **Step 7: Commit**

```bash
git add src/components/trade/order-form/OrderForm.tsx
git commit -m "feat(trade): wire TIF selector and reduce-only toggle into OrderForm"
```

---

### Task 5: OCO 下单路由 —— 接入服务端风控换算，启用下单

**Files:**
- Modify: `src/app/api/bingx/trade/oco-order/route.ts`

**Interfaces:**
- Consumes: `placeOcoOrder` from `@/lib/bingx/trade`（已存在）；`preflightOrder` from `@/lib/trading/preflight`；`recordOrder` from `@/lib/trading/persist`；`checkRateLimit` from `@/lib/trading/rate-limit`；`describeBingXError` from `@/lib/trading/errors`；`roundPrice` from `@/lib/trading/sizing`；`RATE_LIMITS` from `@/lib/constants`
- Produces: `POST /api/bingx/trade/oco-order` 新支持 `action: "place"`，请求体 `{ action: "place", symbol: string, side: "BUY"|"SELL", notionalUsdt: number, limitPrice: string, triggerPrice: string, orderPrice: string }`，成功响应 `{ success: true, data: { ...BingXOcoOrderResult, estimatedQty: number } }` —— 供 Task 6 的 `OcoTicket` 组件调用

这条路由和其它交易路由一样没有集成测试基础设施，验证走手动请求（Step 3）。

- [ ] **Step 1: 把整个文件替换为**

```typescript
// src/app/api/bingx/trade/oco-order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { cancelOcoOrder, queryOcoOrderList, placeOcoOrder } from "@/lib/bingx/trade";
import { preflightOrder } from "@/lib/trading/preflight";
import { recordOrder } from "@/lib/trading/persist";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { describeBingXError } from "@/lib/trading/errors";
import { roundPrice } from "@/lib/trading/sizing";
import { RATE_LIMITS } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    const userId = authData.user.id;

    const body = await request.json();
    const { action } = body;

    if (action !== "cancel" && action !== "query" && action !== "place") {
      return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("id, api_key_encrypted, secret_encrypted")
      .eq("user_id", userId).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    // Cancel OCO order
    if (action === "cancel") {
      const { orderId, clientOrderId } = body;
      const result = await cancelOcoOrder(apiKey, secret, { orderId, clientOrderId });
      return NextResponse.json({ success: true, data: result });
    }

    // Query OCO order
    if (action === "query") {
      const { orderId, clientOrderId } = body;
      const result = await queryOcoOrderList(apiKey, secret, { orderListId: orderId, clientOrderId });
      return NextResponse.json({ success: true, data: result });
    }

    // Place OCO order — 现在接入和普通现货下单同一套服务端风控换算，
    // 不再直接把用户输入的名义额/价格转发给 BingX（此前禁用下单正是因为
    // 缺这一层）
    const { symbol, side, notionalUsdt, limitPrice, triggerPrice, orderPrice } = body;

    if (side !== "BUY" && side !== "SELL") {
      return NextResponse.json({ success: false, error: { message: "side must be BUY or SELL" } }, { status: 400 });
    }
    if (!(Number(notionalUsdt) > 0)) {
      return NextResponse.json({ success: false, error: { message: "notionalUsdt must be positive" } }, { status: 400 });
    }
    if (!(Number(limitPrice) > 0) || !(Number(triggerPrice) > 0) || !(Number(orderPrice) > 0)) {
      return NextResponse.json({ success: false, error: { message: "limitPrice, triggerPrice and orderPrice must all be positive" } }, { status: 400 });
    }

    const rl = await checkRateLimit(`spot-order:${userId}`, RATE_LIMITS.SPOT_TRADE);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: { message: "Too many orders, slow down", i18nKey: "trading.reject.rate_limited" } },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const sideLower = side === "BUY" ? "buy" : "sell";

    let pre;
    try {
      pre = await preflightOrder(supabase, {
        userId,
        market: "spot",
        symbol,
        direction: side === "BUY" ? "LONG" : "SHORT",
        notionalUsdt: Number(notionalUsdt),
        referencePrice: Number(limitPrice),
        leverage: 1,
        isLimitOrder: true,
      });
    } catch (error) {
      const described = describeBingXError(error);
      return NextResponse.json(
        { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
        { status: 502 }
      );
    }

    if (!pre.ok) {
      await recordOrder(supabase, {
        userId, apiKeyId: null, market: "spot", symbol, side: sideLower, orderType: "OCO",
        quantity: 0, status: "rejected", riskRejected: true, riskReason: pre.code,
      });
      return NextResponse.json(
        { success: false, error: { message: `Order rejected: ${pre.code}`, i18nKey: `trading.reject.${pre.code.toLowerCase()}`, code: pre.code, limit: pre.limit } },
        { status: 400 }
      );
    }

    try {
      const result = await placeOcoOrder(apiKey, secret, {
        symbol,
        side,
        quantity: String(pre.qty),
        limitPrice: String(roundPrice(Number(limitPrice), pre.spec)),
        triggerPrice: String(roundPrice(Number(triggerPrice), pre.spec)),
        orderPrice: String(roundPrice(Number(orderPrice), pre.spec)),
      });

      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: "OCO",
        quantity: pre.sizing.qty,
        price: Number(limitPrice),
        stopPrice: Number(triggerPrice),
        leverage: 1,
        totalValue: pre.sizing.notional,
        bingxOrderId: result.orderListId ? String(result.orderListId) : null,
        status: "pending",
      });

      return NextResponse.json({ success: true, data: { ...result, estimatedQty: pre.qty } });
    } catch (error) {
      const described = describeBingXError(error);
      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: "OCO",
        quantity: pre.sizing.qty, status: "rejected",
        errorMessage: `${described.code ?? "-"}: ${described.rawMessage}`,
      });
      return NextResponse.json(
        { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 手动验证（需要登录 + 绑定现货 API Key）**

用浏览器 devtools 或 curl 带上登录态 cookie：

1. POST 一个 `action: "place"` 的合法请求（数量很小、价格远离市价避免真的成交），确认响应 `success: true` 且带 `data.orderListId`
2. POST 一个 `notionalUsdt: -1` 的请求，确认收到 400 校验错误（不是转发给 BingX 后才发现的错误）
3. POST 一个 `notionalUsdt` 超过账户限额（如果配置了 `trading_limits`）的请求，确认收到 `pre.code` 对应的拒绝，而不是把超限的名义额直接发给 BingX
4. 确认 `orders` 表里出现一条 `order_type = 'OCO'` 的记录（可以直接查 Supabase 或者看 `/orders` 页面）

Expected: 风控校验在请求真正打到 BingX 之前就生效，成功的下单正确落库

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bingx/trade/oco-order/route.ts
git commit -m "feat(trade): enable spot OCO order placement with server-side preflight risk checks"
```

---

### Task 6: OcoTicket 组件 —— 接入 OrderForm

**Files:**
- Create: `src/components/trade/order-form/OcoTicket.tsx`
- Modify: `src/components/trade/order-form/config.ts`
- Modify: `src/components/trade/order-form/OrderForm.tsx`

**Interfaces:**
- Consumes: `POST /api/bingx/trade/oco-order`（Task 5，`action: "place"`）；`useSpotTicker` from `@/hooks/useMarketData`（已存在）；`useSpotBalances` from `@/hooks/useTradingAccount`（已存在）；`translateError` from `./OrderForm`（已存在，导出的辅助函数）
- Produces: `OcoTicket({ symbol: string, direction: "LONG"|"SHORT" }): JSX.Element` —— 本任务内自行接入 `OrderForm.tsx`，不供更晚的任务使用

- [ ] **Step 1: config.ts 加上 OCO 选项（仅现货）**

把：

```typescript
const SPOT_TYPES = [
  "MARKET", "LIMIT",
  "TAKE_STOP_MARKET", "TAKE_STOP_LIMIT",
  "TRIGGER_MARKET", "TRIGGER_LIMIT",
];
```

改成：

```typescript
const SPOT_TYPES = [
  "MARKET", "LIMIT",
  "TAKE_STOP_MARKET", "TAKE_STOP_LIMIT",
  "TRIGGER_MARKET", "TRIGGER_LIMIT",
  "OCO",
];
```

（`FUTURES_TYPES` 和 `paper.proTypes` 不动——OCO 只在现货专业模式可选。`LIMIT_TYPES`/`STOP_TYPES`/`TRAILING_TYPES`/`TPSL_ATTACHABLE` 这几个 Set 都不需要加 `"OCO"`，它不适用于这些语义，`OrderForm.tsx` 会在渲染时单独分支处理。）

- [ ] **Step 2: 写 OcoTicket 组件**

```tsx
// src/components/trade/order-form/OcoTicket.tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useSpotBalances } from "@/hooks/useTradingAccount";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { translateError } from "./OrderForm";
import { cn, formatPrice } from "@/lib/utils";

interface OcoTicketProps {
  symbol: string;
  direction: "LONG" | "SHORT";
}

/**
 * 现货 OCO（一取消另一）独立下单表单。三个价格（立即挂出的限价、触发价、
 * 触发后挂出的限价）不适合塞进 PriceFields 那套单价格模型，所以单独成组件，
 * 自己管理提交/确认/结果展示，不复用 OrderForm 主流程的 OrderPreview/
 * OrderConfirmModal（它们的 props 形状是为单价格订单设计的）。
 */
export function OcoTicket({ symbol, direction }: OcoTicketProps) {
  const t = useTranslations();
  const baseAsset = symbol.split("-")[0] ?? symbol;
  const side: "BUY" | "SELL" = direction === "LONG" ? "BUY" : "SELL";

  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? Number(ticker.lastPrice) : 0;
  const { data: balances } = useSpotBalances();
  const availableUsdt = balances?.find((b) => b.asset === "USDT")
    ? parseFloat(balances.find((b) => b.asset === "USDT")!.free)
    : undefined;

  const [notional, setNotional] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canSubmit = () =>
    parseFloat(notional) > 0 &&
    parseFloat(limitPrice) > 0 &&
    parseFloat(triggerPrice) > 0 &&
    parseFloat(orderPrice) > 0;

  const execute = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/bingx/trade/oco-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place",
          symbol, side,
          notionalUsdt: parseFloat(notional),
          limitPrice, triggerPrice, orderPrice,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(translateError(json, t));
      setResult({ ok: true, message: t("trading.order_placed", { id: json.data?.orderListId ?? "" }) });
      setNotional(""); setLimitPrice(""); setTriggerPrice(""); setOrderPrice("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : t("bingx_error.network") });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex-1 space-y-2.5 p-3">
      <p className="text-xs text-text-muted/70">{t("trading.oco.hint")}</p>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
          <span>{t("trading.oco.limit_price")}</span>
          <span className="font-mono tabular-nums">≈ {formatPrice(currentPrice)}</span>
        </div>
        <Input placeholder="0.00" inputMode="decimal" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} className="text-sm" />
      </div>

      <div>
        <div className="mb-1 text-xs text-text-muted">{t("trading.oco.trigger_price")}</div>
        <Input placeholder="0.00" inputMode="decimal" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} className="text-sm" />
      </div>

      <div>
        <div className="mb-1 text-xs text-text-muted">{t("trading.oco.order_price")}</div>
        <Input placeholder="0.00" inputMode="decimal" value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} className="text-sm" />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
          <span>{t("trading.amount_label")}</span>
          {availableUsdt !== undefined && (
            <span>{t("trading.available")}: <span className="font-mono text-text-primary">{availableUsdt.toFixed(2)} USDT</span></span>
          )}
        </div>
        <Input placeholder="0.00" inputMode="decimal" value={notional} onChange={(e) => setNotional(e.target.value)} className="text-sm" />
      </div>

      <Button
        className="w-full"
        variant={direction === "LONG" ? "green" : "red"}
        disabled={!canSubmit()}
        onClick={() => setConfirmOpen(true)}
      >
        {t(direction === "LONG" ? "trading.side.buy" : "trading.side.sell")} {baseAsset} OCO
      </Button>

      {result && (
        <div className={cn("rounded-xs px-3 py-2 text-xs", result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
          {result.message}
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`OCO · ${symbol}`} size="sm">
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <span className="text-text-muted">{t("trading.side")}</span>
            <span className="text-right">{t(direction === "LONG" ? "trading.side.buy" : "trading.side.sell")}</span>
            <span className="text-text-muted">{t("trading.oco.limit_price")}</span>
            <span className="text-right font-mono">{limitPrice}</span>
            <span className="text-text-muted">{t("trading.oco.trigger_price")}</span>
            <span className="text-right font-mono">{triggerPrice}</span>
            <span className="text-text-muted">{t("trading.oco.order_price")}</span>
            <span className="text-right font-mono">{orderPrice}</span>
            <span className="text-text-muted">{t("trading.amount_label")}</span>
            <span className="text-right font-mono">{notional} USDT</span>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="primary" size="sm" disabled={submitting} onClick={execute}>
              {submitting ? "…" : t("trading.confirm_button")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: 在 OrderForm.tsx 里接入**

在文件顶部 import 区域加上：

```typescript
import { OcoTicket } from "./OcoTicket";
```

找到 `return (` 之后的整个 JSX 主体。当前结构是（第一层 `<div className="flex h-full flex-col overflow-auto">` 内部）：方向切换 tab → 方向提示 → `<div className="flex-1 space-y-2.5 p-3">`（内含 uiMode 切换、订单类型按钮网格、LeverageField、PriceFields、TifField、ReduceOnlyField、AmountField、OrderPreview、提交按钮、结果提示）→ `<OrderConfirmModal .../>`。

把订单类型按钮网格结束之后、`{cfg.hasLeverage && (` 开始之前的这个位置作为分界点。具体做法：

把从 `{cfg.hasLeverage && (` 开始，一直到 `</div>`（`flex-1 space-y-2.5 p-3` 这个容器的收尾标签之前那个 `</div>`，也就是结果提示 `{result && (...)}`  块之后）的整段内容，整体包一层条件：

```tsx
        {orderType !== "OCO" && (
          <>
            {cfg.hasLeverage && (
              <LeverageField
                value={leverage}
                maxLeverage={maxLeverage}
                marginType={futuresAccount?.marginType}
                onApply={applyLeverage}
                onApplyMarginType={market === "futures" ? applyMarginType : undefined}
                localOnly={market === "paper"}
                onLocalChange={handleLeverageConfirmed}
              />
            )}

            <PriceFields
              orderType={orderType}
              currentPrice={currentPrice}
              price={price} onPriceChange={setPrice}
              stopPrice={stopPrice} onStopPriceChange={setStopPrice}
              callbackPercent={callbackPercent} onCallbackPercentChange={setCallbackPercent}
              tpPrice={tpPrice} onTpPriceChange={setTpPrice}
              slPrice={slPrice} onSlPriceChange={setSlPrice}
              showTpSl={showTpSl} onToggleTpSl={setShowTpSl}
              allowTpSl={market === "futures"}
            />

            {uiMode === "pro" && isLimit && (
              <TifField value={timeInForce} onChange={setTimeInForce} />
            )}

            {market === "futures" && (
              <ReduceOnlyField value={reduceOnly} onChange={setReduceOnly} />
            )}

            <AmountField
              value={amount} onChange={setAmount}
              availableUsdt={availableUsdt}
              leverage={effectiveLeverage}
              estQty={preview.sizing?.qty}
              baseAsset={baseAsset}
            />

            <OrderPreview
              preview={preview} spec={spec} baseAsset={baseAsset}
              leverage={effectiveLeverage} showMargin={cfg.hasLeverage}
            />

            <Button
              className="w-full"
              variant={direction === "LONG" ? "green" : "red"}
              disabled={!canSubmit()}
              onClick={() => setConfirmOpen(true)}
            >
              {t(direction === "LONG" ? cfg.longLabelKey : cfg.shortLabelKey)} {baseAsset}
              {cfg.hasLeverage ? ` ${effectiveLeverage}x` : ""}
            </Button>

            {result && (
              <div className={cn("rounded-xs px-3 py-2 text-xs", result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
                {result.message}
              </div>
            )}
          </>
        )}

        {orderType === "OCO" && <OcoTicket symbol={symbol} direction={direction} />}
```

（这一整块替换了原来从 `{cfg.hasLeverage && (` 到 `{result && (...)}` 结束的内容，`Amount`/`OrderPreview`/提交按钮/结果提示这几块内部的代码本身一个字都不改，只是被包进了 `{orderType !== "OCO" && (<> ... </>)}`。）

再找到 `<OrderConfirmModal` 那个组件调用（在 `flex-1 space-y-2.5 p-3` 容器结束之后），把它也包一层条件——因为 `OcoTicket` 有自己的确认弹窗，`OrderConfirmModal` 只在非 OCO 时需要挂载：

把：

```typescript
      <OrderConfirmModal
        open={confirmOpen}
```

改成：

```typescript
      {orderType !== "OCO" && (
      <OrderConfirmModal
        open={confirmOpen}
```

并在这个 `<OrderConfirmModal .../>` 调用原本的收尾 `/>` 之后加上对应的 `)}` 闭合括号。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 手动验证**

启动 dev server，打开 `/trade`，现货市场，切到专业模式：

1. 订单类型按钮网格里应该出现"OCO"选项（复用已有的 `trading.type.oco` 翻译）
2. 点选 OCO：应该看到 `OcoTicket` 的三个价格输入框 + 金额输入框 + 提交按钮，原来的杠杆/普通价格字段/TIF/只减仓/AmountField/OrderPreview 全部消失
3. 切回其它订单类型（比如限价单）：应该恢复正常的表单，不应该看到 OCO 相关的任何残留 UI
4. 填好三个价格和金额，点提交按钮，应该弹出 OCO 专属的确认弹窗（不是原来的 `OrderConfirmModal`），确认信息正确展示三个价格
5. 切到合约市场：订单类型按钮网格里不应该出现"OCO"选项（`FUTURES_TYPES` 没加）

Expected: OCO 和普通订单类型的切换互不干扰，两套 UI/提交流程完全独立

- [ ] **Step 6: Commit**

```bash
git add src/components/trade/order-form/OcoTicket.tsx src/components/trade/order-form/config.ts src/components/trade/order-form/OrderForm.tsx
git commit -m "feat(trade): add OcoTicket and wire OCO order type into OrderForm"
```
