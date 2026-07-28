# BingX 下单链路重建 — 设计文档

日期：2026-07-29
状态：已批准，待实施

## 背景

Chart-IX 的核心闭环是「学习 → 模拟盘 → 绑定 BingX API 实盘下单」。对现有下单链路与 BingX 官方文档（`BingX-API/api-ai-skills` 仓库的 `swap-trade` / `spot-trade` / `swap-account` api-reference 及 `references/error-codes`）逐条比对后确认：**签名层正确，但下单参数与界面存在多处会导致下单失败或下错规模的缺陷。合约尤其严重。**

签名层无需改动——`src/lib/bingx/signed-request.ts` 与官方 `fetchSigned` 一致（参数排序、HMAC-SHA256、POST 用 form-urlencoded body、`X-SOURCE-KEY` 头、json-bigint 解析、.com→.pro 网络错误回退）。`src/lib/crypto.ts` 的 AES-256-GCM 密钥存储同样无问题。

## 现状缺陷清单

### A. 导致下单失败或下错规模

| # | 问题 | 位置 | 依据 |
|---|------|------|------|
| A1 | 合约下单数量单位错误：UI 标签为 `Qty (USDT)`，实际作为 `quantity`（币数量）发送 | `FuturesTradeForm.tsx:196,74` | 文档：`quantity` — "only support units by COIN, Ordering with quantity U is not currently supported" |
| A2 | `callbackRate` 覆盖 `priceRate`；且 UI 收「%」直接发送，`1` 被当作 100% 回撤 | `futures.ts:317-318`、`FuturesTradeForm.tsx:38,79` | 文档：`priceRate` 为小数，`0 < x ≤ 1`（0.05 = 5%） |
| A3 | 恒发 `positionSide: LONG/SHORT`，单向持仓模式下全部被拒 | `FuturesTradeForm.tsx:73-74` | 错误码 109400："position mode mismatch (e.g. PositionSide must be BOTH in one-way mode)" |
| A4 | 读取 `json.data.orderId`，但合约下单响应为 `data: { order: {...} }` 嵌套 | `FuturesTradeForm.tsx:108`、`futures.ts:45-63` | ccxt `bingx.ts`：`safeDict(data, 'order', data)` |
| A5 | 全站无精度 / 最小下单量处理；`/api/bingx/market/symbols` 路由已存在但零调用 | 全站 | 文档：spot `minQty`/`minNotional`/`stepSize`；swap `quantityPrecision`/`tradeMinQuantity`/`tradeMinUSDT` |
| A6 | 现货实盘百分比按钮为 `setAmount(String(pct))`，从不读取余额 | `TradeForm.tsx:107-111` | — |
| A7 | 平仓使用 `POST /openApi/swap/v2/trade/closePosition`，文档中不存在该路径 | `futures.ts:529` | 文档仅有 `/openApi/swap/v1/trade/closePosition`（`positionId` 必填）与 `/openApi/swap/v2/trade/closeAllPositions` |
| A8 | 多个 API Key 时 `.eq("is_valid",true).limit(1)` 无 `.order()`，选用哪个未定义 | 全部交易路由 | — |
| A9 | `getFuturesBalance` 打 v2 且按扁平结构声明类型（v2 返回 `{balance:{...}}`；当前文档为 v3 返回数组） | `futures.ts:155-159` | `swap-account` api-reference |

### B. 能下单但不合理

- B1 合约下单无确认弹窗（现货有），最高 300x 一侧反而点击即发真单
- B2 杠杆经 `useEffect` 静默 fire-and-forget 设置，`.catch(()=>{})` 吞错，UI 与交易所实际值可能不一致；且该接口 IP 限速 3/s
- B3 实盘无余额显示（合约连可用保证金 / 所需保证金 / 预估强平价都没有）
- B4 实盘订单从不写入 `orders` 表，`/orders` 与 `/dashboard` 对实盘永远为空
- B5 `RATE_LIMITS` 常量零引用，自家 API 无限流
- B6 `verifyApiKey` 仅查现货余额：合约权限 Key 被误判无效；只读 Key 被误判有效
- B7 300x 杠杆按钮无上限校验、无风险摩擦；`006_drop_risk_config.sql` 删除风控表后，PRODUCT.md 承诺的交易限额不存在

### C. 界面

- C1 API Key 页面显示 `maskApiKey("encrypted")` 假掩码；无 IP 白名单提示、无权限说明、无重新验证
- C2 合约表单无百分比快捷键；LONG 按钮下发 `BUY`、平空亦点 LONG，无说明
- C3 合约用 `useSpotTicker` 取价，永续与现货价格不一致
- C4 现货「Amount (USDT)」在 MARKET 下为名义额、LIMIT 下为币数量，无单位提示

## 已确定的范围决策

- **范围**：A + B + C 全做，重建下单链路
- **合约下单单位**：USDT 名义额（与现有模拟盘一致）
- **VST 模拟环境**：不接入，本轮专注实盘

## 架构

新增 `src/lib/trading/` 领域层。**所有校验与换算在服务端强制执行**；前端取同一份规格仅用于即时预览，服务端重算一遍。

```
src/lib/trading/
  spec.ts          交易对规格获取与缓存
  sizing.ts        纯函数：USDT 名义额 ⇄ 币数量、精度对齐、尺寸校验
  account-mode.ts  持仓模式探测、杠杆读写、保证金模式读写
  limits.ts        风控限额读取与校验
  errors.ts        BingX 错误码 → 三语 i18n key
  preflight.ts     编排层，输出规范化下单参数
  persist.ts       订单落库 + 每日计数
```

下单路径：

```
OrderForm → POST /api/bingx/{spot|futures}/order
              ↓
           preflight()
              ├─ limits.check()        名义额上限 / 日次数 / 最大杠杆 / 允许交易对
              ├─ spec.get()            交易对规格
              ├─ sizing.quoteToBase()  USDT → 币数量（floor 到 quantityPrecision）
              ├─ sizing.validate()     minQty / minNotional
              └─ accountMode.resolve() 单向→BOTH，对冲→LONG/SHORT
              ↓
           placeOrder() → BingX
              ↓
           persist()  失败仅记 Sentry，不影响已成功的下单响应
```

安全性质：直接向 `/api/bingx/futures/order` 发请求同样受限额与精度校验约束，前端无法绕过。

## 组件设计

### `spec.ts`

统一模型：

```ts
type SymbolSpec = {
  symbol: string;
  market: "spot" | "futures";
  pricePrecision: number;
  quantityPrecision: number;
  minQty: number;         // 基础币最小量
  minNotional: number;    // 最小名义额 USDT（spot: minNotional / futures: tradeMinUSDT）
  maxLeverage?: number;   // 仅合约，来自签名接口
  status: "trading" | "suspended";
};
```

数据来源（**两者均为公开接口，无需签名**）：
- 现货 `GET /openApi/spot/v1/common/symbols` → `minQty` / `minNotional` / `tickSize` / `stepSize` / `status`
- 合约 `GET /openApi/swap/v2/quote/contracts` → `quantityPrecision` / `pricePrecision` / `tradeMinQuantity` / `tradeMinUSDT` / `maxLongLeverage` / `maxShortLeverage` / `status`

`maxLeverage` 取 `maxLongLeverage` 与 `maxShortLeverage` 中对应方向的值——**不需要**调用需签名的 `GET /openApi/swap/v2/trade/leverage`。该签名接口仍用于读取用户**当前**杠杆设置（见 `account-mode.ts`），与最大值来源不同。

缓存：服务端内存 Map，TTL 1 小时（规格几乎不变）。通过 `/api/trading/spec?symbol=&market=` 暴露给前端预览，无需鉴权。

**同批修正两处既有类型缺陷**（`src/types/bingx.ts`）：
- 现货规格接口的响应是 `data.symbols` 嵌套数组，但 `getSpotSymbols()` 把 `json.data` 直接当数组返回、`useSpotSymbols()` 按 `BingXSymbol[]` 声明——类型与运行时不符，需解包 `.symbols`
- `BingXSymbol` 缺少 `minQty` / `maxQty` / `minNotional` / `maxNotional` / `tickSize` / `stepSize`；`BingXSymbol.status` 与 `BingXContract.status` 声明为 `string`，实际为整数（`1` = active）

### `sizing.ts`（纯函数，实盘与模拟盘共用）

```ts
quoteToBase(quoteUsdt: number, price: number, spec: SymbolSpec): { qty: string; notional: number }
validateOrderSize(qty: number, notional: number, spec: SymbolSpec):
  { ok: true } | { ok: false; reason: "BELOW_MIN_QTY" | "BELOW_MIN_NOTIONAL" | "PRECISION" }
roundPrice(price: number, spec: SymbolSpec): string
```

**向下取整（floor）而非四舍五入**：余额恰好时点「100%」，向上取整会直接触发保证金不足。

模拟盘复用：`src/app/api/paper/*` 的 API 契约与 SQL RPC 均不改动，仅改为调用 `sizing.ts`，使模拟盘与实盘的换算行为一致。

### 合约下单单位（判断题 a）

**采用自行换算的 `quantity`，不使用 `quoteOrderQty`。**

理由：BingX 文档同一张参数表中既列出 `quoteOrderQty`（"Quote order quantity, e.g., 100USDT"），又在 `quantity` 行注明 "only support units by COIN, Ordering with quantity U is not currently supported"，两者矛盾。自行换算是行为确定的做法，且换算过程可将预估币数量展示给用户。

### 名义额语义（判断题 b）

**用户输入的 USDT 为仓位名义额，不是保证金。** 与现有模拟盘一致（`buyingPower = balance × leverage`）。

UI 必须同时显示 **所需保证金 = 名义额 ÷ 杠杆**。这是新手最易混淆之处，两个数值都需呈现。

### `account-mode.ts`

`resolvePositionSide(apiKey, secret, requested)`：
- 读 `GET /openApi/swap/v1/positionSide/dual`，按 user 缓存 5 分钟
- 对冲模式（`dualSidePosition: true`）→ `positionSide` = 用户选择的 LONG/SHORT
- 单向模式 → `positionSide = "BOTH"`，方向由 LONG→BUY / SHORT→SELL 决定
- 下单返回 109400 时缓存立即失效并重试一次（用户可能刚在 BingX App 中修改）

杠杆改为显式动作，删除现有 `useEffect` 静默同步：
- 进入合约面板时读取交易所实际杠杆与 `maxLeverage` 并显示
- 用户修改 → 立即 POST，按钮进入 pending，成功才更新 UI，失败弹出可读错误并回滚显示
- 滑块上限 = 该交易对 `maxLeverage`，不再写死 300

保证金模式（ISOLATED / CROSSED）增加同样逻辑的显式切换。

### `limits.ts` 与迁移 `020_trading_limits.sql`

`user_daily_trade_count` 表仍存在，计数直接复用；仅需重建被 `006_drop_risk_config.sql` 删除的配置表：

```sql
create table public.trading_limits (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references public.users(id) on delete cascade,  -- null = 全局默认
  max_notional_per_order  numeric,
  max_orders_per_day      integer,
  max_leverage            integer,
  allowed_symbols         text[],   -- null = 不限制
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
```

同一迁移中放宽 `orders.order_type` 的 CHECK 约束，从现有 5 种值扩展到实际支持的 14 种（现货 6 + 合约 8）。

校验在服务端强制。被拦截的订单写入 `orders` 表并标记 `risk_rejected` / `risk_reason`（列已存在）。Admin 后台新增页面编辑全局默认与按用户覆盖。

限额默认值由 Admin 后台配置，迁移不预置具体数值——初始为空即表示不限制，避免在无人配置时意外锁死用户下单。

### 组件重整

现有 `TradeForm.tsx`（395 行）同时承担现货实盘与模拟盘，两套 percent 逻辑与两套 amount 语义交织；`FuturesTradeForm.tsx` 另起一套。重整为三种市场共用一个壳：

```
components/trade/order-form/
  OrderForm.tsx            壳：side / 类型 / 提交，按 market 以 config 组装
  fields/AmountField.tsx   金额 + 百分比 + 余额 + 换算预览（三市场共用）
  fields/LeverageField.tsx
  fields/PriceFields.tsx   price / stopPrice / TP-SL
  OrderPreview.tsx         ≈数量 · 所需保证金 · 预估强平价 · 手续费
  useOrderPreflight.ts     拉取规格 + 本地预览换算
```

市场差异以 config 描述，不再是两个各自演化的组件分支。

### 确认弹窗与余额

`OrderConfirmModal` 扩展支持合约，内容包含：方向 · 杠杆 · 名义额 · 所需保证金 · 预估强平价 · 占可用余额比例 · 风险提示。合约必过弹窗。杠杆 > 20x 时显示更醒目的警示。

实盘余额接入表单：现货用 `/api/bingx/account/balance`，合约用 `/api/bingx/futures/positions?type=balance`。百分比按钮按真实可用余额计算。

同批修正：
- 合约取价从 `useSpotTicker` 改为合约 ticker（A/C3）
- `placeFuturesOrder` 按 `data.order` 嵌套解析响应，修正 `FuturesOrderResult` 类型（A4）
- `priceRate` 仅赋值一次，UI 的「%」除以 100 后发送（A2）
- 平仓改用 `/openApi/swap/v1/trade/closePosition` 并携带 `positionId`（A7）
- `getFuturesBalance` 改用 `GET /openApi/swap/v3/user/balance` 并按数组响应修正类型（A9）
- `AmountField` 在标签旁常驻单位提示，明确当前输入的是名义额 USDT 还是币数量，消除现货 MARKET / LIMIT 之间的语义跳变（C4）
- 合约 LONG / SHORT 按钮下方增加一行说明：LONG = 开多或加多、SHORT = 开空或加空；平仓统一走仓位面板的「平仓」按钮而非反向下单（C2）

### API Key 管理

- 新增列 `api_key_masked`（写入时计算），列表显示真实前 4 后 4，替换现有假掩码 `maskApiKey("encrypted")`
- 验证同时请求现货与合约余额，分别标记，UI 显示「现货 ✓ / 合约 ✗ — 请在 BingX 后台勾选合约交易权限」
- 新增「重新验证」按钮
- **新增 IP 白名单说明**：Vercel 出口 IP 不固定，配置白名单会导致持续 100413。这是「绑了 Key 仍无法下单」最常见的原因之一
- 新增 `is_primary` 列，交易路由按 primary 排序取用，替换现有无排序的 `.limit(1)`

### `errors.ts`

映射高频错误码到三语 i18n key：

| 码 | 含义 |
|----|------|
| 100001 | 签名校验失败 |
| 100004 | API Key 缺少交易权限 |
| 100413 | API Key 无效或 IP 未放行 |
| 101204 | 保证金不足 |
| 109400 | 参数错误（含持仓模式不匹配） |
| 80014 | 精度 / 参数不合法 |

兜底保留原始 code 与 msg，不吞掉信息。

### 自家限流

接入现有 `RATE_LIMITS` 常量，实现内存滑动窗口。

**已知局限**：Vercel serverless 为多实例，内存限流仅能拦截同实例的暴力请求。完整限流需引入 Upstash Redis，与 PRODUCT.md「不引入重型新依赖」的约束冲突。判断：服务端限额是真正的护栏，限流为补充，本轮采用内存版，Redis 留待后续。

## 验证策略

不接入 VST 的直接后果：可以证明参数与签名正确，**无法替用户证明合约真单能够成交**。

1. `POST /openApi/swap/v2/trade/order/test`（官方 dry-run，验签名与参数但不成交）跑通全部 8 种合约订单类型及参数组合
2. 只读接口验证：持仓模式探测、杠杆 / maxLeverage、余额、规格
3. 现货以最小名义额（BTC-USDT 约 5 USDT）下真单跑通全流程后撤单
4. **合约真单需用户亲自执行一次**：5–10 USDT 名义额、1x 杠杆、市价开仓后立即平仓。交付时附逐条勾选的验收清单

## 明确不做

- 不改动模拟盘 API 契约与 SQL RPC（仅让其调用 `sizing.ts`）
- 不接入 VST 模拟环境
- 不引入 Redis
- 不实现 WebSocket 私有订单流，继续 5s 轮询

## 参考

- BingX 官方 AI Skills 文档仓库：`github.com/BingX-API/api-ai-skills`
  - `skills/swap-trade/api-reference.md`、`skills/spot-trade/api-reference.md`
  - `skills/swap-account/api-reference.md`、`skills/swap-market/api-reference.md`
  - `skills/references/error-codes.md`、`skills/references/authentication.md`
- 响应结构交叉验证：`github.com/ccxt/ccxt` — `ts/src/bingx.ts`
