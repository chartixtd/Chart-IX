# PWA 平台层（L0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Chart-IX 可以在 iOS 与 Android 上被安装到主屏、以独立应用形态全屏运行、断网时不白屏。

**Architecture:** 手写 `public/sw.js`（不引入 Serwist/next-pwa），缓存策略判定抽到 `public/sw-strategy.js` 以便单测。manifest 按 locale 由 route handler 生成，三份共用同一个 `id` 保证是同一个应用。平台检测写成纯函数以便在 node 环境单测。

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS 3 · next-intl 4 · vitest 3

**Spec:** [2026-08-04-mobile-pwa-design.md](../specs/2026-08-04-mobile-pwa-design.md)

## Global Constraints

- 沿用现有技术栈，L0 **不引入任何运行时依赖**。仅允许新增一个 devDependency `sharp`（仅用于离线生成图标的一次性脚本）。
- 三语并存：`zh-CN` / `en-US` / `ms-MY`。任何新增文案必须同时写入 `src/i18n/messages/` 下三个文件。
- 设计令牌以 [DESIGN.md](../../../DESIGN.md) 为准：底色 `#0B0A08`、次级底 `#14120E`、金 `#C9A24B`、主文本 `#F5F0E6`、次文本 `#A89F8C`、弱文本 `#6E675A`、描边 `#2C271C`。
- **绝对规则**：service worker 对 `/api/**` 与带 `?_rsc=` 的请求一律不缓存，必须是 `fetch` 处理器最开头的显式 early-return。
- vitest 的 `include` 只覆盖 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts`，新测试必须落在这两个目录下。
- vitest `environment: "node"`，**没有 DOM**。任何需要单测的逻辑必须写成接受普通对象入参的纯函数，不得直接读 `window` / `navigator`。
- 现有代码注释以中文为主，新增注释沿用中文，解释「为什么」而非「做了什么」。
- 每个任务结束时提交一次，commit message 用英文、遵循 conventional commits。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `public/sw-strategy.js` | 纯函数 `shouldCache(url, mode, origin) → strategy`。唯一的缓存策略事实来源 |
| `public/sw.js` | service worker 本体：install 预缓存、activate 清理、fetch 分发、message 处理 |
| `public/icons/*.png` | manifest 与 apple-touch 图标 |
| `scripts/generate-icons.mjs` | 从 `logo/mlogo.png` 生成图标集的一次性脚本 |
| `src/lib/pwa/platform.ts` | 平台/环境检测纯函数 + 从浏览器读取入参的薄封装 |
| `src/lib/pwa/platform.test.ts` | 上者的单测 |
| `src/lib/pwa/sw-strategy.test.ts` | `public/sw-strategy.js` 的单测 |
| `src/lib/pwa/manifest.ts` | 按 locale 构造 manifest 对象的纯函数 |
| `src/lib/pwa/manifest.test.ts` | 上者的单测 |
| `src/app/[locale]/manifest.webmanifest/route.ts` | manifest 路由 |
| `src/app/[locale]/offline/page.tsx` | 离线兜底页 |
| `src/components/pwa/ServiceWorkerRegistrar.tsx` | 注册 SW、驱动更新提示、登出时清页面缓存 |
| `src/components/pwa/UpdateBanner.tsx` | 「有新版本」提示条 |
| `src/components/pwa/InstallPrompt.tsx` | 安装引导（Android prompt / iOS 说明 / 内置浏览器引导） |
| `src/stores/pwa.ts` | zustand store：SW 更新状态、是否有未确认订单（供更新提示避让） |

---

### Task 1: 视口、安全区与移动端基础样式

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: 无
- Produces: Tailwind 工具类 `pb-safe` / `pt-safe` / `h-dvh` / `min-h-dvh`、间距令牌 `safe-b` / `safe-t`

本任务改的是配置与全局 CSS，没有可断言的逻辑，因此以构建通过 + 真机目视为验证手段，不写单测。

- [ ] **Step 1: 在 `tailwind.config.ts` 的 `theme.extend` 中加入安全区间距与动态视口高度**

在 `extend` 对象内（与 `colors` 平级）加入：

```ts
      spacing: {
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
        // 底部 tab bar 高度(56) + 中央凸起溢出(14) + 系统安全区
        // 页面内容底部统一用 pb-tabbar，避免逐页手算导致漂移
        tabbar: "calc(70px + env(safe-area-inset-bottom))",
      },
      height: {
        dvh: "100dvh",
      },
      minHeight: {
        dvh: "100dvh",
      },
```

- [ ] **Step 2: 在 `src/app/globals.css` 的 `@layer base` 末尾追加移动端基础规则**

追加到 `@layer base { ... }` 内部的最后：

```css
  /* PWA：禁用页面级双指缩放。
     iOS 只有在安装到主屏的 standalone 模式下才真正生效，浏览器标签页里
     Safari 会忽略——这是系统行为，不是这里写错了。
     touch-action 不是继承属性，所以设在 html 上不会波及 K 线图容器。 */
  html {
    touch-action: pan-x pan-y;
    overscroll-behavior-y: none;
  }

  /* 双击缩放会带来 300ms 点击延迟，交互元素统一去掉 */
  button,
  a,
  [role="button"],
  input,
  select,
  textarea {
    touch-action: manipulation;
  }

  /* iOS Safari 会在聚焦字号小于 16px 的输入框时自动放大整页。
     禁用缩放之后用户没有放大这个逃生口，所以这条是硬性下限而不是优化。
     写成全局规则而非逐组件改——下单表单有十几个字段，逐个改一定会漏。 */
  @media (max-width: 1023px) {
    input,
    select,
    textarea {
      font-size: 16px;
    }
  }
```

- [ ] **Step 3: 在 `src/app/layout.tsx` 导出 `viewport`**

在 `export const metadata` 之后加入（同时从 `next` 引入 `Viewport` 类型）：

```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0B0A08",
};
```

并把首行的 import 改成：

```tsx
import type { Metadata, Viewport } from "next";
```

- [ ] **Step 4: 在 `src/app/layout.tsx` 的 `<head>` 中加入 iOS 专属 meta**

在现有 `<meta name="view-transition" ... />` 之后加入：

```tsx
        {/* iOS 16.4+ 已认 manifest 的 display，但这个 meta 仍是最可靠的路径 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* black-translucent 配合 viewport-fit=cover：内容会顶到状态栏下方，
            所以 header 必须吃 safe-area-inset-top 的 padding（见 L1） */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- [ ] **Step 5: 加入 iOS 的手势拦截层**

viewport 与 CSS 两层在 Android 上够用，但 **iOS 真正起作用的是 WebKit 私有的 `gesture*` 事件**。

Create `src/components/pwa/ZoomGuard.tsx`:

```tsx
"use client";

import { useEffect } from "react";

/**
 * 禁用页面级双指缩放的第三层（前两层是 viewport meta 与 html 的 touch-action）。
 * iOS 从 10 开始忽略 user-scalable=no，只有拦掉这三个 WebKit 私有事件才真正生效
 * ——而且仅在安装到主屏的 standalone 模式下可靠，浏览器标签页里 Safari 仍可能放行。
 *
 * K 线图和绘图层必须保留双指缩放（那是看图的核心操作），所以挂了
 * data-allow-zoom 的容器内一律放行。
 */
export function ZoomGuard() {
  useEffect(() => {
    const block = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-allow-zoom]")) return;
      event.preventDefault();
    };

    const events = ["gesturestart", "gesturechange", "gestureend"];
    events.forEach((name) => document.addEventListener(name, block, { passive: false }));
    return () => events.forEach((name) => document.removeEventListener(name, block));
  }, []);

  return null;
}
```

- [ ] **Step 6: 挂上 ZoomGuard 并给图表容器开豁免**

在 `src/app/[locale]/ClientLocaleLayout.tsx` 加入 import：

```tsx
import { ZoomGuard } from "@/components/pwa/ZoomGuard";
```

并在 `<ToastProvider>` 内的第一行插入：

```tsx
            <ZoomGuard />
```

在 `src/components/trade/KlineChart.tsx` 中，给图表最外层容器 div 加上 `data-allow-zoom` 属性：

```tsx
<div ref={containerRef} data-allow-zoom className={cn("...", className)}>
```

同样给 `src/components/trade/chart/DrawingLayer.tsx` 的根容器加上 `data-allow-zoom`。

- [ ] **Step 7: 构建验证**

Run: `npm run build`
Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 8: 提交**

```bash
git add src/app/layout.tsx tailwind.config.ts src/app/globals.css \
  src/components/pwa/ZoomGuard.tsx "src/app/[locale]/ClientLocaleLayout.tsx" \
  src/components/trade/KlineChart.tsx src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(pwa): disable page pinch-zoom while keeping it on the chart"
```

---

### Task 2: 平台与环境检测（纯函数 + 单测）

**Files:**
- Create: `src/lib/pwa/platform.ts`
- Test: `src/lib/pwa/platform.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type PlatformInput = { userAgent: string; hasTelegramProxy: boolean; standalone: boolean; displayModeStandalone: boolean }`
  - `type Platform = { os: "ios" | "android" | "other"; inAppBrowser: "telegram" | "wechat" | "line" | "facebook" | "generic" | null; isStandalone: boolean; canPromptInstall: boolean }`
  - `function detectPlatform(input: PlatformInput): Platform`
  - `function readPlatform(): Platform` — 从浏览器读入参后调用 `detectPlatform`

- [ ] **Step 1: 写失败的测试**

Create `src/lib/pwa/platform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectPlatform } from "./platform";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1",
  iosInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  wechat:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42",
  line:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36 Line/14.2.0",
  facebook:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/450.0]",
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const base = { hasTelegramProxy: false, standalone: false, displayModeStandalone: false };

describe("detectPlatform", () => {
  it("识别 iOS Safari，可以走安装引导", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosSafari });
    expect(p.os).toBe("ios");
    expect(p.inAppBrowser).toBeNull();
    expect(p.canPromptInstall).toBe(true);
  });

  it("识别 Android Chrome", () => {
    const p = detectPlatform({ ...base, userAgent: UA.androidChrome });
    expect(p.os).toBe("android");
    expect(p.inAppBrowser).toBeNull();
    expect(p.canPromptInstall).toBe(true);
  });

  it("Telegram 内置浏览器靠注入的 proxy 对象识别", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosSafari, hasTelegramProxy: true });
    expect(p.inAppBrowser).toBe("telegram");
    expect(p.canPromptInstall).toBe(false);
  });

  it("识别微信内置浏览器", () => {
    expect(detectPlatform({ ...base, userAgent: UA.wechat }).inAppBrowser).toBe("wechat");
  });

  it("识别 Line 内置浏览器", () => {
    expect(detectPlatform({ ...base, userAgent: UA.line }).inAppBrowser).toBe("line");
  });

  it("识别 Facebook 内置浏览器", () => {
    expect(detectPlatform({ ...base, userAgent: UA.facebook }).inAppBrowser).toBe("facebook");
  });

  it("iOS 上缺少 Safari 标识的按通用内置浏览器处理", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosInApp });
    expect(p.inAppBrowser).toBe("generic");
    expect(p.canPromptInstall).toBe(false);
  });

  it("iOS Chrome 不是内置浏览器，但 iOS 上只有 Safari 能安装", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosChrome });
    expect(p.inAppBrowser).toBeNull();
    expect(p.canPromptInstall).toBe(false);
  });

  it("navigator.standalone 为真时判定已安装", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosSafari, standalone: true });
    expect(p.isStandalone).toBe(true);
    expect(p.canPromptInstall).toBe(false);
  });

  it("display-mode: standalone 为真时同样判定已安装", () => {
    const p = detectPlatform({ ...base, userAgent: UA.androidChrome, displayModeStandalone: true });
    expect(p.isStandalone).toBe(true);
  });

  it("桌面浏览器不做移动安装引导", () => {
    const p = detectPlatform({ ...base, userAgent: UA.desktop });
    expect(p.os).toBe("other");
    expect(p.canPromptInstall).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/pwa/platform.test.ts`
Expected: FAIL — `Failed to resolve import "./platform"`

- [ ] **Step 3: 实现 `src/lib/pwa/platform.ts`**

```ts
export type InAppBrowser = "telegram" | "wechat" | "line" | "facebook" | "generic";

export interface PlatformInput {
  userAgent: string;
  /** Telegram 会往 window 上注入 proxy 对象，这是比 UA 更可靠的信号 */
  hasTelegramProxy: boolean;
  /** iOS 专属的 navigator.standalone */
  standalone: boolean;
  /** matchMedia("(display-mode: standalone)").matches */
  displayModeStandalone: boolean;
}

export interface Platform {
  os: "ios" | "android" | "other";
  inAppBrowser: InAppBrowser | null;
  isStandalone: boolean;
  /** 当前环境是否值得显示安装引导 */
  canPromptInstall: boolean;
}

export function detectPlatform(input: PlatformInput): Platform {
  const ua = input.userAgent;
  const os: Platform["os"] = /iPhone|iPad|iPod/.test(ua)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : "other";

  const inAppBrowser = detectInAppBrowser(ua, input.hasTelegramProxy, os);
  const isStandalone = input.standalone || input.displayModeStandalone;

  // iOS 上只有 Safari 能「添加到主屏幕」——Chrome for iOS 等同样装不上。
  // 判断不确定时按能装处理（fail-open）：给装不上的人显示引导只是一次无效
  // 点击，把真能装的人挡在门外则是永久流失。
  const iosCanInstall = os === "ios" && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const canPromptInstall =
    !isStandalone &&
    inAppBrowser === null &&
    (os === "android" || iosCanInstall);

  return { os, inAppBrowser, isStandalone, canPromptInstall };
}

function detectInAppBrowser(
  ua: string,
  hasTelegramProxy: boolean,
  os: Platform["os"]
): InAppBrowser | null {
  if (hasTelegramProxy) return "telegram";
  if (/MicroMessenger/.test(ua)) return "wechat";
  if (/\bLine\//.test(ua)) return "line";
  if (/FBAN|FBAV/.test(ua)) return "facebook";
  // iOS 的 WKWebView 内置浏览器不会带 Safari 标识；但 Chrome/Firefox for iOS
  // 会带，所以这条只在没有任何已知浏览器标识时才触发
  if (os === "ios" && !/Safari/.test(ua)) return "generic";
  return null;
}

/** 浏览器侧的薄封装。纯函数留给单测，这里只负责取值。 */
export function readPlatform(): Platform {
  if (typeof window === "undefined") {
    return { os: "other", inAppBrowser: null, isStandalone: false, canPromptInstall: false };
  }
  const w = window as Window & {
    TelegramWebviewProxy?: unknown;
    TelegramWebview?: unknown;
  };
  return detectPlatform({
    userAgent: navigator.userAgent,
    hasTelegramProxy: Boolean(w.TelegramWebviewProxy || w.TelegramWebview),
    standalone: Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/pwa/platform.test.ts`
Expected: PASS — 11 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/pwa/platform.ts src/lib/pwa/platform.test.ts
git commit -m "feat(pwa): add platform and in-app browser detection"
```

---

### Task 3: Service Worker 缓存策略（纯函数 + 单测）

**Files:**
- Create: `public/sw-strategy.js`
- Test: `src/lib/pwa/sw-strategy.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `shouldCache(rawUrl: string, mode: string, origin: string) → "static" | "fonts-swr" | "fonts-cache" | "pages" | "never" | "passthrough"`

`public/` 下的文件由 Vercel 原样静态托管、不经过打包，因此无法 `import` `src/` 下的 TypeScript。策略函数写成挂到作用域对象上的普通 JS，`sw.js` 用 `importScripts` 载入，测试侧用 `new Function` 注入一个假的 `self` 取回函数——两边共用同一份源码，不会漂移。

- [ ] **Step 1: 写失败的测试**

Create `src/lib/pwa/sw-strategy.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

type Strategy = "static" | "fonts-swr" | "fonts-cache" | "pages" | "never" | "passthrough";
type ShouldCache = (rawUrl: string, mode: string, origin: string) => Strategy;

const ORIGIN = "https://chart-ix.example";
let shouldCache: ShouldCache;

beforeAll(() => {
  const src = readFileSync(new URL("../../../public/sw-strategy.js", import.meta.url), "utf8");
  const scope: { shouldCache?: ShouldCache } = {};
  // sw-strategy.js 把函数挂到传入的作用域上；这里注入一个假的 self，
  // 既拿得到函数，又不污染 globalThis
  new Function("self", src)(scope);
  if (!scope.shouldCache) throw new Error("sw-strategy.js 没有挂载 shouldCache");
  shouldCache = scope.shouldCache;
});

describe("shouldCache", () => {
  it("API 请求绝不缓存", () => {
    expect(shouldCache(`${ORIGIN}/api/screener`, "cors", ORIGIN)).toBe("never");
    expect(shouldCache(`${ORIGIN}/api/trading/order`, "cors", ORIGIN)).toBe("never");
  });

  it("即使是导航模式，API 路径依然不缓存", () => {
    expect(shouldCache(`${ORIGIN}/api/share/abc`, "navigate", ORIGIN)).toBe("never");
  });

  it("带 _rsc 的 RSC payload 绝不缓存", () => {
    expect(shouldCache(`${ORIGIN}/zh-CN/dashboard?_rsc=1a2b3c`, "cors", ORIGIN)).toBe("never");
  });

  it("构建产物走 cache-first", () => {
    expect(shouldCache(`${ORIGIN}/_next/static/chunks/main-abc123.js`, "no-cors", ORIGIN)).toBe(
      "static"
    );
  });

  it("图标与 logo 走 cache-first", () => {
    expect(shouldCache(`${ORIGIN}/icons/icon-192.png`, "no-cors", ORIGIN)).toBe("static");
    expect(shouldCache(`${ORIGIN}/logo.png`, "no-cors", ORIGIN)).toBe("static");
  });

  it("Google Fonts 的 CSS 走 stale-while-revalidate", () => {
    expect(shouldCache("https://fonts.googleapis.com/css2?family=Noto+Sans+SC", "cors", ORIGIN)).toBe(
      "fonts-swr"
    );
  });

  it("字体文件本身走 cache-first", () => {
    expect(shouldCache("https://fonts.gstatic.com/s/notosanssc/v1/abc.woff2", "cors", ORIGIN)).toBe(
      "fonts-cache"
    );
  });

  it("页面导航走 network-first", () => {
    expect(shouldCache(`${ORIGIN}/zh-CN/articles/hello`, "navigate", ORIGIN)).toBe("pages");
  });

  it("其他跨域请求不拦截", () => {
    expect(shouldCache("https://open-api.bingx.com/openApi/swap/v2/quote/ticker", "cors", ORIGIN)).toBe(
      "passthrough"
    );
  });

  it("同源的非导航、非静态资源请求不拦截", () => {
    expect(shouldCache(`${ORIGIN}/zh-CN/dashboard`, "cors", ORIGIN)).toBe("passthrough");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/pwa/sw-strategy.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... public/sw-strategy.js`

- [ ] **Step 3: 实现 `public/sw-strategy.js`**

```js
(function (scope) {
  /**
   * 唯一的缓存策略事实来源。sw.js 通过 importScripts 载入，
   * 单测通过 new Function 注入假的 self 载入——同一份源码，不会漂移。
   *
   * @param {string} rawUrl
   * @param {string} mode  request.mode
   * @param {string} origin  self.location.origin
   * @returns {"static"|"fonts-swr"|"fonts-cache"|"pages"|"never"|"passthrough"}
   */
  function shouldCache(rawUrl, mode, origin) {
    var url = new URL(rawUrl);
    var sameOrigin = url.origin === origin;

    // ——— 硬规则，必须排在最前 ———
    // 行情、持仓、下单全走 /api。任何一次误缓存都可能让用户基于过期价格做决策。
    if (sameOrigin && url.pathname.indexOf("/api/") === 0) return "never";
    // RSC payload 与构建 ID 强绑定，缓存后遇上新部署会产生偶发的水合错误
    if (sameOrigin && url.searchParams.has("_rsc")) return "never";

    if (url.hostname === "fonts.googleapis.com") return "fonts-swr";
    if (url.hostname === "fonts.gstatic.com") return "fonts-cache";

    if (!sameOrigin) return "passthrough";

    // 内容哈希命名，天然 immutable
    if (url.pathname.indexOf("/_next/static/") === 0) return "static";
    if (url.pathname.indexOf("/icons/") === 0 || url.pathname === "/logo.png") return "static";

    if (mode === "navigate") return "pages";
    return "passthrough";
  }

  scope.shouldCache = shouldCache;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/pwa/sw-strategy.test.ts`
Expected: PASS — 10 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add public/sw-strategy.js src/lib/pwa/sw-strategy.test.ts
git commit -m "feat(pwa): add service worker cache strategy with tests"
```

---

### Task 4: Service Worker 本体

**Files:**
- Create: `public/sw.js`

**Interfaces:**
- Consumes: `shouldCache` from `public/sw-strategy.js`
- Produces: 响应 `SKIP_WAITING` 与 `PURGE_PAGES` 两种 postMessage 消息

SW 的行为无法在 node 环境有意义地单测（策略判定已在 Task 3 覆盖），本任务以真机/DevTools 验证为准。

- [ ] **Step 1: 实现 `public/sw.js`**

```js
/* eslint-disable no-undef */
var VERSION = new URL(self.location).searchParams.get("v") || "dev";
importScripts("/sw-strategy.js?v=" + VERSION);

var STATIC_CACHE = "cix-static-" + VERSION;
var PAGES_CACHE = "cix-pages-" + VERSION;
// 字体故意不带版本号——字体文件几年不变，每次部署清空是对用户流量的浪费，
// 在东南亚移动网络下这个浪费是有感的
var FONTS_CACHE = "cix-fonts";

var LOCALES = ["zh-CN", "en-US", "ms-MY"];
var PRECACHE = LOCALES.map(function (l) {
  return "/" + l + "/offline";
}).concat(["/icons/icon-192.png", "/icons/icon-512.png"]);

self.addEventListener("install", function (event) {
  // 只预缓存一小组已知固定 URL。不做构建产物清单：用户必须先访问过网站
  // 才可能安装它，届时运行时缓存已经是热的。
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

self.addEventListener("activate", function (event) {
  var keep = [STATIC_CACHE, PAGES_CACHE, FONTS_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (name.indexOf("cix-") === 0 && keep.indexOf(name) === -1) {
              return caches.delete(name);
            }
            return null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "PURGE_PAGES") {
    // 登出时清掉渲染好的 HTML——仪表盘、订单页含用户数据，
    // 共用手机的场景下这是实际的隐私问题
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var strategy = self.shouldCache(request.url, request.mode, self.location.origin);

  if (strategy === "never" || strategy === "passthrough") return;

  if (strategy === "static" || strategy === "fonts-cache") {
    event.respondWith(
      cacheFirst(request, strategy === "static" ? STATIC_CACHE : FONTS_CACHE)
    );
    return;
  }

  if (strategy === "fonts-swr") {
    event.respondWith(staleWhileRevalidate(request, FONTS_CACHE));
    return;
  }

  if (strategy === "pages") {
    event.respondWith(networkFirst(request));
  }
});

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(cacheName).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.match(request).then(function (hit) {
    var network = fetch(request)
      .then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(cacheName).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return hit;
      });
    return hit || network;
  });
}

function networkFirst(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(PAGES_CACHE).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        return caches.match(offlineUrlFor(request.url)).then(function (fallback) {
          return (
            fallback ||
            new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        });
      });
    });
}

function offlineUrlFor(rawUrl) {
  var segments = new URL(rawUrl).pathname.split("/").filter(Boolean);
  var locale = LOCALES.indexOf(segments[0]) !== -1 ? segments[0] : "en-US";
  return "/" + locale + "/offline";
}
```

- [ ] **Step 2: 确认策略测试仍然通过**

`sw.js` 与 `sw-strategy.js` 共用同一份策略源码，改动后跑一遍确认没有破坏契约。

Run: `npx vitest run src/lib/pwa`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add public/sw.js
git commit -m "feat(pwa): add service worker with runtime caching and offline fallback"
```

---

### Task 5: 构建号注入与 `/sw.js` 响应头

**Files:**
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `process.env.NEXT_PUBLIC_BUILD_ID`（客户端可读）

- [ ] **Step 1: 在 `next.config.mjs` 顶部计算构建号**

在 `const withNextIntl = ...` 之后加入：

```js
// SW 的版本号：注册时作为 query 传入，URL 变化即被浏览器认定为新 worker。
// 这样每次部署自动换代，不依赖人记得手改版本号常量。
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev";
```

- [ ] **Step 2: 把构建号注入 env，并为 `/sw.js` 加响应头**

把 `nextConfig` 改成（保留现有 `images` 与安全头，新增 `env` 与两条 `/sw.js` 规则）：

```js
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "www.gravatar.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // SW 脚本必须每次revalidate，否则新版本要等浏览器的 24h 上限才生效
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/sw-strategy.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 提交**

```bash
git add next.config.mjs
git commit -m "chore(pwa): inject build id and set no-cache headers for service worker"
```

---

### Task 6: Manifest 生成（纯函数 + 单测 + 路由）

**Files:**
- Create: `src/lib/pwa/manifest.ts`
- Test: `src/lib/pwa/manifest.test.ts`
- Create: `src/app/[locale]/manifest.webmanifest/route.ts`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/en-US.json`
- Modify: `src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: 无
- Produces: `buildManifest(locale: string, copy: ManifestCopy): WebManifest`，其中 `ManifestCopy = { name: string; shortName: string; description: string; tradeShortcut: string; screenerShortcut: string }`

- [ ] **Step 1: 写失败的测试**

Create `src/lib/pwa/manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest";

const copy = {
  name: "Chart-IX — 加密货币交易教育与实盘平台",
  shortName: "Chart-IX",
  description: "从零开始学习加密货币交易，再连接 BingX 实盘下单。",
  tradeShortcut: "交易",
  screenerShortcut: "选币",
};

describe("buildManifest", () => {
  it("三种语言必须共用同一个 id，否则会被浏览器当成三个应用", () => {
    const ids = ["zh-CN", "en-US", "ms-MY"].map((l) => buildManifest(l, copy).id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("/");
  });

  it("start_url 指向该语言的仪表盘并带上启动来源标记", () => {
    expect(buildManifest("ms-MY", copy).start_url).toBe("/ms-MY/dashboard?source=pwa");
  });

  it("scope 覆盖整站", () => {
    expect(buildManifest("en-US", copy).scope).toBe("/");
  });

  it("使用 standalone 而非 fullscreen——盯盘的人需要看到状态栏", () => {
    const m = buildManifest("zh-CN", copy);
    expect(m.display).toBe("standalone");
    expect(m.display_override).toEqual(["standalone", "minimal-ui"]);
  });

  it("不锁定屏幕方向——K 线图横屏更好用", () => {
    expect(buildManifest("zh-CN", copy)).not.toHaveProperty("orientation");
  });

  it("同时提供普通图标与 maskable 图标", () => {
    const purposes = buildManifest("zh-CN", copy).icons.map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("图标尺寸覆盖 192 与 512", () => {
    const sizes = buildManifest("zh-CN", copy).icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("配色沿用设计令牌", () => {
    const m = buildManifest("zh-CN", copy);
    expect(m.theme_color).toBe("#0B0A08");
    expect(m.background_color).toBe("#0B0A08");
  });

  it("快捷方式的链接带上对应语言前缀", () => {
    const m = buildManifest("ms-MY", copy);
    expect(m.shortcuts.map((s) => s.url)).toEqual(["/ms-MY/trade", "/ms-MY/screener"]);
  });

  it("文案来自传入的 copy，不写死语言", () => {
    const m = buildManifest("ms-MY", copy);
    expect(m.name).toBe(copy.name);
    expect(m.short_name).toBe(copy.shortName);
    expect(m.description).toBe(copy.description);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/pwa/manifest.test.ts`
Expected: FAIL — `Failed to resolve import "./manifest"`

- [ ] **Step 3: 实现 `src/lib/pwa/manifest.ts`**

```ts
export interface ManifestCopy {
  name: string;
  shortName: string;
  description: string;
  tradeShortcut: string;
  screenerShortcut: string;
}

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  display_override: string[];
  background_color: string;
  theme_color: string;
  lang: string;
  dir: "ltr";
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string }[];
}

export function buildManifest(locale: string, copy: ManifestCopy): WebManifest {
  return {
    // 三种语言必须共用同一个 id。id 不同会被浏览器当成三个独立应用，
    // 用户切换语言后会在桌面上装出第二个图标。
    id: "/",
    name: copy.name,
    short_name: copy.shortName,
    description: copy.description,
    // 会安装的基本都是已登录用户，直达仪表盘省一次重定向；
    // 未登录会被 middleware 送去登录页，行为同样正确。
    start_url: `/${locale}/dashboard?source=pwa`,
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#0B0A08",
    theme_color: "#0B0A08",
    lang: locale,
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: copy.tradeShortcut, url: `/${locale}/trade` },
      { name: copy.screenerShortcut, url: `/${locale}/screener` },
    ],
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/pwa/manifest.test.ts`
Expected: PASS — 10 个用例全绿

- [ ] **Step 5: 往三个 message 文件加入 `pwa` 命名空间**

在 `src/i18n/messages/zh-CN.json` 顶层加入（与 `seo` 平级）：

```json
  "pwa": {
    "app_name": "Chart-IX — 加密货币交易教育与实盘平台",
    "short_name": "Chart-IX",
    "app_description": "从零开始系统学习加密货币交易，在模拟盘练习，再连接自己的 BingX 账户实盘下单。资金始终留在你自己的交易所账户里。",
    "shortcut_trade": "交易",
    "shortcut_screener": "选币",
    "offline_title": "你现在处于离线状态",
    "offline_body": "网络断开了。已经看过的文章和课程仍然可以阅读，但行情、持仓和下单需要联网。",
    "offline_retry": "重新连接",
    "offline_warning": "离线期间无法下单，请勿依据缓存中的价格做交易决策。",
    "update_available": "有新版本可用",
    "update_action": "立即更新",
    "install_title": "把 Chart-IX 装到主屏",
    "install_body": "全屏运行、启动更快，还能在到价时收到通知。",
    "install_action": "安装",
    "install_dismiss": "以后再说",
    "install_ios_step1": "点击底部工具栏的「分享」按钮",
    "install_ios_step2": "在菜单中选择「添加到主屏幕」",
    "install_ios_step3": "点击右上角「添加」完成",
    "install_inapp_title": "请在浏览器中打开",
    "install_inapp_body": "当前是应用内置浏览器，无法安装到主屏。请复制链接后在 Safari 或 Chrome 中打开。",
    "install_inapp_copy": "复制链接",
    "install_inapp_copied": "已复制"
  },
```

在 `src/i18n/messages/en-US.json` 加入：

```json
  "pwa": {
    "app_name": "Chart-IX — Crypto Trading Education & Live Trading",
    "short_name": "Chart-IX",
    "app_description": "Learn crypto trading from the ground up, practise on paper, then trade live through your own BingX account. Your funds never leave your exchange.",
    "shortcut_trade": "Trade",
    "shortcut_screener": "Screener",
    "offline_title": "You're offline",
    "offline_body": "Your connection dropped. Articles and lessons you've already opened are still readable, but market data, positions and orders need a connection.",
    "offline_retry": "Reconnect",
    "offline_warning": "Orders cannot be placed while offline. Do not act on cached prices.",
    "update_available": "A new version is available",
    "update_action": "Update now",
    "install_title": "Add Chart-IX to your home screen",
    "install_body": "Runs full screen, starts faster, and can alert you when your price target hits.",
    "install_action": "Install",
    "install_dismiss": "Not now",
    "install_ios_step1": "Tap the Share button in the bottom toolbar",
    "install_ios_step2": "Choose \"Add to Home Screen\"",
    "install_ios_step3": "Tap \"Add\" in the top right",
    "install_inapp_title": "Open in your browser",
    "install_inapp_body": "You're in an in-app browser, which can't install to the home screen. Copy the link and open it in Safari or Chrome.",
    "install_inapp_copy": "Copy link",
    "install_inapp_copied": "Copied"
  },
```

在 `src/i18n/messages/ms-MY.json` 加入：

```json
  "pwa": {
    "app_name": "Chart-IX — Pendidikan & Dagangan Kripto",
    "short_name": "Chart-IX",
    "app_description": "Pelajari dagangan kripto dari asas, berlatih dengan akaun demo, kemudian berdagang secara langsung melalui akaun BingX anda sendiri. Dana anda kekal di bursa anda.",
    "shortcut_trade": "Dagangan",
    "shortcut_screener": "Penapis",
    "offline_title": "Anda sedang luar talian",
    "offline_body": "Sambungan terputus. Artikel dan pelajaran yang pernah dibuka masih boleh dibaca, tetapi data pasaran, posisi dan pesanan memerlukan sambungan.",
    "offline_retry": "Sambung semula",
    "offline_warning": "Pesanan tidak boleh dibuat semasa luar talian. Jangan bertindak berdasarkan harga cache.",
    "update_available": "Versi baharu tersedia",
    "update_action": "Kemas kini sekarang",
    "install_title": "Tambah Chart-IX ke skrin utama",
    "install_body": "Berjalan skrin penuh, mula lebih pantas, dan boleh memberi amaran apabila harga sasaran anda dicapai.",
    "install_action": "Pasang",
    "install_dismiss": "Nanti dulu",
    "install_ios_step1": "Ketik butang Kongsi pada bar alat bawah",
    "install_ios_step2": "Pilih \"Add to Home Screen\"",
    "install_ios_step3": "Ketik \"Add\" di penjuru kanan atas",
    "install_inapp_title": "Buka dalam pelayar anda",
    "install_inapp_body": "Anda berada dalam pelayar dalam-aplikasi yang tidak boleh memasang ke skrin utama. Salin pautan dan buka dalam Safari atau Chrome.",
    "install_inapp_copy": "Salin pautan",
    "install_inapp_copied": "Disalin"
  },
```

- [ ] **Step 6: 实现 manifest 路由**

Create `src/app/[locale]/manifest.webmanifest/route.ts`:

```ts
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { buildManifest } from "@/lib/pwa/manifest";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    return new Response("Not found", { status: 404 });
  }

  const t = await getTranslations({ locale, namespace: "pwa" });
  const manifest = buildManifest(locale, {
    name: t("app_name"),
    shortName: t("short_name"),
    description: t("app_description"),
    tradeShortcut: t("shortcut_trade"),
    screenerShortcut: t("shortcut_screener"),
  });

  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
```

- [ ] **Step 7: 在 locale layout 中引用 manifest**

在 `src/app/[locale]/layout.tsx` 的 `generateMetadata` 返回对象中加入 `manifest` 字段：

```tsx
  return {
    title: t("title"),
    description: t("description"),
    manifest: `/${locale}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      title: "Chart-IX",
      statusBarStyle: "black-translucent",
    },
    openGraph: { title: fullTitle, description: t("description") },
    twitter: { title: fullTitle, description: t("description") },
  };
```

- [ ] **Step 8: 验证**

Run: `npm run build`
Expected: 构建成功，输出中可见三个 `/[locale]/manifest.webmanifest` 的静态路由。

Run: `npx vitest run src/lib/pwa`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add src/lib/pwa/manifest.ts src/lib/pwa/manifest.test.ts \
  "src/app/[locale]/manifest.webmanifest/route.ts" "src/app/[locale]/layout.tsx" \
  src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(pwa): add per-locale web app manifest"
```

---

### Task 7: 图标资产

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create: `public/icons/*.png`（脚本产出）
- Modify: `src/app/icon.tsx`
- Modify: `src/app/apple-icon.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `logo/mlogo.png`
- Produces: `/icons/icon-192.png`、`/icons/icon-512.png`、`/icons/icon-maskable-192.png`、`/icons/icon-maskable-512.png`、`/icons/apple-touch-icon-180.png`

- [ ] **Step 1: 安装 sharp 作为 devDependency**

Run: `npm install -D sharp`

- [ ] **Step 2: 写图标生成脚本**

Create `scripts/generate-icons.mjs`:

```js
#!/usr/bin/env node
/**
 * 从 logo/mlogo.png 生成 PWA 图标集。
 *
 * maskable 版本必须把图形收进内圈 80% 的安全区——Android 会按厂商形状
 * （圆形 / 方形 / 水滴）裁切，不留边的图标会被切掉角。
 *
 * 用法：node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "logo", "mlogo.png");
const OUT_DIR = join(root, "public", "icons");
const BG = { r: 0x0b, g: 0x0a, b: 0x08, alpha: 1 };

async function render(size, { safeZone }) {
  // safeZone=0.8 表示图形只占 80%，四周各留 10% 空白
  const inner = Math.round(size * safeZone);
  const logo = await sharp(SOURCE)
    .resize(inner, inner, { fit: "contain", background: { ...BG, alpha: 0 } })
    .toBuffer();
  const pad = Math.round((size - inner) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toBuffer();
}

const targets = [
  { file: "icon-192.png", size: 192, safeZone: 0.92 },
  { file: "icon-512.png", size: 512, safeZone: 0.92 },
  { file: "icon-maskable-192.png", size: 192, safeZone: 0.8 },
  { file: "icon-maskable-512.png", size: 512, safeZone: 0.8 },
  { file: "apple-touch-icon-180.png", size: 180, safeZone: 0.92 },
];

await mkdir(OUT_DIR, { recursive: true });
for (const { file, size, safeZone } of targets) {
  const buffer = await render(size, { safeZone });
  await sharp(buffer).toFile(join(OUT_DIR, file));
  console.log(`✓ ${file} (${size}×${size}, safe zone ${safeZone * 100}%)`);
}
```

- [ ] **Step 3: 在 `package.json` 的 scripts 中登记**

在 `"scripts"` 对象中加入：

```json
    "icons": "node scripts/generate-icons.mjs",
```

- [ ] **Step 4: 运行脚本生成图标**

Run: `npm run icons`
Expected: 输出五行 `✓`，`public/icons/` 下出现五个 PNG。

- [ ] **Step 5: 目视检查 maskable 图标**

打开 `public/icons/icon-maskable-512.png`，确认 logo 图形完全落在中心圆形区域内，四周有明显留白。若 logo 触碰到边缘，把 `safeZone` 调到 `0.72` 后重跑。

- [ ] **Step 6: 校正两个动态图标的配色漂移**

`src/app/icon.tsx` 与 `src/app/apple-icon.tsx` 写在设计系统确立之前，用的是 `#0a0a0a` 底 + `#d4a843` 金，与 [DESIGN.md](../../../DESIGN.md) 定义的 `#0B0A08` + `#C9A24B` 不一致。

在两个文件中，把 `background: "#0a0a0a"` 改为 `background: "#0B0A08"`，把 `color: "#d4a843"` 改为 `color: "#C9A24B"`。

- [ ] **Step 7: 在 root layout 中引用 apple-touch-icon**

在 `src/app/layout.tsx` 的 `<head>` 中加入：

```tsx
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" />
```

- [ ] **Step 8: 提交**

```bash
git add scripts/generate-icons.mjs public/icons package.json package-lock.json \
  src/app/icon.tsx src/app/apple-icon.tsx src/app/layout.tsx
git commit -m "feat(pwa): add maskable icon set and align icon colours with design tokens"
```

---

### Task 8: 离线兜底页

**Files:**
- Create: `src/app/[locale]/offline/page.tsx`

**Interfaces:**
- Consumes: `pwa.offline_*` i18n keys（Task 6 已加入）
- Produces: 路由 `/{locale}/offline`

- [ ] **Step 1: 实现离线页**

Create `src/app/[locale]/offline/page.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

export default function OfflinePage() {
  const t = useTranslations("pwa");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 h-px w-16 bg-gold/35" />
      <h1 className="font-display text-2xl tracking-tighter text-text-primary">
        {t("offline_title")}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-text-secondary">{t("offline_body")}</p>

      {/* 离线时最危险的误解是「以为单下出去了」，所以这条提示必须显眼 */}
      <p className="mt-6 rounded-xs border border-warning/30 bg-warning-bg px-4 py-3 text-xs leading-relaxed text-warning">
        {t("offline_warning")}
      </p>

      <Button className="mt-8" onClick={() => window.location.reload()}>
        {t("offline_retry")}
      </Button>
      <div className="mt-6 h-px w-16 bg-gold/35" />
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建成功，路由列表中出现 `/[locale]/offline`。

- [ ] **Step 3: 提交**

```bash
git add "src/app/[locale]/offline/page.tsx"
git commit -m "feat(pwa): add offline fallback page"
```

---

### Task 9: PWA 状态 store 与 Service Worker 注册

**Files:**
- Create: `src/stores/pwa.ts`
- Create: `src/components/pwa/ServiceWorkerRegistrar.tsx`
- Create: `src/components/pwa/UpdateBanner.tsx`
- Modify: `src/app/[locale]/ClientLocaleLayout.tsx`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_BUILD_ID`
- Produces:
  - `usePwaStore` — `{ updateReady: boolean; hasPendingOrder: boolean; setUpdateReady(v: boolean): void; setHasPendingOrder(v: boolean): void; applyUpdate(): void; registerApplyUpdate(fn: () => void): void }`
  - `purgePageCache(): Promise<void>` — 供登出流程调用

- [ ] **Step 1: 实现 store**

Create `src/stores/pwa.ts`:

```ts
import { create } from "zustand";

interface PwaState {
  /** 新版本 SW 已就绪、正在 waiting */
  updateReady: boolean;
  /** 交易页有未确认订单时，不打扰用户去 reload */
  hasPendingOrder: boolean;
  setUpdateReady: (v: boolean) => void;
  setHasPendingOrder: (v: boolean) => void;
  /** 由 ServiceWorkerRegistrar 注入，UpdateBanner 调用 */
  applyUpdate: () => void;
  registerApplyUpdate: (fn: () => void) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  updateReady: false,
  hasPendingOrder: false,
  setUpdateReady: (v) => set({ updateReady: v }),
  setHasPendingOrder: (v) => set({ hasPendingOrder: v }),
  applyUpdate: () => {},
  registerApplyUpdate: (fn) => set({ applyUpdate: fn }),
}));

/**
 * 清掉页面缓存分区。cix-pages 里存的是渲染好的 HTML，仪表盘和订单页
 * 含用户数据——共用手机的场景下，登出后不清是实际的隐私问题。
 */
export async function purgePageCache(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "PURGE_PAGES" });
}
```

- [ ] **Step 2: 实现注册组件**

Create `src/components/pwa/ServiceWorkerRegistrar.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { usePwaStore } from "@/stores/pwa";

export function ServiceWorkerRegistrar() {
  const setUpdateReady = usePwaStore((s) => s.setUpdateReady);
  const registerApplyUpdate = usePwaStore((s) => s.registerApplyUpdate);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const version = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    let registration: ServiceWorkerRegistration | null = null;
    let reloading = false;

    // 新 SW 接管后重新加载，让页面跑在新代码上
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(`/sw.js?v=${version}`, { scope: "/" })
      .then((reg) => {
        registration = reg;

        registerApplyUpdate(() => {
          reg.waiting?.postMessage({ type: "SKIP_WAITING" });
        });

        // 已经有 waiting 的（上次没点更新就关掉了页面）
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // controller 存在说明这是「更新」而非「首次安装」，
            // 首次安装不该打扰用户
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      })
      .catch((error) => {
        // SW 是增强而非前提：隐私模式、老浏览器、企业策略都可能注册失败，
        // 这里只上报，绝不阻塞渲染
        console.warn("[pwa] service worker registration failed", error);
      });

    // 装成 App 之后会话可能挂好几天不刷新，不主动检查就永远拿不到更新
    const onVisibility = () => {
      if (document.visibilityState === "visible") registration?.update();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [setUpdateReady, registerApplyUpdate]);

  return null;
}
```

- [ ] **Step 3: 实现更新提示条**

Create `src/components/pwa/UpdateBanner.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { usePwaStore } from "@/stores/pwa";

export function UpdateBanner() {
  const t = useTranslations("pwa");
  const updateReady = usePwaStore((s) => s.updateReady);
  const hasPendingOrder = usePwaStore((s) => s.hasPendingOrder);
  const applyUpdate = usePwaStore((s) => s.applyUpdate);

  // 用户可能正在填下单表单，被新版本接管会丢掉未提交的状态——
  // 有未确认订单时闭嘴，等流程走完再提示
  if (!updateReady || hasPendingOrder) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-between gap-3 border-b border-gold/35 bg-bg-secondary px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <span className="text-xs text-text-secondary">{t("update_available")}</span>
      <button
        onClick={applyUpdate}
        className="shrink-0 rounded-xs bg-gold px-3 py-1 text-xs font-medium text-bg-primary transition-colors hover:bg-gold-hover"
      >
        {t("update_action")}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 接入 `ClientLocaleLayout`**

在 `src/app/[locale]/ClientLocaleLayout.tsx` 中加入两个 import：

```tsx
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { UpdateBanner } from "@/components/pwa/UpdateBanner";
```

并在 `<ToastProvider>` 内、`<div className="flex min-h-screen flex-col">` 之前插入：

```tsx
            <ServiceWorkerRegistrar />
            <UpdateBanner />
```

- [ ] **Step 5: 登出时清页面缓存**

在 `src/components/layout/Navbar.tsx` 中加入 import：

```tsx
import { purgePageCache } from "@/stores/pwa";
```

并把 `handleLogout` 改成：

```tsx
  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // 缓存里的仪表盘/订单页 HTML 含用户数据，登出后必须清掉
    await purgePageCache();
    router.push(`/${locale}`);
    router.refresh();
  }, [locale, router]);
```

- [ ] **Step 6: 构建验证**

Run: `npm run build`
Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 7: 提交**

```bash
git add src/stores/pwa.ts src/components/pwa/ServiceWorkerRegistrar.tsx \
  src/components/pwa/UpdateBanner.tsx "src/app/[locale]/ClientLocaleLayout.tsx" \
  src/components/layout/Navbar.tsx
git commit -m "feat(pwa): register service worker with gated update prompt and logout cache purge"
```

---

### Task 10: 安装引导

**Files:**
- Create: `src/components/pwa/InstallPrompt.tsx`
- Modify: `src/app/[locale]/ClientLocaleLayout.tsx`

**Interfaces:**
- Consumes: `readPlatform()` from `@/lib/pwa/platform`、`pwa.install_*` i18n keys
- Produces: 无（叶子组件）

- [ ] **Step 1: 实现安装引导组件**

Create `src/components/pwa/InstallPrompt.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readPlatform, type Platform } from "@/lib/pwa/platform";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const DISMISS_KEY = "chart-ix-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const t = useTranslations("pwa");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setPlatform(readPlatform());

    const onBeforeInstall = (e: Event) => {
      // 拦下浏览器的默认横幅，换成我们自己的解释卡
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setOpen(false);
      localStorage.setItem(DISMISS_KEY, "1");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!platform || platform.isStandalone) return null;
  if (platform.os === "other") return null;

  const isInApp = platform.inAppBrowser !== null;
  // iOS 不触发 beforeinstallprompt，只能给图文说明
  const showIosSteps = platform.os === "ios" && platform.canPromptInstall;
  const showAndroidButton = platform.os === "android" && deferred !== null;

  if (!isInApp && !showIosSteps && !showAndroidButton) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
    setPlatform(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setOpen(false);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-tabbar right-4 z-40 rounded-full border border-gold/35 bg-bg-secondary px-4 py-2 text-xs text-gold shadow-card lg:hidden"
      >
        {isInApp ? t("install_inapp_title") : t("install_action")}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isInApp ? t("install_inapp_title") : t("install_title")}
        size="sm"
      >
        {isInApp ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text-secondary">{t("install_inapp_body")}</p>
            <Button onClick={copyLink} className="w-full">
              {copied ? t("install_inapp_copied") : t("install_inapp_copy")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text-secondary">{t("install_body")}</p>
            {showIosSteps && (
              <ol className="space-y-2 text-sm text-text-secondary">
                {[t("install_ios_step1"), t("install_ios_step2"), t("install_ios_step3")].map(
                  (step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="font-display text-gold">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  )
                )}
              </ol>
            )}
            <div className="flex gap-2">
              {showAndroidButton && (
                <Button onClick={install} className="flex-1">
                  {t("install_action")}
                </Button>
              )}
              <Button variant="ghost" onClick={dismiss} className="flex-1">
                {t("install_dismiss")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: 接入 `ClientLocaleLayout`**

加入 import：

```tsx
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
```

并在 `<OnboardingModal />` 之后插入：

```tsx
            <InstallPrompt />
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: PASS — 现有测试 + 本计划新增的三组测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/components/pwa/InstallPrompt.tsx "src/app/[locale]/ClientLocaleLayout.tsx"
git commit -m "feat(pwa): add install prompt with iOS steps and in-app browser guidance"
```

---

### Task 11: iOS 启动图

**Files:**
- Modify: `scripts/generate-icons.mjs`
- Create: `public/icons/splash/*.png`（脚本产出）
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `logo/mlogo.png`
- Produces: `apple-touch-startup-image` link 标签

无启动图时 iOS 冷启动会闪白屏，在纯黑应用上非常刺眼。覆盖全机型需二十多个尺寸 × 横竖两向，本任务**只覆盖当前主流 iPhone 尺寸**，老机型与 iPad 接受白闪——这是记录在案的已知限制，不是遗漏。

- [ ] **Step 1: 在生成脚本中追加启动图逻辑**

在 `scripts/generate-icons.mjs` 末尾追加：

```js
// iOS 启动图。只覆盖当前主流 iPhone，老机型与 iPad 接受白闪
// （见 spec 的「已知限制」第 5 条）。
const SPLASH = [
  { w: 1170, h: 2532, name: "splash-1170x2532" }, // iPhone 12/13/14
  { w: 1179, h: 2556, name: "splash-1179x2556" }, // iPhone 14 Pro/15/16
  { w: 1284, h: 2778, name: "splash-1284x2778" }, // iPhone 12/13/14 Pro Max
  { w: 1290, h: 2796, name: "splash-1290x2796" }, // iPhone 14 Pro Max/15 Pro Max
  { w: 1206, h: 2622, name: "splash-1206x2622" }, // iPhone 16 Pro
  { w: 1320, h: 2868, name: "splash-1320x2868" }, // iPhone 16 Pro Max
];

const SPLASH_DIR = join(OUT_DIR, "splash");
await mkdir(SPLASH_DIR, { recursive: true });

for (const { w, h, name } of SPLASH) {
  const logoSize = Math.round(Math.min(w, h) * 0.32);
  const logo = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: "contain", background: { ...BG, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: logo, top: Math.round((h - logoSize) / 2), left: Math.round((w - logoSize) / 2) }])
    .png()
    .toFile(join(SPLASH_DIR, `${name}.png`));
  console.log(`✓ splash/${name}.png (${w}×${h})`);
}
```

- [ ] **Step 2: 重新运行生成脚本**

Run: `npm run icons`
Expected: 在五个图标之外，另输出六行 `✓ splash/...`。

- [ ] **Step 3: 在 root layout 的 `<head>` 中加入启动图 link**

在 `<link rel="apple-touch-icon" ... />` 之后加入：

```tsx
        {/* iOS 启动图：只覆盖主流 iPhone 尺寸，其余机型冷启动会短暂白屏 */}
        {[
          { w: 1170, h: 2532 },
          { w: 1179, h: 2556 },
          { w: 1284, h: 2778 },
          { w: 1290, h: 2796 },
          { w: 1206, h: 2622 },
          { w: 1320, h: 2868 },
        ].map(({ w, h }) => (
          <link
            key={`${w}x${h}`}
            rel="apple-touch-startup-image"
            href={`/icons/splash/splash-${w}x${h}.png`}
            media={`(device-width: ${w / 3}px) and (device-height: ${h / 3}px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`}
          />
        ))}
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 5: 提交**

```bash
git add scripts/generate-icons.mjs public/icons/splash src/app/layout.tsx
git commit -m "feat(pwa): add iOS launch images for mainstream iPhone sizes"
```

---

## 验收清单（真机）

L0 完成后需在真机确认下列各项。**没有 iOS 真机则 iOS 相关项标记为「未验证」，不得凭模拟器判定通过。**

- [ ] Android Chrome 打开站点 → 出现安装入口 → 点击安装 → 桌面出现图标，图标为圆形/水滴形时四角不缺
- [ ] Android 安装后启动 → 全屏无浏览器工具栏 → 状态栏为 `#0B0A08`
- [ ] iOS Safari 打开站点 → 出现安装引导卡 → 按三步说明添加到主屏
- [ ] iOS 从主屏启动 → 冷启动无白屏闪烁 → 状态栏内容不被 header 遮挡
- [ ] iOS 主屏图标下的名称随语言变化（三语各装一次验证）
- [ ] 应用内双指缩放无效；**K 线图上双指缩放仍可正常缩放时间轴**
- [ ] 下单表单任意输入框聚焦时页面不放大
- [ ] 开飞行模式 → 从主屏启动应用 → 显示离线页而非白屏或浏览器报错页
- [ ] 离线时打开曾访问过的文章 → 正文可读
- [ ] 离线时 `/api` 请求失败，不返回任何缓存内容
- [ ] 在 Telegram 中打开站点链接 → 显示「请在浏览器中打开」而非安装卡 → 复制链接可用
- [ ] 部署一次新版本 → 已打开的应用切到后台再切回 → 出现「有新版本」提示条 → 点击后重载到新版本
- [ ] 登出后 DevTools → Application → Cache Storage 中 `cix-pages-*` 已被清空
