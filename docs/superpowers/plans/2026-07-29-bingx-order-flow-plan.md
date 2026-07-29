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
- **阶段 2（Task 8–17）** — 数据库迁移与服务端下单链路
- **阶段 3（Task 25, 18, 19, 20+21, 22, 23, 24）** — 三语文案先行，然后前端表单重整、设置页与后台
- **阶段 4（Task 26）** — 验证脚本与验收清单

### ⚠️ 执行顺序与编号不同

任务编号保持原样（便于交叉引用），但**执行顺序经过调整**：

```
1 → 2 → … → 17 → 25 → 18 → 19 → [20 + 21 合并为一次] → 22 → 23 → 24 → 26
```

两条调整及其原因：

1. **Task 25（三语文案）提到阶段 3 最前**。原顺序让 Task 19/21/23 先引用尚不存在的翻译 key，再靠占位文案撑到最后统一补齐；占位文案会横跨 5 个任务，与 Global Constraints 第一条（用户可见文案必须三语齐全）直接冲突。文案先行后，所有 UI 任务直接用真 key。
2. **Task 20（确认弹窗）与 Task 21（OrderForm + 删旧表单）合并为一次实现**。改 `OrderConfirmModal` 的 props 会打断旧的 `TradeForm`，而旧表单在 Task 21 才删除——拆开做会让 Task 20 以红构建收尾。合并后每个任务都以绿构建收尾。

每个任务结束时代码都应处于可构建状态。

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
  /**
   * 必须小写。既有的 /orders 页面与 /dashboard 统计都以 `side === "buy"` 比较，
   * 写大写会让实盘单全部显示为 Sell 并污染胜率计算。
   */
  side: "buy" | "sell";
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
  /** 该订单类型是否以限价成交（LIMIT / STOP / TAKE_PROFIT 等）。决定换算基准 */
  isLimitOrder: boolean;
}

export type PreflightRejectCode =
  | "UNKNOWN_SYMBOL"
  | "NO_MARKET_PRICE"
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
      /** 服务端自行获取的市价，用于风控估值；绝不来自客户端 */
      marketPrice: number;
      /** 按服务端市价计算的真实敞口（USDT），风控校验用的就是这个数 */
      riskNotionalUsdt: number;
    }
  | { ok: false; code: PreflightRejectCode; limit?: number | string };
```

> **12b（计划外修正）**：`preflightOrder` 用客户端提交的 `referencePrice` 同时做换算数量与风控估值，导致 `qty × referencePrice` 恒等于用户提交的 `notionalUsdt`——风控看到的名义额永远等于调用方声称的数字，与真实敞口无关（谎称 BTC 值 1 美元即可让「100 USDT」的订单换算出 100 BTC）。修正：风控估值一律用服务端自行获取的市价（`NO_MARKET_PRICE` 为新增拒绝码；取不到市价时直接拒单，绝不放行）；换算数量维持原语义——市价单用市价、限价单用用户的限价。详见 `preflight.ts` 里的 `fetchMarketPrice` 与 `PreflightInput.isLimitOrder`。

- [ ] **Step 2: 创建 `src/lib/trading/preflight.ts`**

> 下面这份代码片段已经是 **12b 修正后** 的版本（含服务端市价获取）；最初实现时用的是修正前的版本（换算与风控估值都直接用 `input.referencePrice`），那个版本有第 12b 节开头说的那个洞，已被取代。

```typescript
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSymbolSpec } from "./spec";
import { quoteToBase, validateOrderSize, formatQty, requiredMargin } from "./sizing";
import { mergeLimits, checkLimits } from "./limits";
import { countOrdersToday } from "./persist";
import { getSpotTicker, getFuturesTicker } from "@/lib/bingx/market";
import type { TradingLimits, PreflightInput, PreflightResult, TradingMarket } from "@/types/trading";

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
 * 获取服务端市价。
 *
 * 风控估值绝不能用客户端提交的价格：调用方只要谎称 BTC 值 1 美元，
 * 就能让「100 USDT」的订单换算出 100 BTC，而风控看到的名义额仍是 100 USDT
 * （因为 qty × 客户端价格 恒等于 notionalUsdt）。价格必须由服务端自己取。
 *
 * 用的是公开行情接口，无需签名。
 */
async function fetchMarketPrice(symbol: string, market: TradingMarket): Promise<number> {
  const ticker = market === "spot"
    ? await getSpotTicker(symbol)
    : await getFuturesTicker(symbol);
  const price = parseFloat(ticker?.lastPrice ?? "");
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * 下单前置检查：规格 → 市价 → 换算 → 尺寸校验 → 风控限额。
 * 返回 ok:true 时，qty 已经对齐精度、可直接发给 BingX。
 */
export async function preflightOrder(
  supabase: SupabaseClient,
  input: PreflightInput
): Promise<PreflightResult> {
  const spec = await getSymbolSpec(input.symbol, input.market, input.direction);
  if (!spec) return { ok: false, code: "UNKNOWN_SYMBOL" };

  const marketPrice = await fetchMarketPrice(input.symbol, input.market);
  if (!(marketPrice > 0)) return { ok: false, code: "NO_MARKET_PRICE" };

  // 换算基准：市价单一律用服务端市价；限价单用用户的限价（那是用户的真实意图）
  const sizingPrice = input.isLimitOrder ? input.referencePrice : marketPrice;
  const sizing = quoteToBase(input.notionalUsdt, sizingPrice, spec);
  const sizeCheck = validateOrderSize(sizing, spec);
  if (!sizeCheck.ok) return { ok: false, code: sizeCheck.reason, limit: sizeCheck.limit };

  // 真实敞口按服务端市价计算，而不是 sizing.notional——后者对市价单恒等于
  // 用户提交的 notionalUsdt，对限价单则随用户的限价任意缩放，两者都不能用于风控
  const riskNotionalUsdt = sizing.qty * marketPrice;

  // 交易所杠杆上限不在公开规格里（BingX 的公开合约接口不返回 maxLongLeverage /
  // maxShortLeverage，2026-07-29 实测 0/944），因此 spec.maxLeverage 实践中恒为
  // undefined，这里只能强制管理员配置的上限。超出交易所上限的请求由交易所拒绝，
  // 错误经 errors.ts 映射。若 BingX 日后恢复公开返回，下面这行会自动收紧为两者更严者。
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
      notional: riskNotionalUsdt,
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
    marketPrice,
    riskNotionalUsdt,
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

  // 落库用小写：既有 /orders 页面与 dashboard 统计都按 "buy"/"sell" 比较
  const sideLower = side === "BUY" ? "buy" : "sell";

  // preflightOrder can THROW: getSymbolSpec deliberately does not cache failures and
  // rethrows on a BingX network error. Without this wrapper a transient exchange
  // outage surfaces to the user as a bare 500 with no readable message.
  let pre;
  try {
    // 限价类的 refPrice 仍是换算基准；市价类的 refPrice 现在只用于展示，
    // preflightOrder 内部风控估值一律用服务端市价，不再信任这里传的值。
    pre = await preflightOrder(supabase, {
      userId,
      market: "spot",
      symbol,
      direction: side === "BUY" ? "LONG" : "SHORT",
      notionalUsdt: notional,
      referencePrice: refPrice,
      leverage: 1,
      isLimitOrder: LIMIT_TYPES.has(type),
    });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }

  // pre.code 也可能是 12b 引入的 NO_MARKET_PRICE（服务端取不到市价，直接拒单）
  if (!pre.ok) {
    await recordOrder(supabase, {
      userId, apiKeyId: null, market: "spot", symbol, side: sideLower, orderType: type,
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
      userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: type,
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
      userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: type,
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

  // request.json() throws a raw SyntaxError on a malformed or empty body, which would
  // escape as a generic Next.js 500 instead of the documented error envelope.
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return reject("INVALID_BODY", "Malformed JSON body", 400);
  }

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

  // preflightOrder can THROW: getSymbolSpec deliberately does not cache failures and
  // rethrows on a BingX network error. Without this wrapper a transient exchange
  // outage surfaces to the user as a bare 500 with no readable message.
  let pre;
  try {
    // 限价类的 refPrice 仍是换算基准；市价类的 refPrice 现在只用于展示，
    // preflightOrder 内部风控估值一律用服务端市价，不再信任这里传的值。
    pre = await preflightOrder(supabase, {
      userId, market: "futures", symbol, direction,
      notionalUsdt: notional, referencePrice: refPrice, leverage: lev,
      isLimitOrder: LIMIT_TYPES.has(type),
    });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }

  // 落库用小写：既有 /orders 页面与 dashboard 统计都按 "buy"/"sell" 比较
  // pre.code 也可能是 12b 引入的 NO_MARKET_PRICE（服务端取不到市价，直接拒单）
  const sideForLog = direction === "LONG" ? "buy" : "sell";
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

## Task 18: 前端数据 hooks（规格 / 账户 / 预览）

**Files:**
- Create: `src/hooks/useSymbolSpec.ts`
- Create: `src/hooks/useTradingAccount.ts`
- Create: `src/hooks/useOrderPreflight.ts`

**Interfaces:**
- Consumes: `SymbolSpec` / `OrderSizing`（`@/types/trading`）、`quoteToBase` / `validateOrderSize` / `requiredMargin`（`@/lib/trading/sizing`，纯函数可在浏览器端复用）
- Produces:
  - `useSymbolSpec(symbol, market, side?)` → React Query，`data: SymbolSpec`
  - `useSpotBalances()` → `Array<{ asset, free, locked }>`
  - `useFuturesAccount(symbol)` → `{ availableMargin, leverage, maxLeverage, marginType, dualSidePosition }`
  - `useOrderPreflight({ spec, notionalUsdt, price, leverage })` → `{ sizing, validation, requiredMarginUsdt, estLiquidationPrice }`

前端预览与服务端用**同一套** `sizing.ts` 纯函数，因此显示的数量与服务端实际下单的数量一致。

- [ ] **Step 1: 创建 `src/hooks/useSymbolSpec.ts`**

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SymbolSpec, TradingMarket } from "@/types/trading";

async function fetchSpec(
  symbol: string,
  market: TradingMarket,
  side: "LONG" | "SHORT"
): Promise<SymbolSpec> {
  const url = new URL("/api/trading/spec", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("market", market);
  url.searchParams.set("side", side);
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Failed to load symbol spec");
  return json.data as SymbolSpec;
}

/** 交易对规格几乎不变，缓存 1 小时，不做轮询 */
export function useSymbolSpec(
  symbol: string,
  market: TradingMarket,
  side: "LONG" | "SHORT" = "LONG"
) {
  return useQuery({
    queryKey: ["trading", "spec", market, symbol, side],
    queryFn: () => fetchSpec(symbol, market, side),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: !!symbol,
    retry: 1,
  });
}
```

- [ ] **Step 2: 创建 `src/hooks/useTradingAccount.ts`**

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";

interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

interface FuturesAccount {
  availableMargin: number;
  equity: number;
  leverage: number;
  maxLeverage: number;
  marginType: string;
  dualSidePosition: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

/** 现货可用余额。enabled=false 时（未登录/未绑 Key）不发请求 */
export function useSpotBalances(enabled = true) {
  return useQuery({
    queryKey: ["trading", "spot-balances"],
    queryFn: async () => {
      const data = await getJson<{ balances: SpotBalance[] }>("/api/bingx/account/balance");
      return data.balances ?? [];
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled,
    retry: false,
  });
}

/** 单个交易对的合约账户状态：可用保证金 + 当前/最大杠杆 + 保证金模式 + 持仓模式 */
export function useFuturesAccount(symbol: string, enabled = true) {
  return useQuery<FuturesAccount>({
    queryKey: ["trading", "futures-account", symbol],
    queryFn: async () => {
      const [balance, leverage, mode] = await Promise.all([
        getJson<{ availableMargin: string; equity: string } | null>(
          "/api/bingx/futures/positions?type=balance"
        ),
        getJson<{ leverage: number; maxLeverage: number; marginType: string }>(
          `/api/bingx/futures/positions?type=leverage&symbol=${encodeURIComponent(symbol)}`
        ),
        getJson<{ dualSidePosition: boolean }>("/api/bingx/futures/positions?type=accountMode"),
      ]);
      return {
        availableMargin: parseFloat(balance?.availableMargin ?? "0") || 0,
        equity: parseFloat(balance?.equity ?? "0") || 0,
        leverage: leverage.leverage,
        maxLeverage: leverage.maxLeverage,
        marginType: leverage.marginType,
        dualSidePosition: mode.dualSidePosition,
      };
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled: enabled && !!symbol,
    retry: false,
  });
}
```

- [ ] **Step 3: 创建 `src/hooks/useOrderPreflight.ts`**

```typescript
"use client";

import { useMemo } from "react";
import { quoteToBase, validateOrderSize, requiredMargin } from "@/lib/trading/sizing";
import type { SymbolSpec, OrderSizing, SizeValidation } from "@/types/trading";

interface PreflightArgs {
  spec: SymbolSpec | undefined;
  notionalUsdt: number;
  price: number;
  leverage: number;
  direction: "LONG" | "SHORT";
}

export interface OrderPreflightPreview {
  sizing: OrderSizing | null;
  validation: SizeValidation | null;
  requiredMarginUsdt: number;
  estFee: number;
  /** 逐仓近似强平价；仅作量级提示，交易所实际值以持仓面板为准 */
  estLiquidationPrice: number | null;
}

/**
 * 前端预览。复用服务端同一套 sizing 纯函数，
 * 因此这里显示的数量与服务端最终下单的数量一致。
 */
export function useOrderPreflight({
  spec, notionalUsdt, price, leverage, direction,
}: PreflightArgs): OrderPreflightPreview {
  return useMemo(() => {
    if (!spec || !(notionalUsdt > 0) || !(price > 0)) {
      return { sizing: null, validation: null, requiredMarginUsdt: 0, estFee: 0, estLiquidationPrice: null };
    }

    const sizing = quoteToBase(notionalUsdt, price, spec);
    const validation = validateOrderSize(sizing, spec);
    const margin = requiredMargin(sizing.notional, leverage);
    const estFee = sizing.notional * (spec.takerFeeRate ?? 0);

    // 逐仓近似：多头 P_liq ≈ P × (1 - 1/L)，空头 ≈ P × (1 + 1/L)。
    // 未计入维持保证金率与手续费，真实强平价由交易所给出，这里只用于量级提示。
    let estLiquidationPrice: number | null = null;
    if (spec.market === "futures" && leverage >= 1) {
      estLiquidationPrice =
        direction === "LONG" ? price * (1 - 1 / leverage) : price * (1 + 1 / leverage);
    }

    return { sizing, validation, requiredMarginUsdt: margin, estFee, estLiquidationPrice };
  }, [spec, notionalUsdt, price, leverage, direction]);
}
```

- [ ] **Step 4: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSymbolSpec.ts src/hooks/useTradingAccount.ts src/hooks/useOrderPreflight.ts
git commit -m "feat(trade): add symbol spec, account and preflight preview hooks"
```

---

## Task 19: 下单表单字段组件

**Files:**
- Create: `src/components/trade/order-form/config.ts`
- Create: `src/components/trade/order-form/fields/AmountField.tsx`
- Create: `src/components/trade/order-form/fields/LeverageField.tsx`
- Create: `src/components/trade/order-form/fields/PriceFields.tsx`
- Create: `src/components/trade/order-form/OrderPreview.tsx`

**Interfaces:**
- Consumes: `SymbolSpec`、`OrderPreflightPreview`（Task 18）、现有 `Input` / `Button` / `cn` / `formatPrice` / `formatNumber`
- Produces:
  - `MARKET_CONFIG: Record<OrderFormMarket, MarketConfig>`
  - `<AmountField />`、`<LeverageField />`、`<PriceFields />`、`<OrderPreview />`

- [ ] **Step 1: 创建 `src/components/trade/order-form/config.ts`**

```typescript
export type OrderFormMarket = "spot" | "futures" | "paper";

export interface OrderTypeOption {
  key: string;
  label: string;
  descKey: string;
}

export interface MarketConfig {
  /** 是否显示杠杆选择 */
  hasLeverage: boolean;
  /** 是否走真实资金 */
  isLive: boolean;
  /** 方向按钮文案的 i18n key */
  longLabelKey: string;
  shortLabelKey: string;
  /** 简单模式下可选的订单类型 */
  simpleTypes: string[];
  /** 专业模式下可选的订单类型 */
  proTypes: string[];
}

const SPOT_TYPES = [
  "MARKET", "LIMIT",
  "TAKE_STOP_MARKET", "TAKE_STOP_LIMIT",
  "TRIGGER_MARKET", "TRIGGER_LIMIT",
];

const FUTURES_TYPES = [
  "MARKET", "LIMIT",
  "STOP_MARKET", "STOP",
  "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
  "TRAILING_STOP_MARKET", "TRAILING_TP_SL",
];

export const MARKET_CONFIG: Record<OrderFormMarket, MarketConfig> = {
  spot: {
    hasLeverage: false,
    isLive: true,
    longLabelKey: "trading.side.buy",
    shortLabelKey: "trading.side.sell",
    simpleTypes: ["MARKET", "LIMIT"],
    proTypes: SPOT_TYPES,
  },
  futures: {
    hasLeverage: true,
    isLive: true,
    longLabelKey: "trading.side.long",
    shortLabelKey: "trading.side.short",
    simpleTypes: ["MARKET", "LIMIT"],
    proTypes: FUTURES_TYPES,
  },
  paper: {
    hasLeverage: true,
    isLive: false,
    longLabelKey: "trading.side.long",
    shortLabelKey: "trading.side.short",
    simpleTypes: ["MARKET", "LIMIT"],
    proTypes: ["MARKET", "LIMIT"],
  },
};

export const LIMIT_TYPES = new Set([
  "LIMIT", "TAKE_STOP_LIMIT", "TRIGGER_LIMIT", "STOP", "TAKE_PROFIT",
]);
export const STOP_TYPES = new Set([
  "TAKE_STOP_MARKET", "TAKE_STOP_LIMIT", "TRIGGER_MARKET", "TRIGGER_LIMIT",
  "STOP_MARKET", "STOP", "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
]);
export const TRAILING_TYPES = new Set(["TRAILING_STOP_MARKET", "TRAILING_TP_SL"]);
/** 只有市价/限价单能附带止盈止损对象（BingX 限制） */
export const TPSL_ATTACHABLE = new Set(["MARKET", "LIMIT"]);
```

- [ ] **Step 2: 创建 `src/components/trade/order-form/fields/AmountField.tsx`**

单位提示常驻，消除现货 MARKET/LIMIT 之间的语义跳变（缺陷 C4）；百分比按真实可用余额算（缺陷 A6）。

```typescript
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Input";
import { formatNumber, formatPrice, cn } from "@/lib/utils";

interface AmountFieldProps {
  /** 用户输入的仓位名义额（USDT） */
  value: string;
  onChange: (v: string) => void;
  /** 可用余额（USDT）。undefined 表示未知，隐藏百分比按钮 */
  availableUsdt?: number;
  /** 杠杆；名义额上限 = 可用余额 × 杠杆 */
  leverage: number;
  /** 换算出的币数量，用于「≈ 0.0012 BTC」提示 */
  estQty?: number;
  baseAsset: string;
  disabled?: boolean;
}

const PERCENTS = [25, 50, 75, 100];

export function AmountField({
  value, onChange, availableUsdt, leverage, estQty, baseAsset, disabled,
}: AmountFieldProps) {
  const t = useTranslations();
  const buyingPower = availableUsdt !== undefined ? availableUsdt * Math.max(1, leverage) : undefined;

  const applyPercent = (pct: number) => {
    if (buyingPower === undefined) return;
    onChange(((buyingPower * pct) / 100).toFixed(2));
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
        {/* 单位始终写明，不随订单类型切换语义 */}
        <span>{t("trading.amount_label")}</span>
        {buyingPower !== undefined && (
          <div className="flex gap-1">
            {PERCENTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => applyPercent(p)}
                className="rounded-xs px-1 text-xs hover:text-gold disabled:opacity-50"
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </div>

      <Input
        placeholder="0.00"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm"
      />

      <div className="mt-1 space-y-0.5 text-xs text-text-muted">
        {estQty !== undefined && estQty > 0 && (
          <div className={cn("flex justify-between")}>
            <span>{t("trading.est_qty")}</span>
            <span className="font-mono text-text-primary tabular-nums">
              ≈ {formatNumber(estQty, 8)} {baseAsset}
            </span>
          </div>
        )}
        {availableUsdt !== undefined && (
          <div className="flex justify-between">
            <span>{t("trading.available")}</span>
            <span className="font-mono tabular-nums">{formatPrice(availableUsdt)} USDT</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `src/components/trade/order-form/fields/LeverageField.tsx`**

杠杆改为显式动作：pending 期间禁用，失败回滚显示（缺陷 B2）；上限取自需签名接口回读的真实 `maxLeverage`（缺陷 B7）——`SymbolSpec.maxLeverage` 实践中恒为 `undefined`，不可依赖。

```typescript
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface LeverageFieldProps {
  value: number;
  maxLeverage: number;
  marginType?: string;
  /** 提交到交易所；resolve 为交易所回读的实际杠杆，reject 表示失败 */
  onApply: (leverage: number) => Promise<number>;
  onApplyMarginType?: (marginType: "ISOLATED" | "CROSSED") => Promise<void>;
  /** 模拟盘不打交易所，直接本地设置 */
  localOnly?: boolean;
  onLocalChange?: (leverage: number) => void;
}

const PRESETS = [1, 2, 3, 5, 10, 20, 50, 75, 100, 125];

export function LeverageField({
  value, maxLeverage, marginType, onApply, onApplyMarginType, localOnly, onLocalChange,
}: LeverageFieldProps) {
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const presets = PRESETS.filter((p) => p <= maxLeverage);

  const apply = async (lev: number) => {
    if (lev < 1 || lev > maxLeverage) {
      setError(t("trading.leverage_out_of_range", { max: maxLeverage }));
      return;
    }
    setError(null);
    if (localOnly) {
      onLocalChange?.(lev);
      return;
    }
    setPending(true);
    try {
      // 成功时用交易所回读值，而非乐观假设
      const applied = await onApply(lev);
      onLocalChange?.(applied);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("trading.leverage_failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
        <span>{t("trading.leverage")}</span>
        <span className={cn("font-mono tabular-nums", value > 20 ? "font-semibold text-danger" : "text-gold")}>
          {value}x {pending && <span className="ml-1 opacity-60">…</span>}
        </span>
      </div>

      <div className="mb-1 grid grid-cols-5 gap-1">
        {presets.map((l) => (
          <button
            key={l}
            type="button"
            disabled={pending}
            onClick={() => apply(l)}
            className={cn(
              "rounded-xs py-0.5 text-xs font-medium disabled:opacity-50",
              value === l ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted hover:text-text-secondary"
            )}
          >
            {l}x
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        <input
          type="number"
          min={1}
          max={maxLeverage}
          inputMode="numeric"
          placeholder={t("trading.custom_leverage", { max: maxLeverage })}
          value={custom}
          disabled={pending}
          onChange={(e) => setCustom(e.target.value)}
          className="w-full rounded-xs bg-bg-tertiary px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-gold/30 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={pending || !custom}
          onClick={() => apply(parseInt(custom, 10))}
          className="rounded-xs bg-bg-hover px-2 text-xs text-text-secondary disabled:opacity-50"
        >
          {t("common.confirm")}
        </button>
      </div>

      {onApplyMarginType && (
        <div className="mt-2 flex gap-1">
          {(["ISOLATED", "CROSSED"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={async () => {
                setError(null);
                setPending(true);
                try {
                  await onApplyMarginType(m);
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("trading.margin_type_failed"));
                } finally {
                  setPending(false);
                }
              }}
              className={cn(
                "flex-1 rounded-xs py-1 text-xs disabled:opacity-50",
                marginType?.toUpperCase() === m
                  ? "bg-gold/20 text-gold"
                  : "bg-bg-tertiary text-text-muted"
              )}
            >
              {t(`trading.margin_type.${m.toLowerCase()}`)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: 创建 `src/components/trade/order-form/fields/PriceFields.tsx`**

```typescript
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Input";
import { formatPrice } from "@/lib/utils";
import { LIMIT_TYPES, STOP_TYPES, TRAILING_TYPES, TPSL_ATTACHABLE } from "../config";

interface PriceFieldsProps {
  orderType: string;
  currentPrice: number;
  price: string;
  onPriceChange: (v: string) => void;
  stopPrice: string;
  onStopPriceChange: (v: string) => void;
  callbackPercent: string;
  onCallbackPercentChange: (v: string) => void;
  tpPrice: string;
  onTpPriceChange: (v: string) => void;
  slPrice: string;
  onSlPriceChange: (v: string) => void;
  showTpSl: boolean;
  onToggleTpSl: (v: boolean) => void;
}

export function PriceFields(p: PriceFieldsProps) {
  const t = useTranslations();
  const isLimit = LIMIT_TYPES.has(p.orderType);
  const isStop = STOP_TYPES.has(p.orderType);
  const isTrailing = TRAILING_TYPES.has(p.orderType);
  const canAttachTpSl = TPSL_ATTACHABLE.has(p.orderType);

  return (
    <>
      {isLimit ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>{t("trading.limit_price")}</span>
            <span className="font-mono tabular-nums">≈ {formatPrice(p.currentPrice)}</span>
          </div>
          <Input
            placeholder="0.00" inputMode="decimal" value={p.price}
            onChange={(e) => p.onPriceChange(e.target.value)} className="text-sm"
          />
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{t("trading.market_price")}</span>
          <span className="font-mono tabular-nums text-text-primary">{formatPrice(p.currentPrice)}</span>
        </div>
      )}

      {isStop && (
        <div>
          <div className="mb-1 text-xs text-text-muted">{t("trading.stop_price")}</div>
          <Input
            placeholder="0.00" inputMode="decimal" value={p.stopPrice}
            onChange={(e) => p.onStopPriceChange(e.target.value)} className="text-sm"
          />
        </div>
      )}

      {isTrailing && (
        <div>
          <div className="mb-1 text-xs text-text-muted">{t("trading.callback_rate")}</div>
          <Input
            placeholder="1" inputMode="decimal" value={p.callbackPercent}
            onChange={(e) => p.onCallbackPercentChange(e.target.value)} className="text-sm"
          />
          <p className="mt-0.5 text-xs text-text-muted/60">
            {t("trading.callback_rate_hint", { pct: p.callbackPercent || "1" })}
          </p>
        </div>
      )}

      {canAttachTpSl && (
        <div className="border-t border-border-default pt-2">
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox" checked={p.showTpSl} className="rounded-xs"
              onChange={(e) => p.onToggleTpSl(e.target.checked)}
            />
            {t("trading.set_tp_sl")}
          </label>
          {p.showTpSl && (
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-xs text-text-muted">{t("trading.take_profit_price")}</div>
                <Input
                  placeholder="0.00" inputMode="decimal" value={p.tpPrice}
                  onChange={(e) => p.onTpPriceChange(e.target.value)} className="text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-text-muted">{t("trading.stop_loss_price")}</div>
                <Input
                  placeholder="0.00" inputMode="decimal" value={p.slPrice}
                  onChange={(e) => p.onSlPriceChange(e.target.value)} className="text-sm"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: 创建 `src/components/trade/order-form/OrderPreview.tsx`**

```typescript
"use client";

import { useTranslations } from "next-intl";
import { formatNumber, formatPrice, cn } from "@/lib/utils";
import type { OrderPreflightPreview } from "@/hooks/useOrderPreflight";
import type { SymbolSpec } from "@/types/trading";

interface OrderPreviewProps {
  preview: OrderPreflightPreview;
  spec: SymbolSpec | undefined;
  baseAsset: string;
  leverage: number;
  showMargin: boolean;
}

export function OrderPreview({ preview, spec, baseAsset, leverage, showMargin }: OrderPreviewProps) {
  const t = useTranslations();
  const { sizing, validation, requiredMarginUsdt, estFee, estLiquidationPrice } = preview;

  if (!sizing || sizing.qty <= 0) return null;

  const rejected = validation && !validation.ok ? validation : null;

  return (
    <div className="space-y-0.5 rounded-xs border border-border-default bg-bg-tertiary p-2 text-xs">
      <Row label={t("trading.est_qty")} value={`${formatNumber(sizing.qty, spec?.quantityPrecision ?? 6)} ${baseAsset}`} />
      <Row label={t("trading.notional")} value={`${formatPrice(sizing.notional)} USDT`} />
      {showMargin && (
        <Row
          label={t("trading.required_margin")}
          value={`${formatPrice(requiredMarginUsdt)} USDT`}
          emphasis
        />
      )}
      {showMargin && estLiquidationPrice !== null && leverage > 1 && (
        <Row label={t("trading.est_liq_price")} value={`≈ ${formatPrice(estLiquidationPrice)}`} />
      )}
      {estFee > 0 && <Row label={t("trading.est_fee")} value={`≈ ${formatPrice(estFee)} USDT`} />}

      {rejected && (
        <p className="mt-1 text-danger">
          {t(`trading.reject.${rejected.reason.toLowerCase()}`, {
            limit: rejected.limit ?? "",
          })}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className={cn("font-mono tabular-nums", emphasis ? "font-semibold text-gold" : "text-text-primary")}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: 确认构建通过**

Run: `npm run build`
Expected: 构建成功。本任务用到的 `trading.*` 翻译 key 已在 Task 25 中补齐（见执行顺序说明），若报缺 key，说明该 key 在 Task 25 中被遗漏——回到 `src/i18n/messages/` 三份文件补上，不要用占位文案。

- [ ] **Step 7: Commit**

```bash
git add src/components/trade/order-form/
git commit -m "feat(trade): add order form field components with unit hints and explicit leverage"
```

---

## Task 20: 扩展确认弹窗以支持合约

合约现在点一下直接发真单，最高 300x 那一侧反而没有任何摩擦（缺陷 B1）。本任务把确认弹窗做成合约的**必经**步骤。

**Files:**
- Modify: `src/components/trade/OrderConfirmModal.tsx`

**Interfaces:**
- Consumes: `formatPrice` / `formatNumber` / `cn`
- Produces: `OrderConfirmModalProps` 新增 `market` / `direction` / `leverage` / `requiredMarginUsdt` / `estLiquidationPrice` / `estQty` / `baseAsset`

- [ ] **Step 1: 用以下内容整体替换 `src/components/trade/OrderConfirmModal.tsx`**

```typescript
"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatNumber, cn } from "@/lib/utils";

/** 超过这个杠杆时显示更醒目的警示 */
const HIGH_LEVERAGE_THRESHOLD = 20;

interface OrderConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  market: "spot" | "futures" | "paper";
  /** 现货用 BUY/SELL 语义，合约与模拟盘用 LONG/SHORT */
  direction: "LONG" | "SHORT";
  symbol: string;
  baseAsset: string;
  orderTypeLabel: string;
  /** 仓位名义额（USDT） */
  notionalUsdt: number;
  /** 换算出的币数量 */
  estQty: number;
  /** 参考价 */
  price: number;
  leverage: number;
  requiredMarginUsdt: number;
  estLiquidationPrice?: number | null;
  /** 可用余额；未知时隐藏占比行 */
  availableUsdt?: number;
}

export function OrderConfirmModal({
  open, onClose, onConfirm, loading = false,
  market, direction, symbol, baseAsset, orderTypeLabel,
  notionalUsdt, estQty, price, leverage, requiredMarginUsdt,
  estLiquidationPrice, availableUsdt,
}: OrderConfirmModalProps) {
  const t = useTranslations();
  const isLong = direction === "LONG";
  const isFutures = market === "futures" || market === "paper";
  const isPaper = market === "paper";
  const highLeverage = isFutures && leverage > HIGH_LEVERAGE_THRESHOLD;

  const pctOfBalance =
    availableUsdt && availableUsdt > 0 ? (requiredMarginUsdt / availableUsdt) * 100 : null;

  return (
    <Modal open={open} onClose={loading ? () => {} : onClose} title={t("trading.confirm_title")} size="sm">
      <div className="space-y-4">
        {isPaper && (
          <div className="rounded-xs bg-gold/10 px-3 py-1.5 text-center text-xs font-medium text-gold">
            {t("trading.paper_banner")}
          </div>
        )}

        <p className="text-sm text-text-secondary">
          {t.rich("trading.confirm_summary", {
            dir: () => (
              <span className={cn("mx-1 font-semibold", isLong ? "text-success" : "text-danger")}>
                {t(isFutures
                  ? isLong ? "trading.side.long" : "trading.side.short"
                  : isLong ? "trading.side.buy" : "trading.side.sell")}
              </span>
            ),
            qty: () => (
              <span className="font-semibold text-text-primary">
                {formatNumber(estQty, 8)} {baseAsset}
              </span>
            ),
            notional: () => (
              <span className="font-semibold text-text-primary">
                {formatPrice(notionalUsdt)} USDT
              </span>
            ),
          })}
        </p>

        <div className="rounded-xs border border-border-default bg-bg-tertiary p-3 text-xs">
          <Row label={t("trading.symbol")} value={symbol} />
          <Row label={t("trading.order_type")} value={orderTypeLabel} />
          <Row label={t("trading.est_price")} value={formatPrice(price)} />
          <Row label={t("trading.notional")} value={`${formatPrice(notionalUsdt)} USDT`} />
          {isFutures && <Row label={t("trading.leverage")} value={`${leverage}x`} danger={highLeverage} />}
          {/* 名义额与保证金必须同屏出现：这是新手最容易混淆的一步 */}
          {isFutures && (
            <Row
              label={t("trading.required_margin")}
              value={`${formatPrice(requiredMarginUsdt)} USDT`}
              emphasis
            />
          )}
          {isFutures && estLiquidationPrice != null && leverage > 1 && (
            <Row label={t("trading.est_liq_price")} value={`≈ ${formatPrice(estLiquidationPrice)}`} />
          )}
          {pctOfBalance !== null && (
            <Row label={t("trading.pct_of_balance")} value={`${pctOfBalance.toFixed(1)}%`} />
          )}
        </div>

        {highLeverage && (
          <div className="rounded-xs border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t("trading.high_leverage_warning", { leverage })}
          </div>
        )}

        <p className="text-xs text-text-muted">{t("trading.risk_note")}</p>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button variant={isLong ? "green" : "red"} size="sm" onClick={onConfirm} loading={loading}>
            {t("trading.confirm_button")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({
  label, value, emphasis, danger,
}: { label: string; value: string; emphasis?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-text-muted">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          danger ? "font-semibold text-danger" : emphasis ? "font-semibold text-gold" : "text-text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}
```

> **本任务与 Task 21 合并执行。** 单独改完 `OrderConfirmModal` 会让旧的 `TradeForm` props 不匹配、构建变红；Task 21 删除旧表单后构建才恢复绿色。因此不要在这里单独 build/commit——完成本任务的 Step 1 后直接进入 Task 21，两者共用 Task 21 的验证与提交步骤。

---

## Task 21: 统一下单表单 `OrderForm` 并替换旧表单

三种市场共用一个壳。旧的 `TradeForm.tsx`（395 行，两套 percent 逻辑交织）与 `FuturesTradeForm.tsx` 一并删除。

**Files:**
- Create: `src/components/trade/order-form/OrderForm.tsx`
- Modify: `src/app/[locale]/trade/page.tsx`
- Delete: `src/components/trade/TradeForm.tsx`
- Delete: `src/components/trade/FuturesTradeForm.tsx`

**Interfaces:**
- Consumes: `MARKET_CONFIG` / `LIMIT_TYPES` / `STOP_TYPES` / `TRAILING_TYPES`（Task 19）、`AmountField` / `LeverageField` / `PriceFields` / `OrderPreview`（Task 19）、`useSymbolSpec` / `useSpotBalances` / `useFuturesAccount` / `useOrderPreflight`（Task 18）、`OrderConfirmModal`（Task 20）、`useSpotTicker`（现有）、`usePaperAccount` / `usePlacePaperOrder`（现有）
- Produces: `<OrderForm symbol market initialSide? />`

- [ ] **Step 1: 创建 `src/components/trade/order-form/OrderForm.tsx`**

```typescript
"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSpotTicker } from "@/hooks/useMarketData";
import { usePaperAccount, usePlacePaperOrder } from "@/hooks/usePaperTrading";
import { useSymbolSpec } from "@/hooks/useSymbolSpec";
import { useSpotBalances, useFuturesAccount } from "@/hooks/useTradingAccount";
import { useOrderPreflight } from "@/hooks/useOrderPreflight";
import { Button } from "@/components/ui/Button";
import { OrderConfirmModal } from "@/components/trade/OrderConfirmModal";
import { AmountField } from "./fields/AmountField";
import { LeverageField } from "./fields/LeverageField";
import { PriceFields } from "./fields/PriceFields";
import { OrderPreview } from "./OrderPreview";
import { MARKET_CONFIG, LIMIT_TYPES, STOP_TYPES, TRAILING_TYPES, type OrderFormMarket } from "./config";
import { cn } from "@/lib/utils";

interface OrderFormProps {
  symbol: string;
  market: OrderFormMarket;
  initialSide?: "long" | "short";
}

export function OrderForm({ symbol, market, initialSide }: OrderFormProps) {
  const t = useTranslations();
  const cfg = MARKET_CONFIG[market];
  const baseAsset = symbol.split("-")[0] ?? symbol;

  const [direction, setDirection] = useState<"LONG" | "SHORT">(
    initialSide === "short" ? "SHORT" : "LONG"
  );
  const [uiMode, setUiMode] = useState<"simple" | "pro">("simple");
  const [orderType, setOrderType] = useState("MARKET");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [callbackPercent, setCallbackPercent] = useState("1");
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [showTpSl, setShowTpSl] = useState(false);
  const [leverage, setLeverage] = useState(market === "spot" ? 1 : 10);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const specMarket = market === "spot" ? "spot" : "futures";
  const { data: spec } = useSymbolSpec(symbol, specMarket, direction);
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const { data: paperData } = usePaperAccount(market === "paper");
  const placePaperOrder = usePlacePaperOrder();
  const { data: spotBalances } = useSpotBalances(market === "spot");
  const { data: futuresAccount } = useFuturesAccount(symbol, market === "futures");

  // 切换到不支持的订单类型时回退到市价
  const availableTypes = uiMode === "simple" ? cfg.simpleTypes : cfg.proTypes;
  useEffect(() => {
    if (!availableTypes.includes(orderType)) setOrderType("MARKET");
  }, [availableTypes, orderType]);

  // 交易所实际杠杆是权威值，UI 跟随它
  useEffect(() => {
    if (market === "futures" && futuresAccount?.leverage) setLeverage(futuresAccount.leverage);
  }, [market, futuresAccount?.leverage]);

  const availableUsdt = useMemo(() => {
    if (market === "paper") return paperData?.account.balance_usdt ?? 0;
    if (market === "futures") return futuresAccount?.availableMargin;
    return spotBalances?.find((b) => b.asset === "USDT")
      ? parseFloat(spotBalances.find((b) => b.asset === "USDT")!.free)
      : undefined;
  }, [market, paperData, futuresAccount, spotBalances]);

  const isLimit = LIMIT_TYPES.has(orderType);
  const refPrice = isLimit && parseFloat(price) > 0 ? parseFloat(price) : currentPrice;
  const notional = parseFloat(amount) || 0;
  const effectiveLeverage = cfg.hasLeverage ? leverage : 1;

  const preview = useOrderPreflight({
    spec, notionalUsdt: notional, price: refPrice, leverage: effectiveLeverage, direction,
  });

  const maxLeverage = futuresAccount?.maxLeverage ?? spec?.maxLeverage ?? 125;

  const canSubmit = () => {
    if (!(notional > 0) || !preview.validation?.ok) return false;
    if (isLimit && !(parseFloat(price) > 0)) return false;
    if (STOP_TYPES.has(orderType) && !(parseFloat(stopPrice) > 0)) return false;
    if (TRAILING_TYPES.has(orderType) && !(parseFloat(callbackPercent) > 0)) return false;
    return true;
  };

  const applyLeverage = async (lev: number): Promise<number> => {
    const res = await fetch("/api/bingx/futures/positions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setLeverage", symbol, leverage: lev, positionSide: direction }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || t("trading.leverage_failed"));
    return json.data.leverage as number;
  };

  const applyMarginType = async (marginType: "ISOLATED" | "CROSSED") => {
    const res = await fetch("/api/bingx/futures/positions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setMarginType", symbol, marginType }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || t("trading.margin_type_failed"));
  };

  const execute = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      if (market === "paper") {
        const order = await placePaperOrder.mutateAsync({
          symbol,
          side: direction === "LONG" ? "buy" : "sell",
          quoteAmount: notional,
          leverage,
          ...(isLimit ? { orderType: "limit" as const, price: parseFloat(price) } : {}),
        });
        setResult({ ok: true, message: t("trading.paper_placed", { symbol, price: order.price ?? refPrice }) });
      } else if (market === "spot") {
        const json = await postOrder("/api/bingx/trade/order", {
          symbol, side: direction === "LONG" ? "BUY" : "SELL", type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          timeInForce: isLimit ? "GTC" : undefined,
        });
        if (!json.success) throw new Error(translateError(json, t));
        setResult({ ok: true, message: t("trading.order_placed", { id: json.data?.orderId ?? "" }) });
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
        if (!json.success) throw new Error(translateError(json, t));
        setResult({ ok: true, message: t("trading.order_placed", { id: json.data?.orderIdStr ?? "" }) });
      }
      setAmount(""); setPrice(""); setStopPrice(""); setTpPrice(""); setSlPrice("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : t("bingx_error.network") });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex border-b border-border-default">
        {(["LONG", "SHORT"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={cn(
              "flex-1 py-2.5 text-sm font-semibold",
              direction === d
                ? d === "LONG"
                  ? "border-b-2 border-success bg-success/10 text-success"
                  : "border-b-2 border-danger bg-danger/10 text-danger"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t(d === "LONG" ? cfg.longLabelKey : cfg.shortLabelKey)}
          </button>
        ))}
      </div>

      {/* 多空按钮语义说明：平仓走仓位面板，不用反向下单（缺陷 C2） */}
      {cfg.hasLeverage && (
        <p className="px-3 pt-2 text-xs text-text-muted/70">{t("trading.direction_hint")}</p>
      )}

      <div className="flex-1 space-y-2.5 p-3">
        <div className="flex items-center justify-end">
          <div className="flex rounded-xs bg-bg-tertiary p-0.5 text-xs">
            {(["simple", "pro"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setUiMode(m)}
                className={cn("rounded-xs px-2 py-0.5", uiMode === m ? "bg-bg-primary text-text-primary" : "text-text-muted")}
              >
                {t(`trading.ui_mode.${m}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-text-muted">{t("trading.order_type")}</div>
          <div className="grid grid-cols-2 gap-1">
            {availableTypes.map((k) => (
              <button
                key={k}
                onClick={() => setOrderType(k)}
                className={cn(
                  "rounded-xs py-1 text-xs font-medium",
                  orderType === k ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`trading.type.${k.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        {cfg.hasLeverage && (
          <LeverageField
            value={leverage}
            maxLeverage={maxLeverage}
            marginType={futuresAccount?.marginType}
            onApply={applyLeverage}
            onApplyMarginType={market === "futures" ? applyMarginType : undefined}
            localOnly={market === "paper"}
            onLocalChange={setLeverage}
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
        />

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
      </div>

      <OrderConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={execute}
        loading={submitting}
        market={market}
        direction={direction}
        symbol={symbol}
        baseAsset={baseAsset}
        orderTypeLabel={t(`trading.type.${orderType.toLowerCase()}`)}
        notionalUsdt={preview.sizing?.notional ?? 0}
        estQty={preview.sizing?.qty ?? 0}
        price={refPrice}
        leverage={effectiveLeverage}
        requiredMarginUsdt={preview.requiredMarginUsdt}
        estLiquidationPrice={preview.estLiquidationPrice}
        availableUsdt={availableUsdt}
      />
    </div>
  );
}

async function postOrder(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 服务端返回 i18nKey 时优先用它翻译，否则回落到原始信息 */
function translateError(json: { error?: { i18nKey?: string; message?: string; limit?: unknown } }, t: (k: string, v?: Record<string, unknown>) => string): string {
  const key = json.error?.i18nKey;
  if (key) {
    try {
      return t(key, { limit: String(json.error?.limit ?? "") });
    } catch {
      // key 缺失时回落到原文，不吞掉信息
    }
  }
  return json.error?.message || "Order failed";
}
```

- [ ] **Step 2: 在交易页改用 `OrderForm`**

`src/app/[locale]/trade/page.tsx` 第 13 行与第 17 行的两条 import 删除，改为：

```typescript
import { OrderForm } from "@/components/trade/order-form/OrderForm";
```

把 `tradePanel` 的定义（第 309–312 行）替换为：

```typescript
  const tradePanel = <OrderForm symbol={symbol} market={market} initialSide={initialSide} />;
```

`market` 的取值 `"spot" | "paper" | "futures"` 与 `OrderFormMarket` 完全一致，无需转换。

- [ ] **Step 3: 删除旧表单**

```bash
git rm src/components/trade/TradeForm.tsx src/components/trade/FuturesTradeForm.tsx
```

- [ ] **Step 4: 确认构建通过**

Run: `npm run build`
Expected: 构建成功。若有其他文件仍引用被删的组件，按报错改为 `OrderForm`。

- [ ] **Step 5: 浏览器验证三种市场**

`npm run dev`，打开 `/zh-CN/trade`：

1. **Spot** — 输入 100，应看到「≈ 0.00xx BTC」与「可用 xx USDT」；点 50% 应填入余额的一半而**不是字符串 50**（缺陷 A6 已修）
2. **模拟盘** — 切到模拟盘，杠杆按钮应即时生效（本地），预览显示所需保证金
3. **Futures**（需 Pro + 已绑 Key）— 杠杆按钮点击后应有 pending 态，成功后显示交易所回读值；输入 100 后预览应显示「所需保证金 = 100 ÷ 杠杆」而不是 100
4. 三种市场点主按钮都应先弹确认框，合约框内应有杠杆/保证金/预估强平价三行

- [ ] **Step 6: Commit**

```bash
git add src/components/trade/order-form/OrderForm.tsx src/app/[locale]/trade/page.tsx
git commit -m "feat(trade): unify spot, futures and paper order forms into one shell"
```

---

## Task 22: 合约仓位面板接上 positionId 平仓

Task 9 把 `closePosition` 改成按 `positionId` 平仓，`FuturesInfoPanel` 目前只传 `positionSide`，会返回 400。

**Files:**
- Modify: `src/components/trade/FuturesInfoPanel.tsx`

**Interfaces:**
- Consumes: `POST /api/bingx/futures/positions` 的 `closePosition` action（需 `positionId`）
- Produces: 无对外接口

- [ ] **Step 1: 给本地 `FuturesPosition` 接口补上 `positionId`**

在该文件第 12–22 行的接口里新增一行：

```typescript
  positionId: string;
```

- [ ] **Step 2: 改写 `handleClose` 使用 positionId 并处理失败**

把第 75–84 行的 `handleClose` 替换为：

```typescript
  const [closeError, setCloseError] = useState<string | null>(null);

  const handleClose = async (position: FuturesPosition) => {
    setClosing(position.positionId);
    setCloseError(null);
    try {
      const res = await fetch("/api/bingx/futures/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "closePosition", symbol, positionId: position.positionId }),
      });
      const json = await res.json();
      // 平仓失败必须让用户看见——静默失败会让人以为仓位已经平掉
      if (!json.success) setCloseError(json.error?.message || "Close failed");
    } catch {
      setCloseError("Network error");
    } finally {
      setClosing(null);
      fetchData();
    }
  };
```

- [ ] **Step 3: 更新调用处与 key**

把渲染仓位的 `<div key={pos.positionSide}` 改为 `<div key={pos.positionId}`（对冲模式下同一 symbol 可同时有多空两个仓位，用 positionId 更稳）。

把 Close 按钮的 `onClick={() => handleClose(pos.positionSide)}` 改为 `onClick={() => handleClose(pos)}`，`disabled={closing === pos.positionSide}` 改为 `disabled={closing === pos.positionId}`，按钮文案条件同理改为 `closing === pos.positionId`。

在 Positions 区块标题下方插入错误提示：

```typescript
        {closeError && (
          <p className="px-3 py-1.5 text-xs text-danger">{closeError}</p>
        )}
```

- [ ] **Step 4: 确认构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add src/components/trade/FuturesInfoPanel.tsx
git commit -m "fix(trade): close futures positions by positionId and surface failures"
```

---

## Task 23: API Key 设置页改造

**Files:**
- Modify: `src/app/[locale]/settings/api-keys/page.tsx`

**Interfaces:**
- Consumes: `PATCH /api/user/api-keys`（Task 15）、新增的 `api_key_masked` / `spot_ok` / `futures_ok` / `is_primary` 列
- Produces: 无对外接口

关键改动：真实掩码替换 `maskApiKey("encrypted")`（缺陷 C1）、现货/合约权限分别显示（缺陷 B6）、重新验证按钮、设为主密钥、**IP 白名单说明**。

- [ ] **Step 1: 扩展 `ApiKeyRow` 接口与查询列**

把 `ApiKeyRow` 接口（第 16–22 行）替换为：

```typescript
interface ApiKeyRow {
  id: string;
  label: string;
  api_key_masked: string | null;
  is_valid: boolean;
  spot_ok: boolean | null;
  futures_ok: boolean | null;
  is_primary: boolean;
  last_verified_at: string | null;
  created_at: string;
}
```

把 `fetchKeys` 里的 `.select(...)` 改为：

```typescript
      .select("id, label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary, last_verified_at, created_at")
```

- [ ] **Step 2: 新增两个操作处理函数**

在 `handleDeleteKey` 之后插入：

```typescript
  const [busyId, setBusyId] = useState<string | null>(null);

  const patchKey = async (id: string, action: "setPrimary" | "reverify") => {
    setBusyId(id);
    try {
      await fetch("/api/user/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
    } catch { /* 刷新列表即可反映真实状态 */ }
    setBusyId(null);
    fetchKeys();
  };
```

- [ ] **Step 3: 用真实掩码与权限徽章替换卡片内容**

把 `keys.map((key) => (...))` 内 `<Card>` 的整个 `<div className="min-w-0 flex-1 space-y-2">` 块替换为：

```typescript
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-text-primary">{key.label}</h3>
                    {key.is_primary && (
                      <Badge variant="gold" size="sm">{t("primary")}</Badge>
                    )}
                    {/* 现货与合约权限分开显示：只开了合约权限的 Key 不该被笼统标成「无效」 */}
                    <Badge variant={key.spot_ok ? "green" : "red"} size="sm">
                      {t("spot")} {key.spot_ok ? "✓" : "✗"}
                    </Badge>
                    <Badge variant={key.futures_ok ? "green" : "red"} size="sm">
                      {t("futures")} {key.futures_ok ? "✓" : "✗"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="font-mono text-sm text-text-secondary">
                      {key.api_key_masked ?? t("masked_unavailable")}
                    </p>
                    <p className="text-xs text-text-muted">
                      {t("added")}: {formatDate(key.created_at)}
                      {key.last_verified_at && ` · ${t("verified")}: ${formatDate(key.last_verified_at)}`}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={() => patchKey(key.id, "reverify")}
                      disabled={busyId === key.id}
                      className="text-text-muted hover:text-gold disabled:opacity-50"
                    >
                      {busyId === key.id ? t("validating") : t("reverify")}
                    </button>
                    {!key.is_primary && (
                      <button
                        onClick={() => patchKey(key.id, "setPrimary")}
                        disabled={busyId === key.id}
                        className="text-text-muted hover:text-gold disabled:opacity-50"
                      >
                        {t("set_primary")}
                      </button>
                    )}
                  </div>
                </div>
```

若 `Badge` 组件没有 `gold` variant，先打开 `src/components/ui/Badge.tsx` 确认可用的 variant 名，用最接近的替代（如 `default`），不要新增 variant。

- [ ] **Step 4: 在添加弹窗里加入 IP 白名单说明**

这是「绑了 Key 仍然下不了单」最常见的一类原因。把弹窗顶部那段 `<p className="text-xs text-text-muted">Your API key will be encrypted...</p>` 替换为：

```typescript
          <div className="space-y-2 rounded-xs border border-border-default bg-bg-tertiary p-3 text-xs text-text-muted">
            <p>{t("encrypted_notice")}</p>
            <p className="text-warning">{t("ip_whitelist_warning")}</p>
            <p>{t("permission_notice")}</p>
          </div>
```

- [ ] **Step 5: 确认构建通过**

Run: `npm run build`
Expected: 构建成功。本任务用到的 `api_keys.*` 新 key 已在 Task 25 中补齐（见执行顺序说明），若报缺 key，说明该 key 在 Task 25 中被遗漏——回到 `src/i18n/messages/` 三份文件补上，不要用占位文案。

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/settings/api-keys/page.tsx"
git commit -m "feat(settings): show real key mask, per-market permissions and IP whitelist warning"
```

---

## Task 24: Admin 限额配置页

**Files:**
- Create: `src/app/admin/trading-limits/page.tsx`
- Modify: `src/components/layout/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `/api/admin/trading-limits`（Task 17）
- Produces: 无对外接口

实现前先阅读一个现有 admin 页面（如 `src/app/admin/settings/SettingsEditor.tsx` 与 `src/app/admin/settings/page.tsx`），照搬其页面结构、表单样式与 `AdminPageHeading` 用法。

- [ ] **Step 1: 阅读现有 admin 页面模式**

Run: 打开 `src/app/admin/settings/page.tsx`、`src/app/admin/settings/SettingsEditor.tsx`、`src/components/layout/AdminSidebar.tsx`，确认页面壳、client 组件拆分方式与侧栏条目的写法。

- [ ] **Step 2: 创建 `src/app/admin/trading-limits/page.tsx`**

按上一步确认的模式实现。功能要求：

- 一个「全局默认」表单（`userId: null`），四个字段：单笔最大名义额（USDT）、每日最大下单次数、最大杠杆、允许交易对（逗号分隔）
- 每个字段旁标注「留空 = 不限制」——这是 spec 定的语义，界面必须写出来，否则管理员会误以为留空是 0
- 下方列出已有的按用户覆盖配置，可删除
- 保存调 `PUT /api/admin/trading-limits`，删除调 `DELETE ?id=`
- 保存成功/失败都要显示反馈

字段与 API 的对应关系：

| 界面字段 | 请求体键 | 空值含义 |
|---|---|---|
| 单笔最大名义额 | `maxNotionalPerOrder` | 不限制 |
| 每日最大下单次数 | `maxOrdersPerDay` | 不限制 |
| 最大杠杆 | `maxLeverage` | 不限制。注意：交易所自身的杠杆上限**不在**公开规格里（BingX 公开合约接口不返回，2026-07-29 实测 0/944），服务端无法据此兜底；留空即代表服务端不校验杠杆，超限请求由交易所拒绝 |
| 允许交易对 | `allowedSymbols`（逗号分隔字符串） | 不限制；填了就只有列表内的能交易 |

- [ ] **Step 3: 在 `AdminSidebar.tsx` 中新增入口**

按该文件现有条目的写法，在「站点设置」附近插入一条指向 `/admin/trading-limits` 的链接，文案「交易风控」。

- [ ] **Step 4: 手动验证**

`npm run dev`，以管理员登录访问 `/admin/trading-limits`：填入单笔最大 500、最大杠杆 20 后保存 → 刷新页面应回显；清空最大杠杆再保存 → 刷新后该字段应为空（而非 0）。

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/trading-limits/page.tsx src/components/layout/AdminSidebar.tsx
git commit -m "feat(admin): add trading limits configuration page"
```

---

## Task 25: 三语文案补齐

**Files:**
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Produces: `trading.*` 与 `bingx_error.*` 两个顶级命名空间；`api_keys.*` 下的若干新 key

- [ ] **Step 1: 在 `zh-CN.json` 顶层新增 `trading` 与 `bingx_error` 两个命名空间**

```json
  "trading": {
    "confirm_title": "确认订单",
    "confirm_summary": "你将<dir></dir>约 <qty></qty>，仓位价值 <notional></notional>。",
    "confirm_button": "确认下单",
    "paper_banner": "模拟盘 · 不涉及真实资金",
    "risk_note": "交易涉及风险，价格可能在下单后变化，实际成交以交易所结果为准。本平台不提供投资建议。",
    "symbol": "交易对",
    "order_type": "订单类型",
    "est_price": "参考价",
    "market_price": "市价",
    "limit_price": "限价",
    "stop_price": "触发价",
    "notional": "仓位价值",
    "required_margin": "所需保证金",
    "est_liq_price": "预估强平价",
    "est_fee": "预估手续费",
    "est_qty": "预计数量",
    "available": "可用",
    "pct_of_balance": "占可用余额",
    "amount_label": "仓位价值 (USDT)",
    "leverage": "杠杆",
    "custom_leverage": "自定义 (≤{max})",
    "leverage_out_of_range": "杠杆需在 1 到 {max} 之间",
    "leverage_failed": "设置杠杆失败",
    "margin_type_failed": "设置保证金模式失败",
    "callback_rate": "回撤率 (%)",
    "callback_rate_hint": "价格从最高点回撤 {pct}% 时触发市价单",
    "set_tp_sl": "设置止盈止损",
    "take_profit_price": "止盈价",
    "stop_loss_price": "止损价",
    "direction_hint": "做多 = 开多或加多，做空 = 开空或加空；平仓请到「订单」面板点平仓。",
    "high_leverage_warning": "{leverage}x 高杠杆：价格反向波动约 {leverage} 分之一即可能触发强平。",
    "order_placed": "下单成功 · {id}",
    "paper_placed": "模拟盘下单成功 · {symbol} @ {price}",
    "side": {
      "buy": "买入", "sell": "卖出", "long": "做多", "short": "做空"
    },
    "ui_mode": { "simple": "简单", "pro": "专业" },
    "margin_type": { "isolated": "逐仓", "crossed": "全仓" },
    "type": {
      "market": "市价", "limit": "限价",
      "take_stop_market": "止损市价", "take_stop_limit": "止损限价",
      "trigger_market": "触发市价", "trigger_limit": "触发限价",
      "stop_market": "止损市价", "stop": "止损限价",
      "take_profit_market": "止盈市价", "take_profit": "止盈限价",
      "trailing_stop_market": "追踪止损", "trailing_tp_sl": "追踪止盈止损",
      "oco": "OCO"
    },
    "reject": {
      "unknown_symbol": "交易所不支持该交易对",
      "no_market_price": "暂时无法获取市场价格，请稍后重试",
      "not_tradable": "该交易对当前暂停交易",
      "below_min_qty": "低于最小下单数量 {limit}",
      "below_min_notional": "低于最小下单金额 {limit} USDT",
      "zero_after_rounding": "金额太小，按该交易对精度换算后数量为 0",
      "invalid_input": "输入不合法",
      "notional_too_large": "超出单笔限额 {limit} USDT",
      "daily_limit_reached": "已达今日下单次数上限 {limit}",
      "leverage_too_high": "杠杆超出上限 {limit}x",
      "symbol_not_allowed": "该交易对不在允许列表内",
      "rate_limited": "下单过于频繁，请稍候再试",
      "pro_required": "合约交易需要 Pro 会员",
      "no_api_key": "请先在设置中绑定 BingX API 密钥",
      "missing_fields": "缺少必填字段",
      "missing_price": "限价单需要填写价格",
      "missing_stop_price": "该订单类型需要填写触发价",
      "invalid_amount": "金额必须大于 0",
      "invalid_price": "价格必须大于 0",
      "invalid_type": "不支持的订单类型",
      "invalid_side": "方向不合法",
      "invalid_direction": "方向不合法",
      "invalid_tif": "有效期设置不合法",
      "invalid_callback_rate": "回撤率需在 0 到 100 之间",
      "invalid_body": "请求格式不正确"
    }
  },
  "bingx_error": {
    "signature": "签名校验失败，请重新绑定 API 密钥",
    "no_permission": "API 密钥缺少交易权限，请在 BingX 后台勾选对应权限",
    "invalid_key": "API 密钥无效，或你的 BingX 密钥设置了 IP 白名单",
    "insufficient_margin": "保证金不足，请减小金额、降低杠杆或充值",
    "invalid_params": "订单参数不合法，请检查数量、价格与持仓模式",
    "service_busy": "交易所繁忙，请稍后重试",
    "network": "网络异常，请检查连接后重试",
    "unknown": "交易所返回未知错误"
  },
```

- [ ] **Step 2: 在 `zh-CN.json` 的 `api_keys` 下新增 key**

```json
    "primary": "主密钥",
    "set_primary": "设为主密钥",
    "reverify": "重新验证",
    "spot": "现货",
    "futures": "合约",
    "masked_unavailable": "（重新验证后显示）",
    "encrypted_notice": "密钥会加密后存储，并在保存时自动验证。",
    "ip_whitelist_warning": "请勿为该密钥设置 IP 白名单——本站部署在弹性云上，出口 IP 不固定，设了白名单会导致下单持续失败。",
    "permission_notice": "请在 BingX 后台同时勾选「现货交易」与「永续合约交易」权限；不要勾选提现权限。"
```

- [ ] **Step 3: 在 `en-US.json` 中补齐同样结构的英文文案**

键名与嵌套结构必须与 `zh-CN.json` 完全一致。占位符 `{limit}` / `{max}` / `{pct}` / `{leverage}` / `{id}` / `{symbol}` / `{price}` 保持原样。`confirm_summary` 的英文：`"You are about to <dir></dir> approximately <qty></qty>, position value <notional></notional>."`

- [ ] **Step 4: 在 `ms-MY.json` 中补齐马来文文案**

同上，键名结构一致。

- [ ] **Step 5: 校验三份文件的键结构完全一致**

```bash
node -e "const a=require('./src/i18n/messages/zh-CN.json'),b=require('./src/i18n/messages/en-US.json'),c=require('./src/i18n/messages/ms-MY.json');const walk=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v!==null?walk(v,p+k+'.'):[p+k]);const A=walk(a).sort(),B=walk(b).sort(),C=walk(c).sort();const diff=(x,y,nx,ny)=>x.filter(k=>!y.includes(k)).forEach(k=>console.log('missing in '+ny+':',k));diff(A,B,'zh','en');diff(A,C,'zh','ms');diff(B,A,'en','zh');diff(C,A,'ms','zh');console.log('keys:',A.length,B.length,C.length)"
```

Expected: 没有 `missing in` 输出，三个数字相等。

- [ ] **Step 6: 确认构建通过并在浏览器切换三语**

Run: `npm run build`，然后 `npm run dev` 分别访问 `/zh-CN/trade`、`/en-US/trade`、`/ms-MY/trade`
Expected: 下单表单、确认弹窗、错误提示在三种语言下都无 raw key 泄漏、无布局溢出

- [ ] **Step 7: Commit**

```bash
git add src/i18n/messages/
git commit -m "feat(i18n): add trading and BingX error translations in all three locales"
```

---

## Task 26: 合约订单 dry-run 验证脚本与验收清单

不接 VST 的前提下，这是能自动化的最后一道验证。用官方 `order/test` 端点跑通全部 8 种合约订单类型，验签名与参数合法性但不成交。

**Files:**
- Create: `scripts/verify-order-dry-run.mjs`
- Create: `docs/superpowers/plans/2026-07-29-acceptance-checklist.md`

**Interfaces:**
- Consumes: 运行时从环境变量读 `BINGX_API_KEY` / `BINGX_SECRET`（**不读数据库、不解密用户密钥**）
- Produces: 命令行报告，每种订单类型一行 PASS/FAIL

- [ ] **Step 1: 创建 `scripts/verify-order-dry-run.mjs`**

```javascript
#!/usr/bin/env node
/**
 * 用 BingX 官方 dry-run 端点验证全部合约订单类型的参数正确性。
 * 不会真正成交。
 *
 * 用法：
 *   BINGX_API_KEY=xxx BINGX_SECRET=yyy node scripts/verify-order-dry-run.mjs
 *
 * 注意：只读环境变量里的密钥，绝不触碰数据库中用户的加密密钥。
 */
import { createHmac } from "node:crypto";

const API_KEY = process.env.BINGX_API_KEY;
const SECRET = process.env.BINGX_SECRET;
const SYMBOL = process.env.SYMBOL || "BTC-USDT";

if (!API_KEY || !SECRET) {
  console.error("Set BINGX_API_KEY and BINGX_SECRET in the environment.");
  process.exit(1);
}

const BASE = "https://open-api.bingx.com";

async function signedPost(path, params) {
  const all = { ...params, timestamp: Date.now() };
  const qs = Object.keys(all).sort().map((k) => `${k}=${all[k]}`).join("&");
  const sig = createHmac("sha256", SECRET).update(qs).digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "X-BX-APIKEY": API_KEY,
      "X-SOURCE-KEY": "BX-AI-SKILL",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `${qs}&signature=${sig}`,
    signal: AbortSignal.timeout(10000),
  });
  return JSON.parse(await res.text());
}

async function getJson(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { headers: { "X-SOURCE-KEY": "BX-AI-SKILL" } });
  return res.json();
}

const contracts = await getJson("/openApi/swap/v2/quote/contracts");
const contract = (contracts.data || []).find((c) => c.symbol === SYMBOL);
if (!contract) {
  console.error(`Contract not found: ${SYMBOL}`);
  process.exit(1);
}

const ticker = await getJson("/openApi/swap/v2/quote/ticker", { symbol: SYMBOL });
const price = parseFloat(ticker.data?.lastPrice ?? ticker.data?.[0]?.lastPrice ?? "0");
if (!(price > 0)) {
  console.error("Could not read a reference price");
  process.exit(1);
}

// 用最小名义额的两倍换算数量，向下取整到合约精度
const notional = Math.max(contract.tradeMinUSDT * 2, 10);
const p = contract.quantityPrecision;
const qty = (Math.floor((notional / price) * 10 ** p) / 10 ** p).toFixed(p);

console.log(`Symbol ${SYMBOL} · price ${price} · qty ${qty} (notional ≈ ${notional} USDT)`);
console.log(`quantityPrecision=${p} tradeMinUSDT=${contract.tradeMinUSDT} maxLongLeverage=${contract.maxLongLeverage}\n`);

const dual = await (async () => {
  const all = { timestamp: Date.now() };
  const qs = `timestamp=${all.timestamp}`;
  const sig = createHmac("sha256", SECRET).update(qs).digest("hex");
  const res = await fetch(`${BASE}/openApi/swap/v1/positionSide/dual?${qs}&signature=${sig}`, {
    headers: { "X-BX-APIKEY": API_KEY, "X-SOURCE-KEY": "BX-AI-SKILL" },
  });
  const j = await res.json();
  // BingX 文档说这里是 bool，但同一接口的 POST 收字符串 "true"/"false"，
  // signedRequest 式的响应又不做运行时校验——app 里 account-mode.ts 已经
  // 踩过这个坑（2026-07-29 修复），这里独立实现同一份判断，同样要兼容两种形状。
  const raw = j.data?.dualSidePosition;
  return raw === true || raw === "true";
})();

const positionSide = dual ? "LONG" : "BOTH";
console.log(`Account position mode: ${dual ? "hedge (LONG/SHORT)" : "one-way (BOTH)"} → positionSide=${positionSide}\n`);

const base = { symbol: SYMBOL, side: "BUY", positionSide, quantity: qty };
const cases = [
  ["MARKET", { ...base, type: "MARKET" }],
  ["LIMIT", { ...base, type: "LIMIT", price: (price * 0.9).toFixed(contract.pricePrecision), timeInForce: "GTC" }],
  ["STOP_MARKET", { ...base, type: "STOP_MARKET", stopPrice: (price * 0.9).toFixed(contract.pricePrecision) }],
  ["STOP", { ...base, type: "STOP", stopPrice: (price * 0.9).toFixed(contract.pricePrecision), price: (price * 0.89).toFixed(contract.pricePrecision) }],
  ["TAKE_PROFIT_MARKET", { ...base, type: "TAKE_PROFIT_MARKET", stopPrice: (price * 1.1).toFixed(contract.pricePrecision) }],
  ["TAKE_PROFIT", { ...base, type: "TAKE_PROFIT", stopPrice: (price * 1.1).toFixed(contract.pricePrecision), price: (price * 1.11).toFixed(contract.pricePrecision) }],
  // priceRate 是小数：0.01 = 1%。这里正是修复前会误发 1（=100%）的地方
  ["TRAILING_STOP_MARKET", { ...base, type: "TRAILING_STOP_MARKET", priceRate: 0.01 }],
  ["TRAILING_TP_SL", { ...base, type: "TRAILING_TP_SL", priceRate: 0.01 }],
  ["MARKET + attached TP/SL", {
    ...base, type: "MARKET",
    stopLoss: JSON.stringify({ type: "STOP_MARKET", stopPrice: Number((price * 0.9).toFixed(contract.pricePrecision)), workingType: "MARK_PRICE" }),
    takeProfit: JSON.stringify({ type: "TAKE_PROFIT_MARKET", stopPrice: Number((price * 1.1).toFixed(contract.pricePrecision)), workingType: "MARK_PRICE" }),
  }],
];

let failed = 0;
for (const [name, params] of cases) {
  const r = await signedPost("/openApi/swap/v2/trade/order/test", params);
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${r.code}: ${r.msg}`}`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: 运行脚本**

```bash
BINGX_API_KEY=your_key BINGX_SECRET=your_secret node scripts/verify-order-dry-run.mjs
```

Expected: 9/9 passed。若 `TRAILING_TP_SL` 报错，通常是因为该类型要求已有持仓——在报告中标注为「需持仓」，不算失败。

- [ ] **Step 3: 创建验收清单 `docs/superpowers/plans/2026-07-29-acceptance-checklist.md`**

```markdown
# BingX 下单链路 验收清单

自动化验证到此为止。以下步骤需要人工执行，其中合约真单**必须由项目所有者亲自操作**。

## A. 自动化（已完成才勾）

- [ ] `npm test` 全绿（trading 纯函数层）
- [ ] `npm run build` 无错误
- [ ] `node scripts/verify-order-dry-run.mjs` 9/9 通过
- [ ] 三语 key 结构校验脚本无 `missing in` 输出

## B. 服务端权威性（浏览器 Console，不产生真单）

- [ ] 金额 0.5 USDT 下单 → 返回 `BELOW_MIN_NOTIONAL` 或 `ZERO_AFTER_ROUNDING`，未打交易所
- [ ] 配置全局单笔限额 500 后，下 900 USDT → 返回 `NOTIONAL_TOO_LARGE`
- [ ] 上一条在 `orders` 表留下 `risk_rejected = true` 的记录
- [ ] `priceRatePercent: 150` → 返回 `INVALID_CALLBACK_RATE`，未打交易所
- [ ] 未绑 Key 的账号下单 → 返回 `NO_API_KEY` 而非 500

## C. 界面（`npm run dev`）

- [ ] 现货点「50%」填入余额一半，不是字符串 `50`
- [ ] 现货与合约都显示可用余额
- [ ] 合约输入 100 USDT，预览显示「所需保证金 = 100 ÷ 杠杆」，不是 100
- [ ] 合约杠杆按钮点击后有 pending 态；设一个超上限值会显示可读错误而非静默成功
- [ ] 合约点下单先弹确认框，框内含杠杆 / 所需保证金 / 预估强平价
- [ ] 杠杆 > 20x 时确认框出现高杠杆警示
- [ ] API Key 页显示真实前4后4掩码，现货/合约权限分别标记
- [ ] API Key 添加弹窗显示 IP 白名单警告
- [ ] 三语切换下单表单与确认框均无 raw key 泄漏

## D. 真实资金（需人工，按顺序）

- [ ] **现货小额真单**：BTC-USDT 市价买入约 6 USDT（略高于最小 5），确认成交
- [ ] 该笔出现在 `/orders` 页面（验证落库）
- [ ] **合约真单（项目所有者亲自执行）**：
  - [ ] 名义额 5–10 USDT、杠杆 **1x**、市价开多
  - [ ] 确认框显示的「预计数量」与交易所实际成交数量一致 ← **这是 A1 缺陷修复的最终证据**
  - [ ] 仓位出现在 Positions 面板
  - [ ] 点「平仓」成功平掉（验证 positionId 平仓路径）
  - [ ] 两笔都出现在 `/orders` 页面

## E. 已知未覆盖

- 未接入 VST，合约真单只能由人工验证一次
- 内存限流在 Vercel 多实例下无法跨实例生效；真正护栏是服务端限额
- 预估强平价为简化公式，未计入维持保证金率与手续费，仅作量级提示
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-order-dry-run.mjs
git add -f docs/superpowers/plans/2026-07-29-acceptance-checklist.md
git commit -m "test: add futures dry-run verification script and acceptance checklist"
```

---

## 自查记录

**Spec 覆盖核对**（缺陷编号对应 spec 的现状缺陷清单）：

| 缺陷 | 覆盖任务 |
|---|---|
| A1 合约数量单位 | Task 3（换算）+ Task 14（路由发 quantity）+ Task 21（UI 收 USDT） |
| A2 priceRate 覆盖与百分比 | Task 9（去掉覆盖）+ Task 14（÷100）+ Task 26（dry-run 验证） |
| A3 positionSide 单向模式 | Task 10（resolveOrderDirection）+ Task 14（109400 重试） |
| A4 响应嵌套 | Task 9（unwrapOrder） |
| A5 精度/最小量 | Task 2（归一化）+ Task 3（校验）+ Task 6（规格路由）+ Task 18/19（前端预览） |
| A6 百分比按钮 | Task 19（AmountField 按真实余额） |
| A7 平仓路径 | Task 9（改 v1 + positionId）+ Task 22（面板接线） |
| A8 多 Key 选择 | Task 8（is_primary 列）+ Task 13/14（order by primary）+ Task 15/23（设为主密钥） |
| A9 余额 v3 与类型 | Task 9 |
| B1 合约确认弹窗 | Task 20 + Task 21 |
| B2 杠杆静默设置 | Task 16（返回真实结果）+ Task 19（LeverageField pending/回滚） |
| B3 实盘余额 | Task 18（hooks）+ Task 19（AmountField）+ Task 20（确认框） |
| B4 orders 落库 | Task 11 + Task 13/14 |
| B5 限流 | Task 7 + Task 13/14 |
| B6 双权限验证 | Task 15 + Task 23 |
| B7 杠杆上限与风控 | Task 5 + Task 8 + Task 12（取交易对与配置的更严者）+ Task 17/24 |
| C1 假掩码 / IP 白名单 | Task 15（masked 列）+ Task 23（展示与警告） |
| C2 多空按钮说明 | Task 21（direction_hint）+ Task 25（文案） |
| C3 合约取价 | Task 18（useFuturesAccount 提供账户态）；**注**：`OrderForm` 仍用 `useSpotTicker` 取价，见下方遗留项 |
| C4 单位提示 | Task 19（AmountField 常驻单位）+ Task 25 |

**遗留项（需在执行时确认）：**

1. **C3 未完全闭合** —— `OrderForm` 目前仍用 `useSpotTicker(symbol)` 取参考价。合约与现货价格存在基差，且纯合约品种没有现货行情。执行 Task 21 时应补一个 `useFuturesTicker`（走 `/api/bingx/market/ticker?market=futures`，`getFuturesTicker` 已存在于 `src/lib/bingx/market.ts`），在 `market === "futures"` 时改用它。若该 API 路由尚不支持 `market` 参数，需要一并扩展 `src/app/api/bingx/market/ticker/route.ts`。
2. **`useSpotSymbols` 的调用方** —— Task 2 改了 `BingXSymbol` 的形状，`MarketOverview` 等若依赖 `baseAsset` / `quoteAsset` 需改用 `symbol.split("-")`。执行 Task 2 Step 8 时按构建报错处理。
3. **`Badge` 的 `gold` variant** —— Task 23 用到，需先确认组件是否支持。
4. **OCO 现货订单** —— 旧 `TradeForm` 支持 OCO，`OrderForm` 未纳入（`config.ts` 的 `SPOT_TYPES` 里没有）。`/api/bingx/trade/oco-order` 路由与 `placeOcoOrder` 保留但暂时无 UI 入口。若需保留该功能，应作为独立后续任务处理——它的参数结构（limitPrice/triggerPrice/orderPrice 三价）与统一表单差异较大，硬塞进来会让表单复杂度显著上升。
