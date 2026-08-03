# 移动导航壳（L1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给手机端补上完整的导航——底部 tab bar、精简 header、`/more` 聚合页——填掉「手机上根本没有导航菜单」这个洞。

**Architecture:** 遵循「单棵内容树，双套外壳」：导航外壳是静态、无副作用的，因此允许桌面版 `Navbar` 与手机版 tab bar 用 CSS 断点同时挂载；页面内容不做任何双份渲染。`/more` 做成真实路由而非抽屉，以便参与浏览器历史。

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS 3 · next-intl 4 · zustand 5 · vitest 3

**Spec:** [2026-08-04-mobile-pwa-design.md](../specs/2026-08-04-mobile-pwa-design.md)
**Depends on:** L0（`pb-tabbar` / `safe-*` 间距令牌来自 L0 Task 1）

## Global Constraints

- 沿用现有技术栈，**不引入任何新依赖**。
- 三语并存：`zh-CN` / `en-US` / `ms-MY`。任何新增文案必须同时写入三个 message 文件。
- 设计令牌以 [DESIGN.md](../../../DESIGN.md) 为准：底色 `#0B0A08`、次级底 `#14120E`、金 `#C9A24B`、主文本 `#F5F0E6`、次文本 `#A89F8C`、弱文本 `#6E675A`、描边 `#2C271C`。
- 断点：手机壳在 `<lg`（1024px）生效，桌面 `Navbar` 在 `lg` 及以上生效。二者互斥。
- 触摸目标最小 44×44 px（iOS HIG）。
- **桌面版布局与交互不得有任何可见变化。**
- vitest 的 `include` 只覆盖 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts`，新测试必须落在这两个目录下；`environment: "node"`，需单测的逻辑必须是接受普通入参的纯函数。
- 新增注释用中文，解释「为什么」而非「做了什么」。
- 每个任务结束时提交一次，commit message 用英文、遵循 conventional commits。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/lib/nav/tabs.ts` | tab 定义 + `resolveActiveTab` 纯函数 + `buildMoreEntries` 纯函数 |
| `src/lib/nav/tabs.test.ts` | 上者的单测 |
| `src/components/layout/MobileTabBar.tsx` | 底部导航条（4 常规 tab + 1 中央凸起） |
| `src/components/layout/MobileHeader.tsx` | 手机端精简 header |
| `src/components/layout/MobileShell.tsx` | 把 header + tab bar 组合起来，并处理键盘避让 |
| `src/app/[locale]/more/page.tsx` | `更多` 聚合页 |
| `src/app/[locale]/learn/LearnHub.tsx` | 学习中心的三分区入口 |

---

### Task 1: 导航数据与纯函数

**Files:**
- Create: `src/lib/nav/tabs.ts`
- Test: `src/lib/nav/tabs.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type TabKey = "dashboard" | "learn" | "trade" | "screener" | "more"`
  - `const MOBILE_TABS: { key: TabKey; href: (locale: string) => string; center: boolean }[]`
  - `function resolveActiveTab(pathname: string, locale: string): TabKey | null`
  - `type MoreEntry = { key: string; href: string; external?: boolean }`
  - `function buildMoreEntries(input: { locale: string; tier: string | null; role: string | null }): MoreEntry[]`

- [ ] **Step 1: 写失败的测试**

Create `src/lib/nav/tabs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MOBILE_TABS, resolveActiveTab, buildMoreEntries } from "./tabs";

describe("MOBILE_TABS", () => {
  it("共 5 个位置，交易在正中间且标记为凸起", () => {
    expect(MOBILE_TABS).toHaveLength(5);
    expect(MOBILE_TABS[2].key).toBe("trade");
    expect(MOBILE_TABS[2].center).toBe(true);
    expect(MOBILE_TABS.filter((t) => t.center)).toHaveLength(1);
  });

  it("链接带上语言前缀", () => {
    expect(MOBILE_TABS.map((t) => t.href("ms-MY"))).toEqual([
      "/ms-MY/dashboard",
      "/ms-MY/learn",
      "/ms-MY/trade",
      "/ms-MY/screener",
      "/ms-MY/more",
    ]);
  });
});

describe("resolveActiveTab", () => {
  it("精确匹配 tab 自身的路由", () => {
    expect(resolveActiveTab("/zh-CN/trade", "zh-CN")).toBe("trade");
    expect(resolveActiveTab("/zh-CN/screener", "zh-CN")).toBe("screener");
  });

  it("子路由归属于父 tab", () => {
    expect(resolveActiveTab("/zh-CN/learn/basics", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/en-US/more/alerts", "en-US")).toBe("more");
  });

  it("学习 tab 收编视频与文章", () => {
    expect(resolveActiveTab("/zh-CN/videos", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/videos/abc-123", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/articles/hello", "zh-CN")).toBe("learn");
  });

  it("更多 tab 收编资讯、订单、设置、升级", () => {
    expect(resolveActiveTab("/zh-CN/news", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/orders", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/settings", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/upgrade", "zh-CN")).toBe("more");
  });

  it("语言首页和未收编的路由不点亮任何 tab", () => {
    expect(resolveActiveTab("/zh-CN", "zh-CN")).toBeNull();
    expect(resolveActiveTab("/zh-CN/login", "zh-CN")).toBeNull();
    expect(resolveActiveTab("/zh-CN/offline", "zh-CN")).toBeNull();
  });

  it("路径的语言前缀与当前语言不一致时不做匹配", () => {
    expect(resolveActiveTab("/en-US/trade", "zh-CN")).toBeNull();
  });

  it("能容忍结尾的斜杠", () => {
    expect(resolveActiveTab("/zh-CN/trade/", "zh-CN")).toBe("trade");
  });
});

describe("buildMoreEntries", () => {
  const base = { locale: "zh-CN", tier: "free", role: "user" };

  it("免费用户能看到升级入口", () => {
    const keys = buildMoreEntries(base).map((e) => e.key);
    expect(keys).toContain("upgrade");
  });

  it("Pro 用户不显示升级入口", () => {
    const keys = buildMoreEntries({ ...base, tier: "pro" }).map((e) => e.key);
    expect(keys).not.toContain("upgrade");
  });

  it("非管理员看不到后台入口", () => {
    expect(buildMoreEntries(base).map((e) => e.key)).not.toContain("admin");
  });

  it("管理员能看到后台入口，且不带语言前缀", () => {
    const entries = buildMoreEntries({ ...base, role: "admin" });
    const admin = entries.find((e) => e.key === "admin");
    expect(admin).toBeDefined();
    expect(admin?.href).toBe("/admin");
  });

  it("常规入口按既定顺序排列并带语言前缀", () => {
    const entries = buildMoreEntries({ locale: "ms-MY", tier: "pro", role: "user" });
    expect(entries.map((e) => e.key)).toEqual([
      "news",
      "orders",
      "alerts",
      "settings",
      "notifications",
    ]);
    expect(entries[0].href).toBe("/ms-MY/news");
  });

  it("auth 尚未加载完成时（tier 为 null）不显示升级入口，避免闪现", () => {
    const keys = buildMoreEntries({ ...base, tier: null }).map((e) => e.key);
    expect(keys).not.toContain("upgrade");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/nav/tabs.test.ts`
Expected: FAIL — `Failed to resolve import "./tabs"`

- [ ] **Step 3: 实现 `src/lib/nav/tabs.ts`**

```ts
export type TabKey = "dashboard" | "learn" | "trade" | "screener" | "more";

export interface MobileTab {
  key: TabKey;
  href: (locale: string) => string;
  /** 中央凸起的金色圆盘。它是目的地不是动作——点了直接跳转并显示选中态 */
  center: boolean;
}

export const MOBILE_TABS: MobileTab[] = [
  { key: "dashboard", href: (l) => `/${l}/dashboard`, center: false },
  { key: "learn", href: (l) => `/${l}/learn`, center: false },
  { key: "trade", href: (l) => `/${l}/trade`, center: true },
  { key: "screener", href: (l) => `/${l}/screener`, center: false },
  { key: "more", href: (l) => `/${l}/more`, center: false },
];

/**
 * 每个 tab 收编哪些一级路由段。
 * 学习 tab 是 hub，收编视频与文章；更多 tab 收编所有低频页面。
 */
const TAB_SEGMENTS: Record<TabKey, string[]> = {
  dashboard: ["dashboard"],
  learn: ["learn", "videos", "articles"],
  trade: ["trade"],
  screener: ["screener"],
  more: ["more", "news", "orders", "settings", "upgrade"],
};

export function resolveActiveTab(pathname: string, locale: string): TabKey | null {
  const segments = pathname.split("/").filter(Boolean);
  // 路径的语言前缀必须与当前语言一致，否则不做匹配——
  // 切换语言的过渡瞬间不该点亮错误的 tab
  if (segments[0] !== locale) return null;

  const first = segments[1];
  if (!first) return null;

  for (const [key, owned] of Object.entries(TAB_SEGMENTS) as [TabKey, string[]][]) {
    if (owned.includes(first)) return key;
  }
  return null;
}

export interface MoreEntry {
  key: string;
  href: string;
}

export function buildMoreEntries(input: {
  locale: string;
  tier: string | null;
  role: string | null;
}): MoreEntry[] {
  const { locale, tier, role } = input;
  const entries: MoreEntry[] = [
    { key: "news", href: `/${locale}/news` },
    { key: "orders", href: `/${locale}/orders` },
    { key: "alerts", href: `/${locale}/more/alerts` },
    { key: "settings", href: `/${locale}/settings` },
    { key: "notifications", href: `/${locale}/more/notifications` },
  ];

  // tier 为 null 表示 auth 还没加载完。此时不显示升级入口，
  // 避免 Pro 用户在加载窗口内看到升级链接闪一下（沿用 Navbar 的既有判断）
  if (tier !== null && tier !== "pro") {
    entries.push({ key: "upgrade", href: `/${locale}/upgrade` });
  }

  // 后台不做移动适配，这里只是个入口链接；它在 i18n 路由之外，不带语言前缀
  if (role === "admin") {
    entries.push({ key: "admin", href: "/admin" });
  }

  return entries;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/nav/tabs.test.ts`
Expected: PASS — 15 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/nav/tabs.ts src/lib/nav/tabs.test.ts
git commit -m "feat(nav): add mobile tab definitions and active-tab resolution"
```

---

### Task 2: 底部 tab bar

**Files:**
- Create: `src/components/layout/MobileTabBar.tsx`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: `MOBILE_TABS`、`resolveActiveTab` from `@/lib/nav/tabs`
- Produces: `<MobileTabBar />`

- [ ] **Step 1: 往三个 message 文件的 `nav` 命名空间加入移动端标签**

在 `src/i18n/messages/zh-CN.json` 的 `"nav"` 对象内追加：

```json
    "tab_dashboard": "主页",
    "tab_learn": "学习",
    "tab_trade": "交易",
    "tab_screener": "选币",
    "tab_more": "更多",
    "more_news": "行业资讯",
    "more_orders": "交易历史",
    "more_alerts": "价格提醒",
    "more_settings": "设置",
    "more_notifications": "通知设置",
    "more_upgrade": "升级 Pro",
    "more_admin": "后台管理"
```

在 `src/i18n/messages/en-US.json` 的 `"nav"` 对象内追加：

```json
    "tab_dashboard": "Home",
    "tab_learn": "Learn",
    "tab_trade": "Trade",
    "tab_screener": "Screener",
    "tab_more": "More",
    "more_news": "Industry news",
    "more_orders": "Order history",
    "more_alerts": "Price alerts",
    "more_settings": "Settings",
    "more_notifications": "Notifications",
    "more_upgrade": "Upgrade to Pro",
    "more_admin": "Admin"
```

在 `src/i18n/messages/ms-MY.json` 的 `"nav"` 对象内追加：

```json
    "tab_dashboard": "Utama",
    "tab_learn": "Belajar",
    "tab_trade": "Dagangan",
    "tab_screener": "Penapis",
    "tab_more": "Lagi",
    "more_news": "Berita industri",
    "more_orders": "Sejarah pesanan",
    "more_alerts": "Amaran harga",
    "more_settings": "Tetapan",
    "more_notifications": "Pemberitahuan",
    "more_upgrade": "Naik taraf ke Pro",
    "more_admin": "Admin"
```

- [ ] **Step 2: 实现 tab bar**

Create `src/components/layout/MobileTabBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { MOBILE_TABS, resolveActiveTab, type TabKey } from "@/lib/nav/tabs";
import { cn } from "@/lib/utils";

function TabIcon({ tab, className }: { tab: TabKey; className?: string }) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (tab) {
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.8V20h14V9.8" />
        </svg>
      );
    case "learn":
      return (
        <svg {...common}>
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
          <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
        </svg>
      );
    case "trade":
      return (
        <svg {...common}>
          <path d="M7 4v16M17 4v16" />
          <path d="M4 9h6V15H4zM14 7h6v9h-6z" />
        </svg>
      );
    case "screener":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.6-3.6" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="19" cy="12" r="1.4" />
        </svg>
      );
  }
}

export function MobileTabBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");

  const active = useMemo(() => resolveActiveTab(pathname, locale), [pathname, locale]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-default bg-bg-secondary/95 backdrop-blur-md pb-safe-b lg:hidden"
      aria-label={t("tab_more")}
    >
      <div className="flex items-stretch">
        {MOBILE_TABS.map((tab) => {
          const isActive = active === tab.key;

          if (tab.center) {
            return (
              <div key={tab.key} className="flex w-[4.5rem] shrink-0 justify-center">
                <Link
                  href={tab.href(locale)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={t("tab_trade")}
                  className={cn(
                    // 凸起圆盘的上沿会侵入内容区，页面内容用 pb-tabbar 让位
                    "-mt-4 flex h-14 w-14 items-center justify-center rounded-full border transition-colors",
                    isActive
                      ? "border-gold bg-gold text-bg-primary"
                      : "border-gold/40 bg-bg-tertiary text-gold"
                  )}
                >
                  <TabIcon tab={tab.key} className="h-6 w-6" />
                </Link>
              </div>
            );
          }

          return (
            <Link
              key={tab.key}
              href={tab.href(locale)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // min-h 44px 满足 iOS HIG 的触摸目标下限
                "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors",
                isActive ? "text-gold" : "text-text-muted hover:text-text-secondary"
              )}
            >
              <TabIcon tab={tab.key} className="h-5 w-5" />
              <span className="text-[11px] leading-none">{t(`tab_${tab.key}`)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 4: 提交**

```bash
git add src/components/layout/MobileTabBar.tsx src/i18n/messages/zh-CN.json \
  src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(nav): add mobile bottom tab bar with elevated trade tab"
```

---

### Task 3: 手机端 header 与外壳组装

**Files:**
- Create: `src/components/layout/MobileHeader.tsx`
- Create: `src/components/layout/MobileShell.tsx`
- Modify: `src/components/layout/Navbar.tsx`
- Modify: `src/app/[locale]/ClientLocaleLayout.tsx`

**Interfaces:**
- Consumes: `MobileTabBar`、`PriceAlertBell`
- Produces: `<MobileShell>{children}</MobileShell>`

- [ ] **Step 1: 实现精简 header**

Create `src/components/layout/MobileHeader.tsx`:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { PriceAlertBell } from "@/components/alerts/PriceAlertBell";

export function MobileHeader() {
  const locale = useLocale();
  const auth = useAuth();

  return (
    // 状态栏样式是 black-translucent，内容会顶到状态栏下方，
    // 所以必须吃掉 safe-area-inset-top
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-primary/85 pt-safe-t backdrop-blur-md lg:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        <Link href={auth.userId ? `/${locale}/dashboard` : `/${locale}`}>
          <Image src="/logo.png" alt="Chart-IX" width={240} height={160} priority className="h-7 w-auto" />
        </Link>
        {/* 语言切换挪进 /more 的设置——低频操作不该占手机上最贵的横向空间 */}
        <PriceAlertBell />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 实现外壳组装组件**

Create `src/components/layout/MobileShell.tsx`:

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { MobileHeader } from "./MobileHeader";
import { MobileTabBar } from "./MobileTabBar";

export function MobileShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // iOS 弹出键盘时会整体上推页面，固定在底部的 tab bar 会漂到键盘上方。
    // 把「键盘占了多少高度」写进 CSS 变量，让 tab bar 在有键盘时收起。
    const sync = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${keyboardHeight}px`);
      document.documentElement.classList.toggle("keyboard-open", keyboardHeight > 80);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.classList.remove("keyboard-open");
    };
  }, []);

  return (
    <>
      <MobileHeader />
      {children}
      <MobileTabBar />
    </>
  );
}
```

- [ ] **Step 3: 在 `globals.css` 中加入键盘弹出时隐藏 tab bar 的规则**

在 `src/app/globals.css` 的 `@layer base` 内追加：

```css
  /* 键盘弹出时收起底部导航：那一刻用户在专注输入，全局导航既没用又碍事 */
  html.keyboard-open nav[aria-label] {
    display: none;
  }
```

- [ ] **Step 4: 让桌面 Navbar 只在 `lg` 及以上显示**

在 `src/components/layout/Navbar.tsx` 中，把最外层 `<header>` 的 className 由

```tsx
    <header className="sticky top-0 z-40 border-b border-border-default bg-bg-primary/80 backdrop-blur-md gpu">
```

改为

```tsx
    <header className="sticky top-0 z-40 hidden border-b border-border-default bg-bg-primary/80 backdrop-blur-md gpu lg:block">
```

原来的 `hidden md:flex` 导航项 className 保持不变——它现在整体只在 `lg` 以上渲染，那条断点已经不再决定任何东西，但改动它会牵动桌面版布局，不动。

- [ ] **Step 5: 在 `ClientLocaleLayout` 中挂上手机壳**

在 `src/app/[locale]/ClientLocaleLayout.tsx` 加入 import：

```tsx
import { MobileShell } from "@/components/layout/MobileShell";
```

把主体结构由

```tsx
            <div className="flex min-h-screen flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              {!isTradePage && <Footer />}
            </div>
```

改为

```tsx
            <div className="flex min-h-dvh flex-col">
              <Navbar />
              <MobileShell>
                {/* pb-tabbar 给底部导航条 + 中央凸起 + 系统安全区统一让位 */}
                <main className="flex-1 pb-tabbar lg:pb-0">{children}</main>
                {/* 手机上 footer 沉在 tab bar 下面没人看得到，只在桌面渲染 */}
                {!isTradePage && (
                  <div className="hidden lg:block">
                    <Footer />
                  </div>
                )}
              </MobileShell>
            </div>
```

- [ ] **Step 6: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 7: 桌面回归目视检查**

Run: `npm run dev`，浏览器窗口宽度设为 1440px，逐一打开 `/zh-CN`、`/zh-CN/dashboard`、`/zh-CN/trade`。
Expected: 顶部 Navbar 正常显示，底部无 tab bar，footer 位置与改动前一致。

- [ ] **Step 8: 提交**

```bash
git add src/components/layout/MobileHeader.tsx src/components/layout/MobileShell.tsx \
  src/components/layout/MobileTabBar.tsx src/components/layout/Navbar.tsx \
  "src/app/[locale]/ClientLocaleLayout.tsx" src/app/globals.css
git commit -m "feat(nav): mount mobile shell below lg and gate desktop navbar to lg+"
```

---

### Task 4: `/more` 聚合页

**Files:**
- Create: `src/app/[locale]/more/page.tsx`

**Interfaces:**
- Consumes: `buildMoreEntries` from `@/lib/nav/tabs`、`nav.more_*` i18n keys（Task 2 已加入）
- Produces: 路由 `/{locale}/more`

- [ ] **Step 1: 实现 `/more` 页**

Create `src/app/[locale]/more/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { createClient } from "@/lib/supabase/client";
import { buildMoreEntries } from "@/lib/nav/tabs";
import { purgePageCache } from "@/stores/pwa";

export default function MorePage() {
  const locale = useLocale();
  const t = useTranslations("nav");
  const auth = useAuth();
  const router = useRouter();

  const entries = useMemo(
    () => buildMoreEntries({ locale, tier: auth.tier ?? null, role: auth.role ?? null }),
    [locale, auth.tier, auth.role]
  );

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    await purgePageCache();
    router.push(`/${locale}`);
    router.refresh();
  }, [locale, router]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {auth.userId && (
        <div className="mb-6 border-b border-border-default pb-6">
          <p className="font-display text-xl tracking-tighter text-text-primary">
            {auth.displayName || auth.email?.split("@")[0]}
          </p>
          <p className="mt-1 text-xs text-text-muted">{auth.email}</p>
        </div>
      )}

      {/* 发丝线台账列表，不用卡片堆叠 —— 见 DESIGN.md 的 prohibitions */}
      <ul className="divide-y divide-border-default border-y border-border-default">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              href={entry.href}
              className="flex min-h-[52px] items-center justify-between px-1 py-3.5 text-sm text-text-primary transition-colors active:bg-bg-tertiary"
            >
              <span>{t(`more_${entry.key}`)}</span>
              <svg
                className="h-4 w-4 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between border-b border-border-default pb-4">
        <span className="text-sm text-text-secondary">{t("language")}</span>
        <LanguageSwitcher />
      </div>

      {auth.userId && (
        <button
          onClick={handleLogout}
          className="mt-6 w-full rounded-sm border border-border-default py-3 text-sm text-text-secondary transition-colors active:bg-bg-tertiary"
        >
          {t("sign_out")}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建成功，路由列表出现 `/[locale]/more`。

若 `LanguageSwitcher` 不是具名导出，按其实际导出方式调整 import。

- [ ] **Step 3: 提交**

```bash
git add "src/app/[locale]/more/page.tsx"
git commit -m "feat(nav): add /more hub page"
```

---

### Task 5: `/learn` 改造成学习中心

**Files:**
- Create: `src/app/[locale]/learn/LearnHub.tsx`
- Modify: `src/app/[locale]/learn/page.tsx`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: `learn.hub_*` i18n keys
- Produces: `<LearnHub locale={locale} />`

`/learn` 现在只承载「学习路径」，需要变成 `学习` tab 的 hub。学习路径本身的内容保留，下沉为 hub 中的一节。**桌面版同步改**——否则两端信息架构分叉。

- [ ] **Step 1: 往三个 message 文件加入 hub 文案**

在 `src/i18n/messages/zh-CN.json` 顶层加入（若已存在 `learn` 命名空间则并入）：

```json
  "learn": {
    "hub_title": "学习中心",
    "hub_subtitle": "课程、文章与学习路径，循序渐进地建立交易认知",
    "hub_videos": "视频课程",
    "hub_videos_desc": "系统化的教学视频，从基础概念到实盘操作",
    "hub_articles": "文章",
    "hub_articles_desc": "深度解读与策略拆解",
    "hub_paths": "学习路径",
    "hub_paths_desc": "按顺序排好的成长路线"
  },
```

在 `src/i18n/messages/en-US.json`：

```json
  "learn": {
    "hub_title": "Learning centre",
    "hub_subtitle": "Courses, articles and structured paths that build trading judgement step by step",
    "hub_videos": "Video courses",
    "hub_videos_desc": "Structured lessons, from core concepts to live execution",
    "hub_articles": "Articles",
    "hub_articles_desc": "Deep dives and strategy breakdowns",
    "hub_paths": "Learning paths",
    "hub_paths_desc": "A sequenced route from beginner to confident"
  },
```

在 `src/i18n/messages/ms-MY.json`：

```json
  "learn": {
    "hub_title": "Pusat pembelajaran",
    "hub_subtitle": "Kursus, artikel dan laluan berstruktur untuk membina pertimbangan dagangan langkah demi langkah",
    "hub_videos": "Kursus video",
    "hub_videos_desc": "Pelajaran berstruktur, dari konsep asas hingga pelaksanaan langsung",
    "hub_articles": "Artikel",
    "hub_articles_desc": "Analisis mendalam dan pecahan strategi",
    "hub_paths": "Laluan pembelajaran",
    "hub_paths_desc": "Laluan tersusun dari pemula hingga yakin"
  },
```

- [ ] **Step 2: 实现 hub 入口组件**

Create `src/app/[locale]/learn/LearnHub.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function LearnHub({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "learn" });

  const sections = [
    { key: "videos", href: `/${locale}/videos` },
    { key: "articles", href: `/${locale}/articles` },
    { key: "paths", href: "#paths" },
  ] as const;

  return (
    <>
      <h1 className="font-display text-3xl tracking-tighter text-text-primary">{t("hub_title")}</h1>
      <p className="mt-2 text-sm text-text-secondary">{t("hub_subtitle")}</p>

      {/* 三个分区入口用发丝线台账列表，不做卡片堆叠 */}
      <ul className="mt-8 divide-y divide-border-default border-y border-border-default">
        {sections.map((section) => (
          <li key={section.key}>
            <Link
              href={section.href}
              className="flex min-h-[64px] items-center justify-between gap-4 px-1 py-4 transition-colors active:bg-bg-tertiary"
            >
              <span>
                <span className="block text-base text-text-primary">{t(`hub_${section.key}`)}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {t(`hub_${section.key}_desc`)}
                </span>
              </span>
              <svg
                className="h-4 w-4 shrink-0 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
```

- [ ] **Step 3: 把 hub 接进 `/learn` 页**

在 `src/app/[locale]/learn/page.tsx` 中加入 import：

```tsx
import { LearnHub } from "./LearnHub";
```

把返回结构的开头由

```tsx
    <div className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-3xl font-bold text-text-primary">学习路径</h1>
      <p className="mt-2 text-text-secondary">循序渐进，从零开始系统化学习交易</p>

      {list.length === 0 ? (
```

改为

```tsx
    <div className="mx-auto max-w-7xl px-4 py-8 lg:py-12">
      <LearnHub locale={locale} />

      <h2 id="paths" className="mt-12 scroll-mt-20 font-display text-2xl tracking-tighter text-text-primary">
        {tLearn("hub_paths")}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">{tLearn("hub_paths_desc")}</p>

      {list.length === 0 ? (
```

并在函数体内、`return` 之前取得翻译函数：

```tsx
  const tLearn = await getTranslations({ locale, namespace: "learn" });
```

同时在文件顶部加入 import：

```tsx
import { getTranslations } from "next-intl/server";
```

原本硬编码的中文标题「学习路径」「循序渐进，从零开始系统化学习交易」被替换为三语键——这两句原先只有中文，现在三语齐备。

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 5: 三语目视检查**

Run: `npm run dev`，依次打开 `/zh-CN/learn`、`/en-US/learn`、`/ms-MY/learn`。
Expected: 三种语言下 hub 标题、三个分区入口、学习路径小节均正确显示，无 `learn.hub_*` 之类的原始 key 泄漏。

- [ ] **Step 6: 全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add "src/app/[locale]/learn/LearnHub.tsx" "src/app/[locale]/learn/page.tsx" \
  src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(learn): turn /learn into a learning hub with three sections"
```

---

## 验收清单

- [ ] 手机宽度（≤1023px）下底部出现 5 个位置的 tab bar，交易为金色凸起圆盘
- [ ] 桌面宽度（≥1024px）下无 tab bar，顶部 Navbar 与改动前完全一致
- [ ] 点击各 tab 正确跳转，且当前 tab 高亮为金色
- [ ] 打开 `/videos/xxx` 详情页时，`学习` tab 保持高亮
- [ ] 打开 `/settings` 时，`更多` tab 保持高亮
- [ ] `/more` 页免费用户显示「升级 Pro」，Pro 用户不显示
- [ ] `/more` 页管理员账号显示「后台管理」，普通账号不显示
- [ ] `/more` 页登出后跳回首页，且 `cix-pages-*` 缓存被清空
- [ ] iOS 上 header 内容不被状态栏遮挡，tab bar 不被 home indicator 遮挡
- [ ] 页面滚动到底部时，内容不被 tab bar 或中央凸起遮挡
- [ ] 在任意输入框聚焦弹出键盘时，tab bar 收起而非漂在键盘上方
- [ ] 三语下 tab 标签均完整显示、不换行、不截断（马来语最长，重点检查）
