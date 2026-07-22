# Chart-IX — 项目完整文档 (截至 2026-07-23)

> **目标受众：接手开发的 AI / 开发者**  
> 本文档 100% 贴合当前代码状态，覆盖架构、数据流、关键决策和已踩过的坑。

---

## 1. 项目概述

**chart-ix.com** — 加密货币交易教育平台  
**仓库**：`chartixtd/Chart-IX`  
**部署**：Vercel (自动从 `main` 分支部署)  
**交易所数据源**：BingX 公开 API (spot + futures)

核心功能：
- 现货/合约实时行情看板（价格、K线、订单簿、成交记录）
- 模拟交易下单
- 视频教学（分级：free/pro，防下载）
- 用户注册/登录、API Key 管理
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
│   │   ├── ClientLocaleLayout.tsx  # Client 端 NextIntlProvider + QueryProvider + Navbar/Footer
│   │   ├── page.tsx                # 首页
│   │   ├── login/page.tsx          # 登录
│   │   ├── register/page.tsx       # 注册
│   │   ├── forgot-password/page.tsx
│   │   ├── orders/page.tsx         # 订单列表
│   │   ├── upgrade/page.tsx        # 升级 Pro
│   │   ├── settings/
│   │   │   ├── page.tsx            # 设置主页
│   │   │   └── api-keys/page.tsx   # API Key 管理
│   │   ├── trade/                  # ★ 交易页面 (核心)
│   │   │   ├── page.tsx            # 主交易页 (BTC-USDT 默认, 6个周期)
│   │   │   ├── spot/page.tsx       # 现货 (重定向 stub)
│   │   │   └── futures/page.tsx    # 合约 (重定向 stub)
│   │   └── videos/
│   │       ├── page.tsx            # 视频列表
│   │       └── [id]/page.tsx       # 视频详情 + 播放器
│   ├── admin/                      # Admin 后台 (独立路由，不经 i18n)
│   │   ├── layout.tsx              # Admin 布局 (Sidebar + Header)
│   │   ├── page.tsx                # Dashboard
│   │   ├── login/page.tsx
│   │   ├── features/               # 功能开关管理
│   │   ├── logs/                   # 操作日志
│   │   ├── pricing/                # 定价配置
│   │   ├── risk/                   # 风控配置
│   │   ├── settings/               # 全局设置
│   │   ├── users/                  # 用户管理
│   │   └── videos/                 # 视频管理 (上传/编辑)
│   └── api/                        # API Routes
│       ├── auth/me/route.ts        # 获取当前用户
│       ├── admin/                  # Admin CRUD APIs
│       ├── bingx/market/           # ★ BingX 行情代理
│       │   ├── depth/route.ts      # GET depth
│       │   ├── klines/route.ts     # GET klines (spot & futures)
│       │   ├── symbols/route.ts    # GET symbols
│       │   ├── ticker/route.ts     # GET ticker (single & batch)
│       │   └── trades/route.ts     # GET recent trades
│       └── video/stream/[id]/route.ts  # ★ 视频流代理 (Range + anti-download)
├── components/
│   ├── layout/
│   │   ├── AdminHeader.tsx         # 管理员顶部导航
│   │   ├── AdminSidebar.tsx        # 管理员侧边栏
│   │   ├── Footer.tsx
│   │   ├── LanguageSwitcher.tsx
│   │   ├── Navbar.tsx              # 主站导航
│   │   └── QueryProvider.tsx       # TanStack Query Provider
│   ├── trade/                      # ★ 交易模块组件
│   │   ├── KlineChart.tsx          # ★ 核心: K线图表 (WS+ REST 混合驱动)
│   │   ├── MarketOverview.tsx      # 左侧币种列表 (WS 实时价格)
│   │   └── OrderBook.tsx           # 右侧订单簿 (REST 2s 轮询)
│   └── ui/                         # 通用 UI 组件 (Badge, Button, Card, EmptyState, Input, Modal, Skeleton, Spinner)
├── hooks/                          # ★ 数据层 Hooks
│   ├── useBingXWebSocket.ts        # ★ 核心: BingX WebSocket 管理器 (ticker only)
│   └── useMarketData.ts            # ★ React Query hooks (全部市场数据)
├── i18n/
│   ├── messages/
│   │   ├── en-US.json              # 英文翻译
│   │   ├── ms-MY.json              # 马来文翻译
│   │   └── zh-CN.json              # 简体中文翻译
│   ├── request.ts                  # next-intl server request config
│   └── routing.ts                  # locale 路由定义
├── lib/
│   ├── constants.ts                # 站点配置、BingX URL、常量
│   ├── crypto.ts                   # 加密工具
│   ├── utils.ts                    # cn(), formatPrice(), formatPercent(), formatNumber() 等
│   ├── bingx/
│   │   ├── client.ts               # ★ BingX API 客户端 (GET only, no-store, 自动解析 code/data)
│   │   └── market.ts               # ★ 市场数据查询函数 (spot + futures)
│   └── supabase/
│       ├── admin.ts                # service_role 客户端
│       ├── client.ts               # 浏览器端客户端
│       ├── middleware.ts            # 中间件专用 (createServiceRoleClient)
│       ├── server.ts               # 服务端客户端 (createClient)
│       └── service.ts              # 服务层
├── stores/                         # Zustand 状态管理
│   ├── language.ts                 # 语言偏好
│   ├── market.ts                   # ★ 市场数据 (ticker/kline from WS)
│   └── ui.ts                       # UI 状态 (sidebar, mobile menu)
└── types/
    ├── bingx.ts                    # ★ BingX 数据类型 (Ticker, Kline, Depth, Trade 等)
    └── index.ts                    # 业务类型 (User, Video, Order, Admin 等)
supabase/
└── migrations/                     # 15 个数据库迁移 SQL 文件
```

---

## 4. 架构核心：实时数据流

这是整个项目最复杂的部分，经历过多次迭代才稳定下来。

### 4.1 总体数据流

```
BingX API
  ├── REST (服务端 → API Routes)  ──→ React Query (useMarketData.ts)
  │                                      ├── useSpotTickers()  → 列表/详情
  │                                      ├── useSpotTicker()   → 单个行情
  │                                      ├── useKlines()       → K线历史
  │                                      ├── useOrderBook()    → 订单簿
  │                                      └── useRecentTrades() → 成交记录
  │
  └── WebSocket (浏览器直连)  ──→ useBingXWebSocket.ts
                                      └── 写入 Zustand useMarketStore.tickers
                                            ├── KlineChart 读取 → 驱动最后一根蜡烛
                                            ├── useSpotTicker() 合并 REST+WS → 顶部价格条
                                            └── useSpotTickers() 合并 REST+WS → 左侧币种列表
```

**关键设计决策**：WebSocket 数据不直接渲染，而是写入 Zustand store，React Query hooks 读取 store 合并到 REST 数据中。这样上层组件不用关心数据来源。

### 4.2 WebSocket 连接详解 (`useBingXWebSocket.ts`)

**端点**：`wss://open-api-ws.bingx.com/market`  
**协议**：Binary (arraybuffer), GZIP 压缩  
**功能**：仅订阅 `@ticker`（不订阅 kline — 原因见 5.1）

```ts
useBingXWebSocket(symbols: string[])
```

调用方式（两处）：
1. `trade/page.tsx` → `useBingXWebSocket([symbol])` — 单个币种 ticker
2. `MarketOverview.tsx` → `useBingXWebSocket(wsSymbols)` — 前 30 个币种 ticker

**消息处理流程**：
```
onmessage (ArrayBuffer)
  → TextDecoder 解码原始文本
  → 如果以 { 或 [ 开头 → 直接 JSON.parse（未压缩）
  → 否则 → DecompressionStream("gzip") 解压 → JSON.parse
  → 如果 text === "Ping" → ws.send("Pong")
  → 如果 msg.code !== 0 → 跳过
  → 如果 dataType 不以 @ticker 结尾 → 跳过
  → msg.data (可能是 object 或 array) → mapTicker() → setTicker(symbol, ticker)
```

**自动重连**：`onclose` 3 秒后重连  
**symbols 变化**：`useEffect` 依赖 `symbols.join(",")`, 变化时关闭旧连接、建立新连接并重新订阅  
**多实例**：每个 `useBingXWebSocket` 调用创建独立的 WebSocket 连接（trade 页面和 MarketOverview 各一个）

### 4.3 React Query 数据层 (`useMarketData.ts`)

所有 hooks 通过 `/api/bingx/market/*` 代理请求 BingX REST API。

| Hook | 用途 | 刷新间隔 | WebSocket 合并？ |
|------|------|----------|-----------------|
| `useSpotSymbols()` | 交易对列表 | 60s stale | 否 |
| `useSpotTickers()` | 批量行情 | 5s | **是** — `wsTickers[symbol] ?? restTicker` |
| `useSpotTicker(s)` | 单个行情 | 5s | **是** — `wsTicker ?? restTicker` |
| `useKlines(s, i)` | K 线数据 | **10s** | **否** — 只用 REST (WS ticker 在 KlineChart 内部驱动) |
| `useOrderBook(s)` | 订单簿 | 2s | 否 |
| `useRecentTrades(s)` | 成交记录 | 3s | 否 |

**WS+REST 合并逻辑**：REST 提供完整字段列表（含 24h high/low/volume），WebSocket 只覆盖实时价格。合并结果为 `query.data.map(t => wsTickers[t.symbol] ?? t)`.

### 4.4 K 线图表驱动架构 (`KlineChart.tsx`) ★★★

**这是整个项目最关键的设计，决定了图表实时性。**

#### 问题历史
1. 最初纯 REST 轮询 10s → 太慢
2. 改为 REST 5s → 仍慢
3. 试图通过 WebSocket 订阅 kline → **BingX spot WS 完全不推送 kline 数据**，只推送 ticker
4. REST 2s 轮询 kline → 对大周期（1h/4h/1d）仍然不更新，因为 BingX REST kline 接口有服务端缓存，大周期数据不会在 2 秒内变化
5. **最终方案**：REST 负责历史和结构 + WebSocket 实时价格驱动当前蜡烛

#### 当前架构（三层 useEffect）

```
┌─ REST klines (10s 轮询) ─┐
│  - 提供完整历史蜡烛        │
│  - 检测新蜡烛生成          │
│  - setData() 全量覆盖      │
└───────────────────────────┘
         ↓ lastCandleRef
┌─ livePrice (WebSocket) ──┐
│  - 每次价格变化触发        │
│  - 计算当前时间桶          │
│  - 更新当前蜡烛 close      │
│  - 扩展 high/low           │
│  - update() 增量更新       │
└───────────────────────────┘
```

**三个 useEffect 详解**：

**Effect 1: 图表创建（挂载一次）**
```ts
useEffect(() => {
  createChart() → candleSeries + volumeSeries
  ResizeObserver 监听容器尺寸变化
  return () => { chart.remove(); 清理 refs }
}, [])
```

**Effect 2: REST 数据加载（klines 变化时触发）**
```ts
useEffect(() => {
  klines → filter + sort → setData(candleData) + setData(volumeData)
  lastCandleRef.current = 最后一根蜡烛 { time, open, high, low, close, volume }
  if isFirstData → fitContent()
}, [klines])
```

**Effect 3: 实时价格驱动（livePrice 或 interval 变化时触发）**
```ts
useEffect(() => {
  const durationSec = INTERVAL_SECONDS[interval]  // "1h" → 3600
  const nowSec = Date.now() / 1000
  const bucketStart = floor(nowSec / durationSec) * durationSec
  
  if (!prev || bucketStart > prev.time) → 新蜡烛周期, 创建蜡烛
  if (bucketStart < prev.time) → return (不修改历史蜡烛)
  
  更新 prev.close = livePrice
  if livePrice > prev.high → prev.high = livePrice
  if livePrice < prev.low  → prev.low = livePrice
  
  candleSeries.update({ time: prev.time, ...prev })
}, [livePrice, interval])
```

**关键数据结构**：
```ts
const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "12h": 43200,
  "1d": 86400, "3d": 259200, "1w": 604800,
}
```

**livePrice 的来源**：
```ts
const livePrice = useMarketStore((s) => {
  const t = s.tickers[symbol]
  return t ? parseFloat(t.lastPrice) : undefined
})
```

---

## 5. 关键文件详解

### 5.1 `src/hooks/useBingXWebSocket.ts` (149 行)

**当前功能**：仅处理 ticker（`@ticker`），不处理 kline。

**重要细节**：
- `binaryType = "arraybuffer"` — BingX 发送二进制 GZIP 数据
- 消息解码：先 `TextDecoder` 解码，如果以 `{` 或 `[` 开头说明是纯 JSON，否则 GZIP 解压
- BingX 会发送文本 `"Ping"`，必须回复 `"Pong"` 否则连接断开
- 订阅消息格式：`{ id, reqType: "sub", dataType: "BTC-USDT@ticker" }`
- 响应格式：`{ code: 0, dataType: "BTC-USDT@ticker", data: { s, c, h, l, v, p, P, ... } }`
- `msg.code === 0 && !msg.dataType` 表示订阅确认响应（带 id），直接跳过
- 多连接场景：trade page 和 MarketOverview 各自创建独立 WS 连接

### 5.2 `src/hooks/useMarketData.ts` (93 行)

所有 hooks 通过内部 `fetchApi<T>()` 函数调用 `/api/bingx/market/*` 端点。

- `useKlines`: `refetchInterval: 10_000, staleTime: 5_000, limit: 200`
  - Kline 数据只用于加载历史结构和检测新蜡烛，不用于实时驱动
- `useSpotTicker`: `refetchInterval: 5_000, staleTime: 2_000`
  - 单个行情，WS 数据优先
- `useSpotTickers`: `refetchInterval: 5_000, staleTime: 2_000`
  - 批量行情，WS 数据覆盖对应币种

### 5.3 `src/stores/market.ts` (45 行)

Zustand store，包含：
- `tickers: Record<string, BingXTicker>` — WS 推送的实时 ticker 数据
- `klines: Record<string, BingXKline>` — **现已不再使用**（保留字段但无代码写入）
- `wsConnected: boolean`
- actions: `setTicker`, `setTickers`, `setKline`（遗留）, `setWsConnected`

### 5.4 `src/components/trade/KlineChart.tsx` (263 行) ★

见 4.4 完整分析。

### 5.5 `src/components/trade/MarketOverview.tsx` (85 行)

- 订阅 `useSpotTickers()` 获取完整列表
- `wsSymbols = tickers.slice(0, 30).map(t => t.symbol)` — 只为前 30 个币种订阅 WS
- 调用 `useBingXWebSocket(wsSymbols)` — 数据自动写入 store → `useSpotTickers` 合并
- 搜索过滤 + 点击切换 symbol
- 活跃 symbol 有 `bg-gold/10 border-l-2 border-l-gold` 高亮

### 5.6 `src/components/trade/OrderBook.tsx` (87 行)

- 纯 REST 2s 轮询 (`useOrderBook(symbol, 8)`)
- 显示 8 档买卖盘 + 价差
- 每档显示深度条（background bar 按比例）

### 5.7 `src/app/[locale]/trade/page.tsx` (93 行)

- 默认 symbol: `BTC-USDT`, 默认 interval: `1h`
- 可用周期: `["1m", "5m", "15m", "1h", "4h", "1d"]`
- 布局：左侧 MarketOverview(260px) | 中间 Chart | 右侧 OrderBook(256px)
- 顶部：symbol + 实时价格 + 涨跌幅 + 24h High/Low/Vol
- 只调用 `useBingXWebSocket([symbol])` — 无 kline WS

### 5.8 `src/lib/bingx/client.ts` (52 行)

- `BingXClient` 类，`publicRequest<T>(path, params)` 方法
- 基于 `fetch()` + `cache: "no-store"`
- 自动解析 `{ code: 0, data: ... }` 返回格式
- 从 `BINGX_API_BASE` (默认 `https://open-api.bingx.com`)

### 5.9 `src/lib/bingx/market.ts` (111 行)

服务端查询函数，全部调用 `bingxClient.publicRequest`：
- `getSpotSymbols()` → `/openApi/spot/v1/common/symbols`
- `getSpotTicker(symbol)` → `/openApi/spot/v1/ticker/24hr?symbol=`
- `getSpotTickers()` → `/openApi/spot/v1/ticker/24hr` (无参 = 全部)
- `getSpotKlines(symbol, interval, limit)` → `/openApi/spot/v1/market/kline` → 转换 `BingXKlineRow[]` → `BingXKline[]`
- `getSpotDepth(symbol, limit)` → `/openApi/spot/v1/market/depth`
- `getSpotTrades(symbol, limit)` → `/openApi/spot/v1/market/trades`
- `getFuturesContracts()` → `/openApi/swap/v2/quote/contracts`
- `getFuturesKlines(symbol, interval, limit)` → `/openApi/swap/v3/quote/klines`

### 5.10 `src/types/bingx.ts` (79 行)

```ts
BingXSymbol    { symbol, baseAsset, quoteAsset, status, precisions }
BingXTicker    { symbol, openPrice, highPrice, lowPrice, lastPrice, volume, quoteVolume, priceChange, priceChangePercent } // 全部 string
BingXKlineRow  [openTime:number, open:string, high:string, low:string, close:string, volume:string, closeTime:number, quoteVolume:string, trades?:number, ...]
BingXKline     { openTime, open, high, low, close, volume, closeTime, quoteVolume, trades? } // 全部 number
BingXDepth     { bids: [string,string][], asks: [string,string][] }
BingXTrade     { id, price, qty, time, isBuyerMaker }
```

### 5.11 `src/middleware.ts` (88 行)

路由分发：
- `/admin/*` → admin auth guard (未登录→login, 非 admin→首页)
- `/api/*` → 放行
- `/_next/*`, 静态资源 → 放行
- `/` → 重定向到 `/en-US`
- 其他 → `next-intl` middleware

### 5.12 `src/app/api/video/stream/[id]/route.ts` (153 行)

视频流代理，防止直接下载 Supabase 存储 URL：
- `GET /api/video/stream/[id]`
- 用 `service_role` client 查 `videos` 表
- 生成 Supabase 5 分钟签名 URL
- Free 用户看 Pro 视频 → 限制约 60 秒（按文件大小比例计算）
- 支持 HTTP Range 请求
- 返回 headers: `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`

### 5.13 CSS 设计系统 (tailwind.config.ts)

暗色主题，自定义色板：
```
bg-primary:    #0a0a0a (最深)
bg-secondary:  #141414
bg-tertiary:   #1a1a1a
bg-hover:      #222222
border-default:#2a2a2a
border-hover:  #3a3a3a
gold:          #d4a843 (主色调, gold-hover/gold-light/gold-dark)
text-primary:  #ffffff
text-secondary:#a0a0a0
text-muted:    #666666
success:       #22c55e (绿涨)
danger:        #ef4444 (红跌)
```

---

## 6. 配置与环境变量

`.env.local` 需要：
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=                    # 32 字节 hex, 用于加密用户 BingX API Key
NEXT_PUBLIC_SITE_URL=              # 默认 http://localhost:3000
NEXT_PUBLIC_SITE_NAME=Chart-IX
BINGX_API_BASE_URL=                # 默认 https://open-api.bingx.com
```

---

## 7. 已解决问题 & 经验教训

### 7.1 BingX WebSocket GZIP 问题
- **现象**：WebSocket 连接成功但收不到数据
- **原因**：BingX 所有 WebSocket 消息都是 GZIP 压缩的 ArrayBuffer
- **解决**：`binaryType = "arraybuffer"` + `DecompressionStream("gzip")` 解压

### 7.2 BingX WebSocket Ping/Pong
- **现象**：连接大约 30 秒后断开
- **原因**：BingX 发送文本 `"Ping"`，客户端必须回复 `"Pong"`
- **解决**：在 onmessage 中检测 `text === "Ping"` → `ws.send("Pong")`

### 7.3 BingX Spot WebSocket 不支持 Kline
- **现象**：订阅 `BTC-USDT@kline_1h` 后收不到任何 kline 消息
- **验证**：日志记录 200+ 条消息全部是 `@ticker`，0 条 `@kline`
- **结论**：`wss://open-api-ws.bingx.com/market` 只推送 ticker
- **解决**：K 线改用 REST + 实时价格驱动方案

### 7.4 lightweight-charts update() 错误
- **现象**：`Cannot update oldest data, last time=[object Object]`
- **原因**：传入的 time 参数不是数字
- **解决**：加 `typeof` + `isNaN` 校验 + try-catch 包裹 update()

### 7.5 REST Kline 服务端缓存问题
- **现象**：1h/4h/1d 周期 kline 轮询 2 秒但数据不变
- **原因**：BingX REST kline 接口对大周期有较长的服务端缓存
- **解决**：用 WebSocket 实时 ticker 价格驱动当前蜡烛的 close/high/low，不依赖 kline 接口返回实时数据

---

## 8. Git & 部署

**仓库**：`https://github.com/chartixtd/Chart-IX.git`  
**分支**：`main`（唯一分支）  
**部署**：Vercel 自动从 `main` 部署

**常用命令**：
```bash
npx next dev       # 开发
npx next build     # 构建 (必须通过才能推送)
git push origin main
```

---

## 9. 下一步待做事项

- [ ] 交易下单功能（目前仅有行情展示，无实际交易）
- [ ] 合约页面（`trade/futures`）目前是 stub
- [ ] `store.market.ts` 中的 `klines` 和 `setKline` 可清理（不再使用）
- [ ] `trade/page.tsx` 第 23 行的注释 "K线通过 REST 2s 轮询" 已过时，应更新为 "K 线通过 REST 加载历史 + WS 实时价格驱动"
- [ ] 视频进度同步功能完善
- [ ] Pro 订阅支付集成
