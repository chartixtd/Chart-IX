# 可拖拽布局 + 价格联动（Phase 5）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端交易页从固定三栏（行情列表 | 图表 | 右侧 tab 切换的下单区）改成可拖拽调宽的四栏（行情列表 | 图表 | 盘口 | 下单+持仓），盘口价格点击后直接填入下单面板的限价框。

**Architecture:** 用 `react-resizable-panels`（业界标准的 React 可拖拽面板库，`PanelGroup`/`Panel`/`PanelResizeHandle`）包裹现有的四个区域，用它自带的 `autoSaveId` 做本地持久化（不需要自己写 zustand 状态和 localStorage 序列化）。盘口原来是"下单/挂单/盘口"三个 tab 里的其中一个，现在拆出来做独立的第三栏，永久可见；右侧最后一栏只剩下单面板+持仓/挂单面板堆叠，不再需要 tab 切换。价格联动走一个轻量的"信号"prop（`{price, nonce}`），点盘口价格时更新它，`OrderForm` 用一个只在信号变化时触发的 effect 把价格填进限价框——不需要把 `OrderForm` 的内部 state 提升到页面级别，改动面小。移动端布局（tab 切换单栏）不受影响，本阶段不碰。

**Tech Stack:** `react-resizable-panels`（新增依赖）、现有的 zustand/React state。

## Global Constraints

- 只改桌面端（`lg:` 断点以上）布局；移动端的 tab 切换单栏布局完全不动
- 四栏默认宽度比例：行情列表 15% / 图表 52% / 盘口 13% / 下单+持仓 20%（各自都设 `minSize`/多数设 `maxSize` 防止被拖成不可用的宽度）
- 面板宽度用 `react-resizable-panels` 的 `autoSaveId` 机制自动持久化到 localStorage，不用自己写持久化逻辑
- 价格联动范围：只做"点击盘口价格 → 填入下单面板限价框"，且只在当前订单类型是限价类（`LIMIT_TYPES`）时生效——图表上拖拽创建价格线联动下单价（原设计文档里提到的"拖拽图表联动"）不在本阶段范围内，风险和收益不对称，明确不做
- `useTradePrefsStore` 里的 `rightTab`/`setRightTab` 字段保留不动——它还被 `PreferencesSync.tsx` 用于跨设备同步偏好，本阶段桌面端布局不再读取它，但删除它需要同时改 `PreferencesSync.tsx` 的同步 payload 形状，超出本阶段范围，不做
- 视觉打磨范围限定在：拖拽手柄本身的可视反馈（hover/active 状态）、盘口独立成栏后新增的栏头样式——不做全站范围的视觉大改
- 现有的下单确认弹窗、持仓/挂单面板、K线图表的绘图工具/指标等功能一律不受影响

---

## File Structure

```
package.json                                      修改：新增 react-resizable-panels 依赖

src/components/trade/OrderBook.tsx                 修改：价格行加可点击回调
src/components/trade/order-form/OrderForm.tsx       修改：新增 priceLinkSignal prop + 联动 effect
src/app/[locale]/trade/page.tsx                     修改：桌面端布局改成 PanelGroup 四栏，接入价格联动
```

---

### Task 1: OrderBook 价格点击回调

**Files:**
- Modify: `src/components/trade/OrderBook.tsx`

**Interfaces:**
- Produces: `OrderBook` 新增可选 prop `onPriceClick?: (price: number) => void`，供 Task 3 的 `page.tsx` 使用

- [ ] **Step 1: 整文件替换**

```tsx
// src/components/trade/OrderBook.tsx
"use client";

import { memo } from "react";
import { useOrderBook } from "@/hooks/useMarketData";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface OrderBookProps {
  symbol: string;
  /** 点击某一行价格时回调，价格是解析后的 number。不传则价格行不可点击。 */
  onPriceClick?: (price: number) => void;
}

export const OrderBook = memo(function OrderBook({ symbol, onPriceClick }: OrderBookProps) {
  const { data, isLoading } = useOrderBook(symbol, 8);

  if (isLoading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded-sm bg-bg-tertiary" />
        ))}
      </div>
    );
  }

  const asks = data?.asks?.slice(0, 8).reverse() || [];
  const bids = data?.bids?.slice(0, 8) || [];

  const maxTotal = Math.max(
    ...(bids.map(([, q]) => parseFloat(q)) || [0]),
    ...(asks.map(([, q]) => parseFloat(q)) || [0])
  );

  const renderRow = (price: string, qty: string, i: number, side: "ask" | "bid") => {
    const volume = parseFloat(qty);
    const widthPercent = maxTotal > 0 ? (volume / maxTotal) * 100 : 0;
    const priceColor = side === "ask" ? "text-danger" : "text-success";
    const barColor = side === "ask" ? "bg-danger/10" : "bg-success/10";

    const priceCell = (
      <span className={cn("relative z-10", priceColor)}>{formatPrice(parseFloat(price))}</span>
    );

    return (
      <div key={`${side}-${i}`} className="grid grid-cols-3 gap-1 px-2 py-0.5 relative">
        <div className={cn("absolute inset-y-0 right-0", barColor)} style={{ width: `${widthPercent}%` }} />
        {onPriceClick ? (
          <button
            type="button"
            onClick={() => onPriceClick(parseFloat(price))}
            className="relative z-10 text-left hover:underline"
            title="点击填入下单价格"
          >
            {formatPrice(parseFloat(price))}
          </button>
        ) : (
          priceCell
        )}
        <span className="relative z-10 text-right text-text-secondary">{qty}</span>
        <span className="relative z-10 text-right text-text-muted">{volume.toFixed(4)}</span>
      </div>
    );
  };

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="grid grid-cols-3 gap-1 px-2 py-1.5 text-text-muted border-b border-border-default">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (Sell) */}
      {asks.map(([price, qty], i) => renderRow(price, qty, i, "ask"))}

      {/* Spread */}
      <div className="border-y border-border-default px-2 py-1.5 text-center text-text-muted">
        {data ? (
          <span>
            Spread: {formatPrice(parseFloat(asks[0]?.[0] || "0") - parseFloat(bids[0]?.[0] || "0"))}
          </span>
        ) : (
          "—"
        )}
      </div>

      {/* Bids (Buy) */}
      {bids.map(([price, qty], i) => renderRow(price, qty, i, "bid"))}
    </div>
  );
});
```

（这段替换把原来重复写两遍的 asks/bids 渲染逻辑合并成一个 `renderRow` 帮助函数，价格单元格在有 `onPriceClick` 时渲染成按钮、没有时保持原来的 `<span>`——纯展示逻辑不变，只是抽出了共享的价格单元格分支。）

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/components/trade/OrderBook.tsx
git commit -m "feat(trade): add clickable order book prices"
```

---

### Task 2: OrderForm 接收外部价格联动信号

**Files:**
- Modify: `src/components/trade/order-form/OrderForm.tsx`

**Interfaces:**
- Consumes: 无新依赖
- Produces: `OrderForm` 新增可选 prop `priceLinkSignal?: { price: number; nonce: number } | null`，供 Task 3 的 `page.tsx` 使用

- [ ] **Step 1: 加 prop**

把：

```typescript
interface OrderFormProps {
  symbol: string;
  market: OrderFormMarket;
  initialSide?: "long" | "short";
}

export function OrderForm({ symbol, market, initialSide }: OrderFormProps) {
```

改成：

```typescript
interface OrderFormProps {
  symbol: string;
  market: OrderFormMarket;
  initialSide?: "long" | "short";
  /** 点击盘口/图表价格后传入的联动信号；nonce 变化即视为一次新的联动请求
   *  （哪怕两次点了同一个价格）。只在当前是限价类订单类型时生效。 */
  priceLinkSignal?: { price: number; nonce: number } | null;
}

export function OrderForm({ symbol, market, initialSide, priceLinkSignal }: OrderFormProps) {
```

- [ ] **Step 2: 加联动 effect**

找到：

```typescript
  const isLimit = LIMIT_TYPES.has(orderType);
  const refPrice = isLimit && parseFloat(price) > 0 ? parseFloat(price) : currentPrice;
```

在它之后加上：

```typescript
  const isLimit = LIMIT_TYPES.has(orderType);
  const refPrice = isLimit && parseFloat(price) > 0 ? parseFloat(price) : currentPrice;

  // 盘口/图表价格联动：只在当前是限价类订单时把点击的价格填进价格框，
  // 只依赖 nonce（而不是 isLimit）——如果同时依赖 isLimit，用户先点价格
  // 再切成限价单不会补填，体验上不如"点的时候是什么类型就按什么类型处理"
  // 直观；nonce 变化本身就代表"这是一次新的点击"，不需要额外去重。
  useEffect(() => {
    if (!priceLinkSignal || !isLimit) return;
    setPrice(String(priceLinkSignal.price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceLinkSignal]);
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/order-form/OrderForm.tsx
git commit -m "feat(trade): accept external price-link signal in OrderForm"
```

---

### Task 3: 桌面端布局改成可拖拽四栏

**Files:**
- Modify: `package.json`（新增依赖）
- Modify: `src/app/[locale]/trade/page.tsx`

**Interfaces:**
- Consumes: `OrderBook`（Task 1，新 `onPriceClick` prop）；`OrderForm`（Task 2，新 `priceLinkSignal` prop）；`Panel`/`PanelGroup`/`PanelResizeHandle` from `react-resizable-panels`

- [ ] **Step 1: 装依赖**

```bash
npm install react-resizable-panels
```

Expected: `package.json`/`package-lock.json` 里新增这一个依赖，没有版本冲突报错

- [ ] **Step 2: 整文件替换 `page.tsx`**

把整个文件替换为：

```tsx
// src/app/[locale]/trade/page.tsx
"use client";

import { useState, memo, useCallback, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { MarketOverview } from "@/components/trade/MarketOverview";
import { KlineChart } from "@/components/trade/KlineChart";
import { FearGreedIndex } from "@/components/trade/FearGreedIndex";
import { OrderForm } from "@/components/trade/order-form/OrderForm";
import { OrdersPanel } from "@/components/trade/OrdersPanel";
import { PaperOrdersPanel } from "@/components/trade/PaperOrdersPanel";
import { OrderBook } from "@/components/trade/OrderBook";
import { FuturesInfoPanel } from "@/components/trade/FuturesInfoPanel";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { useChartOverlay } from "@/hooks/useChartOverlay";
import { useTradePrefsStore, type TradeMarketType } from "@/stores/tradePrefs";
import { formatPrice, formatPercent, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

// Mirrors BingX's supported kline intervals minus "1M" (monthly), which
// KlineChart's live-candle bucketing can't represent as a fixed-duration window.
// Which of these show as always-visible buttons vs. behind "更多" is per-user
// (see pinnedIntervals in stores/tradePrefs.ts).
const ALL_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"];
type MarketType = TradeMarketType;

// Memoized top bar — isolates ticker-driven re-renders from the rest of the page
const TickerBar = memo(function TickerBar({
  symbol,
  market,
  onMarketChange,
  onPickSymbol,
  locale,
  isPro,
  isLoggedIn,
  authLoading,
}: {
  symbol: string;
  market: MarketType;
  onMarketChange: (m: MarketType) => void;
  onPickSymbol?: () => void;
  locale: string;
  isPro: boolean;
  isLoggedIn: boolean;
  authLoading: boolean;
}) {
  const t = useTranslations("trade");
  const { data: ticker } = useSpotTicker(symbol);
  const isPositive = ticker ? parseFloat(ticker.priceChangePercent) >= 0 : false;

  return (
    <div className="flex items-center gap-4 border-b border-border-default px-4 py-3 overflow-x-auto">
      <div className="flex shrink-0 rounded-xs bg-bg-tertiary p-0.5">
        <button
          onClick={() => onMarketChange("spot")}
          className={cn(
            "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
            market === "spot" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
          )}
        >
          Spot
        </button>
        {!authLoading && (
          isLoggedIn ? (
            <button
              onClick={() => onMarketChange("paper")}
              className={cn(
                "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                market === "paper" ? "bg-bg-primary text-gold" : "text-text-muted hover:text-text-secondary"
              )}
            >
              模拟盘
            </button>
          ) : (
            <Link
              href={`/${locale}/login`}
              className="rounded-xs px-3 py-1 text-xs font-medium text-text-muted hover:text-gold transition-colors"
              title="登录后可用"
            >
              模拟盘
              <span className="ml-1 opacity-60">&#x1F512;</span>
            </Link>
          )
        )}
        {!authLoading && (
          isPro ? (
            <button
              onClick={() => onMarketChange("futures")}
              className={cn(
                "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                market === "futures" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
              )}
            >
              Futures
            </button>
          ) : (
            <Link
              href={`/${locale}/upgrade`}
              className="rounded-xs px-3 py-1 text-xs font-medium text-text-muted hover:text-gold transition-colors"
              title={t("futures.pro_required")}
            >
              Futures
              <span className="ml-1 opacity-60">&#x1F512;</span>
            </Link>
          )
        )}
      </div>

      <div className="hidden h-4 w-px bg-border-default sm:block" />

      <button
        onClick={onPickSymbol}
        className={cn("flex shrink-0 items-center gap-3", onPickSymbol && "lg:pointer-events-none")}
      >
        <h2 className="font-display text-lg tracking-tight">{symbol}</h2>
        {onPickSymbol && <span className="text-xs text-text-muted lg:hidden">切换 ▾</span>}
      </button>
      {ticker && (
        <>
          <span className={cn("shrink-0 font-mono text-xl font-semibold tabular-nums", isPositive ? "text-success" : "text-danger")}>
            {formatPrice(Number(ticker.lastPrice))}
          </span>
          <Badge variant={isPositive ? "green" : "red"}>
            {formatPercent(parseFloat(ticker.priceChangePercent))}
          </Badge>
          <SetAlertButton symbol={symbol} currentPrice={Number(ticker.lastPrice)} />
          <div className="ml-auto hidden shrink-0 items-center gap-4 text-xs text-text-secondary lg:flex">
            <span>24h High: <span className="font-mono text-text-primary tabular-nums">{formatPrice(parseFloat(ticker.highPrice))}</span></span>
            <span>24h Low: <span className="font-mono text-text-primary tabular-nums">{formatPrice(parseFloat(ticker.lowPrice))}</span></span>
            <span>Vol: <span className="font-mono text-text-primary tabular-nums">{formatNumber(parseFloat(ticker.volume), 0)}</span></span>
          </div>
        </>
      )}
    </div>
  );
});

// Set a price alert for the current symbol
const SetAlertButton = memo(function SetAlertButton({ symbol, currentPrice }: { symbol: string; currentPrice: number }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const addAlert = usePriceAlertsStore((s) => s.addAlert);

  const handleOpen = () => {
    setPrice(currentPrice > 0 ? currentPrice.toString() : "");
    setOpen(true);
  };

  const handleConfirm = () => {
    const target = parseFloat(price);
    if (!target || target <= 0) return;
    addAlert(symbol, target, direction);
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="shrink-0 rounded-xs px-1.5 py-1 text-text-muted hover:bg-bg-tertiary hover:text-gold"
        title="设置价格提醒"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`价格提醒 · ${symbol}`} size="sm">
        <div className="space-y-3">
          <div className="flex rounded-xs bg-bg-tertiary p-0.5 text-xs">
            <button
              onClick={() => setDirection("above")}
              className={cn("flex-1 rounded-xs py-1.5", direction === "above" ? "bg-bg-primary text-success" : "text-text-muted")}
            >
              涨到以上
            </button>
            <button
              onClick={() => setDirection("below")}
              className={cn("flex-1 rounded-xs py-1.5", direction === "below" ? "bg-bg-primary text-danger" : "text-text-muted")}
            >
              跌到以下
            </button>
          </div>
          <Input placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
          <p className="text-xs text-text-muted">提醒只在你打开网站时以站内通知的形式出现，不会发邮件或推送。</p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" size="sm" onClick={handleConfirm}>设置提醒</Button>
          </div>
        </div>
      </Modal>
    </>
  );
});

// Memoized interval bar — user-pinned intervals as buttons, the rest behind a
// "more" dropdown where each entry can be starred to pin/unpin it. Pins persist
// per-user (zustand localStorage + PreferencesSync to Supabase).
const IntervalBar = memo(function IntervalBar({
  interval,
  onIntervalChange,
}: {
  interval: string;
  onIntervalChange: (i: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pinnedIntervals = useTradePrefsStore((s) => s.pinnedIntervals);
  const togglePinnedInterval = useTradePrefsStore((s) => s.togglePinnedInterval);

  // Keep the visible row in canonical (fast→slow) order regardless of pin order
  const pinnedInOrder = ALL_INTERVALS.filter((i) => pinnedIntervals.includes(i));
  const isPinned = pinnedInOrder.includes(interval);

  return (
    <div className="relative flex items-center gap-1 px-3 py-1.5">
      {pinnedInOrder.map((int) => (
        <button
          key={int}
          onClick={() => onIntervalChange(int)}
          className={cn(
            "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
            interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
          )}
        >
          {int}
        </button>
      ))}

      <button
        onClick={() => setMoreOpen((o) => !o)}
        className={cn(
          "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
          !isPinned ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
        )}
      >
        {!isPinned ? interval : "更多"} ▾
      </button>

      {moreOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border-default bg-bg-secondary p-2 shadow-modal">
            <p className="mb-1 px-1 text-[11px] text-text-muted">点击星标固定到常用栏</p>
            <div className="grid grid-cols-4 gap-1">
              {ALL_INTERVALS.map((int) => {
                const pinned = pinnedIntervals.includes(int);
                return (
                  <div
                    key={int}
                    className={cn(
                      "flex items-center justify-between rounded-xs pl-1.5 pr-0.5 py-1 text-xs font-medium transition-colors",
                      interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
                    )}
                  >
                    <button
                      onClick={() => {
                        onIntervalChange(int);
                        setMoreOpen(false);
                      }}
                      className="flex-1 text-left"
                    >
                      {int}
                    </button>
                    <button
                      onClick={() => togglePinnedInterval(int)}
                      title={pinned ? "取消固定" : "固定到常用栏"}
                      className={cn(
                        "shrink-0 px-0.5 transition-colors",
                        pinned ? "text-gold" : "text-text-muted/50 hover:text-text-muted"
                      )}
                    >
                      {pinned ? "★" : "☆"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

/** 竖直方向的拖拽手柄——常态是一条细分隔线，hover/拖拽时高亮成金色并露出一个抓取提示点 */
function ResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-1 shrink-0 bg-border-default transition-colors hover:bg-gold/50 active:bg-gold">
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-2.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs bg-bg-tertiary opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-[8px] leading-none text-text-muted">⋮</span>
      </div>
    </PanelResizeHandle>
  );
}

export default function TradePage() {
  const locale = useLocale();
  const auth = useAuth();
  const symbol = useTradePrefsStore((s) => s.symbol);
  const setSymbol = useTradePrefsStore((s) => s.setSymbol);
  const interval = useTradePrefsStore((s) => s.interval);
  const setInterval = useTradePrefsStore((s) => s.setInterval);
  const market = useTradePrefsStore((s) => s.market);
  const setMarket = useTradePrefsStore((s) => s.setMarket);
  const [mobileTab, setMobileTab] = useState<"chart" | "trade" | "book">("chart");
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);
  const [initialSide, setInitialSide] = useState<"long" | "short" | undefined>();
  const [priceLinkSignal, setPriceLinkSignal] = useState<{ price: number; nonce: number } | null>(null);

  useBingXWebSocket([symbol]);

  // URL 参数预填：从 screener 页面跳转时自动设置 symbol/market/side
  const searchParams = useSearchParams();
  useEffect(() => {
    const urlSymbol = searchParams.get("symbol");
    const urlMarket = searchParams.get("market") as TradeMarketType | null;
    const urlSide = searchParams.get("side") as "long" | "short" | null;
    if (urlSymbol) setSymbol(urlSymbol);
    if (urlMarket && (urlMarket === "spot" || urlMarket === "futures" || urlMarket === "paper")) {
      setMarket(urlMarket);
    }
    if (urlSide) setInitialSide(urlSide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 图表叠加：进出场标记 + 止盈止损/进场/强平价格线（按市场类型聚合）
  const { tradeMarkers, priceLines } = useChartOverlay(symbol, market);

  const isPro = auth.tier === "pro";
  const isLoggedIn = !!auth.userId;

  const handleSymbolSelect = useCallback((s: string) => { setSymbol(s); setSymbolPickerOpen(false); }, []);
  const handleIntervalChange = useCallback((i: string) => setInterval(i), []);
  const handleMarketChange = useCallback((m: MarketType) => setMarket(m), []);
  const openSymbolPicker = useCallback(() => setSymbolPickerOpen(true), []);
  const handleOrderBookPriceClick = useCallback((price: number) => {
    setPriceLinkSignal({ price, nonce: Date.now() });
  }, []);

  // key={market}: 切换市场必须整体重挂载 OrderForm，否则同一实例会带着上一个市场的
  // state（尤其是杠杆）跨市场存活——模拟盘本地设置的杠杆数字会原样漏进合约表单。
  const tradePanel = (
    <OrderForm
      key={market}
      symbol={symbol}
      market={market}
      initialSide={initialSide}
      priceLinkSignal={priceLinkSignal}
    />
  );

  const ordersPanel =
    market === "spot" ? <OrdersPanel symbol={symbol} />
    : market === "paper" ? <PaperOrdersPanel symbol={symbol} />
    : <FuturesInfoPanel symbol={symbol} />;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <TickerBar
        symbol={symbol}
        market={market}
        onMarketChange={handleMarketChange}
        onPickSymbol={openSymbolPicker}
        locale={locale}
        isPro={isPro}
        isLoggedIn={isLoggedIn}
        authLoading={auth.loading}
      />

      {/* Desktop layout: draggable 4-column layout */}
      <PanelGroup direction="horizontal" autoSaveId="chart-ix-trade-layout" className="hidden flex-1 overflow-hidden lg:flex">
        <Panel defaultSize={15} minSize={10} maxSize={25} className="border-r border-border-default">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={52} minSize={30}>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex items-center border-b border-border-default">
              <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
              <div className="ml-auto pr-2">
                <FearGreedIndex compact />
              </div>
            </div>
            <div className="flex-1">
              <KlineChart symbol={symbol} interval={interval} className="h-full" tradeMarkers={tradeMarkers} priceLines={priceLines} />
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={13} minSize={8} maxSize={22} className="border-r border-border-default">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border-default px-3 py-2">
              <span className="text-xs font-medium text-text-secondary">盘口</span>
            </div>
            <div className="flex-1 overflow-auto">
              <OrderBook symbol={symbol} onPriceClick={handleOrderBookPriceClick} />
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={20} minSize={14} maxSize={32}>
          <div className="flex h-full flex-col divide-y divide-border-default overflow-hidden">
            <div className="shrink-0">{tradePanel}</div>
            <div className="min-h-0 flex-1 overflow-auto">{ordersPanel}</div>
          </div>
        </Panel>
      </PanelGroup>

      {/* Mobile layout: tab-switched single column */}
      <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
        <div className="flex border-b border-border-default">
          {([
            { key: "chart", label: "图表" },
            { key: "trade", label: "下单" },
            { key: "book", label: "订单簿" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={cn(
                "flex-1 py-2.5 text-sm font-medium transition-colors",
                mobileTab === key
                  ? "text-text-primary border-b-2 border-gold bg-bg-tertiary"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {mobileTab === "chart" && (
            <div className="flex h-full flex-col">
              <div className="flex items-center border-b border-border-default">
                <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
                <div className="ml-auto pr-2">
                  <FearGreedIndex compact />
                </div>
              </div>
              <div className="flex-1">
                <KlineChart symbol={symbol} interval={interval} className="h-full" tradeMarkers={tradeMarkers} priceLines={priceLines} />
              </div>
            </div>
          )}
          {mobileTab === "trade" && (
            <div className="flex h-full flex-col divide-y divide-border-default">
              <div className="shrink-0">{tradePanel}</div>
              <div className="min-h-[16rem] flex-1">{ordersPanel}</div>
            </div>
          )}
          {mobileTab === "book" && <OrderBook symbol={symbol} onPriceClick={handleOrderBookPriceClick} />}
        </div>
      </div>

      {/* Mobile symbol picker */}
      <Modal open={symbolPickerOpen} onClose={() => setSymbolPickerOpen(false)} title="选择交易对" size="sm" className="lg:hidden">
        <div className="-m-6 h-[70vh]">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </div>
      </Modal>
    </div>
  );
}
```

这次替换相对原文件的关键变化：
- 删除了 `RightTabs` 组件（不再需要——盘口现在是独立一栏，下单+持仓面板堆叠展示不再需要 tab 切换）
- 删除了对 `rightTab`/`setRightTab` 的读取（store 里的字段本身不动，见 Global Constraints）
- 桌面端布局从 `<div className="hidden flex-1 ... lg:flex">` 三个 `<div>` 改成 `<PanelGroup>` 包 4 个 `<Panel>`，中间用 `<ResizeHandle />` 分隔
- 新增 `priceLinkSignal` state + `handleOrderBookPriceClick`，接到 `OrderForm` 和两处 `OrderBook`（桌面盘口栏 + 移动端"订单簿" tab）
- 移动端布局的结构和交互完全不变，只是给 `OrderBook` 多传了一个 `onPriceClick` prop

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 手动验证**

启动 dev server，打开 `/trade`（桌面宽度，`lg` 断点以上）：

1. 应该看到四栏：行情列表 / 图表 / 盘口 / 下单+持仓，栏与栏之间有细分隔线
2. 鼠标悬停在分隔线上应该变成金色高亮并露出一个竖排的抓取提示；拖拽应该能实时调整相邻两栏的宽度
3. 刷新页面：拖拽过的宽度应该被记住（`autoSaveId` 持久化生效）
4. 点击盘口任意一行的价格：如果当前下单面板选的是限价类订单类型（比如"限价"），价格框应该立刻被填成点击的那个价格；如果当前是市价单，点击应该没有可见效果（联动只在限价类订单类型下生效）
5. 切换市场（现货/模拟盘/合约）、切换订单类型、下单确认弹窗、K线图表指标/绘图工具——都应该和改动前一样正常工作，没有回归
6. 缩小浏览器窗口到移动宽度：应该看到原来的三 tab（图表/下单/订单簿）切换布局，"订单簿" tab 里点价格同样应该联动到"下单" tab 的价格框

Expected: 四栏可拖拽且宽度持久化，价格联动只在限价类订单下生效，移动端布局和交互不受影响

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/\[locale\]/trade/page.tsx
git commit -m "feat(trade): switch desktop trade layout to draggable four-column panels with order-book price link"
```
