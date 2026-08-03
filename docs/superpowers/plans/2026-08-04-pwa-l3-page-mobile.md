# 页面移动化（L3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 14 个用户端页面在手机上从「桌面布局硬挤」改成真正可用，其中交易页消除双层导航、并修掉桌面/手机双挂载。

**Architecture:** 先做两项全站受益的通用改造（`Modal` 增加 bottom sheet 形态、表格转卡片模式），再逐页重排。交易页改为「图表全屏 + 底部操作条 + 弹出 sheet」，子 tab 完全消失。**页面内容始终只渲染一棵树**——`lg:hidden` / `hidden lg:flex` 只允许用在静态无副作用的元素上。

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS 3 · next-intl 4 · zustand 5 · lightweight-charts 5 · vitest 3

**Spec:** [2026-08-04-mobile-pwa-design.md](../specs/2026-08-04-mobile-pwa-design.md)
**Depends on:** L0（`pb-tabbar` / `safe-*` 令牌、16px 输入框规则）、L1（底部 tab bar、`MobileShell`）

## Global Constraints

- 沿用现有技术栈，**不引入任何新依赖**。
- 三语并存：`zh-CN` / `en-US` / `ms-MY`。任何新增文案必须同时写入三个 message 文件。
- 设计令牌以 [DESIGN.md](../../../DESIGN.md) 为准：底色 `#0B0A08`、次级底 `#14120E`、三级底 `#1C1913`、金 `#C9A24B`、主文本 `#F5F0E6`、次文本 `#A89F8C`、弱文本 `#6E675A`、描边 `#2C271C`、涨 `#34C77B`、跌 `#E5484D`。
- **不用卡片堆叠做页面主结构**；用发丝线与留白分区（[DESIGN.md](../../../DESIGN.md) 的 prohibitions）。
- 断点：手机布局在 `<lg`（1024px）生效。
- **触摸目标最小 44×44 px。** 实盘下单时点错杠杆是要赔钱的。
- **禁止为同一份内容渲染两棵树。** 桌面与手机共用一棵内容树，只用响应式 CSS 区分。外壳（导航条、纯装饰元素）不受此限。
- **表格在手机上转卡片列表，不做横向滚动条**——那在手机上是伪适配。
- vitest 的 `include` 只覆盖 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts`；`environment: "node"`。
- 新增注释用中文，解释「为什么」而非「做了什么」。
- 每个任务结束时提交一次，commit message 用英文、遵循 conventional commits。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/components/ui/Modal.tsx` | 增加 `variant="sheet"`：手机上从底部滑出 |
| `src/components/ui/RecordList.tsx` | 表格 ↔ 卡片列表的统一渲染组件 |
| `src/app/[locale]/trade/MobileTradeBar.tsx` | 交易页底部操作条（持仓/盘口 + 买入/卖出） |
| `src/app/[locale]/trade/page.tsx` | 单棵内容树 + 手机新布局 |
| 其余页面 | 就地响应式重排 |

---

### Task 1: `Modal` 增加 bottom sheet 形态

**Files:**
- Modify: `src/components/ui/Modal.tsx`
- Modify: `tailwind.config.ts`

**Interfaces:**
- Consumes: 无
- Produces: `<Modal variant="sheet" open onClose title? size?>` — 手机上从底部滑出并占满宽度，`lg` 及以上退回居中弹窗

全站弹窗都走这个组件，改一处全站受益，是性价比最高的一处改造。

- [ ] **Step 1: 在 `tailwind.config.ts` 中加入上滑入场动画**

在 `theme.extend.keyframes` 内加入：

```ts
        "sheet-in": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
```

在 `theme.extend.animation` 内加入：

```ts
        "sheet-in": "sheet-in 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
```

- [ ] **Step 2: 改造 `Modal`**

把 `src/components/ui/Modal.tsx` 整体替换为：

```tsx
import { cn } from "@/lib/utils";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  /**
   * "sheet" 在手机上从底部滑出、占满宽度，lg 及以上退回居中弹窗。
   * 手机上居中弹窗要么够不着关闭按钮，要么被键盘顶掉一半。
   */
  variant?: "dialog" | "sheet";
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  size = "md",
  variant = "dialog",
}: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const isSheet = variant === "sheet";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        isSheet ? "items-end justify-center lg:items-center lg:p-4" : "items-center justify-center p-4"
      )}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full border border-border-default bg-bg-secondary shadow-modal",
          isSheet
            ? [
                // 底部 sheet：只有上方两角圆润，底部留出系统安全区
                "max-h-[88dvh] overflow-y-auto rounded-t-lg pb-safe-b animate-sheet-in",
                "lg:max-h-[85vh] lg:rounded-lg lg:pb-0 lg:animate-scale-in",
                sizeClasses[size],
              ]
            : ["rounded-lg animate-scale-in", sizeClasses[size]],
          className
        )}
      >
        {isSheet && (
          // 拖拽把手：纯视觉提示，告诉用户这是可以往下拨走的表面
          <div className="flex justify-center pt-3 lg:hidden">
            <div className="h-1 w-10 rounded-full bg-border-hover" />
          </div>
        )}

        {title && (
          <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex h-11 w-11 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
```

关闭按钮由 `p-1`（约 28×28）改为 `h-11 w-11`（44×44），满足触摸目标下限。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功，无 TypeScript 错误（`variant` 有默认值，现有调用点无需改动）。

- [ ] **Step 4: 提交**

```bash
git add src/components/ui/Modal.tsx tailwind.config.ts
git commit -m "feat(ui): add bottom sheet variant to Modal"
```

---

### Task 2: 表格转卡片的统一组件

**Files:**
- Create: `src/components/ui/RecordList.tsx`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type RecordColumn<T> = { key: string; header: string; render: (row: T) => ReactNode; align?: "left" | "right"; primary?: boolean; hideOnMobile?: boolean }`
  - `function RecordList<T>(props: { rows: T[]; columns: RecordColumn<T>[]; rowKey: (row: T) => string; empty?: ReactNode; onRowClick?: (row: T) => void }): JSX.Element`

同一份数据、同一棵树：`lg` 以上渲染 `<table>`，以下渲染卡片列表。这里的双份 DOM 是**纯展示元素**，不含数据获取，不违反「单棵内容树」——受约束的是有副作用的组件。

- [ ] **Step 1: 实现 `RecordList`**

Create `src/components/ui/RecordList.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RecordColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** 手机卡片上作为标题行显示（通常是交易对 / 名称） */
  primary?: boolean;
  /** 手机上完全不显示这一列 */
  hideOnMobile?: boolean;
}

interface RecordListProps<T> {
  rows: T[];
  columns: RecordColumn<T>[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

export function RecordList<T>({ rows, columns, rowKey, empty, onRowClick }: RecordListProps<T>) {
  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-text-muted">{empty ?? "—"}</div>;
  }

  const primary = columns.find((c) => c.primary);
  const details = columns.filter((c) => !c.primary && !c.hideOnMobile);

  return (
    <>
      {/* 手机：每行一张卡。不做横向滚动的表格——那在手机上是伪适配 */}
      <ul className="divide-y divide-border-default border-y border-border-default lg:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn("px-1 py-3.5", onRowClick && "cursor-pointer active:bg-bg-tertiary")}
          >
            {primary && (
              <div className="mb-2 text-sm text-text-primary">{primary.render(row)}</div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {details.map((col) => (
                <div key={col.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-text-muted">{col.header}</dt>
                  <dd className="text-xs text-text-secondary">{col.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* 桌面：常规表格 */}
      <table className="hidden w-full lg:table">
        <thead>
          <tr className="border-b border-border-default">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-3 py-2 text-xs font-normal text-text-muted",
                  col.align === "right" ? "text-right" : "text-left"
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border-default/60",
                onRowClick && "cursor-pointer hover:bg-bg-tertiary"
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-3 py-2.5 text-sm text-text-secondary",
                    col.align === "right" ? "text-right" : "text-left"
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 提交**

```bash
git add src/components/ui/RecordList.tsx
git commit -m "feat(ui): add RecordList for table-to-card responsive records"
```

---

### Task 3: 交易页 —— 消除双挂载

**Files:**
- Modify: `src/app/[locale]/trade/page.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 单棵内容树的交易页

现在这一页同时挂载了桌面版（`hidden … lg:flex`）和手机版（`flex … lg:hidden`）两套布局，只用 CSS 切换显示。后果写在 [useUserDataStream.ts](../../../src/hooks/useUserDataStream.ts) 的注释里：两份 `FuturesInfoPanel` / `OrdersPanel` 同时调 `useUserDataStream`，不得不加引用计数来防止建两条 BingX WebSocket。本任务把内容树合并成一棵，让引用计数回归「多个不同组件共享连接」的正常用途。

- [ ] **Step 1: 提取共用的图表区块**

在 `src/app/[locale]/trade/page.tsx` 的 `TradePage` 组件内、`return` 之前加入：

```tsx
  // 桌面与手机共用同一个图表实例。此前两套布局各挂一个 KlineChart，
  // 等于同时跑两份 lightweight-charts 画布和两份 kline 订阅。
  const chartBlock = (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center border-b border-border-default">
        <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
        <div className="ml-auto pr-2">
          <FearGreedIndex compact />
        </div>
      </div>
      <div className="flex-1">
        <KlineChart
          symbol={symbol}
          interval={interval}
          className="h-full"
          tradeMarkers={tradeMarkers}
          priceLines={priceLines}
        />
      </div>
    </div>
  );
```

- [ ] **Step 2: 桌面布局改用共用图表区块**

把桌面 `PanelGroup` 中 `<Panel defaultSize={65} minSize={30}>` 的整个内容（即那段重复的 `<div className="flex h-full flex-col overflow-hidden">…</div>`）替换为 `{chartBlock}`：

```tsx
              <Panel defaultSize={65} minSize={30}>
                {chartBlock}
              </Panel>
```

- [ ] **Step 3: 删除手机版的三 Tab 布局整块**

删除 `{/* Mobile layout: tab-switched single column */}` 注释开始、到对应 `</div>` 结束的整块（原第 455–501 行），以及 `mobileTab` 的 state 声明：

```tsx
  const [mobileTab, setMobileTab] = useState<"chart" | "trade" | "book">("chart");
```

Task 4 会用新的手机布局替代它。

- [ ] **Step 4: 暂时用共用图表区块占位，确认无双挂载**

在删除的位置插入临时占位，使页面在手机上仍可用：

```tsx
      {/* 手机布局：图表全屏，操作条与 sheet 在 Task 4 接入 */}
      <div className="flex flex-1 flex-col overflow-hidden lg:hidden">{chartBlock}</div>
```

> 注意：此时 `chartBlock` 在桌面树与手机树中各出现一次，但两者互斥（`hidden lg:flex` vs `lg:hidden`），**React 仍会挂载两次**。Task 4 会把手机树改成条件渲染以彻底消除。本步只是让页面保持可运行，不是最终形态。

- [ ] **Step 5: 构建验证**

Run: `npm run build`
Expected: 构建成功。若报 `mobileTab is not defined`，说明还有残留引用，一并删除。

- [ ] **Step 6: 提交**

```bash
git add "src/app/[locale]/trade/page.tsx"
git commit -m "refactor(trade): extract shared chart block and drop mobile sub-tab layout"
```

---

### Task 4: 交易页 —— 底部操作条与下单 sheet

**Files:**
- Create: `src/app/[locale]/trade/MobileTradeBar.tsx`
- Modify: `src/app/[locale]/trade/page.tsx`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: `Modal` 的 `variant="sheet"`（Task 1）
- Produces: `<MobileTradeBar onBuy onSell onToggleBook onTogglePositions bookOpen positionCount />`

- [ ] **Step 1: 往三个 message 文件的 `trade` 命名空间加入手机端文案**

`src/i18n/messages/zh-CN.json` 的 `"trade"` 对象内追加：

```json
    "mobile_buy": "买入",
    "mobile_sell": "卖出",
    "mobile_book": "盘口",
    "mobile_positions": "持仓",
    "mobile_order_sheet": "下单",
    "mobile_symbol_picker": "选择交易对"
```

`src/i18n/messages/en-US.json`：

```json
    "mobile_buy": "Buy",
    "mobile_sell": "Sell",
    "mobile_book": "Book",
    "mobile_positions": "Positions",
    "mobile_order_sheet": "Place order",
    "mobile_symbol_picker": "Select pair"
```

`src/i18n/messages/ms-MY.json`：

```json
    "mobile_buy": "Beli",
    "mobile_sell": "Jual",
    "mobile_book": "Buku",
    "mobile_positions": "Posisi",
    "mobile_order_sheet": "Buat pesanan",
    "mobile_symbol_picker": "Pilih pasangan"
```

- [ ] **Step 2: 实现底部操作条**

Create `src/app/[locale]/trade/MobileTradeBar.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function MobileTradeBar({
  onBuy,
  onSell,
  onTogglePositions,
  onToggleBook,
  bookOpen,
  positionsOpen,
}: {
  onBuy: () => void;
  onSell: () => void;
  onTogglePositions: () => void;
  onToggleBook: () => void;
  bookOpen: boolean;
  positionsOpen: boolean;
}) {
  const t = useTranslations("trade");

  return (
    <div className="shrink-0 border-t border-border-default bg-bg-secondary lg:hidden">
      <div className="flex items-stretch divide-x divide-border-default">
        <button
          onClick={onTogglePositions}
          className={cn(
            "min-h-[44px] flex-1 px-3 text-xs transition-colors",
            positionsOpen ? "text-gold" : "text-text-secondary"
          )}
        >
          {t("mobile_positions")}
        </button>
        <button
          onClick={onToggleBook}
          className={cn(
            "min-h-[44px] flex-1 px-3 text-xs transition-colors",
            bookOpen ? "text-gold" : "text-text-secondary"
          )}
        >
          {t("mobile_book")}
        </button>
      </div>

      <div className="flex gap-2 border-t border-border-default p-2">
        <button
          onClick={onBuy}
          className="min-h-[48px] flex-1 rounded-sm bg-success/12 text-sm font-semibold text-success transition-colors active:bg-success/20"
        >
          {t("mobile_buy")}
        </button>
        <button
          onClick={onSell}
          className="min-h-[48px] flex-1 rounded-sm bg-danger/12 text-sm font-semibold text-danger transition-colors active:bg-danger/20"
        >
          {t("mobile_sell")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 在交易页接入手机布局**

在 `src/app/[locale]/trade/page.tsx` 顶部加入 import：

```tsx
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { MobileTradeBar } from "./MobileTradeBar";
```

在 `TradePage` 内加入 state：

```tsx
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [positionsSheetOpen, setPositionsSheetOpen] = useState(false);
  const [bookOverlayOpen, setBookOverlayOpen] = useState(false);
  // 用 JS 断点做「挂载哪一棵树」的决定，才能真正避免双挂载。
  // 仅用于外壳选择，SSR 阶段返回 false（先按手机渲染，避免桌面首屏闪大布局）
  const isDesktop = useMediaQuery("(min-width: 1024px)");
```

把 Task 3 Step 4 留下的临时占位替换为：

```tsx
      {!isDesktop && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
            {chartBlock}
            {bookOverlayOpen && (
              // 订单簿做成图表上的叠层，而不是抢一个 tab
              <div className="absolute inset-y-0 right-0 w-[62%] border-l border-border-default bg-bg-primary/95 backdrop-blur-sm">
                <OrderBook symbol={symbol} onPriceClick={handleOrderBookPriceClick} />
              </div>
            )}
          </div>

          <MobileTradeBar
            onBuy={() => {
              setInitialSide("long");
              setOrderSheetOpen(true);
            }}
            onSell={() => {
              setInitialSide("short");
              setOrderSheetOpen(true);
            }}
            onTogglePositions={() => setPositionsSheetOpen((v) => !v)}
            onToggleBook={() => setBookOverlayOpen((v) => !v)}
            bookOpen={bookOverlayOpen}
            positionsOpen={positionsSheetOpen}
          />
        </div>
      )}

      <Modal
        open={orderSheetOpen}
        onClose={() => setOrderSheetOpen(false)}
        title={t("mobile_order_sheet")}
        variant="sheet"
      >
        <div className="-m-6">
          {tradePanel}
          {market === "futures" && <FuturesWalletSummary />}
        </div>
      </Modal>

      <Modal
        open={positionsSheetOpen}
        onClose={() => setPositionsSheetOpen(false)}
        title={t("mobile_positions")}
        variant="sheet"
      >
        <div className="-m-6 min-h-[40dvh]">{ordersPanel}</div>
      </Modal>
```

把桌面布局的外层 `<div className="hidden flex-1 overflow-hidden lg:flex">` 改成条件渲染：

```tsx
      {isDesktop && (
        <div className="flex flex-1 overflow-hidden">
```

（对应的闭合标签由 `</div>` 改为 `</div>\n      )}`。）

并在 `TradePage` 顶部取得 `trade` 命名空间的翻译函数：

```tsx
  const t = useTranslations("trade");
```

- [ ] **Step 4: 新建 `useMediaQuery` hook**

Create `src/hooks/useMediaQuery.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * 仅用于「挂载哪一套外壳」这类决定——内容不该靠它分叉。
 *
 * 交易页是唯一需要它的地方：桌面的 4 栏可拖拽布局和手机的全屏图表布局
 * 结构差异太大，用 CSS 同时挂载会导致 KlineChart、OrdersPanel 等
 * 带副作用的组件各跑两份（这正是 useUserDataStream 引用计数的由来）。
 *
 * SSR 阶段返回 false：先按手机渲染再在客户端修正，比反过来更安全——
 * 手机布局在宽屏上只是显得空旷，桌面布局在窄屏上会直接溢出。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
```

- [ ] **Step 5: 手机端 ticker 行改用 sheet 选币**

把页面底部原有的手机选币 Modal 改成 sheet 形态：

```tsx
      <Modal
        open={symbolPickerOpen}
        onClose={() => setSymbolPickerOpen(false)}
        title={t("mobile_symbol_picker")}
        size="sm"
        variant="sheet"
        className="lg:hidden"
      >
        <div className="-m-6 h-[70dvh]">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </div>
      </Modal>
```

同时把 `TickerBar` 内写死的中文 `切换 ▾` 换成 `t("mobile_symbol_picker")`，并把 `模拟盘` 保持原样（该文案已存在于现有实现中，不在本次改动范围）。

- [ ] **Step 6: 页面高度改用 dvh**

把 `TradePage` 的最外层 div：

```tsx
    <div className="flex h-[calc(100vh-4rem)] flex-col">
```

改为：

```tsx
    // 手机上 100vh 会被 Safari 的地址栏高度算错，用 dvh；
    // 底部还要给 L1 的 tab bar 让位
    <div className="flex h-[calc(100dvh-3rem-70px)] flex-col lg:h-[calc(100dvh-4rem)]">
```

- [ ] **Step 7: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 8: 验证不再双挂载**

Run: `npm run dev`，在浏览器中打开 `/zh-CN/trade`，宽度设为 1440px，打开 DevTools 的 Elements 面板搜索 `canvas`。
Expected: 页面中只有一个 lightweight-charts 的 canvas 容器。窄屏（390px）下同样只有一个。

- [ ] **Step 9: 提交**

```bash
git add "src/app/[locale]/trade/MobileTradeBar.tsx" "src/app/[locale]/trade/page.tsx" \
  src/hooks/useMediaQuery.ts src/i18n/messages/zh-CN.json \
  src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(trade): full-screen mobile chart with action bar and order sheet"
```

---

### Task 5: 交易页 —— 触摸目标补齐

**Files:**
- Modify: `src/components/trade/order-form/fields/LeverageField.tsx`
- Modify: `src/app/[locale]/trade/page.tsx`（`IntervalBar` 部分）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 放大杠杆快捷按钮**

在 `src/components/trade/order-form/fields/LeverageField.tsx` 中，把杠杆快捷按钮的 `py-0.5` 改为 `min-h-[44px] lg:min-h-0 lg:py-0.5`，并把 `text-xs` 改为 `text-xs lg:text-xs`（输入框的 16px 规则已由 L0 的全局 CSS 覆盖，此处只需放大按钮命中区）。

具体地，把：

```tsx
                "flex-1 rounded-xs py-1 text-xs disabled:opacity-50",
```

改为：

```tsx
                "min-h-[44px] flex-1 rounded-xs text-xs disabled:opacity-50 lg:min-h-0 lg:py-1",
```

以及把：

```tsx
              className={cn(
                "rounded-xs py-0.5 text-xs font-medium disabled:opacity-50",
```

改为：

```tsx
              className={cn(
                "min-h-[44px] rounded-xs text-xs font-medium disabled:opacity-50 lg:min-h-0 lg:py-0.5",
```

- [ ] **Step 2: 放大时间周期按钮**

在 `src/app/[locale]/trade/page.tsx` 的 `IntervalBar` 中，把每个周期按钮的 className 加上 `min-h-[44px] lg:min-h-0`，并把按钮容器改为 `overflow-x-auto` 以便在窄屏横向滚动（周期最多 14 个，一行放不下）。

- [ ] **Step 3: 目视验证**

Run: `npm run dev`，浏览器切到 iPhone 14 Pro 模拟尺寸，打开 `/zh-CN/trade` 并弹出下单 sheet。
Expected: 杠杆按钮与周期按钮的可点击高度不小于 44px；周期栏可以横向滑动。

- [ ] **Step 4: 提交**

```bash
git add src/components/trade/order-form/fields/LeverageField.tsx "src/app/[locale]/trade/page.tsx"
git commit -m "fix(trade): enlarge leverage and interval touch targets on mobile"
```

---

### Task 6: `/settings` 移动化

**Files:**
- Modify: `src/app/[locale]/settings/page.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无

该页目前 **0 个响应式工具类**，等于完全没适配过。

- [ ] **Step 1: 阅读现状**

Run: `cat "src/app/[locale]/settings/page.tsx"`

记录页面的分组结构（个人资料 / 语言 / BingX API 密钥 等）与每组使用的容器类名。

- [ ] **Step 2: 容器改为单列自适应**

把页面最外层容器改为：

```tsx
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
```

把所有形如 `grid grid-cols-2`、`flex items-center justify-between` 且内含表单控件的行，改为 `flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between`。

- [ ] **Step 3: API 密钥字段做窄屏处理**

BingX API Key / Secret 是长字符串，在窄屏会撑破布局。给显示密钥的元素加上：

```tsx
className="break-all font-mono text-xs text-text-secondary"
```

给输入框加上 `w-full`，并确保外层没有固定宽度。

- [ ] **Step 4: 按钮组改为纵向堆叠**

把形如 `<div className="flex gap-3">` 的按钮组改为 `<div className="flex flex-col gap-3 sm:flex-row">`，并给按钮加 `w-full sm:w-auto`。

- [ ] **Step 5: 目视验证**

Run: `npm run dev`，在 390px 宽度下打开 `/zh-CN/settings`。
Expected: 无横向滚动条；所有输入框可完整看到；API 密钥字符串换行而非溢出；按钮全宽堆叠。

在 1440px 下再看一遍。
Expected: 与改动前视觉一致。

- [ ] **Step 6: 提交**

```bash
git add "src/app/[locale]/settings/page.tsx"
git commit -m "feat(settings): make the settings page usable on mobile"
```

---

### Task 7: `/orders` 移动化

**Files:**
- Modify: `src/app/[locale]/orders/page.tsx`

**Interfaces:**
- Consumes: `RecordList` from `@/components/ui/RecordList`（Task 2）
- Produces: 无

该页目前 **0 个响应式工具类**，且核心是一张宽表格。

- [ ] **Step 1: 阅读现状**

Run: `cat "src/app/[locale]/orders/page.tsx"`

记录表格的列定义、每列的取值与格式化方式、行的唯一键。

- [ ] **Step 2: 把表格替换为 `RecordList`**

按现有列构造 `columns`，把交易对设为 `primary`，把次要列（如手续费、订单 ID）设为 `hideOnMobile`。示例形状：

```tsx
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";

const columns: RecordColumn<OrderRow>[] = [
  { key: "symbol", header: t("symbol"), primary: true, render: (o) => o.symbol },
  { key: "side", header: t("side"), render: (o) => (
      <span className={o.side === "BUY" ? "text-success" : "text-danger"}>{o.side}</span>
    ) },
  { key: "price", header: t("price"), align: "right", render: (o) => (
      <span className="font-mono">{formatPrice(o.price)}</span>
    ) },
  { key: "qty", header: t("quantity"), align: "right", render: (o) => (
      <span className="font-mono">{formatNumber(o.quantity)}</span>
    ) },
  { key: "time", header: t("time"), render: (o) => formatDateTime(o.createdAt) },
  { key: "fee", header: t("fee"), align: "right", hideOnMobile: true, render: (o) => (
      <span className="font-mono">{formatNumber(o.fee)}</span>
    ) },
];
```

把原来的 `<table>…</table>` 整块替换为：

```tsx
<RecordList rows={orders} columns={columns} rowKey={(o) => o.id} empty={t("no_orders")} />
```

字段名以该页现有的数据结构为准，不要照抄上面的示例名称。

- [ ] **Step 3: 容器与筛选控件适配**

外层容器改为 `mx-auto max-w-7xl px-4 py-6 lg:py-12`；若有筛选下拉/日期选择，改为 `flex flex-col gap-2 sm:flex-row sm:items-center`。

- [ ] **Step 4: 目视验证**

Run: `npm run dev`，在 390px 下打开 `/zh-CN/orders`。
Expected: 每条订单一张卡；无横向滚动；金额与数量用等宽字体对齐。1440px 下仍为表格且与改动前一致。

- [ ] **Step 5: 提交**

```bash
git add "src/app/[locale]/orders/page.tsx"
git commit -m "feat(orders): render order history as cards on mobile"
```

---

### Task 8: `/screener` 移动化

**Files:**
- Modify: `src/app/[locale]/screener/page.tsx`
- Modify: `src/components/screener/*`（按实际组件名）

**Interfaces:**
- Consumes: `RecordList`、`Modal` 的 `variant="sheet"`
- Produces: 无

- [ ] **Step 1: 阅读现状**

Run: `ls src/components/screener && cat "src/app/[locale]/screener/page.tsx"`

- [ ] **Step 2: 两组榜单在手机上纵向堆叠**

把「做多优势 / 做空优势」的左右并排容器改为：

```tsx
<div className="grid gap-8 lg:grid-cols-2">
```

- [ ] **Step 3: 榜单表格改用 `RecordList`**

把币种设为 `primary`，把评分与方向优势设为常规列，把成交量/持仓量比等次要维度设为 `hideOnMobile`。

- [ ] **Step 4: 说明面板收进 sheet**

现有的「评分与优势说明」面板在手机上占据大量首屏空间。改为一个「说明」按钮，点击后用 `<Modal variant="sheet">` 弹出：

```tsx
<button
  onClick={() => setGuideOpen(true)}
  className="min-h-[44px] text-xs text-gold lg:hidden"
>
  {t("guide_title")}
</button>
```

桌面保持原有的常驻面板（`hidden lg:block`）。

- [ ] **Step 5: 目视验证**

Run: `npm run dev`，390px 下打开 `/zh-CN/screener`。
Expected: 两组榜单上下排列；每个币一张卡；说明面板通过按钮弹出；无横向滚动。

- [ ] **Step 6: 提交**

```bash
git add "src/app/[locale]/screener/page.tsx" src/components/screener
git commit -m "feat(screener): stack lists and card-ify results on mobile"
```

---

### Task 9: `/dashboard` 移动化

**Files:**
- Modify: `src/app/[locale]/dashboard/page.tsx`
- Modify: `src/components/dashboard/*`（按实际组件名）

**Interfaces:**
- Consumes: `RecordList`
- Produces: 无

- [ ] **Step 1: 阅读现状**

Run: `ls src/components/dashboard && cat "src/app/[locale]/dashboard/page.tsx"`

- [ ] **Step 2: 主网格改为单列优先**

把形如 `grid grid-cols-3` / `grid-cols-2` 的主布局改为 `grid gap-6 lg:grid-cols-3`（移动端默认单列）。

- [ ] **Step 3: 统计数字块改为两列**

学习进度、模拟盘战绩这类小数字块在手机上单列太空旷，改为 `grid grid-cols-2 gap-3 lg:grid-cols-4`。

- [ ] **Step 4: 战绩表改用 `RecordList`**

把模拟盘战绩表的 `<table>` 替换为 `RecordList`，把交易对设为 `primary`，把盈亏设为带涨跌配色的常规列，把开仓时间等次要字段设为 `hideOnMobile`：

```tsx
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";

const columns: RecordColumn<TradeRow>[] = [
  { key: "symbol", header: t("symbol"), primary: true, render: (r) => r.symbol },
  { key: "pnl", header: t("pnl"), align: "right", render: (r) => (
      <span className={cn("font-mono", r.pnl >= 0 ? "text-success" : "text-danger")}>
        {formatNumber(r.pnl)}
      </span>
    ) },
  { key: "side", header: t("side"), render: (r) => r.side },
  { key: "openedAt", header: t("opened_at"), hideOnMobile: true, render: (r) => formatDateTime(r.openedAt) },
];
```

字段名以该页现有的数据结构为准，不要照抄示例名称。

- [ ] **Step 5: 自选行情列表适配**

行情行改为 `flex items-baseline justify-between`，价格与涨跌幅用 `font-mono` 右对齐。

- [ ] **Step 6: 目视验证**

Run: `npm run dev`，390px 下打开 `/zh-CN/dashboard`。
Expected: 内容单列流动；统计块两列；无横向滚动；底部内容不被 tab bar 遮挡。

- [ ] **Step 7: 提交**

```bash
git add "src/app/[locale]/dashboard/page.tsx" src/components/dashboard
git commit -m "feat(dashboard): single-column mobile layout with card records"
```

---

### Task 10: 内容页阅读排版

**Files:**
- Modify: `src/app/[locale]/videos/page.tsx` 及详情页
- Modify: `src/app/[locale]/articles/page.tsx` 及详情页
- Modify: `src/app/[locale]/news/page.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 列表页卡片网格适配**

三个列表页的网格统一改为：

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
```

移动端单列，卡片图片用 `aspect-video w-full object-cover`。

- [ ] **Step 2: 详情页正文排版**

文章与视频详情页的正文容器改为：

```tsx
<article className="mx-auto max-w-[68ch] px-4 py-6 text-[15px] leading-[1.75] lg:py-12 lg:text-base">
```

`max-w-[68ch]` 对应 [DESIGN.md](../../../DESIGN.md) 里 65–75ch 的行宽约定；手机上 15px 比 16px 更适合 CJK 长文，但**不影响输入框的 16px 下限**（那条只作用于 `input/select/textarea`）。

- [ ] **Step 3: 视频播放器容器适配**

播放器外层改为 `aspect-video w-full`，去掉任何固定像素宽高。

- [ ] **Step 4: 目视验证**

Run: `npm run dev`，390px 下逐一打开 `/zh-CN/videos`、任一视频详情、`/zh-CN/articles`、任一文章详情、`/zh-CN/news`。
Expected: 单列卡片；正文行宽舒适不贴边；视频播放器按 16:9 自适应；无横向滚动。

- [ ] **Step 5: 提交**

```bash
git add "src/app/[locale]/videos" "src/app/[locale]/articles" "src/app/[locale]/news"
git commit -m "feat(content): mobile reading layout for videos, articles and news"
```

---

### Task 11: 转化面移动化（首页 / 登录注册 / 升级）

**Files:**
- Modify: `src/app/[locale]/HomeClient.tsx`
- Modify: `src/app/[locale]/HotCoinsRail.tsx`
- Modify: `src/app/[locale]/login/page.tsx`
- Modify: `src/app/[locale]/register/page.tsx`
- Modify: `src/app/[locale]/forgot-password/page.tsx`
- Modify: `src/app/[locale]/upgrade/page.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无

首页是 Persuade 面，**不能简单堆成一列就算完**——那会毁掉 [DESIGN.md](../../../DESIGN.md) 定义的编辑式调性。

- [ ] **Step 1: 首页英雄区**

`clamp(2.75rem, 9vw, 6rem)` 的标题本身已能自适应，无需改动。检查并调整：

- 英雄区高度由 `100vh` 改为 `100dvh`
- 背景的大号 "IX" 水印在窄屏上会溢出，加 `overflow-hidden` 到其容器
- 主次 CTA 由横排改为 `flex flex-col gap-3 sm:flex-row`，按钮加 `w-full sm:w-auto`

- [ ] **Step 2: 信任区左右分栏重排**

粘性标题 + 台账列表的左右分栏改为：

```tsx
<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-16">
```

手机上标题在上、列表在下，**保留发丝金分隔线**作为分区手段，不要退化成卡片。粘性行为只在 `lg` 以上启用：把 `sticky top-24` 改为 `lg:sticky lg:top-24`。

- [ ] **Step 3: 行情条横向滚动**

`HotCoinsRail` 在窄屏放不下四个币种，容器加：

```tsx
className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
```

每个币种块加 `shrink-0`，保留发丝竖线分隔。

- [ ] **Step 4: 登录/注册/忘记密码**

三页容器统一为：

```tsx
<div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
```

表单控件加 `w-full`；提交按钮加 `w-full`。

- [ ] **Step 5: 升级页定价卡**

定价卡容器由横排改为：

```tsx
<div className="grid gap-4 sm:grid-cols-2">
```

- [ ] **Step 6: 三语目视验证**

Run: `npm run dev`，390px 下逐一打开三种语言的 `/`、`/login`、`/register`、`/upgrade`。
Expected: 首页第一屏标题不溢出、CTA 全宽堆叠、行情条可横滑；表单页无横向滚动；三语下按钮文字均不截断（马来语最长）。

1440px 下再看一遍首页。
Expected: 与改动前视觉一致，分栏、粘性标题、行情条均保持原样。

- [ ] **Step 7: 提交**

```bash
git add "src/app/[locale]/HomeClient.tsx" "src/app/[locale]/HotCoinsRail.tsx" \
  "src/app/[locale]/login" "src/app/[locale]/register" \
  "src/app/[locale]/forgot-password" "src/app/[locale]/upgrade"
git commit -m "feat(persuade): mobile layouts for home, auth and upgrade pages"
```

---

### Task 12: 离线时禁用交易操作

**Files:**
- Create: `src/hooks/useOnlineStatus.ts`
- Modify: `src/components/trade/order-form/OrderForm.tsx`
- Modify: `src/app/[locale]/trade/MobileTradeBar.tsx`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: 无
- Produces: `useOnlineStatus(): boolean`

这是整份设计中失败模式最严重的一处：离线时 `/api` 请求会失败，而「转圈」「静默无反应」「看不懂的报错」都可能让用户以为单已下出。

- [ ] **Step 1: 往三个 message 文件的 `trade` 命名空间加入离线文案**

`zh-CN`：`"offline_disabled": "当前离线，无法下单"`
`en-US`：`"offline_disabled": "You're offline — orders can't be placed"`
`ms-MY`：`"offline_disabled": "Anda luar talian — pesanan tidak boleh dibuat"`

- [ ] **Step 2: 实现 hook**

Create `src/hooks/useOnlineStatus.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * 离线时交易类按钮必须明确禁用并说明原因。
 * 让用户以为单下出去了，是这套系统最坏的失败模式。
 */
export function useOnlineStatus(): boolean {
  // SSR 与首帧一律按在线处理，避免正常用户看到一闪而过的离线提示
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
```

- [ ] **Step 3: 在下单表单中接入**

在 `src/components/trade/order-form/OrderForm.tsx` 中加入：

```tsx
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
```

在组件内取值：

```tsx
  const online = useOnlineStatus();
```

把提交按钮的 `disabled` 条件并上 `|| !online`，并在按钮上方插入提示：

```tsx
      {!online && (
        <p className="mb-2 rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
          {t("offline_disabled")}
        </p>
      )}
```

- [ ] **Step 4: 在手机操作条中接入**

在 `MobileTradeBar.tsx` 中同样取 `useOnlineStatus()`，给买入/卖出按钮加上 `disabled={!online}` 与 `disabled:opacity-40`。

- [ ] **Step 5: 让 SW 更新提示避开下单流程**

L0 的 `UpdateBanner` 读 `usePwaStore` 的 `hasPendingOrder`，但目前没有任何地方写它——补上这个写入点，否则「交易页有未确认订单时不弹更新提示」这条保护形同虚设。

在 `src/components/trade/order-form/OrderForm.tsx` 中加入 import：

```tsx
import { usePwaStore } from "@/stores/pwa";
```

在组件内取 setter，并在提交流程的开始与结束处标记：

```tsx
  const setHasPendingOrder = usePwaStore((s) => s.setHasPendingOrder);
```

在下单提交的 `try` 之前置位、`finally` 中复位：

```tsx
    setHasPendingOrder(true);
    try {
      // …现有的下单逻辑…
    } finally {
      setHasPendingOrder(false);
    }
```

并在组件卸载时兜底复位，避免下单过程中路由跳走导致标记永久卡住：

```tsx
  useEffect(() => () => setHasPendingOrder(false), [setHasPendingOrder]);
```

- [ ] **Step 6: 验证**

Run: `npm run dev`，打开 `/zh-CN/trade`，在 DevTools 的 Network 面板切到 Offline。
Expected: 下单按钮变灰不可点；表单上方出现橙色离线提示；手机操作条的买入/卖出同样禁用。切回 Online 后恢复。

- [ ] **Step 7: 全量测试与构建**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 8: 提交**

```bash
git add src/hooks/useOnlineStatus.ts src/components/trade/order-form/OrderForm.tsx \
  "src/app/[locale]/trade/MobileTradeBar.tsx" src/i18n/messages/zh-CN.json \
  src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(trade): disable order actions while offline and gate SW update prompt"
```

---

## 验收清单

在 390px（iPhone 14 Pro）与 1440px 两个宽度下逐项确认。

**通用**
- [ ] 所有页面在 390px 下无横向滚动条
- [ ] 所有页面底部内容不被 tab bar 或中央凸起遮挡
- [ ] 任意输入框聚焦时页面不放大（iOS 真机）
- [ ] 1440px 下所有页面与改动前视觉一致

**交易页**
- [ ] 窄屏与宽屏各自只挂载一个 KlineChart canvas（DevTools 搜索确认）
- [ ] 手机上图表占据主要空间，无子 tab 栏
- [ ] 点「买入」弹出下单 sheet 且方向预设为多，点「卖出」预设为空
- [ ] 下单 sheet 打开时底部 tab bar 隐藏
- [ ] 「盘口」按钮切换图表右侧的订单簿叠层，点击价格可回填到表单
- [ ] 「持仓」按钮上拉展开持仓/挂单 sheet
- [ ] 杠杆与时间周期按钮命中区不小于 44px
- [ ] 离线时买入/卖出与下单按钮禁用并给出说明

**记录类页面**
- [ ] `/orders` 手机上每条一张卡，桌面上仍是表格
- [ ] `/screener` 两组榜单纵向堆叠，说明面板通过 sheet 弹出
- [ ] `/dashboard` 单列流动，统计块两列

**转化面**
- [ ] 首页第一屏标题不溢出，CTA 全宽堆叠，行情条可横滑
- [ ] 首页信任区在手机上仍以发丝金线分区，未退化成卡片堆叠
- [ ] 三语下所有按钮文字不截断（重点检查马来语）
