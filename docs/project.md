# Chart-IX — 项目完整文档 (截至 2026-07-25)

> **目标受众：接手开发的 AI / 开发者**  
> 本文档 100% 贴合当前代码状态，覆盖架构、数据流、关键决策和已踩过的坑。

---

## 1. 项目概述

**chart-ix.com** — 加密货币交易教育平台  
**仓库**：`chartixtd/Chart-IX`  
**部署**：Vercel (自动从 `main` 分支部署)  
**交易所数据源**：BingX 公开 API + 签名交易 API (spot + futures)

核心功能：
- 现货/合约实时行情看板（价格、K线、订单簿、成交记录）
- **完整现货交易**（7 种订单类型：Market/Limit/Stop Market/Stop Limit/Trigger MKT/Trigger LMT/OCO）
- **完整合约交易**（8 种订单类型：Market/Limit/Stop MKT/Stop/TP Market/TP/Trail Stop/TP-SL Trail，杠杆 1-300x）
- **模拟盘 / Paper Trading（杠杆永续合约模型）**：初始 10,000 USDT 虚拟余额，做多/做空、保证金、杠杆、强平价、已实现/未实现盈亏；单向净持仓；市价单即时成交 + 限价单；精确按持仓量平仓（详见第 6.6 节）
- **图表进出场标记 + 止盈止损/进场/强平价格线**：现货/模拟盘/合约三种市场，K 线图上叠加成交箭头与价格线（详见第 6.7 节）
- BingX API Key 绑定（AES-256-GCM 加密存储 + 自动校验）
- 视频教学（分级：free/pro，防下载）+ 视频笔记
- 用户注册/登录、Pro 等级系统、Onboarding 引导
- 学习路径 + 随堂小测 + 成就系统、晒单分享、站内价格提醒
- Admin 后台管理系统
- 国际化（zh-CN / en-US / ms-MY）

---

## 2. 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 15.5.21 |
| UI 库 | React | 19.1.0 |
| 样式 | Tailwind CSS | 3.4.17 |
| 语言 | TypeScript | ^5 |
| 后端/数据库 | Supabase (auth + DB + storage + RLS) | ^2.49.4 |
| 国际化 | next-intl | ^4.13.3 |
| 数据请求 | TanStack React Query | ^5.101.4 |
| 金融图表 | lightweight-charts | ^5.2.0 |
| 通用图表 | recharts | ^3.10.0 |
| 状态管理 | Zustand | ^5.0.14 |
| 大整数解析 | json-bigint | latest (防止订单 ID 精度丢失) |
| 表单校验 | react-hook-form + zod | ^7 / ^4 |
| 工具 | clsx, tailwind-merge, date-fns | — |

---

## 3. 目录结构

```
src/
├── app/
│   ├── globals.css                 # Tailwind + 基础样式
│   ├── layout.tsx                  # 根布局 (html > body)
│   ├── page.tsx                    # 根页面 (重定向到 /en-US)
│   ├── middleware.ts               # ★ 核心中间件 (i18n + admin auth)
│   ├── [locale]/                   # 国际化前端页面
│   │   ├── layout.tsx              # Server 端 locale 校验 + messages 加载
│   │   ├── ClientLocaleLayout.tsx  # Client 端 NextIntlProvider + QueryProvider + AuthProvider + Navbar/Footer
│   │   ├── page.tsx                # 首页
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── upgrade/page.tsx        # 升级 Pro (pro 用户自动隐藏定价卡片)
│   │   ├── settings/
│   │   │   ├── page.tsx            # 设置主页 (tier 显示)
│   │   │   └── api-keys/page.tsx   # ★ BingX API Key 管理
│   │   ├── trade/
│   │   │   └── page.tsx            # ★ 主交易页 (Spot/Futures 切换, tier 门控)
│   │   └── videos/
│   │       ├── page.tsx            # 视频列表
│   │       └── [id]/page.tsx       # 视频详情 + 播放器 (free 用户 60s 预览)
│   ├── admin/                      # Admin 后台 (独立路由，不经 i18n)
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Dashboard (free/pro 用户统计)
│   │   ├── login/page.tsx
│   │   ├── features/               # 功能开关管理
│   │   ├── pricing/                # 定价配置管理
│   │   ├── risk/                   # 风控配置管理 (按 tier)
│   │   ├── users/                  # 用户管理 (含 tier 切换, +30d Pro)
│   │   └── videos/                 # 视频管理 (含 tier_required)
│   └── api/
│       ├── auth/me/route.ts        # GET 当前用户 (包含 tier)
│       ├── admin/                  # Admin CRUD APIs
│       ├── bingx/market/           # ★ BingX 行情 REST 代理
│       │   ├── depth/route.ts
│       │   ├── klines/route.ts     # spot & futures
│       │   ├── symbols/route.ts
│       │   ├── ticker/route.ts
│       │   └── trades/route.ts
│       ├── bingx/account/
│       │   └── balance/route.ts    # GET 现货余额
│       ├── bingx/trade/            # ★ 现货交易 API
│       │   ├── order/route.ts      # POST 下单 (7 种类型)
│       │   ├── oco-order/route.ts  # POST OCO 下单/取消/查询
│       │   ├── open-orders/route.ts  # GET 挂单 + POST 撤单/撤全部
│       │   └── my-trades/route.ts  # GET 成交记录
│       ├── bingx/futures/          # ★ 合约交易 API
│       │   ├── order/route.ts      # POST 下单 + test (dry-run) + tier 校验
│       │   ├── open-orders/route.ts  # GET 挂单 + DELETE 撤单/撤全部 + tier 校验
│       │   └── positions/route.ts  # GET 仓位/余额 + POST 平仓/杠杆/保证金/TP-SL + tier 校验
│       ├── paper/                  # ★ 模拟盘 API (杠杆永续合约模型)
│       │   ├── account/route.ts    # GET 账户 + 持仓
│       │   ├── order/route.ts      # POST 下单 (市价/限价, 多空/杠杆/保证金)
│       │   ├── orders/route.ts     # GET 成交历史
│       │   ├── close/route.ts      # POST 精确按持仓量平仓 (见 6.6)
│       │   └── limit-orders/route.ts  # GET/DELETE 限价挂单
│       ├── user/api-keys/
│       │   ├── route.ts            # POST 加密存储 / DELETE 删除
│       │   └── verify/route.ts     # POST 校验 API Key
│       └── video/stream/[id]/route.ts  # ★ 视频流代理 (Range + anti-download)
├── components/
│   ├── auth/
│   │   └── AuthProvider.tsx        # ★ 全局认证上下文 (tier/role/userId, 模块缓存)
│   ├── layout/
│   │   ├── Navbar.tsx              # 主站导航 (useMemo 优化, pro 门控)
│   │   ├── Footer.tsx
│   │   ├── LanguageSwitcher.tsx
│   │   ├── QueryProvider.tsx
│   │   ├── AdminHeader.tsx
│   │   └── AdminSidebar.tsx
│   ├── trade/
│   │   ├── KlineChart.tsx          # ★ K线图表 (WS 实时价格驱动 + 进出场标记/价格线)
│   │   ├── MarketOverview.tsx      # 左侧币种列表
│   │   ├── OrderBook.tsx           # 订单簿 (REST 2s 轮询)
│   │   ├── order-form/
│   │   │   ├── OrderForm.tsx       # ★ 统一下单表单 (spot/futures/paper 共用一套组件)
│   │   │   ├── OrderPreview.tsx    # 预览 (预估数量/保证金/强平价)
│   │   │   ├── config.ts           # 各市场订单类型/TP-SL 可附加集合等配置
│   │   │   └── fields/             # AmountField / LeverageField / PriceFields
│   │   ├── OrdersPanel.tsx         # 现货挂单 + 成交记录
│   │   ├── PaperOrdersPanel.tsx    # ★ 模拟盘持仓/成交/精确平仓
│   │   └── FuturesInfoPanel.tsx    # 合约仓位 + 挂单管理
│   └── ui/                         # 通用 UI 组件
├── hooks/
│   ├── useBingXWebSocket.ts        # ★ WebSocket 管理器 (ticker only)
│   ├── useMarketData.ts            # ★ React Query hooks (WS+REST 合并)
│   ├── usePaperTrading.ts          # ★ 模拟盘 hooks (账户/成交/下单/精确平仓)
│   └── useChartOverlay.ts          # ★ 按市场聚合图表进出场标记 + 价格线
├── i18n/
│   ├── messages/
│   │   ├── en-US.json / zh-CN.json / ms-MY.json
│   ├── request.ts
│   └── routing.ts
├── lib/
│   ├── constants.ts                # 站点配置
│   ├── crypto.ts                   # AES-256-GCM 加密/解密
│   ├── utils.ts                    # cn(), formatPrice(), formatPercent(), formatNumber()
│   ├── bingx/
│   │   ├── signed-request.ts       # ★ 共享签名请求 (HMAC-SHA256, json-bigint, 容灾)
│   │   ├── client.ts               # ★ 公开 API 客户端 (X-SOURCE-KEY)
│   │   ├── market.ts               # 行情查询 (spot + futures)
│   │   ├── trade.ts                # ★ 现货交易 (42 个函数, 所有端点+OCO)
│   │   └── futures.ts             # ★ 合约交易 (50+ 函数, 42 个端点全覆盖)
│   ├── trading/                    # ★ 服务端风控/预检层 (spec/limits/preflight/sizing/rate-limit/persist)
│   └── supabase/                   # 5 个客户端工厂
├── stores/                         # Zustand
│   └── market.ts                   # tickers 实时价格
└── types/
    ├── bingx.ts                    # BingX 数据类型
    └── index.ts                    # User, Video, Order, FeatureFlag, RiskConfig 等
supabase/
└── migrations/                     # 数据库迁移 SQL (001~019)
    ├── 010_paper_trading.sql       # 模拟盘初版 (现货模型)
    ├── 014_paper_limit_orders.sql  # 模拟盘限价单
    ├── 015_video_notes.sql         # 视频笔记
    ├── 016_paper_limit_order_rpc.sql
    ├── 017_user_preferences.sql    # 用户偏好 (交易页记忆)
    ├── 018_paper_futures.sql       # ★ 模拟盘改为杠杆永续合约模型
    └── 019_close_paper_position.sql # ★ 精确按持仓量平仓 RPC
```

---

## 4. 架构核心：实时数据流

### 4.1 总体数据流

```
BingX API
  ├── REST (服务端 → API Routes)  ──→ React Query (useMarketData.ts)
  │                                      ├── useSpotTickers()  → 列表
  │                                      ├── useSpotTicker()   → 单个行情
  │                                      ├── useKlines()       → K线历史
  │                                      ├── useOrderBook()    → 订单簿
  │                                      └── useRecentTrades() → 成交记录
  │
  └── WebSocket (浏览器直连)  ──→ useBingXWebSocket.ts
                                      └── 写入 Zustand useMarketStore.tickers
                                            ├── KlineChart 读取 → 驱动最后一根蜡烛
                                            ├── useSpotTicker() 合并 REST+WS
                                            └── useSpotTickers() 合并 REST+WS
```

### 4.2 WebSocket 连接

**端点**：`wss://open-api-ws.bingx.com/market`  
**协议**：Binary (arraybuffer), GZIP 压缩  
**功能**：仅订阅 `@ticker`

- 消息解码：`TextDecoder` → 检测 `{`/`[` 开头（纯 JSON）→ 否则 `DecompressionStream("gzip")` 解压
- 心跳：收到 `"Ping"` → 回复 `"Pong"`
- 自动重连：`onclose` 后 3 秒重连
- 多实例：trade 页面和 MarketOverview 各一个独立 WS 连接

### 4.3 React Query 数据层

| Hook | 刷新间隔 | WS 合并 |
|------|---------|---------|
| `useSpotSymbols()` | 60s stale | 否 |
| `useSpotTickers()` | 5s | **是** — `wsTickers[symbol] ?? restTicker` |
| `useSpotTicker(s)` | 5s | **是** |
| `useKlines(s, i)` | 10s | 否 — REST 负责结构, WS ticker 在 KlineChart 内部驱动当前蜡烛 |
| `useOrderBook(s)` | 2s | 否 |
| `useRecentTrades(s)` | 3s | 否 |

### 4.4 K线图表驱动架构 ★★★

**三层 useEffect 设计**：

1. **图表创建**（挂载一次）：`createChart()` → `candleSeries` + `volumeSeries`, `ResizeObserver`
2. **REST 数据加载**（klines 变化时）：`setData(candleData)` + `setData(volumeData)`, 记录 `lastCandleRef`
3. **实时价格驱动**（livePrice 变化时）：计算当前时间桶 `bucketStart = floor(nowSec / durationSec) * durationSec`, 更新当前蜡烛的 close/high/low, `candleSeries.update()`

所有周期均受实时 ticker 驱动，含 1h/4h/1d 大周期。

---

## 5. Pro Tier 等级系统 ★

### 5.1 数据模型

```sql
users.tier    TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro'))
users.role    TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))
videos.tier_required  TEXT NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free', 'pro'))
feature_flags 表: free_enabled / pro_enabled  per feature
risk_config 表: 按 tier 的风控限制
```

### 5.2 Auth 上下文 (`AuthProvider.tsx`)

全局共享认证状态，避免各组件重复查询：

- **模块级缓存** `cachedAuth` — 页面切换时即时渲染
- **单次 DB 查询** `users(tier, role)` — 所有组件通过 `useAuth()` 共享
- **onAuthStateChange** — 只在 `SIGNED_IN`/`SIGNED_OUT` 时刷新

### 5.3 Pro 门控位置

| 位置 | Free 用户行为 | Pro 用户行为 |
|------|-------------|------------|
| **Navbar** | 显示 "Upgrade" 链接 | **不显示** Upgrade |
| **/upgrade 页面** | 显示定价方案卡片 | **显示 "您已是 Pro" 祝贺页** |
| **/trade Futures 标签** | 🔒 锁图标 → 点击跳 upgrade | **正常显示** Spot/Futures 切换 |
| **Futures API (order)** | **返回 403** "requires Pro" | 正常执行 |
| **Futures API (positions)** | **返回 403** | 正常执行 |
| **Futures API (open-orders)** | **返回 403** | 正常执行 |
| **Pro 视频** | 60s 预览后截停 + 升级提示 | 完整观看 |
| **Settings** | tier: free | tier: pro (金色) |

---

## 6. 交易系统 ★★★

### 6.1 BingX API 签名算法 (2026-07 修复)

**旧签名（错误）**：`HMAC-SHA256(secret, METHOD + path + sortedParams)`  
**正确签名**：`HMAC-SHA256(secret, sortedParams)` — **不**加 method 和 path 前缀

```ts
// src/lib/bingx/signed-request.ts — 共享签名模块
const canonical = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&")
const signature = createHmac("sha256", secret).update(canonical).digest("hex")

// POST: body = canonical&signature=hex
// GET/DELETE: URL?canonical&signature=hex
```

**关键特性**：
- `json-bigint` 解析 — 防止订单 ID 超大整数精度丢失
- `X-SOURCE-KEY: BX-AI-SKILL` 请求头（官方要求）
- `.com` → `.pro` 域名容灾降级
- `AbortSignal.timeout(10000)` 请求超时
- 参数注入防护（禁用 `&=?#\r\n`）
- 含 `[` `{` 的值自动 URL 编码

### 6.2 Spot 现货交易 (`src/lib/bingx/trade.ts`)

**支持的订单类型**：
`MARKET`, `LIMIT`, `TAKE_STOP_LIMIT`, `TAKE_STOP_MARKET`, `TRIGGER_LIMIT`, `TRIGGER_MARKET`

**TIF**：`GTC`, `IOC`, `FOK`, `PostOnly`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/spot/v1/trade/order` | POST | 下单 |
| `/spot/v1/trade/batchOrders` | POST | 批量下单 |
| `/spot/v1/trade/cancel` | POST | 撤单 (支持 cancelRestrictions) |
| `/spot/v1/trade/cancelOpenOrders` | POST | 取消全部挂单 |
| `/spot/v1/trade/cancelOrders` | POST | 批量撤单 |
| `/spot/v1/trade/cancelAllAfter` | POST | Kill Switch 倒计时撤单 |
| `/spot/v1/trade/order/cancelReplace` | POST | 撤单再下单 (原子操作) |
| `/spot/v1/trade/query` | GET | 查询单个订单 |
| `/spot/v1/trade/openOrders` | GET | 当前挂单 |
| `/spot/v1/trade/historyOrders` | GET | 历史订单 (分页+过滤) |
| `/spot/v1/trade/myTrades` | GET | 成交记录 |
| `/spot/v1/oco/order` | POST | OCO 下单 |
| `/spot/v1/oco/cancel` | POST | 取消 OCO |
| `/spot/v1/oco/orderList` | GET | 查询 OCO 详情 |
| `/spot/v1/oco/openOrderList` | GET | 所有活跃 OCO |
| `/spot/v1/oco/historyOrderList` | GET | OCO 历史 |
| `/spot/v1/user/commissionRate` | GET | 手续费率 |
| `/spot/v1/account/balance` | GET | 账户余额 |

### 6.3 Futures 合约交易 (`src/lib/bingx/futures.ts`)

**支持的订单类型**：
`MARKET`, `LIMIT`, `STOP_MARKET`, `STOP`, `TAKE_PROFIT_MARKET`, `TAKE_PROFIT`, `TRAILING_STOP_MARKET`, `TRAILING_TP_SL`

**杠杆**：1x - 300x（预设按钮 + 自定义输入）

| 类别 | 端点 | 说明 |
|------|------|------|
| **下单** | POST `/swap/v2/trade/order` | 下单 (含 stopLoss/takeProfit 嵌套对象, closePosition, reduceOnly, stopGuaranteed) |
| | POST `/swap/v2/trade/order/test` | 测试下单 (dry-run) |
| | POST `/swap/v2/trade/batchOrders` | 批量下单 (max 5) |
| **撤单** | DELETE `/swap/v2/trade/order` | 撤单 |
| | DELETE `/swap/v2/trade/batchOrders` | 批量撤单 (max 10) |
| | DELETE `/swap/v2/trade/allOpenOrders` | 取消全部挂单 |
| | POST `/swap/v2/trade/cancelAllAfter` | Kill Switch |
| **仓位** | POST `/swap/v2/trade/closePosition` | 平仓 |
| | POST `/swap/v2/trade/closeAllPositions` | 一键平仓全部 |
| | POST `/swap/v2/trade/positionMargin` | 调整保证金 |
| | POST `/swap/v1/trade/autoAddMargin` | 自动追加保证金 |
| | POST `/swap/v1/trade/reverse` | 一键反向开仓 |
| | POST `/swap/v2/trade/positionTpSl` | 设置仓位止盈止损 |
| **配置** | POST `/swap/v2/trade/leverage` | 设置杠杆 (支持 LONG/SHORT 分别设) |
| | GET `/swap/v2/trade/leverage` | 查询杠杆 |
| | POST `/swap/v2/trade/marginType` | 设置保证金模式 (ISOLATED/CROSSED) |
| | GET `/swap/v2/trade/marginType` | 查询保证金模式 |
| | GET/POST `/swap/v1/positionSide/dual` | 持仓模式 (单向/双向) |
| | GET/POST `/swap/v1/trade/assetMode` | 资产模式 (单币/多币) |
| **查询** | GET `/swap/v2/trade/openOrders` | 当前挂单 |
| | GET `/swap/v2/trade/openOrder` | 单活跃订单 |
| | GET `/swap/v2/trade/order` | 查询订单 |
| | GET `/swap/v1/trade/fullOrder` | 完整订单详情 |
| | GET `/swap/v2/trade/allOrders` | 历史订单 (分页) |
| | GET `/swap/v2/trade/forceOrders` | 强平/ADL 订单 |
| | GET `/swap/v2/trade/allFillOrders` | 成交历史 |
| | GET `/swap/v2/trade/fillHistory` | 历史成交明细 |
| | GET `/swap/v1/trade/positionHistory` | 仓位历史 |
| | GET `/swap/v1/maintMarginRatio` | 维持保证金率 |
| **TWAP** | POST `/swap/v1/twap/order` | 创建 TWAP |
| | POST `/swap/v1/twap/cancelOrder` | 取消 TWAP |
| | GET `/swap/v1/twap/openOrders` | 活跃 TWAP |
| | GET `/swap/v1/twap/historyOrders` | TWAP 历史 |
| | GET `/swap/v1/twap/orderDetail` | TWAP 详情 |
| **高级** | POST `/swap/v1/trade/cancelReplace` | 撤单再下单 |
| | POST `/swap/v1/trade/batchCancelReplace` | 批量撤单再下单 |
| | POST `/swap/v1/trade/amend` | 修改挂单 |
| **其他** | GET `/swap/v2/user/balance` | 合约余额 |
| | GET `/swap/v2/user/positions` | 仓位 |
| | GET `/swap/v2/user/income` | 资金流水 |
| | GET `/swap/v1/trade/multiAssetsRules` | 多资产规则 |
| | GET `/swap/v1/user/marginAssets` | 保证金资产列表 |

### 6.4 API Key 存储

用户 BingX API Key + Secret → 浏览器 `POST /api/user/api-keys` → 服务端 `AES-256-GCM` 加密 → Supabase → 使用前解密

```
Settings/api-keys → POST /api/user/api-keys (encrypt + verify) → Supabase
OrderForm → preflightOrder (风控/精度/最小名义值校验，服务端市价为准)
          → POST /api/bingx/trade/order 或 /api/bingx/futures/order
          → decrypt → sign → signedRequest → BingX
```

### 6.5 下单 UI 组件

现货/合约/模拟盘三个市场统一由 `src/components/trade/order-form/OrderForm.tsx` 一套组件驱动（按
`market: "spot" | "futures" | "paper"` 走 `config.ts` 里的每市场配置），不再有独立的
`TradeForm.tsx` / `FuturesTradeForm.tsx`：

- 简单/专业模式切换，专业模式解锁 Stop/Trigger/Trailing 等订单类型
- 现货：`MARKET`/`LIMIT` + `TAKE_STOP_*`/`TRIGGER_*`
- 合约：8 种订单类型（含 `STOP`、`TAKE_PROFIT`、`TRAILING_STOP_MARKET`、`TRAILING_TP_SL`），
  杠杆预设 + 自定义（1-300x，需交易所回读确认后才允许下单，见 `confirmedLeverage`）
- 仅 `MARKET`/`LIMIT` 允许附带止盈止损（`TPSL_ATTACHABLE`），切换到其他订单类型或非合约市场会清空已填的 TP/SL
- 下单前统一走 `src/lib/trading/` 预检层（`preflight.ts`/`limits.ts`/`sizing.ts`/`spec.ts`），
  服务端市价为风控估值唯一依据，客户端传入的参考价仅用于展示
- OCO（Limit Price + Stop Price + Order Price）目前未纳入该表单，对应的
  `/api/bingx/trade/oco-order` 路由暂时只开放 cancel/query，下单动作待接入预检层后再启用

### 6.6 模拟盘 / Paper Trading（杠杆永续合约模型）

**模型**：虚拟资金杠杆永续合约，不接触真实资产。初始余额 10,000 USDT。

**数据结构**（Supabase）：
- `paper_accounts`：`user_id, balance_usdt`
- `paper_positions`：`account_id, symbol, side ('long'|'short'), quantity, entry_price, leverage, margin, liquidation_price`；`UNIQUE(account_id, symbol)` → **单向净持仓**（每 symbol 只有一个净仓）
- `paper_orders`：成交历史，含 `side ('buy'|'sell'), quantity, price, total_value, realized_pnl, balance_after, leverage, margin, reduce_only`

**核心 RPC**：
- `place_paper_order`（迁移 018）：`buy`→开多/平空，`sell`→开空/平多；同向加仓算加权平均入场价，反向先平仓结算已实现盈亏再反手；`calc_liquidation_price` 计算强平价；保证金 = 名义价值 / 杠杆
- `close_paper_position(p_symbol, p_price)`（迁移 019）：**按 `pos.quantity` 精确全平**，不经过名义价值↔数量换算；结算已实现盈亏，退还全部保证金 + 盈亏到余额，插入 `reduce_only=TRUE` 的成交记录；无持仓时抛 `position_not_found`

**API**：`/api/paper/account`（账户+持仓）、`/api/paper/order`（下单，接受 leverage 1-125）、`/api/paper/orders`（成交历史）、`/api/paper/close`（精确平仓，实时取 BingX 价格）、`/api/paper/limit-orders`

**关键坑（已修复）**：早期平仓走「前端算名义价值 → 后端按 BingX 价格反算数量」两步换算，两端价格/时间戳不同导致平仓数量 ≠ 实际持仓量，残留少量仓位、需点两次平仓。修复方式：新增 `close_paper_position` RPC 直接按持仓量平仓，一次清干净。

### 6.7 图表进出场标记 + 价格线

**KlineChart.tsx** 新增两个可选 props（lightweight-charts v5 API）：
- `tradeMarkers`：进出场箭头。买/开=绿色 `arrowUp`（belowBar），卖/平=红色 `arrowDown`（aboveBar）；成交时间按 interval 对齐到所在 K 线起点；用 `createSeriesMarkers` 渲染（v5 已移除 `series.setMarkers`）
- `priceLines`：水平价格线，用 `series.createPriceLine` 渲染；进场价=蓝实线，强平价=橙虚线，止盈=绿虚线，止损=红虚线，限价挂单=紫虚线；symbol/interval/持仓变化时清理重建

**useChartOverlay.ts** 按 `market` 聚合数据源：
- `paper`：`usePaperOrders` 成交→箭头；`usePaperAccount` 持仓→进场价 + 强平价线
- `futures`：`/api/bingx/futures/positions` 持仓→进场价 + 强平价；`open-orders` 挂单→止盈(`TAKE_PROFIT*`)/止损(`STOP*`)的 `stopPrice` + 限价线（5s 轮询）
- `spot`：`/api/bingx/trade/my-trades` 成交→箭头；`open-orders` 挂单→限价线（10s 轮询）

**限制**：止盈止损线依赖 BingX 挂单返回的 TP/SL 订单；模拟盘暂无独立 TP/SL 字段，故模拟盘只画进场价 + 强平价。

---

## 7. 配置与环境变量

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=                    # 32 字节 hex, 用于加密 BingX API Key
NEXT_PUBLIC_SITE_URL=              # 默认 http://localhost:3000
NEXT_PUBLIC_SITE_NAME=Chart-IX
BINGX_API_BASE_URL=                # 默认 https://open-api.bingx.com
```

---

## 8. CSS 设计系统

暗色主题：
```
bg-primary:    #0a0a0a   bg-secondary:  #141414   bg-tertiary:   #1a1a1a
bg-hover:      #222222   border-default:#2a2a2a   border-hover:  #3a3a3a
gold:          #d4a843   text-primary:  #ffffff   text-secondary:#a0a0a0
text-muted:    #666666   success:       #22c55e   danger:        #ef4444
```

---

## 9. 已解决问题 & 经验教训

### 9.1 签名算法修复 (2026-07)
- **问题**：HMAC 签名错误拼接 `METHOD + path + sortedParams`
- **正确**：只签名 `sortedParams`（不含 method 和 path 前缀）
- **影响**：所有需要签名的 API 请求都会失败

### 9.2 WebSocket GZIP 问题
- `binaryType = "arraybuffer"` + `DecompressionStream("gzip")` 解压

### 9.3 BingX Ping/Pong 心跳
- 收到文本 `"Ping"` → `ws.send("Pong")`

### 9.4 Spot WebSocket 不支持 Kline
- `wss://open-api-ws.bingx.com/market` 只推送 ticker
- K 线改为 REST + 实时价格驱动方案

### 9.5 lightweight-charts update() 错误
- `time` 必须为数字，加 `typeof` + `isNaN` + `try-catch` 保护

### 9.6 REST Kline 大周期不更新
- BingX REST 大周期有服务端缓存
- 通过 WebSocket ticker 价格驱动当前蜡烛 close/high/low

### 9.7 json-bigint 订单 ID 精度
- BingX 订单 ID 可能超过 `Number.MAX_SAFE_INTEGER`
- 用 `json-bigint({ storeAsString: true })` 解析

### 9.8 Navbar 性能卡顿
- 原因：每页导航重新挂载 → 重新 `getUser()` → 重新 `checkUser()` → 双重网络请求
- 修复：创建 `AuthProvider` 全局上下文 + 模块缓存 + `useMemo`/`useCallback` 优化

### 9.9 Pro 用户仍看到升级页面
- 原因：`isPro` 初始 `false`，异步请求完成后才变 `true`（闪烁）
- 修复：`AuthProvider` 模块缓存即时渲染 + 升级页/导航栏条件渲染

### 9.10 模拟盘平仓不干净（需点两次）
- 原因：平仓走「前端算名义价值 → 后端按 BingX 价格反算数量」两步换算，两端价格/时间戳不一致 → 平仓数量 ≠ 实际持仓量 → 残留仓位
- 修复：新增 `close_paper_position` RPC（迁移 019）直接按 `pos.quantity` 精确全平，一次清干净（见 6.6）

### 9.11 lightweight-charts v5 标记 API 变更
- v5 已移除 `series.setMarkers`，改用独立的 `createSeriesMarkers(series, markers)` 插件
- marker 的 `time` 用 `Time` 类型，`position` 联合类型含需要 `price` 的变体，须用 `.map((m): SeriesMarker<Time> => ...)` 显式标注返回类型收窄
- 价格线仍用 `series.createPriceLine(...)`，需保存返回引用以便 `removePriceLine` 清理

---

## 10. Git & 部署

**仓库**：`https://github.com/chartixtd/Chart-IX.git`  
**分支**：`main`  
**部署**：Vercel 自动从 `main` 部署

**常用命令**：
```bash
npx next dev          # 开发
npx next build        # 构建 (必须通过才能推送)
npx tsc --noEmit      # 类型检查
git push origin main
```

**注意**：
- `*.md` 文件在 `.gitignore` 中，不会上传到 GitHub（`docs/` 除外目录已排除）
- API key / secret 绝不硬编码在代码中
