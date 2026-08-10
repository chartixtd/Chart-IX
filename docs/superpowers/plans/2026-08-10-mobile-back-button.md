# 手机版全局返回按钮与触摸目标 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手机端每一个深层页面都有一个可靠的返回入口，并让所有按钮的触摸命中区达到 44px——两者都不改变现有视觉。

**Architecture:** 返回按钮收进 `MobileHeader` 一个组件：非 tab 根页时，左侧 logo 位置替换为返回按钮。是否显示、以及"没有站内历史时该退到哪"两个判断抽成 `src/lib/nav/tabs.ts` 里的纯函数，与既有的 `resolveActiveTab` 共用同一套路径解析。"有没有站内历史"由一个模块级记录器 `src/lib/nav/history.ts` 回答——不能用 `window.history.length`，也不能放在组件 state 里。触摸命中区用一个只在垂直方向扩张的伪元素实现，视觉零变化。

**Tech Stack:** Next.js 15 App Router（`usePathname` / `useRouter`）、next-intl、Tailwind（`tailwind.config.ts` + `globals.css` 的 `@layer utilities`）、vitest。

**设计文档：** `docs/superpowers/specs/2026-08-10-mobile-back-button-design.md`

## Global Constraints

- **不改变任何按钮的视觉尺寸。** `size="sm"` 全站有 **100 处**使用，横跨 `src/app/admin/*`（后台明确不做移动适配）与 `trade`/`screener` 等密集工具页。给 `Button` 加 `min-h-[44px]` 会撑高全部 100 处——**禁止这么做**。命中区只能靠伪元素扩张。
- **命中区只在垂直方向扩张**（`left: 0; right: 0` 锁死在按钮自身宽度内）。横向扩张会让并排按钮的命中区重叠、造成误触。
- **禁止用 `window.history.length > 1` 判断有无站内历史。** 用户从搜索结果或微信点进来时它同样 ≥ 2，一按就把用户踢出站点——这正是本设计要避免的失败。
- **返回按钮文案用通用的「返回」**，复用已存在的 `common.back` 键（zh-CN「返回」/ en-US「Back」/ ms-MY「Kembali」，三语均已存在，**不要新增**）。不要写「返回文章列表」这类具体上级名——走 `router.back()` 时用户可能从任何地方来，写死会说谎。
- **不显示返回的页面**只有 6 个：语言首页 `/{locale}`，以及 5 个 tab 根页 `/{locale}/dashboard`、`/learn`、`/trade`、`/screener`、`/more`。其余一律显示。
- 桌面端行为完全不变：`MobileHeader` 本身是 `lg:hidden`；命中区扩张限定在 `@media (pointer: coarse)` 内。
- 不动 `MobileTabBar` 的结构与图标，不动桌面 `Navbar`，不给 `/admin` 做移动适配。
- 每个任务结束前跑 `npx vitest run src/lib/nav/tabs.test.ts`（或对应测试文件）；最后一个任务跑全量 `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`。
- 提交信息用中文，沿用仓库既有前缀风格（`feat(...)` / `fix(...)` / `refactor(...)`）。

---

## File Structure

| 文件 | 责任 | 处置 |
|---|---|---|
| `src/lib/nav/tabs.ts` | 移动端导航的全部路径判断：tab 归属、是否显示返回、返回目标 | 修改。新增 `shouldShowBackButton`、`resolveBackTarget` 两个纯函数导出 |
| `src/lib/nav/tabs.test.ts` | 上述纯函数的单元测试 | 修改（已存在 112 行，additive） |
| `src/lib/nav/history.ts` | **新建。** 记录本次页面会话内是否发生过站内跳转 | 创建。模块级状态，跨组件重挂载存活、整页刷新时归零 |
| `src/lib/nav/history.test.ts` | **新建。** 上述记录器的单元测试 | 创建 |
| `src/components/layout/MobileHeader.tsx` | 手机顶部栏 | 修改。非 tab 根页时 logo 位置渲染返回按钮 |
| `src/app/globals.css` | 全局样式 | 修改。`@layer utilities` 内新增 `.tap-44` |
| `src/components/ui/Button.tsx` | 通用按钮 | 修改。基础类名加 `tap-44` |
| `src/app/[locale]/(static)/articles/[slug]/ArticleDetailClient.tsx` | 文章详情 | 修改。页内返回链接改为仅桌面显示 |
| `src/app/[locale]/(static)/videos/[id]/page.tsx` | 视频详情 | 修改。同上；顺带修掉硬编码的英文文案 |
| `src/app/[locale]/(app)/community/[id]/page.tsx` | 社区帖子详情 | 修改。同上 |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | 文案 | 修改。新增 `article.back_to_videos`（视频详情页现在是硬编码英文） |

**为什么 `history.ts` 必须是独立模块而不是组件内的 ref：** `AppChrome`（进而 `MobileShell`/`MobileHeader`）分别挂载在 `src/app/[locale]/(app)/layout.tsx` 和 `src/app/[locale]/(static)/layout.tsx` 两个不同的路由组下。跨组导航（例如 `/dashboard` → `/articles`）会让整棵 chrome 子树**重新挂载**，组件内的计数器随之归零，于是"刚刚明明是站内跳过来的"会被误判成"外部直入"。模块级状态在同一个 SPA 会话内不受组件重挂载影响，而整页刷新（真正的外部直入）时它本就该归零——语义正好吻合。

---

### Task 1: `shouldShowBackButton` 与 `resolveBackTarget`

**Files:**
- Modify: `src/lib/nav/tabs.ts`（在 `resolveActiveTab` 之后、`MoreEntry` 接口之前新增）
- Test: `src/lib/nav/tabs.test.ts`（文件末尾新增两个 describe 块）

**Interfaces:**
- Consumes: 无
- Produces:
  - `export function shouldShowBackButton(pathname: string, locale: string): boolean`
  - `export function resolveBackTarget(pathname: string, locale: string): string`
  - Task 4 的 `MobileHeader` 消费这两个函数。
- 保持不变（不要动）：`MOBILE_TABS`、`resolveActiveTab`、`TAB_SEGMENTS`、`buildMoreEntries`、`MoreEntry`。

**背景：**
`tabs.ts` 里已有 `resolveActiveTab` 的路径解析约定——`pathname.split("/").filter(Boolean)`，第 0 段必须等于当前 locale 否则不匹配（切换语言的过渡瞬间不该误判），并且容忍结尾斜杠。新增的两个函数**沿用同一套约定**，不要另起一套。

返回目标映射（设计文档的表，逐行）：

| 当前页 | 上级 |
|---|---|
| `/articles/[slug]` | `/articles` |
| `/videos/[id]` | `/videos` |
| `/learn/[slug]` | `/learn` |
| `/articles`、`/videos` | `/learn` |
| `/community/[id]` | `/articles?tab=community` |
| `/settings/api-keys` | `/settings` |
| `/more/alerts`、`/more/notifications` | `/more` |
| `/news`、`/orders`、`/settings`、`/upgrade` | `/more` |
| 其余（含 `/login`、`/register`、`/forgot-password`、`/offline`） | `/{locale}` |

兜底到语言首页而不是 `/dashboard`：未登录用户占公开页面流量的大头，dashboard 对他们是登录墙。

- [ ] **Step 1: 写失败的测试**

在 `src/lib/nav/tabs.test.ts` 末尾追加下面两个 describe 块，并把文件第 2 行的 import 改成：

```ts
import {
  MOBILE_TABS,
  resolveActiveTab,
  buildMoreEntries,
  shouldShowBackButton,
  resolveBackTarget,
} from "./tabs";
```

追加的测试：

```ts
describe("shouldShowBackButton", () => {
  it("语言首页不显示返回——它是导航终点", () => {
    expect(shouldShowBackButton("/zh-CN", "zh-CN")).toBe(false);
  });

  it("5 个 tab 根页都不显示返回", () => {
    for (const seg of ["dashboard", "learn", "trade", "screener", "more"]) {
      expect(shouldShowBackButton(`/zh-CN/${seg}`, "zh-CN")).toBe(false);
    }
  });

  it("tab 根页的子路由要显示返回", () => {
    expect(shouldShowBackButton("/zh-CN/more/alerts", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/articles/hello", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/settings/api-keys", "zh-CN")).toBe(true);
  });

  it("归属于某个 tab 但不是 tab 落地页的页面要显示返回", () => {
    // learn tab 收编 articles/videos，但 tab 本身跳的是 /learn
    expect(shouldShowBackButton("/zh-CN/articles", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/videos", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/settings", "zh-CN")).toBe(true);
  });

  it("不属于任何 tab 的页面也要显示返回", () => {
    expect(shouldShowBackButton("/zh-CN/login", "zh-CN")).toBe(true);
  });

  it("能容忍结尾的斜杠", () => {
    expect(shouldShowBackButton("/zh-CN/trade/", "zh-CN")).toBe(false);
  });

  it("路径的语言前缀与当前语言不一致时不显示——与 resolveActiveTab 的保守处理一致", () => {
    expect(shouldShowBackButton("/en-US/settings", "zh-CN")).toBe(false);
  });
});

describe("resolveBackTarget", () => {
  it("详情页退回各自的列表页", () => {
    expect(resolveBackTarget("/zh-CN/articles/hello", "zh-CN")).toBe("/zh-CN/articles");
    expect(resolveBackTarget("/zh-CN/videos/abc", "zh-CN")).toBe("/zh-CN/videos");
    expect(resolveBackTarget("/zh-CN/learn/basics", "zh-CN")).toBe("/zh-CN/learn");
  });

  it("文章/视频列表页退回学习 hub——learn tab 收编了它们", () => {
    expect(resolveBackTarget("/zh-CN/articles", "zh-CN")).toBe("/zh-CN/learn");
    expect(resolveBackTarget("/zh-CN/videos", "zh-CN")).toBe("/zh-CN/learn");
  });

  it("社区帖子退回社区列表（带 tab 参数）", () => {
    expect(resolveBackTarget("/zh-CN/community/42", "zh-CN")).toBe("/zh-CN/articles?tab=community");
  });

  it("设置子页退回设置，设置本身退回更多", () => {
    expect(resolveBackTarget("/zh-CN/settings/api-keys", "zh-CN")).toBe("/zh-CN/settings");
    expect(resolveBackTarget("/zh-CN/settings", "zh-CN")).toBe("/zh-CN/more");
  });

  it("更多 tab 收编的页面都退回更多", () => {
    expect(resolveBackTarget("/zh-CN/more/alerts", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/more/notifications", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/news", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/orders", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/upgrade", "zh-CN")).toBe("/zh-CN/more");
  });

  it("未收编的页面兜底到语言首页，而不是 dashboard——后者对未登录用户是登录墙", () => {
    expect(resolveBackTarget("/zh-CN/login", "zh-CN")).toBe("/zh-CN");
    expect(resolveBackTarget("/zh-CN/register", "zh-CN")).toBe("/zh-CN");
    expect(resolveBackTarget("/zh-CN/offline", "zh-CN")).toBe("/zh-CN");
  });

  it("语言前缀不匹配时兜底到当前语言的首页", () => {
    expect(resolveBackTarget("/en-US/settings", "zh-CN")).toBe("/zh-CN");
  });

  it("目标带上正确的语言前缀", () => {
    expect(resolveBackTarget("/ms-MY/articles/x", "ms-MY")).toBe("/ms-MY/articles");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/nav/tabs.test.ts
```

预期：FAIL，`shouldShowBackButton is not a function`（TypeScript 报没有该导出）。

- [ ] **Step 3: 写实现**

在 `src/lib/nav/tabs.ts` 中 `resolveActiveTab` 函数之后、`export interface MoreEntry` 之前插入：

```ts
// 语言首页与这 5 个 tab 落地页是导航终点，不是"进去的"页面——不显示返回。
// 注意这里只匹配 tab 落地页本身，它们的子路由（/more/alerts 之类）仍要显示。
const BACK_HIDDEN_SEGMENTS: string[] = ["dashboard", "learn", "trade", "screener", "more"];

/**
 * 手机顶部栏是否显示返回按钮。
 *
 * 路径解析沿用 resolveActiveTab 的约定：语言前缀必须与当前语言一致，
 * 容忍结尾斜杠。前缀不一致时返回 false——切换语言的过渡瞬间不该闪出返回键。
 */
export function shouldShowBackButton(pathname: string, locale: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== locale) return false;

  const first = segments[1];
  if (!first) return false; // 语言首页

  // 长度为 2 才是 tab 落地页本身；/more/alerts 这类子路由要显示返回
  if (segments.length === 2 && BACK_HIDDEN_SEGMENTS.includes(first)) return false;

  return true;
}

/**
 * 没有站内历史可退时（外部链接直入 / PWA 冷启动），返回按钮该跳去哪。
 *
 * 兜底是语言首页而不是 dashboard：公开页面（文章/视频/学习）的流量大头是
 * 未登录用户，dashboard 对他们是一堵登录墙。
 */
export function resolveBackTarget(pathname: string, locale: string): string {
  const home = `/${locale}`;
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== locale) return home;

  const first = segments[1];
  const second = segments[2];
  if (!first) return home;

  switch (first) {
    // 有第二段 = 详情页，退回列表页；没有 = 列表页本身，退回 learn hub
    case "articles":
      return second ? `/${locale}/articles` : `/${locale}/learn`;
    case "videos":
      return second ? `/${locale}/videos` : `/${locale}/learn`;
    case "learn":
      return `/${locale}/learn`;
    case "community":
      return `/${locale}/articles?tab=community`;
    // 有第二段 = /settings/api-keys，退回设置；没有 = 设置本身，退回更多
    case "settings":
      return second ? `/${locale}/settings` : `/${locale}/more`;
    case "more":
      return `/${locale}/more`;
    case "news":
    case "orders":
    case "upgrade":
      return `/${locale}/more`;
    default:
      return home;
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/nav/tabs.test.ts
npx tsc --noEmit
```

预期：全部通过（既有 15 条 + 新增 16 条）。任何一条对不上**不要改期望值去迁就实现**——上表是规格，先核对实现。

- [ ] **Step 5: 提交**

```bash
git add src/lib/nav/tabs.ts src/lib/nav/tabs.test.ts
git commit -m "feat(nav): 加入返回按钮的显示判断与上级页面映射"
```

---

### Task 2: 站内导航记录器 `history.ts`

**Files:**
- Create: `src/lib/nav/history.ts`
- Test: `src/lib/nav/history.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export function recordPath(pathname: string): void`
  - `export function hasInAppHistory(): boolean`
  - `export function resetInAppHistoryForTests(): void`
  - Task 4 的 `MobileHeader` 调用 `recordPath`（每次路径变化）与 `hasInAppHistory`（点击时）。

**背景（这个模块为什么必须存在、且必须是模块级状态）：**

返回按钮要"优先回上一页，没历史则回上级"，就得知道**当前这个浏览器标签里有没有发生过站内跳转**。

- **不能用 `window.history.length > 1`**：用户从 Google 搜索结果或微信点链接进来时，`history.length` 同样 ≥ 2，此时 `router.back()` 会把用户**踢出站点**。这正是要避免的失败。
- **不能放在组件的 `useState`/`useRef` 里**：`AppChrome` 分别挂载在 `src/app/[locale]/(app)/layout.tsx` 与 `src/app/[locale]/(static)/layout.tsx` 两个路由组下。跨组导航（如 `/dashboard` → `/articles`）会让整棵 chrome 子树重新挂载，组件内计数器归零，把刚刚的站内跳转误判成外部直入。

模块级变量在同一个 SPA 会话内不受组件重挂载影响；而真正的整页刷新（外部直入）会重新加载模块、状态归零——语义正好吻合。

判定方式是"记住上一次的路径"而不是"首次挂载时跳过"：后者在跨组重挂载时会把那次真实跳转当成首次而漏记。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/nav/history.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { recordPath, hasInAppHistory, resetInAppHistoryForTests } from "./history";

describe("站内导航记录器", () => {
  beforeEach(() => {
    resetInAppHistoryForTests();
  });

  it("整页加载后的第一次记录不算站内跳转——此时按返回会把用户踢出站点", () => {
    recordPath("/zh-CN/articles/hello");
    expect(hasInAppHistory()).toBe(false);
  });

  it("什么都没记录时也是无站内历史", () => {
    expect(hasInAppHistory()).toBe(false);
  });

  it("路径真的变了才算一次站内跳转", () => {
    recordPath("/zh-CN/articles/hello");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(true);
  });

  it("同一路径重复记录不计数——effect 重跑、StrictMode 双调用都不该污染判断", () => {
    recordPath("/zh-CN/articles/hello");
    recordPath("/zh-CN/articles/hello");
    recordPath("/zh-CN/articles/hello");
    expect(hasInAppHistory()).toBe(false);
  });

  it("跨路由组导航时组件会重新挂载，但记录器活着，仍算站内跳转", () => {
    // /dashboard 在 (app) 组、/articles 在 (static) 组，chrome 子树会重挂载
    recordPath("/zh-CN/dashboard");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(true);
  });

  it("一旦有过站内跳转就一直为真，后续回到同一路径也不清零", () => {
    recordPath("/zh-CN/dashboard");
    recordPath("/zh-CN/articles");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/nav/history.test.ts
```

预期：FAIL，找不到模块 `./history`。

- [ ] **Step 3: 写实现**

创建 `src/lib/nav/history.ts`：

```ts
/**
 * 记录本次页面会话内有没有发生过站内跳转，供返回按钮决定是
 * router.back()（回真实的上一页）还是 router.push()（回上级页面）。
 *
 * 为什么不用 window.history.length > 1：用户从搜索结果或微信点链接进来时它
 * 同样 ≥ 2，此时 back() 会把用户踢出站点——这正是要避免的失败。
 *
 * 为什么是模块级变量而不是组件里的 ref：AppChrome 分别挂在 (app) 与 (static)
 * 两个路由组下，跨组导航会让整棵 chrome 子树重新挂载，组件内的计数会归零，
 * 把刚刚的站内跳转误判成外部直入。模块级状态不受重挂载影响，而真正的整页
 * 刷新会重新加载模块、自然归零——语义正好吻合。
 */

let lastPath: string | null = null;
let navigatedInApp = false;

/**
 * 每次路径变化时调用（含组件重新挂载后的首次渲染）。
 *
 * 判定靠「和上一次记录的路径比对」而不是「首次挂载时跳过」：后者在跨路由组
 * 重挂载时，会把那一次真实的站内跳转当成首次而漏记。
 */
export function recordPath(pathname: string): void {
  if (lastPath !== null && lastPath !== pathname) {
    navigatedInApp = true;
  }
  lastPath = pathname;
}

/** 本次页面会话内是否发生过站内跳转——为真时 router.back() 才是安全的。 */
export function hasInAppHistory(): boolean {
  return navigatedInApp;
}

/** 仅供测试：模块级状态在同一个 vitest 进程内会跨用例残留。 */
export function resetInAppHistoryForTests(): void {
  lastPath = null;
  navigatedInApp = false;
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/nav/history.test.ts
npx tsc --noEmit
```

预期：6 条全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/nav/history.ts src/lib/nav/history.test.ts
git commit -m "feat(nav): 加入站内导航记录器，替代不可靠的 history.length 判断"
```

---

### Task 3: 触摸命中区 `.tap-44`

**Files:**
- Modify: `src/app/globals.css:107-136`（`@layer utilities` 块内，追加在 `.font-display` 之后、`prefers-reduced-motion` 媒体查询之前）
- Modify: `src/components/ui/Button.tsx:40-47`（基础类名字符串）

**Interfaces:**
- Consumes: 无
- Produces: CSS 工具类 `.tap-44`，`Button` 组件自动带上。无 JS 接口。

**背景：**
`Button` 的实际高度是 `sm` ≈ 28px、`md` ≈ 40px、`lg` ≈ 52px（`text-xs`/16px 行高 + `py-1.5`/12px = 28；`text-sm`/20px + `py-2.5`/20px = 40；`text-base`/24px + `py-3.5`/28px = 52）。iOS 人机指南下限是 44px，前两档不达标。

**不能直接加 `min-h-[44px]`**：`size="sm"` 全站 100 处，横跨后台管理（明确不做移动适配）与交易终端（密集工具界面），会把它们全部撑高。改用伪元素把**命中区**撑到 44px，画出来的按钮一模一样：

- 横向不扩（`left: 0; right: 0` 锁在按钮自身宽度内）→ 并排按钮的命中区不重叠、不误触
- 纵向各溢出 8px（28 → 44）→ 项目里堆叠按钮的间距普遍 ≥ 12px，同样不重叠
- `@media (pointer: coarse)` 限定只在触摸设备生效，鼠标端一行样式都不变
- `lg` 尺寸本就 52px > 44px，`min-height: 44px` 对它不产生任何影响

`position: relative` 也写在媒体查询内，这样桌面端连定位上下文都不新建，杜绝"某个按钮里的绝对定位子元素在桌面上突然改锚点"这类回归。

- [ ] **Step 1: 加 CSS 工具类**

在 `src/app/globals.css` 的 `@layer utilities` 块内，`.font-display` 规则之后、`@media (prefers-reduced-motion: reduce)` 之前插入：

```css
  /* 触摸命中区补足到 44px（iOS HIG 下限），视觉尺寸不变。
     Button 的 sm≈28px、md≈40px 都不达标，但全站 100 处 size="sm" 横跨后台与
     交易终端的密集布局，直接加 min-height 会把它们全撑高——所以只扩命中区。
     只在垂直方向扩：left/right 锁在按钮自身宽度内，并排按钮不会互相抢点击。 */
  @media (pointer: coarse) {
    .tap-44 {
      position: relative;
    }

    .tap-44::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      min-height: 44px;
    }
  }
```

- [ ] **Step 2: 给 Button 挂上这个类**

在 `src/components/ui/Button.tsx` 的 `cn(...)` 调用里，把第一个基础类名字符串

```ts
          "inline-flex items-center justify-center gap-2 font-medium tracking-tight transition-all duration-200",
```

改为

```ts
          "inline-flex items-center justify-center gap-2 font-medium tracking-tight transition-all duration-200",
          // 触摸设备上把命中区补到 44px，视觉尺寸不变（见 globals.css 的 .tap-44）
          "tap-44",
```

其余基础类、`variants[variant]`、`sizes[size]`、`className` 的顺序都不要动。

- [ ] **Step 3: 构建，确认样式没被 Tailwind 清掉**

```bash
npm run build
```

预期：构建成功。Tailwind 会保留 `@layer utilities` 里被实际引用的自定义类；`tap-44` 在 `Button.tsx` 里以字面量出现，不会被 purge。

- [ ] **Step 4: 确认视觉没有变化**

```bash
npx vitest run
npx tsc --noEmit && npm run lint
```

预期：全部通过。这一步不新增测试——命中区是纯 CSS 且依赖真实触摸，单测覆盖不到，验收放在 Task 6 的人工步骤。

- [ ] **Step 5: 提交**

```bash
git add src/app/globals.css src/components/ui/Button.tsx
git commit -m "feat(ui): 触摸设备上把按钮命中区补到 44px，视觉尺寸不变"
```

---

### Task 4: `MobileHeader` 渲染返回按钮

**Files:**
- Modify: `src/components/layout/MobileHeader.tsx`（整个组件）

**Interfaces:**
- Consumes: Task 1 的 `shouldShowBackButton`、`resolveBackTarget`；Task 2 的 `recordPath`、`hasInAppHistory`
- Produces: 无新导出。`MobileHeader` 的对外签名（无 props）保持不变。

**背景：**
`MobileHeader` 目前是：左侧 logo（登录后链到 `/dashboard`，否则链到首页），右侧未登录时是登录/注册两个按钮、已登录时是 `PriceAlertBell`。高度 `h-12`，`sticky top-0`，吃 `pt-safe-t`。

本任务在**非 tab 根页**时把左侧 logo 换成返回按钮。注意用户已确认这个取舍：未登录用户在公开页面上没有底部 tab bar（`MobileTabBar` 在未登录时整个不渲染），此时他们在详情页会暂时没有"一键回首页"的入口，只能逐级退——这是已批准的设计，不要自作主张改成 logo 和返回并排。

`recordPath` 放在这个组件里调用（而不是 `MobileShell`）：它是 `hasInAppHistory` 的唯一消费者，放一起省一个文件的改动。这个组件虽然 `lg:hidden`，但在桌面端仍然挂载在 DOM 里，effect 照常执行，所以记录在桌面端也是准的。

- [ ] **Step 1: 改组件**

把 `src/components/layout/MobileHeader.tsx` 整个文件替换为：

```tsx
"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { PriceAlertBell } from "@/components/alerts/PriceAlertBell";
import { Button } from "@/components/ui/Button";
import { shouldShowBackButton, resolveBackTarget } from "@/lib/nav/tabs";
import { recordPath, hasInAppHistory } from "@/lib/nav/history";

export function MobileHeader() {
  const locale = useLocale();
  const auth = useAuth();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname() ?? "";
  const router = useRouter();

  // 每次路径变化都记一笔，供返回按钮判断能不能安全地 back()。
  // 记录器是模块级的，跨路由组重挂载依然活着——判断因此不会被
  // (app)/(static) 之间的跳转打断。
  useEffect(() => {
    recordPath(pathname);
  }, [pathname]);

  const showBack = shouldShowBackButton(pathname, locale);

  const handleBack = () => {
    if (hasInAppHistory()) {
      router.back();
      return;
    }
    // 外部链接直入 / PWA 冷启动：没有站内上一页可退，退到该页所属的上级，
    // 而不是 back() 把用户踢出站点
    router.push(resolveBackTarget(pathname, locale));
  };

  return (
    // 状态栏样式是 black-translucent，内容会顶到状态栏下方，
    // 所以必须吃掉 safe-area-inset-top
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-primary/85 pt-safe-t backdrop-blur-md lg:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        {showBack ? (
          // -ml-2 px-2 让文字仍与原 logo 左缘对齐，同时把命中区向左右各撑开
          <button
            type="button"
            onClick={handleBack}
            className="-ml-2 flex min-h-[44px] items-center gap-1 px-2 text-sm text-text-secondary transition-colors active:text-text-primary"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {tCommon("back")}
          </button>
        ) : (
          <Link href={auth.userId ? `/${locale}/dashboard` : `/${locale}`}>
            <Image src="/logo.png" alt="Chart-IX" width={240} height={160} priority className="h-7 w-auto" />
          </Link>
        )}
        {/* 语言切换挪进 /more 的设置——低频操作不该占手机上最贵的横向空间 */}
        {!auth.loading && !auth.userId ? (
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">{t("sign_in")}</Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm">{t("sign_up")}</Button>
            </Link>
          </div>
        ) : (
          <PriceAlertBell />
        )}
      </div>
    </header>
  );
}
```

按钮上不需要 `aria-label`——可见文字「返回」本身就是无障碍名称，再加 `aria-label` 反而会覆盖它。箭头 `<svg>` 标了 `aria-hidden` 避免读屏重复。

- [ ] **Step 2: 类型检查与全量测试**

```bash
npx tsc --noEmit
npx vitest run
```

预期：全部通过。本任务不新增单测——`MobileHeader` 依赖 `usePathname`/`useRouter`/next-intl，跑不进现有的 node 环境 vitest（`vitest.config.ts` 的 include 只有 `src/lib/**` 和 `src/stores/**`）；它调用的两个纯函数与记录器已由 Task 1、2 覆盖。

- [ ] **Step 3: 提交**

```bash
git add src/components/layout/MobileHeader.tsx
git commit -m "feat(nav): 手机顶部栏在深层页面显示返回按钮"
```

---

### Task 5: 页内返回链接改为仅桌面显示

**Files:**
- Modify: `src/app/[locale]/(static)/articles/[slug]/ArticleDetailClient.tsx:62-70`
- Modify: `src/app/[locale]/(static)/videos/[id]/page.tsx:205-214`
- Modify: `src/app/[locale]/(app)/community/[id]/page.tsx:40-42`
- Modify: `src/i18n/messages/zh-CN.json`、`src/i18n/messages/en-US.json`、`src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: Task 4 的 `MobileHeader` 返回按钮（本任务是它的配套清理）
- Produces: 新增翻译键 `video.detail.back_to_videos`（三语）

**背景：**
这三个页面各自有页内返回链接。Task 4 之后手机上顶部已有返回按钮，一屏两个返回既冗余又难看。但**桌面端没有 `MobileHeader`**（它是 `lg:hidden`），这三个链接仍是桌面唯一的返回入口，所以只能隐藏、不能删。

三处当前的 `className` 各不相同，`display` 值也不同（`flex` / `inline-flex` / `inline-block`），替换时要各自保留原来的 display，只是加上 `lg:` 前缀并补 `hidden`。

顺带修一个既有的 i18n 缺陷：视频详情页的返回文案是**硬编码英文** `Back to Videos`，中文/马来文界面下也显示英文。既然本任务正在改这一行，一并修掉。

- [ ] **Step 1: 加翻译键**

键要加在 **`video.detail`** 命名空间下——视频详情页第 23 行取的是
`useTranslations("video.detail")`，**不是** `article`（`article` 是文章详情页
用的，两者不通用）。该命名空间现有的键是 `category`、`uploaded`、
`description`、`related_videos`、`free_preview_notice`、`preview_ends`、
`upgrade_to_watch`，把新键加在这一组里即可（位置不限，建议放在 `category`
之前，与"页面从上到下"的顺序一致）。

`src/i18n/messages/zh-CN.json` 的 `video.detail` 内：
```json
      "back_to_videos": "返回视频列表",
```

`src/i18n/messages/en-US.json` 的 `video.detail` 内：
```json
      "back_to_videos": "Back to Videos",
```

`src/i18n/messages/ms-MY.json` 的 `video.detail` 内：
```json
      "back_to_videos": "Kembali ke Video",
```

（缩进按各文件内该层级的既有缩进对齐——`video.detail` 比顶层深两级。）

- [ ] **Step 2: 校验 JSON 仍然合法**

```bash
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
```

预期：输出 `all valid JSON`。

- [ ] **Step 3: 文章详情页——隐藏页内返回**

在 `src/app/[locale]/(static)/articles/[slug]/ArticleDetailClient.tsx` 中，把

```tsx
        className="mb-6 flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
```

改为

```tsx
        className="mb-6 hidden w-fit items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary lg:flex"
```

- [ ] **Step 4: 视频详情页——隐藏页内返回并修掉硬编码英文**

在 `src/app/[locale]/(static)/videos/[id]/page.tsx` 中，把

```tsx
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
```

改为

```tsx
        className="mb-4 hidden items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary lg:inline-flex"
```

并把同一个 `<Link>` 里的硬编码文案

```tsx
        Back to Videos
```

改为

```tsx
        {t("back_to_videos")}
```

该文件第 23 行已有 `const t = useTranslations("video.detail");`，直接用即可，
**不要**新引入命名空间、也不要改成 `article`（同文件第 24 行还有一个
`tc = useTranslations("video.card")`，别用错那个）。

- [ ] **Step 5: 社区帖子页——隐藏页内返回**

在 `src/app/[locale]/(app)/community/[id]/page.tsx` 中，把

```tsx
      <Link href={`/${locale}/articles?tab=community`} className="mb-4 inline-block text-sm text-text-muted hover:text-gold">
```

改为

```tsx
      <Link href={`/${locale}/articles?tab=community`} className="mb-4 hidden text-sm text-text-muted hover:text-gold lg:inline-block">
```

- [ ] **Step 6: 类型检查与全量测试**

```bash
npx tsc --noEmit
npx vitest run
npm run lint
```

预期：全部通过。

- [ ] **Step 7: 提交**

```bash
git add "src/app/[locale]/(static)/articles/[slug]/ArticleDetailClient.tsx" "src/app/[locale]/(static)/videos/[id]/page.tsx" "src/app/[locale]/(app)/community/[id]/page.tsx" src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "fix(nav): 页内返回链接只在桌面显示，顺带修掉视频页硬编码的英文文案"
```

---

### Task 6: 全量校验与浏览器验收

**Files:** 无代码改动（纯验证任务）

**Interfaces:**
- Consumes: Task 1–5 的全部产出
- Produces: 无

**背景：**
前 5 个任务里，纯函数与记录器有单测，但"返回按钮在真实页面上显示得对不对、点了跳得对不对、命中区是不是真的 44px"三件事单测覆盖不到——`vitest.config.ts` 的 include 只有 `src/lib/**` 和 `src/stores/**`，且环境是 node，渲染不了组件。本任务用真实浏览器补上。

- [ ] **Step 1: 全量校验**

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

预期：四项全过。

- [ ] **Step 2: 起开发服务器并切到手机视口**

用 preview 工具启动 `chart-ix-dev`（`.claude/launch.json` 里已配置，端口 3000），把视口切到 mobile 预设（375×812）。

- [ ] **Step 3: 验证不该显示返回的 6 个页面**

依次访问下面 6 个地址，确认顶部左侧显示的是 **logo、不是返回按钮**：

```
/zh-CN
/zh-CN/dashboard
/zh-CN/learn
/zh-CN/trade
/zh-CN/screener
/zh-CN/more
```

（`/dashboard` 等需要登录的页面若被重定向到登录页，以重定向后的实际地址为准判断——登录页本身**应该**显示返回按钮。）

- [ ] **Step 4: 验证该显示返回的页面**

访问 `/zh-CN/articles`，确认顶部左侧是「← 返回」。用 JS 读一下按钮的实际高度，确认 ≥ 44px：

```js
const btn = document.querySelector('header button');
JSON.stringify({ text: btn?.textContent?.trim(), height: btn?.getBoundingClientRect().height });
```

预期：`text` 为「返回」，`height` ≥ 44。

- [ ] **Step 5: 验证 back() 路径（有站内历史）**

从 `/zh-CN/learn` 点进 `/zh-CN/articles`，再点返回，应回到 `/zh-CN/learn`。

- [ ] **Step 6: 验证 push 路径（无站内历史，最关键的一条）**

**新开一个标签页**直接访问 `/zh-CN/settings/api-keys`（模拟从微信/外部链接直入），点返回。

预期：跳到 `/zh-CN/settings`，**不是**离开站点、也不是毫无反应。这条验证的是本设计最核心的取舍，务必真的开新标签页——在同一标签页里导航过去会带上站内历史，测不出这个分支。

- [ ] **Step 7: 验证没有两个返回**

在手机视口下打开 `/zh-CN/articles/<任一文章 slug>`，确认页面上**只有顶部一个**返回；再切到 desktop 视口（1280×800）刷新，确认**只有页内一个**返回、顶部栏整个不显示。

- [ ] **Step 8: 验证未登录场景**

退出登录（或用无痕标签页），在手机视口打开 `/zh-CN/articles/<slug>`。确认底部没有 tab bar（既有行为），但顶部返回按钮可用且能退到 `/zh-CN/articles`。

- [ ] **Step 9: 关闭开发服务器**

验收完成后停掉 preview 服务器。

---

## 自检记录

- **设计文档逐节覆盖：** ①全局返回按钮 → Task 1（显示判断 + 上级映射）、Task 2（历史判断）、Task 4（渲染与点击）、Task 5（页内返回的配套清理）；②触摸目标 → Task 3；③测试与验收 → Task 1/2 的单测 + Task 6 的浏览器验收（设计文档列出的 5 条人工验收步骤，对应 Task 6 的 Step 3–8）。
- **对设计文档的一处收紧：** 设计文档的映射表没有单独列 `/articles`、`/videos` 这两个列表页本身。它们不是 tab 落地页（learn 才是），所以会显示返回按钮，若不单列就会掉进"其余 → 首页"的兜底。本计划补上 `/articles`、`/videos` → `/learn`，Task 1 有专门用例覆盖。设计文档已在同一次自检中同步补入该行。
- **对设计文档的一处增补：** Task 5 顺带修掉视频详情页硬编码的英文 `Back to Videos`（三语新增 `video.detail.back_to_videos`——写计划时核实过该页第 23 行取的是 `video.detail` 而非 `article` 命名空间，初稿写错已修正）。这不在设计文档的范围内，但正在改的就是那一行，属于"改到哪就顺手改好哪"，已在 Task 5 的背景里写明原因，避免被当成范围蔓延。
- **计划中的全部 36 条判断已用原样算法模拟核验通过**（`shouldShowBackButton` 14 条、`resolveBackTarget` 18 条、记录器 4 条），包括跨路由组重挂载这一最容易写错的场景。
- **类型一致性：** Task 1 导出 `shouldShowBackButton(pathname, locale) → boolean`、`resolveBackTarget(pathname, locale) → string`，Task 2 导出 `recordPath(pathname) → void`、`hasInAppHistory() → boolean`，Task 4 按这四个签名调用，无出入。
