# 市场筛选器（Screener）设计文档

**日期**: 2026-07-28  
**状态**: 已确认  
**路由**: `/[locale]/screener`

---

## 目标

在 Chart-IX 中新增一个市场筛选页面，通过公开行情数据自动筛选适合日内短线交易的品种，提供综合评分排行榜，并支持一键跳转到交易页面（做多/做空）。

---

## 数据架构

### 新增 BingX API 端点

在 `src/lib/bingx/market.ts` 中新增两个公开接口：

| 函数 | BingX 端点 | 返回 |
|---|---|---|
| `getFuturesOpenInterest(symbol)` | `GET /openApi/swap/v2/quote/openInterest` | `{ symbol, openInterest, timestamp }` |
| `getFuturesFundingRate(symbol)` | `GET /openApi/swap/v2/quote/premiumIndex` | `{ symbol, markPrice, lastFundingRate, nextFundingTime }` |

相应的 API 代理路由（复用现有 `fetchApi` 模式）：
- `GET /api/bingx/market/openInterest?symbol=XXX-USDT`
- `GET /api/bingx/market/fundingRate?symbol=XXX-USDT`

响应格式沿用项目约定：`{ success: boolean, data: T }`

### 数据获取策略（两轮）

1. **第一轮（批量）**：复用 `useSpotTickers()` 获取全市场 24h 行情数据 → 前端执行硬性淘汰 → 得到候选列表
2. **第二轮（按需）**：对通过淘汰的候选币种，前端并行请求各自的 OI + Funding Rate → 计算综合评分 → 排序展示

理由：全市场 700+ 个交易对，逐个请求 OI/费率不可行。先淘汰后补详细数据，保证性能和效率。

### 数据刷新

- 24h ticker：30s 自动刷新（复用现有 React Query 配置）
- OI / Funding Rate：60s 刷新

### 新增类型

```typescript
interface BingXOpenInterest {
  symbol: string;
  openInterest: string;
  timestamp: number;
}

interface BingXFundingRate {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

interface ScreenerResult {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  amplitude: number;        // (high - low) / low * 100
  openInterest: number;
  fundingRate: number;
  oiVolumeRatio: number;    // OI / quoteVolume
  score: number;            // 0-100
}
```

---

## 筛选与打分逻辑

### 硬性淘汰（一票否决）

纯函数 `hardFilter(ticker: BingXTicker): boolean`，触发任一即淘汰：

| # | 规则 | 实现 |
|---|---|---|
| 1 | 24h 合约成交量 < $100M | `parseFloat(ticker.quoteVolume) < 100_000_000` |
| 2 | 24h 振幅 < 1.5% | `(high - low) / low * 100 < 1.5` |
| 3 | 做多方向：已涨超 +15% | `direction === 'long' && priceChangePercent > 15` |
| 4 | 做空方向：已跌超 -15% | `direction === 'short' && priceChangePercent < -15` |

规则 3/4 根据用户点击的「做多」/「做空」按钮动态决定方向。

### 综合打分（0-100）

`scoreToken(ticker, oi, fundingRate)` 函数，5 维度加权：

| 维度 | 权重 | 评分逻辑 |
|---|---|---|
| **振幅** | 25% | 2-5% 最优（满分），1.5-2% 偏低（半分段线性插值），>12% 递减至 0 |
| **流动性** | 25% | `log10(quoteVolume)` 归一化。$100M → 0 分，$10B+ → 100 分 |
| **OI/量比** | 20% | OI / quoteVolume。0.3-1.5 最优区间，过高（>3）说明持仓过重可能反转 |
| **费率健康度** | 15% | `\|fundingRate\| < 0.03%` → 满分；\|rate\| 在 0.03%-0.1% → 线性递减；>0.1% → 0 分 |
| **趋势位置** | 15% | 做多时 `(last - low) / (high - low)` 在 0.3-0.7 → 满分（非极端位置）；做空时反向 |

---

## 页面布局

### 路由

`/[locale]/screener`

### 布局结构

```
┌──────────────────────────────────────────────────────────┐
│  Navbar                                                   │
├──────────────────────────────────────────────────────────┤
│  市场筛选器              [Spot/Futures ▼]  [刷新]         │
├──────────────────────────────────────────────────────────┤
│  #  │ 币种    │ 价格    │ 24h   │ 振幅  │ 成交量  │ OI/量 │ 费率  │ 评分 │ 操作    │
│     │         │         │ 涨跌  │       │         │       │       │      │         │
│  #1 │ BTC    │ $63,208 │ +0.5% │ 3.2% │ $1.08B │ 0.85  │0.01% │ 87  │ [多][空]│
│  #2 │ ETH    │ $1,879  │ -1.2% │ 4.1% │ $694M  │ 0.82  │-0.01%│ 82  │ [多][空]│
│  ...                                                      │
└──────────────────────────────────────────────────────────┘
```

### 交互规则

- 默认按评分降序排列
- 点击表头任意列支持排序切换
- 「做多」/「做空」按钮：点击跳转 `/trade?symbol=XXX-USDT&side=long&market=futures`
  - 交易页接收 URL 参数，预填方向和合约市场
- 顶部市场切换（Spot / Futures）仅影响跳转时带的 `market` 参数，筛选数据源相同
- 筛选门槛固定，不暴露滑块（保持简洁）

### 组件拆分

| 组件 | 文件 | 职责 |
|---|---|---|
| `ScreenerPage` | `src/app/[locale]/screener/page.tsx` | 页面容器，状态管理，数据协调 |
| `ScreenerTable` | `src/components/screener/ScreenerTable.tsx` | 表格渲染，排序交互，操作按钮 |
| `screener-scoring.ts` | `src/lib/screener-scoring.ts` | 纯函数：`hardFilter()` + `scoreToken()` |
| `useScreenerData` | `src/hooks/useScreenerData.ts` | 封装两轮数据获取逻辑 |

### 状态管理

不引入新的 Zustand store。页面内用 `useState` + `useMemo` 管理：
- `market: 'spot' | 'futures'` — 市场切换
- `sortKey` / `sortDir` — 排序状态
- 筛选和打分结果均为派生状态（`useMemo`）

### 空状态 / 加载态

- 加载中：按项目现有 `Skeleton` 组件展示 10 行骨架屏
- 无结果：「当前市场没有符合条件的品种，请稍后再试」
- 错误：「数据加载失败，请重试」+ 手动刷新按钮

---

## 导航集成

在 Navbar 中新增「筛选器」入口（需新增 i18n key：`nav.screener`），放在「交易」旁边。

### i18n 新增 key

```json
{
  "nav": { "screener": "筛选器" },
  "screener": {
    "title": "市场筛选器",
    "no_results": "当前市场没有符合条件的品种",
    "loading": "正在分析市场数据...",
    "error": "数据加载失败",
    "retry": "重试",
    "refresh": "刷新",
    "spot": "现货",
    "futures": "合约",
    "columns": {
      "rank": "排名",
      "symbol": "币种",
      "price": "价格",
      "change": "24h涨跌",
      "amplitude": "振幅",
      "volume": "成交量",
      "oi_volume_ratio": "OI/量",
      "funding_rate": "费率",
      "score": "评分",
      "actions": "操作"
    },
    "action_long": "做多",
    "action_short": "做空"
  }
}
```

---

## 文件清单

| 文件 | 操作 | 类型 |
|---|---|---|
| `src/lib/bingx/market.ts` | 修改 | 新增 2 个函数 |
| `src/app/api/bingx/market/openInterest/route.ts` | 新增 | API 路由 |
| `src/app/api/bingx/market/fundingRate/route.ts` | 新增 | API 路由 |
| `src/types/bingx.ts` | 修改 | 新增类型 |
| `src/lib/screener-scoring.ts` | 新增 | 纯函数逻辑 |
| `src/hooks/useScreenerData.ts` | 新增 | 数据 hook |
| `src/hooks/useMarketData.ts` | 修改 | 新增 `useOpenInterest` / `useFundingRate` hooks |
| `src/components/screener/ScreenerTable.tsx` | 新增 | 表格组件 |
| `src/app/[locale]/screener/page.tsx` | 新增 | 页面 |
| `src/components/layout/Navbar.tsx` | 修改 | 新增导航入口 |
| `src/i18n/messages/zh-CN.json` | 修改 | 新增翻译 |
| `src/i18n/messages/en-US.json` | 修改 | 新增翻译 |
| `src/i18n/messages/ms-MY.json` | 修改 | 新增翻译 |
| `src/app/[locale]/trade/page.tsx` | 修改 | 支持 URL 参数预填 symbol/side/market |
