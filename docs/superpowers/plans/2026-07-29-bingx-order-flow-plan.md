# BingX 下单链路重建 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重建 Chart-IX 的 BingX 实盘下单链路，使用户绑定 API 密钥后能够在网页内安全、准确地下单，消除会导致下单失败或下错仓位规模的全部缺陷。

**Architecture:** 新增服务端权威的 `src/lib/trading/` 领域层，承担交易对规格获取、USDT 名义额到币数量的换算、精度对齐、持仓模式探测、风控限额与错误码映射。前端取同一份规格仅用于即时预览，服务端在下单前重算一遍，因此绕过 UI 直接请求 API 同样受约束。三种市场（现货 / 合约 / 模拟盘）共用一个下单表单壳，差异以 config 描述。

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5, Supabase (Auth/DB/RLS), TanStack React Query 5, Zustand 5, Tailwind CSS 3, next-intl 4, Vitest（新增，仅 devDependency）

**Spec:** `docs/superpowers/specs/2026-07-29-bingx-order-flow-design.md`

## Global Constraints

- 三语并存：任何新增用户可见文案必须同时补齐 `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`
- API 路由响应格式统一为 `{ success: boolean, data: T }` 或 `{ success: false, error: { message: string } }`
- 前端行情类请求统一走 `src/hooks/useMarketData.ts` 里的 `fetchApi<T>` helper
- 不改动模拟盘的 API 契约（`src/app/api/paper/*`）与 SQL RPC，仅让其调用 `sizing.ts`
- 不接入 VST 模拟环境（`open-api-vst.bingx.com`）
- 不引入 Redis；Vitest 仅作为 devDependency，不进生产包
- 不实现 WebSocket 私有订单流，订单/仓位继续 5s 轮询
- 用户输入的 USDT 金额语义为**仓位名义额**，不是保证金；所需保证金 = 名义额 ÷ 杠杆
- 合约下单一律发送自行换算的 `quantity`（币数量），不使用 `quoteOrderQty`
- 金额换算一律**向下取整**（floor）到 `quantityPrecision`，不得四舍五入
- 签名层 `src/lib/bingx/signed-request.ts` 与 `src/lib/crypto.ts` **不得改动**——已与 BingX 官方实现一致
- `trading_limits` 迁移不预置默认数值；空值即表示不限制

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `package.json` | 修改 | 新增 vitest devDependency 与 `test` / `test:watch` script |
| `vitest.config.ts` | 新增 | 仅纳入 `src/lib/trading/**`，配置 `@/` 别名 |
| `src/types/bingx.ts` | 修改 | 补全 `BingXSymbol` 规格字段、修正 `status` 类型、新增 `BingXSpotSymbolsResponse` |
| `src/types/trading.ts` | 新增 | `SymbolSpec`、`OrderSizing`、`SizeValidation`、`TradingLimits`、`PreflightResult` |
| `src/lib/trading/normalize.ts` | 新增 | 纯函数：BingX 原始规格 → `SymbolSpec` |
| `src/lib/trading/sizing.ts` | 新增 | 纯函数：名义额⇄数量换算、精度对齐、尺寸校验 |
| `src/lib/trading/errors.ts` | 新增 | 纯函数：BingX 错误码 → i18n key |
| `src/lib/trading/limits.ts` | 新增 | 纯函数：风控限额校验 |
| `src/lib/trading/spec.ts` | 新增 | 规格获取 + 1h 内存缓存 |
| `src/lib/trading/account-mode.ts` | 新增 | 持仓模式探测、杠杆与保证金模式读写 |
| `src/lib/trading/persist.ts` | 新增 | 订单落库 + 每日计数 |
| `src/lib/trading/preflight.ts` | 新增 | 编排层，输出规范化下单参数 |
| `src/lib/trading/rate-limit.ts` | 新增 | 内存滑动窗口限流 |
| `src/lib/bingx/market.ts` | 修改 | `getSpotSymbols` 解包 `.symbols` |
| `src/lib/bingx/futures.ts` | 修改 | 修 `priceRate` 覆盖、响应嵌套、`closePosition` 路径、余额 v3 |
| `src/app/api/trading/spec/route.ts` | 新增 | 规格查询路由（无需鉴权） |
| `src/app/api/bingx/trade/order/route.ts` | 修改 | 接入 preflight + persist + 限流 |
| `src/app/api/bingx/futures/order/route.ts` | 修改 | 同上，另加持仓模式解析 |
| `src/app/api/bingx/futures/positions/route.ts` | 修改 | 杠杆/保证金模式改为返回真实结果，余额走 v3 |
| `src/app/api/user/api-keys/route.ts` | 修改 | 双重验证、`api_key_masked`、`is_primary` |
| `src/app/api/user/api-keys/verify/route.ts` | 修改 | 返回 `spotOk` / `futuresOk` |
| `src/app/api/admin/trading-limits/route.ts` | 新增 | 限额配置读写（管理员） |
| `supabase/migrations/020_trading_limits.sql` | 新增 | 限额表、放宽 `orders.order_type`、`api_keys` 增列 |
| `src/hooks/useSymbolSpec.ts` | 新增 | React Query 拉取规格 |
| `src/hooks/useOrderPreflight.ts` | 新增 | 前端预览换算 |
| `src/hooks/useTradingAccount.ts` | 新增 | 实盘余额 / 持仓模式 / 杠杆 |
| `src/components/trade/order-form/OrderForm.tsx` | 新增 | 下单表单壳，三市场共用 |
| `src/components/trade/order-form/config.ts` | 新增 | 三种市场的表单差异配置 |
| `src/components/trade/order-form/fields/AmountField.tsx` | 新增 | 金额 + 百分比 + 余额 + 单位提示 |
| `src/components/trade/order-form/fields/LeverageField.tsx` | 新增 | 杠杆 + 保证金模式显式切换 |
| `src/components/trade/order-form/fields/PriceFields.tsx` | 新增 | price / stopPrice / TP-SL |
| `src/components/trade/order-form/OrderPreview.tsx` | 新增 | 数量 / 保证金 / 强平价 / 手续费预览 |
| `src/components/trade/OrderConfirmModal.tsx` | 修改 | 扩展支持合约字段 |
| `src/components/trade/TradeForm.tsx` | 删除 | 由 `OrderForm` 取代 |
| `src/components/trade/FuturesTradeForm.tsx` | 删除 | 由 `OrderForm` 取代 |
| `src/app/[locale]/trade/page.tsx` | 修改 | 改用 `OrderForm` |
| `src/app/[locale]/settings/api-keys/page.tsx` | 修改 | 真实掩码、双权限状态、重新验证、IP 白名单说明 |
| `src/app/admin/trading-limits/page.tsx` | 新增 | 限额配置管理界面 |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | 修改 | 新增 `trading.*` 与 `bingx_error.*` 文案 |
| `scripts/verify-order-dry-run.mjs` | 新增 | 用官方 `order/test` 端点验证全部合约订单类型 |

---

## 阶段划分

- **阶段 0（Task 1）** — 测试基建
- **阶段 1（Task 2–7）** — `src/lib/trading/` 纯函数层，全程 TDD
- **阶段 2（Task 8–14）** — 数据库迁移与服务端下单链路
- **阶段 3（Task 15–21）** — 前端表单重整与设置页
- **阶段 4（Task 22–23）** — 三语文案与验证脚本

每个阶段结束后代码应处于可构建、可部署状态。

---

## Task 1: 引入 Vitest 测试基建

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/trading/normalize.test.ts`（占位测试，Task 2 填充真实用例）

**Interfaces:**
- Produces: `npm test` 命令，供后续所有纯函数任务使用

- [ ] **Step 1: 安装 vitest**

```bash
npm install --save-dev vitest@^3
```

- [ ] **Step 2: 创建 `vitest.config.ts`**

只纳入 `src/lib/trading/`，避免 vitest 尝试解析 React 组件（项目没有配 jsdom，也不需要）。

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/lib/trading/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: 在 `package.json` 的 `scripts` 中新增两条命令**

在现有 `"lint": "next lint"` 之后追加：

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: 创建占位测试确认基建可用**

创建 `src/lib/trading/normalize.test.ts`：

```typescript
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS，1 passed

- [ ] **Step 6: 确认生产构建未受影响**

Run: `npm run build`
Expected: 构建成功（`vitest.config.ts` 与 `*.test.ts` 不应进入 Next.js 构建）

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/trading/normalize.test.ts
git commit -m "chore: add vitest for trading pure-function tests"
```

---

## Task 2: 交易类型定义与规格归一化

**Files:**
- Modify: `src/types/bingx.ts`
- Create: `src/types/trading.ts`
- Create: `src/lib/trading/normalize.ts`
- Test: `src/lib/trading/normalize.test.ts`（替换 Task 1 的占位内容）

**Interfaces:**
- Consumes: 无
- Produces:
  - `SymbolSpec`（`src/types/trading.ts`）
  - `normalizeSpotSymbol(raw: BingXSymbol): SymbolSpec`
  - `normalizeFuturesContract(raw: BingXContract, side: "LONG" | "SHORT"): SymbolSpec`

- [ ] **Step 1: 修正并补全 `src/types/bingx.ts` 中的规格类型**

将现有 `BingXSymbol`（第 3–11 行）整体替换为：

```typescript
/** 现货交易对规格。来源：GET /openApi/spot/v1/common/symbols（响应嵌套在 data.symbols） */
export interface BingXSymbol {
  symbol: string;
  minQty: number;
  maxQty: number;
  minNotional: number;
  maxNotional: number;
  tickSize: number;
  stepSize: number;
  /** 1 = 可交易，0 = 停用 */
  status: number;
}

/** 现货规格接口的实际响应包装 */
export interface BingXSpotSymbolsResponse {
  symbols: BingXSymbol[];
}
```

将现有 `BingXContract`（第 70–79 行）整体替换为：

```typescript
/** 合约规格。来源：GET /openApi/swap/v2/quote/contracts */
export interface BingXContract {
  symbol: string;
  asset: string;
  currency: string;
  size: string;
  pricePrecision: number;
  quantityPrecision: number;
  tradeMinQuantity: number;
  tradeMinUSDT: number;
  maxLongLeverage: number;
  maxShortLeverage: number;
  makerFeeRate: number;
  takerFeeRate: number;
  /** 1 = 可交易，0 = 停用 */
  status: number;
  apiStateOpen: string;
  apiStateClose: string;
}
```

- [ ] **Step 2: 创建 `src/types/trading.ts`**

```typescript
export type TradingMarket = "spot" | "futures";

/** 归一化后的交易对规格，现货与合约共用同一形状 */
export interface SymbolSpec {
  symbol: string;
  market: TradingMarket;
  /** 价格小数位 */
  pricePrecision: number;
  /** 数量小数位 */
  quantityPrecision: number;
  /** 最小下单数量（基础币） */
  minQty: number;
  /** 最小下单名义额（USDT） */
  minNotional: number;
  /** 最大杠杆，仅合约有值 */
  maxLeverage?: number;
  /** taker 费率，用于预览估算手续费；无数据时为 undefined */
  takerFeeRate?: number;
  tradable: boolean;
}
```

- [ ] **Step 3: 写失败的测试**

将 `src/lib/trading/normalize.test.ts` 全部内容替换为：

```typescript
import { describe, it, expect } from "vitest";
import { normalizeSpotSymbol, normalizeFuturesContract } from "./normalize";
import type { BingXSymbol, BingXContract } from "@/types/bingx";

const spotRaw: BingXSymbol = {
  symbol: "BTC-USDT",
  minQty: 0.0001,
  maxQty: 100,
  minNotional: 5,
  maxNotional: 1000000,
  tickSize: 0.1,
  stepSize: 0.000001,
  status: 1,
};

const futuresRaw: BingXContract = {
  symbol: "BTC-USDT",
  asset: "BTC",
  currency: "USDT",
  size: "1",
  pricePrecision: 1,
  quantityPrecision: 4,
  tradeMinQuantity: 0.0001,
  tradeMinUSDT: 2,
  maxLongLeverage: 125,
  maxShortLeverage: 100,
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0005,
  status: 1,
  apiStateOpen: "true",
  apiStateClose: "true",
};

describe("normalizeSpotSymbol", () => {
  it("derives precision from tickSize and stepSize", () => {
    const spec = normalizeSpotSymbol(spotRaw);
    expect(spec.pricePrecision).toBe(1);
    expect(spec.quantityPrecision).toBe(6);
  });

  it("carries min quantity and min notional through", () => {
    const spec = normalizeSpotSymbol(spotRaw);
    expect(spec.minQty).toBe(0.0001);
    expect(spec.minNotional).toBe(5);
    expect(spec.market).toBe("spot");
  });

  it("marks status other than 1 as not tradable", () => {
    expect(normalizeSpotSymbol({ ...spotRaw, status: 0 }).tradable).toBe(false);
    expect(normalizeSpotSymbol(spotRaw).tradable).toBe(true);
  });

  it("handles integer tickSize as zero precision", () => {
    const spec = normalizeSpotSymbol({ ...spotRaw, tickSize: 1, stepSize: 1 });
    expect(spec.pricePrecision).toBe(0);
    expect(spec.quantityPrecision).toBe(0);
  });

  it("leaves maxLeverage undefined for spot", () => {
    expect(normalizeSpotSymbol(spotRaw).maxLeverage).toBeUndefined();
  });
});

describe("normalizeFuturesContract", () => {
  it("uses the long leverage cap for LONG", () => {
    expect(normalizeFuturesContract(futuresRaw, "LONG").maxLeverage).toBe(125);
  });

  it("uses the short leverage cap for SHORT", () => {
    expect(normalizeFuturesContract(futuresRaw, "SHORT").maxLeverage).toBe(100);
  });

  it("maps tradeMinUSDT to minNotional and tradeMinQuantity to minQty", () => {
    const spec = normalizeFuturesContract(futuresRaw, "LONG");
    expect(spec.minNotional).toBe(2);
    expect(spec.minQty).toBe(0.0001);
    expect(spec.market).toBe("futures");
  });

  it("is not tradable when the API open state is false", () => {
    const spec = normalizeFuturesContract({ ...futuresRaw, apiStateOpen: "false" }, "LONG");
    expect(spec.tradable).toBe(false);
  });

  it("is not tradable when status is 0 even if apiStateOpen is true", () => {
    const spec = normalizeFuturesContract({ ...futuresRaw, status: 0 }, "LONG");
    expect(spec.tradable).toBe(false);
  });

  it("carries the taker fee rate for preview estimates", () => {
    expect(normalizeFuturesContract(futuresRaw, "LONG").takerFeeRate).toBe(0.0005);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./normalize"`

- [ ] **Step 5: 实现 `src/lib/trading/normalize.ts`**

```typescript
import type { BingXSymbol, BingXContract } from "@/types/bingx";
import type { SymbolSpec } from "@/types/trading";

/**
 * 由最小增量（如 0.000001）推导小数位数。
 * BingX 现货只给增量不给位数，合约反之。
 */
export function precisionFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  if (step >= 1) return 0;
  // 用指数记数法避免 0.0000001 被格式化成 "1e-7"
  const exponent = Math.round(Math.log10(step));
  return Math.max(0, -exponent);
}

export function normalizeSpotSymbol(raw: BingXSymbol): SymbolSpec {
  return {
    symbol: raw.symbol,
    market: "spot",
    pricePrecision: precisionFromStep(raw.tickSize),
    quantityPrecision: precisionFromStep(raw.stepSize),
    minQty: raw.minQty,
    minNotional: raw.minNotional,
    tradable: raw.status === 1,
  };
}

export function normalizeFuturesContract(
  raw: BingXContract,
  side: "LONG" | "SHORT"
): SymbolSpec {
  return {
    symbol: raw.symbol,
    market: "futures",
    pricePrecision: raw.pricePrecision,
    quantityPrecision: raw.quantityPrecision,
    minQty: raw.tradeMinQuantity,
    minNotional: raw.tradeMinUSDT,
    maxLeverage: side === "LONG" ? raw.maxLongLeverage : raw.maxShortLeverage,
    takerFeeRate: raw.takerFeeRate,
    tradable: raw.status === 1 && raw.apiStateOpen === "true",
  };
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test`
Expected: PASS，12 passed

- [ ] **Step 7: 修正 `getSpotSymbols` 的响应解包**

`src/lib/bingx/market.ts` 第 17–21 行整体替换为：

```typescript
/** 获取现货交易对列表。注意：BingX 把数组嵌在 data.symbols 里 */
export async function getSpotSymbols(symbol?: string): Promise<BingXSymbol[]> {
  const res = await bingxClient.publicRequest<BingXSpotSymbolsResponse>(
    "/openApi/spot/v1/common/symbols",
    { symbol }
  );
  return res.symbols ?? [];
}
```

同时把 `BingXSpotSymbolsResponse` 加入该文件顶部的 `import type { ... } from "@/types/bingx"` 列表。

- [ ] **Step 8: 确认类型检查与构建通过**

Run: `npm run build`
Expected: 构建成功。若 `useSpotSymbols` 或 `MarketOverview` 因 `BingXSymbol` 字段变更报错，按新类型修正调用处——现货规格接口不再提供 `baseAsset` / `quoteAsset`，需要基础币名时用 `symbol.split("-")[0]`。

- [ ] **Step 9: Commit**

```bash
git add src/types/bingx.ts src/types/trading.ts src/lib/trading/normalize.ts src/lib/trading/normalize.test.ts src/lib/bingx/market.ts
git commit -m "feat(trading): add symbol spec normalization with correct BingX response shapes"
```

---

## Task 3: 金额换算与尺寸校验（`sizing.ts`）

这是整条链路里唯一直接决定「下多大仓」的模块，算错就是真金白银的损失。测试覆盖要求最高。

**Files:**
- Create: `src/lib/trading/sizing.ts`
- Test: `src/lib/trading/sizing.test.ts`
- Modify: `src/types/trading.ts`

**Interfaces:**
- Consumes: `SymbolSpec`（Task 2）
- Produces:
  - `floorToPrecision(value: number, precision: number): number`
  - `quoteToBase(quoteUsdt: number, price: number, spec: SymbolSpec): OrderSizing`
  - `validateOrderSize(sizing: OrderSizing, spec: SymbolSpec): SizeValidation`
  - `requiredMargin(notional: number, leverage: number): number`
  - `formatQty(qty: number, spec: SymbolSpec): string`
  - `roundPrice(price: number, spec: SymbolSpec): string`
  - 类型 `OrderSizing`、`SizeValidation`、`SizeValidationReason`

- [ ] **Step 1: 在 `src/types/trading.ts` 末尾追加类型**

```typescript
/** 一次名义额→数量换算的结果 */
export interface OrderSizing {
  /** 对齐精度后的币数量 */
  qty: number;
  /** 按对齐后数量重算的实际名义额（USDT），可能略低于用户输入 */
  notional: number;
  /** 换算用的参考价 */
  price: number;
}

export type SizeValidationReason =
  | "BELOW_MIN_QTY"
  | "BELOW_MIN_NOTIONAL"
  | "ZERO_AFTER_ROUNDING"
  | "NOT_TRADABLE"
  | "INVALID_INPUT";

export type SizeValidation =
  | { ok: true }
  | { ok: false; reason: SizeValidationReason; limit?: number };
```

- [ ] **Step 2: 写失败的测试**

创建 `src/lib/trading/sizing.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import {
  floorToPrecision,
  quoteToBase,
  validateOrderSize,
  requiredMargin,
  formatQty,
  roundPrice,
} from "./sizing";
import type { SymbolSpec } from "@/types/trading";

const btcSpot: SymbolSpec = {
  symbol: "BTC-USDT",
  market: "spot",
  pricePrecision: 1,
  quantityPrecision: 6,
  minQty: 0.0001,
  minNotional: 5,
  tradable: true,
};

const btcFutures: SymbolSpec = {
  symbol: "BTC-USDT",
  market: "futures",
  pricePrecision: 1,
  quantityPrecision: 4,
  minQty: 0.0001,
  minNotional: 2,
  maxLeverage: 125,
  takerFeeRate: 0.0005,
  tradable: true,
};

describe("floorToPrecision", () => {
  it("truncates rather than rounds", () => {
    expect(floorToPrecision(0.123456789, 4)).toBe(0.1234);
    expect(floorToPrecision(0.99999, 2)).toBe(0.99);
  });

  it("handles zero precision", () => {
    expect(floorToPrecision(7.9, 0)).toBe(7);
  });

  it("does not produce floating point noise", () => {
    expect(floorToPrecision(0.07 * 3, 2)).toBe(0.21);
    expect(floorToPrecision(0.29, 2)).toBe(0.29);
  });

  it("returns 0 for non-finite input", () => {
    expect(floorToPrecision(NaN, 2)).toBe(0);
    expect(floorToPrecision(Infinity, 2)).toBe(0);
  });
});

describe("quoteToBase", () => {
  it("converts a USDT notional into a coin quantity", () => {
    const s = quoteToBase(1000, 50000, btcFutures);
    expect(s.qty).toBe(0.02);
    expect(s.price).toBe(50000);
  });

  it("floors the quantity so the notional never exceeds the budget", () => {
    const s = quoteToBase(100, 33333, btcFutures);
    expect(s.qty).toBe(0.003);
    expect(s.notional).toBeLessThanOrEqual(100);
  });

  it("recomputes notional from the floored quantity", () => {
    const s = quoteToBase(100, 33333, btcFutures);
    expect(s.notional).toBeCloseTo(0.003 * 33333, 8);
  });

  it("returns zero quantity when the budget is below one precision step", () => {
    const s = quoteToBase(1, 50000, btcFutures);
    expect(s.qty).toBe(0);
  });

  it("returns zero for a non-positive price", () => {
    expect(quoteToBase(100, 0, btcFutures).qty).toBe(0);
    expect(quoteToBase(100, -1, btcFutures).qty).toBe(0);
  });

  it("returns zero for a non-positive notional", () => {
    expect(quoteToBase(0, 50000, btcFutures).qty).toBe(0);
    expect(quoteToBase(-10, 50000, btcFutures).qty).toBe(0);
  });

  it("uses the spot precision for spot symbols", () => {
    const s = quoteToBase(100, 33333, btcSpot);
    expect(s.qty).toBe(0.003);
  });
});

describe("validateOrderSize", () => {
  it("accepts an order above both minimums", () => {
    expect(validateOrderSize(quoteToBase(1000, 50000, btcFutures), btcFutures)).toEqual({ ok: true });
  });

  it("rejects a quantity that rounds to zero", () => {
    const r = validateOrderSize(quoteToBase(1, 50000, btcFutures), btcFutures);
    expect(r).toEqual({ ok: false, reason: "ZERO_AFTER_ROUNDING" });
  });

  it("rejects a notional below the symbol minimum", () => {
    const r = validateOrderSize({ qty: 0.00006, notional: 3, price: 50000 }, btcSpot);
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_NOTIONAL", limit: 5 });
  });

  it("rejects a quantity below the symbol minimum", () => {
    const r = validateOrderSize({ qty: 0.00005, notional: 10, price: 200000 }, btcFutures);
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_QTY", limit: 0.0001 });
  });

  it("rejects a symbol that is not tradable", () => {
    const spec = { ...btcFutures, tradable: false };
    const r = validateOrderSize(quoteToBase(1000, 50000, spec), spec);
    expect(r).toEqual({ ok: false, reason: "NOT_TRADABLE" });
  });

  it("checks tradability before anything else", () => {
    const spec = { ...btcFutures, tradable: false };
    const r = validateOrderSize({ qty: 0, notional: 0, price: 0 }, spec);
    expect(r).toEqual({ ok: false, reason: "NOT_TRADABLE" });
  });
});

describe("requiredMargin", () => {
  it("divides notional by leverage", () => {
    expect(requiredMargin(1000, 10)).toBe(100);
  });

  it("treats leverage below 1 as 1", () => {
    expect(requiredMargin(1000, 0)).toBe(1000);
    expect(requiredMargin(1000, -5)).toBe(1000);
  });
});

describe("formatQty and roundPrice", () => {
  it("emits a fixed-precision string without exponent notation", () => {
    expect(formatQty(0.00002, { ...btcFutures, quantityPrecision: 8 })).toBe("0.00002000");
    expect(formatQty(1, btcFutures)).toBe("1.0000");
  });

  it("rounds price to the symbol price precision", () => {
    expect(roundPrice(50000.16, btcFutures)).toBe("50000.2");
    expect(roundPrice(50000.14, btcFutures)).toBe("50000.1");
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./sizing"`

- [ ] **Step 4: 实现 `src/lib/trading/sizing.ts`**

```typescript
import type { SymbolSpec, OrderSizing, SizeValidation } from "@/types/trading";

/**
 * 向下截断到指定小数位。
 * 先用 toFixed 把数字规整到比目标多几位的十进制表示，再做截断，
 * 以消除 IEEE754 误差——否则 0.29 * 100 = 28.999999999999996 会被截成 0.28。
 */
export function floorToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0;
  const p = Math.max(0, Math.floor(precision));
  const normalized = Number(value.toFixed(Math.min(p + 4, 100)));
  const factor = Math.pow(10, p);
  return Math.floor(normalized * factor) / factor;
}

/** 把 USDT 名义额按参考价换算成对齐精度的币数量 */
export function quoteToBase(
  quoteUsdt: number,
  price: number,
  spec: SymbolSpec
): OrderSizing {
  if (!Number.isFinite(quoteUsdt) || quoteUsdt <= 0 || !Number.isFinite(price) || price <= 0) {
    return { qty: 0, notional: 0, price: price > 0 ? price : 0 };
  }
  const qty = floorToPrecision(quoteUsdt / price, spec.quantityPrecision);
  return { qty, notional: qty * price, price };
}

export function validateOrderSize(sizing: OrderSizing, spec: SymbolSpec): SizeValidation {
  if (!spec.tradable) return { ok: false, reason: "NOT_TRADABLE" };
  if (!Number.isFinite(sizing.qty) || !Number.isFinite(sizing.notional)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }
  if (sizing.qty <= 0) return { ok: false, reason: "ZERO_AFTER_ROUNDING" };
  if (sizing.notional < spec.minNotional) {
    return { ok: false, reason: "BELOW_MIN_NOTIONAL", limit: spec.minNotional };
  }
  if (sizing.qty < spec.minQty) {
    return { ok: false, reason: "BELOW_MIN_QTY", limit: spec.minQty };
  }
  return { ok: true };
}

/** 所需保证金 = 名义额 ÷ 杠杆。杠杆 < 1 视为 1（现货即为 1x） */
export function requiredMargin(notional: number, leverage: number): number {
  const lev = Number.isFinite(leverage) && leverage >= 1 ? leverage : 1;
  return notional / lev;
}

/** 数量转定长字符串。BingX 不接受指数记数法 */
export function formatQty(qty: number, spec: SymbolSpec): string {
  return qty.toFixed(Math.max(0, spec.quantityPrecision));
}

export function roundPrice(price: number, spec: SymbolSpec): string {
  return price.toFixed(Math.max(0, spec.pricePrecision));
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS，normalize 12 项 + sizing 21 项全部通过

- [ ] **Step 6: Commit**

```bash
git add src/types/trading.ts src/lib/trading/sizing.ts src/lib/trading/sizing.test.ts
git commit -m "feat(trading): add order sizing with floor-based precision alignment"
```

---

## Task 4: BingX 错误码映射（`errors.ts`）

`signedRequest` 抛出的错误形如 `Error("BingX error 101204: insufficient margin")`，也可能是网络层的普通 Error。两种都要能处理，且原始信息永不丢弃。

**Files:**
- Create: `src/lib/trading/errors.ts`
- Test: `src/lib/trading/errors.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `parseBingXError(raw: unknown): { code: number | null; rawMessage: string }`
  - `bingxErrorI18nKey(code: number | null): string`
  - `describeBingXError(raw: unknown): { i18nKey: string; code: number | null; rawMessage: string }`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/trading/errors.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { parseBingXError, bingxErrorI18nKey, describeBingXError } from "./errors";

describe("parseBingXError", () => {
  it("extracts the numeric code from a signedRequest error", () => {
    const r = parseBingXError(new Error("BingX error 101204: insufficient margin"));
    expect(r.code).toBe(101204);
    expect(r.rawMessage).toBe("insufficient margin");
  });

  it("handles an error with an empty message body", () => {
    const r = parseBingXError(new Error("BingX error 100001: "));
    expect(r.code).toBe(100001);
    expect(r.rawMessage).toBe("");
  });

  it("returns a null code for a plain network error", () => {
    const r = parseBingXError(new Error("fetch failed"));
    expect(r.code).toBeNull();
    expect(r.rawMessage).toBe("fetch failed");
  });

  it("handles a non-Error value", () => {
    expect(parseBingXError("boom").code).toBeNull();
    expect(parseBingXError("boom").rawMessage).toBe("boom");
    expect(parseBingXError(undefined).rawMessage).toBe("");
  });
});

describe("bingxErrorI18nKey", () => {
  it("maps known codes to specific keys", () => {
    expect(bingxErrorI18nKey(100001)).toBe("bingx_error.signature");
    expect(bingxErrorI18nKey(100004)).toBe("bingx_error.no_permission");
    expect(bingxErrorI18nKey(100413)).toBe("bingx_error.invalid_key");
    expect(bingxErrorI18nKey(101204)).toBe("bingx_error.insufficient_margin");
    expect(bingxErrorI18nKey(109400)).toBe("bingx_error.invalid_params");
    expect(bingxErrorI18nKey(80014)).toBe("bingx_error.invalid_params");
  });

  it("falls back to the generic key for unknown codes", () => {
    expect(bingxErrorI18nKey(999999)).toBe("bingx_error.unknown");
  });

  it("falls back to the network key when there is no code", () => {
    expect(bingxErrorI18nKey(null)).toBe("bingx_error.network");
  });
});

describe("describeBingXError", () => {
  it("keeps the raw message alongside the i18n key so nothing is swallowed", () => {
    const d = describeBingXError(new Error("BingX error 101204: insufficient margin"));
    expect(d).toEqual({
      i18nKey: "bingx_error.insufficient_margin",
      code: 101204,
      rawMessage: "insufficient margin",
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./errors"`

- [ ] **Step 3: 实现 `src/lib/trading/errors.ts`**

```typescript
/** signedRequest 抛出的形如 "BingX error 101204: msg" */
const BINGX_ERROR_PATTERN = /^BingX error (-?\d+):\s?(.*)$/s;

const CODE_TO_KEY: Record<number, string> = {
  100001: "bingx_error.signature",
  100004: "bingx_error.no_permission",
  100413: "bingx_error.invalid_key",
  101204: "bingx_error.insufficient_margin",
  109400: "bingx_error.invalid_params",
  100400: "bingx_error.invalid_params",
  80014: "bingx_error.invalid_params",
  80012: "bingx_error.service_busy",
  80013: "bingx_error.service_busy",
};

export function parseBingXError(raw: unknown): { code: number | null; rawMessage: string } {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : raw == null
          ? ""
          : String(raw);
  const match = BINGX_ERROR_PATTERN.exec(text);
  if (!match) return { code: null, rawMessage: text };
  return { code: Number(match[1]), rawMessage: match[2] ?? "" };
}

export function bingxErrorI18nKey(code: number | null): string {
  if (code === null) return "bingx_error.network";
  return CODE_TO_KEY[code] ?? "bingx_error.unknown";
}

/** 同时给出可翻译的 key 与原始信息——原文永远保留，便于排查未覆盖的错误码 */
export function describeBingXError(raw: unknown): {
  i18nKey: string;
  code: number | null;
  rawMessage: string;
} {
  const { code, rawMessage } = parseBingXError(raw);
  return { i18nKey: bingxErrorI18nKey(code), code, rawMessage };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/errors.ts src/lib/trading/errors.test.ts
git commit -m "feat(trading): map BingX error codes to translatable keys"
```

---

## Task 5: 风控限额校验（`limits.ts`）

**空值语义（来自 spec）：字段为 `null` 即该项不限制。** 用户级配置逐字段覆盖全局默认；用户侧的 `null` 表示「未覆盖」而非「不限制」。

**Files:**
- Create: `src/lib/trading/limits.ts`
- Test: `src/lib/trading/limits.test.ts`
- Modify: `src/types/trading.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - 类型 `TradingLimits`、`LimitCheckInput`、`LimitRejectReason`、`LimitCheck`
  - `mergeLimits(global: TradingLimits | null, user: TradingLimits | null): TradingLimits`
  - `checkLimits(input: LimitCheckInput, limits: TradingLimits): LimitCheck`

- [ ] **Step 1: 在 `src/types/trading.ts` 末尾追加类型**

```typescript
/** 风控限额配置。任一字段为 null 表示该项不限制 */
export interface TradingLimits {
  maxNotionalPerOrder: number | null;
  maxOrdersPerDay: number | null;
  maxLeverage: number | null;
  allowedSymbols: string[] | null;
}

export interface LimitCheckInput {
  symbol: string;
  notional: number;
  leverage: number;
  ordersToday: number;
}

export type LimitRejectReason =
  | "NOTIONAL_TOO_LARGE"
  | "DAILY_LIMIT_REACHED"
  | "LEVERAGE_TOO_HIGH"
  | "SYMBOL_NOT_ALLOWED";

export type LimitCheck =
  | { ok: true }
  | { ok: false; reason: LimitRejectReason; limit: number | string };
```

- [ ] **Step 2: 写失败的测试**

创建 `src/lib/trading/limits.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { mergeLimits, checkLimits } from "./limits";
import type { TradingLimits, LimitCheckInput } from "@/types/trading";

const unlimited: TradingLimits = {
  maxNotionalPerOrder: null,
  maxOrdersPerDay: null,
  maxLeverage: null,
  allowedSymbols: null,
};

const baseInput: LimitCheckInput = {
  symbol: "BTC-USDT",
  notional: 100,
  leverage: 10,
  ordersToday: 0,
};

describe("mergeLimits", () => {
  it("returns an unlimited config when both sides are null", () => {
    expect(mergeLimits(null, null)).toEqual(unlimited);
  });

  it("uses the global config when the user has none", () => {
    const global = { ...unlimited, maxNotionalPerOrder: 500 };
    expect(mergeLimits(global, null).maxNotionalPerOrder).toBe(500);
  });

  it("lets a user value override the global value field by field", () => {
    const global = { ...unlimited, maxNotionalPerOrder: 500, maxLeverage: 20 };
    const user = { ...unlimited, maxNotionalPerOrder: 1000 };
    const merged = mergeLimits(global, user);
    expect(merged.maxNotionalPerOrder).toBe(1000);
    expect(merged.maxLeverage).toBe(20);
  });

  it("treats a user null as not-overridden rather than unlimited", () => {
    const global = { ...unlimited, maxLeverage: 20 };
    const user = { ...unlimited, maxNotionalPerOrder: 1000 };
    expect(mergeLimits(global, user).maxLeverage).toBe(20);
  });
});

describe("checkLimits", () => {
  it("passes when nothing is configured", () => {
    expect(checkLimits(baseInput, unlimited)).toEqual({ ok: true });
  });

  it("rejects a notional above the cap", () => {
    const r = checkLimits({ ...baseInput, notional: 600 }, { ...unlimited, maxNotionalPerOrder: 500 });
    expect(r).toEqual({ ok: false, reason: "NOTIONAL_TOO_LARGE", limit: 500 });
  });

  it("accepts a notional exactly at the cap", () => {
    expect(
      checkLimits({ ...baseInput, notional: 500 }, { ...unlimited, maxNotionalPerOrder: 500 })
    ).toEqual({ ok: true });
  });

  it("rejects when the daily order count is already at the cap", () => {
    const r = checkLimits({ ...baseInput, ordersToday: 10 }, { ...unlimited, maxOrdersPerDay: 10 });
    expect(r).toEqual({ ok: false, reason: "DAILY_LIMIT_REACHED", limit: 10 });
  });

  it("accepts when the daily count is one below the cap", () => {
    expect(
      checkLimits({ ...baseInput, ordersToday: 9 }, { ...unlimited, maxOrdersPerDay: 10 })
    ).toEqual({ ok: true });
  });

  it("rejects leverage above the cap", () => {
    const r = checkLimits({ ...baseInput, leverage: 50 }, { ...unlimited, maxLeverage: 20 });
    expect(r).toEqual({ ok: false, reason: "LEVERAGE_TOO_HIGH", limit: 20 });
  });

  it("rejects a symbol outside the allowlist", () => {
    const r = checkLimits(baseInput, { ...unlimited, allowedSymbols: ["ETH-USDT"] });
    expect(r).toEqual({ ok: false, reason: "SYMBOL_NOT_ALLOWED", limit: "ETH-USDT" });
  });

  it("accepts a symbol inside the allowlist", () => {
    expect(
      checkLimits(baseInput, { ...unlimited, allowedSymbols: ["BTC-USDT", "ETH-USDT"] })
    ).toEqual({ ok: true });
  });

  it("treats an empty allowlist as blocking everything", () => {
    expect(checkLimits(baseInput, { ...unlimited, allowedSymbols: [] }).ok).toBe(false);
  });

  it("reports the symbol rule before the size rule when both fail", () => {
    const r = checkLimits(
      { ...baseInput, notional: 9999 },
      { ...unlimited, maxNotionalPerOrder: 500, allowedSymbols: ["ETH-USDT"] }
    );
    expect(r).toMatchObject({ ok: false, reason: "SYMBOL_NOT_ALLOWED" });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./limits"`

- [ ] **Step 4: 实现 `src/lib/trading/limits.ts`**

```typescript
import type { TradingLimits, LimitCheckInput, LimitCheck } from "@/types/trading";

const UNLIMITED: TradingLimits = {
  maxNotionalPerOrder: null,
  maxOrdersPerDay: null,
  maxLeverage: null,
  allowedSymbols: null,
};

/**
 * 用户级配置逐字段覆盖全局默认。
 * 用户侧的 null 表示「未覆盖」而非「不限制」——要给单个用户解除某项限制，
 * 需在该用户行里显式写一个足够大的值。
 */
export function mergeLimits(
  global: TradingLimits | null,
  user: TradingLimits | null
): TradingLimits {
  const g = global ?? UNLIMITED;
  if (!user) return { ...g };
  return {
    maxNotionalPerOrder: user.maxNotionalPerOrder ?? g.maxNotionalPerOrder,
    maxOrdersPerDay: user.maxOrdersPerDay ?? g.maxOrdersPerDay,
    maxLeverage: user.maxLeverage ?? g.maxLeverage,
    allowedSymbols: user.allowedSymbols ?? g.allowedSymbols,
  };
}

export function checkLimits(input: LimitCheckInput, limits: TradingLimits): LimitCheck {
  // 先判交易对：不允许交易时，报「这个币不能交易」比报「金额超限」更有用
  if (limits.allowedSymbols !== null && !limits.allowedSymbols.includes(input.symbol)) {
    return { ok: false, reason: "SYMBOL_NOT_ALLOWED", limit: limits.allowedSymbols.join(", ") };
  }
  if (limits.maxOrdersPerDay !== null && input.ordersToday >= limits.maxOrdersPerDay) {
    return { ok: false, reason: "DAILY_LIMIT_REACHED", limit: limits.maxOrdersPerDay };
  }
  if (limits.maxLeverage !== null && input.leverage > limits.maxLeverage) {
    return { ok: false, reason: "LEVERAGE_TOO_HIGH", limit: limits.maxLeverage };
  }
  if (limits.maxNotionalPerOrder !== null && input.notional > limits.maxNotionalPerOrder) {
    return { ok: false, reason: "NOTIONAL_TOO_LARGE", limit: limits.maxNotionalPerOrder };
  }
  return { ok: true };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/trading.ts src/lib/trading/limits.ts src/lib/trading/limits.test.ts
git commit -m "feat(trading): add risk limit merging and validation"
```

---

## Task 6: 规格获取与缓存（`spec.ts` + 查询路由）

**Files:**
- Create: `src/lib/trading/spec.ts`
- Create: `src/lib/trading/spec.test.ts`
- Create: `src/app/api/trading/spec/route.ts`

**Interfaces:**
- Consumes: `normalizeSpotSymbol` / `normalizeFuturesContract`（Task 2）、`getSpotSymbols` / `getFuturesContracts`（`src/lib/bingx/market.ts`）
- Produces:
  - `getSymbolSpec(symbol: string, market: TradingMarket, side?: "LONG" | "SHORT"): Promise<SymbolSpec | null>`
  - `clearSpecCache(): void`（仅供测试使用）
  - 路由 `GET /api/trading/spec?symbol=BTC-USDT&market=futures&side=LONG` → `{ success: true, data: SymbolSpec }`

缓存策略：规格几乎不变，整份列表缓存 1 小时。缓存的是**原始列表**而非归一化结果，因为合约规格要按 LONG/SHORT 取不同的 `maxLeverage`。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/trading/spec.test.ts`。用 `vi.mock` 替换 BingX 网络层，只测缓存与查找逻辑：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BingXSymbol, BingXContract } from "@/types/bingx";

const spotRows: BingXSymbol[] = [
  { symbol: "BTC-USDT", minQty: 0.0001, maxQty: 100, minNotional: 5, maxNotional: 1e6, tickSize: 0.1, stepSize: 0.000001, status: 1 },
];

const futuresRows: BingXContract[] = [
  {
    symbol: "BTC-USDT", asset: "BTC", currency: "USDT", size: "1",
    pricePrecision: 1, quantityPrecision: 4, tradeMinQuantity: 0.0001, tradeMinUSDT: 2,
    maxLongLeverage: 125, maxShortLeverage: 100, makerFeeRate: 0.0002, takerFeeRate: 0.0005,
    status: 1, apiStateOpen: "true", apiStateClose: "true",
  },
];

const getSpotSymbols = vi.fn();
const getFuturesContracts = vi.fn();

vi.mock("@/lib/bingx/market", () => ({
  getSpotSymbols: (...args: unknown[]) => getSpotSymbols(...args),
  getFuturesContracts: (...args: unknown[]) => getFuturesContracts(...args),
}));

const { getSymbolSpec, clearSpecCache } = await import("./spec");

beforeEach(() => {
  clearSpecCache();
  getSpotSymbols.mockReset().mockResolvedValue(spotRows);
  getFuturesContracts.mockReset().mockResolvedValue(futuresRows);
});

describe("getSymbolSpec", () => {
  it("returns a normalized spot spec", async () => {
    const spec = await getSymbolSpec("BTC-USDT", "spot");
    expect(spec).toMatchObject({ symbol: "BTC-USDT", market: "spot", minNotional: 5, quantityPrecision: 6 });
  });

  it("returns a normalized futures spec with the side-specific leverage cap", async () => {
    expect((await getSymbolSpec("BTC-USDT", "futures", "LONG"))?.maxLeverage).toBe(125);
    expect((await getSymbolSpec("BTC-USDT", "futures", "SHORT"))?.maxLeverage).toBe(100);
  });

  it("defaults to the LONG leverage cap when no side is given", async () => {
    expect((await getSymbolSpec("BTC-USDT", "futures"))?.maxLeverage).toBe(125);
  });

  it("returns null for an unknown symbol", async () => {
    expect(await getSymbolSpec("NOPE-USDT", "spot")).toBeNull();
  });

  it("fetches the list only once across repeated lookups", async () => {
    await getSymbolSpec("BTC-USDT", "spot");
    await getSymbolSpec("BTC-USDT", "spot");
    await getSymbolSpec("BTC-USDT", "spot");
    expect(getSpotSymbols).toHaveBeenCalledTimes(1);
  });

  it("does not share cache between spot and futures", async () => {
    await getSymbolSpec("BTC-USDT", "spot");
    await getSymbolSpec("BTC-USDT", "futures");
    expect(getSpotSymbols).toHaveBeenCalledTimes(1);
    expect(getFuturesContracts).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch", async () => {
    getSpotSymbols.mockRejectedValueOnce(new Error("network down"));
    await expect(getSymbolSpec("BTC-USDT", "spot")).rejects.toThrow("network down");
    getSpotSymbols.mockResolvedValue(spotRows);
    expect(await getSymbolSpec("BTC-USDT", "spot")).not.toBeNull();
  });

  it("coalesces concurrent lookups into a single fetch", async () => {
    const [a, b] = await Promise.all([
      getSymbolSpec("BTC-USDT", "spot"),
      getSymbolSpec("BTC-USDT", "spot"),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(getSpotSymbols).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./spec"`

- [ ] **Step 3: 实现 `src/lib/trading/spec.ts`**

```typescript
import { getSpotSymbols, getFuturesContracts } from "@/lib/bingx/market";
import { normalizeSpotSymbol, normalizeFuturesContract } from "./normalize";
import type { BingXSymbol, BingXContract } from "@/types/bingx";
import type { SymbolSpec, TradingMarket } from "@/types/trading";

const TTL_MS = 60 * 60 * 1000;

type Entry<T> = { rows: T[]; expiresAt: number };

let spotCache: Entry<BingXSymbol> | null = null;
let futuresCache: Entry<BingXContract> | null = null;
// 并发合并：同一时刻只允许一个在途请求，避免冷启动时 N 个请求同时打 BingX
let spotInflight: Promise<BingXSymbol[]> | null = null;
let futuresInflight: Promise<BingXContract[]> | null = null;

export function clearSpecCache(): void {
  spotCache = null;
  futuresCache = null;
  spotInflight = null;
  futuresInflight = null;
}

async function loadSpot(): Promise<BingXSymbol[]> {
  if (spotCache && spotCache.expiresAt > Date.now()) return spotCache.rows;
  if (spotInflight) return spotInflight;
  spotInflight = getSpotSymbols()
    .then((rows) => {
      spotCache = { rows, expiresAt: Date.now() + TTL_MS };
      return rows;
    })
    .finally(() => {
      spotInflight = null;
    });
  return spotInflight;
}

async function loadFutures(): Promise<BingXContract[]> {
  if (futuresCache && futuresCache.expiresAt > Date.now()) return futuresCache.rows;
  if (futuresInflight) return futuresInflight;
  futuresInflight = getFuturesContracts()
    .then((rows) => {
      futuresCache = { rows, expiresAt: Date.now() + TTL_MS };
      return rows;
    })
    .finally(() => {
      futuresInflight = null;
    });
  return futuresInflight;
}

/** 查询单个交易对的归一化规格。找不到返回 null；网络失败向上抛出（不缓存失败） */
export async function getSymbolSpec(
  symbol: string,
  market: TradingMarket,
  side: "LONG" | "SHORT" = "LONG"
): Promise<SymbolSpec | null> {
  if (market === "spot") {
    const row = (await loadSpot()).find((r) => r.symbol === symbol);
    return row ? normalizeSpotSymbol(row) : null;
  }
  const row = (await loadFutures()).find((r) => r.symbol === symbol);
  return row ? normalizeFuturesContract(row, side) : null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 创建规格查询路由 `src/app/api/trading/spec/route.ts`**

规格是公开信息，无需鉴权。

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSymbolSpec } from "@/lib/trading/spec";
import type { TradingMarket } from "@/types/trading";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const market = (searchParams.get("market") || "spot") as TradingMarket;
    const side = searchParams.get("side") === "SHORT" ? "SHORT" : "LONG";

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { message: "symbol is required" } },
        { status: 400 }
      );
    }
    if (market !== "spot" && market !== "futures") {
      return NextResponse.json(
        { success: false, error: { message: "market must be spot or futures" } },
        { status: 400 }
      );
    }

    const spec = await getSymbolSpec(symbol, market, side);
    if (!spec) {
      return NextResponse.json(
        { success: false, error: { message: `Unknown symbol: ${symbol}` } },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: spec });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 6: 手动验证路由**

在一个终端运行 `npm run dev`，另一个终端执行：

```bash
curl -s "http://localhost:3000/api/trading/spec?symbol=BTC-USDT&market=futures&side=LONG"
```

Expected: `{"success":true,"data":{"symbol":"BTC-USDT","market":"futures",...,"maxLeverage":125,...}}`。再试 `market=spot`，应返回带 `minNotional` 的现货规格。试一个不存在的 symbol，应返回 404。

- [ ] **Step 7: Commit**

```bash
git add src/lib/trading/spec.ts src/lib/trading/spec.test.ts src/app/api/trading/spec/route.ts
git commit -m "feat(trading): add cached symbol spec lookup and query route"
```

---

## Task 7: 内存滑动窗口限流（`rate-limit.ts`）

**已知局限（来自 spec）：Vercel serverless 是多实例，内存限流只能拦住同实例的暴力请求。** 真正的护栏是 Task 5 的服务端限额，限流只是补充。这条局限必须写进代码注释，避免后来者误以为它是完整防护。

**Files:**
- Create: `src/lib/trading/rate-limit.ts`
- Test: `src/lib/trading/rate-limit.test.ts`

**Interfaces:**
- Consumes: `RATE_LIMITS`（`src/lib/constants.ts`，现有但零引用）
- Produces: `checkRateLimit(key: string, config: { windowMs: number; max: number }, now?: number): { ok: boolean; retryAfterMs: number }`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/trading/rate-limit.test.ts`。`now` 作为参数注入，测试无需依赖假时钟：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, clearRateLimitState } from "./rate-limit";

const cfg = { windowMs: 1000, max: 3 };

beforeEach(() => clearRateLimitState());

describe("checkRateLimit", () => {
  it("allows requests up to the max within a window", () => {
    expect(checkRateLimit("u1", cfg, 0).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 100).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 200).ok).toBe(true);
  });

  it("blocks the request that exceeds the max", () => {
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 100);
    checkRateLimit("u1", cfg, 200);
    const r = checkRateLimit("u1", cfg, 300);
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(700);
  });

  it("lets the window slide so old hits expire", () => {
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 100);
    checkRateLimit("u1", cfg, 200);
    expect(checkRateLimit("u1", cfg, 1001).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 0);
    expect(checkRateLimit("u1", cfg, 0).ok).toBe(false);
    expect(checkRateLimit("u2", cfg, 0).ok).toBe(true);
  });

  it("does not count blocked requests against the window", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("u1", cfg, 0);
    // 窗口滑过后应恰好重新放行 max 次
    expect(checkRateLimit("u1", cfg, 1001).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 1002).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 1003).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 1004).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./rate-limit"`

- [ ] **Step 3: 实现 `src/lib/trading/rate-limit.ts`**

```typescript
/**
 * 进程内滑动窗口限流。
 *
 * 局限：Vercel serverless 会横向扩出多个实例，各自持有独立内存，
 * 因此这里只能拦住打到同一实例的暴力请求，不是完整防护。
 * 真正的护栏是 src/lib/trading/limits.ts 的服务端限额校验。
 * 若日后需要跨实例限流，需引入 Upstash Redis 之类的共享存储。
 */
const hits = new Map<string, number[]>();

export function clearRateLimitState(): void {
  hits.clear();
}

export function checkRateLimit(
  key: string,
  config: { windowMs: number; max: number },
  now: number = Date.now()
): { ok: boolean; retryAfterMs: number } {
  const cutoff = now - config.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= config.max) {
    // 被拒的请求不计入窗口，否则持续刷会把封锁无限延长
    hits.set(key, recent);
    const retryAfterMs = recent[0] + config.windowMs - now;
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterMs: 0 };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/rate-limit.ts src/lib/trading/rate-limit.test.ts
git commit -m "feat(trading): add in-memory sliding window rate limit"
```

---

## Task 8: 数据库迁移 020

**Files:**
- Create: `supabase/migrations/020_trading_limits.sql`

**Interfaces:**
- Produces: 表 `public.trading_limits`；`orders.order_type` 放宽后的 CHECK；`api_keys` 新增 `api_key_masked` / `is_primary` / `spot_ok` / `futures_ok`

注意：`user_daily_trade_count` 表已存在（`006_trading_rls.sql`），本迁移不重建它。

- [ ] **Step 1: 创建迁移文件 `supabase/migrations/020_trading_limits.sql`**

```sql
-- 020: 交易风控限额 + 订单类型放宽 + API Key 元数据
-- 依赖：006_trading_rls.sql（orders / api_keys / user_daily_trade_count）

-- 1) 风控限额配置。user_id 为 NULL 的那一行是全局默认。
--    任一字段为 NULL 表示该项不限制；本迁移刻意不预置任何数值，
--    以免在无人配置时意外锁死所有用户下单。
CREATE TABLE IF NOT EXISTS public.trading_limits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES public.users(id) ON DELETE CASCADE,
  max_notional_per_order  NUMERIC(20, 8),
  max_orders_per_day      INTEGER,
  max_leverage            INTEGER,
  allowed_symbols         TEXT[],
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.trading_limits IS '交易风控限额；user_id 为 NULL 的行为全局默认，字段为 NULL 表示不限制';

-- 全局默认行唯一；每个用户至多一行覆盖配置
CREATE UNIQUE INDEX IF NOT EXISTS trading_limits_global_uniq
  ON public.trading_limits ((user_id IS NULL)) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trading_limits_user_uniq
  ON public.trading_limits (user_id) WHERE user_id IS NOT NULL;

-- RLS：用户只能读自己的和全局默认，写入仅限服务端（service role 绕过 RLS）
ALTER TABLE public.trading_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trading_limits_select_own ON public.trading_limits;
CREATE POLICY trading_limits_select_own ON public.trading_limits
  FOR SELECT USING (user_id IS NULL OR user_id = auth.uid());

-- 2) 放宽 orders.order_type：现有 CHECK 只允许 5 种值，
--    实际需要落库 14 种（现货 6 + 合约 8）
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN (
    -- 现货
    'MARKET', 'LIMIT',
    'TAKE_STOP_LIMIT', 'TAKE_STOP_MARKET',
    'TRIGGER_LIMIT', 'TRIGGER_MARKET',
    -- 合约
    'STOP_MARKET', 'STOP',
    'TAKE_PROFIT_MARKET', 'TAKE_PROFIT',
    'TRAILING_STOP_MARKET', 'TRAILING_TP_SL',
    -- OCO（现货组合单）
    'OCO',
    -- 平仓
    'CLOSE_POSITION'
  ));

-- 落库时统一用大写 BingX 原始类型名，与 side 的小写约定不同，
-- 这里同时把 side 的 CHECK 放宽为大小写皆可，避免调用方来回转换出错
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_side_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_side_check
  CHECK (upper(side) IN ('BUY', 'SELL'));

-- 3) API Key 元数据
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS api_key_masked TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS spot_ok BOOLEAN;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS futures_ok BOOLEAN;

COMMENT ON COLUMN public.api_keys.api_key_masked IS '写入时算好的前4后4掩码，避免列表页每次解密';
COMMENT ON COLUMN public.api_keys.is_primary IS '交易路由选用的主密钥；每用户至多一个';
COMMENT ON COLUMN public.api_keys.spot_ok IS '现货权限验证结果，NULL 表示尚未验证';
COMMENT ON COLUMN public.api_keys.futures_ok IS '合约权限验证结果，NULL 表示尚未验证';

-- 每用户至多一个主密钥
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_primary_per_user
  ON public.api_keys (user_id) WHERE is_primary;

-- 把每个用户现有最早创建的有效 Key 标为主密钥，避免升级后无 primary 可选
UPDATE public.api_keys k SET is_primary = true
WHERE k.id = (
  SELECT id FROM public.api_keys
  WHERE user_id = k.user_id AND is_valid
  ORDER BY created_at ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM public.api_keys p WHERE p.user_id = k.user_id AND p.is_primary
);

-- 4) 按用户+日期查每日计数的索引（风控校验每次下单都要查）
CREATE INDEX IF NOT EXISTS user_daily_trade_count_lookup
  ON public.user_daily_trade_count (user_id, trade_date);
```

- [ ] **Step 2: 在 Supabase SQL Editor 中执行该迁移**

打开 Supabase 项目 → SQL Editor → 粘贴上述文件全文 → Run。

Expected: 无报错。若 `orders` 表里已有不在新 CHECK 列表内的历史 `order_type` 值，`ADD CONSTRAINT` 会失败——此时先执行 `SELECT DISTINCT order_type FROM public.orders;` 查看实际取值，把缺失的值补进 CHECK 列表再重跑。

- [ ] **Step 3: 验证表结构**

在 SQL Editor 执行：

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'trading_limits' ORDER BY ordinal_position;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'api_keys' AND column_name IN ('api_key_masked','is_primary','spot_ok','futures_ok');

SELECT id, label, is_primary FROM public.api_keys ORDER BY user_id, created_at;
```

Expected: `trading_limits` 有 8 列；`api_keys` 返回 4 个新列名；每个已有用户恰有一行 `is_primary = true`。

- [ ] **Step 4: 更新 ROADMAP 的迁移清单**

在 `ROADMAP.md` 的「⚠️ 需要手动跑的 SQL 迁移」列表末尾追加一行：

```markdown
  - `020_trading_limits.sql`（交易风控限额表 + 放宽 orders.order_type + api_keys 增列 masked/primary/权限标记）
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/020_trading_limits.sql
git add -f ROADMAP.md
git commit -m "feat(db): add trading limits table and API key metadata columns"
```

---

## Task 9: 修复 `futures.ts` 的四处 API 缺陷

这一步只改 BingX 调用层，不碰 UI；改完后合约面板会因为返回结构变化而暂时显示异常，Task 16 会接上。

**Files:**
- Modify: `src/lib/bingx/futures.ts`

**Interfaces:**
- Produces:
  - `placeFuturesOrder` / `testFuturesOrder` 返回**解包后**的 `FuturesOrderResult`（不再是 `{ order: {...} }`）
  - `getFuturesBalance(): Promise<FuturesBalance>` 改用 v3
  - `closePosition(apiKey, secret, params: { symbol: string; positionId: string })`
  - `PlaceFuturesOrderParams.priceRate` 语义统一为小数（0.05 = 5%），移除 `callbackRate`

- [ ] **Step 1: 修正 `priceRate` 覆盖（第 288–291 行与 317–318 行）**

从 `PlaceFuturesOrderParams` 接口中删除 `callbackRate?: number;` 这一行，只保留 `priceRate?: number;`，并把注释改为：

```typescript
  /** 追踪回撤率，小数形式，0 < x ≤ 1（0.05 = 5%）。TRAILING_STOP_MARKET / TRAILING_TP_SL 必填 */
  priceRate?: number;
```

在 `placeFuturesOrder` 内，把这两行：

```typescript
  if (params.priceRate !== undefined) body.priceRate = params.priceRate;
  if (params.callbackRate !== undefined) body.priceRate = params.callbackRate;
```

替换为单独一行：

```typescript
  if (params.priceRate !== undefined) body.priceRate = params.priceRate;
```

- [ ] **Step 2: 修正下单响应的嵌套解包**

BingX 合约下单返回 `data: { order: {...} }`（ccxt 的 `safeDict(data, 'order', data)` 证实）。同时官方文档说明订单号可能超出 `Number.MAX_SAFE_INTEGER`，应优先用字符串字段 `orderID`。

先把 `FuturesOrderResult` 接口（第 45–63 行）替换为：

```typescript
export interface FuturesOrderResult {
  symbol: string;
  /** 数值型订单号，大数在 JS 中可能丢精度——优先用 orderIdStr */
  orderId?: number;
  /** 字符串订单号。BingX 在不同端点分别用 orderID / orderId，此处统一为字符串 */
  orderIdStr: string;
  clientOrderId?: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  stopPrice?: string;
  executedQty?: string;
  avgPrice?: string;
  status: string;
  workingType?: string;
  updateTime?: number;
}

/** BingX 合约下单的原始响应包装 */
interface FuturesOrderEnvelope {
  order?: Record<string, unknown>;
  [k: string]: unknown;
}

/** 解包 data.order，并把订单号统一成字符串 */
function unwrapOrder(raw: FuturesOrderEnvelope): FuturesOrderResult {
  const o = (raw?.order ?? raw) as Record<string, unknown>;
  const idStr = o.orderID ?? o.orderId ?? "";
  return { ...(o as unknown as FuturesOrderResult), orderIdStr: String(idStr) };
}
```

然后把 `placeFuturesOrder` 的最后一行：

```typescript
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/order", body);
```

替换为：

```typescript
  const raw = await signedRequest<FuturesOrderEnvelope>(
    apiKey, secret, "POST", "/openApi/swap/v2/trade/order", body
  );
  return unwrapOrder(raw);
```

对 `testFuturesOrder` 做同样处理（把它最后的 `return signedRequest(...)` 改成先取 `raw` 再 `unwrapOrder`，路径保持 `/openApi/swap/v2/trade/order/test`）。

- [ ] **Step 3: 修正余额接口到 v3**

把 `FuturesBalance` 接口（第 18–25 行）替换为：

```typescript
/** 来源：GET /openApi/swap/v3/user/balance，返回的是数组 */
export interface FuturesBalance {
  userId: string;
  asset: string;
  balance: string;
  equity: string;
  unrealizedProfit: string;
  realisedProfit: string;
  availableMargin: string;
  usedMargin: string;
}
```

把 `getFuturesBalance`（第 155–159 行）替换为：

```typescript
/** 取 USDT 结算账户余额。v3 返回数组，可能含多种结算币 */
export async function getFuturesBalance(
  apiKey: string, secret: string, asset = "USDT"
): Promise<FuturesBalance | null> {
  const rows = await signedRequest<FuturesBalance[]>(
    apiKey, secret, "GET", "/openApi/swap/v3/user/balance"
  );
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r.asset === asset) ?? rows[0] ?? null;
}
```

- [ ] **Step 4: 修正平仓路径**

文档中只有 `/openApi/swap/v1/trade/closePosition`，且 `positionId` 必填。把 `closePosition`（第 522–530 行）替换为：

```typescript
/** 按 positionId 市价全平单个仓位。positionId 从 getFuturesPositions() 取得 */
export async function closePosition(
  apiKey: string, secret: string, positionId: string
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/closePosition", {
    positionId,
  });
}
```

- [ ] **Step 5: 修正 `verifyFuturesApiKey` 对新返回值的判断**

`getFuturesBalance` 现在可能返回 `null`，把该函数（末尾）替换为：

```typescript
export async function verifyFuturesApiKey(apiKey: string, secret: string): Promise<boolean> {
  try {
    return (await getFuturesBalance(apiKey, secret)) !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: 修正 `positions` 路由中已失效的 `closePosition` 调用**

`src/app/api/bingx/futures/positions/route.ts` 的 `case "closePosition"` 现在签名不匹配。替换该 case 为：

```typescript
      case "closePosition": {
        if (!positionId) {
          return NextResponse.json(
            { success: false, error: { message: "positionId is required to close a position" } },
            { status: 400 }
          );
        }
        return NextResponse.json({
          success: true,
          data: await closePosition(apiKey, secret, positionId),
        });
      }
```

同时把该文件 GET 分支里的 `type === "balance"` 改为容忍 null：

```typescript
    if (type === "balance") {
      const balance = await getFuturesBalance(apiKey, secret);
      return NextResponse.json({ success: true, data: balance });
    }
```

- [ ] **Step 7: 确认类型检查与构建通过**

Run: `npm run build`
Expected: 构建成功。`FuturesInfoPanel.tsx` 会因为 `handleClose` 不再传 `positionId` 而在运行时失效——这是预期的，Task 17 会重接；但**类型层面**它传的是字符串 body，不会阻塞构建。若构建报 `FuturesOrderResult.orderId` 相关错误，按新字段 `orderIdStr` 修正调用处。

- [ ] **Step 8: Commit**

```bash
git add src/lib/bingx/futures.ts src/app/api/bingx/futures/positions/route.ts
git commit -m "fix(bingx): correct priceRate, order response unwrapping, balance v3, close position path"
```

---

## Task 10: 持仓模式与杠杆（`account-mode.ts`）

**Files:**
- Create: `src/lib/trading/account-mode.ts`
- Create: `src/lib/trading/account-mode.test.ts`

**Interfaces:**
- Consumes: `getPositionSideDual` / `setLeverage` / `getLeverage` / `setMarginType`（`src/lib/bingx/futures.ts`）
- Produces:
  - `resolveOrderDirection(requested: "LONG" | "SHORT", dualSide: boolean): { side: "BUY" | "SELL"; positionSide: "LONG" | "SHORT" | "BOTH" }`（纯函数，可测）
  - `getDualSideMode(userId: string, apiKey: string, secret: string): Promise<boolean>`（带 5 分钟缓存）
  - `invalidateDualSideMode(userId: string): void`

分成纯函数 + 带缓存的 IO 两部分，纯函数部分做完整单测。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/trading/account-mode.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { resolveOrderDirection } from "./account-mode";

describe("resolveOrderDirection in hedge mode", () => {
  it("maps LONG to BUY with positionSide LONG", () => {
    expect(resolveOrderDirection("LONG", true)).toEqual({ side: "BUY", positionSide: "LONG" });
  });

  it("maps SHORT to SELL with positionSide SHORT", () => {
    expect(resolveOrderDirection("SHORT", true)).toEqual({ side: "SELL", positionSide: "SHORT" });
  });
});

describe("resolveOrderDirection in one-way mode", () => {
  it("maps LONG to BUY with positionSide BOTH", () => {
    expect(resolveOrderDirection("LONG", false)).toEqual({ side: "BUY", positionSide: "BOTH" });
  });

  it("maps SHORT to SELL with positionSide BOTH", () => {
    expect(resolveOrderDirection("SHORT", false)).toEqual({ side: "SELL", positionSide: "BOTH" });
  });

  it("never emits LONG or SHORT as positionSide in one-way mode", () => {
    // 这正是错误码 109400 "PositionSide must be BOTH in one-way mode" 的成因
    for (const dir of ["LONG", "SHORT"] as const) {
      expect(resolveOrderDirection(dir, false).positionSide).toBe("BOTH");
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错 `Failed to resolve import "./account-mode"`

- [ ] **Step 3: 实现 `src/lib/trading/account-mode.ts`**

```typescript
import { getPositionSideDual } from "@/lib/bingx/futures";

/**
 * 把用户在 UI 上选的方向翻译成 BingX 需要的 side + positionSide。
 *
 * 对冲模式（dualSidePosition=true）：positionSide 用 LONG / SHORT
 * 单向模式（dualSidePosition=false）：positionSide 必须是 BOTH，
 *   否则 BingX 返回 109400 "PositionSide must be BOTH in one-way mode"
 */
export function resolveOrderDirection(
  requested: "LONG" | "SHORT",
  dualSide: boolean
): { side: "BUY" | "SELL"; positionSide: "LONG" | "SHORT" | "BOTH" } {
  const side = requested === "LONG" ? "BUY" : "SELL";
  return { side, positionSide: dualSide ? requested : "BOTH" };
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { dualSide: boolean; expiresAt: number }>();

export function invalidateDualSideMode(userId: string): void {
  cache.delete(userId);
}

/** 读取账户持仓模式，按用户缓存 5 分钟。用户可能随时在 BingX App 里改，故 TTL 不宜过长 */
export async function getDualSideMode(
  userId: string,
  apiKey: string,
  secret: string
): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.dualSide;

  const res = await getPositionSideDual(apiKey, secret);
  const dualSide = res?.dualSidePosition === true;
  cache.set(userId, { dualSide, expiresAt: Date.now() + TTL_MS });
  return dualSide;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/account-mode.ts src/lib/trading/account-mode.test.ts
git commit -m "feat(trading): resolve order direction against account position mode"
```

---

## Task 11: 订单落库与每日计数（`persist.ts`）

`orders` 表与 `user_daily_trade_count` 表都已存在。**落库失败绝不能让已成功的下单显示为失败**——订单已经发到交易所了。

**Files:**
- Create: `src/lib/trading/persist.ts`

**Interfaces:**
- Consumes: `createClient`（`@/lib/supabase/server`）、Sentry
- Produces:
  - `countOrdersToday(supabase, userId): Promise<number>`
  - `recordOrder(supabase, input: RecordOrderInput): Promise<void>`
  - 类型 `RecordOrderInput`

- [ ] **Step 1: 创建 `src/lib/trading/persist.ts`**

```typescript
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TradingMarket } from "@/types/trading";

export interface RecordOrderInput {
  userId: string;
  apiKeyId: string | null;
  market: TradingMarket;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  leverage?: number | null;
  totalValue?: number | null;
  bingxOrderId?: string | null;
  status: "pending" | "filled" | "partially_filled" | "canceled" | "rejected" | "expired";
  errorMessage?: string | null;
  riskRejected?: boolean;
  riskReason?: string | null;
}

/** 今日已下单数（含被风控拒绝的），用于每日次数限额 */
export async function countOrdersToday(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("user_daily_trade_count")
    .select("count")
    .eq("user_id", userId)
    .eq("trade_date", today)
    .maybeSingle();

  if (error) {
    // 读不到计数时按 0 处理：宁可放行也不要因为读表失败而锁死用户下单。
    // 名义额与杠杆限额仍然生效，风险有界。
    Sentry.captureException(error, { tags: { scope: "countOrdersToday" } });
    return 0;
  }
  return data?.count ?? 0;
}

async function bumpDailyCount(supabase: SupabaseClient, userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const current = await countOrdersToday(supabase, userId);
  const { error } = await supabase
    .from("user_daily_trade_count")
    .upsert(
      { user_id: userId, trade_date: today, count: current + 1 },
      { onConflict: "user_id,trade_date" }
    );
  if (error) Sentry.captureException(error, { tags: { scope: "bumpDailyCount" } });
}

/**
 * 记录一笔下单尝试。
 *
 * 绝不抛出：调用方在订单已经发到 BingX 之后才调它，
 * 此时任何异常都不该把一次成功的下单报成失败。落库问题只上报 Sentry。
 */
export async function recordOrder(
  supabase: SupabaseClient,
  input: RecordOrderInput
): Promise<void> {
  try {
    const { error } = await supabase.from("orders").insert({
      user_id: input.userId,
      api_key_id: input.apiKeyId,
      market_type: input.market,
      symbol: input.symbol,
      side: input.side,
      order_type: input.orderType,
      quantity: input.quantity,
      price: input.price ?? null,
      stop_price: input.stopPrice ?? null,
      leverage: input.leverage ?? 1,
      total_value: input.totalValue ?? null,
      bingx_order_id: input.bingxOrderId ?? null,
      status: input.status,
      error_message: input.errorMessage ?? null,
      risk_rejected: input.riskRejected ?? false,
      risk_reason: input.riskReason ?? null,
    });
    if (error) {
      Sentry.captureException(error, { tags: { scope: "recordOrder" } });
      return;
    }
    // 只有真正发到交易所的单才计入每日额度；被风控拦下的不占额度
    if (!input.riskRejected) await bumpDailyCount(supabase, input.userId);
  } catch (e) {
    Sentry.captureException(e, { tags: { scope: "recordOrder" } });
  }
}
```

- [ ] **Step 2: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/lib/trading/persist.ts
git commit -m "feat(trading): persist orders and daily counts without failing live orders"
```

---

## Task 12: 下单前置检查编排（`preflight.ts`）

把 Task 3/5/6 的纯函数与 Task 11 的计数组合成一次完整的前置检查。这是服务端权威性的落点：任何绕过 UI 的请求都要过这里。

**Files:**
- Create: `src/lib/trading/preflight.ts`
- Modify: `src/types/trading.ts`

**Interfaces:**
- Consumes: `getSymbolSpec`（Task 6）、`quoteToBase` / `validateOrderSize` / `formatQty` / `requiredMargin`（Task 3）、`mergeLimits` / `checkLimits`（Task 5）、`countOrdersToday`（Task 11）
- Produces:
  - 类型 `PreflightInput`、`PreflightResult`、`PreflightRejection`
  - `loadLimitsFor(supabase, userId): Promise<TradingLimits>`
  - `preflightOrder(supabase, input: PreflightInput): Promise<PreflightResult>`

- [ ] **Step 1: 在 `src/types/trading.ts` 末尾追加类型**

```typescript
export interface PreflightInput {
  userId: string;
  market: TradingMarket;
  symbol: string;
  /** 用户选的方向；现货 BUY/SELL 直接映射，合约 LONG/SHORT 在路由层转换 */
  direction: "LONG" | "SHORT";
  /** 用户输入的仓位名义额（USDT） */
  notionalUsdt: number;
  /** 换算参考价：限价单用限价，市价单用最新价 */
  referencePrice: number;
  leverage: number;
}

export type PreflightRejectCode =
  | "UNKNOWN_SYMBOL"
  | SizeValidationReason
  | LimitRejectReason;

export type PreflightResult =
  | {
      ok: true;
      spec: SymbolSpec;
      /** 已对齐精度、可直接发给 BingX 的数量字符串 */
      qty: string;
      sizing: OrderSizing;
      requiredMarginUsdt: number;
    }
  | { ok: false; code: PreflightRejectCode; limit?: number | string };
```

- [ ] **Step 2: 创建 `src/lib/trading/preflight.ts`**

```typescript
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSymbolSpec } from "./spec";
import { quoteToBase, validateOrderSize, formatQty, requiredMargin } from "./sizing";
import { mergeLimits, checkLimits } from "./limits";
import { countOrdersToday } from "./persist";
import type { TradingLimits, PreflightInput, PreflightResult } from "@/types/trading";

interface LimitsRow {
  max_notional_per_order: number | null;
  max_orders_per_day: number | null;
  max_leverage: number | null;
  allowed_symbols: string[] | null;
}

function rowToLimits(row: LimitsRow | undefined): TradingLimits | null {
  if (!row) return null;
  return {
    maxNotionalPerOrder: row.max_notional_per_order,
    maxOrdersPerDay: row.max_orders_per_day,
    maxLeverage: row.max_leverage,
    allowedSymbols: row.allowed_symbols,
  };
}

/** 取全局默认 + 该用户的覆盖配置并合并 */
export async function loadLimitsFor(
  supabase: SupabaseClient,
  userId: string
): Promise<TradingLimits> {
  const { data, error } = await supabase
    .from("trading_limits")
    .select("user_id, max_notional_per_order, max_orders_per_day, max_leverage, allowed_symbols")
    .or(`user_id.is.null,user_id.eq.${userId}`);

  if (error) {
    // 读不到限额配置时按「不限制」放行：限额是管理员设的可选护栏，
    // 不该因为一次读表失败就让所有人无法下单。异常上报 Sentry 便于发现。
    Sentry.captureException(error, { tags: { scope: "loadLimitsFor" } });
    return { maxNotionalPerOrder: null, maxOrdersPerDay: null, maxLeverage: null, allowedSymbols: null };
  }

  const rows = (data ?? []) as Array<LimitsRow & { user_id: string | null }>;
  const global = rowToLimits(rows.find((r) => r.user_id === null));
  const user = rowToLimits(rows.find((r) => r.user_id === userId));
  return mergeLimits(global, user);
}

/**
 * 下单前置检查：规格 → 换算 → 尺寸校验 → 风控限额。
 * 返回 ok:true 时，qty 已经对齐精度、可直接发给 BingX。
 */
export async function preflightOrder(
  supabase: SupabaseClient,
  input: PreflightInput
): Promise<PreflightResult> {
  const spec = await getSymbolSpec(input.symbol, input.market, input.direction);
  if (!spec) return { ok: false, code: "UNKNOWN_SYMBOL" };

  const sizing = quoteToBase(input.notionalUsdt, input.referencePrice, spec);
  const sizeCheck = validateOrderSize(sizing, spec);
  if (!sizeCheck.ok) return { ok: false, code: sizeCheck.reason, limit: sizeCheck.limit };

  // 交易对自身的最大杠杆也是一道硬限制，与管理员配置的风控限额取更严者
  const limits = await loadLimitsFor(supabase, input.userId);
  const effectiveMaxLeverage =
    spec.maxLeverage === undefined
      ? limits.maxLeverage
      : limits.maxLeverage === null
        ? spec.maxLeverage
        : Math.min(limits.maxLeverage, spec.maxLeverage);

  const ordersToday = await countOrdersToday(supabase, input.userId);
  const limitCheck = checkLimits(
    {
      symbol: input.symbol,
      notional: sizing.notional,
      leverage: input.leverage,
      ordersToday,
    },
    { ...limits, maxLeverage: effectiveMaxLeverage }
  );
  if (!limitCheck.ok) return { ok: false, code: limitCheck.reason, limit: limitCheck.limit };

  return {
    ok: true,
    spec,
    qty: formatQty(sizing.qty, spec),
    sizing,
    requiredMarginUsdt: requiredMargin(sizing.notional, input.leverage),
  };
}
```

- [ ] **Step 3: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/types/trading.ts src/lib/trading/preflight.ts
git commit -m "feat(trading): orchestrate order preflight checks server-side"
```

---

## Task 13: 现货下单路由接入 preflight

**Files:**
- Modify: `src/app/api/bingx/trade/order/route.ts`

**Interfaces:**
- Consumes: `preflightOrder`（Task 12）、`recordOrder`（Task 11）、`checkRateLimit`（Task 7）、`describeBingXError`（Task 4）、`RATE_LIMITS`
- Produces: 请求体新增 `notionalUsdt`（名义额）与 `referencePrice`；错误响应新增 `error.i18nKey` 与 `error.code`

请求契约变化：前端不再直接传 `quantity` / `quoteOrderQty`，改传 `notionalUsdt` + `referencePrice`，由服务端换算。

- [ ] **Step 1: 用以下内容整体替换 `src/app/api/bingx/trade/order/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeOrder } from "@/lib/bingx/trade";
import { preflightOrder } from "@/lib/trading/preflight";
import { recordOrder } from "@/lib/trading/persist";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { describeBingXError } from "@/lib/trading/errors";
import { roundPrice } from "@/lib/trading/sizing";
import { RATE_LIMITS } from "@/lib/constants";
import type { OrderSide, OrderType, TimeInForce } from "@/lib/bingx/trade";

const VALID_SIDES: OrderSide[] = ["BUY", "SELL"];
const VALID_TYPES: OrderType[] = [
  "MARKET", "LIMIT",
  "TAKE_STOP_LIMIT", "TAKE_STOP_MARKET",
  "TRIGGER_LIMIT", "TRIGGER_MARKET",
];
const VALID_TIF: TimeInForce[] = ["GTC", "IOC", "FOK", "PostOnly"];
const LIMIT_TYPES = new Set<OrderType>(["LIMIT", "TAKE_STOP_LIMIT", "TRIGGER_LIMIT"]);
const STOP_TYPES = new Set<OrderType>([
  "TAKE_STOP_LIMIT", "TAKE_STOP_MARKET", "TRIGGER_LIMIT", "TRIGGER_MARKET",
]);

function reject(code: string, message: string, status: number, limit?: number | string) {
  return NextResponse.json(
    { success: false, error: { message, i18nKey: `trading.reject.${code.toLowerCase()}`, code, limit } },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
  }
  const userId = authData.user.id;

  const rl = checkRateLimit(`spot-order:${userId}`, RATE_LIMITS.SPOT_TRADE);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { message: "Too many orders, slow down", i18nKey: "trading.reject.rate_limited" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const body = await request.json();
  const { symbol, side, type, notionalUsdt, referencePrice, price, stopPrice, timeInForce } = body;

  if (!symbol || !side || !type) {
    return reject("MISSING_FIELDS", "Missing fields: symbol, side, type", 400);
  }
  if (!VALID_SIDES.includes(side)) return reject("INVALID_SIDE", "side must be BUY or SELL", 400);
  if (!VALID_TYPES.includes(type)) return reject("INVALID_TYPE", "Invalid order type", 400);
  if (timeInForce && !VALID_TIF.includes(timeInForce)) {
    return reject("INVALID_TIF", "Invalid timeInForce", 400);
  }
  if (LIMIT_TYPES.has(type) && !(Number(price) > 0)) {
    return reject("MISSING_PRICE", "price is required for limit-type orders", 400);
  }
  if (STOP_TYPES.has(type) && !(Number(stopPrice) > 0)) {
    return reject("MISSING_STOP_PRICE", "stopPrice is required for stop/trigger orders", 400);
  }

  const notional = Number(notionalUsdt);
  // 限价类用限价换算，市价类用前端传来的最新成交价
  const refPrice = LIMIT_TYPES.has(type) ? Number(price) : Number(referencePrice);
  if (!(notional > 0)) return reject("INVALID_AMOUNT", "notionalUsdt must be positive", 400);
  if (!(refPrice > 0)) return reject("INVALID_PRICE", "referencePrice must be positive", 400);

  const pre = await preflightOrder(supabase, {
    userId,
    market: "spot",
    symbol,
    direction: side === "BUY" ? "LONG" : "SHORT",
    notionalUsdt: notional,
    referencePrice: refPrice,
    leverage: 1,
  });

  if (!pre.ok) {
    await recordOrder(supabase, {
      userId, apiKeyId: null, market: "spot", symbol, side, orderType: type,
      quantity: 0, status: "rejected", riskRejected: true, riskReason: pre.code,
    });
    return reject(pre.code, `Order rejected: ${pre.code}`, 400, pre.limit);
  }

  const { data: apiKeys, error: keyError } = await supabase
    .from("api_keys")
    .select("id, api_key_encrypted, secret_encrypted")
    .eq("user_id", userId)
    .eq("is_valid", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (keyError || !apiKeys?.length) {
    return reject("NO_API_KEY", "No valid API key found", 400);
  }

  const apiKey = decrypt(apiKeys[0].api_key_encrypted);
  const secret = decrypt(apiKeys[0].secret_encrypted);

  try {
    const result = await placeOrder(apiKey, secret, {
      symbol, side, type,
      quantity: pre.qty,
      price: LIMIT_TYPES.has(type) ? roundPrice(Number(price), pre.spec) : undefined,
      stopPrice: STOP_TYPES.has(type) ? roundPrice(Number(stopPrice), pre.spec) : undefined,
      timeInForce: LIMIT_TYPES.has(type) ? (timeInForce || "GTC") : undefined,
    });

    await recordOrder(supabase, {
      userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side, orderType: type,
      quantity: pre.sizing.qty,
      price: LIMIT_TYPES.has(type) ? Number(price) : null,
      stopPrice: STOP_TYPES.has(type) ? Number(stopPrice) : null,
      leverage: 1,
      totalValue: pre.sizing.notional,
      bingxOrderId: result.orderId ? String(result.orderId) : null,
      status: "pending",
    });

    return NextResponse.json({ success: true, data: { ...result, estimatedQty: pre.qty } });
  } catch (error) {
    const described = describeBingXError(error);
    await recordOrder(supabase, {
      userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side, orderType: type,
      quantity: pre.sizing.qty, status: "rejected",
      errorMessage: `${described.code ?? "-"}: ${described.rawMessage}`,
    });
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: 确认构建通过**

Run: `npm run build`
Expected: 构建成功。`TradeForm.tsx` 仍在发旧的请求体，此时现货下单会返回 `INVALID_AMOUNT`——这是预期的，Task 17 会换成新表单。

- [ ] **Step 3: 手动验证风控拦截路径**

`npm run dev` 后，登录状态下在浏览器 Console 执行：

```javascript
await (await fetch("/api/bingx/trade/order", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", type: "MARKET", notionalUsdt: 0.5, referencePrice: 60000 })
})).json()
```

Expected: `{"success":false,"error":{"code":"BELOW_MIN_NOTIONAL",...}}` 或 `ZERO_AFTER_ROUNDING`——**没有真实下单**。这证明服务端权威校验生效。再把 `notionalUsdt` 改成 `1e9`，应返回 `BELOW_MIN_*` 以外的拒绝或 `NOTIONAL_TOO_LARGE`（若已配限额）。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bingx/trade/order/route.ts
git commit -m "feat(api): route spot orders through server-side preflight and persistence"
```

---

## Task 14: 合约下单路由接入 preflight 与持仓模式

**Files:**
- Modify: `src/app/api/bingx/futures/order/route.ts`

**Interfaces:**
- Consumes: `preflightOrder`、`resolveOrderDirection` / `getDualSideMode` / `invalidateDualSideMode`（Task 10）、`recordOrder`、`checkRateLimit`、`describeBingXError`
- Produces: 请求体改为 `{ symbol, direction: "LONG"|"SHORT", type, notionalUsdt, referencePrice, leverage, price?, stopPrice?, priceRatePercent?, stopLossPrice?, takeProfitPrice? }`

关键点：`priceRatePercent` 收百分比数（UI 显示 1 = 1%），**除以 100** 后作为 `priceRate` 发出。

- [ ] **Step 1: 用以下内容整体替换 `src/app/api/bingx/futures/order/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeFuturesOrder, testFuturesOrder } from "@/lib/bingx/futures";
import { preflightOrder } from "@/lib/trading/preflight";
import { resolveOrderDirection, getDualSideMode, invalidateDualSideMode } from "@/lib/trading/account-mode";
import { recordOrder } from "@/lib/trading/persist";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { describeBingXError } from "@/lib/trading/errors";
import { roundPrice } from "@/lib/trading/sizing";
import { RATE_LIMITS } from "@/lib/constants";
import type { FuturesOrderType } from "@/lib/bingx/futures";

const VALID_TYPES: FuturesOrderType[] = [
  "MARKET", "LIMIT",
  "STOP_MARKET", "STOP",
  "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
  "TRAILING_STOP_MARKET", "TRAILING_TP_SL",
];
const LIMIT_TYPES = new Set<FuturesOrderType>(["LIMIT", "STOP", "TAKE_PROFIT"]);
const STOP_TYPES = new Set<FuturesOrderType>([
  "STOP_MARKET", "STOP", "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
]);
const TRAILING_TYPES = new Set<FuturesOrderType>(["TRAILING_STOP_MARKET", "TRAILING_TP_SL"]);
/** 只有 MARKET / LIMIT 能挂附带止盈止损对象 */
const ATTACHABLE_TPSL = new Set<FuturesOrderType>(["MARKET", "LIMIT"]);

function reject(code: string, message: string, status: number, limit?: number | string) {
  return NextResponse.json(
    { success: false, error: { message, i18nKey: `trading.reject.${code.toLowerCase()}`, code, limit } },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
  }
  const userId = authData.user.id;

  const { data: profile } = await supabase.from("users").select("tier").eq("id", userId).single();
  if (!profile || profile.tier !== "pro") {
    return reject("PRO_REQUIRED", "Futures trading requires Pro subscription", 403);
  }

  const rl = checkRateLimit(`futures-order:${userId}`, RATE_LIMITS.FUTURES_TRADE);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { message: "Too many orders, slow down", i18nKey: "trading.reject.rate_limited" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const body = await request.json();
  const {
    test, symbol, direction, type, notionalUsdt, referencePrice, leverage,
    price, stopPrice, priceRatePercent, workingType,
    stopLossPrice, takeProfitPrice,
  } = body;

  if (!symbol || !direction || !type) {
    return reject("MISSING_FIELDS", "Missing fields: symbol, direction, type", 400);
  }
  if (direction !== "LONG" && direction !== "SHORT") {
    return reject("INVALID_DIRECTION", "direction must be LONG or SHORT", 400);
  }
  if (!VALID_TYPES.includes(type)) return reject("INVALID_TYPE", "Invalid order type", 400);
  if (LIMIT_TYPES.has(type) && !(Number(price) > 0)) {
    return reject("MISSING_PRICE", "price is required for limit-type orders", 400);
  }
  if (STOP_TYPES.has(type) && !(Number(stopPrice) > 0)) {
    return reject("MISSING_STOP_PRICE", "stopPrice is required for stop/take-profit orders", 400);
  }

  // UI 收百分比（1 = 1%），BingX 要小数且上限为 1
  let priceRate: number | undefined;
  if (TRAILING_TYPES.has(type)) {
    const pct = Number(priceRatePercent);
    if (!(pct > 0) || pct > 100) {
      return reject("INVALID_CALLBACK_RATE", "priceRatePercent must be within (0, 100]", 400);
    }
    priceRate = pct / 100;
  }

  const lev = Number(leverage) > 0 ? Math.floor(Number(leverage)) : 1;
  const notional = Number(notionalUsdt);
  const refPrice = LIMIT_TYPES.has(type) ? Number(price) : Number(referencePrice);
  if (!(notional > 0)) return reject("INVALID_AMOUNT", "notionalUsdt must be positive", 400);
  if (!(refPrice > 0)) return reject("INVALID_PRICE", "referencePrice must be positive", 400);

  const pre = await preflightOrder(supabase, {
    userId, market: "futures", symbol, direction,
    notionalUsdt: notional, referencePrice: refPrice, leverage: lev,
  });

  const sideForLog = direction === "LONG" ? "BUY" : "SELL";
  if (!pre.ok) {
    await recordOrder(supabase, {
      userId, apiKeyId: null, market: "futures", symbol, side: sideForLog, orderType: type,
      quantity: 0, leverage: lev, status: "rejected", riskRejected: true, riskReason: pre.code,
    });
    return reject(pre.code, `Order rejected: ${pre.code}`, 400, pre.limit);
  }

  const { data: apiKeys, error: keyError } = await supabase
    .from("api_keys")
    .select("id, api_key_encrypted, secret_encrypted")
    .eq("user_id", userId)
    .eq("is_valid", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (keyError || !apiKeys?.length) return reject("NO_API_KEY", "No valid API key found", 400);

  const apiKey = decrypt(apiKeys[0].api_key_encrypted);
  const secret = decrypt(apiKeys[0].secret_encrypted);

  const send = async () => {
    const dualSide = await getDualSideMode(userId, apiKey, secret);
    const { side, positionSide } = resolveOrderDirection(direction, dualSide);

    const params = {
      symbol, side, positionSide, type,
      quantity: pre.qty,
      price: LIMIT_TYPES.has(type) ? roundPrice(Number(price), pre.spec) : undefined,
      stopPrice: STOP_TYPES.has(type) ? roundPrice(Number(stopPrice), pre.spec) : undefined,
      priceRate,
      timeInForce: LIMIT_TYPES.has(type) ? ("GTC" as const) : undefined,
      workingType: workingType || undefined,
      stopLoss:
        ATTACHABLE_TPSL.has(type) && Number(stopLossPrice) > 0
          ? JSON.stringify({
              type: "STOP_MARKET",
              stopPrice: Number(roundPrice(Number(stopLossPrice), pre.spec)),
              workingType: "MARK_PRICE",
            })
          : undefined,
      takeProfit:
        ATTACHABLE_TPSL.has(type) && Number(takeProfitPrice) > 0
          ? JSON.stringify({
              type: "TAKE_PROFIT_MARKET",
              stopPrice: Number(roundPrice(Number(takeProfitPrice), pre.spec)),
              workingType: "MARK_PRICE",
            })
          : undefined,
    };

    const fn = test ? testFuturesOrder : placeFuturesOrder;
    return fn(apiKey, secret, params);
  };

  try {
    let result;
    try {
      result = await send();
    } catch (e) {
      // 109400 常见成因之一是持仓模式不匹配——用户可能刚在 BingX App 里改过。
      // 清掉缓存重探一次，只重试这一次，避免把真正的参数错误反复打到交易所。
      const { code } = describeBingXError(e);
      if (code === 109400) {
        invalidateDualSideMode(userId);
        result = await send();
      } else {
        throw e;
      }
    }

    if (!test) {
      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "futures", symbol, side: sideForLog,
        orderType: type, quantity: pre.sizing.qty,
        price: LIMIT_TYPES.has(type) ? Number(price) : null,
        stopPrice: STOP_TYPES.has(type) ? Number(stopPrice) : null,
        leverage: lev, totalValue: pre.sizing.notional,
        bingxOrderId: result.orderIdStr || null,
        status: "pending",
      });
    }

    return NextResponse.json({
      success: true,
      data: { ...result, estimatedQty: pre.qty, requiredMarginUsdt: pre.requiredMarginUsdt },
    });
  } catch (error) {
    const described = describeBingXError(error);
    if (!test) {
      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "futures", symbol, side: sideForLog,
        orderType: type, quantity: pre.sizing.qty, leverage: lev, status: "rejected",
        errorMessage: `${described.code ?? "-"}: ${described.rawMessage}`,
      });
    }
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: 用官方 dry-run 端点验证参数正确性**

需要一个已绑定、有合约权限的 Pro 账号。`npm run dev` 后在浏览器 Console 执行：

```javascript
await (await fetch("/api/bingx/futures/order", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    test: true, symbol: "BTC-USDT", direction: "LONG", type: "MARKET",
    notionalUsdt: 20, referencePrice: 60000, leverage: 1
  })
})).json()
```

Expected: `{"success":true,"data":{...,"estimatedQty":"0.0003",...}}`。`estimatedQty` 应是**币数量**而非 20——这正是 A1 缺陷被修复的证据。

再验证回撤率换算：把 `type` 换成 `"TRAILING_STOP_MARKET"`、加 `priceRatePercent: 1`，应返回 success（BingX 收到的是 `priceRate=0.01`）；把 `priceRatePercent` 改成 `150` 应返回 `INVALID_CALLBACK_RATE` 且不打交易所。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bingx/futures/order/route.ts
git commit -m "feat(api): route futures orders through preflight with position mode resolution"
```

---

## Task 15: API Key 路由改造（双权限验证 + 掩码 + 主密钥）

**Files:**
- Modify: `src/app/api/user/api-keys/route.ts`
- Modify: `src/app/api/user/api-keys/verify/route.ts`

**Interfaces:**
- Consumes: `verifyApiKey`（现货，`@/lib/bingx/trade`）、`verifyFuturesApiKey`（合约，`@/lib/bingx/futures`，Task 9 已修）、`maskApiKey`（`@/lib/utils`）
- Produces:
  - `POST /api/user/api-keys` 请求体不变；响应 data 新增 `api_key_masked` / `spot_ok` / `futures_ok` / `is_primary`
  - `POST /api/user/api-keys/verify` 响应 `{ spotOk, futuresOk, isValid }`
  - `PATCH /api/user/api-keys` — `{ id, action: "setPrimary" | "reverify" }`

现有 `verifyApiKey` 只查现货余额，会把只有合约权限的 Key 判为无效。改为两项分别验证，任一通过即 `is_valid`。

- [ ] **Step 1: 用以下内容整体替换 `src/app/api/user/api-keys/verify/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyApiKey } from "@/lib/bingx/trade";
import { verifyFuturesApiKey } from "@/lib/bingx/futures";

/** 分别验证现货与合约权限。任一通过即视为可用密钥 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { apiKey, secret } = await request.json();
    if (!apiKey?.trim() || !secret?.trim()) {
      return NextResponse.json(
        { success: false, error: { message: "apiKey and secret are required" } },
        { status: 400 }
      );
    }

    const [spotOk, futuresOk] = await Promise.all([
      verifyApiKey(apiKey.trim(), secret.trim()),
      verifyFuturesApiKey(apiKey.trim(), secret.trim()),
    ]);

    return NextResponse.json({
      success: true,
      data: { spotOk, futuresOk, isValid: spotOk || futuresOk },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: 改造 `src/app/api/user/api-keys/route.ts` 的 POST 分支**

把现有 POST 里从 `// Verify the API key works before saving` 到 `.single();` 的整段替换为：

```typescript
    const trimmedKey = apiKey.trim();
    const trimmedSecret = secret.trim();

    // 分别验证：只有合约权限的 Key 不应被判为无效
    const [spotOk, futuresOk] = await Promise.all([
      verifyApiKey(trimmedKey, trimmedSecret),
      verifyFuturesApiKey(trimmedKey, trimmedSecret),
    ]);
    const isValid = spotOk || futuresOk;

    const encryptedKey = encrypt(trimmedKey);
    const encryptedSecret = encrypt(trimmedSecret);

    // 该用户还没有主密钥时，新加的这把自动成为主密钥
    const { count: primaryCount } = await supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .eq("is_primary", true);

    const { data, error: insertError } = await supabase
      .from("api_keys")
      .insert({
        user_id: authData.user.id,
        label: label.trim(),
        api_key_encrypted: encryptedKey,
        secret_encrypted: encryptedSecret,
        api_key_masked: maskApiKey(trimmedKey),
        encryption_version: 1,
        is_valid: isValid,
        spot_ok: spotOk,
        futures_ok: futuresOk,
        is_primary: (primaryCount ?? 0) === 0 && isValid,
        last_verified_at: isValid ? new Date().toISOString() : null,
      })
      .select("id, label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary, last_verified_at, created_at")
      .single();
```

并把该文件顶部的 import 补成：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { verifyApiKey } from "@/lib/bingx/trade";
import { verifyFuturesApiKey } from "@/lib/bingx/futures";
import { maskApiKey } from "@/lib/utils";
```

- [ ] **Step 3: 在同一文件末尾新增 PATCH 处理器**

```typescript
/** 设为主密钥 / 重新验证 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }
    const userId = authData.user.id;
    const { id, action } = await request.json();
    if (!id || !action) {
      return NextResponse.json(
        { success: false, error: { message: "id and action are required" } },
        { status: 400 }
      );
    }

    if (action === "setPrimary") {
      // 唯一索引限制每用户至多一个 primary，必须先清后设
      await supabase.from("api_keys").update({ is_primary: false }).eq("user_id", userId);
      const { error } = await supabase
        .from("api_keys").update({ is_primary: true }).eq("id", id).eq("user_id", userId);
      if (error) {
        return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "reverify") {
      const { data: row } = await supabase
        .from("api_keys")
        .select("api_key_encrypted, secret_encrypted")
        .eq("id", id).eq("user_id", userId).single();
      if (!row) {
        return NextResponse.json({ success: false, error: { message: "Key not found" } }, { status: 404 });
      }

      const k = decrypt(row.api_key_encrypted);
      const s = decrypt(row.secret_encrypted);
      const [spotOk, futuresOk] = await Promise.all([verifyApiKey(k, s), verifyFuturesApiKey(k, s)]);
      const isValid = spotOk || futuresOk;

      const { data, error } = await supabase
        .from("api_keys")
        .update({
          spot_ok: spotOk,
          futures_ok: futuresOk,
          is_valid: isValid,
          api_key_masked: maskApiKey(k),
          last_verified_at: isValid ? new Date().toISOString() : null,
        })
        .eq("id", id).eq("user_id", userId)
        .select("id, label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary, last_verified_at, created_at")
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
      }
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
```

- [ ] **Step 4: 让删除主密钥后自动补选一把**

把 DELETE 分支里 `if (deleteError) {...}` 之后、`return NextResponse.json({ success: true });` 之前插入：

```typescript
    // 删掉的可能正是主密钥；补选最早创建的有效密钥顶上，避免下单时无 key 可选
    const { count } = await supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .eq("is_primary", true);

    if ((count ?? 0) === 0) {
      const { data: next } = await supabase
        .from("api_keys")
        .select("id")
        .eq("user_id", authData.user.id)
        .eq("is_valid", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) {
        await supabase.from("api_keys").update({ is_primary: true }).eq("id", next.id);
      }
    }
```

- [ ] **Step 5: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 6: 手动验证**

用一个真实 BingX Key 在 `/settings/api-keys` 添加，然后在 Supabase SQL Editor 查：

```sql
SELECT label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary FROM public.api_keys ORDER BY created_at DESC LIMIT 3;
```

Expected: `api_key_masked` 形如 `abcd****wxyz`；`spot_ok` / `futures_ok` 与该 Key 在 BingX 后台勾选的权限一致；首把 Key 的 `is_primary` 为 true。

- [ ] **Step 7: Commit**

```bash
git add src/app/api/user/api-keys/route.ts src/app/api/user/api-keys/verify/route.ts
git commit -m "feat(api): verify spot and futures permissions separately, add key masking and primary selection"
```

---

## Task 16: 杠杆与保证金模式路由返回真实结果

现有 `positions` 路由的 `setLeverage` / `setMarginType` 无论成败都回 `{ success: true }`，前端因此无法感知失败。

**Files:**
- Modify: `src/app/api/bingx/futures/positions/route.ts`

**Interfaces:**
- Consumes: `getLeverage` / `setLeverage` / `getMarginType` / `setMarginType` / `getPositionSideDual`（`@/lib/bingx/futures`）、`invalidateDualSideMode`、`describeBingXError`
- Produces:
  - `GET ?type=accountMode` → `{ dualSidePosition: boolean }`
  - `GET ?type=leverage&symbol=` → `{ leverage: number; maxLeverage: number }`
  - `POST { action: "setLeverage" | "setMarginType" }` 失败时返回 502 与 `i18nKey`

- [ ] **Step 1: 在 GET 分支中新增两种查询类型**

在 `if (type === "balance") {...}` 之后插入：

```typescript
    if (type === "accountMode") {
      const mode = await getPositionSideDual(apiKey, secret);
      return NextResponse.json({
        success: true,
        data: { dualSidePosition: mode?.dualSidePosition === true },
      });
    }

    if (type === "leverage") {
      if (!symbol) {
        return NextResponse.json(
          { success: false, error: { message: "symbol is required" } },
          { status: 400 }
        );
      }
      const [lev, margin] = await Promise.all([
        getLeverage(apiKey, secret, symbol),
        getMarginType(apiKey, secret, symbol).catch(() => ({ marginType: "" })),
      ]);
      return NextResponse.json({
        success: true,
        data: { leverage: lev.leverage, maxLeverage: lev.maxLeverage, marginType: margin.marginType },
      });
    }
```

并把该文件顶部 import 补上 `getLeverage`、`getMarginType`、`getPositionSideDual`：

```typescript
import {
  getFuturesPositions, closePosition, getFuturesBalance,
  getLeverage, setLeverage, getMarginType, setMarginType,
  getPositionSideDual, setPositionTpSl, closeAllPositions, adjustPositionMargin,
} from "@/lib/bingx/futures";
import { invalidateDualSideMode } from "@/lib/trading/account-mode";
import { describeBingXError } from "@/lib/trading/errors";
```

- [ ] **Step 2: 让 POST 的写操作把失败如实报出**

把整个 `switch (action) {...}` 连同其后的 `return ... "Invalid action"` 包进 try/catch，并替换 `setLeverage` / `setMarginType` 两个 case：

```typescript
    try {
      switch (action) {
        case "closePosition": {
          if (!positionId) {
            return NextResponse.json(
              { success: false, error: { message: "positionId is required to close a position" } },
              { status: 400 }
            );
          }
          return NextResponse.json({
            success: true,
            data: await closePosition(apiKey, secret, positionId),
          });
        }
        case "closeAllPositions":
          return NextResponse.json({ success: true, data: await closeAllPositions(apiKey, secret, symbol) });
        case "setLeverage": {
          const lev = Number(leverage);
          if (!(lev > 0)) {
            return NextResponse.json(
              { success: false, error: { message: "leverage must be positive" } },
              { status: 400 }
            );
          }
          await setLeverage(apiKey, secret, symbol, Math.floor(lev), positionSide);
          // 回读交易所实际值，前端据此显示而非乐观假设
          const applied = await getLeverage(apiKey, secret, symbol);
          return NextResponse.json({
            success: true,
            data: { leverage: applied.leverage, maxLeverage: applied.maxLeverage },
          });
        }
        case "setMarginType": {
          if (marginType !== "ISOLATED" && marginType !== "CROSSED") {
            return NextResponse.json(
              { success: false, error: { message: "marginType must be ISOLATED or CROSSED" } },
              { status: 400 }
            );
          }
          await setMarginType(apiKey, secret, symbol, marginType);
          return NextResponse.json({ success: true, data: { marginType } });
        }
        case "setPositionTpSl":
          await setPositionTpSl(apiKey, secret, { symbol, positionSide, stopLossPrice, takeProfitPrice });
          return NextResponse.json({ success: true });
        case "setPositionMode": {
          invalidateDualSideMode(authData.user.id);
          return NextResponse.json({ success: true });
        }
        case "adjustMargin":
          return NextResponse.json({
            success: true,
            data: await adjustPositionMargin(apiKey, secret, symbol, positionId, String(amount), directionType || 1),
          });
      }
      return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
    } catch (e) {
      const described = describeBingXError(e);
      return NextResponse.json(
        { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
        { status: 502 }
      );
    }
```

- [ ] **Step 3: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 手动验证**

`npm run dev`，用已绑 Key 的 Pro 账号在 Console 执行：

```javascript
await (await fetch("/api/bingx/futures/positions?type=leverage&symbol=BTC-USDT")).json()
await (await fetch("/api/bingx/futures/positions?type=accountMode")).json()
```

Expected: 前者返回 `{leverage, maxLeverage, marginType}`；后者返回 `{dualSidePosition: true|false}`。再故意设一个超出上限的杠杆（如 `leverage: 9999`），应返回 502 且带 `i18nKey`——而不是像以前那样静默返回成功。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/bingx/futures/positions/route.ts
git commit -m "feat(api): report real leverage and margin type results instead of silent success"
```

---

## Task 17: Admin 限额配置路由

**Files:**
- Create: `src/app/api/admin/trading-limits/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`（`@/lib/supabase/admin-auth`）、`createServiceClient`（`@/lib/supabase/service`）
- Produces:
  - `GET /api/admin/trading-limits` → `{ rows: Array<{ id, user_id, ... }> }`
  - `PUT /api/admin/trading-limits` — `{ userId: string | null, maxNotionalPerOrder, maxOrdersPerDay, maxLeverage, allowedSymbols }`
  - `DELETE /api/admin/trading-limits?id=` — 删除某条覆盖配置

实现前先阅读 `src/lib/supabase/admin-auth.ts` 与任一现有 admin 路由（如 `src/app/api/admin/settings/route.ts`），照搬其鉴权与 service client 用法——本任务不引入新的鉴权模式。

- [ ] **Step 1: 阅读现有 admin 路由的鉴权写法**

Run: 打开 `src/app/api/admin/settings/route.ts` 与 `src/lib/supabase/admin-auth.ts`，确认 `requireAdmin()` 的返回形状与失败时的响应约定。

- [ ] **Step 2: 创建 `src/app/api/admin/trading-limits/route.ts`**

按上一步确认的模式实现三个处理器。骨架如下，`requireAdmin` 的调用与失败分支需与现有 admin 路由完全一致：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceClient } from "@/lib/supabase/service";

const SELECT_COLS =
  "id, user_id, max_notional_per_order, max_orders_per_day, max_leverage, allowed_symbols, updated_at";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("trading_limits")
    .select(SELECT_COLS)
    .order("user_id", { ascending: true, nullsFirst: true });

  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { rows: data ?? [] } });
}

export async function PUT(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard) return guard;

  const body = await request.json();
  const { userId, maxNotionalPerOrder, maxOrdersPerDay, maxLeverage, allowedSymbols } = body;

  // 空字符串与 undefined 一律落成 NULL——NULL 的语义是「不限制」
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const toSymbols = (v: unknown): string[] | null => {
    if (v === null || v === undefined || v === "") return null;
    if (Array.isArray(v)) return v.length ? v.map(String) : [];
    return String(v).split(",").map((s) => s.trim()).filter(Boolean);
  };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("trading_limits")
    .upsert(
      {
        user_id: userId ?? null,
        max_notional_per_order: toNum(maxNotionalPerOrder),
        max_orders_per_day: toNum(maxOrdersPerDay),
        max_leverage: toNum(maxLeverage),
        allowed_symbols: toSymbols(allowedSymbols),
        updated_at: new Date().toISOString(),
      },
      { onConflict: userId ? "user_id" : undefined, ignoreDuplicates: false }
    )
    .select(SELECT_COLS)
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard) return guard;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: { message: "id is required" } }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("trading_limits").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
```

> 注：全局默认行（`user_id IS NULL`）的唯一索引是部分索引，`upsert` 的 `onConflict` 无法直接引用。若 Step 3 验证时全局行出现重复，改为「先 `select` 查是否存在，存在则 `update`、不存在则 `insert`」的两步写法。

- [ ] **Step 3: 手动验证**

`npm run dev`，以管理员身份登录后在 Console 执行：

```javascript
await (await fetch("/api/admin/trading-limits", {
  method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: null, maxNotionalPerOrder: 500, maxLeverage: 20 })
})).json()
await (await fetch("/api/admin/trading-limits")).json()
```

Expected: PUT 返回写入的行；GET 返回含该行的数组。重复执行 PUT 两次后 GET 应仍只有**一条**全局行——若出现两条，按 Step 2 的注释改用 select-then-update 写法。

- [ ] **Step 4: 验证限额真的会拦截下单**

保持上面配置的 `maxNotionalPerOrder: 500`，用普通用户在 Console 执行：

```javascript
await (await fetch("/api/bingx/trade/order", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", type: "MARKET", notionalUsdt: 900, referencePrice: 60000 })
})).json()
```

Expected: `{"success":false,"error":{"code":"NOTIONAL_TOO_LARGE","limit":500,...}}`，且 Supabase 的 `orders` 表新增一行 `risk_rejected = true`、`risk_reason = 'NOTIONAL_TOO_LARGE'`。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/trading-limits/route.ts
git commit -m "feat(admin): add trading limits configuration API"
```

---
